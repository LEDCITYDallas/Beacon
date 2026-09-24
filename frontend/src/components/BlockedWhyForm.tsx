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
    <div className="card card-inset">
      <label>Why is this blocked?</label>
      <div className="stack-2">
        <label className="choice">
          <input
            type="radio"
            name="blocked-type"
            checked={type === "WAITING_ON_OTHER"}
            onChange={() => setType("WAITING_ON_OTHER")}
          />
          <span>Waiting on another person or system</span>
        </label>
        <label className="choice">
          <input
            type="radio"
            name="blocked-type"
            checked={type === "NOT_CONFIDENT"}
            onChange={() => setType("NOT_CONFIDENT")}
          />
          <span>Not confident in the decision / need more info</span>
        </label>
      </div>

      <label>Note (optional)</label>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />

      <div className="form-actions">
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
