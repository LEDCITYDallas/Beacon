import React, { useEffect, useState } from "react";
import client from "../api/client";
import { Task } from "../types";
import StatusBadge from "../components/StatusBadge";

interface Alerts {
  overdue: TaskRow[];
  blocked: TaskRow[];
}

interface TaskRow {
  _id: string;
  title: string;
  priority: string;
  status: string;
  dueDate: string;
  flagged?: boolean;
  flagNote?: string;
  assignedTo: { _id: string; name: string; email: string } | string;
  blockedReason?: { type: string; note: string };
}

export default function ManagerDashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    const [tasksRes, alertsRes] = await Promise.all([
      client.get("/tasks"),
      client.get("/alerts").catch(() => null),
    ]);
    setTasks(tasksRes.data);
    if (alertsRes) setAlerts(alertsRes.data);
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleFlag(t: TaskRow) {
    await client.post(`/tasks/${t._id}/flag`, { flagged: !t.flagged });
    load();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Team queue</h2>
        <button className="btn" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Close" : "+ New task"}
        </button>
      </div>

      {alerts && (alerts.overdue.length > 0 || alerts.blocked.length > 0) && (
        <div className="card" style={{ border: "1px solid var(--warning)" }}>
          <h3 style={{ margin: "0 0 8px", color: "var(--warning)" }}>
            Needs attention (Section 8 alerts)
          </h3>
          {alerts.overdue.length > 0 && (
            <>
              <p style={{ margin: "4px 0", fontSize: 13, color: "var(--danger)" }}>
                <strong>{alerts.overdue.length} overdue</strong>
              </p>
              {alerts.overdue.slice(0, 5).map((t) => (
                <p key={t._id} style={{ margin: "2px 0", fontSize: 13, color: "var(--text-muted)" }}>
                  {t.title} — due {new Date(t.dueDate).toLocaleDateString()} ·{" "}
                  {typeof t.assignedTo === "object" ? t.assignedTo.name : "unassigned"}
                </p>
              ))}
            </>
          )}
          {alerts.blocked.length > 0 && (
            <>
              <p style={{ margin: "8px 0 4px", fontSize: 13, color: "var(--warning)" }}>
                <strong>{alerts.blocked.length} blocked</strong> — aggregate reasons only,
                never used to single anyone out (Section 4)
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
        </div>
      )}

      {showForm && (
        <CreateTaskForm
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Assignee</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Due</th>
              <th>Blocked reason</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t._id}>
                <td>
                  {t.flagged && <span title={t.flagNote || ""}>🚩 </span>}
                  {t.title}
                </td>
                <td>{typeof t.assignedTo === "object" ? t.assignedTo.name : t.assignedTo}</td>
                <td>{t.priority}</td>
                <td><StatusBadge status={t.status} /></td>
                <td>{new Date(t.dueDate).toLocaleDateString()}</td>
                <td style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  {t.blockedReason?.type === "WAITING_ON_OTHER" && "Waiting on other"}
                  {t.blockedReason?.type === "NOT_CONFIDENT" && "Needs guidance"}
                  {!t.blockedReason?.type && "—"}
                </td>
                <td>
                  {t.status !== "COMPLETED" && (
                    <button
                      className="btn btn-outline"
                      style={{ padding: "4px 10px", fontSize: 12 }}
                      onClick={() => toggleFlag(t)}
                    >
                      {t.flagged ? "Unflag" : "Flag"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: "var(--text-muted)", textAlign: "center" }}>
                  No tasks yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateTaskForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [definitionOfDone, setDefinitionOfDone] = useState("");
  const [estimatedHours, setEstimatedHours] = useState(1);
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
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
            min={0}
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

      <label>Assignee (user id — mock, no picker yet)</label>
      <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} required />

      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

      <button className="btn" style={{ marginTop: 14 }}>
        Create task
      </button>
    </form>
  );
}
