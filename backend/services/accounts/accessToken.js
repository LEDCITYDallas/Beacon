const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const AccessToken = require("../../models/AccessToken");
const User = require("../../models/User");
const config = require("../../config/env");
const emailAdapter = require("../delivery/emailAdapter");
const delivery = require("../delivery");

const TTL_MS = {
  SETUP: 72 * 60 * 60 * 1000,
  RESET: 60 * 60 * 1000,
};

const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function publicPath(purpose) {
  return purpose === "SETUP" ? "/setup" : "/reset";
}

function passwordError(password) {
  const value = String(password || "");
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
    return `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters.`;
  }
  if (value !== value.trim()) {
    return "Password cannot start or end with a space.";
  }
  return "";
}

// Invalidates any unused link of the same kind, then stores only a hash.
async function issue({ userId, purpose, createdBy = null }) {
  if (!TTL_MS[purpose]) {
    const err = new Error("purpose must be SETUP or RESET");
    err.status = 400;
    throw err;
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS[purpose]);
  await AccessToken.updateMany({ user: userId, purpose, usedAt: null }, { usedAt: new Date() });
  await AccessToken.create({
    user: userId,
    purpose,
    tokenHash: hashToken(token),
    expiresAt,
    createdBy,
  });
  return { token, expiresAt, purpose, path: publicPath(purpose) };
}

function linkFor(issued) {
  const origin = (config.frontendOrigins[0] || "http://localhost:5173").replace(/\/$/, "");
  return `${origin}${issued.path}#token=${encodeURIComponent(issued.token)}`;
}

// Real email only. A mock transport is not an invitation: the admin copies
// the link instead, and the raw token is never placed in the notification log.
async function deliver(user, issued, { sentBy = null } = {}) {
  if (!emailAdapter.isLive()) return { email: "not_configured" };
  const hours = issued.purpose === "SETUP" ? 72 : 1;
  const subject =
    issued.purpose === "SETUP"
      ? "Set up your LED City workforce account"
      : "Reset your LED City workforce password";
  const log = await delivery.sendEmail({
    recipient: user,
    kind: "ACCOUNT_ACCESS",
    subject,
    body:
      `${subject}.\n\nOpen this link once and choose a password:\n${linkFor(issued)}\n\n` +
      `It expires in ${hours} hour(s). If you did not expect this, ignore it.`,
    logBody: "Account access link issued. The link is omitted from this record.",
    sentBy,
  });
  if (log && log.status === "SENT") return { email: "sent" };
  return { email: "failed" };
}

async function discard(issued) {
  await AccessToken.deleteOne({ tokenHash: hashToken(issued.token), usedAt: null });
}

// Marks the link used before changing the password so a second request cannot
// race in. The stored user password is a bcrypt hash only.
async function consume({ token, purpose, password }) {
  const secret = String(token || "");
  if (!secret || secret.length > 200) {
    return { ok: false, status: 400, message: "This link is invalid or has expired." };
  }
  const problem = passwordError(password);
  if (problem) return { ok: false, status: 400, message: problem };

  const claimed = await AccessToken.findOneAndUpdate(
    {
      tokenHash: hashToken(secret),
      purpose,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { usedAt: new Date() },
    { new: true }
  );
  if (!claimed) {
    return { ok: false, status: 400, message: "This link is invalid or has expired." };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const updated = await User.updateOne({ _id: claimed.user, isActive: true }, { passwordHash });
  if (!updated.matchedCount) {
    return { ok: false, status: 400, message: "This account cannot set a password right now." };
  }
  return { ok: true, userId: claimed.user };
}

module.exports = {
  issue,
  deliver,
  discard,
  consume,
  passwordError,
  linkFor,
};
