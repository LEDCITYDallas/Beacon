const mongoose = require("mongoose");

// Section 4: timer tied to the task itself (start/pause/stop), separate
// from clock-in/out. Each segment is one row; actual hours = sum of
// durations for a task.
const timeLogSchema = new mongoose.Schema(
  {
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, default: null }, // null = currently running segment
    durationSeconds: { type: Number, default: 0 },
  },
  { timestamps: true }
);

timeLogSchema.index({ task: 1, employee: 1 });

module.exports = mongoose.model("TimeLog", timeLogSchema);
