const mongoose = require("mongoose");

// ActivityLog (Priority 2 - real idle/AFK detection, Section 6).
//
// HARD SCOPE (non-negotiable per Sections 6/9): this model records activity
// STATE only - a kind, a timestamp, and how long the machine has been idle.
// No keystrokes, no key contents, no window titles, no screen content, no
// screenshots, no webcam, no audio. Ever.
//
// kinds:
//   ACTIVITY  - permitted input (mouse/keyboard/touch) was seen within the
//               idle window; `resumedFromIdle` marks the return to Active
//   IDLE      - no input for >= the configured window (15-20 min, Section 6)
//   HEARTBEAT - the client is alive but sent no idle information (older client
//               or the OS agent could not read idle time). Treated as presence
//               with UNKNOWN activity confidence, never as proof of work.
const ACTIVITY_KINDS = ["ACTIVITY", "IDLE", "HEARTBEAT"];
const ACTIVITY_SOURCES = ["BROWSER", "OS_AGENT", "SERVER"];

const activityLogSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, required: true, default: Date.now },
    kind: { type: String, enum: ACTIVITY_KINDS, default: "HEARTBEAT" },
    // Only the NUMBER of idle seconds - never what the user did.
    idleSeconds: { type: Number, default: null },
    idleThresholdMinutes: { type: Number, default: null },
    source: { type: String, enum: ACTIVITY_SOURCES, default: "BROWSER" },
    resumedFromIdle: { type: Boolean, default: false },
    visibility: { type: String, default: "" }, // "visible" | "hidden"
    // Uninstall/agent metadata: lets a monitoring client reconnect after a
    // network drop without creating phantom idle/active records.
    clientId: { type: String, default: "" },
  },
  { timestamps: true }
);

activityLogSchema.index({ employee: 1, at: -1 });
activityLogSchema.index({ employee: 1, kind: 1, at: -1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema);
module.exports.ACTIVITY_KINDS = ACTIVITY_KINDS;
module.exports.ACTIVITY_SOURCES = ACTIVITY_SOURCES;

