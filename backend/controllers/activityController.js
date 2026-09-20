const ActivityLog = require("../models/ActivityLog");
const User = require("../models/User");
const config = require("../config/env");
const { formatDateTime } = require("../utils/timezone");

// ---------------------------------------------------------------------
// Activity / AFK detection (Priority 2 / Section 6).
//
// A heartbeat alone proves the client is running - NOT that a human touched the
// mouse or keyboard. So the client (browser hook or the OS agent) sends how long
// the machine has been idle, and the server decides:
//
//   idleSeconds <  threshold  -> ACTIVITY   -> ACTIVE
//   idleSeconds >= threshold  -> IDLE       -> INACTIVE ("on break")
//   no idle information       -> HEARTBEAT  -> ACTIVE but confidence UNKNOWN
//
// There is no keystroke, key-content, screen, webcam or audio data anywhere in
// this feature: only a state, a timestamp and a number of idle seconds.
//
// Entering idle and returning to active are both recorded, and any permitted
// activity automatically resumes Active (Section 6).
// ---------------------------------------------------------------------

const THRESHOLD_MINUTES = config.activity.idleThresholdMinutes;
const THRESHOLD_SECONDS = THRESHOLD_MINUTES * 60;
const STALE_MS = config.activity.staleAfterMinutes * 60 * 1000;

function parseIdleSeconds(body) {
  const raw = body && body.idleSeconds;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  // Guard against a broken client claiming a negative or absurd idle time.
  return Math.min(Math.round(n), 60 * 60 * 24 * 7);
}

function kindFor(idleSeconds) {
  if (idleSeconds === null) return "HEARTBEAT";
  return idleSeconds >= THRESHOLD_SECONDS ? "IDLE" : "ACTIVITY";
}

function sourceFor(body) {
  const s = body && body.source ? String(body.source).toUpperCase() : "BROWSER";
  return ["BROWSER", "OS_AGENT", "SERVER"].includes(s) ? s : "BROWSER";
}

// The newest row decides the state. IDLE always wins until a newer ACTIVITY
// row appears - which is exactly "return to Active automatically" (Section 6).
async function currentState(employeeId) {
  const last = await ActivityLog.findOne({ employee: employeeId }).sort({ at: -1 });

  if (!last) {
    return {
      status: "INACTIVE",
      activityConfidence: "UNKNOWN",
      idleDetected: false,
      lastActivityAt: null,
      lastSignalKind: null,
      idleSeconds: null,
      idleThresholdMinutes: THRESHOLD_MINUTES,
    };
  }

  const ageMs = Date.now() - last.at.getTime();
  let status;
  let confidence;
  let idleDetected = false;

  if (last.kind === "IDLE") {
    status = "INACTIVE";
    confidence = "CONFIRMED";
    idleDetected = true;
  } else if (last.kind === "ACTIVITY") {
    status = ageMs <= STALE_MS ? "ACTIVE" : "INACTIVE";
    confidence = "CONFIRMED";
  } else {
    // HEARTBEAT: the client is alive, but it told us nothing about input.
    status = ageMs <= STALE_MS ? "ACTIVE" : "INACTIVE";
    confidence = "UNKNOWN";
  }

  return {
    status,
    activityConfidence: confidence,
    idleDetected,
    lastActivityAt: last.at,
    lastSignalKind: last.kind,
    idleSeconds: last.idleSeconds,
    idleThresholdMinutes: THRESHOLD_MINUTES,
    source: last.source,
    // How long ago the last signal arrived, whatever its kind.
    signalAgeSeconds: Math.max(0, Math.round(ageMs / 1000)),
  };
}

