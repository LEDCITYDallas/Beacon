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

// docs/approval-gates.md row 5: the creator, a manager of the related
// task's department, or a Super Admin may decide a proposal. Everyone
// else - including unrelated employees - gets 403.
async function canDecide(user, proposal) {
  if (String(proposal.createdBy) === String(user._id)) return true;
  if (user.role === "SUPER_ADMIN") return true;
  if (user.role === "MANAGER" && proposal.relatedTask) {
    const t = await Task.findById(proposal.relatedTask).select("department");
    if (t && t.department === user.department) return true;
  }
  return false;
}

// The approval step: creator/manager/admin, and only while it is PENDING.
// Actual transmission is a Phase 5/6 delivery adapter (WhatsApp Cloud API /
// SMTP) - until those exist, SENT records the human approval and marks what
// WOULD have gone out; nothing leaves the system without the further wiring
// Omair controls.
exports.confirmSend = async (req, res) => {
  const proposal = await MessageProposal.findById(req.params.id);
  if (!proposal) return res.status(404).json({ message: "Proposal not found" });
  if (!(await canDecide(req.user, proposal))) {
    return res.status(403).json({ message: "You cannot approve this proposal" });
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
  if (!(await canDecide(req.user, proposal))) {
    return res.status(403).json({ message: "You cannot decline this proposal" });
  }
  if (proposal.status !== "PENDING") {
    return res.status(400).json({ message: `Proposal is already ${proposal.status}` });
  }

  proposal.status = "DECLINED";
  await proposal.save();
  res.json(proposal);
};

// The approval queue: own proposals, plus - for managers - pending items
// on tasks in their department, and everything for the Super Admin
// (docs/approval-gates.md row 5: manager/admin may decide department items).
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
    .sort({ createdAt: -1 })
    .limit(50);
  res.json(proposals);
};
