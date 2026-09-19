import React, { useCallback, useEffect, useState } from "react";
import client from "../api/client";

interface AssistantAnswer {
  text: string;
  provider: string;
  model: string;
}

interface Proposal {
  _id: string;
  channel: string;
  kind: "HANDOFF" | "DRAFT_MESSAGE";
  body: string;
  status: "PENDING" | "SENT" | "DECLINED";
  relatedTask: string | null;
  recipient: string | null;
  createdAt: string;
}

function providerTag(provider: string) {
  return provider === "mock" ? (
    <span style={{ color: "var(--warning)", fontSize: 12 }}>
      mock provider — live AI starts once the approved provider key is added
    </span>
  ) : (
    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{provider}</span>
  );
}

// Q&A: read-only, no approval needed (approval-gates matrix row 1).
function AskPanel() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ask() {
    if (!question.trim()) return;
    setBusy(true);
    setError("");
    setAnswer(null);
    try {
      const res = await client.post("/assistant/ask", { question });
      setAnswer(res.data);
    } catch {
      setError("The assistant could not answer right now. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Ask your assistant</h3>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 0 }}>
        Answers come from your own task data — it can't see anything you can't.
      </p>
      <textarea
        rows={2}
        placeholder="e.g. What should I work on next? What's blocked on me?"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />
      <div style={{ marginTop: 10 }}>
        <button className="btn" onClick={ask} disabled={busy || !question.trim()}>
          {busy ? "Thinking..." : "Ask"}
        </button>
      </div>
      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
      {answer && (
        <div className="card" style={{ background: "var(--surface-2)", marginTop: 12 }}>
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{answer.text}</p>
          <div style={{ marginTop: 8 }}>{providerTag(answer.provider)}</div>
        </div>
      )}
    </div>
  );
}

// Drafting: generates text the employee reviews and edits. Queueing for
// send creates a PENDING proposal — nothing goes out without the explicit
// approve step below (approval-gates matrix rows 2-3).
function DraftPanel({ onQueued }: { onQueued: () => void }) {
  const [kind, setKind] = useState("STATUS_UPDATE");
  const [request, setRequest] = useState("");
  const [draft, setDraft] = useState("");
  const [provider, setProvider] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function generate() {
    if (!request.trim()) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      const res = await client.post("/assistant/draft", { kind, request });
      setDraft(res.data.draft);
      setProvider(res.data.provider);
    } catch {
      setError("Draft generation failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function queueForSend() {
    if (!draft.trim()) return;
    setBusy(true);
    setError("");
    try {
      await client.post("/assistant/messages", {
        channel: "EMAIL",
        kind: "DRAFT_MESSAGE",
        body: draft,
      });
      setNote("Queued as PENDING — approve it below to send.");
      setDraft("");
      setRequest("");
      onQueued();
    } catch {
      setError("Could not queue the draft.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Draft work product</h3>
      <label>Draft type</label>
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="REPLY">Reply</option>
        <option value="STATUS_UPDATE">Status update</option>
        <option value="SUMMARY">Summary</option>
      </select>

      <label>What should it cover?</label>
      <textarea
        rows={2}
        placeholder="e.g. Weekly status for my signage proposal tasks"
        value={request}
        onChange={(e) => setRequest(e.target.value)}
      />
      <div style={{ marginTop: 10 }}>
        <button className="btn" onClick={generate} disabled={busy || !request.trim()}>
          {busy ? "Drafting..." : "Generate draft"}
        </button>
      </div>

      {draft && (
        <>
          <label>Draft — review and edit before queueing</label>
          <textarea
            rows={6}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <button className="btn" onClick={queueForSend} disabled={busy}>
              Queue for send
            </button>
            <button className="btn btn-outline" onClick={() => setDraft("")}>
              Discard draft
            </button>
            {provider && providerTag(provider)}
          </div>
        </>
      )}

      {note && <p style={{ color: "var(--success)", fontSize: 13 }}>{note}</p>}
      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
    </div>
  );
}

// Approvals: every outbound message sits PENDING until a human approves.
function ApprovalsPanel() {
  const [items, setItems] = useState<Proposal[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await client.get("/assistant/messages");
    setItems(res.data);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id: string, action: "confirm" | "decline") {
    await client.post(`/assistant/messages/${id}/${action}`);
    load();
  }

  const pending = items.filter((p) => p.status === "PENDING");
  const decided = items.filter((p) => p.status !== "PENDING").slice(0, 5);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Approvals queue</h3>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 0 }}>
        Nothing is sent until approved here. Handoff proposals are created
        automatically when a dependency unblocks.
      </p>

      {!loaded && <p style={{ color: "var(--text-muted)" }}>Loading...</p>}

      {loaded && pending.length === 0 && (
        <p style={{ color: "var(--text-muted)", margin: 0 }}>
          Nothing waiting for approval.
        </p>
      )}

      {pending.map((p) => (
        <div
          key={p._id}
          className="card"
          style={{ background: "var(--surface-2)", border: "1px solid var(--accent)" }}
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
            {p.kind === "HANDOFF" ? "Handoff notification" : "Draft message"} ·{" "}
            {p.channel === "WHATSAPP" ? "WhatsApp" : "Email"} ·{" "}
            {new Date(p.createdAt).toLocaleString()}
          </p>
          <p style={{ whiteSpace: "pre-wrap", margin: "8px 0 12px" }}>{p.body}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={() => decide(p._id, "confirm")}>
              Approve send
            </button>
            <button
              className="btn btn-outline"
              onClick={() => decide(p._id, "decline")}
            >
              Decline
            </button>
          </div>
        </div>
      ))}

      {decided.length > 0 && (
        <>
          <h4 style={{ marginBottom: 4 }}>Recent decisions</h4>
          {decided.map((p) => (
            <p key={p._id} style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0" }}>
              <strong style={{ color: p.status === "SENT" ? "var(--success)" : "var(--danger)" }}>
                {p.status === "SENT" ? "Approved" : "Declined"}
              </strong>{" "}
              — {p.body.slice(0, 70)}
              {p.body.length > 70 ? "..." : ""}
            </p>
          ))}
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Note: approved messages are recorded now; actual WhatsApp/email
            delivery activates when the notification adapter is wired in a
            later phase.
          </p>
        </>
      )}
    </div>
  );
}

export default function Assistant() {
  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>Assistant</h2>
      <p style={{ color: "var(--text-muted)", marginTop: 0, fontSize: 14 }}>
        Your co-worker for tasks and handoffs. It proposes — you confirm.
      </p>
      <AskPanel />
      <DraftPanel onQueued={() => window.location.reload()} />
      <ApprovalsPanel />
    </div>
  );
}


