const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const { requireAuth, requireRole } = require("../middleware/auth");

// Express 4 does not catch async rejections - wrap keeps the process alive.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(wrap(requireAuth));
router.use(requireRole("SUPER_ADMIN"));

// Priority 1: real spend + the configured provider and its cost assumptions.
router.get("/ai-usage", wrap(adminController.getAiUsage));

// Priority 8/9/10: what is actually switched on, retention, permissions, audit.
router.get("/system", wrap(adminController.getSystemStatus));
router.get("/retention", wrap(adminController.getRetention));
router.put("/retention", wrap(adminController.updateRetention));
router.get("/permissions", wrap(adminController.getPermissions));
router.put("/permissions", wrap(adminController.updatePermissions));
router.get("/audit", wrap(adminController.getAuditLog));

// Priority 10: the staff table the client returns in Section 1.6 is applied here.
router.patch("/users/:userId", wrap(adminController.updateUser));

module.exports = router;