import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client";
import AssistantChat from "../components/AssistantChat";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import LoadingState from "../components/LoadingState";
import { useAuth } from "../context/AuthContext";
import { Task, TaskStatus, Priority } from "../types";
import { formatDate } from "../utils/format";

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

interface RankedTask {
  taskId: string;
  title: string;
  status?: TaskStatus;
  priority?: Priority;
  dueDateLocal: string;
  estimatedHours?: number;
  reasons: string[];
}

interface NextUpResponse {
  generatedFor?: string;
  nextUp: RankedTask[];
  blocked: { title: string; reason: string; waitingOn: string[] }[];
  awaitingConfirmation: { title: string; signal: string }[];
  note: string;
  timezone: string;
}

function apiMessage(err: unknown, fallback: string) {
  if (err && typeof err === "object" && "response" in err) {
    const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
    if (message) return message;
  }
  return fallback;
}

function PriorityMark({ priority }: { priority?: Priority }) {
  if (!priority) return null;
  const tone = priority === "URGENT" ? "pill-danger" : priority === "HIGH" ? "pill-warning" : "pill-neutral";
  const label = priority.charAt(0) + priority.slice(1).toLowerCase();
  return <span className={`pill ${tone}`}>{label}</span>;
}

// Context already returned for this signed-in user: own current task, plus the
// ranked next-up payload. Nothing is added that those responses do not contain.
function ContextPanel() {
  const { user } = useAuth();
  const [current, setCurrent] = useState<Task | null>(null);
  const [currentReady, setCurrentReady] = useState(false);
  const [currentError, setCurrentError] = useState("");
  const [queue, setQueue] = useState<NextUpResponse | null>(null);
  const [queueError, setQueueError] = useState("");

  const load = useCallback(async () => {
    setCurrentError("");
    setQueueError("");
    const [mine, next] = await Promise.all([
      client.get("/tasks/my-queue").then(
        (res) => ({ ok: true as const, data: res.data as { current: Task | null } }),
        (err: unknown) => ({ ok: false as const, error: apiMessage(err, "Could not load your current task.") })
      ),
      client.get("/assistant/next-up").then(
        (res) => ({ ok: true as const, data: res.data as NextUpResponse }),
        (err: unknown) => ({ ok: false as const, error: apiMessage(err, "Could not load what to do next.") })
      ),
    ]);
    if (mine.ok) setCurrent(mine.data.current);
    else setCurrentError(mine.error);
    setCurrentReady(true);
    if (next.ok) setQueue(next.data);
    else setQueueError(next.error);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const ranked = (queue?.nextUp || []).filter((task) => task.taskId !== current?._id);

  return (
    <aside className="card assistant-context" aria-labelledby="assistant-context-title">
      <h2 id="assistant-context-title" className="card-title">
        Context
      </h2>
      <p className="card-intro">
        {queue?.generatedFor
          ? `Tasks already visible to ${queue.generatedFor}.`
          : "Tasks already visible to you."}
        {queue?.timezone ? ` Times use ${queue.timezone}.` : ""}
      </p>

      <h3 className="card-title-quiet">Current task</h3>
      {!currentReady && !currentError ? (
        <LoadingState label="Loading your current task…" />
      ) : null}
      {currentError ? (
        <div className="notice notice-danger" role="alert">
          <p className="m-0">{currentError}</p>
          <button type="button" className="btn btn-outline btn-sm mt-2" onClick={() => load()}>
            Try again
          </button>
        </div>
      ) : null}
      {currentReady && !currentError && !current ? (
        <div className="assistant-empty">
          <h3>No task in progress</h3>
          <p>Nothing assigned to you is started or paused.</p>
          <Link className="link" to="/">
            Open Home
          </Link>
        </div>
      ) : null}
      {current ? (
        <article className="assistant-context-item">
          <div className="assistant-context-head">
            <h3 className="assistant-item-title">{current.title}</h3>
            <div className="assistant-item-meta">
              <StatusBadge status={current.status} />
              <PriorityMark priority={current.priority} />
            </div>
          </div>
          <p className="list-meta">
            Due {formatDate(current.dueDate, user?.timezone)}
            {typeof current.estimatedHours === "number" ? ` · ${current.estimatedHours}h estimated` : ""}
          </p>
          {current.definitionOfDone ? (
            <p className="list-meta mb-0">Done when {current.definitionOfDone}</p>
          ) : null}
        </article>
      ) : null}

      <h3 className="card-title-quiet">What to do next</h3>
      {!queue && !queueError ? <LoadingState label="Loading recommendations…" /> : null}
      {queueError ? (
        <div className="notice notice-danger" role="alert">
          <p className="m-0">{queueError}</p>
          <button type="button" className="btn btn-outline btn-sm mt-2" onClick={() => load()}>
            Try again
          </button>
        </div>
      ) : null}
      {queue && ranked.length === 0 ? (
        <div className="assistant-empty">
          <h3>Nothing ready</h3>
          <p>The ranked queue has no further task for you.</p>
        </div>
      ) : null}
      {ranked.map((task, index) => (
        <article key={task.taskId} className="assistant-context-item">
          <div className="assistant-context-head">
            <h3 className="assistant-item-title">
              {index + 1}. {task.title}
            </h3>
            <div className="assistant-item-meta">
              {task.status ? <StatusBadge status={task.status} /> : null}
              <PriorityMark priority={task.priority} />
            </div>
          </div>
          <p className="list-meta mb-0">
            Due {task.dueDateLocal}
            {typeof task.estimatedHours === "number" ? ` · ${task.estimatedHours}h estimated` : ""}
            {task.reasons.length ? ` · ${task.reasons.join(", ")}` : ""}
          </p>
        </article>
      ))}

      {queue && queue.blocked.length > 0 ? (
        <>
          <h3 className="card-title-quiet">Blocked</h3>
          {queue.blocked.map((item) => (
            <p key={item.title} className="list-meta mb-0">
              {item.title} — {item.reason === "NOT_CONFIDENT" ? "needs guidance" : "waiting on other"}
              {item.waitingOn.length ? ` (${item.waitingOn.join(", ")})` : ""}
            </p>
          ))}
        </>
      ) : null}

      {queue && queue.awaitingConfirmation.length > 0 ? (
        <>
          <h3 className="card-title-quiet">Waiting for your confirmation</h3>
          {queue.awaitingConfirmation.map((item) => (
            <p key={item.title} className="list-meta mb-0">
              {item.title}
              {item.signal ? ` — suggested by ${item.signal}` : ""}
            </p>
          ))}
        </>
      ) : null}

      {queue?.note ? <p className="assistant-hint">{queue.note}</p> : null}
    </aside>
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
  const [busy, setBusy] = useState<"" | "draft" | "queue">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function generate() {
    if (!request.trim()) return;
    setBusy("draft");
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
      setBusy("");
    }
  }

  async function queueForSend() {
    if (!draft.trim()) return;
    setBusy("queue");
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
      setBusy("");
    }
  }

  return (
    <div className="card">
      <h2 className="card-title">Draft</h2>
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
        <button type="button" className="btn" onClick={generate} disabled={busy !== "" || !request.trim()}>
          {busy === "draft" ? "Drafting..." : "Generate draft"}
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
            <button type="button" className="btn" onClick={queueForSend} disabled={busy !== ""}>
              {busy === "queue" ? "Queueing…" : "Queue for send"}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setDraft("")} disabled={busy !== ""}>
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
function ApprovalsPanel({ revision }: { revision: number }) {
  const [items, setItems] = useState<Proposal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [deciding, setDeciding] = useState<null | { id: string; action: "confirm" | "decline" }>(null);

  const load = useCallback(async () => {
    try {
      const res = await client.get("/assistant/messages");
      setItems(res.data);
      setError("");
    } catch (err) {
      setError(apiMessage(err, "Could not load the approval queue."));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, revision]);

  async function decide(id: string, action: "confirm" | "decline") {
    if (deciding) return;
    setDeciding({ id, action });
    setError("");
    try {
      await client.post(`/assistant/messages/${id}/${action}`);
      await load();
    } catch (err) {
      setError(apiMessage(err, "Could not record that decision."));
    } finally {
      setDeciding(null);
    }
  }

  const pending = items.filter((p) => p.status === "PENDING");
  const decided = items.filter((p) => p.status !== "PENDING").slice(0, 5);

  return (
    <div className="card">
      <h2 className="card-title">Approvals</h2>
      <p className="card-intro">
        Nothing is sent until approved here. Handoff proposals are created
        automatically when a dependency unblocks.
      </p>

      {!loaded && !error ? <LoadingState label="Loading approvals…" /> : null}
      {error ? (
        <div className="notice notice-danger" role="alert">
          <p className="m-0">{error}</p>
          <button type="button" className="btn btn-outline btn-sm mt-2" onClick={() => load()}>
            Try again
          </button>
        </div>
      ) : null}

      {loaded && !error && pending.length === 0 ? (
        <div className="assistant-empty">
          <h3>Nothing waiting</h3>
          <p>No message or handoff needs your approval.</p>
        </div>
      ) : null}

      {pending.map((p) => (
        <div key={p._id} className="card card-inset card-accent">
          <p className="list-meta mt-0 text-xs">
            {p.kind === "HANDOFF" ? "Handoff notification" : "Draft message"} ·{" "}
            {p.channel === "WHATSAPP" ? "WhatsApp" : "Email"} ·{" "}
            {new Date(p.createdAt).toLocaleString()}
          </p>
          <p className="answer-text mb-4 mt-2">{p.body}</p>
          <div className="form-actions mt-0">
            <button
              type="button"
              className="btn"
              disabled={deciding?.id === p._id}
              onClick={() => decide(p._id, "confirm")}
            >
              {deciding?.id === p._id && deciding.action === "confirm" ? "Saving…" : "Approve send"}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={deciding?.id === p._id}
              onClick={() => decide(p._id, "decline")}
            >
              {deciding?.id === p._id && deciding.action === "decline" ? "Saving…" : "Decline"}
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
  const [approvalRevision, setApprovalRevision] = useState(0);

  return (
    <div className="assistant-workspace">
      <PageHeader
        title="Assistant"
        description="Ask about your own work, draft a message, and approve anything before it is sent."
      />
      <div className="assistant-panes">
        <AssistantChat />
        <ContextPanel />
      </div>
      <div className="assistant-tools">
        <DraftPanel onQueued={() => setApprovalRevision((value) => value + 1)} />
        <ApprovalsPanel revision={approvalRevision} />
      </div>
    </div>
  );
}


