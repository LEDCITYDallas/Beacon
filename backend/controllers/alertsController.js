const Task = require("../models/Task");

// Section 8: manager alerts on overdue or blocked tasks - in-app at launch.
// Read-only; nothing here triggers any automatic action (Section 7 rule:
// no automation on outcomes). Email dispatch hooks land in Phase 5/6.
//
// Scope: manager -> own department, Super Admin -> everything (Section 3).
exports.myAlerts = async (req, res) => {
  if (req.user.role === "EMPLOYEE") {
    return res.status(403).json({ message: "Managers and admins only" });
  }
  const deptFilter =
    req.user.role === "MANAGER" ? { department: req.user.department } : {};
  const now = new Date();

  const overdue = await Task.find({
    ...deptFilter,
    status: { $ne: "COMPLETED" },
    dueDate: { $lt: now },
  })
    .populate("assignedTo", "name")
    .select("title priority status dueDate assignedTo flagged blockedReason")
    .sort({ dueDate: 1 })
    .limit(50);

  const blocked = await Task.find({ ...deptFilter, status: "BLOCKED" })
    .populate("assignedTo", "name")
    .select("title priority status dueDate assignedTo flagged blockedReason")
    .sort({ updatedAt: -1 })
    .limit(50);

  res.json({ overdue, blocked });
};
