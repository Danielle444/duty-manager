/**
 * LEVEL 2 SCHEDULE SLICE S1A - focused tests for the PURE course-scoped trainee
 * schedule core (./course-scoped-week-options-core).
 *
 * Everything here runs against plain fakes: no Next.js cookies, no live Prisma,
 * no React. They lock the S1A contract:
 *  - the week option query is pinned to ONE offering by exact id AND published;
 *  - SCHEDULE must be positively ENABLED for that exact resolved offering;
 *  - every "no single resolvable trainee course context" case denies with the
 *    uniform empty result, while real defects propagate;
 *  - the final-read predicate treats a raw weeklyScheduleId as NOT authorization
 *    (NULL scope, mismatched scope, unpublished and missing all fail closed);
 *  - pickDefaultWeekId's behaviour is unchanged by the move out of
 *    lib/actions/weekly-schedule.ts, and it never sees a cross-course week.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/course/course-scoped-week-options-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  TRAINEE_SCHEDULE_CAPABILITY_KEY,
  TRAINEE_WEEK_META_SELECT,
  TRAINEE_WEEK_OPTION_SELECT,
  authorizeTraineeWeekReadWithDeps,
  buildTraineeWeekOptionsQuery,
  emptyTraineeWeeklyScheduleSelection,
  isTraineeCourseContextDenial,
  isTraineeScheduleCapabilityEnabled,
  isTraineeWeekReadAuthorized,
  loadTraineeWeeklyScheduleSelectionWithDeps,
  pickDefaultWeekId,
  toTraineeWeekOptions,
  type TraineeWeekMetaRow,
  type TraineeWeekOptionRow,
  type TraineeWeekReadDeps,
  type TraineeWeeklyScheduleSelectionDeps,
} from "./course-scoped-week-options-core";
import {
  NoTraineeCourseOfferingError,
  AmbiguousTraineeCourseOfferingError,
} from "./actor-course-offering-core";
import { UnauthenticatedActorError } from "@/lib/auth/actor-types";
import { CAPABILITY_KEYS, type CapabilityKey } from "./capabilities/capability-keys";
import type { EffectiveCapabilityStatus } from "./capabilities/effective-capability-core";

// The two verified launch offerings, referenced BY ID ONLY. Nothing in the code
// under test infers anything from a level, a name or a date - these constants
// exist purely so the Level 1 / Level 2 cases are distinguishable in assertions.
const LEVEL_1_OFFERING_ID = "cmrqngqhn00017gcndjixzrh0";
const LEVEL_2_OFFERING_ID = "cmrxk58vc0000lscnfm54bpze";

// --- fixtures ---------------------------------------------------------------

const ALL_ENABLED_CAPABILITIES: Record<CapabilityKey, EffectiveCapabilityStatus> = {
  SCHEDULE: "ENABLED",
  CONTACTS: "ENABLED",
  MESSAGES: "ENABLED",
  ATTENDANCE: "ENABLED",
  DUTIES: "ENABLED",
  RIDING: "ENABLED",
  PROGRESS_RIDING: "ENABLED",
  RIDING_HORSE_ASSIGNMENTS: "ENABLED",
  ADVANCED_INSTRUCTION: "ENABLED",
  TEACHING_PRACTICE: "ENABLED",
};

function effectiveCapabilities(
  overrides: Partial<Record<CapabilityKey, EffectiveCapabilityStatus>> = {},
): Record<CapabilityKey, EffectiveCapabilityStatus> {
  return { ...ALL_ENABLED_CAPABILITIES, ...overrides };
}

function utc(dateKeyValue: string): Date {
  return new Date(`${dateKeyValue}T00:00:00.000Z`);
}

/** Two published Level 1 weeks, as the offering-scoped query would return them. */
const LEVEL_1_WEEK_ROWS: TraineeWeekOptionRow[] = [
  { id: "wk-l1-a", name: "שבוע 1", startDate: utc("2026-06-01"), endDate: utc("2026-06-05") },
  { id: "wk-l1-b", name: "שבוע 2", startDate: utc("2026-06-08"), endDate: utc("2026-06-12") },
];

