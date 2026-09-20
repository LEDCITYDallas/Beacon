import React, { useCallback, useEffect, useState } from "react";
import client from "../api/client";
import { Task } from "../types";
import StatusBadge from "../components/StatusBadge";
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Team queue</h2>
        <button className="btn" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Close" : "+ New task"}
        </button>
      </div>
      <p style={{ color: "var(--text-muted)", marginTop: 0, fontSize: 14 }}>
        {user?.role === "MANAGER"
          ? `Scoped to ${user.department} — other departments are not visible to you.`
          : "Global scope (Super Admin)."}
      </p>

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {notice && <p style={{ color: "var(--success)" }}>{notice}</p>}
      {alerts && (
        <div className="card" style={{ border: "1px solid var(--warning)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, color: "var(--warning)" }}>Needs attention</h3>
            <button className="btn btn-outline" onClick={() => void emailAlertSummary()}>
              Email me this summary
            </button>
          </div>

          {alerts.overdue.length === 0 && alerts.blocked.length === 0 && (
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
              Nothing overdue or blocked right now.
            </p>
          )}

          {alerts.overdue.length > 0 && (
            <>
              <p style={{ margin: "8px 0 4px", fontSize: 13, color: "var(--danger)" }}>
                <strong>{alerts.overdue.length} overdue</strong>
              </p>
              {alerts.overdue.slice(0, 5).map((t) => (
                <p key={t._id} style={{ margin: "2px 0", fontSize: 13, color: "var(--text-muted)" }}>
                  {t.title} — due {formatDate(t.dueDate, user?.timezone)} · {assigneeName(t)}
                </p>
              ))}
            </>
          )}

          {alerts.blocked.length > 0 && (
            <>
              <p style={{ margin: "8px 0 4px", fontSize: 13, color: "var(--warning)" }}>
                <strong>{alerts.blocked.length} blocked</strong> — reasons in aggregate only, never
                used to single anyone out (Section 4)
              </p>
              {alerts.blocked.slice(0, 5).map((t) => (
                <p key={t._id} style={{ margin: "2px 0", fontSize: 13, color: "var(--text-muted)" }}>
                  {t.title} —{" "}
                  {t.blockedReason?.type === "NOT_CONFIDENT"
                    ? "needs guidance"
                    : "waiting on other"}
                </p>
              ))}
            </>
          )}

          {alerts.delivery && (
            <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
              delivery driver: {alerts.delivery.masterSwitch} · email transport:{" "}
              {alerts.delivery.email.transport} ({alerts.delivery.email.live ? "live" : "simulated"}) ·
              WhatsApp {alerts.delivery.whatsapp.live ? "live" : "simulated"}
            </p>
          )}

          {alerts.recentNotifications && alerts.recentNotifications.length > 0 && (
            <>
              <h4 style={{ margin: "12px 0 4px" }}>Recent notifications</h4>
              {alerts.recentNotifications.map((n, i) => (
                <p key={`${n.subject}-${i}`} style={{ margin: "2px 0", fontSize: 12, color: "var(--text-muted)" }}>
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
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
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
                      <div style={{ fontSize: 11, color: "var(--accent-light)" }}>
                        completion proposed — {row.pendingCompletionProposal.detectedSignal}
                        {row.pendingCompletionProposal.confidence
                          ? ` (${Math.round(row.pendingCompletionProposal.confidence * 100)}%)`
                          : ""}
                        <br />
                        waiting for the assignee to confirm
                      </div>
                    )}
                    {row.flagged && (
                      <div style={{ fontSize: 11, color: "var(--warning)" }}>
                        flagged{row.flagNote ? `: ${row.flagNote}` : ""}
                      </div>
                    )}
                  </td>
                  <td>
                    {assigneeName(row)}
                    {typeof row.assignedTo === "object" && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {people.find((p2) => p2.id === (row.assignedTo as { _id: string })._id)?.timezone ||
                          ""}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {p ? (
                      <span
                        style={{
                          color: p.status === "ACTIVE" ? "var(--success)" : "var(--warning)",
                        }}
                      >
                        {p.status === "ACTIVE" ? "Active" : "On break"}
                        {p.activityConfidence === "UNKNOWN" ? " (?)" : ""}
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
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
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {row.blockedReason?.type === "NOT_CONFIDENT" && "Needs guidance"}
                    {row.blockedReason?.type === "WAITING_ON_OTHER" && "Waiting on other"}
                    {!row.blockedReason?.type && "—"}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {t.status !== "COMPLETED" && (
                        <button
                          className="btn btn-outline"
                          style={{ padding: "4px 10px", fontSize: 12 }}
                          onClick={() => void toggleFlag(row)}
                        >
                          {row.flagged ? "Unflag" : "Flag"}
                        </button>
                      )}
                      {t.status === "COMPLETED" && (
                        <button
                          className="btn btn-outline"
                          style={{ padding: "4px 10px", fontSize: 12 }}
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
                <td colSpan={8} style={{ color: "var(--text-muted)", textAlign: "center" }}>
                  No tasks yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
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

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label>Estimated hours</label>
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={estimatedHours}
            onChange={(e) => setEstimatedHours(Number(e.target.value))}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label>Due date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </div>
        <div style={{ flex: 1 }}>
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
        <p style={{ fontSize: 12, color: "var(--warning)" }}>
          No selectable people — a manager only sees their own department.
        </p>
      )}

      <label>External record (optional — links this task to Zoho / WorkDrive / CMS)</label>
      <div style={{ display: "flex", gap: 12 }}>
        <select value={refSource} onChange={(e) => setRefSource(e.target.value)} style={{ flex: 1 }}>
          <option value="">No external link</option>
          <option value="ZOHO_CRM">Zoho CRM</option>
          <option value="ZOHO_BOOKS">Zoho Books</option>
          <option value="ZOHO_INVENTORY">Zoho Inventory</option>
          <option value="WORKDRIVE">WorkDrive</option>
          <option value="WEBSITE_CMS">Website CMS</option>
        </select>
        <input
          style={{ flex: 1 }}
          value={refId}
          onChange={(e) => setRefId(e.target.value)}
          placeholder="External id, e.g. 1042"
          disabled={!refSource}
        />
      </div>

      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

      <button className="btn" style={{ marginTop: 14 }}>
        Create task
      </button>
    </form>
  );
}
