import React, { useEffect, useState } from "react";
import client from "../api/client";
import { Task } from "../types";
import StatusBadge from "../components/StatusBadge";
import TaskTimer from "../components/TaskTimer";
import BlockedWhyForm from "../components/BlockedWhyForm";

interface QueueResponse {
  current: Task | null;
  currentActualSeconds?: number;
  nextUp: Task[];
  blockedCount: number;
}

export default function EmployeeHome() {
  const [data, setData] = useState<QueueResponse | null>(null);

  async function load() {
    const res = await client.get("/tasks/my-queue");
    setData(res.data);
  }

  useEffect(() => {
    load();
  }, []);

  function handleCurrentTaskChange(updated: Task) {
    if (!data) return;
    // If it just completed, it drops off "current" - reload to pull the
    // next one from the queue.
    if (updated.status === "COMPLETED") {
      load();
    } else {
      setData({ ...data, current: updated });
    }
  }

  if (!data) return <p style={{ color: "var(--text-muted)" }}>Loading your queue...</p>;

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>What's next</h2>
      <p style={{ color: "var(--text-muted)", marginTop: 0, fontSize: 14 }}>
        {data.blockedCount > 0
          ? `${data.blockedCount} task(s) waiting on something else — you don't need to think about those right now.`
          : "Nothing blocked right now."}
      </p>

      {data.current ? (
        <div className="card card-current-task">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>{data.current.title}</h3>
            <StatusBadge status={data.current.status} />
          </div>
          <p style={{ color: "var(--text-muted)" }}>{data.current.description}</p>
          <p style={{ fontSize: 13 }}>
            <strong>Definition of done:</strong> {data.current.definitionOfDone}
          </p>
          {data.current.overrunAlertFired && (
            <p style={{ color: "var(--warning)", fontSize: 13 }}>
              ⚠ This task has run past its estimated time.
            </p>
          )}

          <div style={{ marginTop: 16 }}>
            <TaskTimer
              task={data.current}
              baseSeconds={data.currentActualSeconds ?? 0}
              onChange={handleCurrentTaskChange}
            />
          </div>

          <div style={{ marginTop: 14 }}>
            <BlockedWhyForm task={data.current} onChange={handleCurrentTaskChange} />
          </div>
        </div>
      ) : (
        <div className="card">
          <p style={{ color: "var(--text-muted)", margin: 0 }}>
            No task in progress. Pick one from "Up next" below to start it.
          </p>
        </div>
      )}

      {data.nextUp.length > 0 && (
        <>
          <h3 style={{ marginTop: 28 }}>Up next</h3>
          {data.nextUp.map((t) => (
            <div key={t._id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong>{t.title}</strong>
                <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
                  Due {new Date(t.dueDate).toLocaleDateString()} · {t.estimatedHours}h est.
                </p>
              </div>
              <StatusBadge status={t.status} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
