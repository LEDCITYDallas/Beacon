const mongoose = require("mongoose");

// ScorecardSettings (Section 7) - singleton.
//
// The scoring formula is finalized JOINTLY with Omair before any scorecard
// goes live; the contractor does not set weighting unilaterally. So this
// ships with the draft weights from docs/client-memo-open-decisions.md and
// isLive=false: reports render with a "draft - pending formula approval"
// banner until Omair flips it via PUT /api/scorecard/weights.
//
// Section 7 constraint enforced in the validator: activityIdlePct weight
// may never exceed 10 (never the dominant or sole factor).
const WEIGHT_KEYS = [
  "onTimePct",
  "managerRating",
  "estimateAccuracyPct",
  "tasksCompleted",
  "reworkPenalty",
  "activityIdlePct",
];

const scorecardSettingsSchema = new mongoose.Schema(
  {
    weights: {
      onTimePct: { type: Number, default: 30, min: 0, max: 100 },
      managerRating: { type: Number, default: 25, min: 0, max: 100 },
      estimateAccuracyPct: { type: Number, default: 20, min: 0, max: 100 },
      tasksCompleted: { type: Number, default: 15, min: 0, max: 100 },
      reworkPenalty: { type: Number, default: 10, min: 0, max: 100 },
      activityIdlePct: { type: Number, default: 0, min: 0, max: 10 },
    },
    isLive: { type: Boolean, default: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

scorecardSettingsSchema.statics.WEIGHT_KEYS = WEIGHT_KEYS;

scorecardSettingsSchema.statics.getOrCreate = async function () {
  const doc = await this.findOne();
  if (doc) return doc;
  return this.create({});
};

module.exports = mongoose.model("ScorecardSettings", scorecardSettingsSchema);
module.exports.WEIGHT_KEYS = WEIGHT_KEYS;
