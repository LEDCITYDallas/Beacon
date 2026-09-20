const Task = require("../models/Task");
const TimeLog = require("../models/TimeLog");
const Rating = require("../models/Rating");
const ScorecardSettings = require("../models/ScorecardSettings");
const ActivityLog = require("../models/ActivityLog");
const User = require("../models/User");
const config = require("../config/env");
const { weekStartInZone, monthStartInZone, dayKey, formatDate } = require("../utils/timezone");
const { audit } = require("../utils/audit");

// ---------------------------------------------------------------------
// Performance scorecard (Priority 4 / Section 7).
//
// Rules this file enforces:
//   - the WEIGHTS belong to Omair. Reports carry isLive=false + a "draft"
//     banner until the joint approval flips it (PUT /scorecard/weights).
//   - activity/idle % can never dominate: its weight is capped at 10 and it is
//     never the only scored input.
//   - nothing here triggers discipline, compensation or any employment
//     outcome. The scorecard informs human judgement only.
//   - week/month boundaries are computed in the EMPLOYEE's timezone, so an
//     overseas employee's "this week" is their own week (Priority 7).
// ---------------------------------------------------------------------

const DAY = 86400 * 1000;
const TASKS_COMPLETED_TARGET_PER_WEEK = 5; // reference point, not a quota
const REWORK_PENALTY_PER_TASK = 20;

async function collectInputs(user, startAt, endAt) {
  const completedTasks = await Task.find({
    assignedTo: user._id,
    status: "COMPLETED",
    completedAt: { $gte: startAt, $lte: endAt },
  }).select("title estimatedHours dueDate completedAt reopenCount");

  const logs = await TimeLog.find({
    employee: user._id,
    startTime: { $gte: startAt, $lte: endAt },
  }).select("task startTime endTime durationSeconds");

  let hoursLogged = 0;
  const actualByTask = new Map();
  for (const l of logs) {
    const secs = l.endTime
      ? l.durationSeconds
      : Math.max(0, Math.round((Date.now() - l.startTime.getTime()) / 1000));
    hoursLogged += secs / 3600;
    actualByTask.set(String(l.task), (actualByTask.get(String(l.task)) || 0) + secs / 3600);
  }

  const onTime = completedTasks.filter((t) => t.dueDate && t.completedAt <= t.dueDate).length;
  const onTimePct = completedTasks.length ? Math.round((onTime / completedTasks.length) * 100) : null;

  let accuracySum = 0;
  let accuracyCount = 0;
  for (const t of completedTasks) {
    const actual = actualByTask.get(String(t._id));
    if (actual == null || !t.estimatedHours) continue;
    const miss = Math.abs(actual - t.estimatedHours) / t.estimatedHours;
    accuracySum += Math.max(0, 100 - miss * 100);
    accuracyCount += 1;
  }
  const estimateAccuracyPct = accuracyCount ? Math.round(accuracySum / accuracyCount) : null;

  const reopened = completedTasks.reduce((s, t) => s + (t.reopenCount || 0), 0);

  // Activity/idle ratio. Counts only CONFIRMED activity samples (kind
  // ACTIVITY) against the samples expected at the configured cadence over an
  // 8h workday. Heartbeat rows with UNKNOWN confidence are never assumed to be
  // work, so mere presence cannot inflate this input.
  const activitySamples = await ActivityLog.countDocuments({
    employee: user._id,
    kind: "ACTIVITY",
    at: { $gte: startAt, $lte: endAt },
  });
  const idleSamples = await ActivityLog.countDocuments({
    employee: user._id,
    kind: "IDLE",
    at: { $gte: startAt, $lte: endAt },
  });
  const workdays = Math.max(1, Math.round((endAt - startAt) / DAY));
  const expectedSamples = Math.max(
    1,
    workdays * Math.round((8 * 3600) / Math.max(15, config.activity.heartbeatSeconds))
  );
  const activityIdlePct = Math.round(Math.min(1, activitySamples / expectedSamples) * 100);

  const ws = weekStartInZone(startAt, user.timezone);
  const rating = await Rating.findOne({ employee: user._id, weekStart: ws }).select("score note");

  return {
    tasksCompleted: completedTasks.length,
    onTimePct,
    onTimeCompleted: onTime,
    estimateAccuracyPct,
    hoursLogged: Number(hoursLogged.toFixed(2)),
    reopenedCount: reopened,
    managerRating: rating ? rating.score : null,
    activityIdlePct,
    activitySamples,
    idleSamples,
    completedTaskIds: completedTasks.map((t) => t._id),
  };
}

