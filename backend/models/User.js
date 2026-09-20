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

    // Section 8: per-employee timezone support (Dallas + overseas staff).
    // Every timestamp is stored in UTC and rendered in this zone. The default
    // is the Dallas HQ zone, NOT an assumption about any individual employee -
    // each row is set explicitly in the seed / staff list (Section 12).
    timezone: { type: String, default: "America/Chicago" },

    // Notification routing. `whatsappNumber` is required for WhatsApp handoff
    // delivery; email falls back to `email` when `notifyEmail` is empty.
    // Numbers/addresses are personal data: they are never exposed to other
    // employees (see the scoped /api/users projection).
    whatsappNumber: { type: String, default: "" },
    notifyEmail: { type: String, default: "" },

    // Per-employee live-view switch. null = follow the role policy; false =
    // this person is never live-viewed even if their role allows it.
    liveViewEnabled: { type: Boolean, default: null },

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
