const assistantService = require("../services/ai/assistantService");
const aiProvider = require("../services/ai/provider");
const MessageProposal = require("../models/MessageProposal");
const Task = require("../models/Task");
const delivery = require("../services/delivery");
const { audit } = require("../utils/audit");
const mongoose = require("mongoose");

// ---------------------------------------------------------------------
// AI assistant endpoints (Priority 1 / Section 5).
//
// Approval gates are enforced HERE, in the backend, not only in the UI
// (docs/approval-gates.md):
//   - /ask and /next-up are read-only
//   - /draft returns text and stores nothing as "sent"
//   - /messages creates a PENDING proposal; the explicit /confirm routes are
//     the only path that can transmit, and they call the delivery adapter
//   - completion is never touched by the assistant (no code path exists)
//
// Provider failures are mapped to safe, specific responses instead of a 500
// with an internal message.
// ---------------------------------------------------------------------

function isValidObjectId(id) {
  return typeof id === "string" && mongoose.Types.ObjectId.isValid(id);
}

// Page keys the frontend may send. The label is what the model sees.
// Anything else is dropped — a client cannot invent a privileged screen.
const SCREEN_PAGES = {
  home: "Home (my tasks)",
  assistant: "Assistant",
  scorecard: "My scorecard",
  team: "Team queue",
  "team-scorecard": "Team scorecard",
  liveview: "Live view",
  admin: "Administration",
};

const MAX_HISTORY = 8;
const MAX_TURN_CHARS = 1500;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function sanitizeHistory(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw badRequest("history must be an array");
  if (raw.length > MAX_HISTORY) {
    throw badRequest(`history is limited to the last ${MAX_HISTORY} turns`);
  }
  return raw.map((turn, index) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
      throw badRequest(`history[${index}] is invalid`);
    }
    const role = turn.role === "assistant" || turn.role === "user" ? turn.role : "";
    const content = typeof turn.content === "string" ? turn.content.trim() : "";
    if (!role || !content) {
      throw badRequest(`history[${index}] must be a user or assistant message`);
    }
    return { role, content: content.slice(0, MAX_TURN_CHARS) };
  });
}

