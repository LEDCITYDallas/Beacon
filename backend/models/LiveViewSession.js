const mongoose = require("mongoose");

// ---------------------------------------------------------------------
// LiveViewSession (Priority 3 / Sections 6 + 9).
//
// Session LOG ONLY. The screen stream itself is never written to this model,
// to disk, or to any object store: frames live in a 5-second in-memory bus
// (services/liveview/frameBus.js) and are dropped when the session ends.
// There is no replay, no recording, no screenshot storage.
//
// Flow:  REQUESTED -> ACTIVE -> ENDED      (or DENIED / EXPIRED)
// Only roles in PermissionSettings.liveView.allowedRoles may create a
// session; the employee must approve before any frame may be sent.
// ---------------------------------------------------------------------
const LIVEVIEW_STATUS = ["REQUESTED", "ACTIVE", "DENIED", "ENDED", "EXPIRED"];

const liveViewSessionSchema = new mongoose.Schema(
  {
    viewer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: LIVEVIEW_STATUS, default: "REQUESTED" },
    reason: { type: String, default: "" },

    requestedAt: { type: Date, default: Date.now },
    employeeRespondedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    durationSeconds: { type: Number, default: 0 },
    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    endReason: { type: String, default: "" },

    // Counters only - no frame data, no thumbnails.
    framesServed: { type: Number, default: 0 },
    lastFrameAt: { type: Date, default: null },
  },
  { timestamps: true }
);

liveViewSessionSchema.index({ employee: 1, requestedAt: -1 });
liveViewSessionSchema.index({ viewer: 1, requestedAt: -1 });
liveViewSessionSchema.index({ status: 1, requestedAt: -1 });

module.exports = mongoose.model("LiveViewSession", liveViewSessionSchema);
module.exports.LIVEVIEW_STATUS = LIVEVIEW_STATUS;