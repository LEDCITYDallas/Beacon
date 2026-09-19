import React, { useEffect, useState } from "react";
import client from "../api/client";
import { Task } from "../types";
import StatusBadge from "../components/StatusBadge";

export default function ManagerDashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    const res = await client.get("/tasks");
    setTasks(res.data);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Team queue</h2>
        <button className="btn" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Close" : "+ New task"}
        </button>
      </div>

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
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t._id}>
                <td>{t.title}</td>
                <td>{typeof t.assignedTo === "object" ? t.assignedTo.name : t.assignedTo}</td>
                <td>{t.priority}</td>
                <td><StatusBadge status={t.status} /></td>
                <td>{new Date(t.dueDate).toLocaleDateString()}</td>
                <td style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  {t.blockedReason?.type === "WAITING_ON_OTHER" && "Waiting on other"}
                  {t.blockedReason?.type === "NOT_CONFIDENT" && "Needs guidance"}
                  {!t.blockedReason?.type && "—"}
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: "var(--text-muted)", textAlign: "center" }}>
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
