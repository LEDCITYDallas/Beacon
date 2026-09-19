import React, { useState } from "react";
import client from "../api/client";
import { Task } from "../types";

export default function BlockedWhyForm({
  task,
  onChange,
}: {
  task: Task;
  onChange: (t: Task) => void;
}) {
  const [type, setType] = useState<"WAITING_ON_OTHER" | "NOT_CONFIDENT" | "">("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);

  async function submit() {
    if (!type) return;
    const res = await client.post(`/tasks/${task._id}/block`, { type, note });
    onChange(res.data);
    setOpen(false);
    setType("");
    setNote("");
  }

  if (!open) {
    return (
      <button className="btn btn-outline" onClick={() => setOpen(true)}>
        Mark blocked
      </button>
    );
  }

  return (
    <div className="card" style={{ background: "var(--surface-2)" }}>
      <label>Why is this blocked?</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
          <input
            type="radio"
            style={{ width: "auto" }}
            name="blocked-type"
            checked={type === "WAITING_ON_OTHER"}
            onChange={() => setType("WAITING_ON_OTHER")}
          />
          <span style={{ fontSize: 14 }}>Waiting on another person or system</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
          <input
            type="radio"
            style={{ width: "auto" }}
            name="blocked-type"
            checked={type === "NOT_CONFIDENT"}
            onChange={() => setType("NOT_CONFIDENT")}
          />
          <span style={{ fontSize: 14 }}>Not confident in the decision / need more info</span>
        </label>
      </div>

      <label>Note (optional)</label>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button className="btn" disabled={!type} onClick={submit}>
          Confirm
        </button>
        <button className="btn btn-outline" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
