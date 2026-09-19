const express = require("express");
const router = express.Router();
const activityController = require("../controllers/activityController");
const { requireAuth, requireRole } = require("../middleware/auth");

// Express 4 does not catch async rejections - wrap keeps the process alive.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Section 6 - presence only. One row per heartbeat; idle window enforced
// server-side (15-20 min per requirements). No keystroke/content data
// exists anywhere in this feature by design (hard exclusions).
router.post("/heartbeat", wrap(requireAuth), wrap(activityController.heartbeat));
router.get("/status", wrap(requireAuth), wrap(activityController.myStatus));
router.get("/team", requireRole("SUPER_ADMIN", "MANAGER"), wrap(activityController.teamStatus));

module.exports = router;
