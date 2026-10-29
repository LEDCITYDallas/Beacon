const User = require("../models/User");
const { audit } = require("../utils/audit");
const { isValidTimeZone } = require("../utils/timezone");

// ---------------------------------------------------------------------
// User directory (Priorities 7 + 10).
//
// This exists for two things the earlier phases were missing:
//   - a real assignee picker instead of raw ObjectIds
//   - per-employee timezone maintenance (Section 8)
//
// Authorization, in one place:
//   EMPLOYEE    -> 403. An employee has no reason to enumerate the workforce
//                  (it would leak who works there and in which department).
//   MANAGER     -> own department only, and never the other employees' contact
//                  details or monitoring flags beyond what a manager needs.
//   SUPER_ADMIN -> everyone.
// ---------------------------------------------------------------------

function publicShape(doc, { includeContact = false } = {}) {
  const out = {
    id: doc._id,
    name: doc.name,
    role: doc.role,
    department: doc.department,
    timezone: doc.timezone,
    isActive: doc.isActive,
  };
  if (includeContact) {
    out.email = doc.email;
    out.reducedMonitoring = doc.reducedMonitoring;
  }
  return out;
}

exports.listUsers = async (req, res) => {
  if (req.user.role === "EMPLOYEE") {
    return res.status(403).json({
      message: "The staff directory is available to managers and administrators only",
      code: "DIRECTORY_FORBIDDEN",
    });
  }

  const filter = {};
  if (req.user.role === "MANAGER") {
    // A manager is scoped to their own department, always (Section 3).
    filter.department = req.user.department;
  } else if (req.query.department) {
    filter.department = String(req.query.department);
  }
  if (req.query.role) filter.role = String(req.query.role).toUpperCase();
  if (req.query.activeOnly === "true") filter.isActive = true;

  const rows = await User.find(filter).select(
    "name email role department timezone isActive reducedMonitoring whatsappNumber"
  );

  res.json(rows.map((r) => publicShape(r, { includeContact: true })));
};

exports.listDepartments = async (req, res) => {
  if (req.user.role === "EMPLOYEE") {
    return res.status(403).json({ message: "Managers and administrators only" });
  }
  // A manager already knows their own department. The full list would tell
  // them which other departments exist. Super Admin keeps the complete list.
  if (req.user.role === "MANAGER") {
    const own = String(req.user.department || "").trim();
    return res.json(own ? [own] : []);
  }
  const departments = await User.distinct("department");
  res.json(departments.filter(Boolean).sort());
};

// Own profile maintenance: timezone and WhatsApp number. Nothing else - role,
// department and monitoring flags are administrative decisions (admin routes).
exports.updateMe = async (req, res) => {
  const { timezone, whatsappNumber } = req.body || {};
  const before = { timezone: req.user.timezone, whatsappNumber: req.user.whatsappNumber };

  if (timezone !== undefined) {
    if (!isValidTimeZone(timezone)) {
      return res.status(400).json({
        message: "timezone must be a valid IANA zone, e.g. America/Chicago or Asia/Karachi",
      });
    }
    req.user.timezone = timezone;
  }
  if (whatsappNumber !== undefined) req.user.whatsappNumber = String(whatsappNumber).slice(0, 32);

  await req.user.save();

  await audit(req, {
    action: "USER_UPDATED",
    targetType: "User",
    targetId: req.user._id,
    meta: { self: true, before, after: { timezone: req.user.timezone } },
  });

  res.json({
    id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    department: req.user.department,
    timezone: req.user.timezone,
    consentAccepted: req.user.consentAccepted,
    whatsappNumber: req.user.whatsappNumber,
  });
};

exports.updateMeShape = publicShape;