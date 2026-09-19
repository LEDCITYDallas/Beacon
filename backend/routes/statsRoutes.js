const express = require("express");
const router = express.Router();
const statsController = require("../controllers/statsController");
const { requireAuth } = require("../middleware/auth");

// Express 4 does not catch async rejections - wrap keeps the process alive.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Section 8: employee self-view - own weekly stats and trend. Employees see
// their own only; the manager/scorecard view ships in Phase 5.
router.get("/my-week", wrap(requireAuth), wrap(statsController.myWeek));

module.exports = router;