function sanitizeScreen(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const pageKey = typeof raw.page === "string" ? raw.page.trim().slice(0, 40) : "";
  const page = SCREEN_PAGES[pageKey] || "";
  let error = "";
  if (typeof raw.error === "string") {
    error = raw.error.replace(/[\u0000-\u001F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  }
  if (!page && !error) return null;
  return { page: page || "unspecified screen", error };
}

function aiFailure(res, err) {
  const code = err.code || "AI_PROVIDER_ERROR";
  const status = err.status && err.status >= 400 ? err.status : 502;
  const messages = {
    AI_NOT_CONFIGURED:
      "The assistant is not configured on the server yet. An administrator must add the provider key.",
    AI_TIMEOUT: "The assistant took too long to respond. Try again in a moment.",
    AI_RATE_LIMITED: "The AI provider is temporarily rate limiting us. Try again shortly.",
    AI_USAGE_LIMIT: err.message,
    AI_AUTH_FAILED: "The assistant is misconfigured (provider rejected the key). An administrator must fix it.",
    AI_INVALID_RESPONSE: "The assistant returned an unusable response. Try again.",
    AI_REQUEST_REJECTED: "The assistant request was rejected by the provider.",
  };
  return res.status(status).json({
    message: messages[code] || "The assistant could not answer right now. Try again.",
    code,
  });
}

// Section 5 feature 3: on-demand Q&A. Read-only, no approval needed
// (approval-gates matrix row 1). Scoped to the requester's own permissions.
exports.ask = async (req, res) => {
  const { question } = req.body || {};
  if (!question || !String(question).trim()) {
    return res.status(400).json({ message: "question is required" });
  }
  let history;
  let screen;
  try {
    // userId, role, and department on the body are ignored. Scope comes from req.user.
    history = sanitizeHistory(req.body.history);
    screen = sanitizeScreen(req.body.screen);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
  try {
    const answer = await assistantService.answerQuestion(req.user, String(question).slice(0, 2000), {
      history,
      screen,
    });
    res.json({
      text: answer.text,
      provider: answer.provider,
      model: answer.model,
      fallback: Boolean(answer.fallback),
      usage: answer.usage,
      approvalRequired: false,
      note: "Read-only answer from your own task data. The assistant cannot change anything.",
    });
  } catch (err) {
    return aiFailure(res, err);
  }
};

// Section 5 feature 1: personalised next-up assistance. Deterministic ranking
// over the employee's own task + dependency data, explained per item.
exports.nextUp = async (req, res) => {
  const queue = await assistantService.nextUpQueue(req.user, {
    limit: Math.min(10, Math.max(1, Number(req.query.limit) || 5)),
  });
  res.json(queue);
};

// Section 5 feature 4: drafting. Produces text only - nothing is sent
// (approval-gates matrix row 2).
exports.draft = async (req, res) => {
  const { kind, request } = req.body;
  const kinds = ["REPLY", "STATUS_UPDATE", "SUMMARY"];
  if (!kinds.includes(kind)) {
    return res.status(400).json({ message: `kind must be one of ${kinds.join(", ")}` });
  }
  if (!request || !String(request).trim()) {
    return res.status(400).json({ message: "request is required" });
  }

  try {
    const result = await assistantService.draftWorkProduct(
      req.user,
      kind,
      String(request).slice(0, 2000)
    );
    res.json({
      draft: result.text,
      provider: result.provider,
      model: result.model,
      fallback: Boolean(result.fallback),
      usage: result.usage,
      approvalRequired: true,
      note: "Draft only - it is not stored or sent. Queue it for sending and approve it explicitly.",
    });
  } catch (err) {
    return aiFailure(res, err);
  }
};

// A generated summary of the requester's own work (Section 5: summaries).
exports.summary = async (req, res) => {
  try {
    const result = await assistantService.summarizeWork(req.user);
    res.json({
      summary: result.text,
      provider: result.provider,
      model: result.model,
      fallback: Boolean(result.fallback),
      usage: result.usage,
      approvalRequired: false,
    });
  } catch (err) {
    return aiFailure(res, err);
  }
};

// Provider + usage visibility for the account holder (never any key value).
exports.providerInfo = async (req, res) => {
  const info = aiProvider.describeProvider();
  res.json({
    ...info,
    // Never echo the key - only whether one exists.
    apiKeySet: Boolean(aiProvider.isConfigured(info.provider)) && info.provider !== "mock",
    liveAnswers: info.live,
  });
};

// Queue a draft/handoff for sending. Creates a PENDING proposal - nothing is
// transmitted yet (approval-gates matrix rows 3/5).
exports.proposeSend = async (req, res) => {
  const { channel, kind, body, recipientId, taskId } = req.body;

  if (!["WHATSAPP", "EMAIL"].includes(channel)) {
    return res.status(400).json({ message: "channel must be WHATSAPP or EMAIL" });
  }
  if (!["HANDOFF", "DRAFT_MESSAGE"].includes(kind)) {
    return res.status(400).json({ message: "kind must be HANDOFF or DRAFT_MESSAGE" });
  }
  if (!body || !String(body).trim()) {
    return res.status(400).json({ message: "body is required" });
  }
  if (recipientId && !isValidObjectId(recipientId)) {
    return res.status(400).json({ message: "recipientId must be a valid user id" });
  }
  if (taskId && !isValidObjectId(taskId)) {
    return res.status(400).json({ message: "taskId must be a valid task id" });
  }

  // A non-manager can only address a teammate connected to their own work;
  // otherwise a proposal could be used to message anyone at will.
  if (recipientId) {
    const recipient = await Task.db
      .model("User")
      .findById(recipientId)
      .select("_id department");
    if (!recipient) return res.status(400).json({ message: "Recipient not found" });
    const allowed =
      req.user.role === "SUPER_ADMIN" ||
      recipient.department === req.user.department ||
      recipientId === String(req.user._id);
    if (!allowed) {
      return res.status(403).json({ message: "You can only message people in your own department" });
    }
  }

  const proposal = await MessageProposal.create({
    channel,
    kind,
    createdBy: req.user._id,
    recipient: recipientId || null,
    relatedTask: taskId || null,
    body: String(body).slice(0, 4000),
    status: "PENDING",
  });

  res.status(201).json({
    ...proposal.toObject(),
    requiresApproval: true,
    note: "Pending approval. Nothing is transmitted until a human confirms (approval-gates row 3/5).",
  });
};

// docs/approval-gates.md row 5: the creator, a manager of the related task's
// department, or a Super Admin may decide a proposal. Everyone else -
// including unrelated employees - gets 403.
async function canDecide(user, proposal) {
  if (String(proposal.createdBy) === String(user._id)) return true;
  if (user.role === "SUPER_ADMIN") return true;
  if (user.role === "MANAGER" && proposal.relatedTask) {
    const t = await Task.findById(proposal.relatedTask).select("department");
    if (t && t.department === user.department) return true;
  }
  return false;
}

// The approval step: creator/manager/admin, and only while PENDING. On confirm
// the message is handed to the REAL delivery adapter, and the outcome is
// recorded separately from the approval.
exports.confirmSend = async (req, res) => {
  const proposal = await MessageProposal.findById(req.params.id);
  if (!proposal) return res.status(404).json({ message: "Proposal not found" });
  if (!(await canDecide(req.user, proposal))) {
    return res.status(403).json({ message: "You cannot approve this proposal" });
  }
  if (proposal.status !== "PENDING") {
    return res.status(400).json({ message: `Proposal is already ${proposal.status}` });
  }

  const { delivery: outcome } = await delivery.deliverProposal(proposal, { sentBy: req.user._id });

  proposal.status = "SENT";
  proposal.sentAt = new Date();
  proposal.approvedBy = req.user._id;
  proposal.decidedAt = new Date();
  await proposal.save();

  await audit(req, {
    action: "MESSAGE_PROPOSAL_CONFIRMED",
    targetType: "MessageProposal",
    targetId: proposal._id,
    meta: { channel: proposal.channel, kind: proposal.kind, delivery: outcome },
  });

  res.json({
    ...proposal.toObject(),
    deliveryOutcome: outcome,
    note:
      outcome.status === "SIMULATED"
        ? "Approved and recorded. The delivery driver is mock, so nothing left the machine yet."
        : outcome.status === "SENT"
          ? "Approved and transmitted."
          : "Approved, but transmission did not succeed - see deliveryOutcome.error.",
  });
};

exports.declineSend = async (req, res) => {
  const proposal = await MessageProposal.findById(req.params.id);
  if (!proposal) return res.status(404).json({ message: "Proposal not found" });
  if (!(await canDecide(req.user, proposal))) {
    return res.status(403).json({ message: "You cannot decline this proposal" });
  }
  if (proposal.status !== "PENDING") {
    return res.status(400).json({ message: `Proposal is already ${proposal.status}` });
  }

  proposal.status = "DECLINED";
  proposal.declinedBy = req.user._id;
  proposal.decidedAt = new Date();
  await proposal.save();

  await audit(req, {
    action: "MESSAGE_PROPOSAL_DECLINED",
    targetType: "MessageProposal",
    targetId: proposal._id,
    meta: { channel: proposal.channel, kind: proposal.kind },
  });

  res.json(proposal);
};

// The approval queue: own proposals, plus - for managers - pending items on
// tasks in their department, and everything for the Super Admin (row 5).
exports.myProposals = async (req, res) => {
  let filter = { createdBy: req.user._id };

  if (req.user.role === "SUPER_ADMIN") {
    filter = {};
  } else if (req.user.role === "MANAGER") {
    const deptTaskIds = await Task.find({ department: req.user.department }).select("_id");
    filter = {
      $or: [
        { createdBy: req.user._id },
        { relatedTask: { $in: deptTaskIds.map((t) => t._id) } },
      ],
    };
  }

  const proposals = await MessageProposal.find(filter)
    .populate("recipient", "name department")
    .sort({ createdAt: -1 })
    .limit(50);

  res.json(
    proposals.map((p) => ({
      ...p.toObject(),
      recipientName: p.recipient ? p.recipient.name : "",
      requiresApproval: p.status === "PENDING",
    }))
  );
};