// One heartbeat. The client calls this on a short interval while signed in, and
// immediately after the machine wakes up or the network reconnects.
exports.heartbeat = async (req, res) => {
  const idleSeconds = parseIdleSeconds(req.body);
  const kind = kindFor(idleSeconds);
  const source = sourceFor(req.body);

  const previous = await ActivityLog.findOne({ employee: req.user._id }).sort({ at: -1 });
  const wasIdle = Boolean(previous && previous.kind === "IDLE");
  const resumedFromIdle = Boolean(kind === "ACTIVITY" && wasIdle);

  await ActivityLog.create({
    employee: req.user._id,
    at: new Date(),
    kind,
    idleSeconds,
    idleThresholdMinutes: THRESHOLD_MINUTES,
    source,
    resumedFromIdle,
    visibility: req.body && req.body.visibility ? String(req.body.visibility).slice(0, 20) : "",
    clientId: req.body && req.body.clientId ? String(req.body.clientId).slice(0, 64) : "",
  });

  const state = await currentState(req.user._id);

  res.json({
    ...state,
    recorded: kind,
    resumedFromIdle,
    note:
      kind === "IDLE"
        ? `No mouse/keyboard activity for ${Math.round((idleSeconds || 0) / 60)} min - marked On Break/Inactive.`
        : kind === "ACTIVITY"
          ? resumedFromIdle
            ? "Activity detected - you are Active again."
            : "Activity recorded."
          : "Presence recorded (no activity information supplied).",
    idlenessOnly:
      "Only activity/idle state and timestamps are stored. No keystrokes, key contents, screen content, webcam or audio.",
  });
};

// Own status only. Reduced-monitoring or not, this is state-only data.
exports.myStatus = async (req, res) => {
  res.json(await currentState(req.user._id));
};

// Own activity summary for the last 24h - so an employee can see for themselves
// that only activity/idle state is stored, never content.
exports.myActivitySummary = async (req, res) => {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [rows, user] = await Promise.all([
    ActivityLog.find({ employee: req.user._id, at: { $gte: since } })
      .select("kind idleSeconds at source")
      .sort({ at: -1 })
      .limit(2000),
    User.findById(req.user._id).select("timezone reducedMonitoring"),
  ]);

  const counts = { ACTIVITY: 0, IDLE: 0, HEARTBEAT: 0 };
  let idlePeriods = 0;
  let activitySeen = 0;
  for (const r of rows) {
    counts[r.kind] = (counts[r.kind] || 0) + 1;
    if (r.kind === "IDLE") idlePeriods++;
    if (r.kind === "ACTIVITY") activitySeen++;
  }

  res.json({
    windowHours: 24,
    timezone: user ? user.timezone : "America/Chicago",
    reducedMonitoring: user ? user.reducedMonitoring : false,
    counts,
    idlePeriods,
    activitySeen,
    recordedSince: rows.length ? rows[rows.length - 1].at : null,
    lastSamples: rows.slice(0, 20).map((r) => ({
      at: r.at,
      kind: r.kind,
      idleSeconds: r.idleSeconds,
      source: r.source,
    })),
    scope:
      "Activity/idle state and timestamps only. No keystrokes, key contents, screen content, webcam or audio are ever recorded.",
  });
};

// Manager/admin view of their team's presence (Section 3 scope).
exports.teamStatus = async (req, res) => {
  if (req.user.role === "EMPLOYEE") {
    return res.status(403).json({ message: "Managers and admins only" });
  }
  const filter = req.user.role === "MANAGER" ? { department: req.user.department } : {};
  const people = await User.find({ ...filter, isActive: true }).select(
    "name department reducedMonitoring timezone"
  );

  const out = [];
  for (const p of people) {
    const state = await currentState(p._id);
    out.push({
      userId: p._id,
      name: p.name,
      department: p.department,
      timezone: p.timezone,
      reducedMonitoring: p.reducedMonitoring,
      ...state,
    });
  }
  res.json(out);
};

// Routes consume the individual exports above; these are shared helpers.
module.exports.THRESHOLD_MINUTES = THRESHOLD_MINUTES;
module.exports.currentState = currentState;
module.exports.kindFor = kindFor;