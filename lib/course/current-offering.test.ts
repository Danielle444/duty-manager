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
import {
  LEVEL_1_COURSE_OFFERING_ID,
  LEVEL_2_COURSE_OFFERING_ID,
} from "./temporary-level2-compatibility";

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

test("operational resolver requests ONLY ACTIVE offerings, take 3 (PLANNED/ARCHIVED excluded)", async () => {
  // The status filter is the sole mechanism that excludes PLANNED and ARCHIVED
  // offerings, so asserting the exact query proves both are ignored.
  // L2-0: take is 3, not 2 - the resolver must be able to see a THIRD ACTIVE
  // offering so the known Level 1 + Level 2 pair can never be confused with that
  // pair plus an unknown extra.
  const { queries, deps } = recordingDeps([row("active-1", { status: "ACTIVE" })]);
  await resolveCurrentCourseOfferingWithDeps(deps);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0], { take: 3, where: { status: "ACTIVE" } });
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

// ---------------------------------------------------------------------------
// L2-0: TEMPORARY Level 1 compatibility for the one known two-ACTIVE state.
//
// These pin the LEGACY resolver's behaviour once the Level 2 offering can be
// ACTIVE alongside Level 1. Everything outside that exact state must keep
// failing closed - the compatibility branch is not a general multi-offering
// tie-breaker.
// ---------------------------------------------------------------------------

test("the known Level 1 + Level 2 ACTIVE pair resolves to the Level 1 offering", async () => {
  const { deps } = recordingDeps([
    row(LEVEL_1_COURSE_OFFERING_ID, { status: "ACTIVE", level: 1 }),
    row(LEVEL_2_COURSE_OFFERING_ID, { status: "ACTIVE", level: 2 }),
  ]);
  const result = await resolveCurrentCourseOfferingWithDeps(deps);
  assert.equal(result.id, LEVEL_1_COURSE_OFFERING_ID);
  assert.equal(result.level, 1);
});

test("the known pair resolves to Level 1 regardless of row order (no positional pick)", async () => {
  const { deps } = recordingDeps([
    row(LEVEL_2_COURSE_OFFERING_ID, { status: "ACTIVE", level: 2 }),
    row(LEVEL_1_COURSE_OFFERING_ID, { status: "ACTIVE", level: 1 }),
  ]);
  const result = await resolveCurrentCourseOfferingWithDeps(deps);
  assert.equal(result.id, LEVEL_1_COURSE_OFFERING_ID);
});

test("Level 2 ACTIVE ALONE still resolves to Level 2 (not rewritten to Level 1)", async () => {
  const { deps } = recordingDeps([
    row(LEVEL_2_COURSE_OFFERING_ID, { status: "ACTIVE", level: 2 }),
  ]);
  const result = await resolveCurrentCourseOfferingWithDeps(deps);
  assert.equal(result.id, LEVEL_2_COURSE_OFFERING_ID);
  assert.equal(result.level, 2);
});

test("Level 1 ACTIVE alone is unchanged by the compatibility branch", async () => {
  const { deps } = recordingDeps([
    row(LEVEL_1_COURSE_OFFERING_ID, { status: "ACTIVE", level: 1 }),
  ]);
  const result = await resolveCurrentCourseOfferingWithDeps(deps);
  assert.equal(result.id, LEVEL_1_COURSE_OFFERING_ID);
});

test("the known pair PLUS an unknown third ACTIVE offering stays ambiguous", async () => {
  const { deps } = recordingDeps([
    row(LEVEL_1_COURSE_OFFERING_ID, { status: "ACTIVE", level: 1 }),
    row(LEVEL_2_COURSE_OFFERING_ID, { status: "ACTIVE", level: 2 }),
    row("offer-unknown", { status: "ACTIVE", level: 3 }),
  ]);
  await assert.rejects(
    resolveCurrentCourseOfferingWithDeps(deps),
    AmbiguousCourseOfferingError,
  );
});

test("Level 1 paired with an UNKNOWN offering stays ambiguous", async () => {
  const { deps } = recordingDeps([
    row(LEVEL_1_COURSE_OFFERING_ID, { status: "ACTIVE", level: 1 }),
    row("offer-unknown", { status: "ACTIVE" }),
  ]);
  await assert.rejects(
    resolveCurrentCourseOfferingWithDeps(deps),
    AmbiguousCourseOfferingError,
  );
});

test("two UNKNOWN ACTIVE offerings stay ambiguous", async () => {
  const { deps } = recordingDeps([
    row("offer-a", { status: "ACTIVE" }),
    row("offer-b", { status: "ACTIVE" }),
  ]);
  await assert.rejects(
    resolveCurrentCourseOfferingWithDeps(deps),
    AmbiguousCourseOfferingError,
  );
});

test("no name/level/date inference can produce the Level 1 compatibility result", async () => {
  // Two Level-1/Level-2-looking rows with UNKNOWN ids must still be ambiguous:
  // only the exact verified ids enable the compatibility branch.
  const { deps } = recordingDeps([
    row("decoy-1", { status: "ACTIVE", level: 1, name: "קורס מדריכים ומאמנים – רמה 1" }),
    row("decoy-2", {
      status: "ACTIVE",
      level: 2,
      name: "קורס מדריכים ומאמנים – רמה 2",
      startDate: new Date("2030-01-01T00:00:00.000Z"),
    }),
  ]);
  await assert.rejects(
    resolveCurrentCourseOfferingWithDeps(deps),
    AmbiguousCourseOfferingError,
  );
});

test("the compatibility branch does not mutate offering status", async () => {
  const l2 = row(LEVEL_2_COURSE_OFFERING_ID, { status: "ACTIVE", level: 2 });
  const { deps } = recordingDeps([
    row(LEVEL_1_COURSE_OFFERING_ID, { status: "ACTIVE", level: 1 }),
    l2,
  ]);
  const result = await resolveCurrentCourseOfferingWithDeps(deps);
  assert.equal(result.status, "ACTIVE");
  assert.equal(l2.status, "ACTIVE", "the Level 2 row is left untouched");
});
