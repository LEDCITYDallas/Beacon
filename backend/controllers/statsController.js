const Task = require("../models/Task");
const TimeLog = require("../models/TimeLog");

const DAY = 86400 * 1000;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// One rolling 7-day window ending now. Used for the current week and for
// the 4-week trend (Section 8: "own weekly stats and trend").
async function weekStats(userId, endAt) {
  const startAt = new Date(endAt.getTime() - 7 * DAY);

  const completedTasks = await Task.find({
    assignedTo: userId,
    status: "COMPLETED",
    completedAt: { $gte: startAt, $lte: endAt },
  }).select("estimatedHours dueDate completedAt");

  const logs = await TimeLog.find({
    employee: userId,
    startTime: { $gte: startAt, $lte: endAt },
  }).select("task startTime endTime durationSeconds");

  // Actual hours include a still-running segment in the window.
  let hoursLogged = 0;
  const actualByTask = new Map();
  for (const l of logs) {
    const end = l.endTime ? l.endTime.getTime() : endAt.getTime();
    const secs = l.endTime
      ? l.durationSeconds
      : Math.max(0, Math.round((end - l.startTime.getTime()) / 1000));
    hoursLogged += secs / 3600;
    actualByTask.set(String(l.task), (actualByTask.get(String(l.task)) || 0) + secs / 3600);
  }

  const onTime = completedTasks.filter(
    (t) => t.dueDate && t.completedAt <= t.dueDate
  ).length;
  const onTimePct = completedTasks.length
    ? Math.round((onTime / completedTasks.length) * 100)
    : null;

  // Estimate accuracy: 100% when actual matches estimate, scaled down by
  // the relative miss, clamped to 0-100. Raw inputs kept alongside so the
  // Phase 5 scorecard can reweight without re-querying (Section 7: the
  // formula is finalized jointly - these are inputs, not a verdict).
  let accuracySum = 0;
  let accuracyCount = 0;
  for (const t of completedTasks) {
    const actual = actualByTask.get(String(t._id));
    if (actual == null || !t.estimatedHours) continue;
    const miss = Math.abs(actual - t.estimatedHours) / t.estimatedHours;
    accuracySum += Math.max(0, 100 - miss * 100);
    accuracyCount += 1;
  }
  const estimateAccuracyPct = accuracyCount
    ? Math.round(accuracySum / accuracyCount)
    : null;

  return {
    windowStart: startAt,
    windowEnd: endAt,
    tasksCompleted: completedTasks.length,
    onTimeCompleted: onTime,
    onTimePct,
    estimateAccuracyPct,
    hoursLogged: Number(hoursLogged.toFixed(2)),
  };
}

// Section 8: employee self-view. Own data only; a manager version comes
// with the scorecard phase (viewable by employee (their own only) and
// manager/Super Admin).
exports.myWeek = async (req, res) => {
  const current = await weekStats(req.user._id, new Date());

  const trend = [];
  for (let i = 1; i <= 3; i++) {
    trend.push(await weekStats(req.user._id, new Date(Date.now() - i * 7 * DAY)));
  }

  res.json({ current, trend });
};
