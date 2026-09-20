const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { audit } = require("../utils/audit");

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });
}

// Fixed bcrypt hash of random garbage - compared when the email is unknown
// so response time doesn't reveal whether an email exists (enumeration defense).
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

exports.login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user || !user.isActive) {
    await bcrypt.compare(password, DUMMY_HASH); // equalize timing
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
      consentAccepted: user.consentAccepted,
      timezone: user.timezone,
    },
  });
};

exports.me = async (req, res) => {
  res.json({ user: req.user });
};

// Section 9: the actual accept action. Front-end must show the consent
// text (task/handoff features + activity tracking & spot-check disclosure)
// before calling this - this endpoint just records it.
exports.acceptConsent = async (req, res) => {
  req.user.consentAccepted = true;
  req.user.consentAcceptedAt = new Date();
  await req.user.save();

  // Section 9: the consent moment is itself an auditable event.
  await audit(req, {
    action: "CONSENT_ACCEPTED",
    targetType: "User",
    targetId: req.user._id,
    meta: { consentVersion: "placeholder-2026-09-19" },
  });

  res.json({ message: "Consent recorded", consentAcceptedAt: req.user.consentAcceptedAt });
};