// Weighted score. Missing inputs are EXCLUDED and their weight leaves the
// denominator, rather than counting as zero - otherwise a new employee with no
// manager rating yet would look like a poor performer.
function applyWeights(inputs, weights) {
  const components = [];
  const add = (key, value, weight) => {
    if (value === null || value === undefined || !weight) return;
    components.push({ key, value, weight, contribution: (value * weight) / 100 });
  };

  add("onTimePct", inputs.onTimePct, weights.onTimePct);
  add(
    "managerRating",
    inputs.managerRating === null ? null : ((inputs.managerRating - 1) / 4) * 100,
    weights.managerRating
  );
  add("estimateAccuracyPct", inputs.estimateAccuracyPct, weights.estimateAccuracyPct);
  add(
    "tasksCompleted",
    Math.min(100, (inputs.tasksCompleted / TASKS_COMPLETED_TARGET_PER_WEEK) * 100),
    weights.tasksCompleted
  );
  add(
    "reworkPenalty",
    Math.max(0, 100 - inputs.reopenedCount * REWORK_PENALTY_PER_TASK),
    weights.reworkPenalty
  );
  add("activityIdlePct", inputs.activityIdlePct, weights.activityIdlePct);

  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  if (!totalWeight) {
    return {
      value: null,
      components,
      totalWeight: 0,
      note: "No scoreable inputs in this window yet.",
    };
  }

  const value = Math.round(components.reduce((s, c) => s + c.contribution, 0) / (totalWeight / 100));
  const activityComponent = components.find((c) => c.key === "activityIdlePct");
  const activityShare = activityComponent ? activityComponent.weight / totalWeight : 0;

  return {
    value,
    components,
    totalWeight,
    // Section 7 guardrails, reported explicitly so no report can quietly lean
    // on activity/idle.
    activityIdleShare: Number(activityShare.toFixed(3)),
    activityIdleDominant: activityShare > 0.25,
    activityIdleOnly: components.length === 1 && Boolean(activityComponent),
    note: "Draft formula - not active until Omair approves the weights (Section 7).",
  };
}

// Mongoose nested paths are not guaranteed to expose toObject(), so read the
// weights through an explicit projection. This also keeps the audit payload
// limited to the known weight keys.
function plainWeights(settings) {
  const w = settings.weights || {};
  const out = {};
  for (const k of ScorecardSettings.WEIGHT_KEYS) out[k] = w[k];
  return out;
}

async function reportFor(user, { days, periodLabel, settings }) {
  const endAt = new Date();
  // Period boundaries in the user's own timezone (Priority 7).
  const startAt =
    days >= 28
      ? monthStartInZone(endAt, user.timezone)
      : weekStartInZone(endAt, user.timezone);

  const inputs = await collectInputs(user, startAt, endAt);
  const score = applyWeights(inputs, settings.weights);

  return {
    period: periodLabel,
    windowStart: startAt,
    windowEnd: endAt,
    timezone: user.timezone,
    inputs,
    score,
    isLive: settings.isLive,
    banner: settings.isLive
      ? null
      : "DRAFT - scorecard formula not yet approved with Omair (Section 7). For visibility only, never for employment decisions.",
  };
}

// Week-over-week / month-over-month trend so the direction of travel is
// visible, not just a single number (Section 7: "expose score trends clearly").
async function trendFor(user, { periods, periodDays, settings }) {
  const out = [];
  for (let i = periods - 1; i >= 0; i--) {
    const anchor = new Date(Date.now() - i * periodDays * DAY);
    const endAt = anchor;
    const startAt =
      periodDays >= 28
        ? monthStartInZone(endAt, user.timezone)
        : weekStartInZone(endAt, user.timezone);
    const inputs = await collectInputs(user, startAt, endAt);
    const score = applyWeights(inputs, settings.weights);
    out.push({
      label: dayKey(startAt, user.timezone),
      windowStart: startAt,
      windowEnd: endAt,
      score: score.value,
      tasksCompleted: inputs.tasksCompleted,
      onTimePct: inputs.onTimePct,
      reopenCount: inputs.reopenedCount,
      hoursLogged: inputs.hoursLogged,
      activityIdlePct: inputs.activityIdlePct,
    });
  }
  return out;
}

