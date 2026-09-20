const AuditLog = require("../models/AuditLog");
const RetentionSettings = require("../models/RetentionSettings");
const PermissionSettings = require("../models/PermissionSettings");
const permissions = require("../services/permissions");
const aiUsage = require("../services/ai/usage");
const aiProvider = require("../services/ai/provider");
const delivery = require("../services/delivery");
const integrations = require("../services/integrations/adapters");
const config = require("../config/env");
const frameBus = require("../services/liveview/frameBus");
const { audit } = require("../utils/audit");
const { isValidTimeZone } = require("../utils/timezone");

// ---------------------------------------------------------------------
// Admin controller (Priorities 1, 3, 8, 9, 10).
//
// Everything here is Super Admin territory except the read-only status view,
// and every write is audited. No secret value is ever echoed back: status
// endpoints report booleans ("configured: true"), never keys or tokens.
// ---------------------------------------------------------------------

async function requireSettingsAccess(req, res) {
  const matrix = await permissions.effectiveMatrix();
  const role = matrix.roles[req.user.role];
  if (!role || !role.canManageSettings) {
    res.status(403).json({ message: "Super Admin only", code: "ADMIN_ONLY" });
    return false;
  }
  return true;
}

// --- AI provider + cost -------------------------------------------------

exports.getAiUsage = async (req, res) => {
  if (!(await requireSettingsAccess(req, res))) return;
  const days = Math.min(180, Math.max(1, Number(req.query.days) || 30));
  const summary = await aiUsage.usageSummary({ days, timezone: req.user.timezone });
  res.json({
    provider: aiProvider.describeProvider(),
    // What the Super Admin needs to compare against the approved budget in
    // docs/ai-cost-estimate.md: the estimate versus the recorded spend.
    costAssumptions: {
      perMillionTokens: config.ai.costPerMillion,
      monthlyBudgetUsd: config.ai.monthlyBudgetUsd,
      dailyCallLimitPerUser: config.ai.dailyCallLimitPerUser,
      note:
        "Costs are estimated at published list prices for the configured model. The provider invoice is authoritative.",
    },
    ...summary,
  });
};

// --- System status ------------------------------------------------------

exports.getSystemStatus = async (req, res) => {
  if (!(await requireSettingsAccess(req, res))) return;
  const [policy, retention, permissionDoc] = await Promise.all([
    permissions.liveViewPolicy(),
    RetentionSettings.getOrCreate(),
    PermissionSettings.getOrCreate(),
  ]);

  res.json({
    environment: {
      nodeEnv: config.nodeEnv,
      mockMode: config.mockMode,
      productionTarget: "Mac mini over Tailscale (see docs/deployment-mac-mini-tailscale.md)",
    },
    ai: aiProvider.describeProvider(),
    notifications: delivery.status(),
    integrations: {
      driver: config.integrations.driver,
      sources: integrations.describeSources(),
    },
    activity: {
      idleThresholdMinutes: config.activity.idleThresholdMinutes,
      heartbeatSeconds: config.activity.heartbeatSeconds,
      collectKeystrokes: false,
      collectScreenContent: false,
      collectWebcam: false,
      collectAudio: false,
    },
    liveView: {
      ...policy,
      frameTtlSeconds: config.liveView.frameTtlSeconds,
      maxFrameBytes: config.liveView.maxFrameBytes,
      framesStored: false,
      bus: frameBus.stats(),
    },
    retention: {
      enabled: retention.enabled,
      isApproved: retention.isApproved,
      days: retention.days,
      lastRunAt: retention.lastRunAt,
      note: retention.note,
    },
    permissions: {
      version: permissionDoc.version,
      updatedAt: permissionDoc.updatedAt,
      overrides: permissionDoc.overrides,
    },
  });
};

// --- Retention (Priority 9) --------------------------------------------

exports.getRetention = async (req, res) => {
  if (!(await requireSettingsAccess(req, res))) return;
  const doc = await RetentionSettings.getOrCreate();
  res.json({
    settings: doc,
    keys: RetentionSettings.RETENTION_KEYS,
    instruction:
      "The retention period is the client's decision (Section 12). Durations stay null and the cleanup job deletes nothing until a period is approved here or through env.",
  });
};

exports.updateRetention = async (req, res) => {
  if (!(await requireSettingsAccess(req, res))) return;
  const doc = await RetentionSettings.getOrCreate();
  const { days, enabled, isApproved, note, scorecardAggregatesMonths } = req.body || {};

  if (days) {
    for (const key of RetentionSettings.RETENTION_KEYS) {
      if (days[key] === undefined) continue;
      if (days[key] === null) {
        doc.days[key] = null; // "not decided" is a valid, explicit state
        continue;
      }
      const v = Number(days[key]);
      if (!Number.isInteger(v) || v < 1 || v > 3650) {
        return res
          .status(400)
          .json({ message: `${key} must be an integer number of days (1-3650) or null` });
      }
      doc.days[key] = v;
    }
  }
  if (scorecardAggregatesMonths !== undefined) {
    const v = scorecardAggregatesMonths === null ? null : Number(scorecardAggregatesMonths);
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > 120)) {
      return res.status(400).json({ message: "scorecardAggregatesMonths must be 1-120 or null" });
    }
    doc.scorecardAggregatesMonths = v;
  }
  if (enabled !== undefined) doc.enabled = Boolean(enabled);
  if (isApproved !== undefined) doc.isApproved = Boolean(isApproved);
  if (note !== undefined) doc.note = String(note).slice(0, 500);
  doc.updatedBy = req.user._id;
  await doc.save();

  await audit(req, {
    action: "RETENTION_SETTINGS_UPDATED",
    targetType: "RetentionSettings",
    targetId: doc._id,
    meta: { enabled: doc.enabled, isApproved: doc.isApproved, days: doc.days },
  });
  res.json(doc);
};

