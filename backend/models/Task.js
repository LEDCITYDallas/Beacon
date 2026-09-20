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
        "TASK_FLAGGED", // Section 3: manager flags a task needing attention
        "TASK_UNFLAGGED",
        "TASK_REOPENED", // Section 7: rework/reopened count is a scorecard input
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

    // Section 3: managers can flag tasks (attention marker, not a status).
    flagged: { type: Boolean, default: false },
    flagNote: { type: String, default: "" },
    flaggedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    flaggedAt: { type: Date, default: null },

    // Section 7: rework tracking. Increments each time a completed task is
    // reopened; feeds the scorecard's rework/reopened-count input.
    reopenCount: { type: Number, default: 0 },

    // Completion detection (Section 4 - the core requirement).
    // Manual completion is always available; every non-manual path (Zoho,
    // WorkDrive, CMS signals) can only RAISE a proposal here. It never
    // finalizes - the assignee confirms (see confirmCompletion in
    // controllers/taskController.js).
    //
    // `evidence` exists so the reviewer can see WHY the system proposed the
    // task, per Section 4: source, external id, human-readable summary, the
    // link to the record, when it happened, and the match confidence.
    completionSource: { type: String, enum: COMPLETION_SOURCE, default: null },
    pendingCompletionProposal: {
      isPending: { type: Boolean, default: false },
      detectedSignal: { type: String, default: "" }, // e.g. "Zoho CRM: deal marked Won"
      proposedAt: { type: Date, default: null },
      proposedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      confidence: { type: Number, default: 0 }, // 0-1 from the signal mapper
      evidence: {
        source: { type: String, default: "" },
        externalId: { type: String, default: "" },
        summary: { type: String, default: "" },
        evidenceUrl: { type: String, default: "" },
        occurredAt: { type: Date, default: null },
      },
    },

    // Optional explicit link between a task and an external record, so signal
    // matching is exact instead of heuristic when Omair sets it up.
    externalRefs: [
      {
        source: { type: String, default: "" },
        externalId: { type: String, default: "" },
      },
    ],

    completedAt: { type: Date, default: null },

    timeline: [timelineEventSchema],
  },
  { timestamps: true }
);

taskSchema.index({ assignedTo: 1, status: 1 });
taskSchema.index({ dependsOn: 1 });
taskSchema.index({ department: 1, status: 1 });
taskSchema.index({ dueDate: 1, status: 1 });
taskSchema.index({ "pendingCompletionProposal.isPending": 1 });
taskSchema.index({ "externalRefs.source": 1, "externalRefs.externalId": 1 });

module.exports = mongoose.model("Task", taskSchema);
module.exports.TASK_STATUS = TASK_STATUS;
module.exports.PRIORITY = PRIORITY;
module.exports.BLOCKED_REASON_TYPES = BLOCKED_REASON_TYPES;
module.exports.COMPLETION_SOURCE = COMPLETION_SOURCE;
