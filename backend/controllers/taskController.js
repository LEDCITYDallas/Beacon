const mongoose = require("mongoose");
const Task = require("../models/Task");
const TimeLog = require("../models/TimeLog");
const MessageProposal = require("../models/MessageProposal");
const User = require("../models/User");
const assistantService = require("../services/ai/assistantService");
const composer = require("../services/notifications/composer");
const delivery = require("../services/delivery");
const config = require("../config/env");
const { audit } = require("../utils/audit");

// Alphabetical sort would order priorities URGENT > MEDIUM > LOW > HIGH,
// which is wrong - rank them explicitly instead (Section 4 ordering).
const PRIORITY_RANK = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

function addTimelineEvent(task, event, actorId, meta = {}) {
  task.timeline.push({ event, actor: actorId || null, meta, timestamp: new Date() });
}

// Validate path params before they hit Mongoose - a bad id must return 400,
// never throw a CastError (an unhandled async CastError crashes the whole
// Node process under Express 4).
function isValidObjectId(id) {
  return typeof id === "string" && mongoose.Types.ObjectId.isValid(id);
}

// ---------------------------------------------------------------------
// Task-level access control (Section 3).
//  read     - Super Admin: any. Manager: own department. Employee: own tasks.
//  act      - timer/block/complete/confirm/reject: the assignee only.
//  propose  - system-signal completion proposal: Manager (own dept) or
//             Super Admin - this is a management action, employees mark
//             done manually; the human confirm still belongs to the assignee.
// Returns null when allowed (res untouched); otherwise sends the error
// response and returns the status code it sent.
// ---------------------------------------------------------------------
function taskAccessError(user, task, action) {
  const isSuper = user.role === "SUPER_ADMIN";
  const isManager = user.role === "MANAGER";
  const isAssignee = String(task.assignedTo) === String(user._id);
  const sameDept = task.department === user.department;

  if (action === "manage") {
    // Flag/unflag tasks (Section 3: manager "can flag tasks").
    if (isSuper) return null;
    if (isManager && sameDept) return null;
    return 403;
  }

  if (action === "read" || action === "propose") {
    if (isSuper) return null;
    if (isManager && sameDept) return null;
    if (action === "read" && isAssignee) return null;
    return 403;
  }
  // act
  if (isAssignee) return null;
  return 403;
}

// Loads a task by :id with param validation + access control applied.
// Sends the error response itself and returns null if not permitted.
async function loadAuthorizedTask(req, res, action) {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    res.status(400).json({ message: "Invalid task id" });
    return null;
  }
  const task = await Task.findById(id);
  if (!task) {
    res.status(404).json({ message: "Task not found" });
    return null;
  }
  const denied = taskAccessError(req.user, task, action);
  if (denied) {
    res.status(denied).json({ message: "You do not have access to this task" });
    return null;
  }
  return task;
}

