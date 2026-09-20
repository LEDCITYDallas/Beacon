const { formatDate, formatDateTime, dayKey, weekStartInZone } = require("../../utils/timezone");

// ---------------------------------------------------------------------
// Notification composer (Priority 5).
//
// This module only RENDERS text. It never sends. That separation is what lets
// LED City change how a message reads - or translate it - without touching a
// delivery adapter, and it is why the same body can go to in-app, email or
// WhatsApp with no duplicated business logic.
//
// Every renderer takes dates already resolved into the RECIPIENT's timezone,
// so a Dallas manager and an overseas employee never see each other's clock.
// ---------------------------------------------------------------------

function overdueSubject(count) {
  return `${count} task(s) overdue on your team`;
}

function blockedSubject(count) {
  return `${count} task(s) blocked on your team`;
}

function renderOverdueAlerts({ manager, overdueTasks, timezone }) {
  const tz = timezone || (manager && manager.timezone) || "America/Chicago";
  const lines = overdueTasks.map((t) => {
    const who = t.assignedTo && t.assignedTo.name ? t.assignedTo.name : "unassigned";
    const daysLate = Math.max(
      1,
      Math.round((Date.now() - new Date(t.dueDate).getTime()) / 86400000)
    );
    return `• ${t.title} — ${who} — was due ${formatDate(t.dueDate, tz)} (${daysLate}d late)`;
  });

  return {
    subject: overdueSubject(overdueTasks.length),
    text:
      `Overdue tasks as of ${formatDateTime(new Date(), tz)} (${tz})\n\n` +
      lines.join("\n") +
      "\n\nThis is an alert only. Nothing was changed and nobody was notified automatically.",
  };
}

function renderBlockedAlerts({ manager, blockedTasks, timezone }) {
  const tz = timezone || (manager && manager.timezone) || "America/Chicago";
  const lines = blockedTasks.map((t) => {
    const who = t.assignedTo && t.assignedTo.name ? t.assignedTo.name : "unassigned";
    const reason =
      t.blockedReason && t.blockedReason.type === "NOT_CONFIDENT"
        ? "needs guidance / not confident"
        : "waiting on another person or system";
    return `• ${t.title} — ${who} — ${reason}${t.blockedReason?.note ? ` ("${t.blockedReason.note}")` : ""}`;
  });

  return {
    subject: blockedSubject(blockedTasks.length),
    text:
      `Blocked tasks as of ${formatDateTime(new Date(), tz)} (${tz})\n\n` +
      lines.join("\n") +
      "\n\nReasons are shown in aggregate so no one is singled out for asking for help (Section 4).",
  };
}

function renderOverrun({ task, employee, manager, timezone }) {
  const tz = timezone || (employee && employee.timezone) || "America/Chicago";
  return {
    subject: `Task over its estimate: ${task.title}`,
    text:
      `${employee ? employee.name : "An employee"}'s task "${task.title}" has run past its estimate ` +
      `(${task.estimatedHours}h estimated, threshold ${task.overrunThresholdPct}%).\n` +
      `Due ${formatDate(task.dueDate, tz)}.\n\n` +
      "Suggested next step: check in and see whether the estimate or the approach needs adjusting.",
  };
}

function renderFlagged({ task, manager, note, timezone }) {
  const tz = timezone || (manager && manager.timezone) || "America/Chicago";
  return {
    subject: `Task flagged: ${task.title}`,
    text:
      `A task was flagged for attention: "${task.title}" (due ${formatDate(task.dueDate, tz)}).` +
      (note ? `\n\nNote: ${note}` : ""),
  };
}

// Friday digest (Section 8): what each person finished, what is late, who is
// overloaded. `perPerson` is produced by digestController from live data.
function renderWeeklyDigest({ perPerson, timezone, generatedAt = new Date(), weekOf }) {
  const tz = timezone || "America/Chicago";
  const lines = [`*LED City weekly digest* (week of ${weekOf || dayKey(generatedAt, tz)})`];

  for (const p of perPerson) {
    lines.push(
      `\n*${p.name}* (${p.department})` +
        `\nFinished: ${p.finished.length ? p.finished.join("; ") : "nothing closed this week"}` +
        `\nLate: ${p.late.length ? p.late.map((l) => l.title).join("; ") : "none"}` +
        (p.overloaded ? `\n⚠ Overloaded: ${p.openHours}h of open work` : "")
    );
  }

  lines.push(`\nGenerated ${formatDateTime(generatedAt, tz)} (${tz}).`);

  return {
    subject: `LED City weekly digest — week of ${weekOf || dayKey(generatedAt, tz)}`,
    text: lines.join("\n"),
  };
}

function renderHandoffFallback({ completedTask, dependentTask, assignee, timezone }) {
  const tz = timezone || (assignee && assignee.timezone) || "America/Chicago";
  return (
    `Handoff: "${completedTask ? completedTask.title : "the task you were waiting on"}" is complete. ` +
    `Your task "${dependentTask ? dependentTask.title : "your next task"}" is ready to start` +
    (dependentTask && dependentTask.dueDate ? ` (due ${formatDate(dependentTask.dueDate, tz)})` : "") +
    "."
  );
}

module.exports = {
  renderOverdueAlerts,
  renderBlockedAlerts,
  renderOverrun,
  renderFlagged,
  renderWeeklyDigest,
  renderHandoffFallback,
  weekStartInZone,
};