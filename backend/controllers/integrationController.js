const IntegrationSignal = require("../models/IntegrationSignal");
const adapters = require("../services/integrations/adapters");
const scanner = require("../services/integrations/signalScanner");
const config = require("../config/env");
const { audit } = require("../utils/audit");

// ---------------------------------------------------------------------
// Integration controller (Priority 6).
//
// Managers and Super Admins can see integration status, run a scan and review
// the evidence trail. Employees cannot - a scan is a management action that
// reads systems they may not be authorised for, and it raises proposals on
// other people's tasks.
//
// The scan NEVER completes a task: it only creates completion proposals.
// ---------------------------------------------------------------------

function canManageIntegrations(req) {
  return req.user.role === "MANAGER" || req.user.role === "SUPER_ADMIN";
}

exports.getStatus = async (req, res) => {
  if (!canManageIntegrations(req)) {
    return res.status(403).json({ message: "Managers and administrators only" });
  }

  const sources = adapters.describeSources();
  const lastScan = await IntegrationSignal.findOne({ scannedBy: { $ne: null } })
    .sort({ scannedAt: -1 })
    .select("scannedAt source action");

  res.json({
    driver: adapters.driverLabel(),
    productionWiring:
      "Set INTEGRATIONS_DRIVER=live and add the ZOHO_* / WORKDRIVE_* / CMS_* OAuth tokens (docs/integration-wiring.md). Until then every source reads labelled mock data.",
    sources,
    lastScanAt: lastScan ? lastScan.scannedAt : null,
    requiresHumanConfirmation: true,
    note:
      "Signals can only raise a completion proposal. The assignee confirms before a task closes (Section 4).",
  });
};

exports.runScan = async (req, res) => {
  if (!canManageIntegrations(req)) {
    return res.status(403).json({ message: "Managers and administrators only" });
  }

  const sinceHours = Math.min(24 * 14, Math.max(1, Number(req.body?.sinceHours) || 24));
  const since = new Date(Date.now() - sinceHours * 3600 * 1000);
  const sources = Array.isArray(req.body?.sources) && req.body.sources.length ? req.body.sources : undefined;

  const summary = await scanner.scanForCompletions({ actor: req.user, since, sources });
  res.json(summary);
};

// Evidence trail. Scoped: a manager sees their department's signals, the Super
// Admin sees everything.
exports.listSignals = async (req, res) => {
  if (!canManageIntegrations(req)) {
    return res.status(403).json({ message: "Managers and administrators only" });
  }

  const query = {};
  if (req.query.source) query.source = String(req.query.source).toUpperCase();
  if (req.query.action) query.action = String(req.query.action).toUpperCase();
  if (req.query.taskId) query.task = req.query.taskId;
  if (req.query.since) query.scannedAt = { $gte: new Date(req.query.since) };

  const rows = await IntegrationSignal.find(query)
    .populate("task", "title department status")
    .populate("employee", "name department")
    .sort({ scannedAt: -1 })
    .limit(Math.min(200, Number(req.query.limit) || 50));

  const scoped =
    req.user.role === "MANAGER"
      ? rows.filter((r) => r.task && r.task.department === req.user.department)
      : rows;

  res.json({
    driver: config.integrations.driver,
    returned: scoped.length,
    signals: scoped.map((r) => ({
      id: r._id,
      source: r.source,
      driver: r.driver,
      externalId: r.externalId,
      type: r.type,
      title: r.title,
      summary: r.summary,
      evidenceUrl: r.evidenceUrl,
      occurredAt: r.occurredAt,
      action: r.action,
      matchConfidence: r.matchConfidence,
      matchReason: r.matchReason,
      error: r.error,
      task: r.task ? { id: r.task._id, title: r.task.title, status: r.task.status } : null,
      employee: r.employee ? { id: r.employee._id, name: r.employee.name } : null,
      scannedAt: r.scannedAt,
    })),
  });
};

// A manager/admin may also raise a proposal manually when they see outside
// evidence (a phone call, a signed document) - still a proposal, never a close.
exports.proposeManually = async (req, res) => {
  if (!canManageIntegrations(req)) {
    return res.status(403).json({ message: "Managers and administrators only" });
  }
  const Task = require("../models/Task");
  const { taskId, summary, evidenceUrl, source } = req.body || {};
  if (!taskId) return res.status(400).json({ message: "taskId is required" });
  if (!summary || !String(summary).trim()) {
    return res.status(400).json({ message: "A short description of the evidence is required" });
  }

  const task = await Task.findById(taskId);
  if (!task) return res.status(404).json({ message: "Task not found" });
  if (req.user.role === "MANAGER" && task.department !== req.user.department) {
    return res.status(403).json({ message: "Outside your department" });
  }
  if (task.status === "COMPLETED") {
    return res.status(400).json({ message: "Task is already completed" });
  }

  const outcome = await scanner.proposeFromSignal({
    task,
    signal: {
      source: (source || "MANUAL_EVIDENCE").toUpperCase(),
      externalId: "",
      type: "MANUAL_EVIDENCE",
      title: String(summary).slice(0, 200),
      summary: String(summary).slice(0, 500),
      evidenceUrl: String(evidenceUrl || "").slice(0, 500),
      occurredAt: new Date(),
    },
    confidence: 1,
    reason: `manual evidence recorded by ${req.user.name}`,
    actor: req.user,
    driver: "manual",
  });

  await audit(req, {
    action: "INTEGRATION_SCAN_RUN",
    targetType: "Task",
    targetId: task._id,
    meta: { manual: true, outcome: outcome.action },
  });

  res.json({
    outcome: outcome.action,
    taskId: task._id,
    requiresHumanConfirmation: true,
    message:
      "Evidence recorded. The assignee sees it on the task and decides whether to confirm completion.",
  });
};