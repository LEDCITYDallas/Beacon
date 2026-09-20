const Task = require("../../models/Task");
const TimeLog = require("../../models/TimeLog");
const provider = require("./provider");
const usage = require("./usage");
const { formatDate, dayKey } = require("../../utils/timezone");

// ---------------------------------------------------------------------
// Assistant service (Section 5 / Priority 1).
//
// EVERY function here takes the authenticated user and hard-filters by their
// identity and Section 3 role scope: the assistant can never see more than the
// employee can. That is enforced by the queries in this file, not by asking the
// model nicely (approval-gates.md, hard limits).
//
// Responsibilities:
//   1. Q&A about the employee's own tasks, status, dependencies and workflow
//   2. drafting routine replies / status updates / summaries
//   3. personalised next-up queue assistance from real task + dependency data
//   4. proactive handoff text when a dependency becomes ready
//
// Nothing here sends, completes or notifies. Those are approval-gated endpoints.
// ---------------------------------------------------------------------

const PRIORITY_RANK = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const DAY = 86400000;

// Section 3 scope, expressed as a Mongo filter. Kept in one place so every
// assistant call inherits the same restriction.
function scopeFilter(user) {
  if (user.role === "EMPLOYEE") return { assignedTo: user._id };
  if (user.role === "MANAGER") return { department: user.department };
  return {}; // SUPER_ADMIN
}

async function scopedTasks(user, limit = 40) {
  return Task.find(scopeFilter(user))
    .select(
      "title status priority dueDate estimatedHours department assignedTo dependsOn " +
        "blockedReason pendingCompletionProposal reopenCount overrunAlertFired definitionOfDone"
    )
    .populate("assignedTo", "name")
    .populate("dependsOn", "title status")
    .sort({ dueDate: 1 })
    .limit(limit)
    .lean();
}

async function actualHoursByTask(taskIds) {
  if (!taskIds.length) return new Map();
  const rows = await TimeLog.aggregate([
    { $match: { task: { $in: taskIds } } },
    {
      $group: {
        _id: "$task",
        seconds: {
          $sum: {
            $cond: [
              { $ifNull: ["$endTime", false] },
              "$durationSeconds",
              { $divide: [{ $subtract: [new Date(), "$startTime"] }, 1000] },
            ],
          },
        },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), Math.round((r.seconds / 3600) * 10) / 10]));
}

// Compact, prompt-sized description of exactly what the user may see.
async function buildOwnDataContext(user) {
  const tasks = await scopedTasks(user, 40);
  const actual = await actualHoursByTask(tasks.map((t) => t._id));
  const tz = user.timezone;

  if (!tasks.length) return "(no tasks in your scope right now)";

  return tasks
    .map((t) => {
      const who = t.assignedTo && t.assignedTo.name ? t.assignedTo.name : "unassigned";
      const deps = (t.dependsOn || []).length
        ? ` deps=[${t.dependsOn.map((d) => `${d.title}:${d.status}`).join(", ")}]`
        : "";
      const blocked =
        t.blockedReason && t.blockedReason.type
          ? ` blocked=${t.blockedReason.type}${t.blockedReason.note ? ` (${t.blockedReason.note})` : ""}`
          : "";
      const pending = t.pendingCompletionProposal?.isPending
        ? ` completion-proposed (${t.pendingCompletionProposal.detectedSignal})`
        : "";
      const overrun = t.overrunAlertFired ? " OVERRUN" : "";
      const hours = actual.has(String(t._id)) ? `${actual.get(String(t._id))}h` : "no time logged";
      return (
        `- ${t.title} [${t.status}, ${t.priority}] assignee=${who} ` +
        `due=${formatDate(t.dueDate, tz)} est=${t.estimatedHours}h actual=${hours}` +
        `${deps}${blocked}${pending}${overrun}`
      );
    })
    .join("\n");
}

