const mongoose = require("mongoose");

// ActivityLog (Section 6 - idle/AFK detection).
//
// HARD SCOPE (non-negotiable per Sections 6/9): this model records presence
// ONLY - one row per heartbeat with a timestamp. No keystrokes, no content,
// no screenshots, no window titles, no keylogging, no webcam/audio - ever.
// The idle window (15-20 min per Section 6) is enforced in
// controllers/activityController.js via IDLE_THRESHOLD_MINUTES.
const activityLogSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, required: true, default: Date.now },
    kind: { type: String, enum: ["HEARTBEAT"], default: "HEARTBEAT" },
  },
  { timestamps: true }
);

activityLogSchema.index({ employee: 1, at: -1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema);
