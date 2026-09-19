const mongoose = require("mongoose");

const TASK_STATUS = ["BLOCKED", "READY", "IN_PROGRESS", "PAUSED", "COMPLETED"];
const PRIORITY = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const BLOCKED_REASON_TYPES = ["WAITING_ON_OTHER", "NOT_CONFIDENT"];
const COMPLETION_SOURCE = ["MANUAL", "SYSTEM_DETECTED"];

const timelineEventSchema = new mongoose.Schema(
  {
    event: {
      type: String,
      enum: [
        "CREATED",
        "STARTED",
        "PAUSED",
        "RESUMED",
        "BLOCKED",
        "UNBLOCKED",
        "COMPLETION_PROPOSED", // Section 4: human-in-the-loop - system detected a
        // signal but has not finalized anything yet
        "COMPLETION_CONFIRMED",
        "COMPLETION_REJECTED",
        "OVERRUN_ALERT",
      ],
      required: true,
    },
    timestamp: { type: Date, default: Date.now },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, // null = system
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    definitionOfDone: { type: String, required: true },

    priority: { type: String, enum: PRIORITY, default: "MEDIUM" },
    estimatedHours: { type: Number, required: true, min: 0 },
    dueDate: { type: Date, required: true },

    department: { type: String, default: "Unassigned" },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // Dependency map (Section 4). This task is BLOCKED while any task in
    // `dependsOn` is not COMPLETED. On dependency completion, this flips
    // to READY automatically and the assignee is notified.
    dependsOn: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],

    status: { type: String, enum: TASK_STATUS, default: "READY" },

    blockedReason: {
      type: {
        type: String,
        enum: BLOCKED_REASON_TYPES,
        default: null,
      },
      note: { type: String, default: "" },
      setAt: { type: Date, default: null },
    },

    // Overrun alert (Section 4) - default threshold 120% of estimate,
    // configurable per task/org later.
    overrunThresholdPct: { type: Number, default: 120 },
    overrunAlertFired: { type: Boolean, default: false },

    // Completion detection (Section 4 - the core requirement). Phase 1/2
    // ships the manual path + the human-in-the-loop proposal structure.
    // Real Zoho/WorkDrive/CMS signal-reading is Phase 6 and plugs into
    // proposeCompletion() below - it never auto-finalizes.
    completionSource: { type: String, enum: COMPLETION_SOURCE, default: null },
    pendingCompletionProposal: {
      isPending: { type: Boolean, default: false },
      detectedSignal: { type: String, default: "" }, // e.g. "Zoho CRM: deal marked Won"
      proposedAt: { type: Date, default: null },
    },

    completedAt: { type: Date, default: null },

    timeline: [timelineEventSchema],
  },
  { timestamps: true }
);

taskSchema.index({ assignedTo: 1, status: 1 });
taskSchema.index({ dependsOn: 1 });

module.exports = mongoose.model("Task", taskSchema);
module.exports.TASK_STATUS = TASK_STATUS;
module.exports.PRIORITY = PRIORITY;
module.exports.BLOCKED_REASON_TYPES = BLOCKED_REASON_TYPES;
module.exports.COMPLETION_SOURCE = COMPLETION_SOURCE;