// ---------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------
exports.createTask = async (req, res) => {
  const {
    title,
    description,
    definitionOfDone,
    priority,
    estimatedHours,
    dueDate,
    department,
    assignedTo,
    dependsOn,
    externalRefs,
  } = req.body;

  if (!title || !definitionOfDone || !estimatedHours || !dueDate || !assignedTo) {
    return res.status(400).json({
      message: "title, definitionOfDone, estimatedHours, dueDate, assignedTo are required",
    });
  }

  if (!Number.isFinite(Number(estimatedHours)) || Number(estimatedHours) <= 0) {
    return res.status(400).json({ message: "estimatedHours must be greater than 0" });
  }

  if (!isValidObjectId(assignedTo)) {
    return res.status(400).json({ message: "assignedTo must be a valid user id" });
  }
  const assignee = await mongoose.model("User").findById(assignedTo).select("_id department");
  if (!assignee) {
    return res.status(400).json({ message: "Assignee user not found" });
  }

  // Managers only assign within their own department (Section 3 scope);
  // Super Admin can assign anywhere.
  if (req.user.role === "MANAGER" && assignee.department !== req.user.department) {
    return res.status(400).json({
      message: "Managers can only assign tasks within their own department",
    });
  }

  // If it depends on any not-yet-completed task, it starts BLOCKED.
  let status = "READY";
  if (dependsOn && dependsOn.length) {
    if (!dependsOn.every((d) => isValidObjectId(d))) {
      return res.status(400).json({ message: "dependsOn contains an invalid task id" });
    }
    const deps = await Task.find({ _id: { $in: dependsOn } }).select("status");
    if (deps.length !== dependsOn.length) {
      return res.status(400).json({ message: "dependsOn contains an unknown task id" });
    }
    const anyIncomplete = deps.some((d) => d.status !== "COMPLETED");
    status = anyIncomplete ? "BLOCKED" : "READY";
  }

  if (priority && !Task.PRIORITY.includes(priority)) {
    return res.status(400).json({
      message: `priority must be one of: ${Task.PRIORITY.join(", ")}`,
    });
  }

  // Optional explicit link to an external record (Zoho CRM/Books/Inventory,
  // WorkDrive, CMS). When set, completion-signal matching is exact rather than
  // heuristic - see services/integrations/signalScanner.js.
  let refs = [];
  if (externalRefs !== undefined) {
    if (!Array.isArray(externalRefs) || externalRefs.length > 10) {
      return res.status(400).json({ message: "externalRefs must be an array of at most 10 entries" });
    }
    for (const r of externalRefs) {
      if (!r || !r.source || !String(r.source).trim() || !r.externalId || !String(r.externalId).trim()) {
        return res.status(400).json({ message: "each externalRef needs source and externalId" });
      }
    }
    refs = externalRefs.map((r) => ({
      source: String(r.source).toUpperCase().slice(0, 40),
      externalId: String(r.externalId).slice(0, 120),
    }));
  }

  const task = new Task({
    title,
    description,
    definitionOfDone,
    priority,
    estimatedHours,
    dueDate,
    department: assignee.department, // always the assignee's department, never client-supplied
    assignedTo,
    dependsOn: dependsOn || [],
    externalRefs: refs,
    createdBy: req.user._id,
    status,
  });

  addTimelineEvent(task, "CREATED", req.user._id);
  await task.save();

  res.status(201).json(task);
};

// ---------------------------------------------------------------------
// EMPLOYEE HOME - single current task + what's next (Section 4:
// "shows one thing", not a long list)
// ---------------------------------------------------------------------
exports.getMyQueue = async (req, res) => {
  const employeeId = req.user._id;

  const current = await Task.findOne({
    assignedTo: employeeId,
    status: { $in: ["IN_PROGRESS", "PAUSED"] },
  });

  // Rank-aware ordering: string sort would put HIGH below LOW
  // (URGENT > MEDIUM > LOW > HIGH alphabetically descending).
  const rankOf = (t) => PRIORITY_RANK[t.priority] || 0;
  const byPriorityThenDue = (a, b) => {
    const diff = rankOf(b) - rankOf(a);
    if (diff !== 0) return diff;
    return new Date(a.dueDate) - new Date(b.dueDate);
  };

  const readyTasks = await Task.find({
    assignedTo: employeeId,
    status: "READY",
  });

  const nextUp = readyTasks
    .filter((t) => !current || String(t._id) !== String(current._id))
    .sort(byPriorityThenDue)
    .slice(0, 5);

  const blockedCount = await Task.countDocuments({
    assignedTo: employeeId,
    status: "BLOCKED",
  });

  // Accrued time (including a running segment) so the client timer resumes
  // at the real value instead of restarting from zero after a refresh.
  const currentActual = current ? await getActualSeconds(current._id) : 0;

  res.json({
    current,
    currentActualSeconds: currentActual,
    nextUp,
    blockedCount,
  });
};

// ---------------------------------------------------------------------
// LIST (scoped by role via scopeToDepartment middleware)
// ---------------------------------------------------------------------
exports.listTasks = async (req, res) => {
  const filter = { ...req.departmentFilter };
  if (req.query.status) filter.status = req.query.status;

  const tasks = await Task.find(filter)
    .populate("assignedTo", "name email department")
    .populate("dependsOn", "title status")
    .sort({ updatedAt: -1 });

  res.json(tasks);
};

exports.getTask = async (req, res) => {
  const task = await loadAuthorizedTask(req, res, "read");
  if (!task) return;
  const populated = await task.populate([
    { path: "assignedTo", select: "name email department" },
    { path: "dependsOn", select: "title status" },
    { path: "timeline.actor", select: "name" },
  ]);
  res.json(populated);
};

