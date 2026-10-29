import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import client from "../api/client";
import { Task } from "../types";
import StatusBadge from "../components/StatusBadge";
import Avatar from "../components/Avatar";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatDayShort, relativeFrom, todayInZone } from "../utils/format";
import PageHeader from "../components/PageHeader";
import LoadingState from "../components/LoadingState";
import { confirmAction } from "../components/ConfirmDialog";
import Icon from "../components/Icon";
import { ChartLegend, DonutChart, RingStat, Segment, Tone } from "../components/Charts";
import { ActivityCard, StatStrip } from "../components/Dashboard";
import MonthCalendar from "../components/MonthCalendar";
import { CitySkyline, LedCluster } from "../components/Brand";
import { assigneeName, dueByDay, percentOf, statusBreakdown } from "../utils/dashboard";

// ---------------------------------------------------------------------
// Manager team queue (Priorities 2, 5, 6, 10).
//
// Adds the pieces the earlier phase was missing:
//   - a real assignee picker instead of typing an ObjectId
//   - live activity/idle state per person (aggregate state, never activity
//     content - there is no such data to show)
//   - in-app alert feed + an explicit "email me the summary" action
//   - completion proposals with their evidence, visible to the manager
// ---------------------------------------------------------------------

interface TaskRow {
  _id: string;
  title: string;
  priority: string;
  status: string;
  dueDate: string;
  department: string;
  flagged?: boolean;
  flagNote?: string;
  reopenCount?: number;
  assignedTo: { _id: string; name: string; email: string } | string;
  blockedReason?: { type: string; note: string };
  pendingCompletionProposal?: {
    isPending: boolean;
    detectedSignal: string;
    confidence?: number;
    evidence?: { source: string; externalId: string; summary: string; evidenceUrl: string };
  };
}

interface Alerts {
  overdue: TaskRow[];
  blocked: TaskRow[];
  recentNotifications?: {
    channel: string;
    kind: string;
    status: string;
    driver: string;
    subject: string;
    at: string;
  }[];
  delivery?: {
    masterSwitch: string;
    email: { transport: string; live: boolean };
    whatsapp: { live: boolean; configured: boolean };
  };
}

interface PresenceRow {
  userId: string;
  name: string;
  department: string;
  status: string;
  activityConfidence: string;
  lastActivityAt: string | null;
  idleThresholdMinutes: number;
}

interface DirectoryUser {
  id: string;
  name: string;
  role: string;
  department: string;
  timezone: string;
  isActive?: boolean;
}

const SEGMENT_TONES: Tone[] = ["forest", "emerald", "amber", "mint"];
const ROLE_GROUP: Record<string, string> = {
  EMPLOYEE: "Employees",
  MANAGER: "Managers",
  SUPER_ADMIN: "Admins",
};

