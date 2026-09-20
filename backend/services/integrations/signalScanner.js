const Task = require("../../models/Task");
const IntegrationSignal = require("../../models/IntegrationSignal");
const adapters = require("./adapters");
const { audit } = require("../../utils/audit");

// ---------------------------------------------------------------------
// Signal scanner / completion detection (Priority 6 / Section 4).
//
// Pipeline:  read signals -> match to a task -> RAISE A PROPOSAL -> human
//            confirms in the task UI.
//
// What this module deliberately does NOT do: it never sets a task to COMPLETED.
// The only code path that finalizes a task is
// taskController.confirmCompletion, behind an explicit human confirmation. That
// is the core requirement in Section 4 ("nothing closes or notifies silently").
//
// Every decision is written to IntegrationSignal with the evidence, so a
// reviewer can see WHY the system suggested completion (source, external id,
// summary, link, confidence).
// ---------------------------------------------------------------------

const MATCH_THRESHOLD = 0.34;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "task", "mock", "into",
  "was", "were", "has", "have", "been", "are", "its", "our", "your", "their",
  "then", "than", "when", "will", "should", "must", "can", "not", "all", "any",
  "new", "use", "used", "set", "get", "got", "moved", "marked", "updated",
  "status", "complete", "completed", "closed", "page", "file", "batch",
]);