// ---------------------------------------------------------------------
// TIMER: start / pause / resume (Section 4 - separate from clock-in/out)
// ---------------------------------------------------------------------
exports.startTimer = async (req, res) => {
  const task = await loadAuthorizedTask(req, res, "act");
  if (!task) return;
  if (task.status === "COMPLETED") {
    return res.status(400).json({ message: "Cannot start a completed task" });
  }
  if (task.status === "IN_PROGRESS") {
    return res.status(400).json({ message: "Timer already running on this task" });
  }
  if (task.status === "BLOCKED") {
    return res.status(400).json({ message: "Cannot start a blocked task" });
  }

  const wasNotStarted = task.status === "READY";
  task.status = "IN_PROGRESS";
  addTimelineEvent(task, wasNotStarted ? "STARTED" : "RESUMED", req.user._id);
  await task.save();

  const log = await TimeLog.create({
    task: task._id,
    employee: req.user._id,
    startTime: new Date(),
  });

  const actualSeconds = await getActualSeconds(task._id);
  res.json({ task, timeLog: log, actualSeconds });
};

exports.pauseTimer = async (req, res) => {
  const task = await loadAuthorizedTask(req, res, "act");
  if (!task) return;
  if (task.status !== "IN_PROGRESS") {
    return res.status(400).json({ message: "No running timer on this task" });
  }

  const openLog = await TimeLog.findOne({
    task: task._id,
    employee: req.user._id,
    endTime: null,
  }).sort({ startTime: -1 });

  if (openLog) {
    openLog.endTime = new Date();
    openLog.durationSeconds = Math.round((openLog.endTime - openLog.startTime) / 1000);
    await openLog.save();
  }

  task.status = "PAUSED";
  addTimelineEvent(task, "PAUSED", req.user._id);
  await checkOverrun(task);
  await task.save();

  const actualSeconds = await getActualSeconds(task._id);
  res.json({ task, actualSeconds });
};

async function getActualSeconds(taskId) {
  const logs = await TimeLog.find({ task: taskId });
  return logs.reduce((sum, l) => {
    if (l.endTime) return sum + l.durationSeconds;
    return sum + Math.round((Date.now() - l.startTime.getTime()) / 1000);
  }, 0);
}

async function checkOverrun(task) {
  if (task.overrunAlertFired) return;
  const actualSeconds = await getActualSeconds(task._id);
  const actualHours = actualSeconds / 3600;
  const thresholdHours = task.estimatedHours * (task.overrunThresholdPct / 100);

  if (actualHours >= thresholdHours) {
    task.overrunAlertFired = true;
    addTimelineEvent(task, "OVERRUN_ALERT", null, {
      actualHours: Number(actualHours.toFixed(2)),
      estimatedHours: task.estimatedHours,
      thresholdPct: task.overrunThresholdPct,
    });
    // Priority 5 / Section 8: the overrun alert is now delivered instead of
    // being a TODO. In-app always; email only when LED City switches it on, so
    // nobody is emailed by surprise.
    await notifyOverrun(task);
  }
}

// In-app notification to the employee and their department manager, plus an
// optional email. Wrapped so any delivery problem cannot break the timer flow.
async function notifyOverrun(task) {
  try {
    const employee = await User.findById(task.assignedTo).select(
      "name email notifyEmail whatsappNumber timezone department"
    );
    const manager = await User.findOne({
      role: "MANAGER",
      department: task.department,
      isActive: true,
    }).select("name email notifyEmail timezone department");

    const rendered = composer.renderOverrun({
      task,
      employee,
      manager,
      timezone: employee ? employee.timezone : undefined,
    });

    if (employee) {
      await delivery.sendInApp({
        recipient: employee,
        kind: "OVERRUN_ALERT",
        subject: rendered.subject,
        body: rendered.text,
        relatedTask: task._id,
        meta: { estimatedHours: task.estimatedHours, thresholdPct: task.overrunThresholdPct },
      });
    }
    if (manager) {
      await delivery.sendInApp({
        recipient: manager,
        kind: "OVERRUN_ALERT",
        subject: rendered.subject,
        body: rendered.text,
        relatedTask: task._id,
        meta: { department: task.department, employeeName: employee ? employee.name : "" },
      });
      if (config.notifications.autoOverrunEmail) {
        await delivery.sendEmail({
          recipient: manager,
          kind: "OVERRUN_ALERT",
          subject: rendered.subject,
          body: rendered.text,
          relatedTask: task._id,
          meta: { source: "overrun_auto_email" },
        });
      }
    }
  } catch (err) {
    console.error("[overrun] notification failed:", err.message);
  }
}

