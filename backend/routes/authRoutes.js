const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");

// Express 4 does not catch async rejections - wrap keeps the process alive.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.post("/login", wrap(authController.login));
router.get("/me", wrap(requireAuth), authController.me);
router.post("/consent", wrap(requireAuth), wrap(authController.acceptConsent));

module.exports = router;
