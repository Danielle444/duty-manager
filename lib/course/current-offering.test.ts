/**
 * MULTI-COURSE W5B0 / W9A-1 - executable tests for the current-offering resolver.
 *
 * Two layers, both DB-free:
 *  - the PURE cardinality core (resolveCurrentCourseOfferingFromRows); and
 *  - the operational IO orchestration (resolveCurrentCourseOfferingWithDeps),
 *    exercised through an injected fake fetcher that records the query, proving
 *    the resolver requests ONLY ACTIVE offerings without a live database.
 *
 * Run with: npx tsx --test lib/course/current-offering.test.ts
 * No Prisma, no DB, no clock, no randomness (the fetcher is faked).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCurrentCourseOfferingFromRows,
  NoCurrentCourseOfferingError,
  AmbiguousCourseOfferingError,
  IncompleteCourseOfferingError,
  type CourseOfferingRow,
} from "./current-offering-core";
import {
  resolveCurrentCourseOfferingWithDeps,
  type CurrentCourseOfferingDeps,
  type CurrentOfferingQuery,
} from "./current-offering";

function row(id: string, overrides: Partial<CourseOfferingRow> = {}): CourseOfferingRow {
  return {
    id,
    activityYearId: "year-1",
    name: "קורס מדריכים ומאמנים – רמה 1",
    level: 1,
    startDate: new Date("2026-07-05T00:00:00.000Z"),
    endDate: new Date("2026-07-31T00:00:00.000Z"),
    status: "PLANNED",
    ...overrides,
  };
}

test("zero rows throws NoCurrentCourseOfferingError", () => {
  assert.throws(() => resolveCurrentCourseOfferingFromRows([]), NoCurrentCourseOfferingError);
});

test("one row returns the stable view model", () => {
  const result = resolveCurrentCourseOfferingFromRows([row("offer-1")]);
  assert.deepEqual(result, {
    id: "offer-1",
    activityYearId: "year-1",
    name: "קורס מדריכים ומאמנים – רמה 1",
    level: 1,
    startDate: new Date("2026-07-05T00:00:00.000Z"),
    endDate: new Date("2026-07-31T00:00:00.000Z"),
    status: "PLANNED",
  });
});

test("two rows throws AmbiguousCourseOfferingError with both ids", () => {
  assert.throws(
    () => resolveCurrentCourseOfferingFromRows([row("offer-1"), row("offer-2")]),
    (err: unknown) => {
      assert.ok(err instanceof AmbiguousCourseOfferingError);
      assert.deepEqual(err.offeringIds, ["offer-1", "offer-2"]);
      return true;
    },
  );
});

test("more than two rows is still treated as ambiguous", () => {
  assert.throws(
    () => resolveCurrentCourseOfferingFromRows([row("a"), row("b"), row("c")]),
    AmbiguousCourseOfferingError,
  );
});

test("single row missing dates throws IncompleteCourseOfferingError", () => {
  assert.throws(
    () => resolveCurrentCourseOfferingFromRows([row("offer-1", { startDate: null })]),
    IncompleteCourseOfferingError,
  );
  assert.throws(
    () => resolveCurrentCourseOfferingFromRows([row("offer-1", { endDate: null })]),
    IncompleteCourseOfferingError,
  );
});

test("never returns the first of several (ambiguity beats selection)", () => {
  // Guards the core invariant: two valid rows must throw, never silently pick row 0.
  let returned = false;
  try {
    resolveCurrentCourseOfferingFromRows([row("first"), row("second")]);
    returned = true;
  } catch {
    // expected
  }
  assert.equal(returned, false);
});

// ---------------------------------------------------------------------------
// W9A-1: IO-boundary coverage for the operational resolver. The fake fetcher
// records the query the resolver issues and returns the supplied rows, so these
// tests prove the ACTIVE filter and the cardinality wiring without any database.
// ---------------------------------------------------------------------------

function recordingDeps(rows: readonly CourseOfferingRow[]): {
  queries: CurrentOfferingQuery[];
  deps: CurrentCourseOfferingDeps;
} {
  const queries: CurrentOfferingQuery[] = [];
  const deps: CurrentCourseOfferingDeps = {
    fetchCurrentOfferingRows: async (query) => {
      queries.push(query);
      return rows;
    },
  };
  return { queries, deps };
}

test("operational resolver requests ONLY ACTIVE offerings, take 2 (PLANNED/ARCHIVED excluded)", async () => {
  // The status filter is the sole mechanism that excludes PLANNED and ARCHIVED
  // offerings, so asserting the exact query proves both are ignored.
  const { queries, deps } = recordingDeps([row("active-1", { status: "ACTIVE" })]);
  await resolveCurrentCourseOfferingWithDeps(deps);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0], { take: 2, where: { status: "ACTIVE" } });
});

test("exactly one ACTIVE offering resolves to the stable view", async () => {
  const { deps } = recordingDeps([row("active-1", { status: "ACTIVE" })]);
  const result = await resolveCurrentCourseOfferingWithDeps(deps);
  assert.deepEqual(result, {
    id: "active-1",
    activityYearId: "year-1",
    name: "קורס מדריכים ומאמנים – רמה 1",
    level: 1,
    startDate: new Date("2026-07-05T00:00:00.000Z"),
    endDate: new Date("2026-07-31T00:00:00.000Z"),
    status: "ACTIVE",
  });
});

test("zero ACTIVE offerings rejects with NoCurrentCourseOfferingError", async () => {
  const { deps } = recordingDeps([]);
  await assert.rejects(
    resolveCurrentCourseOfferingWithDeps(deps),
    NoCurrentCourseOfferingError,
  );
});

test("two ACTIVE offerings reject with AmbiguousCourseOfferingError", async () => {
  const { deps } = recordingDeps([
    row("active-1", { status: "ACTIVE" }),
    row("active-2", { status: "ACTIVE" }),
  ]);
  await assert.rejects(
    resolveCurrentCourseOfferingWithDeps(deps),
    AmbiguousCourseOfferingError,
  );
});

test("single incomplete ACTIVE offering rejects with IncompleteCourseOfferingError", async () => {
  const { deps } = recordingDeps([row("active-1", { status: "ACTIVE", startDate: null })]);
  await assert.rejects(
    resolveCurrentCourseOfferingWithDeps(deps),
    IncompleteCourseOfferingError,
  );
});
