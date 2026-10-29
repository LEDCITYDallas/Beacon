import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import client from "../api/client";
import { Priority, Task, TaskStatus } from "../types";
import StatusBadge from "../components/StatusBadge";
import TaskTimer from "../components/TaskTimer";
import BlockedWhyForm from "../components/BlockedWhyForm";
import CompletionProposals from "../components/CompletionProposals";
import { formatDate, formatDayShort, relativeFrom, todayInZone } from "../utils/format";
import { useAuth } from "../context/AuthContext";
import PageHeader from "../components/PageHeader";
import LoadingState from "../components/LoadingState";
import { notify } from "../components/Toaster";
import Icon from "../components/Icon";
import { ChartLegend, DonutChart, RingStat } from "../components/Charts";
import { ActivityCard, StatStrip } from "../components/Dashboard";
import MonthCalendar from "../components/MonthCalendar";
import { CitySkyline, LedCluster } from "../components/Brand";
import { assignedId, dueByDay, isOverdue, percentOf, statusBreakdown } from "../utils/dashboard";

interface QueueResponse {
  current: Task | null;
  currentActualSeconds?: number;
  nextUp: Task[];
  blockedCount: number;
}

interface WeekWindow {
  windowStart?: string;
  windowEnd?: string;
  tasksCompleted: number;
  onTimeCompleted: number;
  onTimePct: number | null;
  estimateAccuracyPct: number | null;
  hoursLogged: number;
}

interface WeekStats {
  current: WeekWindow;
  trend: WeekWindow[];
}

const PRIORITY_LABEL: Record<Priority, string> = {
  URGENT: "Urgent",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

const BLOCKED_REASON: Record<string, string> = {
  WAITING_ON_OTHER: "Waiting on another person or system",
  NOT_CONFIDENT: "Needs more information before it can move",
};

function apiMessage(err: unknown, fallback: string) {
  if (err && typeof err === "object" && "response" in err) {
    const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
    if (message) return message;
  }
  return fallback;
}

function firstName(name?: string) {
  const trimmed = name?.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}

function todayLong(timeZone?: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: timeZone || undefined,
    }).format(new Date());
  } catch {
    return formatDate(new Date());
  }
}

function dependencyLines(task: Task) {
  const deps = task.dependsOn as unknown;
  if (!Array.isArray(deps)) return [];
  return deps.flatMap((dep) => {
    if (!dep || typeof dep !== "object" || !("title" in dep) || typeof dep.title !== "string") {
      return [];
    }
    const status = "status" in dep ? String(dep.status) : "";
    return [{ title: dep.title, status: status as TaskStatus | "" }];
  });
}

function PriorityMark({ priority }: { priority: Priority }) {
  const tone =
    priority === "URGENT" ? "pill-danger" : priority === "HIGH" ? "pill-warning" : "pill-neutral";
  return <span className={`pill ${tone}`}>{PRIORITY_LABEL[priority] || priority}</span>;
}

function TaskFacts({ task, timeZone }: { task: Task; timeZone?: string }) {
  return (
    <ul className="home-meta">
      <li>
        Due <strong>{formatDate(task.dueDate, timeZone)}</strong>
        {isOverdue(task) ? <span className="pill pill-danger">Overdue</span> : null}
      </li>
      <li>
        Estimate <strong>{task.estimatedHours}h</strong>
      </li>
      {task.department ? (
        <li>
          Department <strong>{task.department}</strong>
        </li>
      ) : null}
    </ul>
  );
}

function DueLabel({ task, timeZone }: { task: Task; timeZone?: string }) {
  const late = isOverdue(task);
  return (
    <span className={`due-label${late ? " is-late" : ""}`}>
      {late ? <Icon name="alert" size={13} /> : null}
      Due {formatDayShort(task.dueDate, timeZone)}
      {late ? <span className="sr-only"> (overdue)</span> : null}
    </span>
  );
}

