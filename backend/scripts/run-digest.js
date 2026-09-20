// Friday digest sender (Priority 5 / Section 8).
//
// Designed for cron/Task Scheduler on the Mac mini: run it every 30 minutes and
// it only sends inside the configured window (Friday 17:00 in the digest
// timezone by default), so nobody has to compute UTC offsets in a crontab.
//
// Safety:
//   - sends nothing unless DIGEST_SEND_ENABLED=true and NOTIFY_DRIVER=live
//     (otherwise it records a SIMULATED row and says so)
//   - --force sends immediately (used for testing and for a manual re-send)
//   - --dry-run prints the message without touching any model
//
// Usage:  npm run digest            (window-aware)
//         npm run digest -- --force
//         npm run digest -- --dry-run
require("dotenv").config();
const mongoose = require("mongoose");
const config = require("../config/env");
const digestController = require("../controllers/digestController");
const delivery = require("../services/delivery");
const { dayKey, partsInZone } = require("../utils/timezone");

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const DRY_RUN = args.includes("--dry-run");

async function run() {
  const d = config.notifications.digest;
  const now = new Date();
  const parts = partsInZone(now, d.timezone);

  const inWindow =
    parts.hour === d.hour && parts.minute >= d.minute && parts.minute < d.minute + 30;
  const correctDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() === d.dayOfWeek;

  console.log(
    `[digest] now=${dayKey(now, d.timezone)} ${String(parts.hour).padStart(2, "0")}:${String(
      parts.minute
    ).padStart(2, "0")} ${d.timezone} | window=${correctDay && inWindow ? "yes" : "no"}`
  );

  await mongoose.connect(process.env.MONGO_URI);

  const digest = await digestController.buildDigest({ weekOffset: 0 });
  console.log(`[digest] generated for week of ${digest.weekOf} (${digest.perPerson.length} people)`);

  if (DRY_RUN) {
    console.log("\n--- digest text (dry run, nothing sent) ---\n" + digest.whatsappText + "\n");
    await mongoose.disconnect();
    return;
  }

  if (!FORCE && !(correctDay && inWindow)) {
    console.log("[digest] outside the configured window - not sending. Use --force to override.");
    await mongoose.disconnect();
    return;
  }

  const { log, skipped } = await delivery.sendDigestWhatsApp({
    text: digest.whatsappText,
    meta: { weekOf: digest.weekOf, trigger: FORCE ? "manual_force" : "scheduled" },
  });

  console.log(
    `[digest] ${skipped ? "not transmitted (delivery disabled)" : "handed to adapter"}: ` +
      `status=${log ? log.status : "FAILED"} driver=${log ? log.driver : ""}`
  );
  if (log && log.error) console.log(`[digest] note: ${log.error}`);

  await mongoose.disconnect();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[digest] failed:", err);
    process.exit(1);
  });