const config = require("../config/env");
const PermissionSettings = require("../models/PermissionSettings");

// ---------------------------------------------------------------------
// Permission matrix (Priority 10 / Section 3).
//
// Section 3's three roles, expressed as capabilities so the frontend, the API
// and the assistant all read from ONE definition. Requirements Section 12
// leaves live-view scope and the real staff list open, so everything here is
// overridable at runtime through PUT /api/admin/permissions.
//
// The rules that are NOT overridable (hard requirements):
//   - an EMPLOYEE can never read another employee's tasks, timeline or status
//   - a MANAGER is always department-scoped
//   - only a SUPER_ADMIN gets global reporting + live-view session logs
// ---------------------------------------------------------------------

const DEFAULTS = {
  EMPLOYEE: {
    scope: "own", // own tasks, own timeline, own stats, own scorecard
    canCreateTasks: false,
    canManageTasks: false, // flag / reopen / assign
    canRateEmployees: false,
    canViewTeamQueue: false,
    canViewTeamPresence: false,
    canViewTeamScorecard: false,
    activityTracking: true, // activity/idle only - never screenshots
    screenshots: false,
    canRequestLiveView: false,
    canBeLiveViewed: true,
    canViewOwnScorecard: true,
  },
  MANAGER: {
    scope: "department",
    canCreateTasks: true,
    canManageTasks: true,
    canRateEmployees: true,
    canViewTeamQueue: true,
    canViewTeamPresence: true,
    canViewTeamScorecard: true,
    activityTracking: true,
    screenshots: false,
    canRequestLiveView: false, // Section 3: not granted automatically
    canBeLiveViewed: true,
    canViewOwnScorecard: true,
  },
  SUPER_ADMIN: {
    scope: "global",
    canCreateTasks: true,
    canManageTasks: true,
    canRateEmployees: true,
    canViewTeamQueue: true,
    canViewTeamPresence: true,
    canViewTeamScorecard: true,
    activityTracking: true,
    screenshots: false,
    canRequestLiveView: true,
    canBeLiveViewed: true,
    canViewOwnScorecard: true,
    canViewAuditLog: true,
    canViewAllScorecards: true,
    canManageSettings: true,
    canViewLiveViewLogs: true,
  },
};

// Live-view policy - the exact client decision left open in Section 12. Stored
// as data so it can change without a redeploy once Omair confirms.
const POLICY_DEFAULTS = {
  liveView: {
    allowedRoles: config.liveView.allowedRoles, // bootstrap from env
    excludeReducedMonitoring: config.liveView.excludeReducedMonitoring,
    requireEmployeeApproval: config.liveView.requireEmployeeApproval,
    // Screenshots stay off for every role - v1 is live view only.
    screenshotsEnabled: false,
  },
  activity: {
    idleThresholdMinutes: config.activity.idleThresholdMinutes,
    collectKeystrokes: false,
    collectScreenContent: false,
    collectWebcam: false,
    collectAudio: false,
  },
  ai: {
    assistantReadOnly: true, // the assistant may never mutate a task
    requireApprovalForSend: true,
    requireApprovalForCompletion: true,
    requireApprovalForHandoff: true,
  },
};

function deepMerge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] =
      k in out && typeof out[k] === "object" && !Array.isArray(out[k]) && out[k] !== null
        ? deepMerge(out[k], v)
        : v;
  }
  return out;
}

async function effectiveMatrix() {
  const doc = await PermissionSettings.getOrCreate();
  return deepMerge({ roles: DEFAULTS, policy: POLICY_DEFAULTS }, doc.overrides || {});
}

async function can(user, capability) {
  if (!user) return false;
  const matrix = await effectiveMatrix();
  const role = matrix.roles[user.role];
  return Boolean(role && role[capability]);
}

async function liveViewPolicy() {
  const matrix = await effectiveMatrix();
  return matrix.policy.liveView;
}