// ---------------------------------------------------------------------
// Personalised next-up queue (Section 5 feature 1, requirement: "personalized
// next-up queue assistance using existing task/dependency data").
//
// The ranking is deterministic and explainable - a human can see exactly why a
// task is first. AI is not asked to invent an ordering; it can only narrate it.
// ---------------------------------------------------------------------
function rankTasks(tasks, tz) {
  const now = Date.now();
  return tasks
    .filter((t) => t.status === "READY" || t.status === "IN_PROGRESS" || t.status === "PAUSED")
    .map((t) => {
      const reasons = [];
      let score = (PRIORITY_RANK[t.priority] || 0) * 10;
      reasons.push(`priority ${t.priority}`);

      const dueMs = new Date(t.dueDate).getTime() - now;
      const dueDays = Math.ceil(dueMs / DAY);
      if (dueMs < 0) {
        score += 35;
        reasons.push(`overdue by ${Math.abs(dueDays)}d`);
      } else if (dueDays <= 1) {
        score += 25;
        reasons.push("due today/tomorrow");
      } else if (dueDays <= 3) {
        score += 15;
        reasons.push(`due in ${dueDays}d`);
      } else if (dueDays <= 7) {
        score += 8;
        reasons.push(`due in ${dueDays}d`);
      }

      const deps = t.dependsOn || [];
      const blockedByDeps = deps.filter((d) => d.status && d.status !== "COMPLETED");
      if (!deps.length) {
        score += 10;
        reasons.push("no dependencies");
      } else if (!blockedByDeps.length) {
        score += 6;
        reasons.push("all dependencies complete");
      }

      if (t.status === "IN_PROGRESS") {
        score += 12;
        reasons.push("already in progress");
      }
      if (t.overrunAlertFired) {
        score -= 5;
        reasons.push("past its estimate - check before resuming");
      }
      if (t.blockedReason && t.blockedReason.type) {
        score -= 30;
        reasons.push(`blocked (${t.blockedReason.type})`);
      }

      return {
        taskId: t._id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        dueDateLocal: formatDate(t.dueDate, tz),
        estimatedHours: t.estimatedHours,
        department: t.department,
        score,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score);
}

async function nextUpQueue(user, { limit = 5 } = {}) {
  const tasks = await scopedTasks(user, 60);
  const ranked = rankTasks(tasks, user.timezone);
  const blocked = tasks.filter((t) => t.status === "BLOCKED");
  const awaitingConfirmation = tasks.filter((t) => t.pendingCompletionProposal?.isPending);

  return {
    generatedFor: user.name,
    timezone: user.timezone,
    nextUp: ranked.slice(0, limit),
    blocked: blocked.map((t) => ({
      taskId: t._id,
      title: t.title,
      reason: t.blockedReason?.type || "unknown",
      waitingOn: (t.dependsOn || []).filter((d) => d.status !== "COMPLETED").map((d) => d.title),
    })),
    awaitingConfirmation: awaitingConfirmation.map((t) => ({
      taskId: t._id,
      title: t.title,
      signal: t.pendingCompletionProposal.detectedSignal,
      requiresHumanApproval: true,
    })),
    note:
      "Ranking uses your own task and dependency data only. The assistant never changes a task - you confirm every completion.",
  };
}

// ---------------------------------------------------------------------
// Q&A + drafting
// ---------------------------------------------------------------------

const SYSTEM_QA =
  "You are a co-worker assistant inside LED City's workforce tool. " +
  "Answer ONLY from the task data provided. If the answer is not in the data, " +
  "say you don't know. Never invent task statuses, names, or dates. Be brief " +
  "and concrete. You cannot change anything: you may only explain what is in " +
  "the data, and you must tell the employee to use the approval buttons in the " +
  "app for any action that changes a task or sends a message.";

const SYSTEM_DRAFT =
  "You are a co-worker assistant inside LED City's workforce tool. " +
  "Draft the requested routine work product (reply, status update, or summary) " +
  "based only on the task data provided. Output the draft text only, ready for " +
  "the employee to review and edit. Never claim the message was sent - you only " +
  "draft. Never promise a date or a completion that is not supported by the data.";

// Read-only, no approval needed (approval-gates.md matrix row 1).
async function answerQuestion(user, question) {
  await usage.assertWithinDailyLimit(user);
  const context = await buildOwnDataContext(user);
  const prompt = `Task data for ${user.name} (timezone ${user.timezone}):\n${context}\n\nQuestion: ${question}`;

  try {
    const result = await provider.generate({ kind: "qa", system: SYSTEM_QA, prompt });
    await usage.recordUsage({ user, kind: "qa", result, ok: true });
    return result;
  } catch (err) {
    await usage.recordUsage({
      user,
      kind: "qa",
      result: null,
      ok: false,
      errorCode: err.code || "AI_PROVIDER_ERROR",
    });
    throw err;
  }
}

// Generates text only; nothing is sent or persisted as "sent" (row 2).
async function draftWorkProduct(user, kind, request) {
  await usage.assertWithinDailyLimit(user);
  const context = await buildOwnDataContext(user);
  const prompt = `Task data for ${user.name} (timezone ${user.timezone}):\n${context}\n\nDraft request (${kind}): ${request}`;

  try {
    const result = await provider.generate({
      kind: kind === "SUMMARY" ? "summary" : "draft",
      system: SYSTEM_DRAFT,
      prompt,
    });
    await usage.recordUsage({ user, kind: "draft", result, ok: true });
    return result;
  } catch (err) {
    await usage.recordUsage({
      user,
      kind: "draft",
      result: null,
      ok: false,
      errorCode: err.code || "AI_PROVIDER_ERROR",
    });
    throw err;
  }
}

// ---------------------------------------------------------------------
// Proactive handoff generation (Section 5.2).
//
// Called when a dependency completes and a downstream task becomes READY. It
// produces the TEXT of the handoff notification only. The caller stores it as a
// PENDING MessageProposal, which a human must approve before anything is sent
// (approval-gates.md row 5).
//
// This must never throw: an AI outage cannot be allowed to break the dependency
// engine, so on failure it degrades to a clear template and marks the text.
// ---------------------------------------------------------------------
function handoffTemplate({ completedTask, dependentTask, assignee, assigneeTimezone }) {
  const due = dependentTask && dependentTask.dueDate
    ? formatDate(dependentTask.dueDate, assigneeTimezone || "America/Chicago")
    : null;
  return (
    `Handoff: "${completedTask?.title || "the task you were waiting on"}" is complete.` +
    ` Your task "${dependentTask?.title || "your next task"}" is now ready to start` +
    (due ? ` (due ${due})` : "") +
    (assignee ? `.` : ".")
  );
}

async function draftHandoff({ completedTask, dependentTask, assignee, actor }) {
  const owner = assignee || actor;
  const contextLines = [
    completedTask ? `- ${completedTask.title} [COMPLETED]` : null,
    dependentTask
      ? `- ${dependentTask.title} [READY, ${dependentTask.priority}] due=${formatDate(
          dependentTask.dueDate,
          (assignee && assignee.timezone) || undefined
        )} est=${dependentTask.estimatedHours}h`
      : null,
  ].filter(Boolean);

  const prompt =
    `Handoff context:\n${contextLines.join("\n")}\n\n` +
    `Write a short WhatsApp handoff note (max 3 sentences) telling ${assignee ? assignee.name : "the assignee"} ` +
    `that the dependency is complete and their task is ready to start. Plain text, no markdown, no emoji spam.`;

  try {
    await usage.assertWithinDailyLimit(owner);
    const result = await provider.generate({
      kind: "handoff",
      system:
        "You write brief, factual internal handoff notes for LED City. " +
        "Never claim work is finished that the data does not show as finished.",
      prompt,
      maxTokens: 220,
    });
    await usage.recordUsage({ user: owner, kind: "handoff", result, ok: true });
    return { text: result.text, provider: result.provider, model: result.model, fallback: result.fallback };
  } catch (err) {
    await usage.recordUsage({
      user: owner,
      kind: "handoff",
      result: null,
      ok: false,
      errorCode: err.code || "AI_PROVIDER_ERROR",
    });
    return {
      text: handoffTemplate({
        completedTask,
        dependentTask,
        assignee,
        assigneeTimezone: assignee && assignee.timezone,
      }),
      provider: "template",
      model: "template-v1",
      fallback: true,
    };
  }
}

// Drafts an overview of the requester's own recent work (Section 5: summaries).
async function summarizeWork(user, { dayKeyRef } = {}) {
  await usage.assertWithinDailyLimit(user);
  const context = await buildOwnDataContext(user);
  const prompt =
    `Task data for ${user.name} (timezone ${user.timezone}, reference day ${dayKey(
      new Date(),
      user.timezone
    )}):\n${context}\n\n` +
    "Write a concise status summary of this work: what is done, what is in progress, " +
    "what is blocked and on what. Plain text, short lines.";

  try {
    const result = await provider.generate({ kind: "summary", system: SYSTEM_DRAFT, prompt });
    await usage.recordUsage({ user, kind: "summary", result, ok: true });
    void dayKeyRef;
    return result;
  } catch (err) {
    await usage.recordUsage({
      user,
      kind: "summary",
      result: null,
      ok: false,
      errorCode: err.code || "AI_PROVIDER_ERROR",
    });
    throw err;
  }
}

module.exports = {
  answerQuestion,
  draftWorkProduct,
  draftHandoff,
  summarizeWork,
  nextUpQueue,
  buildOwnDataContext,
  rankTasks,
  scopeFilter,
  scopedTasks,
};