const LEVEL_2_WEEK_ROWS: TraineeWeekOptionRow[] = [
  { id: "wk-l2-a", name: "שבוע 2א", startDate: utc("2026-07-20"), endDate: utc("2026-07-24") },
];

function week(overrides: Partial<TraineeWeekMetaRow> = {}): TraineeWeekMetaRow {
  return {
    id: "wk-l1-a",
    name: "שבוע 1",
    courseOfferingId: LEVEL_1_OFFERING_ID,
    isPublished: true,
    ...overrides,
  };
}

/** Selection deps for an authorized Level 1 trainee. */
function selectionDeps(
  overrides: Partial<TraineeWeeklyScheduleSelectionDeps> = {},
): TraineeWeeklyScheduleSelectionDeps {
  return {
    resolveTraineeCourseOffering: async () => ({ id: LEVEL_1_OFFERING_ID }),
    getEffectiveCapabilities: async () => effectiveCapabilities(),
    fetchPublishedWeekRows: async () => LEVEL_1_WEEK_ROWS,
    todayDateKey: () => "2026-06-03",
    ...overrides,
  };
}

/** Final-read deps for an authorized Level 1 trainee. */
function readDeps(overrides: Partial<TraineeWeekReadDeps> = {}): TraineeWeekReadDeps {
  return {
    resolveTraineeCourseOffering: async () => ({ id: LEVEL_1_OFFERING_ID }),
    getEffectiveCapabilities: async () => effectiveCapabilities(),
    fetchWeekMeta: async () => week(),
    ...overrides,
  };
}

// ===========================================================================
// Tripwire: the capability fixture stays exhaustive over CAPABILITY_KEYS.
// ===========================================================================

test("the all-ENABLED fixture is exhaustive over CAPABILITY_KEYS", () => {
  assert.deepEqual(
    Object.keys(ALL_ENABLED_CAPABILITIES).sort(),
    [...CAPABILITY_KEYS].sort(),
  );
  assert.ok(CAPABILITY_KEYS.includes(TRAINEE_SCHEDULE_CAPABILITY_KEY));
});

// ===========================================================================
// Query shape - exact offering id + published, nothing inferred.
// ===========================================================================

test("the option query pins BOTH an exact offering id and isPublished", () => {
  const query = buildTraineeWeekOptionsQuery(LEVEL_2_OFFERING_ID);
  assert.deepEqual(query, {
    where: { courseOfferingId: LEVEL_2_OFFERING_ID, isPublished: true },
    orderBy: { startDate: "asc" },
    select: { id: true, name: true, startDate: true, endDate: true },
  });
  // No date window, no name pattern, no level, no status - offering scope is
  // never inferred, and the projection carries no items.
  const whereKeys = Object.keys(query.where).sort();
  assert.deepEqual(whereKeys, ["courseOfferingId", "isPublished"]);
  assert.deepEqual(Object.keys(TRAINEE_WEEK_OPTION_SELECT).sort(), [
    "endDate",
    "id",
    "name",
    "startDate",
  ]);
});

test("a blank offering id can never be turned into a query (fails closed, loudly)", () => {
  assert.throws(() => buildTraineeWeekOptionsQuery(""), /non-empty/);
});

test("the option mapping converts Dates to date keys and preserves order", () => {
  assert.deepEqual(toTraineeWeekOptions(LEVEL_1_WEEK_ROWS), [
    { id: "wk-l1-a", name: "שבוע 1", startDate: "2026-06-01", endDate: "2026-06-05" },
    { id: "wk-l1-b", name: "שבוע 2", startDate: "2026-06-08", endDate: "2026-06-12" },
  ]);
});

// ===========================================================================
// Week selection - course scoping.
// ===========================================================================

