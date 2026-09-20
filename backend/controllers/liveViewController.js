const LiveViewSession = require("../models/LiveViewSession");
const User = require("../models/User");
const permissions = require("../services/permissions");
const sessionService = require("../services/liveview/sessionService");
const frameBus = require("../services/liveview/frameBus");
const config = require("../config/env");
const activityController = require("./activityController");
const { audit } = require("../utils/audit");

// ---------------------------------------------------------------------
// Live view controller (Priority 3 / Section 6).
//
// Authorization is enforced here on every endpoint, not in the UI:
//   - requesting a session requires a role in liveView.allowedRoles
//   - the target must not be excluded (reduced monitoring / switched off)
//   - only the viewed employee may approve, deny or send frames
//   - only the viewer (or a Super Admin) may subscribe to the stream
//   - only a Super Admin may read the session LOG
//
// Nothing is stored but the session log row: frames live in memory with a
// 5-second TTL and are dropped when the session ends.
// ---------------------------------------------------------------------

function fail(res, err) {
  const status = err.status || 500;
  return res.status(status).json({ message: err.message, code: err.code || "ERROR" });
}

// Policy + capability snapshot for the UI. The client does not decide the rules.
exports.getConfig = async (req, res) => {
  const [policy, requester, matrix] = await Promise.all([
    permissions.liveViewPolicy(),
    permissions.canRequestLiveView(req.user),
    permissions.effectiveMatrix(),
  ]);
  res.json({
    allowedRoles: policy.allowedRoles,
    excludeReducedMonitoring: policy.excludeReducedMonitoring,
    requireEmployeeApproval: policy.requireEmployeeApproval,
    // Screenshots remain off for every role - v1 is live view only.
    screenshotsEnabled: policy.screenshotsEnabled,
    storage: {
      framesStored: false,
      frameTtlSeconds: config.liveView.frameTtlSeconds,
      recordingPersisted: false,
      note: "Live view is view-only: no recording, no screenshot, no persisted frame (Section 6).",
    },
    canRequest: requester.allowed,
    canRequestReason: requester.reason,
    canViewLogs: Boolean(matrix.roles[req.user.role]?.canViewLiveViewLogs),
    presenceSample: frameBus.stats(),
  });
};

// Who this admin may view right now (with presence so the picker is useful).
exports.getTargets = async (req, res) => {
  const requester = await permissions.canRequestLiveView(req.user);
  if (!requester.allowed) return res.status(403).json({ message: requester.reason, code: "LIVEVIEW_ROLE_NOT_ALLOWED" });

  const filter = req.user.role === "MANAGER" ? { department: req.user.department } : {};
  const people = await User.find({ ...filter, isActive: true }).select(
    "name email role department reducedMonitoring timezone liveViewEnabled"
  );

  const out = [];
  for (const p of people) {
    if (String(p._id) === String(req.user._id)) continue;
    const allowed = await permissions.canBeLiveViewed(p);
    const state = await activityController.currentState(p._id);
    out.push({
      userId: p._id,
      name: p.name,
      department: p.department,
      role: p.role,
      timezone: p.timezone,
      reducedMonitoring: p.reducedMonitoring,
      canBeViewed: allowed.allowed,
      reason: allowed.reason,
      status: state.status,
      lastActivityAt: state.lastActivityAt,
    });
  }
  res.json(out);
};

exports.requestSession = async (req, res) => {
  try {
    const { employeeId, reason } = req.body;
    if (!employeeId) return res.status(400).json({ message: "employeeId is required" });
    const { session, target, policy } = await sessionService.requestSession({
      viewer: req.user,
      employeeId,
      reason,
    });
    res.status(201).json({
      session: sessionService.logView(session),
      employee: { id: target._id, name: target.name, department: target.department },
      requiresEmployeeApproval: policy.requireEmployeeApproval,
      message: policy.requireEmployeeApproval
        ? "Request created. The employee must allow it before any frame is sent."
        : "Session active. No frame is sent until the employee's client starts sharing.",
    });
  } catch (err) {
    return fail(res, err);
  }
};

// What this employee must respond to / is currently sharing.
exports.forMe = async (req, res) => {
  await sessionService.sweepStaleSessions();
  const [pending, active] = await Promise.all([
    LiveViewSession.findOne({ employee: req.user._id, status: "REQUESTED" })
      .populate("viewer", "name role department")
      .sort({ requestedAt: -1 }),
    LiveViewSession.findOne({ employee: req.user._id, status: "ACTIVE" })
      .populate("viewer", "name role department")
      .sort({ startedAt: -1 }),
  ]);

  res.json({
    pending: pending
      ? {
          id: pending._id,
          viewerName: pending.viewer ? pending.viewer.name : "an administrator",
          viewerRole: pending.viewer ? pending.viewer.role : "",
          reason: pending.reason,
          requestedAt: pending.requestedAt,
          expiresInSeconds: Math.max(
            0,
            config.liveView.requestTtlSeconds -
              Math.round((Date.now() - pending.requestedAt.getTime()) / 1000)
          ),
        }
      : null,
    active: active
      ? {
          id: active._id,
          viewerName: active.viewer ? active.viewer.name : "an administrator",
          startedAt: active.startedAt,
          framesSent: active.framesServed,
        }
      : null,
    // Repeated to the employee's client: nothing is recorded.
    notice: "Live view is view-only. Your screen is never recorded, saved or screenshotted.",
  });
};

