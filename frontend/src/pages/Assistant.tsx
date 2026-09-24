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
  recipientName?: string;
  requiresApproval?: boolean;
  delivery?: { status: string; driver: string; error: string };
  createdAt: string;
}

function providerTag(provider: string, fallback?: boolean) {
  if (provider === "mock" || provider === "template") {
    return (
      <span className="row row-wrap text-xs">
        <span className="pill pill-warning pill-code">{fallback ? "mock fallback" : "mock"}</span>
        <span className="muted">
          {fallback
            ? "the live provider could not be reached, so nothing was invented"
            : "live AI starts once the approved provider key is added"}
        </span>
      </span>
    );
  }
  return (
    <span className="row row-wrap text-xs">
      <span className="pill pill-success pill-code">{provider}</span>
      {fallback && <span className="muted"> (fallback)</span>}
    </span>
  );
}

// Personalised next-up queue (Section 5 feature 1): deterministic ranking from
// the employee's own task + dependency data, with the reason for each position
// shown so it is never a black box.
function NextUpPanel() {
  const [queue, setQueue] = useState<{
    nextUp: { taskId: string; title: string; score: number; reasons: string[]; dueDateLocal: string }[];
    blocked: { title: string; reason: string; waitingOn: string[] }[];
    awaitingConfirmation: { title: string; signal: string }[];
    note: string;
    timezone: string;
  } | null>(null);

  useEffect(() => {
    client
      .get("/assistant/next-up")
      .then((res) => setQueue(res.data))
      .catch(() => {});
  }, []);

  if (!queue) return null;

  return (
    <div className="card">
      <h3 className="card-title">What to do next</h3>
      <p className="card-intro">
        From your own tasks and dependencies, in your timezone ({queue.timezone}).
      </p>
      {queue.nextUp.length === 0 && <p className="muted m-0">Nothing ready right now.</p>}
      {queue.nextUp.map((t, i) => (
        <div key={t.taskId} className="list-row card-inset card">
          <div>
            <strong>
              {i + 1}. {t.title}
            </strong>
            <p className="list-meta mb-0">
              Due {t.dueDateLocal} · {t.reasons.join(", ")}
            </p>
          </div>
        </div>
      ))}

      {queue.blocked.length > 0 && (
        <>
          <h4 className="card-title-quiet mt-3">Waiting, not your problem yet</h4>
          {queue.blocked.map((b) => (
            <p key={b.title} className="list-meta mb-0">
              {b.title} — {b.reason === "NOT_CONFIDENT" ? "needs guidance" : "waiting on other"}
              {b.waitingOn.length ? ` (${b.waitingOn.join(", ")})` : ""}
            </p>
          ))}
        </>
      )}

      {queue.awaitingConfirmation.length > 0 && (
        <>
          <h4 className="card-title-quiet mt-3">Waiting for your confirmation</h4>
          {queue.awaitingConfirmation.map((a) => (
            <p key={a.title} className="list-meta mb-0 text-xs text-accent">
              {a.title} — suggested by {a.signal}
            </p>
          ))}
        </>
      )}

      <p className="text-micro muted mt-2 mb-0">{queue.note}</p>
    </div>
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
    } catch (err: any) {
      setError(err.response?.data?.message || "The assistant could not answer right now. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 className="card-title">Ask your assistant</h3>
      <p className="card-intro">
        Answers come from your own task data — it can't see anything you can't.
      </p>
      <div className="ask-form">
        <textarea
          rows={2}
          placeholder="e.g. What should I work on next? What's blocked on me?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div className="form-actions">
          <button className="btn" onClick={ask} disabled={busy || !question.trim()}>
            {busy ? "Thinking..." : "Ask"}
          </button>
        </div>
      </div>
      {error && <p className="notice notice-danger">{error}</p>}
      {answer && (
        <div className="answer-block">
          <p className="answer-text">{answer.text}</p>
          <div className="mt-2">{providerTag(answer.provider)}</div>
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
  const [fallback, setFallback] = useState(false);
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
      setFallback(Boolean(res.data.fallback));
    } catch (err: any) {
      setError(
        err.response?.data?.message || "Draft generation failed. Try again in a moment."
      );
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
      <h3 className="card-title">Draft work product</h3>
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
      <div className="form-actions">
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
          <div className="form-actions">
            <button className="btn" onClick={queueForSend} disabled={busy}>
              Queue for send
            </button>
            <button className="btn btn-outline" onClick={() => setDraft("")}>
              Discard draft
            </button>
            {provider && providerTag(provider, fallback)}
          </div>
        </>
      )}

      {note && <p className="notice notice-success">{note}</p>}
      {error && <p className="notice notice-danger">{error}</p>}
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
      <p className="card-intro">
        Nothing is sent until approved here. Handoff proposals are created
        automatically when a dependency unblocks.
      </p>

      {!loaded && <p className="muted m-0">Loading...</p>}

      {loaded && pending.length === 0 && (
        <p className="muted m-0">
          Nothing waiting for approval.
        </p>
      )}

      {pending.map((p) => (
        <div key={p._id} className="card card-inset card-accent">
          <p className="list-meta mt-0 text-xs">
            {p.kind === "HANDOFF" ? "Handoff notification" : "Draft message"} ·{" "}
            {p.channel === "WHATSAPP" ? "WhatsApp" : "Email"} ·{" "}
            {new Date(p.createdAt).toLocaleString()}
          </p>
          <p className="answer-text mb-4 mt-2">{p.body}</p>
          <div className="form-actions mt-0">
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
          <h4 className="card-title-quiet mt-4">Recent decisions</h4>
          {decided.map((p) => (
            <p key={p._id} className="list-meta text-sm">
              <strong
                className={p.status === "SENT" ? "text-success" : "text-danger"}
              >
                {p.status === "SENT" ? "Approved" : "Declined"}
              </strong>{" "}
              — {p.body.slice(0, 70)}
              {p.body.length > 70 ? "..." : ""}
              {p.delivery?.status ? (
                <span className="text-micro">
                  {" "}
                  · delivery: {p.delivery.status}
                  {p.delivery.driver ? ` (${p.delivery.driver})` : ""}
                  {p.delivery.error ? ` — ${p.delivery.error}` : ""}
                </span>
              ) : null}
            </p>
          ))}
          <p className="text-xs muted">
            Note: SIMULATED means the delivery driver is still the mock one, so the approval is
            recorded but nothing left the machine. Real WhatsApp/email transmission starts when the
            delivery credentials are configured.
          </p>
        </>
      )}
    </div>
  );
}

export default function Assistant() {
  return (
    <div>
      <div className="page-head">
        <h2 className="page-title">Assistant</h2>
      </div>
      <p className="page-sub">
        Your co-worker for tasks and handoffs. It proposes — you confirm.
      </p>
      <NextUpPanel />
      <AskPanel />
      <DraftPanel onQueued={() => window.location.reload()} />
      <ApprovalsPanel />
    </div>
  );
}


