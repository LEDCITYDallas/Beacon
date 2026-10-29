import React, { useCallback, useEffect, useRef, useState } from "react";
import client from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatDateTime, formatDuration } from "../utils/format";
import PageHeader from "../components/PageHeader";

// ---------------------------------------------------------------------
// Live screen view - admin side (Priority 3 / Section 6).
//
// Can do: request a view of an employee, watch the live stream once the
// employee allows it, and end the session.
//
// Deliberately cannot: record, screenshot, replay or store the stream. Frames
// live in the server's memory bus for a few seconds and are dropped when the
// session ends. The session LOG (who viewed whom, when, how long) is visible to
// the Super Admin only.
// ---------------------------------------------------------------------

interface Target {
  userId: string;
  name: string;
  department: string;
  role: string;
  reducedMonitoring: boolean;
  canBeViewed: boolean;
  reason: string;
  status: string;
  lastActivityAt: string | null;
}

interface SessionLog {
  id: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  durationLabel: string;
  framesServed: number;
  endReason: string;
  employeeName?: string;
  viewerName?: string;
  employeeDepartment?: string;
}

interface LiveViewConfig {
  allowedRoles: string[];
  excludeReducedMonitoring: boolean;
  requireEmployeeApproval: boolean;
  screenshotsEnabled: boolean;
  canRequest: boolean;
  canRequestReason: string;
  canViewLogs: boolean;
  storage: {
    framesStored: boolean;
    frameTtlSeconds: number;
    recordingPersisted: boolean;
    note: string;
  };
}

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api";

