const express = require("express");
const router = express.Router();
const liveViewController = require("../controllers/liveViewController");
const { requireAuth, requireAuthStream } = require("../middleware/auth");

// Express 4 does not catch async rejections - wrap keeps the process alive.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Section 6 - live screen view. View-only: frames are held in memory for a few
// seconds and never persisted. Role scope comes from PermissionSettings, so the
// client's final decision is a config change (Priority 10).
router.use(wrap(requireAuth));

router.get("/config", wrap(liveViewController.getConfig));
router.get("/targets", wrap(liveViewController.getTargets));

// Specific paths BEFORE "/:id" so they are not swallowed as an id.
router.get("/sessions/for-me", wrap(liveViewController.forMe));
router.get("/sessions/mine", wrap(liveViewController.mySessions));
router.get("/sessions", wrap(liveViewController.listSessions)); // SuperAdmin-only inside

router.post("/sessions", wrap(liveViewController.requestSession));
router.post("/sessions/:id/approve", wrap(liveViewController.approveSession));
router.post("/sessions/:id/deny", wrap(liveViewController.denySession));
router.post("/sessions/:id/frames", wrap(liveViewController.postFrame));
router.post("/sessions/:id/end", wrap(liveViewController.endSession));

// SSE stream. Authorization header only; ?token= is not accepted.
router.get("/sessions/:id/stream", wrap(requireAuthStream), wrap(liveViewController.stream));

module.exports = router;