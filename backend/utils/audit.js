const AuditLog = require("../models/AuditLog");

// ---------------------------------------------------------------------
// Audit helper (Priority 8).
//
// Auditing must never be able to break a user action, so failures are logged
// and swallowed. Call it AFTER the action succeeded, and never pass secrets,
// message bodies or screen data in `meta`.
// ---------------------------------------------------------------------
async function audit(req, { action, targetType = "", targetId = null, meta = {}, actor = null }) {
  try {
    const who = actor || (req && req.user) || null;
    await AuditLog.create({
      actor: who ? who._id : null,
      actorRole: who ? who.role : "SYSTEM",
      action,
      targetType,
      targetId,
      meta,
      ip: req ? String(req.ip || req.headers?.["x-forwarded-for"] || "").slice(0, 60) : "",
      at: new Date(),
    });
  } catch (err) {
    console.error("[audit] failed to write entry", action, err.message);
  }
}

module.exports = { audit };
