const AiUsageLog = require("../../models/AiUsageLog");
const User = require("../../models/User");
const config = require("../../config/env");
const { AiError } = require("./provider");
const { dayKey, weekStartInZone } = require("../../utils/timezone");

// ---------------------------------------------------------------------
// AI usage ledger (Priority 1).
//
// Section 5 requires a monthly cost estimate, and the client memo promises the
// Super Admin can watch the real bill forming. Every provider call lands here
// with token counts and an estimated cost at published list prices.
//
// Two controls live here as well:
//   - a per-user daily call limit, so a runaway loop or a stuck client cannot
//     burn the budget unattended;
//   - the usage summary used by GET /api/admin/ai-usage.
// No prompt or answer text is stored - counts only.
// ---------------------------------------------------------------------

async function recordUsage({ user, kind, result, ok = true, errorCode = "" }) {
  try {
    const usage = (result && result.usage) || {};
    await AiUsageLog.create({
      user: user && user._id,
      kind,
      provider: (result && result.provider) || "mock",
      model: (result && result.model) || "",
      promptTokens: usage.promptTokens || 0,
      completionTokens: usage.completionTokens || 0,
      totalTokens: usage.totalTokens || 0,
      estCostUsd: usage.estCostUsd || 0,
      latencyMs: (result && result.latencyMs) || 0,
      ok,
      fallback: Boolean(result && result.fallback),
      errorCode: errorCode || (result && result.errorCode) || "",
      dayKey: dayKey(new Date(), (user && user.timezone) || undefined),
      at: new Date(),
    });
  } catch (err) {
    // Usage accounting must never break the employee's answer.
    console.error("[ai-usage] failed to record", err.message);
  }
}

async function assertWithinDailyLimit(user) {
  const limit = config.ai.dailyCallLimitPerUser;
  if (!limit || limit <= 0) return;
  const today = dayKey(new Date(), user.timezone || undefined);
  const used = await AiUsageLog.countDocuments({ user: user._id, dayKey: today });
  if (used >= limit) {
    throw new AiError(
      "AI_USAGE_LIMIT",
      `Daily assistant limit reached (${limit} calls). It resets at midnight in your timezone.`,
      { status: 429 }
    );
  }
}

// Aggregated view for the Super Admin dashboard.
async function usageSummary({ days = 30, timezone = "America/Chicago" } = {}) {
  const now = new Date();
  const from = new Date(now.getTime() - days * 86400 * 1000);

  const [totals, byDay, byKind, byUser] = await Promise.all([
    AiUsageLog.aggregate([
      { $match: { at: { $gte: from } } },
      {
        $group: {
          _id: null,
          calls: { $sum: 1 },
          promptTokens: { $sum: "$promptTokens" },
          completionTokens: { $sum: "$completionTokens" },
          estCostUsd: { $sum: "$estCostUsd" },
          failures: { $sum: { $cond: [{ $eq: ["$ok", false] }, 1, 0] } },
          fallbacks: { $sum: { $cond: ["$fallback", true, false] } },
        },
      },
    ]),
    AiUsageLog.aggregate([
      { $match: { at: { $gte: from } } },
      {
        $group: {
          _id: "$dayKey",
          calls: { $sum: 1 },
          totalTokens: { $sum: "$totalTokens" },
          estCostUsd: { $sum: "$estCostUsd" },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    AiUsageLog.aggregate([
      { $match: { at: { $gte: from } } },
      { $group: { _id: "$kind", calls: { $sum: 1 }, estCostUsd: { $sum: "$estCostUsd" } } },
      { $sort: { calls: -1 } },
    ]),
    AiUsageLog.aggregate([
      { $match: { at: { $gte: from } } },
      {
        $group: {
          _id: "$user",
          calls: { $sum: 1 },
          totalTokens: { $sum: "$totalTokens" },
          estCostUsd: { $sum: "$estCostUsd" },
        },
      },
      { $sort: { estCostUsd: -1 } },
      { $limit: 25 },
    ]),
  ]);

  const t = totals[0] || {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    estCostUsd: 0,
    failures: 0,
    fallbacks: 0,
  };

  // "This month" is measured from the month start (week boundary helper keeps
  // the timezone logic in one place).
  const monthFrom = weekStartInZone(new Date(now.getFullYear(), now.getMonth(), 1), timezone);
  const monthAgg = await AiUsageLog.aggregate([
    { $match: { at: { $gte: monthFrom } } },
    { $group: { _id: null, calls: { $sum: 1 }, estCostUsd: { $sum: "$estCostUsd" } } },
  ]);
  const month = monthAgg[0] || { calls: 0, estCostUsd: 0 };

  const userIds = byUser.map((u) => u._id).filter(Boolean);
  const users = await User.find({ _id: { $in: userIds } }).select("name email department");
  const nameOf = new Map(users.map((u) => [String(u._id), u]));

  return {
    windowDays: days,
    windowStart: from,
    totals: {
      calls: t.calls,
      promptTokens: t.promptTokens,
      completionTokens: t.completionTokens,
      totalTokens: t.promptTokens + t.completionTokens,
      estCostUsd: Number((t.estCostUsd || 0).toFixed(4)),
      failures: t.failures,
      fallbacks: t.fallbacks,
    },
    month: {
      calls: month.calls,
      estCostUsd: Number((month.estCostUsd || 0).toFixed(4)),
      budgetUsd: config.ai.monthlyBudgetUsd,
      overBudget: month.estCostUsd > config.ai.monthlyBudgetUsd,
    },
    byDay,
    byKind,
    byUser: byUser.map((u) => ({
      userId: u._id,
      name: nameOf.get(String(u._id))?.name || "(removed user)",
      department: nameOf.get(String(u._id))?.department || "",
      calls: u.calls,
      totalTokens: u.totalTokens,
      estCostUsd: Number((u.estCostUsd || 0).toFixed(4)),
    })),
  };
}

module.exports = { recordUsage, assertWithinDailyLimit, usageSummary };