// ---------------------------------------------------------------------
// BLOCKED - WHY (Section 4 - required field, two options only)
// ---------------------------------------------------------------------
exports.markBlocked = async (req, res) => {
  const { type, note } = req.body; // type: WAITING_ON_OTHER | NOT_CONFIDENT
  if (!["WAITING_ON_OTHER", "NOT_CONFIDENT"].includes(type)) {
    return res.status(400).json({
      message: "blockedReason.type must be WAITING_ON_OTHER or NOT_CONFIDENT",
    });
  }

  const task = await loadAuthorizedTask(req, res, "act");
  if (!task) return;
  if (task.status === "COMPLETED") {
    return res.status(400).json({ message: "Cannot block a completed task" });
  }

  task.status = "BLOCKED";
  task.blockedReason = { type, note: note || "", setAt: new Date() };
  addTimelineEvent(task, "BLOCKED", req.user._id, { type, note });
  await task.save();

  res.json(task);
};

// ---------------------------------------------------------------------
// COMPLETION - manual path (fallback) and system-proposed path
// (human-in-the-loop, Section 4: "nothing closes or notifies silently")
// ---------------------------------------------------------------------
exports.completeTaskManually = async (req, res) => {
  const task = await loadAuthorizedTask(req, res, "act");
  if (!task) return;
  if (task.status === "COMPLETED") {
    return res.status(400).json({ message: "Task is already completed" });
  }

  await finalizeCompletion(task, req.user._id, "MANUAL");
  await audit(req, {
    action: "TASK_COMPLETED",
    targetType: "Task",
    targetId: task._id,
    meta: { source: "MANUAL", title: task.title },
  });
  res.json(task);
};

// Called by future signal-reading integrations (Zoho/WorkDrive/CMS - Phase 6).
// Never finalizes on its own - only raises a proposal for a human to confirm.
exports.proposeCompletion = async (req, res) => {
  const { detectedSignal } = req.body;
  const task = await loadAuthorizedTask(req, res, "propose");
  if (!task) return;
  if (task.status === "COMPLETED") {
    return res.status(400).json({ message: "Task is already completed" });
  }

  task.pendingCompletionProposal = {
    isPending: true,
    detectedSignal: detectedSignal || "Unspecified system signal",
    proposedAt: new Date(),
  };
  addTimelineEvent(task, "COMPLETION_PROPOSED", null, { detectedSignal });
  await task.save();

  res.json(task);
};

exports.confirmCompletion = async (req, res) => {
  const task = await loadAuthorizedTask(req, res, "act");
  if (!task) return;
  if (!task.pendingCompletionProposal || !task.pendingCompletionProposal.isPending) {
    return res.status(400).json({ message: "No pending completion proposal on this task" });
  }

  task.pendingCompletionProposal.isPending = false;
  addTimelineEvent(task, "COMPLETION_CONFIRMED", req.user._id, {
    source: "SYSTEM_DETECTED",
    evidence: task.pendingCompletionProposal.evidence || null,
  });
  await finalizeCompletion(task, req.user._id, "SYSTEM_DETECTED");
  await audit(req, {
    action: "TASK_COMPLETED",
    targetType: "Task",
    targetId: task._id,
    meta: {
      source: "SYSTEM_DETECTED",
      title: task.title,
      evidenceSource: task.pendingCompletionProposal.evidence?.source || "",
      detectedSignal: task.pendingCompletionProposal.detectedSignal,
    },
  });
  res.json(task);
};

exports.rejectCompletion = async (req, res) => {
  const task = await loadAuthorizedTask(req, res, "act");
  if (!task) return;

  task.pendingCompletionProposal.isPending = false;
  addTimelineEvent(task, "COMPLETION_REJECTED", req.user._id);
  await task.save();

  res.json(task);
};

// Shared finalize logic: close any open timer, mark completed, then flip
// every dependent task from BLOCKED to READY and notify (Section 4 -
// the dependency map mechanic).
async function finalizeCompletion(task, actorId, source) {
  const openLog = await TimeLog.findOne({ task: task._id, endTime: null });
  if (openLog) {
    openLog.endTime = new Date();
    openLog.durationSeconds = Math.round((openLog.endTime - openLog.startTime) / 1000);
    await openLog.save();
  }

  task.status = "COMPLETED";
  task.completionSource = source;
  task.completedAt = new Date();
  addTimelineEvent(task, "COMPLETION_CONFIRMED", actorId, { source });
  await task.save();

  await unblockDependents(task._id, actorId);
}