test("Level 1 trainee -> only that offering's published weeks are queried", async () => {
  let capsOfferingId: string | null = null;
  let queriedWhere: unknown = null;
  const selection = await loadTraineeWeeklyScheduleSelectionWithDeps(
    selectionDeps({
      resolveTraineeCourseOffering: async () => ({ id: LEVEL_1_OFFERING_ID }),
      getEffectiveCapabilities: async (offeringId) => {
        capsOfferingId = offeringId;
        return effectiveCapabilities();
      },
      fetchPublishedWeekRows: async (query) => {
        queriedWhere = query.where;
        return LEVEL_1_WEEK_ROWS;
      },
    }),
  );
  // The capability lookup and the week query BOTH receive exactly the
  // server-resolved offering id.
  assert.equal(capsOfferingId, LEVEL_1_OFFERING_ID);
  assert.deepEqual(queriedWhere, {
    courseOfferingId: LEVEL_1_OFFERING_ID,
    isPublished: true,
  });
  assert.deepEqual(
    selection.weeks.map((w) => w.id),
    ["wk-l1-a", "wk-l1-b"],
  );
});

test("Level 2 trainee -> only Level 2 published weeks, never a Level 1 fallback", async () => {
  let queriedOfferingId: string | null = null;
  const selection = await loadTraineeWeeklyScheduleSelectionWithDeps(
    selectionDeps({
      resolveTraineeCourseOffering: async () => ({ id: LEVEL_2_OFFERING_ID }),
      fetchPublishedWeekRows: async (query) => {
        queriedOfferingId = query.where.courseOfferingId;
        return LEVEL_2_WEEK_ROWS;
      },
      todayDateKey: () => "2026-07-22",
    }),
  );
  assert.equal(queriedOfferingId, LEVEL_2_OFFERING_ID);
  assert.notEqual(queriedOfferingId, LEVEL_1_OFFERING_ID);
  assert.deepEqual(
    selection.weeks.map((w) => w.id),
    ["wk-l2-a"],
  );
  assert.equal(selection.defaultWeekId, "wk-l2-a");
});

test("a Level 2 trainee with no Level 2 week yet gets an empty selection, not Level 1's", async () => {
  const selection = await loadTraineeWeeklyScheduleSelectionWithDeps(
    selectionDeps({
      resolveTraineeCourseOffering: async () => ({ id: LEVEL_2_OFFERING_ID }),
      fetchPublishedWeekRows: async () => [],
    }),
  );
  assert.deepEqual(selection, { weeks: [], defaultWeekId: null });
});

// ===========================================================================
// Week selection - SCHEDULE capability.
// ===========================================================================

test("SCHEDULE ENABLED -> options are returned", async () => {
  const selection = await loadTraineeWeeklyScheduleSelectionWithDeps(
    selectionDeps({
      getEffectiveCapabilities: async () => effectiveCapabilities({ SCHEDULE: "ENABLED" }),
    }),
  );
  assert.equal(selection.weeks.length, 2);
});

for (const [label, capabilities] of [
  ["DISABLED", effectiveCapabilities({ SCHEDULE: "DISABLED" })],
  ["READ_ONLY", effectiveCapabilities({ SCHEDULE: "READ_ONLY" })],
] as const) {
  test(`SCHEDULE ${label} -> empty selection and NO week query`, async () => {
    let queried = false;
    const selection = await loadTraineeWeeklyScheduleSelectionWithDeps(
      selectionDeps({
        getEffectiveCapabilities: async () => capabilities,
        fetchPublishedWeekRows: async () => {
          queried = true;
          return LEVEL_1_WEEK_ROWS;
        },
      }),
    );
    assert.deepEqual(selection, { weeks: [], defaultWeekId: null });
    assert.equal(queried, false, "the week query must not run once the capability denies");
  });
}

test("a missing SCHEDULE entry (absent capability row) -> empty selection", async () => {
  const partial = { ...ALL_ENABLED_CAPABILITIES } as Record<
    CapabilityKey,
    EffectiveCapabilityStatus
  >;
  delete (partial as Partial<Record<CapabilityKey, EffectiveCapabilityStatus>>).SCHEDULE;
  const selection = await loadTraineeWeeklyScheduleSelectionWithDeps(
    selectionDeps({ getEffectiveCapabilities: async () => partial }),
  );
  assert.deepEqual(selection, { weeks: [], defaultWeekId: null });
});

