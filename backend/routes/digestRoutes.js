const express = require("express");
const router = express.Router();
const digestController = require("../controllers/digestController");
const { requireAuth } = require("../middleware/auth");

// Express 4 does not catch async rejections - wrap keeps the process alive.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Section 8: Friday digest. The controller enforces Super Admin only (the
// digest goes to Omair) and keeps generation separate from delivery.
router.get("/weekly", wrap(requireAuth), wrap(digestController.weekly));
router.get("/schedule", wrap(requireAuth), wrap(digestController.schedule));
router.post("/send", wrap(requireAuth), wrap(digestController.send));

module.exports = router;
