const LiveViewSession = require("../../models/LiveViewSession");
const User = require("../../models/User");
const config = require("../../config/env");
const permissions = require("../permissions");
const frameBus = require("./frameBus");
const { audit } = require("../../utils/audit");

// ---------------------------------------------------------------------
// Live-view session service (Priority 3 / Section 6).
//
// Flow: an authorised admin REQUESTS a session -> the employee is prompted and
// APPROVES (the browser needs a user gesture to capture the screen anyway) ->
// frames stream in-memory to the admin -> either side ENDS it. The stored row
// keeps viewer, employee, start, end and duration only.
//
// Two decisions the client still owns are DATA here, not code:
//   - which roles may request live view (PermissionSettings.liveView.allowedRoles)
//   - whether reduced-monitoring roles are excluded (excludeReducedMonitoring)
// ---------------------------------------------------------------------

function endSession(session, { by = null, reason = "" } = {}) {
  if (["ENDED", "DENIED", "EXPIRED"].includes(session.status)) return session;
  const endAt = new Date();
  session.status = "ENDED";
  session.endedAt = endAt;
  session.endedBy = by ? by._id : null;
  session.endReason = reason;
  session.durationSeconds = session.startedAt
    ? Math.max(0, Math.round((endAt - session.startedAt) / 1000))
    : 0;
  frameBus.drop(session._id, { reason: reason || "session ended" });
  return session;
}

// Requests older than the TTL are auto-expired, so a forgotten prompt cannot be
// approved hours later, and an abandoned ACTIVE session cannot hold a stream
// open forever.
async function sweepStaleSessions() {
  const now = Date.now();
  const requestedCutoff = new Date(now - config.liveView.requestTtlSeconds * 1000);
  const idleCutoff = new Date(now - config.liveView.idleTimeoutSeconds * 1000);

  const stale = await LiveViewSession.find({
    $or: [
      { status: "REQUESTED", requestedAt: { $lt: requestedCutoff } },
      {
        status: "ACTIVE",
        $or: [
          { lastFrameAt: { $lt: idleCutoff } },
          { lastFrameAt: null, startedAt: { $lt: idleCutoff } },
        ],
      },
    ],
  });

  const swept = [];
  for (const s of stale) {
    if (s.status === "REQUESTED") {
      s.status = "EXPIRED";
      s.endedAt = new Date();
      s.endReason = "request timed out without a response";
    } else {
      endSession(s, { reason: "no activity for the configured idle timeout" });
    }
    await s.save();
    frameBus.drop(s._id, { reason: s.endReason });
    swept.push(String(s._id));
  }
  return swept;
}

async function requestSession({ viewer, employeeId, reason = "" }) {
  const policyCheck = await permissions.canRequestLiveView(viewer);
  if (!policyCheck.allowed) {
    const err = new Error(policyCheck.reason);
    err.code = "LIVEVIEW_ROLE_NOT_ALLOWED";
    err.status = 403;
    throw err;
  }

  const target = await User.findById(employeeId).select(
    "name email role department reducedMonitoring isActive liveViewEnabled timezone"
  );
  if (!target) {
    const err = new Error("Employee not found");
    err.code = "LIVEVIEW_TARGET_NOT_FOUND";
    err.status = 404;
    throw err;
  }
  if (String(target._id) === String(viewer._id)) {
    const err = new Error("You cannot start a live view of your own session");
    err.code = "LIVEVIEW_SELF";
    err.status = 400;
    throw err;
  }
  if (viewer.role === "MANAGER" && target.department !== viewer.department) {
    const err = new Error("Outside your department");
    err.code = "LIVEVIEW_OUTSIDE_DEPARTMENT";
    err.status = 403;
    throw err;
  }

  const allowed = await permissions.canBeLiveViewed(target);
  if (!allowed.allowed) {
    const err = new Error(allowed.reason);
    err.code = "LIVEVIEW_TARGET_NOT_ALLOWED";
    err.status = 403;
    throw err;
  }

  const policy = await permissions.liveViewPolicy();

  // One live stream per employee at a time keeps the record unambiguous.
  const existing = await LiveViewSession.findOne({ employee: target._id, status: "ACTIVE" });
  if (existing) {
    const err = new Error("A live view of this employee is already active");
    err.code = "LIVEVIEW_ALREADY_ACTIVE";
    err.status = 409;
    throw err;
  }

  const session = await LiveViewSession.create({
    viewer: viewer._id,
    employee: target._id,
    reason: String(reason || "").slice(0, 300),
    status: policy.requireEmployeeApproval ? "REQUESTED" : "ACTIVE",
    requestedAt: new Date(),
    ...(policy.requireEmployeeApproval ? {} : { startedAt: new Date() }),
  });

  await audit(
    { user: viewer },
    {
      action: "LIVEVIEW_REQUESTED",
      targetType: "LiveViewSession",
      targetId: session._id,
      meta: {
        employeeId: String(target._id),
        employeeName: target.name,
        reason: session.reason,
        requireEmployeeApproval: policy.requireEmployeeApproval,
      },
    }
  );

  return { session, target, policy };
}

