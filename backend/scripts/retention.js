// Retention enforcement (Priority 9 / Section 12).
//
// THE RULE: the retention period is an OPEN CLIENT DECISION. This job refuses
// to delete anything until a period has actually been approved - either through
// the Super Admin UI (PUT /api/admin/retention) or the RETENTION_* env vars.
// A null duration means "not decided yet" and that data type is skipped.
//
// Usage:
//   npm run retention             report what WOULD be deleted (dry run)
//   npm run retention -- --apply  actually delete (needs an approved period)
//
// Wire the --apply form to cron/Task Scheduler on the Mac mini only AFTER Omair
// approves the durations.
require("dotenv").config();
const mongoose = require("mongoose");
const ActivityLog = require("../models/ActivityLog");
const LiveViewSession = require("../models/LiveViewSession");
const NotificationLog = require("../models/NotificationLog");
const AiUsageLog = require("../models/AiUsageLog");
const MessageProposal = require("../models/MessageProposal");
const IntegrationSignal = require("../models/IntegrationSignal");
const RetentionSettings = require("../models/RetentionSettings");
const config = require("../config/env");
const { audit } = require("../utils/audit");

const APPLY = process.argv.slice(2).includes("--apply");

function cutoffFor(days) {
  return new Date(Date.now() - days * 86400 * 1000);
}

// Each target: where the data lives, which setting controls it, and how to
// select rows past their window.
const TARGETS = [
  {
    key: "activityLogs",
    label: "activity/idle log rows",
    model: ActivityLog,
    filter: (cutoff) => ({ at: { $lt: cutoff } }),
  },
  {
    key: "liveViewSessions",
    label: "live-view session logs (finished only)",
    model: LiveViewSession,
    filter: (cutoff) => ({
      status: { $in: ["ENDED", "DENIED", "EXPIRED"] },
      requestedAt: { $lt: cutoff },
    }),
  },
  {
    key: "notificationLogs",
    label: "notification records",
    model: NotificationLog,
    filter: (cutoff) => ({ createdAt: { $lt: cutoff } }),
  },
  {
    key: "aiUsageLogs",
    label: "AI usage/cost rows",
    model: AiUsageLog,
    filter: (cutoff) => ({ at: { $lt: cutoff } }),
  },
  {
    key: "decidedProposals",
    label: "decided message proposals (draft text)",
    model: MessageProposal,
    filter: (cutoff) => ({ status: { $in: ["SENT", "DECLINED"] }, updatedAt: { $lt: cutoff } }),
  },
  {
    key: "integrationSignals",
    label: "integration signal evidence rows",
    model: IntegrationSignal,
    filter: (cutoff) => ({ scannedAt: { $lt: cutoff } }),
  },
];

async function resolveSettings() {
  const doc = await RetentionSettings.getOrCreate();

  // Precedence: an approved DB setting wins; otherwise the env value; otherwise
  // the type stays undecided (null) and is skipped rather than guessed.
  const days = {};
  for (const target of TARGETS) {
    const fromDb = doc.days ? doc.days[target.key] : null;
    const fromEnv = config.retention.days[target.key];
    days[target.key] = fromDb !== null && fromDb !== undefined ? fromDb : fromEnv ?? null;
  }
  return {
    doc,
    enabled: Boolean(doc.enabled || config.retention.enabled),
    isApproved: doc.isApproved,
    days,
  };
}

async function persist(doc, report, applied) {
  doc.lastRunAt = new Date();
  doc.lastRunStats = { applied, report };
  await doc.save();
  await audit(
    { user: null },
    {
      action: "RETENTION_JOB_RUN",
      targetType: "RetentionSettings",
      targetId: doc._id,
      meta: { applied, report },
    }
  );
}

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set. Copy .env.example to .env first.");
  await mongoose.connect(uri);

  const settings = await resolveSettings();
  const decided = TARGETS.filter((t) => Number.isInteger(settings.days[t.key]));
  const undecided = TARGETS.filter((t) => !Number.isInteger(settings.days[t.key]));

  console.log(
    `[retention] mode=${APPLY ? "APPLY (deleting)" : "DRY-RUN (report only)"} ` +
      `enabled=${settings.enabled} approved=${settings.isApproved}`
  );

  if (undecided.length) {
    console.log(
      `[retention] no approved period for: ${undecided
        .map((t) => t.key)
        .join(", ")} - these are SKIPPED, not guessed.`
    );
  }

  const report = [];

  for (const t of decided) {
    const cutoff = cutoffFor(settings.days[t.key]);
    const matched = await t.model.countDocuments(t.filter(cutoff));
    let deleted = 0;
    let skipped = "";

    if (!settings.enabled) {
      skipped = "retention disabled - no deletion performed";
    } else if (APPLY) {
      const res = await t.model.deleteMany(t.filter(cutoff));
      deleted = res.deletedCount || 0;
    }

    console.log(
      `[retention] ${t.label}: ${matched} past ${settings.days[t.key]}d ` +
        `(${skipped || (APPLY ? `deleted ${deleted}` : "would delete")})`
    );
    report.push({ key: t.key, days: settings.days[t.key], matched, deleted, skipped });
  }

  if (!settings.enabled) {
    console.log(
      "[retention] retention is switched off (Section 12 decision outstanding) - nothing was deleted."
    );
  }
  console.log(
    "[retention] task/timeline records are business records and are never deleted by this job."
  );

  await persist(settings.doc, report, APPLY);
  await mongoose.disconnect();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[retention] failed:", err);
    process.exit(1);
  });