// On unblock, auto-create a PENDING handoff proposal (Section 5.2 +
// docs/approval-gates.md row 5). The system proposes the notification;
// a human - the person who completed the upstream task, a manager of the
// related department, or a Super Admin - confirms the send. Nothing
// transmits while the proposal is PENDING.
async function unblockDependents(completedTaskId, actorId) {
  const completed = await Task.findById(completedTaskId).select("title");
  const dependents = await Task.find({ dependsOn: completedTaskId, status: "BLOCKED" });

  for (const dep of dependents) {
    const stillWaiting = await Task.find({
      _id: { $in: dep.dependsOn },
      status: { $ne: "COMPLETED" },
    });

    if (stillWaiting.length === 0) {
      dep.status = "READY";
      addTimelineEvent(dep, "UNBLOCKED", null, { triggeredBy: completedTaskId });
      await dep.save();

      if (actorId) {
        const assignee = await User.findById(dep.assignedTo).select(
          "name email notifyEmail whatsappNumber timezone"
        );
        // Priority 1 + Section 5.2: the handoff TEXT is drafted by the AI
        // service (degrading safely to a template if the provider is down).
        // It is stored as a PENDING proposal, so a human still decides to send
        // it - nothing is transmitted by unblocking a dependency.
        const draft = await assistantService.draftHandoff({
          completedTask: completed,
          dependentTask: dep,
          assignee,
          actor: { _id: actorId },
        });

        const proposal = await MessageProposal.create({
          channel: "WHATSAPP", // Section 11: WhatsApp for proactive handoffs
          kind: "HANDOFF",
          createdBy: actorId,
          recipient: dep.assignedTo,
          relatedTask: dep._id,
          body: draft.text,
          status: "PENDING",
        });

        addTimelineEvent(dep, "UNBLOCKED", null, {
          handoffProposalId: String(proposal._id),
          handoffProvider: draft.provider,
          requiresHumanApproval: true,
        });
        await dep.save();
      }
    }
  }
}

exports.getTaskTimeline = async (req, res) => {
  const task = await loadAuthorizedTask(req, res, "read");
  if (!task) return;
  await task.populate("timeline.actor", "name");
  res.json(task.timeline);
};

// ---------------------------------------------------------------------
// REOPEN (Section 7: rework/reopened count scorecard input). Manager
// (same department) or Super Admin reopens a completed task; the assignee
// keeps working via the normal flow. reopenCount increments for the
// scorecard. A reopened task returns to READY with the timer reset free.
// ---------------------------------------------------------------------
exports.reopenTask = async (req, res) => {
  const task = await loadAuthorizedTask(req, res, "manage");
  if (!task) return;
  if (task.status !== "COMPLETED") {
    return res.status(400).json({ message: "Only completed tasks can be reopened" });
  }

  task.status = "READY";
  task.completionSource = null;
  task.completedAt = null;
  task.reopenCount += 1;
  addTimelineEvent(task, "TASK_REOPENED", req.user._id, {
    reopenCount: task.reopenCount,
  });
  await task.save();

  await audit(req, {
    action: "TASK_REOPENED",
    targetType: "Task",
    targetId: task._id,
    meta: { reopenCount: task.reopenCount, title: task.title },
  });

  res.json(task);
};

// ---------------------------------------------------------------------
// FLAG (Section 3: manager "can flag tasks") - an attention marker, not
// a status. Manager (same department) or Super Admin only.
// ---------------------------------------------------------------------
exports.setTaskFlag = async (req, res) => {
  const task = await loadAuthorizedTask(req, res, "manage");
  if (!task) return;
  if (task.status === "COMPLETED") {
    return res.status(400).json({ message: "Cannot flag a completed task" });
  }

  const { flagged, note } = req.body;
  const shouldFlag = Boolean(flagged);

  task.flagged = shouldFlag;
  task.flagNote = shouldFlag ? String(note || "").slice(0, 500) : "";
  task.flaggedBy = shouldFlag ? req.user._id : null;
  task.flaggedAt = shouldFlag ? new Date() : null;
  addTimelineEvent(
    task,
    shouldFlag ? "TASK_FLAGGED" : "TASK_UNFLAGGED",
    req.user._id,
    note ? { note: String(note).slice(0, 500) } : {}
  );
  await task.save();

  res.json(task);
};