test("the capability test is positively-ENABLED, not merely not-DISABLED", () => {
  assert.equal(isTraineeScheduleCapabilityEnabled({ SCHEDULE: "ENABLED" }), true);
  assert.equal(isTraineeScheduleCapabilityEnabled({ SCHEDULE: "READ_ONLY" }), false);
  assert.equal(isTraineeScheduleCapabilityEnabled({ SCHEDULE: "DISABLED" }), false);
  assert.equal(isTraineeScheduleCapabilityEnabled({}), false);
  assert.equal(isTraineeScheduleCapabilityEnabled(null), false);
  assert.equal(isTraineeScheduleCapabilityEnabled(undefined), false);
  // A malformed status never reads as ENABLED.
  assert.equal(
    isTraineeScheduleCapabilityEnabled({
      SCHEDULE: "enabled" as unknown as EffectiveCapabilityStatus,
    }),
    false,
  );
});

// ===========================================================================
// Week selection - course-context denials vs real defects.
// ===========================================================================

test("PLANNED-only / zero eligible enrollment -> empty selection, no capability read", async () => {
  let capsRead = false;
  const selection = await loadTraineeWeeklyScheduleSelectionWithDeps(
    selectionDeps({
      resolveTraineeCourseOffering: async () => {
        throw new NoTraineeCourseOfferingError("student-1");
      },
      getEffectiveCapabilities: async () => {
        capsRead = true;
        return effectiveCapabilities();
      },
    }),
  );
  assert.deepEqual(selection, { weeks: [], defaultWeekId: null });
  assert.equal(capsRead, false);
});

test("multiple eligible enrollments -> empty selection (no offering is chosen)", async () => {
  const selection = await loadTraineeWeeklyScheduleSelectionWithDeps(
    selectionDeps({
      resolveTraineeCourseOffering: async () => {
        throw new AmbiguousTraineeCourseOfferingError("student-1", [
          LEVEL_1_OFFERING_ID,
          LEVEL_2_OFFERING_ID,
        ]);
      },
    }),
  );
  assert.deepEqual(selection, { weeks: [], defaultWeekId: null });
});

test("an anonymous / expired trainee session -> empty selection, never a thrown error", async () => {
  const selection = await loadTraineeWeeklyScheduleSelectionWithDeps(
    selectionDeps({
      resolveTraineeCourseOffering: async () => {
        throw new UnauthenticatedActorError("No authenticated trainee");
      },
    }),
  );
  assert.deepEqual(selection, { weeks: [], defaultWeekId: null });
});

test("an unexpected resolver error PROPAGATES (never reported as 'no schedule')", async () => {
  await assert.rejects(
    loadTraineeWeeklyScheduleSelectionWithDeps(
      selectionDeps({
        resolveTraineeCourseOffering: async () => {
          throw new Error("connection terminated unexpectedly");
        },
      }),
    ),
    /connection terminated unexpectedly/,
  );
});

test("a capability-reader failure PROPAGATES (never falls open or silently empty)", async () => {
  await assert.rejects(
    loadTraineeWeeklyScheduleSelectionWithDeps(
      selectionDeps({
        getEffectiveCapabilities: async () => {
          throw new Error("capability read failed");
        },
      }),
    ),
    /capability read failed/,
  );
});

test("the denial classifier accepts only the three course-context denials", () => {
  assert.equal(isTraineeCourseContextDenial(new UnauthenticatedActorError("x")), true);
  assert.equal(isTraineeCourseContextDenial(new NoTraineeCourseOfferingError("s")), true);
  assert.equal(isTraineeCourseContextDenial(new AmbiguousTraineeCourseOfferingError("s", [])), true);
  assert.equal(isTraineeCourseContextDenial(new Error("boom")), false);
  assert.equal(isTraineeCourseContextDenial(new TypeError("undefined is not a function")), false);
  assert.equal(isTraineeCourseContextDenial("NoTraineeCourseOfferingError"), false);
  assert.equal(isTraineeCourseContextDenial(null), false);
});

