import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatDateTime } from "../utils/format";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  provider?: string;
  fallback?: boolean;
}

interface ProviderInfo {
  provider: string;
  model: string;
  live: boolean;
  configured: boolean;
}

const PAGE_KEYS: Record<string, string> = {
  "/": "home",
  "/assistant": "assistant",
  "/scorecard": "scorecard",
  "/team": "team",
  "/team-scorecard": "team-scorecard",
  "/liveview": "liveview",
  "/admin": "admin",
};

const PAGE_LABELS: Record<string, string> = {
  "/": "Home",
  "/assistant": "Assistant",
  "/scorecard": "My scorecard",
  "/team": "Team queue",
  "/team-scorecard": "Team scorecard",
  "/liveview": "Live view",
  "/admin": "Administration",
};

const SUGGESTIONS: Record<string, string[]> = {
  "/": [
    "What should I work on next?",
    "Which of my tasks are overdue?",
    "What is blocking my work?",
    "What do I need to do today?",
  ],
  "/assistant": [
    "What should I work on next?",
    "Which of my tasks are overdue?",
    "How do I complete my current task?",
    "What do I need to do today?",
  ],
  "/scorecard": [
    "What should I work on next?",
    "Which of my tasks are overdue?",
    "How do I complete my current task?",
  ],
  "/team": [
    "Which team tasks are blocked?",
    "What is overdue in my department?",
    "What should the team work on next?",
  ],
  "/team-scorecard": [
    "Which team tasks are blocked?",
    "What is overdue in my department?",
  ],
  "/liveview": [
    "What should I work on next?",
    "Why would live view be unavailable?",
  ],
  "/admin": [
    "What should I check if the assistant cannot answer?",
    "Which tasks are overdue?",
  ],
};

function nextId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readLastScreen() {
  try {
    const saved = sessionStorage.getItem("ems.lastScreen") || "";
    return PAGE_KEYS[saved] ? saved : "";
  } catch {
    return "";
  }
}

function readLastError() {
  try {
    const raw = sessionStorage.getItem("ems.lastError");
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { at?: number; status?: number; path?: string; message?: string };
    if (!parsed.at || Date.now() - parsed.at > 10 * 60 * 1000) return "";
    const message = String(parsed.message || "").slice(0, 240);
    if (!message) return "";
    const where = parsed.path ? ` on ${parsed.path}` : "";
    return `HTTP ${parsed.status || "error"}${where}: ${message}`.slice(0, 300);
  } catch {
    return "";
  }
}

function providerTag(provider: string, fallback?: boolean) {
  if (provider === "mock" || fallback) {
    return (
      <span className="row row-wrap text-xs">
        <span className="pill pill-warning pill-code">{fallback ? "mock fallback" : "mock"}</span>
        <span className="muted">
          {fallback
            ? "the live provider could not be reached, so nothing was invented"
            : "live AI starts once a provider key is added on the server"}
        </span>
      </span>
    );
  }
  return (
    <span className="row row-wrap text-xs">
      <span className="pill pill-success pill-code">{provider}</span>
    </span>
  );
}

