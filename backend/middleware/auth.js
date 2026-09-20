const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Missing auth token" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id).select("-passwordHash");

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Invalid or inactive user" });
    }

    // Section 9: consent gate is a hard system requirement, not just
    // policy text. Block every route except the consent endpoint itself
    // until the employee has accepted.
    const isConsentRoute = req.originalUrl.includes("/consent");
    if (!user.consentAccepted && !isConsentRoute) {
      return res.status(403).json({
        message: "Consent required before using the system",
        code: "CONSENT_REQUIRED",
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

// Usage: requireRole("SUPER_ADMIN", "MANAGER")
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Insufficient role permissions" });
    }
    next();
  };
}

// Managers only see their own department's data; Super Admin sees all.
// Employees are handled separately (own-data-only) in each controller.
function scopeToDepartment(req, res, next) {
  if (req.user.role === "SUPER_ADMIN") {
    req.departmentFilter = {}; // no filter, full access
  } else if (req.user.role === "MANAGER") {
    req.departmentFilter = { department: req.user.department };
  } else {
    req.departmentFilter = { assignedTo: req.user._id };
  }
  next();
}

// The live-view SSE stream is consumed by a browser fetch stream, which can send
// the Authorization header. This variant ALSO accepts ?token= so curl / a native
// monitoring client can subscribe during testing. It is used for that one route
// only, so tokens stay out of URLs everywhere else.
async function requireAuthStream(req, res, next) {
  if (!req.headers.authorization && req.query && req.query.token) {
    req.headers.authorization = `Bearer ${String(req.query.token)}`;
  }
  return requireAuth(req, res, next);
}

module.exports = { requireAuth, requireAuthStream, requireRole, scopeToDepartment };
