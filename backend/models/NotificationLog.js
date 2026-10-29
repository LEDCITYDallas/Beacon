const mongoose = require("mongoose");

// ---------------------------------------------------------------------
// NotificationLog (Priority 5 / Section 8).
//
// Records every outbound notification attempt - in-app, email or WhatsApp -
// including ones recorded while the delivery driver is still "mock". That
// gives three things the requirements ask for:
//   1. in-app alerts keep working even with no email/WhatsApp credentials;
//   2. the Super Admin can see exactly what was transmitted, when, by whom;
//   3. the delivery adapter is swappable without changing message generation.
//
// status: SENT (really transmitted) | SIMULATED (driver was mock - nothing
// left the machine) | QUEUED (in-app only) | FAILED (adapter error)
// ---------------------------------------------------------------------
const NOTIFICATION_KINDS = [
  "OVERDUE_ALERT",
  "BLOCKED_ALERT",
  "OVERRUN_ALERT",
  "DIGEST",
  "HANDOFF",
  "DRAFT_MESSAGE",
  "TASK_FLAGGED",
  "ACCOUNT_ACCESS",
];

const notificationLogSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ["IN_APP", "EMAIL", "WHATSAPP"], required: true },
    kind: { type: String, enum: NOTIFICATION_KINDS, required: true },

    // recipient is set when the target is a system user; recipientAddress
    // holds the email/phone actually used (needed for external recipients
    // like Omair's WhatsApp number, which is not a login account).
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    recipientAddress: { type: String, default: "" },

    subject: { type: String, default: "" },
    body: { type: String, default: "" },

    driver: { type: String, default: "mock" }, // mock | smtp | http | whatsapp_cloud
    status: {
      type: String,
      enum: ["SENT", "SIMULATED", "QUEUED", "FAILED"],
      default: "QUEUED",
    },
    error: { type: String, default: "" },
    providerMessageId: { type: String, default: "" },

    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, // null = system
    relatedTask: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
    proposal: { type: mongoose.Schema.Types.ObjectId, ref: "MessageProposal", default: null },
    sentAt: { type: Date, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

notificationLogSchema.index({ recipient: 1, createdAt: -1 });
notificationLogSchema.index({ kind: 1, createdAt: -1 });
notificationLogSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("NotificationLog", notificationLogSchema);
module.exports.NOTIFICATION_KINDS = NOTIFICATION_KINDS;