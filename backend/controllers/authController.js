const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { audit } = require("../utils/audit");
const emailAdapter = require("../services/delivery/emailAdapter");
const accessTokens = require("../services/accounts/accessToken");
const consent = require("../constants/consent");

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    consentAccepted: user.consentAccepted === true,
    consentVersion: user.consentVersion || "",
    requiredConsentVersion: consent.VERSION,
    consentCurrent: consent.current(user),
    timezone: user.timezone,
  };
}

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
  res.json({ token, user: publicUser(user) });
};

exports.me = async (req, res) => {
  res.json({ user: publicUser(req.user) });
};

exports.consentDocument = async (req, res) => {
  res.json(consent.document());
};

// Records acceptance of the current draft. The client cannot choose the
// version: the server stores the text it is serving.
exports.acceptConsent = async (req, res) => {
  const acceptedAt = new Date();
  req.user.consentAccepted = true;
  req.user.consentAcceptedAt = acceptedAt;
  req.user.consentVersion = consent.VERSION;
  await req.user.save();

  await audit(req, {
    action: "CONSENT_ACCEPTED",
    targetType: "User",
    targetId: req.user._id,
    meta: { consentVersion: consent.VERSION, legallyApproved: false },
  });

  res.json({
    message: "Consent recorded",
    consentAcceptedAt: acceptedAt,
    consentVersion: consent.VERSION,
    legallyApproved: false,
    user: publicUser(req.user),
  });
};

// Stops further use. Does not delete tasks, time logs, activity, ratings,
// or the audit row that recorded the earlier acceptance.
exports.withdrawConsent = async (req, res) => {
  const previousVersion = req.user.consentVersion || "";
  req.user.consentAccepted = false;
  req.user.consentVersion = "";
  req.user.consentWithdrawnAt = new Date();
  await req.user.save();

  await audit(req, {
    action: "CONSENT_WITHDRAWN",
    targetType: "User",
    targetId: req.user._id,
    meta: { previousVersion, recordsDeleted: false },
  });

  res.json({
    message: "Consent withdrawn. Existing work records were not deleted.",
    user: publicUser(req.user),
  });
};

const RESET_MESSAGE =
  "If that account can receive email, a reset link will arrive. Otherwise an administrator must issue a new link.";

async function consumeLink(req, res, purpose, action) {
  const result = await accessTokens.consume({
    token: req.body && req.body.token,
    purpose,
    password: req.body && req.body.password,
  });
  if (!result.ok) return res.status(result.status).json({ message: result.message });
  await audit(req, {
    action,
    targetType: "User",
    targetId: result.userId,
    meta: { via: purpose === "SETUP" ? "setup_link" : "reset_link" },
  });
  res.json({ message: "Password saved. Sign in with your email and new password." });
}

exports.setupPassword = (req, res) => consumeLink(req, res, "SETUP", "PASSWORD_SET");
exports.resetPassword = (req, res) => consumeLink(req, res, "RESET", "PASSWORD_RESET");

// Same response whether or not the email exists. A link is emailed only when
// a real mailbox is configured. The token is never included in this response.
exports.forgotPassword = async (req, res) => {
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  if (email && emailAdapter.isLive()) {
    const user = await User.findOne({ email, isActive: true }).select("_id email name isActive");
    if (user) {
      const issued = await accessTokens.issue({ userId: user._id, purpose: "RESET" });
      const delivery = await accessTokens.deliver(user, issued);
      if (delivery.email !== "sent") await accessTokens.discard(issued);
    }
  }
  res.json({ message: RESET_MESSAGE });
};
