const mongoose = require("mongoose");

// One-time account setup and password reset secrets.
// Only the hash is stored. The raw token is returned once to the caller
// that is allowed to see it, and it is never written to the audit log.
const accessTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    purpose: { type: String, enum: ["SETUP", "RESET"], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AccessToken", accessTokenSchema);
