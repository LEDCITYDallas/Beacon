const mongoose = require("mongoose");

// ---------------------------------------------------------------------
// RetentionSettings (Priority 9 / Section 12).
//
// The exact retention period is an OPEN client decision. So this model ships
// with every duration set to `null` and `enabled: false`, and the cleanup job
// refuses to delete anything until Omair supplies approved numbers:
//
//   isApproved            - set true together with the durations
//   days.*                - null means "not decided"; the job skips that type
//   lastRunAt/lastRunStats- what the job actually did, for the audit trail
//
// Nothing here invents a period, and nothing deletes on a guess.
// ---------------------------------------------------------------------
const RETENTION_KEYS = [
  "activityLogs",
  "liveViewSessions",
  "notificationLogs",
  "aiUsageLogs",
  "decidedProposals",
  "integrationSignals",
];

const retentionSettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    isApproved: { type: Boolean, default: false },
    days: {
      activityLogs: { type: Number, default: null },
      liveViewSessions: { type: Number, default: null },
      notificationLogs: { type: Number, default: null },
      aiUsageLogs: { type: Number, default: null },
      decidedProposals: { type: Number, default: null },
      integrationSignals: { type: Number, default: null },
    },
    // Scorecard aggregates are not deleted by the job (business record);
    // this documents the retention decision for them.
    scorecardAggregatesMonths: { type: Number, default: null },
    note: { type: String, default: "" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    lastRunAt: { type: Date, default: null },
    lastRunStats: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

retentionSettingsSchema.statics.RETENTION_KEYS = RETENTION_KEYS;

retentionSettingsSchema.statics.getOrCreate = async function () {
  const doc = await this.findOne();
  if (doc) return doc;
  return this.create({});
};

module.exports = mongoose.model("RetentionSettings", retentionSettingsSchema);
module.exports.RETENTION_KEYS = RETENTION_KEYS;