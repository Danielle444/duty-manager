/**
 * Pure Israel-local date helpers for dated trainee history (Stage GH2A1).
 *
 * PURE by construction: no Prisma, no DB, no next/headers, NO hidden clock
 * (`Date.now()` / argless `new Date()`), no environment access, no logging.
 * Every function derives its answer solely from an EXPLICIT `Date` instant or an
 * EXPLICIT {@link DateKey} the caller provides.
 *
 * `today` (Israel-local calendar day of a trusted instant) and `policy.cutover`
 * (the historical write boundary) are DISTINCT concepts and are never conflated
 * here — this module only converts between an instant, an Israel-local DateKey,
 * and the UTC-midnight `@db.Date` representation. See GH2A1 ISRAEL DATE
 * CONTRACT.
 */

import { assertValidDateKey, type DateKey } from "./interval-resolver";

/**
 * Fixed Israel-local formatter. `en-US` yields Latin digits and stable numeric
 * parts; `Asia/Jerusalem` applies the correct standard/summer offset for the
 * supplied instant (no manual DST arithmetic).
 */
const ISRAEL_DATE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function assertRealInstant(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Invalid Date instant for ${label}: ${String(value)}`);
  }
}

/**
 * Convert a trusted explicit `Date` instant to the Israel-local calendar day as
 * a strict `YYYY-MM-DD` {@link DateKey}. Uses `Intl.DateTimeFormat` with
 * `timeZone: "Asia/Jerusalem"`; never consults a default/hidden clock.
 */
export function israelDateKeyFromInstant(now: Date): DateKey {
  assertRealInstant(now, "israelDateKeyFromInstant.now");
  let year = "";
  let month = "";
  let day = "";
  for (const part of ISRAEL_DATE_PARTS.formatToParts(now)) {
    if (part.type === "year") {
      year = part.value;
    } else if (part.type === "month") {
      month = part.value;
    } else if (part.type === "day") {
      day = part.value;
    }
  }
  const key = `${year}-${month}-${day}`;
  assertValidDateKey(key, "israelDateKeyFromInstant.result");
  return key;
}

/**
 * Convert a {@link DateKey} to the `@db.Date` representation: a `Date` at UTC
 * midnight (`YYYY-MM-DDT00:00:00.000Z`). Matches how Prisma stores/reads
 * `@db.Date` columns, so no local-timezone shift can move the calendar day.
 */
export function dateKeyToUtcMidnight(key: DateKey): Date {
  assertValidDateKey(key, "dateKeyToUtcMidnight.key");
  return new Date(`${key}T00:00:00.000Z`);
}

/**
 * Convert a UTC-midnight `@db.Date` `Date` back to a {@link DateKey} using UTC
 * getters (never local-timezone getters), so the stored calendar day is
 * preserved exactly regardless of the host timezone.
 */
export function utcMidnightToDateKey(date: Date): DateKey {
  assertRealInstant(date, "utcMidnightToDateKey.date");
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const key = `${year}-${month}-${day}`;
  assertValidDateKey(key, "utcMidnightToDateKey.result");
  return key;
}
