const mongoose = require("mongoose");

// Weekly manager rating (Section 7 scorecard input). One rating per
// employee per ISO-ish week (stored by weekStart). 1-5 scale.
const ratingSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    weekStart: { type: Date, required: true }, // normalized Monday 00:00
    score: { type: Number, required: true, min: 1, max: 5 },
    note: { type: String, default: "" },
    ratedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

ratingSchema.index({ employee: 1, weekStart: 1 }, { unique: true });

module.exports = mongoose.model("Rating", ratingSchema);