test("the empty selection is a fresh object each time (no shared mutable singleton)", () => {
  const a = emptyTraineeWeeklyScheduleSelection();
  const b = emptyTraineeWeeklyScheduleSelection();
  assert.notEqual(a, b);
  assert.notEqual(a.weeks, b.weeks);
  a.weeks.push({ id: "x", name: "x", startDate: "2026-01-01", endDate: "2026-01-02" });
  assert.deepEqual(b, { weeks: [], defaultWeekId: null });
});

// ===========================================================================
// Default week pick - unchanged behaviour, never cross-course.
// ===========================================================================

test("pickDefaultWeekId: returns the week containing today", () => {
  const weeks = toTraineeWeekOptions(LEVEL_1_WEEK_ROWS);
  assert.equal(pickDefaultWeekId(weeks, "2026-06-03"), "wk-l1-a");
  assert.equal(pickDefaultWeekId(weeks, "2026-06-08"), "wk-l1-b");
  assert.equal(pickDefaultWeekId(weeks, "2026-06-12"), "wk-l1-b");
});

test("pickDefaultWeekId: falls back to the closest week when none covers today", () => {
  const weeks = toTraineeWeekOptions(LEVEL_1_WEEK_ROWS);
  // Before every week -> nearest start.
  assert.equal(pickDefaultWeekId(weeks, "2026-05-30"), "wk-l1-a");
  // After every week -> nearest end.
  assert.equal(pickDefaultWeekId(weeks, "2026-06-20"), "wk-l1-b");
  // In the gap, closer to the first week's end.
  assert.equal(pickDefaultWeekId(weeks, "2026-06-06"), "wk-l1-a");
});

test("pickDefaultWeekId: an empty list yields null (no invented default)", () => {
  assert.equal(pickDefaultWeekId([], "2026-06-03"), null);
});

test("pickDefaultWeekId never receives a cross-course week", async () => {
  // The fetch is the ONLY source of the list handed to the picker, and it is
  // already pinned to one offering - so a date-closer week from another course
  // is unreachable even when today sits inside that other course's range.
  let seenIds: string[] = [];
  const selection = await loadTraineeWeeklyScheduleSelectionWithDeps(
    selectionDeps({
      resolveTraineeCourseOffering: async () => ({ id: LEVEL_1_OFFERING_ID }),
      fetchPublishedWeekRows: async (query) => {
        // Simulate the real DB: return only rows matching the pinned offering.
        const all = [...LEVEL_1_WEEK_ROWS, ...LEVEL_2_WEEK_ROWS];
        const byOffering: Record<string, TraineeWeekOptionRow[]> = {
          [LEVEL_1_OFFERING_ID]: LEVEL_1_WEEK_ROWS,
          [LEVEL_2_OFFERING_ID]: LEVEL_2_WEEK_ROWS,
        };
        assert.equal(all.length, 3);
        const rows = byOffering[query.where.courseOfferingId] ?? [];
        seenIds = rows.map((r) => r.id);
        return rows;
      },
      // Today sits inside the LEVEL 2 week's range - the "closest week" logic
      // must still never reach it.
      todayDateKey: () => "2026-07-22",
    }),
  );
  assert.deepEqual(seenIds, ["wk-l1-a", "wk-l1-b"]);
  assert.ok(!selection.weeks.some((w) => w.id === "wk-l2-a"));
  assert.equal(selection.defaultWeekId, "wk-l1-b");
});

// ===========================================================================
// Final-read authorization predicate.
// ===========================================================================

test("the week-meta projection carries exactly the four authorization columns", () => {
  assert.deepEqual(Object.keys(TRAINEE_WEEK_META_SELECT).sort(), [
    "courseOfferingId",
    "id",
    "isPublished",
    "name",
  ]);
});

test("own published week in the resolved offering -> authorized", () => {
  assert.equal(isTraineeWeekReadAuthorized(week(), LEVEL_1_OFFERING_ID), true);
});

