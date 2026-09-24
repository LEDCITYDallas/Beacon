import React, { useCallback, useEffect, useState } from "react";
import client from "../api/client";
import { Task } from "../types";
import StatusBadge from "../components/StatusBadge";
import Avatar from "../components/Avatar";
import { useAuth } from "../context/AuthContext";
import { formatDate, relativeFrom } from "../utils/format";

// ---------------------------------------------------------------------
// Manager team queue (Priorities 2, 5, 6, 10).
//
// Adds the pieces the earlier phase was missing:
//   - a real assignee picker instead of typing an ObjectId
//   - live activity/idle state per person (aggregate state, never activity
//     content - there is no such data to show)
//   - in-app alert feed + an explicit "email me the summary" action
//   - completion proposals with their evidence, visible to the manager
// ---------------------------------------------------------------------

interface TaskRow {
  _id: string;
  title: string;
  priority: string;
  status: string;
  dueDate: string;
  department: string;
  flagged?: boolean;
  flagNote?: string;
  reopenCount?: number;
  assignedTo: { _id: string; name: string; email: string } | string;
  blockedReason?: { type: string; note: string };
  pendingCompletionProposal?: {
    isPending: boolean;
    detectedSignal: string;
    confidence?: number;
    evidence?: { source: string; externalId: string; summary: string; evidenceUrl: string };
  };
}

interface Alerts {
  overdue: TaskRow[];
  blocked: TaskRow[];
  recentNotifications?: {
    channel: string;
    kind: string;
    status: string;
    driver: string;
    subject: string;
    at: string;
  }[];
  delivery?: {
    masterSwitch: string;
    email: { transport: string; live: boolean };
    whatsapp: { live: boolean; configured: boolean };
  };
}

interface PresenceRow {
  userId: string;
  name: string;
  department: string;
  status: string;
  activityConfidence: string;
  lastActivityAt: string | null;
  idleThresholdMinutes: number;
}

interface DirectoryUser {
  id: string;
  name: string;
  role: string;
  department: string;
  timezone: string;
}

function assigneeName(t: TaskRow) {
  return typeof t.assignedTo === "object" ? t.assignedTo.name : "unassigned";
}

