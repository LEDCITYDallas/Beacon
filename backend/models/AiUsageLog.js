const mongoose = require("mongoose");

// ---------------------------------------------------------------------
// AiUsageLog (Priority 1 - cost visibility, required by Section 5).
//
// One row per AI provider call, so the Super Admin can see the real spend
// forming instead of discovering it on a provider invoice. Token counts come
// from the provider response when available; the dollar figure is an estimate
// at published list prices (config/env.js holds the rates).
//
// No prompt or completion TEXT is stored here - only counts - so employee task
// content is not duplicated into a telemetry table.
// ---------------------------------------------------------------------
const aiUsageLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, default: "qa" }, // qa | draft | handoff | summary | next_up
    provider: { type: String, default: "mock" },
    model: { type: String, default: "" },
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    estCostUsd: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    ok: { type: Boolean, default: true },
    fallback: { type: Boolean, default: false }, // mock used because provider failed
    errorCode: { type: String, default: "" },
    dayKey: { type: String, default: "" }, // YYYY-MM-DD in the user's timezone
    at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

aiUsageLogSchema.index({ user: 1, at: -1 });
aiUsageLogSchema.index({ dayKey: 1 });
aiUsageLogSchema.index({ at: -1 });

module.exports = mongoose.model("AiUsageLog", aiUsageLogSchema);