test("another offering's week id -> NOT authorized", () => {
  assert.equal(
    isTraineeWeekReadAuthorized(week({ courseOfferingId: LEVEL_1_OFFERING_ID }), LEVEL_2_OFFERING_ID),
    false,
  );
  assert.equal(
    isTraineeWeekReadAuthorized(week({ courseOfferingId: LEVEL_2_OFFERING_ID }), LEVEL_1_OFFERING_ID),
    false,
  );
});

test("a NULL-scoped week -> NOT authorized (no legacy pass-through)", () => {
  assert.equal(isTraineeWeekReadAuthorized(week({ courseOfferingId: null }), LEVEL_1_OFFERING_ID), false);
  assert.equal(isTraineeWeekReadAuthorized(week({ courseOfferingId: "" }), LEVEL_1_OFFERING_ID), false);
});

test("an unpublished week in the trainee's own offering -> NOT authorized", () => {
  assert.equal(isTraineeWeekReadAuthorized(week({ isPublished: false }), LEVEL_1_OFFERING_ID), false);
});

test("a missing week -> NOT authorized", () => {
  assert.equal(isTraineeWeekReadAuthorized(null, LEVEL_1_OFFERING_ID), false);
  assert.equal(isTraineeWeekReadAuthorized(undefined, LEVEL_1_OFFERING_ID), false);
});

test("a blank resolved offering id can never match anything", () => {
  assert.equal(isTraineeWeekReadAuthorized(week(), ""), false);
  assert.equal(isTraineeWeekReadAuthorized(week({ courseOfferingId: "" }), ""), false);
});

test("offering comparison is strict: no trimming, case folding or prefix matching", () => {
  assert.equal(
    isTraineeWeekReadAuthorized(week({ courseOfferingId: ` ${LEVEL_1_OFFERING_ID} ` }), LEVEL_1_OFFERING_ID),
    false,
  );
  assert.equal(
    isTraineeWeekReadAuthorized(week({ courseOfferingId: LEVEL_1_OFFERING_ID.toUpperCase() }), LEVEL_1_OFFERING_ID),
    false,
  );
  assert.equal(
    isTraineeWeekReadAuthorized(week({ courseOfferingId: LEVEL_1_OFFERING_ID.slice(0, -1) }), LEVEL_1_OFFERING_ID),
    false,
  );
});

// ===========================================================================
// Final-read gate - ordering and uniform denial.
// ===========================================================================

test("authorized read returns the resolver's offering id and the verified header", async () => {
  const result = await authorizeTraineeWeekReadWithDeps("wk-l1-a", readDeps());
  assert.equal(result.authorized, true);
  assert.ok(result.authorized);
  assert.equal(result.courseOfferingId, LEVEL_1_OFFERING_ID);
  assert.equal(result.week.name, "שבוע 1");
});

test("the RESOLVER's offering id is authoritative, not the week's own value", async () => {
  // The week claims Level 1; the resolver says this trainee is Level 2. The
  // week's own column never gets to define the comparison target.
  const result = await authorizeTraineeWeekReadWithDeps("wk-l1-a", {
    ...readDeps(),
    resolveTraineeCourseOffering: async () => ({ id: LEVEL_2_OFFERING_ID }),
  });
  assert.equal(result.authorized, false);
});

test("the requested weeklyScheduleId is passed through verbatim and is never authorization", async () => {
  let requestedId: string | null = null;
  const result = await authorizeTraineeWeekReadWithDeps("wk-from-another-course", {
    ...readDeps(),
    fetchWeekMeta: async (id) => {
      requestedId = id;
      return week({ id, courseOfferingId: LEVEL_2_OFFERING_ID });
    },
  });
  assert.equal(requestedId, "wk-from-another-course");
  assert.equal(result.authorized, false);
});

