import React, { useEffect, useState } from "react";
import client from "../api/client";
import { Task } from "../types";
import StatusBadge from "../components/StatusBadge";
import TaskTimer from "../components/TaskTimer";
import BlockedWhyForm from "../components/BlockedWhyForm";
import CompletionProposals from "../components/CompletionProposals";
import { formatDate, relativeFrom } from "../utils/format";
import { useAuth } from "../context/AuthContext";

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
    <div className="card mt-5">
      <h3 className="card-title">Your week</h3>
      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-value">{c.tasksCompleted}</div>
          <p className="stat-label">tasks completed</p>
        </div>
        <div className="stat-card">
          <div className="stat-value">{c.onTimePct === null ? "—" : `${c.onTimePct}%`}</div>
          <p className="stat-label">on time</p>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {c.estimateAccuracyPct === null ? "—" : `${c.estimateAccuracyPct}%`}
          </div>
          <p className="stat-label">estimate accuracy</p>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {c.hoursLogged}
            <span className="stat-unit">h</span>
          </div>
          <p className="stat-label">logged this week</p>
        </div>
      </div>

      {week.trend.length > 0 && (
        <>
          <h4 className="card-title-quiet mt-5">Previous weeks</h4>
          <div className="strip">
            {week.trend.map((t, i) => (
              <div key={`week-${i}`} className="strip-cell">
                <div className="strip-cell-value">{t.tasksCompleted}</div>
                <div className="strip-cell-label">{t.hoursLogged}h logged</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function EmployeeHome() {
  const { user } = useAuth();
  const [data, setData] = useState<QueueResponse | null>(null);
  const [presence, setPresence] = useState<{
    status: string;
    activityConfidence?: string;
    lastActivityAt?: string | null;
  } | null>(null);

  async function load() {
    const [queue, status] = await Promise.all([
      client.get("/tasks/my-queue"),
      client.get("/activity/status").catch(() => null),
    ]);
    setData(queue.data);
    if (status) setPresence(status.data);
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

  if (!data) return <p className="muted">Loading your queue...</p>;

  return (
    <div>
      <div className="page-head">
        <h2 className="page-title">
          What's next
          {presence && (
            <span
              className={`pill ${
                presence.status === "ACTIVE" ? "pill-success" : "pill-warning"
              }`}
            >
              {presence.status === "ACTIVE"
                ? presence.activityConfidence === "CONFIRMED"
                  ? "Active"
                  : "Active (activity unknown)"
                : "On break / inactive"}
            </span>
          )}
        </h2>
      </div>
      <p className="page-sub">
        {data.blockedCount > 0
          ? `${data.blockedCount} task(s) waiting on something else — you don't need to think about those right now.`
          : "Nothing blocked right now."}
        {presence?.lastActivityAt && (
          <span className="text-xs muted d-block mt-1">
            Last activity signal: {relativeFrom(presence.lastActivityAt)}
          </span>
        )}
      </p>

      {/* Anything an external system suggested as finished waits here for the
          employee's own confirmation (Section 4). */}
      <CompletionProposals onDecided={load} />

      {data.current ? (
        <div className="card card-current-task">
          <div className="card-head">
            <h3 className="card-title mb-0">{data.current.title}</h3>
            <StatusBadge status={data.current.status} />
          </div>
          <p className="muted mt-0 mb-2">{data.current.description}</p>
          <p className="text-sm mt-0 mb-2">
            <strong>Definition of done:</strong> {data.current.definitionOfDone}
          </p>
          <p className="text-sm muted mt-0 mb-0">
            Due {formatDate(data.current.dueDate, user?.timezone)} · {data.current.estimatedHours}h
            estimated
          </p>
          {data.current.overrunAlertFired && (
            <p className="notice notice-warning">
              ⚠ This task has run past its estimated time. Worth a quick check on the estimate.
            </p>
          )}

          <div className="mt-4">
            <TaskTimer
              task={data.current}
              baseSeconds={data.currentActualSeconds ?? 0}
              onChange={handleCurrentTaskChange}
            />
          </div>

          <div className="mt-3">
            <BlockedWhyForm task={data.current} onChange={handleCurrentTaskChange} />
          </div>
        </div>
      ) : (
        <div className="card">
          <p className="muted m-0">
            No task in progress. Pick one from "Up next" below to start it.
          </p>
        </div>
      )}

      {data.nextUp.length > 0 && (
        <>
          <h3 className="section-title">Up next</h3>
          {data.nextUp.map((t) => (
            <div key={t._id} className="card list-row">
              <div>
                <strong>{t.title}</strong>
                <p className="list-meta">
                  Due {formatDate(t.dueDate, user?.timezone)} · {t.estimatedHours}h est.
                </p>
              </div>
              <div className="row">
                <StatusBadge status={t.status} />
                {t.status === "READY" && (
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      await client.post(`/tasks/${t._id}/start`);
                      load();
                    }}
                  >
                    Start
                  </button>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      <YourWeekCard />
    </div>
  );
}
