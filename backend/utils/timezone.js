// ---------------------------------------------------------------------
// Timezone helpers (Priority 7 / Section 8).
//
// Storage rule: every timestamp is stored as a UTC Date. Conversion to the
// user's configured timezone happens at the edge (API formatting + UI).
// Dallas staff and overseas staff therefore see their own local times, and
// NO code path assumes Asia/Karachi for everyone.
// ---------------------------------------------------------------------

const DEFAULT_TZ = "America/Chicago";

function isValidTimeZone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function safeZone(tz) {
  return isValidTimeZone(tz) ? tz : DEFAULT_TZ;
}

const PART_FORMATTERS = new Map();

function partsFormatter(tz) {
  const zone = safeZone(tz);
  if (!PART_FORMATTERS.has(zone)) {
    PART_FORMATTERS.set(
      zone,
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    );
  }
  return PART_FORMATTERS.get(zone);
}

// Wall-clock parts of a UTC instant, as seen in the target zone.
function partsInZone(date, tz) {
  const d = date instanceof Date ? date : new Date(date);
  const out = {};
  for (const p of partsFormatter(tz).formatToParts(d)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  let hour = parseInt(out.hour, 10);
  if (hour === 24) hour = 0; // some ICU builds emit 24 for midnight
  return {
    year: parseInt(out.year, 10),
    month: parseInt(out.month, 10),
    day: parseInt(out.day, 10),
    hour,
    minute: parseInt(out.minute, 10),
    second: parseInt(out.second, 10),
  };
}

// Milliseconds the zone is offset from UTC at a given instant.
function offsetMs(date, tz) {
  const p = partsInZone(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (date instanceof Date ? date : new Date(date)).getTime();
}

// Inverse of partsInZone: a wall-clock time in `tz` -> the UTC instant.
function zonedToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const off1 = offsetMs(new Date(guess), tz);
  // One correction pass handles DST transitions; a second pass is a no-op
  // in the stable case.
  const off2 = offsetMs(new Date(guess - off1), tz);
  return new Date(guess - off2);
}

function startOfDayInZone(date, tz) {
  const p = partsInZone(date, tz);
  return zonedToUtc({ year: p.year, month: p.month, day: p.day }, tz);
}

function endOfDayInZone(date, tz) {
  const start = startOfDayInZone(date, tz);
  return new Date(start.getTime() + 24 * 3600 * 1000 - 1);
}

// Week starts Monday, in the user's own timezone (scorecard weeks).
function weekStartInZone(date, tz) {
  const p = partsInZone(date, tz);
  const asUtcMidnight = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dow = asUtcMidnight.getUTCDay(); // 0 Sun..6 Sat
  const back = (dow + 6) % 7;
  const shifted = new Date(asUtcMidnight.getTime() - back * 86400000);
  return zonedToUtc(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    },
    tz
  );
}

function monthStartInZone(date, tz) {
  const p = partsInZone(date, tz);
  return zonedToUtc({ year: p.year, month: p.month, day: 1 }, tz);
}

function daysBetween(a, b) {
  return Math.round(((b instanceof Date ? b : new Date(b)) - (a instanceof Date ? a : new Date(a))) / 86400000);
}

// "YYYY-MM-DD" as the user sees it - used for digest week labels.
function dayKey(date, tz) {
  const p = partsInZone(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

// Next occurrence of a weekday/hour/minute in a zone - drives the Friday
// digest scheduler without hard-coding a UTC time.
function nextWeekdayAt(fromDate, { weekday, hour, minute = 0 }, tz) {
  const p = partsInZone(fromDate, tz);
  const startUtc = zonedToUtc(
    { year: p.year, month: p.month, day: p.day, hour, minute },
    tz
  );
  const startParts = partsInZone(startUtc, tz);
  const asUtc = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day));
  const dow = asUtc.getUTCDay();
  let delta = (weekday - dow + 7) % 7;
  if (delta === 0 && startUtc.getTime() <= fromDate.getTime()) delta = 7;
  const targetParts = new Date(asUtc.getTime() + delta * 86400000);
  return zonedToUtc(
    {
      year: targetParts.getUTCFullYear(),
      month: targetParts.getUTCMonth() + 1,
      day: targetParts.getUTCDate(),
      hour,
      minute,
    },
    tz
  );
}

function formatDateTime(date, tz) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(tz),
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

function formatDate(date, tz) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(tz),
    dateStyle: "medium",
  }).format(new Date(date));
}

module.exports = {
  DEFAULT_TZ,
  isValidTimeZone,
  safeZone,
  partsInZone,
  zonedToUtc,
  startOfDayInZone,
  endOfDayInZone,
  weekStartInZone,
  monthStartInZone,
  daysBetween,
  dayKey,
  nextWeekdayAt,
  formatDateTime,
  formatDate,
};