exports.approveSession = async (req, res) => {
  const session = await LiveViewSession.findById(req.params.id);
  if (!session) return res.status(404).json({ message: "Session not found" });
  try {
    await sessionService.approveSession({ session, employee: req.user });
    res.json({
      session: sessionService.logView(session),
      message: "Live view allowed - you can stop it at any time.",
    });
  } catch (err) {
    return fail(res, err);
  }
};

exports.denySession = async (req, res) => {
  const session = await LiveViewSession.findById(req.params.id);
  if (!session) return res.status(404).json({ message: "Session not found" });
  try {
    await sessionService.denySession({ session, employee: req.user });
    res.json({ session: sessionService.logView(session), message: "Live view declined." });
  } catch (err) {
    return fail(res, err);
  }
};

// One frame from the viewed employee's client. Held in memory only.
exports.postFrame = async (req, res) => {
  const session = await LiveViewSession.findById(req.params.id);
  if (!session) return res.status(404).json({ message: "Session not found" });
  try {
    const result = sessionService.acceptFrame({
      session,
      employee: req.user,
      image: req.body.image,
      contentType: req.body.contentType,
    });
    if (result.published) {
      session.framesServed += 1;
      await session.save();
    }
    res.json({
      accepted: result.published,
      reason: result.reason || "",
      framesServed: session.framesServed,
      stored: false,
    });
  } catch (err) {
    return fail(res, err);
  }
};

// Server-sent events: the admin's browser reads live frames through a fetch
// stream (keeping the Authorization header), so the app itself never puts a
// token in the URL. Only the viewer or a Super Admin may subscribe.
exports.stream = async (req, res) => {
  const session = await LiveViewSession.findById(req.params.id).populate("employee", "name");
  if (!session) return res.status(404).json({ message: "Session not found" });

  const isViewer = String(session.viewer) === String(req.user._id);
  const isSuper = req.user.role === "SUPER_ADMIN";
  if (!isViewer && !isSuper) {
    return res.status(403).json({ message: "You are not the viewer of this session" });
  }
  if (session.status !== "ACTIVE") {
    return res.status(409).json({ message: `Session is ${session.status}` });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(
    `event: open\ndata: ${JSON.stringify({
      sessionId: String(session._id),
      employee: session.employee ? session.employee.name : "",
      startedAt: session.startedAt,
      recording: false,
      framesStored: false,
    })}\n\n`
  );

  const latest = frameBus.latest(session._id);
  if (latest) {
    res.write(
      `event: frame\ndata: ${JSON.stringify({
        seq: latest.seq,
        at: latest.at,
        contentType: latest.contentType,
        image: latest.buffer.toString("base64"),
      })}\n\n`
    );
  }

  const unsubscribe = frameBus.subscribe(session._id, res);
  const keepAlive = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
    } catch {
      /* stream already closed */
    }
  }, 15000);

  const cleanup = () => {
    clearInterval(keepAlive);
    unsubscribe();
  };
  req.on("close", cleanup);
  req.on("aborted", cleanup);
  return undefined;
};

exports.endSession = async (req, res) => {
  const session = await LiveViewSession.findById(req.params.id);
  if (!session) return res.status(404).json({ message: "Session not found" });
  try {
    await sessionService.endByRequest({
      session,
      user: req.user,
      reason: String((req.body && req.body.reason) || "ended by request").slice(0, 200),
    });
    res.json({
      session: sessionService.logView(session),
      message: "Live view ended. Nothing was stored.",
    });
  } catch (err) {
    return fail(res, err);
  }
};

// The viewer's own sessions, so their UI can reconnect to an active stream.
exports.mySessions = async (req, res) => {
  await sessionService.sweepStaleSessions();
  const rows = await LiveViewSession.find({ viewer: req.user._id })
    .populate("employee", "name department")
    .sort({ requestedAt: -1 })
    .limit(25);
  res.json(
    rows.map((s) => ({
      ...sessionService.logView(s),
      employeeName: s.employee ? s.employee.name : "",
      employeeDepartment: s.employee ? s.employee.department : "",
    }))
  );
};

// Session LOG - Super Admin only (Section 6). Managers are refused here even
// though they hold other team-level access.
exports.listSessions = async (req, res) => {
  const matrix = await permissions.effectiveMatrix();
  if (!matrix.roles[req.user.role]?.canViewLiveViewLogs) {
    return res.status(403).json({
      message: "Live-view session logs are restricted to the Super Admin (Section 6)",
      code: "LIVEVIEW_LOGS_SUPERADMIN_ONLY",
    });
  }
  await sessionService.sweepStaleSessions();

  const query = {};
  if (req.query.employeeId) query.employee = req.query.employeeId;
  if (req.query.viewerId) query.viewer = req.query.viewerId;
  if (req.query.status) query.status = String(req.query.status).toUpperCase();
  if (req.query.from || req.query.to) {
    query.requestedAt = {};
    if (req.query.from) query.requestedAt.$gte = new Date(req.query.from);
    if (req.query.to) query.requestedAt.$lte = new Date(req.query.to);
  }

  const rows = await LiveViewSession.find(query)
    .populate("viewer", "name role")
    .populate("employee", "name department")
    .sort({ requestedAt: -1 })
    .limit(Math.min(200, Number(req.query.limit) || 50));

  res.json({
    returned: rows.length,
    storage: "Session log only - no recording or screenshot is ever persisted.",
    sessions: rows.map((s) => ({
      ...sessionService.logView(s),
      viewerName: s.viewer ? s.viewer.name : "",
      viewerRole: s.viewer ? s.viewer.role : "",
      employeeName: s.employee ? s.employee.name : "",
      employeeDepartment: s.employee ? s.employee.department : "",
    })),
  });
};

exports.auditEntry = audit;