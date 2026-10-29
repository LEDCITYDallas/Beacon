const jwt = require("jsonwebtoken");
const User = require("../models/User");
const consent = require("../constants/consent");

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

    // The current consent version is required before any work route.
    // /auth/me, the notice, accept, and withdraw stay available so a refresh
    // can restore the session and the person can accept or withdraw.
    // Match the path only: a query string that contains "/consent" must not
    // bypass the gate.
    const pathOnly = String(req.originalUrl || "").split("?")[0];
    const consentExempt =
      pathOnly === "/api/auth/me" ||
      pathOnly === "/api/auth/consent" ||
      pathOnly === "/api/auth/consent/withdraw";
    if (!consent.current(user) && !consentExempt) {
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

// Live-view SSE uses the same Authorization header as every other route.
// A JWT in ?token= is ignored. Query tokens leak through access logs, browser
// history, and Referer headers, so this route must not copy one onto the
// request. Callers that only send ?token= get 401 from requireAuth.
async function requireAuthStream(req, res, next) {
  return requireAuth(req, res, next);
}

module.exports = { requireAuth, requireAuthStream, requireRole, scopeToDepartment };
