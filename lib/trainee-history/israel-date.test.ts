/**
 * Executable tests for the pure Israel-date helpers (Stage GH2A1).
 *
 * Uses `tsx` with Node built-ins `node:test` and `node:assert/strict`. Run with:
 *   npx tsx --test lib/trainee-history/israel-date.test.ts
 *
 * PURE: no Prisma, no DB, no Next.js runtime, no hidden clock, no randomness.
 * Every instant is an explicit fixed UTC literal.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  dateKeyToUtcMidnight,
  israelDateKeyFromInstant,
  utcMidnightToDateKey,
} from "./israel-date";

test("israelDateKeyFromInstant: winter (UTC+2) day and midnight boundary", () => {
  // 21:30Z + 2h = 23:30 local, still 2026-01-15.
  assert.equal(israelDateKeyFromInstant(new Date("2026-01-15T21:30:00.000Z")), "2026-01-15");
  // 22:30Z + 2h = 00:30 local next day → 2026-01-16 (rolls at 22:00Z in winter).
  assert.equal(israelDateKeyFromInstant(new Date("2026-01-15T22:30:00.000Z")), "2026-01-16");
});

test("israelDateKeyFromInstant: summer DST (UTC+3) shifts the midnight boundary", () => {
  // 20:30Z + 3h = 23:30 local, still 2026-07-15.
  assert.equal(israelDateKeyFromInstant(new Date("2026-07-15T20:30:00.000Z")), "2026-07-15");
  // 21:30Z + 3h = 00:30 local next day → 2026-07-16 (rolls one hour earlier than winter).
  assert.equal(israelDateKeyFromInstant(new Date("2026-07-15T21:30:00.000Z")), "2026-07-16");
});

test("israelDateKeyFromInstant: rejects an invalid Date instant", () => {
  assert.throws(() => israelDateKeyFromInstant(new Date("not-a-date")));
});

test("dateKeyToUtcMidnight: produces exact UTC midnight", () => {
  const d = dateKeyToUtcMidnight("2026-07-18");
  assert.equal(d.toISOString(), "2026-07-18T00:00:00.000Z");
});

test("dateKeyToUtcMidnight: rejects a malformed key", () => {
  assert.throws(() => dateKeyToUtcMidnight("2026-13-40"));
});

test("utcMidnightToDateKey: uses UTC getters", () => {
  assert.equal(utcMidnightToDateKey(new Date("2026-03-01T00:00:00.000Z")), "2026-03-01");
});

test("DateKey ↔ UTC-midnight round trip", () => {
  for (const key of ["2024-02-29", "2026-01-01", "2026-07-18", "2026-12-31"]) {
    assert.equal(utcMidnightToDateKey(dateKeyToUtcMidnight(key)), key);
  }
});