// Departments when the scope spans several (super admin), otherwise roles, so
// a single-department manager still sees a meaningful split.
function memberSegments(members: { department: string; role: string }[]): Segment[] {
  const departments = new Set(members.map((member) => member.department || "Unassigned"));
  const groupOf = (member: { department: string; role: string }) =>
    departments.size > 1 ? member.department || "Unassigned" : ROLE_GROUP[member.role] || "Members";
  const counts = new Map<string, number>();
  for (const member of members) counts.set(groupOf(member), (counts.get(groupOf(member)) || 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const segments: Segment[] = sorted.slice(0, 4).map(([label, value], index) => ({
    key: label,
    label,
    value,
    tone: SEGMENT_TONES[index],
  }));
  const rest = sorted.slice(4).reduce((sum, [, value]) => sum + value, 0);
  if (rest > 0) segments.push({ key: "other", label: "Other", value: rest, tone: "sage" });
  return segments;
}

export default function ManagerDashboard() {
  const { user } = useAuth();
  const timeZone = user?.timezone;
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = (searchParams.get("q") || "").trim();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [presence, setPresence] = useState<PresenceRow[]>([]);
  const [people, setPeople] = useState<DirectoryUser[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [actingId, setActingId] = useState<string | null>(null);
  const [sendingSummary, setSendingSummary] = useState(false);

  const load = useCallback(async () => {
    try {
      const [tasksRes, alertsRes, presenceRes, peopleRes] = await Promise.all([
        client.get("/tasks"),
        client.get("/alerts").catch(() => null),
        client.get("/activity/team").catch(() => null),
        client.get("/users").catch(() => null),
      ]);
      setTasks(tasksRes.data);
      if (alertsRes) setAlerts(alertsRes.data);
      if (presenceRes) setPresence(presenceRes.data);
      if (peopleRes) setPeople(peopleRes.data);
      setError("");
    } catch (err: any) {
      setError(err.response?.data?.message || "Could not load the team queue.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleFlag(t: TaskRow) {
    if (actingId) return;
    setActingId(t._id);
    setError("");
    try {
      await client.post(`/tasks/${t._id}/flag`, { flagged: !t.flagged });
      await load();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { message?: string } } }).response?.data;
      setError(data?.message || "Could not update the flag.");
    } finally {
      setActingId(null);
    }
  }

  async function reopen(t: TaskRow) {
    if (actingId) return;
    if (!(await confirmAction(`Reopen "${t.title}"? This counts as rework on the scorecard input.`))) return;
    setActingId(t._id);
    setError("");
    try {
      await client.post(`/tasks/${t._id}/reopen`);
      await load();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { message?: string } } }).response?.data;
      setError(data?.message || "Could not reopen the task.");
    } finally {
      setActingId(null);
    }
  }

  async function emailAlertSummary() {
    if (sendingSummary) return;
    setSendingSummary(true);
    setNotice("");
    setError("");
    try {
      const res = await client.post("/alerts/dispatch", {});
      const lines = (res.data.dispatched as { kind: string; count: number; status: string }[])
        .map((d) => `${d.kind}: ${d.count} task(s), ${d.status}`)
        .join(" · ");
      setNotice(
        lines
          ? `Summary recorded — ${lines}. ${res.data.explanation}`
          : res.data.explanation
      );
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || "Could not dispatch the alert email");
    } finally {
      setSendingSummary(false);
    }
  }

  const presenceOf = (row: TaskRow) => {
    const id = typeof row.assignedTo === "object" ? row.assignedTo._id : String(row.assignedTo);
    return presence.find((p) => p.userId === id);
  };

  const scopeLabel = user?.role === "MANAGER" ? user.department : "all departments";
  const todayKey = todayInZone(timeZone);
  const counts = statusBreakdown(tasks);
  const members =
    people.length > 0
      ? people.filter((person) => person.isActive !== false)
      : presence.map((row) => ({ department: row.department, role: "" }));
  const segments = memberSegments(members);
  const signalled = presence.filter((row) => row.lastActivityAt);
  const activeNow = signalled.filter((row) => row.status === "ACTIVE").length;
  const onBreak = signalled.length - activeNow;
  const noSignal = presence.length - signalled.length;
  const needle = filter.toLowerCase();
  const visibleTasks = needle
    ? tasks.filter((task) =>
        `${task.title} ${assigneeName(task)} ${task.department} ${task.status.replace("_", " ")} ${task.priority}`
          .toLowerCase()
          .includes(needle)
      )
    : tasks;
  const overdueCount = alerts?.overdue.length ?? 0;
  const blockedCount = alerts?.blocked.length ?? 0;

  return (
    <div className="dash-page">
      <div className="dash">
        <div className="dash-main">
          <PageHeader
            title="Team queue"
            description={
              user?.role === "MANAGER"
                ? `Scoped to ${user.department} — other departments are not visible to you.`
                : "Global scope (Super Admin)."
            }
            actions={
              <button className="btn" aria-expanded={showForm} onClick={() => setShowForm((s) => !s)}>
                {showForm ? null : <Icon name="plus" size={16} />}
                {showForm ? "Close" : "New task"}
              </button>
            }
          />

          {error && <p className="notice notice-danger">{error}</p>}
          {notice && <p className="notice notice-success">{notice}</p>}

          {showForm && (
            <CreateTaskForm
              people={people}
              onCreated={() => {
                setShowForm(false);
                void load();
              }}
            />
          )}

          <div className="dash-pair">
            <section className="card kpi-card" aria-labelledby="team-members-title">
              <h2 id="team-members-title" className="card-title">
                Team members
              </h2>
              {!loaded ? (
                <LoadingState label="Loading people…" />
              ) : members.length === 0 ? (
                <p className="list-empty">No people are visible in your scope.</p>
              ) : (
                <div className="kpi-body">
                  <DonutChart
                    segments={segments}
                    centerValue={members.length}
                    centerLabel="active"
                    label={`${members.length} active accounts: ${segments
                      .map((segment) => `${segment.value} ${segment.label}`)
                      .join(", ")}.`}
                  />
                  <ChartLegend
                    items={segments.map((segment) => ({
                      key: segment.key,
                      label: segment.label,
                      tone: segment.tone,
                      value: segment.value,
                    }))}
                  />
                </div>
              )}
            </section>

            <section className="card kpi-card" aria-labelledby="team-progress-title">
              <h2 id="team-progress-title" className="card-title">
                Task progress
              </h2>
              <div className="ring-row">
                <RingStat
                  value={percentOf(counts.completed, counts.total)}
                  tone="forest"
                  label="Completed"
                  detail={`${counts.completed} of ${counts.total}`}
                />
                <RingStat
                  value={percentOf(counts.active, counts.total)}
                  tone="emerald"
                  label="In progress"
                  detail={`${counts.active} of ${counts.total}`}
                />
                <RingStat
                  value={percentOf(counts.blocked, counts.total)}
                  tone="amber"
                  label="Blocked"
                  detail={`${counts.blocked} of ${counts.total}`}
                />
              </div>
            </section>
          </div>

          <ActivityCard
            tasks={tasks}
            todayKey={todayKey}
            timeZone={timeZone}
            caption={`Task events across ${scopeLabel}`}
          />
        </div>

        <div className="dash-rail">
          <StatStrip
            label="Team presence"
            items={[
              { key: "active", label: "Active", value: activeNow, tone: "accent" },
              { key: "break", label: "On break", value: onBreak, tone: onBreak > 0 ? "warning" : undefined },
              { key: "none", label: "No signal", value: noSignal },
            ]}
          />

          <section className="card highlight-card" aria-labelledby="attention-title">
            <LedCluster />
            <div className="highlight-top">
              <span className="highlight-icon" aria-hidden="true">
                <Icon name="alert" size={22} />
              </span>
              <div className="highlight-text">
                <p className="highlight-kicker">Alerts</p>
                <h2 id="attention-title" className="highlight-title">
                  Needs attention
                </h2>
                <p className="highlight-sub">
                  {alerts
                    ? `${overdueCount} overdue · ${blockedCount} blocked`
                    : loaded
                      ? "The alert summary is unavailable right now."
                      : "Loading alerts…"}
                </p>
              </div>
            </div>
            {alerts ? (
              <div className="highlight-body">
                <button
                  className="btn btn-light"
                  disabled={sendingSummary}
                  onClick={() => void emailAlertSummary()}
                >
                  <Icon name="mail" size={16} />
                  {sendingSummary ? "Sending…" : "Email me this summary"}
                </button>
                {alerts.delivery && (
                  <p className="highlight-note">
                    delivery driver: {alerts.delivery.masterSwitch} · email transport:{" "}
                    {alerts.delivery.email.transport} ({alerts.delivery.email.live ? "live" : "simulated"}) ·
                    WhatsApp {alerts.delivery.whatsapp.live ? "live" : "simulated"}
                  </p>
                )}
              </div>
            ) : null}
            <CitySkyline />
          </section>

          <section className="card list-card" aria-labelledby="attention-list-title">
            <div className="card-head">
              <h2 id="attention-list-title" className="card-title mb-0">
                Overdue &amp; blocked
              </h2>
              {alerts ? (
                <span className="row">
                  <span className="pill pill-danger">{overdueCount} overdue</span>
                  <span className="pill pill-warning">{blockedCount} blocked</span>
                </span>
              ) : null}
            </div>
            {!alerts ? (
              loaded ? (
                <p className="list-empty">Alerts could not be loaded.</p>
              ) : (
                <LoadingState label="Loading alerts…" />
              )
            ) : overdueCount === 0 && blockedCount === 0 ? (
              <p className="list-empty">Nothing overdue or blocked right now.</p>
            ) : (
              <>
                <ul className="people-list">
                  {alerts.overdue.slice(0, 5).map((t) => (
                    <li key={t._id} className="people-row">
                      <Avatar name={assigneeName(t)} />
                      <div className="people-body">
                        <p className="people-name">{t.title}</p>
                        <p className="people-meta">{assigneeName(t)}</p>
                      </div>
                      <span className="due-label is-late">
                        <Icon name="alert" size={13} />
                        Due {formatDayShort(t.dueDate, timeZone)}
                        <span className="sr-only"> (overdue)</span>
                      </span>
                    </li>
                  ))}
                  {alerts.blocked.slice(0, 5).map((t) => (
                    <li key={t._id} className="people-row">
                      <span className="row-tile tile-blocked" aria-hidden="true">
                        <Icon name="alert" size={16} />
                      </span>
                      <div className="people-body">
                        <p className="people-name">{t.title}</p>
                        <p className="people-meta">
                          {t.blockedReason?.type === "NOT_CONFIDENT" ? "needs guidance" : "waiting on other"}
                        </p>
                      </div>
                      <span className="due-label is-warn">Blocked</span>
                    </li>
                  ))}
                </ul>
                {blockedCount > 0 ? (
                  <p className="list-foot">
                    Blocked reasons in aggregate only, never used to single anyone out (Section 4).
                  </p>
                ) : null}
              </>
            )}
          </section>

          <MonthCalendar
            todayKey={todayKey}
            days={dueByDay(tasks, timeZone, (task) => assigneeName(task))}
            caption={`Open task due dates across ${scopeLabel}`}
          />
        </div>
      </div>

      <section className="card card-flush table-card" aria-labelledby="team-tasks-title">
        <div className="table-head">
          <h2 id="team-tasks-title" className="card-title mb-0">
            Team tasks
          </h2>
          <span className="card-count">
            {filter ? `${visibleTasks.length} of ${tasks.length}` : `${tasks.length} total`}
          </span>
          {filter ? (
            <span className="filter-chip">
              Matching “{filter}”
              <button
                type="button"
                aria-label="Clear the task filter"
                onClick={() => setSearchParams({}, { replace: true })}
              >
                <Icon name="close" size={14} />
              </button>
            </span>
          ) : null}
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Assignee</th>
                <th>Activity</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Due</th>
                <th>Blocked why</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map((t) => {
                const row = t as unknown as TaskRow;
                const p = presenceOf(row);
                return (
                  <tr key={t._id}>
                    <td>
                      <span className="cell-title">{t.title}</span>
                      {row.pendingCompletionProposal?.isPending && (
                        <div className="text-micro text-accent">
                          completion proposed — {row.pendingCompletionProposal.detectedSignal}
                          {row.pendingCompletionProposal.confidence
                            ? ` (${Math.round(row.pendingCompletionProposal.confidence * 100)}%)`
                            : ""}
                          <br />
                          waiting for the assignee to confirm
                        </div>
                      )}
                      {row.flagged && (
                        <div className="text-micro text-warning">
                          flagged{row.flagNote ? `: ${row.flagNote}` : ""}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="person">
                        {typeof row.assignedTo === "object" && <Avatar name={assigneeName(row)} size="sm" />}
                        <div>
                          <div className="person-name">{assigneeName(row)}</div>
                          {typeof row.assignedTo === "object" && (
                            <div className="person-meta">
                              {people.find((p2) => p2.id === (row.assignedTo as { _id: string })._id)?.timezone ||
                                ""}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      {p ? (
                        <span
                          className={`status-line ${
                            p.status === "ACTIVE" ? "status-line-active" : "status-line-break"
                          }`}
                        >
                          {p.status === "ACTIVE" ? "Active" : "On break"}
                          {p.activityConfidence === "UNKNOWN" ? " (?)" : ""}
                          <div className="text-micro muted">
                            {p.lastActivityAt ? relativeFrom(p.lastActivityAt) : "no signal"}
                          </div>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <StatusBadge status={t.status} />
                    </td>
                    <td>{t.priority}</td>
                    <td className="cell-nowrap">{formatDate(t.dueDate, timeZone)}</td>
                    <td className="text-xs muted">
                      {row.blockedReason?.type === "NOT_CONFIDENT" && "Needs guidance"}
                      {row.blockedReason?.type === "WAITING_ON_OTHER" && "Waiting on other"}
                      {!row.blockedReason?.type && "—"}
                    </td>
                    <td>
                      <div className="cell-actions">
                        {t.status !== "COMPLETED" && (
                          <button
                            className="btn btn-outline btn-sm"
                            disabled={actingId === t._id}
                            onClick={() => void toggleFlag(row)}
                          >
                            {actingId === t._id ? "Saving…" : row.flagged ? "Unflag" : "Flag"}
                          </button>
                        )}
                        {t.status === "COMPLETED" && (
                          <button
                            className="btn btn-outline btn-sm"
                            disabled={actingId === t._id}
                            onClick={() => void reopen(row)}
                          >
                            {actingId === t._id ? "Saving…" : "Reopen"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visibleTasks.length === 0 && (
                <tr>
                  <td colSpan={8} className="cell-empty">
                    {filter && tasks.length > 0 ? `No tasks match “${filter}”.` : "No tasks yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {alerts?.recentNotifications && alerts.recentNotifications.length > 0 && (
        <section className="card" aria-labelledby="recent-notifications-title">
          <h2 id="recent-notifications-title" className="card-title">
            Recent notifications
          </h2>
          <ul className="feed-list">
            {alerts.recentNotifications.map((n, i) => (
              <li key={`${n.subject}-${i}`} className="feed-row">
                <span className="pill pill-neutral pill-code">{n.channel}</span>
                <span className="feed-text">{n.subject}</span>
                <span className="feed-meta">
                  {n.status}
                  {n.driver ? ` (${n.driver})` : ""} · {relativeFrom(n.at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-micro muted">
        Activity shows state only (Active / On break) — this system stores no keystrokes, screen
        content, webcam or audio anywhere.
      </p>
    </div>
  );
}

// Real assignee picker (Priority 10) + optional external reference, which is how
// a task gets linked to a Zoho/WorkDrive/CMS record so completion signals match
// exactly instead of heuristically (Priority 6).
function CreateTaskForm({
  people,
  onCreated,
}: {
  people: DirectoryUser[];
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [definitionOfDone, setDefinitionOfDone] = useState("");
  const [estimatedHours, setEstimatedHours] = useState(1);
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [refSource, setRefSource] = useState("");
  const [refId, setRefId] = useState("");
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
        externalRefs:
          refSource && refId ? [{ source: refSource.trim(), externalId: refId.trim() }] : [],
      });
      onCreated();
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to create task");
    }
  }

  return (
    <form className="card" onSubmit={submit} aria-labelledby="new-task-title">
      <h2 id="new-task-title" className="card-title">
        New task
      </h2>
      <label htmlFor="new-task-name">Title</label>
      <input id="new-task-name" value={title} onChange={(e) => setTitle(e.target.value)} required />

      <label htmlFor="new-task-done">Definition of done</label>
      <textarea
        id="new-task-done"
        value={definitionOfDone}
        onChange={(e) => setDefinitionOfDone(e.target.value)}
        rows={2}
        required
      />

      <div className="field-row">
        <div className="field">
          <label htmlFor="new-task-hours">Estimated hours</label>
          <input
            id="new-task-hours"
            type="number"
            min={0.5}
            step={0.5}
            value={estimatedHours}
            onChange={(e) => setEstimatedHours(Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor="new-task-due">Due date</label>
          <input
            id="new-task-due"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="new-task-priority">Priority</label>
          <select id="new-task-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </div>
      </div>

      <label htmlFor="new-task-assignee">Assignee</label>
      <select id="new-task-assignee" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} required>
        <option value="">Select a person…</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {p.department} ({p.timezone})
          </option>
        ))}
      </select>
      {people.length === 0 && (
        <p className="notice notice-warning">
          No selectable people — a manager only sees their own department.
        </p>
      )}

      <label htmlFor="new-task-ref-source">
        External record (optional — links this task to Zoho / WorkDrive / CMS)
      </label>
      <div className="field-row">
        <select
          id="new-task-ref-source"
          value={refSource}
          onChange={(e) => setRefSource(e.target.value)}
          className="field"
        >
          <option value="">No external link</option>
          <option value="ZOHO_CRM">Zoho CRM</option>
          <option value="ZOHO_BOOKS">Zoho Books</option>
          <option value="ZOHO_INVENTORY">Zoho Inventory</option>
          <option value="WORKDRIVE">WorkDrive</option>
          <option value="WEBSITE_CMS">Website CMS</option>
        </select>
        <input
          className="field"
          aria-label="External record id"
          value={refId}
          onChange={(e) => setRefId(e.target.value)}
          placeholder="External id, e.g. 1042"
          disabled={!refSource}
        />
      </div>

      {error && <p className="notice notice-danger">{error}</p>}

      <button className="btn form-actions">
        Create task
      </button>
    </form>
  );
}
