import React, { useEffect, useState } from "react";
import client from "../api/client";
import { Task } from "../types";
import { formatDate } from "../utils/format";

// ---------------------------------------------------------------------
// Completion proposals awaiting a human decision (Priority 6 / Section 4).
//
// This is the human-in-the-loop gate in the UI: a Zoho/WorkDrive/CMS signal (or
// a manager recording outside evidence) can only ever RAISE a proposal. The
// assignee sees WHAT was detected, WHERE it came from and how confident the
// match was, then confirms or rejects it. Nothing closes without this click.
// ---------------------------------------------------------------------

export default function CompletionProposals({ onDecided }: { onDecided?: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const res = await client.get("/tasks");
      setTasks(
        (res.data as Task[]).filter((t) => t.pendingCompletionProposal?.isPending)
      );
    } catch {
      setError("Could not load completion proposals.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function decide(taskId: string, action: "confirm-completion" | "reject-completion") {
    setBusy(taskId);
    setError("");
    try {
      await client.post(`/tasks/${taskId}/${action}`);
      await load();
      onDecided?.();
    } catch (err: any) {
      setError(err.response?.data?.message || "Could not record your decision");
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>;
  if (!tasks.length) return null;

  return (
    <div className="card" style={{ border: "1px solid var(--accent)" }}>
      <h3 style={{ marginTop: 0 }}>Needs your confirmation ({tasks.length})</h3>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 0 }}>
        Something outside this app suggested these tasks are finished. Nothing is closed until you
        confirm it.
      </p>

      {tasks.map((t) => {
        const p = t.pendingCompletionProposal!;
        const evidence = p.evidence;
        return (
          <div
            key={t._id}
            className="card"
            style={{ background: "var(--surface-2)", marginBottom: 12 }}
          >
            <strong>{t.title}</strong>
            <p style={{ margin: "6px 0 2px", fontSize: 13 }}>
              Detected: {p.detectedSignal}
            </p>
            {evidence && (
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
                Source {evidence.source}
                {evidence.externalId ? ` #${evidence.externalId}` : ""}
                {evidence.occurredAt ? ` · ${formatDate(evidence.occurredAt)}` : ""}
                {p.confidence ? ` · match confidence ${Math.round((p.confidence || 0) * 100)}%` : ""}
              </p>
            )}
            {evidence?.summary && (
              <p style={{ margin: "6px 0 0", fontSize: 12 }}>{evidence.summary}</p>
            )}
            {evidence?.evidenceUrl && (
              <p style={{ margin: "4px 0 0", fontSize: 12 }}>
                <a href={evidence.evidenceUrl} target="_blank" rel="noreferrer">
                  Open the evidence
                </a>
              </p>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                className="btn"
                disabled={busy === t._id}
                onClick={() => void decide(t._id, "confirm-completion")}
              >
                Yes, it's done
              </button>
              <button
                className="btn btn-outline"
                disabled={busy === t._id}
                onClick={() => void decide(t._id, "reject-completion")}
              >
                Not done yet
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
