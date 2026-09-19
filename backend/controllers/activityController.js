const ActivityLog = require("../models/ActivityLog");
const User = require("../models/User");

// Section 6: idle/AFK detection. The window must be 15-20 minutes per the
// requirements; default 15, configurable for the client's final call.
const THRESHOLD_MINUTES = Math.min(
  20,
  Math.max(15, parseInt(process.env.IDLE_THRESHOLD_MINUTES || "15", 10))
);
const THRESHOLD_MS = THRESHOLD_MINUTES * 60 * 1000;

function computeStatus(lastActivityAt) {
  if (!lastActivityAt) return "INACTIVE";
  return Date.now() - lastActivityAt.getTime() <= THRESHOLD_MS ? "ACTIVE" : "INACTIVE";
}

// The client pings this on a short interval (e.g. every 60s) while the
// employee is at their desk. One row = presence at a moment in time.
// Activity status then derives from the newest row - any activity resumes
// Active automatically (Section 6).
exports.heartbeat = async (req, res) => {
  await ActivityLog.create({ employee: req.user._id, at: new Date() });
  res.json({ status: "ACTIVE", thresholdMinutes: THRESHOLD_MINUTES });
};

// Own status only. Reduced-monitoring or not, this is presence-only data.
exports.myStatus = async (req, res) => {
  const last = await ActivityLog.findOne({ employee: req.user._id })
    .sort({ at: -1 })
    .select("at");
  res.json({
    status: computeStatus(last ? last.at : null),
    lastActivityAt: last ? last.at : null,
    thresholdMinutes: THRESHOLD_MINUTES,
  });
};

// Manager/admin view of their team's presence (Section 3 scope).
// Aggregated to Active/Inactive per person - never per keystroke (there is
// no per-keystroke data to show; see the model's hard scope note).
exports.teamStatus = async (req, res) => {
  if (req.user.role === "EMPLOYEE") {
    return res.status(403).json({ message: "Managers and admins only" });
  }
  const filter = req.user.role === "MANAGER" ? { department: req.user.department } : {};
  const people = await User.find({ ...filter, isActive: true }).select("name department reducedMonitoring");

  const out = [];
  for (const p of people) {
    const last = await ActivityLog.findOne({ employee: p._id }).sort({ at: -1 }).select("at");
    out.push({
      name: p.name,
      department: p.department,
      reducedMonitoring: p.reducedMonitoring,
      status: computeStatus(last ? last.at : null),
      lastActivityAt: last ? last.at : null,
    });
  }
  res.json(out);
};
