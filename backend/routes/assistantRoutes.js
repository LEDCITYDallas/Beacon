const express = require("express");
const router = express.Router();
const assistantController = require("../controllers/assistantController");
const { requireAuth } = require("../middleware/auth");

// Express 4 does not catch async rejections - wrap keeps the process alive.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(wrap(requireAuth));
// Section 5 - AI Co-Working Assistant. Consent-gated via the global
// requireAuth middleware chain (assistant routes are mounted under /api).
router.get("/provider", wrap(assistantController.providerInfo));
router.get("/next-up", wrap(assistantController.nextUp));
router.post("/ask", wrap(assistantController.ask));
router.post("/draft", wrap(assistantController.draft));
router.post("/summary", wrap(assistantController.summary));

// Approval-gated outbound messages (docs/approval-gates.md rows 3-5)
router.post("/messages", wrap(assistantController.proposeSend));
router.get("/messages", wrap(assistantController.myProposals));
router.post("/messages/:id/confirm", wrap(assistantController.confirmSend));
router.post("/messages/:id/decline", wrap(assistantController.declineSend));

module.exports = router;