export default function ManagerDashboard() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [presence, setPresence] = useState<PresenceRow[]>([]);
  const [people, setPeople] = useState<DirectoryUser[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [tasksRes, alertsRes, presenceRes, peopleRes] = await Promise.all([
      client.get("/tasks"),
      client.get("/alerts").catch(() => null),
      client.get("/activity/team").catch(() => null),
      client.get("/users").catch(() => null),
    ]);
    setTasks(tasksRes.data);
    if (alertsRes) setAlerts(alertsRes.data);
    if (presenceRes) setPresence(presenceRes.data);
    if (peopleRes) setPeople(peopleRes.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleFlag(t: TaskRow) {
    await client.post(`/tasks/${t._id}/flag`, { flagged: !t.flagged });
    await load();
  }

  async function reopen(t: TaskRow) {
    if (!window.confirm(`Reopen "${t.title}"? This counts as rework on the scorecard input.`)) return;
    await client.post(`/tasks/${t._id}/reopen`);
    await load();
  }

  async function emailAlertSummary() {
    setNotice("");
    setError("");
    try {
      const res = await client.post("/alerts/dispatch", {});
      const lines = (res.data.dispatched as { kind: string; count: number; status: string }[])
        .map((d) => `${d.kind}: ${d.count} task(s), ${d.status}`)
        .join(" · ");
      setNotice(
        lines
          ? `Summary recorded — ${lines}. ${res.data.explanation}`
          : res.data.explanation
      );
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || "Could not dispatch the alert email");
    }
  }

  const presenceOf = (row: TaskRow) => {
    const id = typeof row.assignedTo === "object" ? row.assignedTo._id : String(row.assignedTo);
    return presence.find((p) => p.userId === id);
  };

  return (
    <div>
      <div className="page-head">
        <h2 className="page-title">Team queue</h2>
        <button className="btn" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Close" : "+ New task"}
        </button>
      </div>
      <p className="page-sub">
        {user?.role === "MANAGER"
          ? `Scoped to ${user.department} — other departments are not visible to you.`
          : "Global scope (Super Admin)."}
      </p>

      {error && <p className="notice notice-danger">{error}</p>}
      {notice && <p className="notice notice-success">{notice}</p>}
      {alerts && (
        <div className="card card-warn">
          <div className="card-head">
            <h3 className="card-title mb-0">Needs attention</h3>
            <button className="btn btn-outline btn-sm" onClick={() => void emailAlertSummary()}>
              Email me this summary
            </button>
          </div>

          {alerts.overdue.length === 0 && alerts.blocked.length === 0 && (
            <p className="list-meta">Nothing overdue or blocked right now.</p>
          )}

          {alerts.overdue.length > 0 && (
            <>
              <p className="mt-2 mb-2">
                <span className="pill pill-danger">{alerts.overdue.length} overdue</span>
              </p>
              {alerts.overdue.slice(0, 5).map((t) => (
                <p key={t._id} className="list-meta mb-0">
                  {t.title} — due {formatDate(t.dueDate, user?.timezone)} · {assigneeName(t)}
                </p>
              ))}
            </>
          )}

          {alerts.blocked.length > 0 && (
            <>
              <p className="mt-2 mb-2">
                <span className="pill pill-warning">{alerts.blocked.length} blocked</span>{" "}
                <span className="muted text-xs">
                  reasons in aggregate only, never used to single anyone out (Section 4)
                </span>
              </p>
              {alerts.blocked.slice(0, 5).map((t) => (
                <p key={t._id} className="list-meta mb-0">
                  {t.title} —{" "}
                  {t.blockedReason?.type === "NOT_CONFIDENT"
                    ? "needs guidance"
                    : "waiting on other"}
                </p>
              ))}
            </>
          )}

          {alerts.delivery && (
            <p className="list-meta text-micro">
              delivery driver: {alerts.delivery.masterSwitch} · email transport:{" "}
              {alerts.delivery.email.transport} ({alerts.delivery.email.live ? "live" : "simulated"}) ·
              WhatsApp {alerts.delivery.whatsapp.live ? "live" : "simulated"}
            </p>
          )}

          {alerts.recentNotifications && alerts.recentNotifications.length > 0 && (
            <>
              <h4 className="card-title-quiet mt-4">Recent notifications</h4>
              {alerts.recentNotifications.map((n, i) => (
                <p key={`${n.subject}-${i}`} className="list-meta text-xs mb-0">
                  [{n.channel}] {n.subject} — {n.status}
                  {n.driver ? ` (${n.driver})` : ""} · {relativeFrom(n.at)}
                </p>
              ))}
            </>
          )}
        </div>
      )}

      {showForm && (
        <CreateTaskForm
          people={people}
          onCreated={() => {
            setShowForm(false);
            void load();
          }}
        />
      )}
      <div className="card card-flush">
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Assignee</th>
              <th>Activity</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Due</th>
              <th>Blocked why</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const row = t as unknown as TaskRow;
              const p = presenceOf(row);
              return (
                <tr key={t._id}>
                  <td>
                    {t.title}
                    {row.pendingCompletionProposal?.isPending && (
                      <div className="text-micro text-accent">
                        completion proposed — {row.pendingCompletionProposal.detectedSignal}
                        {row.pendingCompletionProposal.confidence
                          ? ` (${Math.round(row.pendingCompletionProposal.confidence * 100)}%)`
                          : ""}
                        <br />
                        waiting for the assignee to confirm
                      </div>
                    )}
                    {row.flagged && (
                      <div className="text-micro text-warning">
                        flagged{row.flagNote ? `: ${row.flagNote}` : ""}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="person">
                      {typeof row.assignedTo === "object" && (
                        <Avatar name={assigneeName(row)} size="sm" />
                      )}
                      <div>
                        <div className="person-name">{assigneeName(row)}</div>
                        {typeof row.assignedTo === "object" && (
                          <div className="person-meta">
                            {people.find(
                              (p2) => p2.id === (row.assignedTo as { _id: string })._id
                            )?.timezone || ""}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    {p ? (
                      <span
                        className={`status-line ${
                          p.status === "ACTIVE" ? "status-line-active" : "status-line-break"
                        }`}
                      >
                        {p.status === "ACTIVE" ? "Active" : "On break"}
                        {p.activityConfidence === "UNKNOWN" ? " (?)" : ""}
                        <div className="text-micro muted">
                          {p.lastActivityAt ? relativeFrom(p.lastActivityAt) : "no signal"}
                        </div>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <StatusBadge status={t.status} />
                  </td>
                  <td>{t.priority}</td>
                  <td>{formatDate(t.dueDate, user?.timezone)}</td>
                  <td className="text-xs muted">
                    {row.blockedReason?.type === "NOT_CONFIDENT" && "Needs guidance"}
                    {row.blockedReason?.type === "WAITING_ON_OTHER" && "Waiting on other"}
                    {!row.blockedReason?.type && "—"}
                  </td>
                  <td>
                    <div className="cell-actions">
                      {t.status !== "COMPLETED" && (
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => void toggleFlag(row)}
                        >
                          {row.flagged ? "Unflag" : "Flag"}
                        </button>
                      )}
                      {t.status === "COMPLETED" && (
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => void reopen(row)}
                        >
                          Reopen
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={8} className="cell-empty">
                  No tasks yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-micro muted">
        Activity shows state only (Active / On break) — this system stores no keystrokes, screen
        content, webcam or audio anywhere.
      </p>
    </div>
  );
}

// Real assignee picker (Priority 10) + optional external reference, which is how
// a task gets linked to a Zoho/WorkDrive/CMS record so completion signals match
// exactly instead of heuristically (Priority 6).
function CreateTaskForm({
  people,
  onCreated,
}: {
  people: DirectoryUser[];
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [definitionOfDone, setDefinitionOfDone] = useState("");
  const [estimatedHours, setEstimatedHours] = useState(1);
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [refSource, setRefSource] = useState("");
  const [refId, setRefId] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await client.post("/tasks", {
        title,
        definitionOfDone,
        estimatedHours,
        dueDate,
        assignedTo,
        priority,
        externalRefs:
          refSource && refId ? [{ source: refSource.trim(), externalId: refId.trim() }] : [],
      });
      onCreated();
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to create task");
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <label>Title</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} required />

      <label>Definition of done</label>
      <textarea
        value={definitionOfDone}
        onChange={(e) => setDefinitionOfDone(e.target.value)}
        rows={2}
        required
      />

      <div className="field-row">
        <div className="field">
          <label>Estimated hours</label>
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={estimatedHours}
            onChange={(e) => setEstimatedHours(Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>Due date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </div>
        <div className="field">
          <label>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </div>
      </div>

      <label>Assignee</label>
      <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} required>
        <option value="">Select a person…</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {p.department} ({p.timezone})
          </option>
        ))}
      </select>
      {people.length === 0 && (
        <p className="notice notice-warning">
          No selectable people — a manager only sees their own department.
        </p>
      )}

      <label>External record (optional — links this task to Zoho / WorkDrive / CMS)</label>
      <div className="field-row">
        <select value={refSource} onChange={(e) => setRefSource(e.target.value)} className="field">
          <option value="">No external link</option>
          <option value="ZOHO_CRM">Zoho CRM</option>
          <option value="ZOHO_BOOKS">Zoho Books</option>
          <option value="ZOHO_INVENTORY">Zoho Inventory</option>
          <option value="WORKDRIVE">WorkDrive</option>
          <option value="WEBSITE_CMS">Website CMS</option>
        </select>
        <input
          className="field"
          value={refId}
          onChange={(e) => setRefId(e.target.value)}
          placeholder="External id, e.g. 1042"
          disabled={!refSource}
        />
      </div>

      {error && <p className="notice notice-danger">{error}</p>}

      <button className="btn form-actions">
        Create task
      </button>
    </form>
  );
}
