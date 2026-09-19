const express = require("express");
const router = express.Router();
const alertsController = require("../controllers/alertsController");
const { requireAuth } = require("../middleware/auth");

// Express 4 does not catch async rejections - wrap keeps the process alive.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Section 8: manager alerts on overdue/blocked tasks (in-app at launch).
// Controller enforces manager/admin-only + department scoping.
router.get("/", wrap(requireAuth), wrap(alertsController.myAlerts));

module.exports = router;