test("every denial produces the SAME uniform value (cross-course/missing/unpublished)", async () => {
  const crossCourse = await authorizeTraineeWeekReadWithDeps("w", {
    ...readDeps(),
    fetchWeekMeta: async () => week({ courseOfferingId: LEVEL_2_OFFERING_ID }),
  });
  const nullScoped = await authorizeTraineeWeekReadWithDeps("w", {
    ...readDeps(),
    fetchWeekMeta: async () => week({ courseOfferingId: null }),
  });
  const missing = await authorizeTraineeWeekReadWithDeps("w", {
    ...readDeps(),
    fetchWeekMeta: async () => null,
  });
  const unpublished = await authorizeTraineeWeekReadWithDeps("w", {
    ...readDeps(),
    fetchWeekMeta: async () => week({ isPublished: false }),
  });
  const denied = { authorized: false };
  assert.deepEqual({ ...crossCourse }, denied);
  assert.deepEqual({ ...nullScoped }, denied);
  assert.deepEqual({ ...missing }, denied);
  assert.deepEqual({ ...unpublished }, denied);
});

test("SCHEDULE not ENABLED -> denied BEFORE the week is even fetched", async () => {
  for (const status of ["DISABLED", "READ_ONLY"] as const) {
    let fetched = false;
    const result = await authorizeTraineeWeekReadWithDeps("wk-l1-a", {
      ...readDeps(),
      getEffectiveCapabilities: async () => effectiveCapabilities({ SCHEDULE: status }),
      fetchWeekMeta: async () => {
        fetched = true;
        return week();
      },
    });
    assert.equal(result.authorized, false, `SCHEDULE ${status} must deny`);
    assert.equal(fetched, false, `SCHEDULE ${status} must deny before any week fetch`);
  }
});

test("a course-context denial denies before the capability read and the week fetch", async () => {
  for (const error of [
    new UnauthenticatedActorError("no session"),
    new NoTraineeCourseOfferingError("student-1"),
    new AmbiguousTraineeCourseOfferingError("student-1", [LEVEL_1_OFFERING_ID, LEVEL_2_OFFERING_ID]),
  ]) {
    let capsRead = false;
    let fetched = false;
    const result = await authorizeTraineeWeekReadWithDeps("wk-l1-a", {
      resolveTraineeCourseOffering: async () => {
        throw error;
      },
      getEffectiveCapabilities: async () => {
        capsRead = true;
        return effectiveCapabilities();
      },
      fetchWeekMeta: async () => {
        fetched = true;
        return week();
      },
    });
    assert.equal(result.authorized, false);
    assert.equal(capsRead, false);
    assert.equal(fetched, false);
  }
});

test("an unexpected resolver error PROPAGATES out of the final-read gate", async () => {
  await assert.rejects(
    authorizeTraineeWeekReadWithDeps("wk-l1-a", {
      ...readDeps(),
      resolveTraineeCourseOffering: async () => {
        throw new Error("pool exhausted");
      },
    }),
    /pool exhausted/,
  );
});

test("the gate itself never reads items - fetchWeekMeta is its ONLY data dependency", async () => {
  const calls: string[] = [];
  await authorizeTraineeWeekReadWithDeps("wk-l1-a", {
    resolveTraineeCourseOffering: async () => {
      calls.push("resolve");
      return { id: LEVEL_1_OFFERING_ID };
    },
    getEffectiveCapabilities: async () => {
      calls.push("capabilities");
      return effectiveCapabilities();
    },
    fetchWeekMeta: async () => {
      calls.push("weekMeta");
      return week();
    },
  });
  // Exactly three steps, in exactly this order. There is no item dep to inject
  // because the gate has no way to read one.
  assert.deepEqual(calls, ["resolve", "capabilities", "weekMeta"]);
});

// ===========================================================================
// No client course context anywhere in this core.
// ===========================================================================

test("neither orchestration exposes a parameter through which a client could name a course", () => {
  // Both take exactly ONE argument beyond their injected deps: the selection
  // takes only deps; the read gate takes only the requested weeklyScheduleId.
  assert.equal(loadTraineeWeeklyScheduleSelectionWithDeps.length, 1);
  assert.equal(authorizeTraineeWeekReadWithDeps.length, 2);
  // The trainee resolver dep is no-argument by design.
  assert.equal(selectionDeps().resolveTraineeCourseOffering.length, 0);
  assert.equal(readDeps().resolveTraineeCourseOffering.length, 0);
});