// Section 3/6: reduced-monitoring roles get activity/idle tracking only.
// Returns { allowed, reason } so the API can explain a refusal instead of
// silently hiding the button.
async function canBeLiveViewed(targetUser) {
  const policy = await liveViewPolicy();
  if (!targetUser || targetUser.isActive === false) {
    return { allowed: false, reason: "That account is not active." };
  }
  if (policy.excludeReducedMonitoring && targetUser.reducedMonitoring) {
    return {
      allowed: false,
      reason:
        "This role is on reduced monitoring: activity/idle tracking only, no screen view (Section 3/6).",
    };
  }
  if (targetUser.liveViewEnabled === false) {
    return { allowed: false, reason: "Live view is switched off for this employee." };
  }
  return { allowed: true, reason: "" };
}

async function canRequestLiveView(user) {
  const policy = await liveViewPolicy();
  if (!policy.allowedRoles.includes(user.role)) {
    return {
      allowed: false,
      reason: `Live view is limited to: ${policy.allowedRoles.join(", ")} (configurable pending the client decision).`,
    };
  }
  return { allowed: true, reason: "" };
}

// Only known keys may be overridden, so a typo (or an attacker) cannot invent
// a capability that the code never reads.
function validateOverrides(overrides) {
  const errors = [];
  if (overrides === undefined) return errors;
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
    return ["overrides must be an object"];
  }
  for (const [r, caps] of Object.entries(overrides.roles || {})) {
    if (!DEFAULTS[r]) {
      errors.push(`unknown role "${r}"`);
      continue;
    }
    for (const [k, v] of Object.entries(caps || {})) {
      if (!(k in DEFAULTS[r])) errors.push(`unknown capability "${r}.${k}"`);
      else if (typeof v !== typeof DEFAULTS[r][k]) {
        errors.push(`${r}.${k} must be a ${typeof DEFAULTS[r][k]}`);
      }
    }
  }
  for (const [p, keys] of Object.entries(overrides.policy || {})) {
    if (!POLICY_DEFAULTS[p]) {
      errors.push(`unknown policy group "${p}"`);
      continue;
    }
    for (const [k, v] of Object.entries(keys || {})) {
      if (!(k in POLICY_DEFAULTS[p])) errors.push(`unknown policy key "${p}.${k}"`);
      else if (Array.isArray(POLICY_DEFAULTS[p][k]) && !Array.isArray(v)) {
        errors.push(`${p}.${k} must be an array`);
      } else if (!Array.isArray(v) && typeof POLICY_DEFAULTS[p][k] !== typeof v) {
        errors.push(`${p}.${k} must be a ${typeof POLICY_DEFAULTS[p][k]}`);
      }
    }
  }

  // Hard requirements - no override can turn these back on.
  if (overrides.policy?.liveView?.screenshotsEnabled === true) {
    errors.push("screenshotsEnabled cannot be enabled: v1 is live-view only (Section 6)");
  }
  if (overrides.policy?.activity?.collectKeystrokes === true) {
    errors.push("collectKeystrokes is prohibited monitoring and cannot be enabled");
  }
  if (overrides.policy?.activity?.collectScreenContent === true) {
    errors.push("collectScreenContent cannot be enabled: live view is never stored (Section 6)");
  }
  if (overrides.policy?.activity?.collectWebcam === true || overrides.policy?.activity?.collectAudio === true) {
    errors.push("webcam/audio collection is prohibited monitoring and cannot be enabled");
  }
  if (overrides.policy?.ai?.assistantReadOnly === false) {
    errors.push("assistantReadOnly cannot be disabled: the assistant never mutates tasks (Section 5)");
  }
  return errors;
}

module.exports = {
  DEFAULTS,
  POLICY_DEFAULTS,
  deepMerge,
  effectiveMatrix,
  can,
  liveViewPolicy,
  canBeLiveViewed,
  canRequestLiveView,
  validateOverrides,
};
