const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const { requireAuth } = require("../middleware/auth");

// Express 4 does not catch async rejections - wrap keeps the process alive.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(wrap(requireAuth));

// Section 3: scoping is enforced inside the controller (employee 403,
// manager department-limited, Super Admin global).
router.get("/", wrap(userController.listUsers));
router.get("/departments", wrap(userController.listDepartments));

// Priority 7: each user keeps their own timezone (Dallas + overseas staff).
router.patch("/me", wrap(userController.updateMe));

module.exports = router;