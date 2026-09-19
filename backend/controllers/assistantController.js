const assistantService = require("../services/ai/assistantService");
const MessageProposal = require("../models/MessageProposal");
const Task = require("../models/Task");
const mongoose = require("mongoose");

function isValidObjectId(id) {
  return typeof id === "string" && mongoose.Types.ObjectId.isValid(id);
}

// Section 5 feature 3: on-demand Q&A. Read-only, no approval needed
// (approval-gates matrix row 1). Scoped to the requester's own data.
exports.ask = async (req, res) => {
  const { question } = req.body;
  if (!question || !String(question).trim()) {
    return res.status(400).json({ message: "question is required" });
  }
  const answer = await assistantService.answerQuestion(req.user, String(question).slice(0, 2000));
  res.json(answer);
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

  const result = await assistantService.draftWorkProduct(
    req.user,
    kind,
    String(request).slice(0, 2000)
  );

  // A draft becomes a MessageProposal only when the employee chooses to
  // queue it for sending - handled by propose-send below.
  res.json({ draft: result.text, provider: result.provider, model: result.model });
};

// Queue a draft/handoff for sending. Creates a PENDING proposal - nothing
// is transmitted yet (approval-gates matrix row 3/5).
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

  const proposal = await MessageProposal.create({
    channel,
    kind,
    createdBy: req.user._id,
    recipient: recipientId || null,
    relatedTask: taskId || null,
    body: String(body).slice(0, 4000),
    status: "PENDING",
  });

  res.status(201).json(proposal);
};

// The approval step: only the proposal's creator can confirm/decline, and
// only while it is PENDING. Actual transmission is a Phase 5/6 delivery
// adapter (WhatsApp Cloud API / SMTP) - until those exist, SENT records the
// human approval and marks what WOULD have gone out; nothing leaves the
// system without the further wiring Omair controls.
exports.confirmSend = async (req, res) => {
  const proposal = await MessageProposal.findById(req.params.id);
  if (!proposal) return res.status(404).json({ message: "Proposal not found" });
  if (String(proposal.createdBy) !== String(req.user._id)) {
    return res.status(403).json({ message: "Only the creator can confirm this proposal" });
  }
  if (proposal.status !== "PENDING") {
    return res.status(400).json({ message: `Proposal is already ${proposal.status}` });
  }

  // TODO Phase 5/6: hand to the real WhatsApp/email delivery adapter here.
  proposal.status = "SENT";
  proposal.sentAt = new Date();
  await proposal.save();

  res.json(proposal);
};

exports.declineSend = async (req, res) => {
  const proposal = await MessageProposal.findById(req.params.id);
  if (!proposal) return res.status(404).json({ message: "Proposal not found" });
  if (String(proposal.createdBy) !== String(req.user._id)) {
    return res.status(403).json({ message: "Only the creator can decline this proposal" });
  }
  if (proposal.status !== "PENDING") {
    return res.status(400).json({ message: `Proposal is already ${proposal.status}` });
  }

  proposal.status = "DECLINED";
  await proposal.save();
  res.json(proposal);
};

// My pending proposals (so the UI can show the approval queue).
exports.myProposals = async (req, res) => {
  const proposals = await MessageProposal.find({ createdBy: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50);
  res.json(proposals);
};
