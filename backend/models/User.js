const mongoose = require("mongoose");

const ROLES = ["SUPER_ADMIN", "MANAGER", "EMPLOYEE"];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true, default: "EMPLOYEE" },
    department: { type: String, default: "Unassigned" },

    // Section 3: reduced-monitoring roles never get screenshots, activity/idle
    // tracking only. Live-view scope for these roles is still an open
    // decision from the client (Section 12) - default false until confirmed.
    reducedMonitoring: { type: Boolean, default: false },

    // Section 8: per-employee timezone support (Dallas + overseas staff)
    timezone: { type: String, default: "Asia/Karachi" },

    // Section 9: consent gate - hard requirement, not just policy text.
    // A user cannot use the system (beyond viewing the consent screen)
    // until this is true.
    consentAccepted: { type: Boolean, default: false },
    consentAcceptedAt: { type: Date, default: null },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
module.exports.ROLES = ROLES;
