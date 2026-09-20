const express = require("express");
const router = express.Router();
const scorecardController = require("../controllers/scorecardController");
const { requireAuth, requireRole } = require("../middleware/auth");

// Express 4 does not catch async rejections - wrap keeps the process alive.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Section 7 scorecard - draft until the joint formula approval.
router.get("/my", wrap(requireAuth), wrap(scorecardController.myReport));
router.get("/user/:userId", requireRole("SUPER_ADMIN", "MANAGER"), wrap(scorecardController.userReport));

// Priority 4: the manager department/team view and the Super Admin roll-up.
router.get("/team", requireRole("SUPER_ADMIN", "MANAGER"), wrap(scorecardController.teamReport));
router.get("/departments", requireRole("SUPER_ADMIN"), wrap(scorecardController.departmentReport));

// Manager rating entry + history.
router.post("/rate", requireRole("SUPER_ADMIN", "MANAGER"), wrap(scorecardController.rate));
router.get("/ratings", requireRole("SUPER_ADMIN", "MANAGER"), wrap(scorecardController.listRatings));

// Weights stay configurable and inactive until isLive is flipped jointly.
router.get("/settings", wrap(requireAuth), wrap(scorecardController.getSettings));
router.put("/weights", wrap(requireAuth), wrap(scorecardController.updateWeights));

module.exports = router;