function tokenize(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9#-]+/)
      .map((t) => t.replace(/^[-#]+|[-#]+$/g, ""))
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  );
}

// Confidence that an external signal means "this task is done".
// Deliberately conservative: an explicit external reference is the only way to
// reach 1.0, so the reviewer is never shown a confident claim built on a guess.
function scoreMatch(signal, task) {
  const refs = (task.externalRefs || []).some(
    (r) =>
      r.source === signal.source &&
      String(r.externalId).toLowerCase() === String(signal.externalId).toLowerCase()
  );
  if (refs && signal.externalId) {
    return { confidence: 1, reason: `explicit link: ${signal.source}:${signal.externalId}` };
  }

  const taskText = [task.title, task.description, task.definitionOfDone].join(" ");
  if (signal.externalId && taskText.toLowerCase().includes(String(signal.externalId).toLowerCase())) {
    return {
      confidence: 0.8,
      reason: `task text references external id ${signal.externalId}`,
    };
  }

  const signalTokens = tokenize(`${signal.title} ${signal.summary} ${signal.externalId}`);
  const taskTokens = tokenize(taskText);
  if (!taskTokens.size) return { confidence: 0, reason: "no comparable task text" };

  let overlap = 0;
  for (const t of signalTokens) if (taskTokens.has(t)) overlap++;
  const confidence = Math.min(0.7, overlap / Math.max(1, taskTokens.size));

  return {
    confidence: Number(confidence.toFixed(2)),
    reason: overlap
      ? `${overlap} shared content word(s): ${[...signalTokens].filter((t) => taskTokens.has(t)).slice(0, 5).join(", ")}`
      : "no shared content words",
  };
}

function bestMatch(signal, tasks) {
  let best = null;
  for (const task of tasks) {
    const { confidence, reason } = scoreMatch(signal, task);
    if (!best || confidence > best.confidence) best = { task, confidence, reason };
  }
  if (!best || best.confidence < MATCH_THRESHOLD) return null;
  return best;
}

function addTimelineEvent(task, event, actorId, meta = {}) {
  task.timeline.push({ event, actor: actorId || null, meta, timestamp: new Date() });
}

// Section 3 scope for a scan: what the person running it is allowed to see.
function scanScope(actor) {
  if (actor.role === "MANAGER") return { department: actor.department };
  return {}; // SUPER_ADMIN
}

// Raise a completion proposal on a task. NEVER completes it.
async function proposeFromSignal({ task, signal, confidence, reason, actor, driver }) {
  const alreadyPending = task.pendingCompletionProposal && task.pendingCompletionProposal.isPending;

  const logRow = {
    source: signal.source,
    driver,
    externalId: String(signal.externalId || ""),
    type: signal.type || "",
    title: signal.title || "",
    summary: signal.summary || "",
    evidenceUrl: signal.evidenceUrl || "",
    occurredAt: signal.occurredAt || null,
    employee: task.assignedTo,
    task: task._id,
    matchConfidence: confidence,
    matchReason: reason,
    scannedBy: actor._id,
  };

  if (alreadyPending) {
    // Idempotent: a second scan must not spam the assignee with duplicates.
    await IntegrationSignal.create({
      ...logRow,
      action: "IGNORED",
      error: "a completion proposal is already pending",
    });
    return { action: "IGNORED" };
  }

  task.pendingCompletionProposal = {
    isPending: true,
    detectedSignal: `${signal.source}: ${signal.title}`,
    proposedAt: new Date(),
    proposedBy: actor._id,
    confidence,
    evidence: {
      source: signal.source,
      externalId: String(signal.externalId || ""),
      summary: signal.summary || signal.title || "",
      evidenceUrl: signal.evidenceUrl || "",
      occurredAt: signal.occurredAt || null,
    },
  };
  addTimelineEvent(task, "COMPLETION_PROPOSED", null, {
    detectedSignal: signal.source,
    confidence,
    matchReason: reason,
    evidenceUrl: signal.evidenceUrl || "",
    // Explicit in the record: this is a proposal awaiting a human decision.
    awaitingHumanConfirmation: true,
  });
  await task.save();

  await IntegrationSignal.create({ ...logRow, action: "PROPOSED_COMPLETION" });
  await audit(
    { user: actor },
    {
      action: "INTEGRATION_COMPLETION_PROPOSED",
      targetType: "Task",
      targetId: task._id,
      meta: { source: signal.source, externalId: signal.externalId, confidence },
    }
  );

  return { action: "PROPOSED_COMPLETION", confidence };
}

// Main entry point. Returns a summary an admin UI can display, and never throws
// because of one bad source.
async function scanForCompletions({ actor, since, sources, maxTasks = 200 } = {}) {
  const sinceDate = since || new Date(Date.now() - 24 * 3600 * 1000);

  const tasks = await Task.find({
    ...scanScope(actor),
    status: { $ne: "COMPLETED" },
  })
    .select(
      "title description definitionOfDone department assignedTo externalRefs " +
        "pendingCompletionProposal timeline status"
    )
    .limit(maxTasks);

  const sourceResults = await adapters.fetchAllSignals({ since: sinceDate, sources });

  const summary = {
    scannedAt: new Date(),
    since: sinceDate,
    driver: adapters.driverLabel(),
    tasksConsidered: tasks.length,
    signalsRead: 0,
    proposals: [],
    ignored: 0,
    noMatch: 0,
    sources: [],
  };

  for (const result of sourceResults) {
    const entry = {
      source: result.source,
      driver: result.driver,
      signals: result.signals.length,
      proposed: 0,
      noMatch: 0,
      ignored: 0,
      error: result.error || "",
    };

    if (result.error) {
      await IntegrationSignal.create({
        source: result.source,
        driver: result.driver,
        action: "ERROR",
        error: result.error,
        scannedBy: actor._id,
      });
      summary.sources.push(entry);
      continue;
    }

    summary.signalsRead += result.signals.length;

    // Only what the operator is allowed to see is even a candidate (Section 3).
    const candidates =
      actor.role === "MANAGER" ? tasks.filter((t) => t.department === actor.department) : tasks;

    for (const signal of result.signals) {
      const match = bestMatch(signal, candidates);

      if (!match) {
        entry.noMatch++;
        summary.noMatch++;
        await IntegrationSignal.create({
          source: signal.source,
          driver: result.driver,
          externalId: String(signal.externalId || ""),
          type: signal.type || "",
          title: signal.title || "",
          summary: signal.summary || "",
          evidenceUrl: signal.evidenceUrl || "",
          occurredAt: signal.occurredAt || null,
          action: "NO_MATCH",
          matchConfidence: 0,
          scannedBy: actor._id,
        });
        continue;
      }

      const outcome = await proposeFromSignal({
        task: match.task,
        signal,
        confidence: match.confidence,
        reason: match.reason,
        actor,
        driver: result.driver,
      });

      if (outcome.action === "PROPOSED_COMPLETION") {
        entry.proposed++;
        summary.proposals.push({
          taskId: match.task._id,
          taskTitle: match.task.title,
          assignedTo: match.task.assignedTo,
          source: signal.source,
          externalId: signal.externalId,
          confidence: match.confidence,
          reason: match.reason,
          evidenceUrl: signal.evidenceUrl,
          // Repeated on every proposal, because it is the whole point.
          requiresHumanConfirmation: true,
        });
      } else {
        entry.ignored++;
        summary.ignored++;
      }
    }

    summary.sources.push(entry);
  }

  await audit(
    { user: actor },
    {
      action: "INTEGRATION_SCAN_RUN",
      targetType: "Task",
      meta: {
        proposals: summary.proposals.length,
        sources: summary.sources.map((s) => s.source),
        driver: summary.driver,
      },
    }
  );

  summary.note =
    "Proposals only. Every task still needs the assignee to confirm before it closes (Section 4).";

  return summary;
}

module.exports = {
  scanForCompletions,
  proposeFromSignal,
  scoreMatch,
  bestMatch,
  tokenize,
  scanScope,
  MATCH_THRESHOLD,
};