function YourWeekCard({
  week,
  error,
  timeZone,
}: {
  week: WeekStats | null;
  error: string;
  timeZone?: string;
}) {
  return (
    <section className="card home-week" aria-labelledby="home-week">
      <div className="card-head">
        <h2 id="home-week" className="card-title mb-0">
          This week
        </h2>
      </div>
      <p className="card-intro">
        Counts from tasks you completed and time you logged. These are not an official score.
      </p>
      {error ? <p className="notice notice-danger">{error}</p> : null}
      {!week && !error ? <LoadingState label="Loading this week's counts…" /> : null}
      {week ? (
        <>
          {week.current.windowStart && week.current.windowEnd ? (
            <p className="home-note mt-0">
              {formatDate(week.current.windowStart, timeZone)} – {formatDate(week.current.windowEnd, timeZone)}
            </p>
          ) : null}
          <div className="home-metrics">
            <div className="home-metric">
              <div className="home-metric-value">{week.current.tasksCompleted}</div>
              <p className="home-metric-label">Tasks completed</p>
            </div>
            <div className="home-metric">
              <div className="home-metric-value">
                {week.current.onTimePct === null ? "—" : `${week.current.onTimePct}%`}
              </div>
              <p className="home-metric-label">
                On time
                {week.current.tasksCompleted > 0
                  ? ` · ${week.current.onTimeCompleted} of ${week.current.tasksCompleted}`
                  : ""}
              </p>
            </div>
            <div className="home-metric">
              <div className="home-metric-value">
                {week.current.estimateAccuracyPct === null
                  ? "—"
                  : `${week.current.estimateAccuracyPct}%`}
              </div>
              <p className="home-metric-label">Estimate accuracy</p>
            </div>
            <div className="home-metric">
              <div className="home-metric-value">
                {week.current.hoursLogged}
                <span className="stat-unit">h</span>
              </div>
              <p className="home-metric-label">Hours logged</p>
            </div>
          </div>
          {week.current.onTimePct === null || week.current.estimateAccuracyPct === null ? (
            <p className="home-note">
              A dash means this window does not yet have a completed task with the inputs that figure needs.
            </p>
          ) : null}
          {week.trend.length > 0 ? (
            <>
              <h3 className="card-title-quiet">Earlier windows</h3>
              <div className="home-trend">
                {week.trend.map((item, index) => (
                  <div key={`week-${item.windowEnd || index}`} className="home-metric">
                    <div className="home-metric-value home-metric-value-quiet">{item.tasksCompleted}</div>
                    <p className="home-metric-label">
                      {item.windowStart && item.windowEnd
                        ? `${formatDate(item.windowStart, timeZone)} – ${formatDate(item.windowEnd, timeZone)}`
                        : "Previous window"}
                    </p>
                    <p className="home-note">{item.hoursLogged}h logged</p>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default function EmployeeHome() {
  const { user } = useAuth();
  const location = useLocation();
  const timeZone = user?.timezone;
  const [data, setData] = useState<QueueResponse | null>(null);
  const [mine, setMine] = useState<Task[]>([]);
  const [tasksReady, setTasksReady] = useState(false);
  const [tasksError, setTasksError] = useState("");
  const [week, setWeek] = useState<WeekStats | null>(null);
  const [weekError, setWeekError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<string | null>(null);
  const startingRef = useRef(false);
  const [actionError, setActionError] = useState("");
  const [highlightId, setHighlightId] = useState("");
  const handledJump = useRef("");
  const [presence, setPresence] = useState<{
    status: string;
    activityConfidence?: string;
    lastActivityAt?: string | null;
  } | null>(null);

  async function load() {
    setError("");
    setActionError("");
    try {
      const [queue, status, taskResult, weekResult] = await Promise.all([
        client.get("/tasks/my-queue"),
        client.get("/activity/status").catch(() => null),
        client.get("/tasks").then(
          (res) => ({ ok: true as const, tasks: res.data as Task[] }),
          (err: unknown) => ({ ok: false as const, err })
        ),
        client.get("/stats/my-week").then(
          (res) => ({ ok: true as const, week: res.data as WeekStats }),
          (err: unknown) => ({ ok: false as const, err })
        ),
      ]);
      setData(queue.data as QueueResponse);
      if (status) setPresence(status.data);
      if (taskResult.ok) {
        setMine(taskResult.tasks.filter((task) => assignedId(task) === user?.id));
        setTasksError("");
      } else {
        setMine([]);
        setTasksError(apiMessage(taskResult.err, "Could not load your task list."));
      }
      setTasksReady(true);
      if (weekResult.ok) {
        setWeek(weekResult.week);
        setWeekError("");
      } else {
        setWeekError(apiMessage(weekResult.err, "Could not load this week's counts."));
      }
    } catch (err) {
      setError(apiMessage(err, "Could not load your queue."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // user id is stable for the session; reload is explicit after task actions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A task picked in the top-bar search lands here as #task-<id>: bring that
  // row into view once, and mark it briefly so the eye can find it.
  useEffect(() => {
    if (!data || !location.hash.startsWith("#task-")) return;
    const marker = `${location.key}${location.hash}`;
    if (handledJump.current === marker) return;
    handledJump.current = marker;
    const node = document.getElementById(location.hash.slice(1));
    if (!node) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    node.focus({ preventScroll: true });
    setHighlightId(location.hash.slice("#task-".length));
    const timer = window.setTimeout(() => setHighlightId(""), 2200);
    return () => window.clearTimeout(timer);
  }, [data, location.hash, location.key]);

  function handleCurrentTaskChange(updated: Task) {
    if (!data) return;
    if (updated.status === "COMPLETED" || updated.status === "BLOCKED") {
      load();
    } else {
      setData({ ...data, current: updated });
    }
  }

  async function startTask(taskId: string) {
    if (startingRef.current) return;
    startingRef.current = true;
    setStartingId(taskId);
    setActionError("");
    try {
      await client.post(`/tasks/${taskId}/start`);
      await load();
      notify("success", "Task started.");
    } catch (err) {
      setActionError(apiMessage(err, "Could not start that task."));
    } finally {
      startingRef.current = false;
      setStartingId(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="home-state">
        <LoadingState label="Loading your queue. Fetching the task you are on, what is ready, and what is blocked." />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="home-state" role="alert">
        <p className="home-kicker">Workday</p>
        <h2>Could not load your queue</h2>
        <p>{error}</p>
        <button type="button" className="btn" onClick={() => load()}>
          Try again
        </button>
      </div>
    );
  }

  if (!data) return null;

  const name = firstName(user?.name);
  const todayKey = todayInZone(timeZone);
  const counts = statusBreakdown(mine);
  const overdueCount = mine.filter(isOverdue).length;
  const blockedTasks = mine.filter((task) => task.status === "BLOCKED");
  const readyCount = data.nextUp.length;
  const presenceLabel = !presence
    ? ""
    : presence.status === "ACTIVE"
      ? presence.activityConfidence === "CONFIRMED"
        ? "Active"
        : "Active (activity unknown)"
      : "On break / inactive";
  const currentTone = data.current
    ? data.current.status === "BLOCKED"
      ? "is-blocked"
      : data.current.status === "PAUSED"
        ? "is-paused"
        : data.current.status === "COMPLETED"
          ? "is-done"
          : isOverdue(data.current)
            ? "is-overdue"
            : "is-active"
    : "is-idle";
  const dependencies = data.current ? dependencyLines(data.current) : [];
  const unknown = tasksError ? "—" : null;

  return (
    <div className="home dash-page">
      <div className="dash">
        <div className="dash-main">
          <PageHeader
            title={name ? `Welcome ${name}!` : "Welcome!"}
            description={
              <>
                {todayLong(timeZone)}
                {timeZone ? ` · ${timeZone}` : ""}
                {presenceLabel ? ` · ${presenceLabel}` : ""}
                {presence?.lastActivityAt ? `, last activity ${relativeFrom(presence.lastActivityAt)}` : ""}
              </>
            }
          />

          {error ? (
            <p className="notice notice-danger" role="alert">
              {error}
            </p>
          ) : null}

          <CompletionProposals onDecided={load} />

          <div className="dash-pair">
            <section className="card kpi-card" aria-labelledby="home-tasks-title">
              <h2 id="home-tasks-title" className="card-title">
                My tasks
              </h2>
              {tasksError ? (
                <p className="notice notice-danger">{tasksError}</p>
              ) : (
                <div className="kpi-body">
                  <DonutChart
                    segments={[
                      { key: "active", label: "In progress", value: counts.active, tone: "emerald" },
                      { key: "ready", label: "Ready", value: counts.ready, tone: "mint" },
                      { key: "blocked", label: "Blocked", value: counts.blocked, tone: "amber" },
                      { key: "completed", label: "Completed", value: counts.completed, tone: "forest" },
                    ]}
                    centerValue={counts.total}
                    centerLabel={counts.total === 1 ? "task" : "tasks"}
                    label={`${counts.total} tasks assigned to you: ${counts.active} in progress, ${counts.ready} ready, ${counts.blocked} blocked, ${counts.completed} completed.`}
                  />
                  <ChartLegend
                    items={[
                      { key: "active", label: "In progress", tone: "emerald", value: counts.active },
                      { key: "ready", label: "Ready", tone: "mint", value: counts.ready },
                      { key: "blocked", label: "Blocked", tone: "amber", value: counts.blocked },
                      { key: "completed", label: "Completed", tone: "forest", value: counts.completed },
                    ]}
                  />
                </div>
              )}
            </section>

            <section className="card kpi-card" aria-labelledby="home-progress-title">
              <h2 id="home-progress-title" className="card-title">
                Progress
              </h2>
              <div className="ring-row">
                <RingStat
                  value={tasksError ? null : percentOf(counts.completed, counts.total)}
                  tone="forest"
                  label="Completed"
                  detail={tasksError ? "Unavailable" : `${counts.completed} of ${counts.total} tasks`}
                />
                <RingStat
                  value={week ? week.current.onTimePct : null}
                  tone="emerald"
                  label="On time"
                  detail={
                    week
                      ? week.current.tasksCompleted > 0
                        ? `${week.current.onTimeCompleted} of ${week.current.tasksCompleted} this week`
                        : "None done this week"
                      : weekError
                        ? "Unavailable"
                        : "Loading…"
                  }
                />
                <RingStat
                  value={week ? week.current.estimateAccuracyPct : null}
                  tone="amber"
                  label="Estimate accuracy"
                  detail={week ? "This week" : weekError ? "Unavailable" : "Loading…"}
                />
              </div>
            </section>
          </div>

          <ActivityCard
            tasks={mine}
            todayKey={todayKey}
            timeZone={timeZone}
            caption="Events on tasks assigned to you"
          />

          {data.blockedCount > 0 ? (
            <section className="card" aria-labelledby="home-blocked">
              <div className="card-head">
                <h2 id="home-blocked" className="card-title mb-0">
                  Blocked
                </h2>
                <span className="pill pill-danger">{data.blockedCount}</span>
              </div>
              <p className="card-caption">These cannot be started. They are not part of the ready ranking.</p>
              {tasksError ? <p className="notice notice-danger">{tasksError}</p> : null}
              {!tasksReady ? <LoadingState label="Loading blocked tasks…" /> : null}
              {blockedTasks.length === 0 && !tasksError && tasksReady ? (
                <p className="home-note">
                  {data.blockedCount} blocked {data.blockedCount === 1 ? "task is" : "tasks are"} counted,
                  and none of those records came back on your task list.
                </p>
              ) : null}
              {blockedTasks.length > 0 ? (
                <ul className="people-list">
                  {blockedTasks.map((task) => {
                    const deps = dependencyLines(task);
                    return (
                      <li
                        key={task._id}
                        id={`task-${task._id}`}
                        tabIndex={-1}
                        className={`people-row is-blocked${highlightId === task._id ? " is-highlighted" : ""}`}
                      >
                        <span className="row-tile tile-blocked" aria-hidden="true">
                          <Icon name="alert" size={16} />
                        </span>
                        <div className="people-body">
                          <p className="people-name">{task.title}</p>
                          {task.blockedReason?.type ? (
                            <p className="people-meta">
                              {BLOCKED_REASON[task.blockedReason.type] || task.blockedReason.type}
                              {task.blockedReason.note ? ` — ${task.blockedReason.note}` : ""}
                            </p>
                          ) : null}
                          {deps.length > 0 ? (
                            <ul className="home-deps">
                              {deps.map((dep) => (
                                <li key={`${task._id}-${dep.title}`}>
                                  Depends on {dep.title}
                                  {dep.status ? (
                                    <>
                                      {" "}
                                      <StatusBadge status={dep.status} />
                                    </>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                        <div className="people-side">
                          <DueLabel task={task} timeZone={timeZone} />
                          <PriorityMark priority={task.priority} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          ) : null}

          <YourWeekCard week={week} error={weekError} timeZone={timeZone} />
        </div>

        <div className="dash-rail">
          <StatStrip
            label="Queue summary"
            items={[
              { key: "ready", label: "Ready", value: unknown ?? counts.ready, tone: "accent" },
              {
                key: "overdue",
                label: "Overdue",
                value: unknown ?? overdueCount,
                tone: overdueCount > 0 ? "danger" : undefined,
              },
              {
                key: "blocked",
                label: "Blocked",
                value: data.blockedCount,
                tone: data.blockedCount > 0 ? "warning" : undefined,
              },
            ]}
          />

          <section
            className={`card highlight-card ${currentTone}${
              data.current && highlightId === data.current._id ? " is-highlighted" : ""
            }`}
            aria-labelledby="home-now-title"
            id={data.current ? `task-${data.current._id}` : undefined}
            tabIndex={data.current ? -1 : undefined}
          >
            <LedCluster />
            <div className="highlight-top">
              <span className="highlight-icon" aria-hidden="true">
                <Icon name={data.current ? "clock" : "play"} size={22} />
              </span>
              <div className="highlight-text">
                <p className="highlight-kicker">Now</p>
                <h2 id="home-now-title" className="highlight-title">
                  {data.current ? data.current.title : "No task in progress"}
                </h2>
                {data.current ? (
                  <div className="highlight-badges">
                    <StatusBadge status={data.current.status} />
                    <PriorityMark priority={data.current.priority} />
                  </div>
                ) : (
                  <p className="highlight-sub">
                    {readyCount > 0
                      ? "Start a ready task from Up next. The timer begins when you do."
                      : data.blockedCount > 0
                        ? "Ready work is clear. Blocked tasks stay listed until they can move."
                        : "Your queue has no ready work right now."}
                  </p>
                )}
              </div>
            </div>
            {data.current ? (
              <div className="highlight-body">
                <TaskFacts task={data.current} timeZone={timeZone} />
                {data.current.description ? <p className="home-copy">{data.current.description}</p> : null}
                <dl className="home-def">
                  <div>
                    <dt>Definition of done</dt>
                    <dd>{data.current.definitionOfDone}</dd>
                  </div>
                  {data.current.blockedReason?.type ? (
                    <div>
                      <dt>Blocked because</dt>
                      <dd>
                        {BLOCKED_REASON[data.current.blockedReason.type] || data.current.blockedReason.type}
                        {data.current.blockedReason.note ? ` — ${data.current.blockedReason.note}` : ""}
                      </dd>
                    </div>
                  ) : null}
                  {dependencies.length > 0 ? (
                    <div>
                      <dt>Depends on</dt>
                      <dd>
                        <ul className="home-deps">
                          {dependencies.map((dep) => (
                            <li key={dep.title}>
                              {dep.title}
                              {dep.status ? (
                                <>
                                  {" "}
                                  <StatusBadge status={dep.status} />
                                </>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {data.current.overrunAlertFired ? (
                  <p className="notice notice-warning">
                    Logged time has passed the estimate. Check whether the estimate still fits the work.
                  </p>
                ) : null}
                {data.current.flagged && data.current.flagNote ? (
                  <p className="notice notice-accent">Flagged: {data.current.flagNote}</p>
                ) : null}
                <TaskTimer
                  task={data.current}
                  baseSeconds={data.currentActualSeconds ?? 0}
                  onChange={handleCurrentTaskChange}
                />
                <div className="mt-3">
                  <BlockedWhyForm task={data.current} onChange={handleCurrentTaskChange} />
                </div>
              </div>
            ) : null}
            <CitySkyline />
          </section>

          <section className="card list-card" aria-labelledby="home-next">
            <div className="card-head">
              <h2 id="home-next" className="card-title mb-0">
                Up next
              </h2>
              {!tasksError && counts.ready > readyCount ? (
                <span className="card-count">
                  {readyCount} of {counts.ready} ready
                </span>
              ) : null}
            </div>
            <p className="card-caption">Ready tasks, in the order the queue ranked them.</p>
            {actionError ? (
              <p className="notice notice-danger" role="alert">
                {actionError}
              </p>
            ) : null}
            {data.nextUp.length === 0 ? (
              <p className="list-empty">Nothing assigned to you is ready to start.</p>
            ) : (
              <ul className="people-list">
                {data.nextUp.map((task) => (
                  <li
                    key={task._id}
                    id={`task-${task._id}`}
                    tabIndex={-1}
                    className={`people-row${isOverdue(task) ? " is-overdue" : ""}${
                      highlightId === task._id ? " is-highlighted" : ""
                    }`}
                  >
                    <span className={`row-tile tile-${task.priority.toLowerCase()}`} aria-hidden="true">
                      {(PRIORITY_LABEL[task.priority] || task.priority).charAt(0)}
                    </span>
                    <div className="people-body">
                      <p className="people-name" id={`next-${task._id}`}>
                        {task.title}
                      </p>
                      <p className="people-meta">
                        {PRIORITY_LABEL[task.priority] || task.priority} priority · {task.estimatedHours}h estimate
                      </p>
                    </div>
                    <div className="people-side">
                      <DueLabel task={task} timeZone={timeZone} />
                      {task.status === "READY" ? (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={Boolean(startingId)}
                          aria-describedby={`next-${task._id}`}
                          onClick={() => startTask(task._id)}
                        >
                          {startingId === task._id ? "Starting…" : "Start"}
                        </button>
                      ) : (
                        <StatusBadge status={task.status} />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <MonthCalendar
            todayKey={todayKey}
            days={tasksError ? {} : dueByDay(mine, timeZone)}
            caption={tasksError ? "Due dates are unavailable right now" : "Due dates for your open tasks"}
          />
        </div>
      </div>
    </div>
  );
}
