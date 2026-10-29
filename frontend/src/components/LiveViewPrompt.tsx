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
    <div className="card card-inset card-warn">
      {pending && (
        <>
          <h3 className="card-title prompt-title-warning">
            Screen view request from {pending.viewerName}
          </h3>
          <p className="card-intro">
            {pending.viewerName} ({pending.viewerRole}) is asking to view your screen
            {pending.reason ? ` — reason: “${pending.reason}”` : ""}. The request expires in{" "}
            {pending.expiresInSeconds}s.
          </p>
          <p className="text-sm">
            Live view is <strong>view-only</strong>: nothing is recorded, saved or screenshotted. You
            can stop sharing at any moment.
          </p>
          <div className="form-actions">
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
          <h3 className={`card-title ${sharing ? "prompt-title-danger" : "prompt-title-warning"}`}>
            {sharing ? `Sharing your screen with ${active.viewerName}` : `Live view ready — ${active.viewerName}`}
          </h3>
          <p className="card-intro">
            Started {new Date(active.startedAt).toLocaleTimeString()}. Frames sent: {framesSent}. Nothing
            is stored on your machine or the server.
          </p>
          <div className="row">
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

      {error && <p className="notice notice-danger">{error}</p>}
    </div>
  );
}
