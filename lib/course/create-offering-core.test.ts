/**
 * MULTI-COURSE W9A-2 - executable tests for the PURE create-offering validation
 * core.
 *
 * Run with: npx tsx --test lib/course/create-offering-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateNewOfferingInput,
  type RawNewOfferingInput,
} from "./create-offering-core";

function input(overrides: Partial<RawNewOfferingInput> = {}): RawNewOfferingInput {
  return {
    activityYearId: "year-1",
    name: "רמה 2",
    level: "2",
    startDate: null,
    endDate: null,
    ...overrides,
  };
}

test("trims a valid name and normalizes the value", () => {
  const result = validateNewOfferingInput(input({ name: "  רמה 2  " }));
  assert.ok(result.ok);
  assert.equal(result.value.name, "רמה 2");
  assert.equal(result.value.activityYearId, "year-1");
  assert.equal(result.value.level, 2);
  assert.equal(result.value.startDate, null);
  assert.equal(result.value.endDate, null);
});

test("rejects an empty / whitespace-only name", () => {
  assert.equal(validateNewOfferingInput(input({ name: "" })).ok, false);
  const blank = validateNewOfferingInput(input({ name: "   " }));
  assert.equal(blank.ok, false);
  assert.equal(blank.ok === false && blank.error, "name_required");
});

test("requires an ActivityYear id", () => {
  assert.equal(validateNewOfferingInput(input({ activityYearId: "" })).ok, false);
  const missing = validateNewOfferingInput(input({ activityYearId: null }));
  assert.equal(missing.ok, false);
  assert.equal(missing.ok === false && missing.error, "activity_year_required");
});

test("accepts only a positive-integer level", () => {
  const ok = validateNewOfferingInput(input({ level: "3" }));
  assert.ok(ok.ok);
  assert.equal(ok.value.level, 3);
});

test("rejects zero, negative, decimal and malformed levels", () => {
  for (const bad of ["0", "-1", "1.5", "1e2", "abc", "", "  ", "+2"]) {
    const result = validateNewOfferingInput(input({ level: bad }));
    assert.equal(result.ok, false, `level ${JSON.stringify(bad)} should be rejected`);
    assert.equal(result.ok === false && result.error, "level_invalid");
  }
});

test("accepts both dates as absent (null and empty string)", () => {
  const nulls = validateNewOfferingInput(input({ startDate: null, endDate: null }));
  assert.ok(nulls.ok);
  assert.equal(nulls.value.startDate, null);
  assert.equal(nulls.value.endDate, null);

  const empties = validateNewOfferingInput(input({ startDate: "", endDate: "  " }));
  assert.ok(empties.ok);
  assert.equal(empties.value.startDate, null);
  assert.equal(empties.value.endDate, null);
});

test("accepts a single optional date (start only, end only)", () => {
  const startOnly = validateNewOfferingInput(input({ startDate: "2026-07-05", endDate: null }));
  assert.ok(startOnly.ok);
  assert.deepEqual(startOnly.value.startDate, new Date("2026-07-05T00:00:00.000Z"));
  assert.equal(startOnly.value.endDate, null);

  const endOnly = validateNewOfferingInput(input({ startDate: null, endDate: "2026-07-31" }));
  assert.ok(endOnly.ok);
  assert.equal(endOnly.value.startDate, null);
  assert.deepEqual(endOnly.value.endDate, new Date("2026-07-31T00:00:00.000Z"));
});

test("accepts an ordered date range (start <= end, including equal)", () => {
  const ordered = validateNewOfferingInput(input({ startDate: "2026-07-05", endDate: "2026-07-31" }));
  assert.ok(ordered.ok);
  assert.deepEqual(ordered.value.startDate, new Date("2026-07-05T00:00:00.000Z"));
  assert.deepEqual(ordered.value.endDate, new Date("2026-07-31T00:00:00.000Z"));

  const equal = validateNewOfferingInput(input({ startDate: "2026-07-05", endDate: "2026-07-05" }));
  assert.ok(equal.ok);
});

test("rejects startDate after endDate", () => {
  const result = validateNewOfferingInput(input({ startDate: "2026-08-01", endDate: "2026-07-31" }));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, "date_range_invalid");
});

test("rejects malformed or impossible dates", () => {
  for (const bad of ["2026/07/05", "05-07-2026", "2026-13-01", "2026-02-30", "not-a-date", "2026-7-5"]) {
    const result = validateNewOfferingInput(input({ startDate: bad }));
    assert.equal(result.ok, false, `date ${JSON.stringify(bad)} should be rejected`);
    assert.equal(result.ok === false && result.error, "date_invalid");
  }
});
