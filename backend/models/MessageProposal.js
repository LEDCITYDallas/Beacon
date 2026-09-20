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
    // Who made the human decision, and what the delivery adapter actually did.
    // A PENDING row is never transmitted; `delivery.status` records the real
    // outcome once an adapter runs, so an approval is not mistaken for a send.
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    declinedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    delivery: {
      driver: { type: String, default: "" }, // mock | smtp | http | whatsapp_cloud
      status: {
        type: String,
        enum: ["", "SENT", "SIMULATED", "FAILED", "SKIPPED_NO_ADDRESS"],
        default: "",
      },
      providerMessageId: { type: String, default: "" },
      attemptedAt: { type: Date, default: null },
      error: { type: String, default: "" },
    },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

messageProposalSchema.index({ createdBy: 1, status: 1 });
messageProposalSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("MessageProposal", messageProposalSchema);
