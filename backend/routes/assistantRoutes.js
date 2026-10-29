const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const assistantController = require("../controllers/assistantController");
const { requireAuth } = require("../middleware/auth");
const config = require("../config/env");

// Per signed-in user, not per IP, so one office NAT cannot lock everyone out
// and one employee cannot spend the whole office's budget. Auth runs first.
const askLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.ai.askRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user._id ? String(req.user._id) : "anonymous"),
  message: {
    message: "Too many assistant questions. Wait a few minutes and try again.",
    code: "AI_RATE_LIMITED",
  },
});

// Express 4 does not catch async rejections - wrap keeps the process alive.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(wrap(requireAuth));
// Section 5 - AI Co-Working Assistant. Consent-gated via the global
// requireAuth middleware chain (assistant routes are mounted under /api).
router.get("/provider", wrap(assistantController.providerInfo));
router.get("/next-up", wrap(assistantController.nextUp));
router.post("/ask", askLimiter, wrap(assistantController.ask));
router.post("/draft", askLimiter, wrap(assistantController.draft));
router.post("/summary", askLimiter, wrap(assistantController.summary));

// Approval-gated outbound messages (docs/approval-gates.md rows 3-5)
router.post("/messages", wrap(assistantController.proposeSend));
router.get("/messages", wrap(assistantController.myProposals));
router.post("/messages/:id/confirm", wrap(assistantController.confirmSend));
router.post("/messages/:id/decline", wrap(assistantController.declineSend));

module.exports = router;
