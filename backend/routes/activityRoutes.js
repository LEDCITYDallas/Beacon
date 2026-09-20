const express = require("express");
const router = express.Router();
const activityController = require("../controllers/activityController");
const { requireAuth, requireRole } = require("../middleware/auth");

// Express 4 does not catch async rejections - wrap keeps the process alive.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Section 6 - real idle/AFK detection. The client reports how long the machine
// has been idle; the server derives Active / On Break (15-20 min window).
// Activity/idle state + timestamps ONLY - no keystrokes, no content, no screen.
router.post("/heartbeat", wrap(requireAuth), wrap(activityController.heartbeat));
router.get("/status", wrap(requireAuth), wrap(activityController.myStatus));
router.get("/my-activity", wrap(requireAuth), wrap(activityController.myActivitySummary));
router.get("/team", requireRole("SUPER_ADMIN", "MANAGER"), wrap(activityController.teamStatus));

module.exports = router;
