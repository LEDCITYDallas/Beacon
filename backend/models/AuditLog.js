const mongoose = require("mongoose");

// ---------------------------------------------------------------------
// AuditLog (Priority 8 / Section 9).
//
// Every consequential administrative action is recorded: who did it, to what,
// when, and why. This is the record the Super Admin uses to answer "who viewed
// whose screen / who changed the score weights / who changed permissions".
//
// It deliberately stores no message bodies and no screen data.
// ---------------------------------------------------------------------
const AUDIT_ACTIONS = [
  "LIVEVIEW_REQUESTED",
  "LIVEVIEW_APPROVED",
  "LIVEVIEW_DENIED",
  "LIVEVIEW_ENDED",
  "LIVEVIEW_AUTO_ENDED",
  "SCORECARD_WEIGHTS_UPDATED",
  "SCORECARD_RATING_SET",
  "RETENTION_SETTINGS_UPDATED",
  "RETENTION_JOB_RUN",
  "PERMISSIONS_UPDATED",
  "USER_UPDATED",
  "NOTIFICATION_DISPATCHED",
  "DIGEST_DISPATCHED",
  "MESSAGE_PROPOSAL_CONFIRMED",
  "MESSAGE_PROPOSAL_DECLINED",
  "INTEGRATION_SCAN_RUN",
  "INTEGRATION_COMPLETION_PROPOSED",
  "CONSENT_ACCEPTED",
  "TASK_REOPENED",
  "TASK_FLAGGED",
  "TASK_COMPLETED",
];

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorRole: { type: String, default: "" },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    targetType: { type: String, default: "" }, // "User" | "Task" | "LiveViewSession" | ...
    targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Non-secret contextual detail (ids, counts, previous/new values).
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

auditLogSchema.index({ at: -1 });
auditLogSchema.index({ actor: 1, at: -1 });
auditLogSchema.index({ action: 1, at: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
module.exports.AUDIT_ACTIONS = AUDIT_ACTIONS;
