const Task = require("../models/Task");
const User = require("../models/User");
const ActivityLog = require("../models/ActivityLog");
const composer = require("../services/notifications/composer");
const delivery = require("../services/delivery");
const config = require("../config/env");
const {
  dayKey,
  formatDate,
  formatDateTime,
  nextWeekdayAt,
} = require("../utils/timezone");
const { audit } = require("../utils/audit");

// ---------------------------------------------------------------------
// Friday digest (Priority 5 / Section 8) - what each person finished, what is
// late, who is overloaded.
//
// Generation and delivery are separate:
//   GET  /api/digest/weekly   - builds the content (and the WhatsApp text)
//   GET  /api/digest/schedule - when the next Friday run is, in the digest zone
//   POST /api/digest/send     - the Super Admin explicitly sends it on WhatsApp
//
// Section 8 says the digest goes to Omair, so the recipient is the configured
// OMAIR_WHATSAPP_NUMBER (an explicit `to` may be supplied instead).
// ---------------------------------------------------------------------

const DAY = 86400 * 1000;
const OVERLOAD_OPEN_HOURS = 20;

async function buildDigest({ weekOffset = 0 } = {}) {
  const tz = config.notifications.digest.timezone;
  const endAt = new Date(Date.now() - weekOffset * 7 * DAY);
  const startAt = new Date(endAt.getTime() - 7 * DAY);

  const people = await User.find({ isActive: true }).select("name department timezone");

  const perPerson = [];
  for (const p of people) {
    const finished = await Task.find({
      assignedTo: p._id,
      status: "COMPLETED",
      completedAt: { $gte: startAt, $lte: endAt },
    }).select("title completedAt");

    const late = await Task.find({
      assignedTo: p._id,
      status: { $ne: "COMPLETED" },
      dueDate: { $lt: endAt },
    }).select("title dueDate");

    const open = await Task.find({
      assignedTo: p._id,
      status: { $in: ["READY", "IN_PROGRESS", "PAUSED", "BLOCKED"] },
    }).select("estimatedHours");

    // Presence context only (activity/idle state), and the only activity signal
    // that exists in this system.
    const idleSignals = await ActivityLog.countDocuments({
      employee: p._id,
      kind: "IDLE",
      at: { $gte: startAt, $lte: endAt },
    });

    const openHours = open.reduce((s, t) => s + (t.estimatedHours || 0), 0);

    perPerson.push({
      name: p.name,
      department: p.department,
      // Each person's late dates render in THEIR timezone (Priority 7), while
      // the digest itself is labelled in the digest zone.
      timezone: p.timezone,
      finished: finished.map((t) => t.title),
      late: late.map((t) => ({
        title: t.title,
        dueDate: t.dueDate,
        dueDateLocal: formatDate(t.dueDate, p.timezone),
      })),
      openHours: Number(openHours.toFixed(1)),
      overloaded: openHours > OVERLOAD_OPEN_HOURS,
      idleSignals,
    });
  }

  const weekOf = dayKey(startAt, tz);
  const rendered = composer.renderWeeklyDigest({
    perPerson,
    timezone: tz,
    weekOf,
    generatedAt: endAt,
  });

  return {
    weekOf,
    windowStart: startAt,
    windowEnd: endAt,
    timezone: tz,
    generatedAt: endAt,
    perPerson,
    subject: rendered.subject,
    whatsappText: rendered.text,
  };
}

exports.weekly = async (req, res) => {
  if (req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ message: "Super Admin only" });
  }
  const weekOffset = Math.min(12, Math.max(0, Number(req.query.weekOffset) || 0));
  const digest = await buildDigest({ weekOffset });
  res.json({
    ...digest,
    delivery: delivery.status().digest,
    note:
      "Content only until the WhatsApp delivery path is switched on (NOTIFY_DRIVER=live + WhatsApp Cloud API credentials). Sending is a separate, explicit action.",
  });
};

// When the next Friday run is, expressed in the configured digest zone, so the
// scheduler on the Mac mini never has to do UTC arithmetic itself.
exports.schedule = async (req, res) => {
  if (req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ message: "Super Admin only" });
  }
  const d = config.notifications.digest;
  const next = nextWeekdayAt(
    new Date(),
    { weekday: d.dayOfWeek, hour: d.hour, minute: d.minute },
    d.timezone
  );
  res.json({
    timezone: d.timezone,
    dayOfWeek: d.dayOfWeek,
    hour: d.hour,
    minute: d.minute,
    nextRunAt: next,
    nextRunLocal: formatDateTime(next, d.timezone),
    sendEnabled: d.enabled,
    recipientConfigured: Boolean(d.omairWhatsApp),
    cronHint:
      "npm run digest (scripts/run-digest.js) - safe to run from cron every 30 minutes; it only sends inside the window.",
  });
};

// The approval step for the digest: a Super Admin explicitly sends it now.
exports.send = async (req, res) => {
  if (req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ message: "Super Admin only" });
  }

  const digest = await buildDigest({ weekOffset: 0 });
  const to = (req.body && req.body.to) || config.notifications.digest.omairWhatsApp;

  if (!to && !config.notifications.digest.enabled) {
    return res.status(400).json({
      message:
        "No WhatsApp recipient configured. Set OMAIR_WHATSAPP_NUMBER (or pass `to`) and NOTIFY_DRIVER=live, or enable DIGEST_SEND_ENABLED.",
      code: "DIGEST_NOT_CONFIGURED",
    });
  }

  const { log, skipped } = await delivery.sendDigestWhatsApp({
    text: digest.whatsappText,
    to: to || undefined,
    sentBy: req.user._id,
    meta: { weekOf: digest.weekOf, perPerson: digest.perPerson.length },
  });

  await audit(req, {
    action: "DIGEST_DISPATCHED",
    targetType: "User",
    targetId: req.user._id,
    meta: {
      weekOf: digest.weekOf,
      status: log ? log.status : "FAILED",
      driver: log ? log.driver : "",
      recipientConfigured: Boolean(to),
    },
  });

  res.json({
    weekOf: digest.weekOf,
    status: log ? log.status : "FAILED",
    driver: log ? log.driver : "",
    simulated: !log || log.status === "SIMULATED" || skipped,
    deliveredText: digest.whatsappText,
    explanation: skipped
      ? "Recorded, not transmitted: digest delivery is not switched on yet (DIGEST_SEND_ENABLED=false)."
      : "Handed to the WhatsApp adapter. SIMULATED means the driver was mock - no message left the machine.",
  });
};

module.exports.buildDigest = buildDigest;