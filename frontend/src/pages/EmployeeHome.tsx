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

interface WeekStats {
  current: {
    tasksCompleted: number;
    onTimeCompleted: number;
    onTimePct: number | null;
    estimateAccuracyPct: number | null;
    hoursLogged: number;
  };
  trend: {
    tasksCompleted: number;
    hoursLogged: number;
  }[];
}

function YourWeekCard() {
  const [week, setWeek] = useState<WeekStats | null>(null);

  useEffect(() => {
    client
      .get("/stats/my-week")
      .then((res) => setWeek(res.data))
      .catch(() => {});
  }, []);

  if (!week) return null;

  const c = week.current;
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <h3 style={{ margin: "0 0 8px" }}>Your week</h3>
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "var(--accent-light)" }}>
            {c.tasksCompleted}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>tasks completed</p>
        </div>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "var(--accent-light)" }}>
            {c.onTimePct === null ? "—" : `${c.onTimePct}%`}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>on time</p>
        </div>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "var(--accent-light)" }}>
            {c.estimateAccuracyPct === null ? "—" : `${c.estimateAccuracyPct}%`}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>estimate accuracy</p>
        </div>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "var(--accent-light)" }}>
            {c.hoursLogged}h
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>logged</p>
        </div>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "var(--text-muted)" }}>
            {week.trend.map((t) => t.tasksCompleted).join(" · ")}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>previous 3 weeks</p>
        </div>
      </div>
    </div>
  );
}

export default function EmployeeHome() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [presence, setPresence] = useState<{ status: string } | null>(null);

  async function load() {
    const res = await client.get("/tasks/my-queue");
    setData(res.data);
  }

  useEffect(() => {
    load();
    client
      .get("/activity/status")
      .then((res) => setPresence(res.data))
      .catch(() => {});
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
      <h2 style={{ marginBottom: 4 }}>
        What's next{" "}
        {presence && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 999,
              marginLeft: 8,
              background:
                presence.status === "ACTIVE"
                  ? "rgba(34,197,94,0.15)"
                  : "rgba(245,158,11,0.15)",
              color: presence.status === "ACTIVE" ? "var(--success)" : "var(--warning)",
              verticalAlign: "middle",
            }}
          >
            {presence.status === "ACTIVE" ? "Active" : "On break / inactive"}
          </span>
        )}
      </h2>
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

      <YourWeekCard />
    </div>
  );
}
