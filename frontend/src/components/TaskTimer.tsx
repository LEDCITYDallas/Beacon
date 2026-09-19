import React, { useEffect, useState } from "react";
import client from "../api/client";
import { Task } from "../types";

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export default function TaskTimer({
  task,
  baseSeconds = 0,
  onChange,
}: {
  task: Task;
  /** Accrued seconds from the server, including a currently-running segment. */
  baseSeconds?: number;
  onChange: (t: Task) => void;
}) {
  const [base, setBase] = useState(baseSeconds);
  const [tick, setTick] = useState(0);
  const running = task.status === "IN_PROGRESS";

  useEffect(() => {
    setBase(baseSeconds);
    setTick(0);
    // resync when a different task loads or the server sends a new total
  }, [task._id, baseSeconds]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running, task._id]);

  async function start() {
    const res = await client.post(`/tasks/${task._id}/start`);
    setBase(res.data.actualSeconds ?? base);
    setTick(0);
    onChange(res.data.task);
  }

  async function pause() {
    const res = await client.post(`/tasks/${task._id}/pause`);
    setBase(res.data.actualSeconds ?? base);
    setTick(0);
    onChange(res.data.task);
  }

  async function complete() {
    const res = await client.post(`/tasks/${task._id}/complete`);
    onChange(res.data);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div className="timer-display">{formatDuration(base + tick)}</div>
      <div style={{ display: "flex", gap: 8 }}>
        {!running && task.status !== "COMPLETED" && (
          <button className="btn" onClick={start}>
            {task.status === "PAUSED" ? "Resume" : "Start"}
          </button>
        )}
        {running && (
          <button className="btn btn-outline" onClick={pause}>
            Pause
          </button>
        )}
        {task.status !== "COMPLETED" && (
          <button className="btn btn-outline" onClick={complete}>
            Mark done
          </button>
        )}
      </div>
    </div>
  );
}
