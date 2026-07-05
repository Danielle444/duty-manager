// All course dates are treated as date-only values, always handled in UTC
// so that a calendar date never shifts because of the server's local timezone.

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseDateKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function enumerateDateKeys(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  );
  const last = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  );
  while (cursor.getTime() <= last.getTime()) {
    keys.push(dateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

// ISO 8601 week key, e.g. "2026-W27" - used to detect same-duty repeats within a week.
export function weekKey(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const dayNum = (d.getUTCDay() + 6) % 7; // Monday = 0 ... Sunday = 6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNum =
    1 +
    Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export function formatHebrewDate(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatHebrewWeekday(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
}

export function formatHebrewDateTime(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// "Today" from the user's own local-clock perspective - deliberately NOT
// UTC, unlike dateKey() (which is for stored calendar dates and must stay
// UTC so those never shift). Israel is UTC+2/+3, so using dateKey()/UTC
// here would make "today" flip to the next day up to 3 hours late crossing
// local midnight - i.e. still show yesterday for a few hours after midnight.
export function getLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayDateKey(): string {
  return getLocalDateKey();
}

// Sunday-Saturday calendar week containing the given date, as all 7 date
// keys in order - independent of any WeeklySchedule row, for views (like
// daily-tracking's week toggle) that just need "this date's week" rather
// than a specific uploaded schedule.
export function getWeekDateKeys(dateKeyStr: string): string[] {
  const date = parseDateKey(dateKeyStr);
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return enumerateDateKeys(start, end);
}

export function formatHebrewWeekdayShort(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    weekday: "short",
    timeZone: "UTC",
  }).format(date);
}