export default function LiveView() {
  const { user } = useAuth();
  const [config, setConfig] = useState<LiveViewConfig | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [sessions, setSessions] = useState<SessionLog[]>([]);
  const [logs, setLogs] = useState<SessionLog[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [watching, setWatching] = useState<string | null>(null);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [frame, setFrame] = useState("");
  const [frameSeq, setFrameSeq] = useState<number | null>(null);
  const streamAbort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const cfg = await client.get("/liveview/config").catch(() => null);
    if (cfg) setConfig(cfg.data);
    if (cfg?.data?.canRequest) {
      const t = await client.get("/liveview/targets").catch(() => null);
      if (t) setTargets(t.data);
      const mine = await client.get("/liveview/sessions/mine").catch(() => null);
      if (mine) setSessions(mine.data);
    }
    if (cfg?.data?.canViewLogs) {
      const l = await client.get("/liveview/sessions").catch(() => null);
      if (l) setLogs(l.data.sessions);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 15000);
    return () => {
      clearInterval(id);
      streamAbort.current?.abort();
    };
  }, [load]);

  async function request(employeeId: string, name: string) {
    if (requestingId) return;
    setRequestingId(employeeId);
    setError("");
    setNotice("");
    try {
      const res = await client.post("/liveview/sessions", { employeeId, reason });
      setNotice(`${res.data.message} (${name})`);
      setReason("");
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || "Could not create the request");
    } finally {
      setRequestingId(null);
    }
  }

  async function end(sessionId: string) {
    streamAbort.current?.abort();
    setWatching(null);
    setFrame("");
    setError("");
    try {
      await client.post(`/liveview/sessions/${sessionId}/end`, { reason: "ended by viewer" });
      setNotice("Live view ended. No frame or recording was stored.");
      await load();
    } catch (err: any) {
      setNotice("");
      setError(err.response?.data?.message || "Could not end the live view.");
    }
  }

  // Reads the SSE stream with a normal fetch so the Authorization header is
  // used - the app never puts a token in the URL.
  async function watch(sessionId: string) {
    setError("");
    setWatching(sessionId);
    setFrame("");
    streamAbort.current?.abort();
    const controller = new AbortController();
    streamAbort.current = controller;
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/liveview/sessions/${sessionId}/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Stream unavailable (HTTP ${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          const eventMatch = chunk.match(/^event: (.+)$/m);
          const dataMatch = chunk.match(/^data: (.+)$/m);
          if (!eventMatch || !dataMatch) continue;
          const event = eventMatch[1];
          const payload = JSON.parse(dataMatch[1]);
          if (event === "frame" && payload.image) {
            setFrame(`data:${payload.contentType || "image/jpeg"};base64,${payload.image}`);
            setFrameSeq(payload.seq);
          }
          if (event === "ended" || event === "denied") {
            setNotice(`Session ${event}${payload.reason ? `: ${payload.reason}` : ""}`);
            setWatching(null);
            setFrame("");
            await load();
            return;
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") setError(err.message || "Stream failed");
      setWatching(null);
    }
  }

  if (!user) return null;

  return (
    <div>
      <PageHeader
        title="Live screen view"
        description="View-only, session-logged, and never recorded. Role scope is configurable pending the client decision (Section 12)."
      />

      {config && (
        <div className="card card-muted">
          <p className="text-xs muted mb-0">
            Allowed roles: <strong>{config.allowedRoles.join(", ")}</strong> · reduced monitoring
            excluded: <strong>{String(config.excludeReducedMonitoring)}</strong> · employee approval
            required: <strong>{String(config.requireEmployeeApproval)}</strong> · screenshots:{" "}
            <strong>{config.screenshotsEnabled ? "ON" : "off for every role"}</strong>
          </p>
          <p className="text-micro muted mt-2 mb-0">
            {config.storage.note} Frames are discarded after {config.storage.frameTtlSeconds}s even
            while you watch.
          </p>
          {!config.canRequest && (
            <p className="text-xs text-warning mt-2 mb-0">{config.canRequestReason}</p>
          )}
        </div>
      )}

      {error && <p className="notice notice-danger" role="alert">{error}</p>}
      {notice && <p className="notice notice-success" role="status">{notice}</p>}
      {watching && (
        <div className="card card-live">
          <div className="card-head">
            <h3 className="card-title mb-0">
              Watching live
              {frameSeq !== null && <span className="text-micro muted"> — frame #{frameSeq}</span>}
            </h3>
            <button className="btn btn-danger" onClick={() => void end(watching)}>
              End live view
            </button>
          </div>
          <div className="live-stage">
            {frame ? (
              <img src={frame} alt="Live view frame" />
            ) : (
              <p>Waiting for the employee to start sharing…</p>
            )}
          </div>
          <p className="text-micro muted mb-0 mt-3">
            This stream is not being recorded. Closing this view or ending the session discards the
            frames.
          </p>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="card">
          <h3 className="card-title">My recent sessions</h3>
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Status</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Frames</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.employeeName || "—"}</td>
                  <td>{s.status}</td>
                  <td>{s.startedAt ? formatDateTime(s.startedAt, user.timezone) : "—"}</td>
                  <td>{s.durationLabel || formatDuration(s.durationSeconds)}</td>
                  <td>{s.framesServed}</td>
                  <td>
                    {s.status === "ACTIVE" && (
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => void watch(s.id)}
                      >
                        Watch
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {targets.length > 0 && (
        <div className="card">
          <h3 className="card-title">Employees you may view</h3>
          <label>Reason shown to the employee (optional)</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. checking a display configuration with the customer waiting"
          />
          <table className="mt-3">
            <thead>
              <tr>
                <th>Name</th>
                <th>Department</th>
                <th>Activity</th>
                <th>Viewable</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.userId}>
                  <td>
                    {t.name}
                    {t.reducedMonitoring && (
                      <span className="text-micro muted"> (reduced monitoring)</span>
                    )}
                  </td>
                  <td>{t.department}</td>
                  <td>{t.status === "ACTIVE" ? "Active" : "On break / inactive"}</td>
                  <td className={t.canBeViewed ? "text-success text-xs" : "text-warning text-xs"}>
                    {t.canBeViewed ? "yes" : t.reason}
                  </td>
                  <td>
                    <button
                      className="btn btn-outline btn-sm"
                      disabled={!t.canBeViewed || requestingId === t.userId}
                      onClick={() => void request(t.userId, t.name)}
                    >
                      {requestingId === t.userId ? "Requesting…" : "Request view"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {config?.canViewLogs && (
        <div className="card">
          <h3 className="card-title">Session log (Super Admin only)</h3>
          <p className="card-intro">
            Who was viewed, by whom, when, and for how long. Session records only — no frame,
            thumbnail or recording exists anywhere in this system.
          </p>
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Viewer</th>
                <th>Status</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Ended because</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((s) => (
                <tr key={s.id}>
                  <td>{s.employeeName || "—"}</td>
                  <td>{s.viewerName || "—"}</td>
                  <td>{s.status}</td>
                  <td>{s.startedAt ? formatDateTime(s.startedAt, user.timezone) : "—"}</td>
                  <td>{s.durationLabel || formatDuration(s.durationSeconds)}</td>
                  <td className="text-xs muted">{s.endReason || "—"}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="cell-empty">
                    No live-view sessions recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
