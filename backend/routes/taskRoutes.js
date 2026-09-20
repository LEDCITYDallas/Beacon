const express = require("express");
const router = express.Router();
const taskController = require("../controllers/taskController");
const { requireAuth, requireRole, scopeToDepartment } = require("../middleware/auth");

// Express 4 does not catch rejections from async handlers - without this
// wrapper any thrown error would take down the whole Node process.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(wrap(requireAuth));

// Employee home screen: single current task + what's next
router.get("/my-queue", wrap(taskController.getMyQueue));

// Listing, scoped by role (Super Admin: all, Manager: own dept, Employee: own tasks)
router.get("/", scopeToDepartment, wrap(taskController.listTasks));
router.get("/:id", wrap(taskController.getTask));
router.get("/:id/timeline", wrap(taskController.getTaskTimeline));

// Only managers/super admins create tasks
router.post("/", requireRole("SUPER_ADMIN", "MANAGER"), wrap(taskController.createTask));

// Timer actions - any assignee on their own task
router.post("/:id/start", wrap(taskController.startTimer));
router.post("/:id/pause", wrap(taskController.pauseTimer));

// Blocked-why field
router.post("/:id/block", wrap(taskController.markBlocked));

// Completion - manual (employee) + system-proposed / human-in-the-loop
router.post("/:id/complete", wrap(taskController.completeTaskManually));
router.post("/:id/propose-completion", wrap(taskController.proposeCompletion)); // called by future integrations
router.post("/:id/confirm-completion", wrap(taskController.confirmCompletion));
router.post("/:id/reject-completion", wrap(taskController.rejectCompletion));

// Flag route - Section 3: manager/admin flag tasks needing attention.
router.post("/:id/flag", requireRole("SUPER_ADMIN", "MANAGER"), wrap(taskController.setTaskFlag));

// Reopen route - Section 7 rework input: manager/admin reopen a completed task.
router.post("/:id/reopen", requireRole("SUPER_ADMIN", "MANAGER"), wrap(taskController.reopenTask));

module.exports = router;