// Own report: any role, own data only. Weekly + monthly + trends.
exports.myReport = async (req, res) => {
  const settings = await ScorecardSettings.getOrCreate();
  const [week, month, weekTrend, monthTrend] = await Promise.all([
    reportFor(req.user, { days: 7, periodLabel: "week", settings }),
    reportFor(req.user, { days: 30, periodLabel: "month", settings }),
    trendFor(req.user, { periods: 4, periodDays: 7, settings }),
    trendFor(req.user, { periods: 3, periodDays: 30, settings }),
  ]);
  res.json({ week, month, trends: { weeks: weekTrend, months: monthTrend } });
};

// Another employee's report: same-department manager or Super Admin (Section 7).
exports.userReport = async (req, res) => {
  const target = await User.findById(req.params.userId).select("_id department name timezone");
  if (!target) return res.status(404).json({ message: "User not found" });
  if (req.user.role === "MANAGER" && target.department !== req.user.department) {
    return res.status(403).json({ message: "Outside your department" });
  }
  if (req.user.role === "EMPLOYEE") {
    return res.status(403).json({ message: "Employees see their own scorecard only" });
  }

  const settings = await ScorecardSettings.getOrCreate();
  const [week, month, weekTrend] = await Promise.all([
    reportFor(target, { days: 7, periodLabel: "week", settings }),
    reportFor(target, { days: 30, periodLabel: "month", settings }),
    trendFor(target, { periods: 4, periodDays: 7, settings }),
  ]);
  res.json({
    employee: { id: target._id, name: target.name, department: target.department, timezone: target.timezone },
    week,
    month,
    trends: { weeks: weekTrend },
  });
};

// Team view: manager -> own department, Super Admin -> everything (Section 3).
// This is the manager's department/team scorecard experience.
exports.teamReport = async (req, res) => {
  if (req.user.role === "EMPLOYEE") {
    return res.status(403).json({ message: "Employees see their own scorecard only" });
  }

  const filter = {};
  if (req.user.role === "MANAGER") filter.department = req.user.department;
  else if (req.query.department) filter.department = String(req.query.department);
  filter.isActive = true;

  const settings = await ScorecardSettings.getOrCreate();
  const people = await User.find(filter).select("name department role timezone reducedMonitoring");

  // Only people who can be rated/reported on (managers and admins still have
  // their own scorecard, but the team view is about tracked staff).
  const rows = [];
  for (const p of people) {
    const week = await reportFor(p, { days: 7, periodLabel: "week", settings });
    const trend = await trendFor(p, { periods: 4, periodDays: 7, settings });
    rows.push({
      employee: {
        id: p._id,
        name: p.name,
        department: p.department,
        role: p.role,
        timezone: p.timezone,
        reducedMonitoring: p.reducedMonitoring,
      },
      week: {
        score: week.score.value,
        inputs: week.inputs,
        windowStart: week.windowStart,
      },
      trend: trend.map((t) => ({ label: t.label, score: t.score, tasksCompleted: t.tasksCompleted })),
    });
  }

  rows.sort((a, b) => (b.week.score ?? -1) - (a.week.score ?? -1));

  res.json({
    isLive: settings.isLive,
    banner: settings.isLive
      ? null
      : "DRAFT - weights pending joint approval with Omair (Section 7). Visibility only.",
    department: req.user.role === "MANAGER" ? req.user.department : req.query.department || "all",
    weights: settings.weights,
    members: rows,
    note:
      "activityIdlePct is capped at 10 and can never dominate the score. No report triggers an employment decision.",
  });
};

// Department roll-up for the Super Admin (global reporting capability).
exports.departmentReport = async (req, res) => {
  if (req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ message: "Super Admin only" });
  }
  const settings = await ScorecardSettings.getOrCreate();
  const departments = (await User.distinct("department")).filter(Boolean);

  const rows = [];
  for (const dept of departments) {
    const people = await User.find({ department: dept, isActive: true }).select("name role timezone");
    if (!people.length) continue;

    let scoreSum = 0;
    let scoreCount = 0;
    let completed = 0;
    let onTimeWeighted = 0;
    let onTimeCount = 0;

    for (const p of people) {
      const week = await reportFor(p, { days: 7, periodLabel: "week", settings });
      if (week.score.value !== null) {
        scoreSum += week.score.value;
        scoreCount++;
      }
      completed += week.inputs.tasksCompleted;
      if (week.inputs.onTimePct !== null) {
        onTimeWeighted += week.inputs.onTimePct;
        onTimeCount++;
      }
    }

    rows.push({
      department: dept,
      people: people.length,
      averageScore: scoreCount ? Math.round(scoreSum / scoreCount) : null,
      tasksCompletedThisWeek: completed,
      averageOnTimePct: onTimeCount ? Math.round(onTimeWeighted / onTimeCount) : null,
    });
  }

  res.json({
    isLive: settings.isLive,
    banner: settings.isLive ? null : "DRAFT - weights pending joint approval with Omair (Section 7).",
    departments: rows.sort((a, b) => (b.averageScore ?? -1) - (a.averageScore ?? -1)),
  });
};

