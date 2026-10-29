import { Task, TaskStatus } from "../types";

// Dashboard helpers: turn the task records the API already returns into day
// buckets, status counts and due-date markers. Day keys (YYYY-MM-DD) are
// computed in the signed-in user's timezone, the same zone formatDate uses, so
// a calendar dot and a "Due ..." label never disagree.

const keyFormatters = new Map<string, Intl.DateTimeFormat>();

function keyFormatter(timeZone?: string) {
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  let formatter = keyFormatters.get(zone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      formatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
    }
    keyFormatters.set(zone, formatter);
  }
  return formatter;
}

export function dayKey(value: string | Date, timeZone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return keyFormatter(timeZone).format(date);
}

export function shiftKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// `length` consecutive day keys ending on `endKey`, oldest first.
export function windowKeys(endKey: string, length: number): string[] {
  return Array.from({ length }, (_, index) => shiftKey(endKey, index - (length - 1)));
}

function keyDate(key: string) {
  return new Date(`${key}T00:00:00Z`);
}

export function weekdayShort(key: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(keyDate(key));
}

export function dayLong(key: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(keyDate(key));
}

export function dayShort(key: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(
    keyDate(key)
  );
}

export function isOverdue(task: Pick<Task, "dueDate" | "status">) {
  if (!task.dueDate || task.status === "COMPLETED") return false;
  const due = new Date(task.dueDate).getTime();
  return Number.isFinite(due) && due < Date.now();
}

export function assignedId(task: Pick<Task, "assignedTo">) {
  if (!task.assignedTo) return "";
  if (typeof task.assignedTo === "string") return task.assignedTo;
  const person = task.assignedTo as { _id?: string; id?: string };
  return person._id || person.id || "";
}

export function assigneeName(task: Pick<Task, "assignedTo">) {
  return typeof task.assignedTo === "object" && task.assignedTo ? task.assignedTo.name : "Unassigned";
}

export interface StatusBreakdown {
  active: number;
  ready: number;
  blocked: number;
  completed: number;
  total: number;
}

export function statusBreakdown(tasks: { status: TaskStatus | string }[]): StatusBreakdown {
  const counts = { active: 0, ready: 0, blocked: 0, completed: 0, total: tasks.length };
  for (const task of tasks) {
    if (task.status === "IN_PROGRESS" || task.status === "PAUSED") counts.active += 1;
    else if (task.status === "READY") counts.ready += 1;
    else if (task.status === "BLOCKED") counts.blocked += 1;
    else if (task.status === "COMPLETED") counts.completed += 1;
  }
  return counts;
}

export function percentOf(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

export interface ActivityCounts {
  created: number[];
  started: number[];
  completed: number[];
}

// Counts task timeline events per day. "Started" covers both a first start and
// a resume after a pause. Records written before the timeline existed fall
// back to createdAt / completedAt so they are not silently dropped.
export function activityCounts(tasks: Task[], keys: string[], timeZone?: string): ActivityCounts {
  const index = new Map(keys.map((key, position) => [key, position]));
  const counts: ActivityCounts = {
    created: keys.map(() => 0),
    started: keys.map(() => 0),
    completed: keys.map(() => 0),
  };
  const bump = (series: number[], value: string | Date | null | undefined) => {
    if (!value) return;
    const position = index.get(dayKey(value, timeZone));
    if (position !== undefined) series[position] += 1;
  };

  for (const task of tasks) {
    const timeline = Array.isArray(task.timeline) ? task.timeline : [];
    let sawCreated = false;
    let sawCompleted = false;
    for (const entry of timeline) {
      if (!entry || !entry.timestamp) continue;
      if (entry.event === "CREATED") {
        sawCreated = true;
        bump(counts.created, entry.timestamp);
      } else if (entry.event === "STARTED" || entry.event === "RESUMED") {
        bump(counts.started, entry.timestamp);
      } else if (entry.event === "COMPLETION_CONFIRMED") {
        sawCompleted = true;
        bump(counts.completed, entry.timestamp);
      }
    }
    if (!sawCreated) bump(counts.created, task.createdAt);
    if (!sawCompleted && task.status === "COMPLETED") bump(counts.completed, task.completedAt);
  }
  return counts;
}

export interface DueItem {
  id: string;
  title: string;
  status: TaskStatus;
  overdue: boolean;
  meta?: string;
}

// Open tasks grouped by the day they are due. Completed work is left off the
// calendar so a marked day always means something still needs doing.
export function dueByDay(
  tasks: Task[],
  timeZone?: string,
  describe?: (task: Task) => string
): Record<string, DueItem[]> {
  const days: Record<string, DueItem[]> = {};
  for (const task of tasks) {
    if (!task.dueDate || task.status === "COMPLETED") continue;
    const key = dayKey(task.dueDate, timeZone);
    if (!key) continue;
    if (!days[key]) days[key] = [];
    days[key].push({
      id: task._id,
      title: task.title,
      status: task.status,
      overdue: isOverdue(task),
      meta: describe ? describe(task) : undefined,
    });
  }
  return days;
}