function badRequest(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

async function approveSession({ session, employee }) {
  if (String(session.employee) !== String(employee._id)) {
    throw badRequest("LIVEVIEW_FORBIDDEN", "This request is not yours to approve", 403);
  }
  if (session.status !== "REQUESTED") {
    throw badRequest("LIVEVIEW_BAD_STATE", `This request is already ${session.status}`);
  }
  session.status = "ACTIVE";
  session.employeeRespondedAt = new Date();
  session.startedAt = new Date();
  await session.save();
  frameBus.notify(session._id, "approved", { at: session.startedAt });
  await audit(
    { user: employee },
    {
      action: "LIVEVIEW_APPROVED",
      targetType: "LiveViewSession",
      targetId: session._id,
      meta: { viewerId: String(session.viewer) },
    }
  );
  return session;
}

async function denySession({ session, employee }) {
  if (String(session.employee) !== String(employee._id)) {
    throw badRequest("LIVEVIEW_FORBIDDEN", "This request is not yours to decline", 403);
  }
  if (session.status !== "REQUESTED") {
    throw badRequest("LIVEVIEW_BAD_STATE", `This request is already ${session.status}`);
  }
  session.status = "DENIED";
  session.employeeRespondedAt = new Date();
  session.endedAt = new Date();
  session.endReason = "declined by the employee";
  await session.save();
  frameBus.notify(session._id, "denied", { at: session.endedAt });
  await audit(
    { user: employee },
    {
      action: "LIVEVIEW_DENIED",
      targetType: "LiveViewSession",
      targetId: session._id,
      meta: { viewerId: String(session.viewer) },
    }
  );
  return session;
}

// Accepts one frame from the viewed employee. Size-capped and throttled; the
// bytes only ever reach the in-memory bus.
function acceptFrame({ session, employee, image, contentType }) {
  if (String(session.employee) !== String(employee._id)) {
    throw badRequest("LIVEVIEW_FORBIDDEN", "This session does not belong to you", 403);
  }
  if (session.status !== "ACTIVE") {
    throw badRequest("LIVEVIEW_NOT_ACTIVE", "Live view is not active", 409);
  }
  if (!image || typeof image !== "string") {
    throw badRequest("LIVEVIEW_BAD_FRAME", "image (base64) is required");
  }

  const buffer = Buffer.from(image, "base64");
  if (buffer.length > config.liveView.maxFrameBytes) {
    throw badRequest("LIVEVIEW_FRAME_TOO_LARGE", "Frame exceeds the configured size limit", 413);
  }

  const result = frameBus.publish(session._id, {
    buffer,
    contentType: contentType || "image/jpeg",
  });

  if (result.published) session.lastFrameAt = new Date();
  return result;
}

async function endByRequest({ session, user, reason = "ended by request" }) {
  const isViewer = String(session.viewer) === String(user._id);
  const isEmployee = String(session.employee) === String(user._id);
  const isSuper = user.role === "SUPER_ADMIN";
  if (!isViewer && !isEmployee && !isSuper) {
    throw badRequest(
      "LIVEVIEW_FORBIDDEN",
      "Only the viewer, the employee or a Super Admin can end this session",
      403
    );
  }
  endSession(session, { by: user, reason });
  await session.save();
  await audit(
    { user },
    {
      action: "LIVEVIEW_ENDED",
      targetType: "LiveViewSession",
      targetId: session._id,
      meta: { durationSeconds: session.durationSeconds, reason: session.endReason },
    }
  );
  return session;
}

// Session logs are SUPER_ADMIN only (Section 6: session logs visible to
// Super Admin only). Managers never get this list, even with team access.
function logView(session) {
  return {
    id: session._id,
    viewer: session.viewer,
    employee: session.employee,
    status: session.status,
    reason: session.reason,
    requestedAt: session.requestedAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationSeconds: session.durationSeconds,
    durationLabel: session.durationSeconds
      ? `${Math.floor(session.durationSeconds / 60)}m ${session.durationSeconds % 60}s`
      : "",
    endReason: session.endReason,
    // Counters only - no frame, thumbnail or recording exists anywhere.
    framesServed: session.framesServed,
  };
}

module.exports = {
  requestSession,
  approveSession,
  denySession,
  acceptFrame,
  endSession,
  endByRequest,
  sweepStaleSessions,
  logView,
};