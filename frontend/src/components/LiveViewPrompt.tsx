import React from "react";
import { useLiveViewEmployee } from "../hooks/useLiveViewEmployee";

// Employee-facing live-view prompt (Priority 3 / Section 6).
//
// Shown whenever an administrator requests a view, and while a session is
// active. The employee sees exactly who is viewing, must allow it, and can stop
// it at any time. The disclosure text is repeated here rather than only on the
// consent screen, because "administrators may perform screen checks" is the
// specific thing being agreed to at this moment.
export default function LiveViewPrompt() {
  const { pending, active, sharing, framesSent, error, approve, deny, startSharing, stopSharing } =
    useLiveViewEmployee();

  if (!pending && !active) return null;

  return (
    <div
      className="card"
      style={{
        border: `1px solid ${pending ? "var(--warning)" : "var(--danger)"}`,
        background: "var(--surface-2)",
      }}
    >
      {pending && (
        <>
          <h3 style={{ marginTop: 0, color: "var(--warning)" }}>
            Screen view request from {pending.viewerName}
          </h3>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {pending.viewerName} ({pending.viewerRole}) is asking to view your screen
            {pending.reason ? ` — reason: “${pending.reason}”` : ""}. The request expires in{" "}
            {pending.expiresInSeconds}s.
          </p>
          <p style={{ fontSize: 13 }}>
            Live view is <strong>view-only</strong>: nothing is recorded, saved or screenshotted. You
            can stop sharing at any moment.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={() => void approve(pending.id)}>
              Allow
            </button>
            <button className="btn btn-outline" onClick={() => void deny(pending.id)}>
              Decline
            </button>
          </div>
        </>
      )}

      {active && (
        <>
          <h3 style={{ marginTop: 0, color: sharing ? "var(--danger)" : "var(--warning)" }}>
            {sharing ? `Sharing your screen with ${active.viewerName}` : `Live view ready — ${active.viewerName}`}
          </h3>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Started {new Date(active.startedAt).toLocaleTimeString()}. Frames sent: {framesSent}. Nothing
            is stored on your machine or the server.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            {!sharing ? (
              <button className="btn" onClick={() => void startSharing()}>
                Start sharing
              </button>
            ) : (
              <button className="btn btn-danger" onClick={() => void stopSharing(true)}>
                Stop sharing
              </button>
            )}
          </div>
        </>
      )}

      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
    </div>
  );
}
