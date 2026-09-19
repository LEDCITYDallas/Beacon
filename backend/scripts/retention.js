// Retention enforcement (Section 9 + Section 12 open decision).
//
// The retention period is an open client decision (proposed: 90 days, see
// docs/client-memo-open-decisions.md). This job implements whatever number
// is approved via RETENTION_DAYS so flipping the decision later is a
// one-line config change, not a code change.
//
// Deletes:
//   - ActivityLog rows older than the retention window (presence data)
//   - MessageProposal rows that were decided (SENT/DECLINED) older than
//     the window - approved/declined outbound text is transient
// Task/timeline records are business records and are NOT deleted.
//
// Run: npm run retention   (wire to cron/Task Scheduler on the Mac mini)
require("dotenv").config();
const mongoose = require("mongoose");
const ActivityLog = require("../models/ActivityLog");
const MessageProposal = require("../models/MessageProposal");

const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || "90", 10);

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGO_URI is not set. Copy .env.example to .env first.");
  }
  await mongoose.connect(uri);

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400 * 1000);
  console.log(`[retention] deleting data older than ${cutoff.toISOString()} (${RETENTION_DAYS} days)`);

  const activity = await ActivityLog.deleteMany({ at: { $lt: cutoff } });
  const proposals = await MessageProposal.deleteMany({
    status: { $in: ["SENT", "DECLINED"] },
    updatedAt: { $lt: cutoff },
  });

  console.log(
    `[retention] removed ${activity.deletedCount} activity rows, ` +
      `${proposals.deletedCount} decided message proposals`
  );

  await mongoose.disconnect();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[retention] failed:", err);
    process.exit(1);
  });
