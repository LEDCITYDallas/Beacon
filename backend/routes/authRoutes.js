const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const authController = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");

// Express 4 does not catch async rejections - wrap keeps the process alive.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many account requests. Try again later." },
});

router.post("/login", wrap(authController.login));
router.get("/me", wrap(requireAuth), authController.me);
router.get("/consent", wrap(requireAuth), authController.consentDocument);
router.post("/consent", wrap(requireAuth), wrap(authController.acceptConsent));
router.post("/consent/withdraw", wrap(requireAuth), wrap(authController.withdrawConsent));
router.post("/setup", accountLimiter, wrap(authController.setupPassword));
router.post("/reset-password", accountLimiter, wrap(authController.resetPassword));
router.post("/forgot-password", accountLimiter, wrap(authController.forgotPassword));

module.exports = router;
