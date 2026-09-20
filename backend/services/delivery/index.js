const NotificationLog = require("../../models/NotificationLog");
const User = require("../../models/User");
const emailAdapter = require("./emailAdapter");
const whatsappAdapter = require("./whatsappAdapter");
const config = require("../../config/env");

// ---------------------------------------------------------------------
// Delivery registry (Priority 5).
//
// One place that answers "how do I reach this person, and is that channel
// live right now?" Every send is recorded in NotificationLog, whatever the
// driver: that is what makes in-app alerts work with no credentials at all,
// and what lets the Super Admin see the real transmission record.
//
// Message GENERATION lives in services/notifications/composer.js. This module
// only transmits, so the wording can change without touching an adapter.
// ---------------------------------------------------------------------

function status() {
  return {
    masterSwitch: config.notifications.driver,
    email: emailAdapter.describe(),
    whatsapp: whatsappAdapter.describe(),
    digest: {
      timezone: config.notifications.digest.timezone,
      dayOfWeek: config.notifications.digest.dayOfWeek,
      hour: config.notifications.digest.hour,
      minute: config.notifications.digest.minute,
      sendEnabled: config.notifications.digest.enabled,
      omairWhatsAppSet: Boolean(config.notifications.digest.omairWhatsApp),
    },
  };
}

function emailFor(user) {
  if (!user) return "";
  return user.notifyEmail || user.email || "";
}

async function logNotification(entry) {
  try {
    return await NotificationLog.create(entry);
  } catch (err) {
    console.error("[delivery] failed to write notification log", err.message);
    return null;
  }
}

// In-app alert: always available, no credentials required (Section 8 requires
// in-app alerts to keep working).
async function sendInApp({ recipient, kind, subject, body, sentBy = null, relatedTask = null, meta = {} }) {
  return logNotification({
    channel: "IN_APP",
    kind,
    recipient: recipient && recipient._id ? recipient._id : recipient || null,
    recipientAddress: "",
    subject,
    body,
    driver: "in_app",
    status: "QUEUED",
    sentBy,
    relatedTask,
    meta,
  });
}

async function sendEmail({ recipient, to, kind, subject, body, sentBy = null, relatedTask = null, meta = {} }) {
  const address = to || emailFor(recipient);
  const result = await emailAdapter.send({ to: address, subject, text: body });
  return logNotification({
    channel: "EMAIL",
    kind,
    recipient: recipient && recipient._id ? recipient._id : recipient || null,
    recipientAddress: address || "",
    subject,
    body,
    driver: result.driver,
    status: result.status,
    error: result.error || "",
    providerMessageId: result.messageId || "",
    sentBy,
    relatedTask,
    sentAt: result.status === "SENT" ? new Date() : null,
    meta,
  });
}

async function sendWhatsApp({ recipient, to, kind, subject = "", body, sentBy = null, relatedTask = null, meta = {} }) {
  const number = to || (recipient && recipient.whatsappNumber) || "";
  const result = await whatsappAdapter.send({ to: number, text: body });
  return logNotification({
    channel: "WHATSAPP",
    kind,
    recipient: recipient && recipient._id ? recipient._id : recipient || null,
    recipientAddress: number || "",
    subject,
    body,
    driver: result.driver,
    status: result.status,
    error: result.error || "",
    providerMessageId: result.messageId || "",
    sentBy,
    relatedTask,
    sentAt: result.status === "SENT" ? new Date() : null,
    meta,
  });
}

// ---------------------------------------------------------------------
// Approval-gated send: turns an approved MessageProposal into a real
// transmission and records the OUTCOME separately from the approval.
//
// Called only from assistantController.confirmSend, i.e. only after a human
// pressed approve. A missing address is a first-class outcome, not a silent
// success, so an "approved" proposal can never be mistaken for a delivered one.
// ---------------------------------------------------------------------
async function deliverProposal(proposal, { sentBy } = {}) {
  const recipient = proposal.recipient
    ? await User.findById(proposal.recipient).select(
        "name email notifyEmail whatsappNumber timezone"
      )
    : null;

  const meta = {
    proposalId: String(proposal._id),
    kind: proposal.kind,
    channel: proposal.channel,
  };

  const log =
    proposal.channel === "WHATSAPP"
      ? await sendWhatsApp({
          recipient,
          kind: proposal.kind,
          body: proposal.body,
          sentBy,
          relatedTask: proposal.relatedTask,
          meta,
        })
      : await sendEmail({
          recipient,
          kind: proposal.kind,
          subject: `LED City workforce: ${proposal.kind === "HANDOFF" ? "handoff" : "message"}`,
          body: proposal.body,
          sentBy,
          relatedTask: proposal.relatedTask,
          meta,
        });

  proposal.delivery = {
    driver: log ? log.driver : "unknown",
    status: log ? log.status : "FAILED",
    providerMessageId: log ? log.providerMessageId : "",
    attemptedAt: new Date(),
    error: log ? log.error : "delivery log write failed",
  };

  if (log) {
    log.proposal = proposal._id;
    await log.save();
  }

  return { log, delivery: proposal.delivery, recipient };
}

// The Friday digest is transmitted through the same WhatsApp adapter. Delivery
// is off until the client enables it (DIGEST_SEND_ENABLED) or an address is
// passed explicitly - the generation/approval flow still runs and is logged.
async function sendDigestWhatsApp({ text, to, sentBy = null, meta = {} }) {
  const target = to || config.notifications.digest.omairWhatsApp;
  if (!config.notifications.digest.enabled && !to) {
    const log = await logNotification({
      channel: "WHATSAPP",
      kind: "DIGEST",
      recipientAddress: target || "",
      subject: "Weekly digest",
      body: text,
      driver: "disabled",
      status: "SIMULATED",
      error: "DIGEST_SEND_ENABLED is false - digest delivery is not switched on yet",
      sentBy,
      meta,
    });
    return { log, skipped: true };
  }
  const log = await sendWhatsApp({ to: target, kind: "DIGEST", body: text, sentBy, meta });
  return { log, skipped: false };
}

// Overrun / flagged task notifications go to the assignee and their manager.
async function sendAlertEmail({ recipient, kind, subject, body, sentBy, relatedTask, meta }) {
  return sendEmail({ recipient, kind, subject, body, sentBy, relatedTask, meta });
}

module.exports = {
  status,
  emailFor,
  logNotification,
  sendInApp,
  sendEmail,
  sendWhatsApp,
  deliverProposal,
  sendDigestWhatsApp,
  sendAlertEmail,
};