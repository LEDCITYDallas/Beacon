const mongoose = require("mongoose");

// Approval-gated outbound message (Section 5 + docs/approval-gates.md
// rows 3 and 5). A draft/notification only becomes a send after an
// explicit human confirm. Nothing is transmitted while status is PENDING.
//
// channel: WHATSAPP | EMAIL
// kind:    HANDOFF | DRAFT_MESSAGE
const messageProposalSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ["WHATSAPP", "EMAIL"], required: true },
    kind: {
      type: String,
      enum: ["HANDOFF", "DRAFT_MESSAGE"],
      required: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    relatedTask: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
    body: { type: String, required: true },
    status: {
      type: String,
      enum: ["PENDING", "SENT", "DECLINED"],
      default: "PENDING",
    },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

messageProposalSchema.index({ createdBy: 1, status: 1 });

module.exports = mongoose.model("MessageProposal", messageProposalSchema);
