const Task = require("../models/Task");
const NotificationLog = require("../models/NotificationLog");
const composer = require("../services/notifications/composer");
const delivery = require("../services/delivery");
const { audit } = require("../utils/audit");

// ---------------------------------------------------------------------
// Manager alerts (Priority 5 / Section 8).
//
// Two layers, deliberately separate:
//   1. GET  /api/alerts          - in-app alerts. Always available, no
//      credentials required, so they keep working with no mailbox or WhatsApp
//      account configured.
//   2. POST /api/alerts/dispatch - a HUMAN action that emails the manager the
//      overdue/blocked summary. Nothing is emailed automatically: the
//      requirement is that a manager is alerted, not that the system spams.
//
// Scope: manager -> own department, Super Admin -> everything (Section 3).
// ---------------------------------------------------------------------

async function collectAlerts(req) {
  const deptFilter = req.user.role === "MANAGER" ? { department: req.user.department } : {};
  const now = new Date();

  const overdue = await Task.find({
    ...deptFilter,
    status: { $ne: "COMPLETED" },
    dueDate: { $lt: now },
  })
    .populate("assignedTo", "name")
    .select("title priority status dueDate assignedTo flagged blockedReason department")
    .sort({ dueDate: 1 })
    .limit(50);

  const blocked = await Task.find({ ...deptFilter, status: "BLOCKED" })
    .populate("assignedTo", "name")
    .select("title priority status dueDate assignedTo flagged blockedReason department")
    .sort({ updatedAt: -1 })
    .limit(50);

  return { overdue, blocked };
}

exports.myAlerts = async (req, res) => {
  if (req.user.role === "EMPLOYEE") {
    return res.status(403).json({ message: "Managers and admins only" });
  }
  const { overdue, blocked } = await collectAlerts(req);

  // Recent records so a manager can see what was already sent - and whether it
  // was really transmitted or only simulated.
  const recent = await NotificationLog.find({
    kind: { $in: ["OVERDUE_ALERT", "BLOCKED_ALERT", "OVERRUN_ALERT", "TASK_FLAGGED"] },
    ...(req.user.role === "MANAGER" ? { recipient: req.user._id } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .select("channel kind status driver subject error createdAt sentAt");

  res.json({
    overdue,
    blocked,
    delivery: delivery.status(),
    recentNotifications: recent.map((n) => ({
      channel: n.channel,
      kind: n.kind,
      status: n.status,
      driver: n.driver,
      subject: n.subject,
      error: n.error,
      at: n.sentAt || n.createdAt,
    })),
    note:
      "Blocked reasons are shown in aggregate so asking for help is never treated as a fault (Section 4).",
  });
};

// Human-triggered email dispatch: the manager (or a Super Admin) explicitly
// asks for the summary to be emailed.
exports.dispatch = async (req, res) => {
  if (req.user.role === "EMPLOYEE") {
    return res.status(403).json({ message: "Managers and admins only" });
  }

  const { overdue, blocked } = await collectAlerts(req);
  const timezone = req.user.timezone;
  const results = [];

  if (overdue.length) {
    const rendered = composer.renderOverdueAlerts({
      manager: req.user,
      overdueTasks: overdue,
      timezone,
    });
    const log = await delivery.sendEmail({
      recipient: req.user,
      kind: "OVERDUE_ALERT",
      subject: rendered.subject,
      body: rendered.text,
      sentBy: req.user._id,
      meta: { taskCount: overdue.length },
    });
    results.push({
      kind: "OVERDUE_ALERT",
      count: overdue.length,
      status: log ? log.status : "FAILED",
      driver: log ? log.driver : "",
    });
  }

  if (blocked.length) {
    const rendered = composer.renderBlockedAlerts({
      manager: req.user,
      blockedTasks: blocked,
      timezone,
    });
    const log = await delivery.sendEmail({
      recipient: req.user,
      kind: "BLOCKED_ALERT",
      subject: rendered.subject,
      body: rendered.text,
      sentBy: req.user._id,
      meta: { taskCount: blocked.length },
    });
    results.push({
      kind: "BLOCKED_ALERT",
      count: blocked.length,
      status: log ? log.status : "FAILED",
      driver: log ? log.driver : "",
    });
  }

  await audit(req, {
    action: "NOTIFICATION_DISPATCHED",
    targetType: "User",
    targetId: req.user._id,
    meta: { results },
  });

  res.json({
    dispatched: results,
    emailTransport: delivery.status().email,
    explanation:
      results.length === 0
        ? "Nothing overdue or blocked - no email needed."
        : "Email copy recorded. With NOTIFY_DRIVER=mock it is logged as SIMULATED, so nothing leaves the machine until the mailbox is wired.",
  });
};

// In-app notification feed (own only) - keeps alerts working with no external
// credentials.
exports.myNotifications = async (req, res) => {
  const rows = await NotificationLog.find({ recipient: req.user._id })
    .sort({ createdAt: -1 })
    .limit(Math.min(100, Number(req.query.limit) || 30));

  res.json({
    unread: rows.filter((r) => r.status === "QUEUED").length,
    items: rows.map((r) => ({
      id: r._id,
      channel: r.channel,
      kind: r.kind,
      subject: r.subject,
      body: r.body,
      status: r.status,
      driver: r.driver,
      error: r.error,
      at: r.sentAt || r.createdAt,
    })),
  });
};