// --- Permission matrix (Priority 10) -----------------------------------

exports.getPermissions = async (req, res) => {
  const matrix = await permissions.effectiveMatrix();
  const doc = await PermissionSettings.getOrCreate();
  res.json({
    roles: matrix.roles,
    policy: matrix.policy,
    overrides: doc.overrides,
    version: doc.version,
    // The hard requirements the API refuses to override.
    nonNegotiable: [
      "EMPLOYEE scope is own-data-only",
      "MANAGER scope is always department-limited",
      "live-view session logs are Super Admin only",
      "screenshots stay disabled for every role (v1 is live view only)",
      "no keystroke, screen-content, webcam or audio collection",
      "the AI assistant is read-only and never mutates a task",
    ],
    note:
      "Live-view role scope is configurable here pending the client decision (Section 12), so the permission matrix is data rather than code.",
  });
};

exports.updatePermissions = async (req, res) => {
  if (!(await requireSettingsAccess(req, res))) return;
  const { overrides } = req.body || {};
  const errors = permissions.validateOverrides(overrides);
  if (errors.length) {
    return res.status(400).json({ message: "Invalid permission overrides", errors });
  }

  const doc = await PermissionSettings.getOrCreate();
  doc.overrides = overrides || {};
  doc.version += 1;
  doc.updatedBy = req.user._id;
  await doc.save();

  await audit(req, {
    action: "PERMISSIONS_UPDATED",
    targetType: "PermissionSettings",
    targetId: doc._id,
    meta: { version: doc.version, overrides: doc.overrides },
  });

  const matrix = await permissions.effectiveMatrix();
  res.json({
    roles: matrix.roles,
    policy: matrix.policy,
    overrides: doc.overrides,
    version: doc.version,
  });
};

// --- Audit log (Priority 8) -------------------------------------------

exports.getAuditLog = async (req, res) => {
  if (!(await requireSettingsAccess(req, res))) return;
  const query = {};
  if (req.query.action) query.action = String(req.query.action).toUpperCase();
  if (req.query.actorId) query.actor = req.query.actorId;
  if (req.query.from || req.query.to) {
    query.at = {};
    if (req.query.from) query.at.$gte = new Date(req.query.from);
    if (req.query.to) query.at.$lte = new Date(req.query.to);
  }

  const rows = await AuditLog.find(query)
    .populate("actor", "name role")
    .sort({ at: -1 })
    .limit(Math.min(200, Number(req.query.limit) || 50));

  res.json(
    rows.map((r) => ({
      id: r._id,
      at: r.at,
      action: r.action,
      actorName: r.actor ? r.actor.name : "system",
      actorRole: r.actorRole,
      targetType: r.targetType,
      targetId: r.targetId,
      meta: r.meta,
    }))
  );
};
// --- User administration (Priority 10) --------------------------------

exports.updateUser = async (req, res) => {
  if (!(await requireSettingsAccess(req, res))) return;
  const target = await require("../models/User").findById(req.params.userId).select("-passwordHash");
  if (!target) return res.status(404).json({ message: "User not found" });

  const { role, department, timezone, reducedMonitoring, isActive, whatsappNumber, liveViewEnabled } =
    req.body || {};

  const before = {
    role: target.role,
    department: target.department,
    timezone: target.timezone,
    reducedMonitoring: target.reducedMonitoring,
    isActive: target.isActive,
    liveViewEnabled: target.liveViewEnabled,
  };

  if (role !== undefined) {
    if (!["SUPER_ADMIN", "MANAGER", "EMPLOYEE"].includes(role)) {
      return res.status(400).json({ message: "role must be SUPER_ADMIN, MANAGER or EMPLOYEE" });
    }
    target.role = role;
  }
  if (department !== undefined) target.department = String(department).slice(0, 80);
  if (timezone !== undefined) {
    if (!isValidTimeZone(timezone)) {
      return res
        .status(400)
        .json({ message: "timezone must be a valid IANA zone, e.g. America/Chicago" });
    }
    target.timezone = timezone;
  }
  if (reducedMonitoring !== undefined) target.reducedMonitoring = Boolean(reducedMonitoring);
  if (isActive !== undefined) target.isActive = Boolean(isActive);
  if (whatsappNumber !== undefined) target.whatsappNumber = String(whatsappNumber).slice(0, 32);
  if (liveViewEnabled !== undefined) {
    target.liveViewEnabled = liveViewEnabled === null ? null : Boolean(liveViewEnabled);
  }

  await target.save();

  const after = {
    role: target.role,
    department: target.department,
    timezone: target.timezone,
    reducedMonitoring: target.reducedMonitoring,
    isActive: target.isActive,
    liveViewEnabled: target.liveViewEnabled,
  };

  await audit(req, {
    action: "USER_UPDATED",
    targetType: "User",
    targetId: target._id,
    meta: { before, after },
  });

  res.json({ id: target._id, name: target.name, email: target.email, ...after });
};