// Manager rating input (Section 7). One rating per employee per week, in the
// employee's own week (so the manager rates the week the employee worked).
exports.rate = async (req, res) => {
  const { employeeId, score, note, weekOf } = req.body;
  if (!employeeId || !Number.isInteger(score) || score < 1 || score > 5) {
    return res.status(400).json({ message: "employeeId and integer score 1-5 required" });
  }
  const target = await User.findById(employeeId).select("_id department timezone name");
  if (!target) return res.status(404).json({ message: "Employee not found" });
  if (req.user.role === "EMPLOYEE") {
    return res.status(403).json({ message: "Only managers and administrators can rate" });
  }
  if (req.user.role === "MANAGER" && target.department !== req.user.department) {
    return res.status(403).json({ message: "Outside your department" });
  }

  const anchor = weekOf ? new Date(weekOf) : new Date();
  const weekStart = weekStartInZone(anchor, target.timezone);

  const rating = await Rating.findOneAndUpdate(
    { employee: target._id, weekStart },
    { score, note: String(note || "").slice(0, 500), ratedBy: req.user._id },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await audit(req, {
    action: "SCORECARD_RATING_SET",
    targetType: "User",
    targetId: target._id,
    meta: { weekStart, score, employeeName: target.name },
  });

  res.json({
    ...rating.toObject(),
    weekStartLocal: formatDate(weekStart, target.timezone),
    employeeTimezone: target.timezone,
  });
};

exports.listRatings = async (req, res) => {
  if (req.user.role === "EMPLOYEE") {
    return res.status(403).json({ message: "Only managers and administrators can view ratings" });
  }
  const query = {};
  if (req.query.userId) query.employee = req.query.userId;
  else if (req.user.role === "MANAGER") {
    const deptPeople = await User.find({ department: req.user.department }).select("_id");
    query.employee = { $in: deptPeople.map((p) => p._id) };
  }

  const rows = await Rating.find(query)
    .populate("employee", "name department timezone")
    .populate("ratedBy", "name")
    .sort({ weekStart: -1 })
    .limit(Math.min(200, Number(req.query.limit) || 50));

  res.json(
    rows.map((r) => ({
      id: r._id,
      employee: r.employee ? { id: r.employee._id, name: r.employee.name, department: r.employee.department } : null,
      weekStart: r.weekStart,
      score: r.score,
      note: r.note,
      ratedBy: r.ratedBy ? r.ratedBy.name : "",
    }))
  );
};

// Weights: Super Admin only (Section 3: "performance formula control").
// Flipping isLive is the joint-approval moment (Section 7).
exports.updateWeights = async (req, res) => {
  if (req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ message: "Super Admin only" });
  }
  const settings = await ScorecardSettings.getOrCreate();
  const { weights, isLive } = req.body;
  const before = { weights: plainWeights(settings), isLive: settings.isLive };

  if (weights) {
    for (const key of ScorecardSettings.WEIGHT_KEYS) {
      if (weights[key] === undefined) continue;
      const v = Number(weights[key]);
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        return res.status(400).json({ message: `${key} must be 0-100` });
      }
      if (key === "activityIdlePct" && v > 10) {
        return res.status(400).json({
          message: "activityIdlePct weight is capped at 10 (Section 7: never dominant)",
        });
      }
      settings.weights[key] = v;
    }
  }
  if (isLive !== undefined) settings.isLive = Boolean(isLive);
  settings.updatedBy = req.user._id;
  await settings.save();

  await audit(req, {
    action: "SCORECARD_WEIGHTS_UPDATED",
    targetType: "ScorecardSettings",
    targetId: settings._id,
    meta: { before, after: { weights: plainWeights(settings), isLive: settings.isLive } },
  });

  res.json(settings);
};

exports.getSettings = async (req, res) => {
  const settings = await ScorecardSettings.getOrCreate();
  res.json({
    ...settings.toObject(),
    interpretation:
      "Weights are a draft until Omair approves them together with the contractor. isLive=false keeps every report in draft mode.",
  });
};