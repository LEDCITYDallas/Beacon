const mongoose = require("mongoose");

// ---------------------------------------------------------------------
// IntegrationSignal (Priority 6 / Section 4).
//
// One row per external signal read from Zoho CRM / Zoho Books / Zoho
// Inventory / WorkDrive / the LED City website CMS, and what the mapper did
// with it. This is the EVIDENCE TRAIL that lets a reviewer answer "why did the
// system propose this task complete?" - the requirement is explicit that the
// reviewer must be able to see the source and the evidence.
//
// action: PROPOSED_COMPLETION (raised a proposal, nothing closed)
//         NO_MATCH (signal read, no task matched)
//         IGNORED (duplicate of an already-pending proposal)
//         ERROR (adapter/mapping failure)
// No external credential, token or PII payload is stored here.
// ---------------------------------------------------------------------
const integrationSignalSchema = new mongoose.Schema(
  {
    source: { type: String, required: true }, // ZOHO_CRM | ZOHO_BOOKS | ...
    driver: { type: String, default: "mock" }, // mock | live
    externalId: { type: String, default: "" },
    type: { type: String, default: "" },
    title: { type: String, default: "" },
    summary: { type: String, default: "" },
    evidenceUrl: { type: String, default: "" },
    occurredAt: { type: Date, default: null },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
    matchConfidence: { type: Number, default: 0 },
    matchReason: { type: String, default: "" },
    action: {
      type: String,
      enum: ["PROPOSED_COMPLETION", "NO_MATCH", "IGNORED", "ERROR"],
      default: "NO_MATCH",
    },
    error: { type: String, default: "" },
    scannedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    scannedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

integrationSignalSchema.index({ scannedAt: -1 });
integrationSignalSchema.index({ task: 1, scannedAt: -1 });
integrationSignalSchema.index({ source: 1, externalId: 1 });

module.exports = mongoose.model("IntegrationSignal", integrationSignalSchema);