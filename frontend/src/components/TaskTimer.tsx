import React, { useEffect, useRef, useState } from "react";
import client from "../api/client";
import { notify } from "./Toaster";
import { Task } from "../types";

function messageOf(err: unknown, fallback: string) {
  const data = (err as { response?: { data?: { message?: string } } })?.response?.data;
  return data?.message || fallback;
}

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
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
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

  async function run(action: "start" | "pause" | "complete", success: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await client.post(`/tasks/${task._id}/${action}`);
      if (action !== "complete") {
        setBase(res.data.actualSeconds ?? base);
        setTick(0);
        onChange(res.data.task);
      } else {
        onChange(res.data);
      }
      notify("success", success);
    } catch (err) {
      notify("error", messageOf(err, "That task action did not save. Try again."));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="timer-row">
      <div className="timer-display">{formatDuration(base + tick)}</div>
      <div className="row">
        {!running && task.status !== "COMPLETED" && (
          <button className="btn" disabled={busy} onClick={() => run("start", task.status === "PAUSED" ? "Timer resumed." : "Timer started.")}>
            {busy ? "Saving…" : task.status === "PAUSED" ? "Resume" : "Start"}
          </button>
        )}
        {running && (
          <button className="btn btn-outline" disabled={busy} onClick={() => run("pause", "Timer paused.")}>
            {busy ? "Saving…" : "Pause"}
          </button>
        )}
        {task.status !== "COMPLETED" && (
          <button className="btn btn-outline" disabled={busy} onClick={() => run("complete", "Task marked done.")}>
            {busy ? "Saving…" : "Mark done"}
          </button>
        )}
      </div>
    </div>
  );
}
