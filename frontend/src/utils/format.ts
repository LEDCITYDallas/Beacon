// Timezone-aware formatting helpers (Priority 7 / Section 8).
//
// Storage is UTC everywhere. The UI converts to the signed-in user's own
// configured timezone, so a Dallas manager and an overseas employee each see
// their own clock - and nothing assumes Asia/Karachi for everyone.

export type ApiUser = {
  id: string;
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "MANAGER" | "EMPLOYEE";
  department: string;
  consentAccepted: boolean;
  timezone: string;
};

export function formatDate(value: string | Date | null | undefined, timeZone?: string): string {
  if (!value) return "—";
  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, dateStyle: "medium" }).format(
    new Date(value)
  );
}

export function formatDateTime(value: string | Date | null | undefined, timeZone?: string): string {
  if (!value) return "—";
  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// "12 min ago" style, computed against the browser clock (not the server's).
export function relativeFrom(value: string | Date | null | undefined): string {
  if (!value) return "unknown";
  const diffMs = Date.now() - new Date(value).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Compact "Sep 21" label for the scorecard period strips (design pass). The
// scorecard trend data sends zone-local day keys (YYYY-MM-DD) rather than
// instants, so those are formatted as plain calendar days - pushing them
// through a timezone would slide the label onto the previous day.
export function formatDayShort(value: string | Date | null | undefined, timeZone?: string): string {
  if (!value) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
  }
  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, month: "short", day: "numeric" }).format(
    new Date(value)
  );
}

export function todayInZone(timeZone?: string): string {
  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
}
