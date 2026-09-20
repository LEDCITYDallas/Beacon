const mongoose = require("mongoose");

// ---------------------------------------------------------------------
// PermissionSettings (Priority 10 / Section 3).
//
// The exact employee names, roles, departments and live-view scope are client
// decisions. So the permission matrix is DATA, not code:
//
//   - defaults live in services/permissions.js
//   - this model stores only the overrides the Super Admin applies through
//     PUT /api/admin/permissions
//   - effective matrix = defaults deep-merged with overrides
//
// Result: the client can change live-view scope (for example whether MANAGER
// is allowed, or whether reduced-monitoring roles are excluded) without a code
// change or a redeploy.
// ---------------------------------------------------------------------
const permissionSettingsSchema = new mongoose.Schema(
  {
    // Free-form override tree; validated key-by-key against the defaults in
    // services/permissions.js before saving.
    overrides: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    version: { type: Number, default: 1 },
  },
  { timestamps: true }
);

permissionSettingsSchema.statics.getOrCreate = async function () {
  const doc = await this.findOne();
  if (doc) return doc;
  return this.create({});
};

module.exports = mongoose.model("PermissionSettings", permissionSettingsSchema);