export default function AssistantChat() {
  const location = useLocation();
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef(messages);
  const busyRef = useRef(false);
  messagesRef.current = messages;

  const contextPath =
    location.pathname === "/assistant" ? readLastScreen() || "/assistant" : location.pathname;
  const suggestions = SUGGESTIONS[contextPath] || SUGGESTIONS["/assistant"];
  const contextLabel = PAGE_LABELS[contextPath] || "this page";

  useEffect(() => {
    client
      .get("/assistant/provider")
      .then((res) => setProvider(res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  async function submit(question: string, appendUser: boolean) {
    const text = question.trim();
    if (!text || busyRef.current) return;
    const prior = (appendUser ? messagesRef.current : messagesRef.current.slice(0, -1))
      .slice(-8)
      .map((message) => ({ role: message.role, content: message.text }));

    busyRef.current = true;
    if (appendUser) {
      setMessages((current) => [
        ...current,
        { id: nextId(), role: "user", text, at: new Date().toISOString() },
      ]);
      setDraft("");
    }
    setBusy(true);
    setError("");
    try {
      const res = await client.post("/assistant/ask", {
        question: text,
        history: prior,
        screen: {
          page: PAGE_KEYS[contextPath] || "assistant",
          error: readLastError(),
        },
      });
      setMessages((current) => [
        ...current,
        {
          id: nextId(),
          role: "assistant",
          text: res.data.text || "The assistant returned an empty answer.",
          at: new Date().toISOString(),
          provider: res.data.provider,
          fallback: Boolean(res.data.fallback),
        },
      ]);
    } catch (err: unknown) {
      const response = (err as { response?: { data?: { message?: string } } }).response;
      setError(response?.data?.message || "The assistant could not answer right now. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function retry() {
    const current = messagesRef.current;
    const last = current[current.length - 1];
    if (!last || last.role !== "user") return;
    submit(last.text, false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(draft, true);
    }
  }

  const liveNote = provider?.live
    ? `Live answers from ${provider.provider} (${provider.model}).`
    : "Answers use your authorized records. A live model answers once the server has a provider key.";

  return (
    <section className="card assistant-chat" aria-labelledby="assistant-chat-title">
      <h2 id="assistant-chat-title" className="card-title">
        Conversation
      </h2>
      <p className="card-intro">
        {contextPath !== "/assistant"
          ? `Answers come from records you are allowed to see on the ${contextLabel} screen. It cannot see your desktop. This chat stays in this browser tab and is not saved on the server.`
          : "Answers come from records you are allowed to see. It cannot see your desktop. This chat stays in this browser tab and is not saved on the server."}
      </p>
      <p className="text-xs muted mt-0">{liveNote}</p>

      <div
        className="chat-log"
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={busy}
        aria-label="Conversation"
      >
        {messages.length === 0 && !busy && (
          <div className="assistant-empty">
            <h3>No messages yet</h3>
            <p>Ask about your tasks, blockers, or what to do next.</p>
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`chat-bubble ${
              message.role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"
            }`}
          >
            <p className="chat-meta">
              <span>{message.role === "user" ? "You" : "Assistant"}</span>
              <time dateTime={message.at}>{formatDateTime(message.at, user?.timezone)}</time>
            </p>
            <p className="answer-text">{message.text}</p>
            {message.role === "assistant" && message.provider && (
              <div className="mt-2">{providerTag(message.provider, message.fallback)}</div>
            )}
          </div>
        ))}
        {busy && (
          <p className="chat-pending" role="status">
            Thinking…
          </p>
        )}
      </div>

      <div className="chat-suggestions" aria-label="Suggested questions">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="btn btn-outline btn-sm"
            disabled={busy}
            onClick={() => submit(suggestion, true)}
          >
            {suggestion}
          </button>
        ))}
      </div>

      {error && (
        <div className="notice notice-danger" role="alert">
          <p className="m-0">{error}</p>
          <button type="button" className="btn btn-outline btn-sm mt-2" onClick={retry} disabled={busy}>
            Retry
          </button>
        </div>
      )}

      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft, true);
        }}
      >
        <label className="sr-only" htmlFor="assistant-question">
          Message
        </label>
        <div className="chat-composer-bar">
          <textarea
            id="assistant-question"
            rows={2}
            placeholder="Ask about your tasks, blockers, or what to do next"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
          />
          <button className="btn" type="submit" disabled={busy || !draft.trim()}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
        <div className="chat-composer-foot">
          <p className="assistant-hint">Enter to send. Shift+Enter for a new line.</p>
          <button
            className="btn btn-outline btn-sm"
            type="button"
            disabled={busy || messages.length === 0}
            onClick={() => {
              setMessages([]);
              setError("");
            }}
          >
            Clear chat
          </button>
        </div>
      </form>
    </section>
  );
}
