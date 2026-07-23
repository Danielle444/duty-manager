/**
 * URGENT LEVEL 2 ACCESS - SLICE L2-0: tests for the PURE actor-aware course
 * offering decision core (trainee + instructor), plus the DB-free IO
 * orchestration seams (query shape, fail-closed wiring).
 *
 * Run with: npx tsx --test lib/course/actor-course-offering-core.test.ts
 * No Prisma, no DB, no clock, no randomness (all boundaries are injected).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveTraineeCourseOfferingFromRows,
  authorizeInstructorCourseOfferingId,
  assertInstructorCourseOfferingExists,
  NoTraineeCourseOfferingError,
  AmbiguousTraineeCourseOfferingError,
  MissingInstructorCourseOfferingIdError,
  InstructorCourseOfferingNotAllowedError,
  InstructorCourseOfferingUnavailableError,
  resolveTraineeCourseOfferingWithDeps,
  resolveInstructorCourseOfferingWithDeps,
  type TraineeEnrollmentOfferingRow,
  type TraineeEnrollmentQuery,
} from "./actor-course-offering-core";
import { IncompleteCourseOfferingError, type CourseOfferingRow } from "./current-offering-core";
import {
  INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS,
  isInstructorAllowedCourseOfferingId,
  LEVEL_1_COURSE_OFFERING_ID,
  LEVEL_2_COURSE_OFFERING_ID,
} from "./temporary-level2-compatibility";

const L1 = "cmrqngqhn00017gcndjixzrh0";
const L2 = "cmrxk58vc0000lscnfm54bpze";

function offering(id: string, overrides: Partial<CourseOfferingRow> = {}): CourseOfferingRow {
  return {
    id,
    activityYearId: "year-1",
    name: "קורס",
    level: 1,
    startDate: new Date("2026-07-05T00:00:00.000Z"),
    endDate: new Date("2026-07-31T00:00:00.000Z"),
    status: "ACTIVE",
    ...overrides,
  };
}

function enrollment(
  overrides: Partial<TraineeEnrollmentOfferingRow> = {},
): TraineeEnrollmentOfferingRow {
  return {
    enrollmentId: "enr-1",
    enrollmentStatus: "ACTIVE",
    offering: offering(L1),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Trainee resolver - pure decision
// ---------------------------------------------------------------------------

test("trainee: exactly one ACTIVE enrollment into an ACTIVE offering resolves", () => {
  const result = resolveTraineeCourseOfferingFromRows("stu-1", [enrollment()]);
  assert.equal(result.id, L1);
  assert.equal(result.status, "ACTIVE");
});

test("trainee: a Level 2 enrollment resolves to the Level 2 offering (no Level 1 bias)", () => {
  const result = resolveTraineeCourseOfferingFromRows("stu-1", [
    enrollment({ offering: offering(L2, { level: 2 }) }),
  ]);
  assert.equal(result.id, L2);
  assert.equal(result.level, 2);
});

test("trainee: zero rows fails closed", () => {
  assert.throws(
    () => resolveTraineeCourseOfferingFromRows("stu-1", []),
    NoTraineeCourseOfferingError,
  );
});

test("trainee: PLANNED-only offering fails closed (never falls back to Level 1)", () => {
  assert.throws(
    () =>
      resolveTraineeCourseOfferingFromRows("stu-1", [
        enrollment({ offering: offering(L2, { level: 2, status: "PLANNED" }) }),
      ]),
    NoTraineeCourseOfferingError,
  );
});

test("trainee: ARCHIVED offering fails closed", () => {
  assert.throws(
    () =>
      resolveTraineeCourseOfferingFromRows("stu-1", [
        enrollment({ offering: offering(L1, { status: "ARCHIVED" }) }),
      ]),
    NoTraineeCourseOfferingError,
  );
});

test("trainee: INACTIVE enrollment fails closed even when the offering is ACTIVE", () => {
  assert.throws(
    () =>
      resolveTraineeCourseOfferingFromRows("stu-1", [
        enrollment({ enrollmentStatus: "INACTIVE" }),
      ]),
    NoTraineeCourseOfferingError,
  );
});

test("trainee: an INACTIVE enrollment never breaks a tie for an ACTIVE one", () => {
  const result = resolveTraineeCourseOfferingFromRows("stu-1", [
    enrollment({ enrollmentId: "enr-dead", enrollmentStatus: "INACTIVE", offering: offering(L2, { level: 2 }) }),
    enrollment({ enrollmentId: "enr-live", offering: offering(L1) }),
  ]);
  assert.equal(result.id, L1);
});

test("trainee: two eligible enrollments fail closed with both offering ids", () => {
  assert.throws(
    () =>
      resolveTraineeCourseOfferingFromRows("stu-1", [
        enrollment({ enrollmentId: "enr-1", offering: offering(L1) }),
        enrollment({ enrollmentId: "enr-2", offering: offering(L2, { level: 2 }) }),
      ]),
    (err: unknown) => {
      assert.ok(err instanceof AmbiguousTraineeCourseOfferingError);
      assert.deepEqual(err.offeringIds, [L1, L2]);
      assert.equal(err.studentId, "stu-1");
      return true;
    },
  );
});

test("trainee: isPrimary is not consulted - the row type carries no such field", () => {
  // Defence-in-depth against a future "just use isPrimary" tie-break: the
  // decision core cannot see isPrimary even if the query selected it, so two
  // eligible enrollments still fail closed when one is marked primary.
  const rows = [
    { ...enrollment({ enrollmentId: "enr-1", offering: offering(L1) }), isPrimary: true },
    { ...enrollment({ enrollmentId: "enr-2", offering: offering(L2, { level: 2 }) }), isPrimary: false },
  ] as unknown as TraineeEnrollmentOfferingRow[];
  assert.throws(
    () => resolveTraineeCourseOfferingFromRows("stu-1", rows),
    AmbiguousTraineeCourseOfferingError,
  );
});

test("trainee: no group/subgroup mirror participates - the row type carries no such field", () => {
  const rows = [
    {
      ...enrollment({ enrollmentId: "enr-1", offering: offering(L1) }),
      groupName: "א",
      subgroupNumber: 1,
    },
    {
      ...enrollment({ enrollmentId: "enr-2", offering: offering(L2, { level: 2 }) }),
      groupName: "ב",
      subgroupNumber: 2,
    },
  ] as unknown as TraineeEnrollmentOfferingRow[];
  assert.throws(
    () => resolveTraineeCourseOfferingFromRows("stu-1", rows),
    AmbiguousTraineeCourseOfferingError,
  );
});

test("trainee: the single eligible offering must have concrete dates", () => {
  assert.throws(
    () =>
      resolveTraineeCourseOfferingFromRows("stu-1", [
        enrollment({ offering: offering(L1, { startDate: null }) }),
      ]),
    IncompleteCourseOfferingError,
  );
});

// ---------------------------------------------------------------------------
// Trainee resolver - IO orchestration (DB-free)
// ---------------------------------------------------------------------------

test("trainee resolver queries ONLY the session student's ACTIVE enrollments into ACTIVE offerings", async () => {
  const queries: TraineeEnrollmentQuery[] = [];
  const result = await resolveTraineeCourseOfferingWithDeps({
    requireTraineeId: async () => "stu-session",
    fetchTraineeEnrollmentRows: async (query) => {
      queries.push(query);
      return [enrollment()];
    },
  });
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0], {
    take: 3,
    where: {
      studentId: "stu-session",
      status: "ACTIVE",
      courseOffering: { status: "ACTIVE" },
    },
  });
  assert.equal(result.id, L1);
});

test("trainee resolver takes the student id from the session, never from a caller argument", async () => {
  // The public wrapper has no parameters at all; the DI seam proves the id is
  // supplied by the session-reading dep.
  assert.equal(resolveTraineeCourseOfferingWithDeps.length, 1);
  let asked = false;
  await assert.rejects(
    resolveTraineeCourseOfferingWithDeps({
      requireTraineeId: async () => {
        asked = true;
        return "stu-session";
      },
      fetchTraineeEnrollmentRows: async () => [],
    }),
    NoTraineeCourseOfferingError,
  );
  assert.equal(asked, true);
});

test("trainee resolver propagates an unauthenticated session failure (fails closed)", async () => {
  class FakeUnauthenticated extends Error {}
  await assert.rejects(
    resolveTraineeCourseOfferingWithDeps({
      requireTraineeId: async () => {
        throw new FakeUnauthenticated("no trainee");
      },
      fetchTraineeEnrollmentRows: async () => {
        throw new Error("must not be reached");
      },
    }),
    FakeUnauthenticated,
  );
});

// ---------------------------------------------------------------------------
// Instructor resolver - explicit-id authorization (pure)
//
// The instructor model is REQUESTED context, not derived context: there is no
// instructor-id allow-list, no per-instructor offering assignment, and no
// instructor id in the policy at all.
// ---------------------------------------------------------------------------

/** A fake policy over an arbitrary allowed-offering set. */
function policy(allowedOfferingIds: readonly string[]) {
  const set = new Set(allowedOfferingIds);
  return { isAllowedOfferingId: (id: string) => set.has(id) };
}

const BOTH = policy([L1, L2]);

test("the temporary policy allows exactly the two verified offerings", () => {
  assert.equal(LEVEL_1_COURSE_OFFERING_ID, L1);
  assert.equal(LEVEL_2_COURSE_OFFERING_ID, L2);
  assert.deepEqual([...INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS], [L1, L2]);
  assert.equal(isInstructorAllowedCourseOfferingId(L1), true);
  assert.equal(isInstructorAllowedCourseOfferingId(L2), true);
});

test("the temporary policy is identical for every instructor (not keyed by instructor)", () => {
  // isInstructorAllowedCourseOfferingId takes ONLY an offering id: there is no
  // parameter through which an instructor's identity could vary the answer.
  assert.equal(isInstructorAllowedCourseOfferingId.length, 1);
});

test("the allowed-offering list cannot be widened at runtime", () => {
  assert.throws(() => {
    (INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS as string[]).push("offer-smuggled");
  });
  assert.equal(isInstructorAllowedCourseOfferingId("offer-smuggled"), false);
});

test("instructor: an explicitly requested Level 1 id is authorized unchanged", () => {
  assert.equal(authorizeInstructorCourseOfferingId(L1, BOTH), L1);
});

test("instructor: an explicitly requested Level 2 id is authorized unchanged", () => {
  assert.equal(authorizeInstructorCourseOfferingId(L2, BOTH), L2);
});

test("instructor: EVERY active instructor may address both offerings", () => {
  // Same policy object, no instructor input anywhere: both ids authorize for
  // any caller that passed the audience gate.
  assert.equal(authorizeInstructorCourseOfferingId(L1, BOTH), L1);
  assert.equal(authorizeInstructorCourseOfferingId(L2, BOTH), L2);
});

test("instructor: a missing/blank courseOfferingId fails closed (never inferred)", () => {
  assert.throws(
    () => authorizeInstructorCourseOfferingId("", BOTH),
    MissingInstructorCourseOfferingIdError,
  );
  assert.throws(
    () => authorizeInstructorCourseOfferingId(undefined as unknown as string, BOTH),
    MissingInstructorCourseOfferingIdError,
  );
  assert.throws(
    () => authorizeInstructorCourseOfferingId(null as unknown as string, BOTH),
    MissingInstructorCourseOfferingIdError,
  );
});

test("instructor: an offering outside the policy is refused, not substituted", () => {
  assert.throws(
    () => authorizeInstructorCourseOfferingId("offer-unknown", BOTH),
    (err: unknown) => {
      assert.ok(err instanceof InstructorCourseOfferingNotAllowedError);
      assert.equal(err.offeringId, "offer-unknown");
      return true;
    },
  );
});

test("instructor: authorization is by EXACT id - no trimming, casing or prefix matching", () => {
  for (const bad of [` ${L1}`, `${L1} `, L1.toUpperCase(), `${L1}x`, L1.slice(0, -1)]) {
    assert.throws(
      () => authorizeInstructorCourseOfferingId(bad, BOTH),
      InstructorCourseOfferingNotAllowedError,
      `must refuse ${JSON.stringify(bad)}`,
    );
  }
});

test("instructor: no name / identity number / date / level / offering-name input exists", () => {
  // The only inputs are the requested id and an id-keyed predicate, so an
  // identity-number- or name-shaped value is simply a disallowed id.
  for (const bad of ["123456789", "דנה כהן", "2026-07-24", "2", "רמה 2"]) {
    assert.throws(
      () => authorizeInstructorCourseOfferingId(bad, BOTH),
      InstructorCourseOfferingNotAllowedError,
    );
  }
});

test("instructor: a missing offering row fails closed", () => {
  assert.throws(
    () => assertInstructorCourseOfferingExists(L2, null),
    (err: unknown) => {
      assert.ok(err instanceof InstructorCourseOfferingUnavailableError);
      assert.equal(err.reason, "missing");
      assert.equal(err.offeringId, L2);
      return true;
    },
  );
});

test("instructor: a row whose id differs from the requested one fails closed", () => {
  assert.throws(
    () => assertInstructorCourseOfferingExists(L2, offering(L1)),
    (err: unknown) => {
      assert.ok(err instanceof InstructorCourseOfferingUnavailableError);
      assert.equal(err.reason, "id-mismatch");
      return true;
    },
  );
});

test("instructor: an existing ACTIVE offering resolves to the by-id view", () => {
  const result = assertInstructorCourseOfferingExists(L1, offering(L1));
  assert.equal(result.id, L1);
  assert.equal(result.status, "ACTIVE");
});

test("instructor: a PLANNED offering still resolves (Level 2 is NOT made ACTIVE)", () => {
  // The decision change explicitly keeps Level 2 out of ACTIVE status, so an
  // ACTIVE gate here would deny the very access being launched. Status is
  // returned to the caller for its own per-reader policy instead.
  const result = assertInstructorCourseOfferingExists(
    L2,
    offering(L2, { level: 2, status: "PLANNED" }),
  );
  assert.equal(result.id, L2);
  assert.equal(result.status, "PLANNED");
});

test("instructor: an undated offering resolves with null dates (never invented)", () => {
  const result = assertInstructorCourseOfferingExists(
    L2,
    offering(L2, { level: 2, status: "PLANNED", startDate: null, endDate: null }),
  );
  assert.equal(result.startDate, null);
  assert.equal(result.endDate, null);
});

test("instructor: an ARCHIVED offering is still identity-resolvable, not silently swapped", () => {
  const result = assertInstructorCourseOfferingExists(L1, offering(L1, { status: "ARCHIVED" }));
  assert.equal(result.id, L1);
  assert.equal(result.status, "ARCHIVED");
});

// ---------------------------------------------------------------------------
// Instructor resolver - IO orchestration (DB-free)
// ---------------------------------------------------------------------------

function instructorDeps(overrides: Partial<Parameters<typeof resolveInstructorCourseOfferingWithDeps>[1]> = {}) {
  return {
    requireActiveInstructor: async () => ({ id: "ins-1" }),
    isAllowedOfferingId: (id: string) => id === L1 || id === L2,
    fetchOfferingById: async (id: string) => offering(id),
    ...overrides,
  };
}

test("instructor resolver fetches exactly the requested offering id and returns it", async () => {
  const asked: string[] = [];
  const result = await resolveInstructorCourseOfferingWithDeps(
    L2,
    instructorDeps({
      fetchOfferingById: async (id: string) => {
        asked.push(id);
        return offering(id, { level: 2, status: "PLANNED" });
      },
    }),
  );
  assert.deepEqual(asked, [L2]);
  assert.equal(result.id, L2);
});

test("instructor resolver serves BOTH offerings to the SAME instructor", async () => {
  const deps = instructorDeps();
  const l1 = await resolveInstructorCourseOfferingWithDeps(L1, deps);
  const l2 = await resolveInstructorCourseOfferingWithDeps(L2, deps);
  assert.equal(l1.id, L1);
  assert.equal(l2.id, L2);
});

test("instructor resolver refuses a disallowed offering WITHOUT any DB lookup", async () => {
  let fetched = false;
  await assert.rejects(
    resolveInstructorCourseOfferingWithDeps(
      "offer-unknown",
      instructorDeps({
        fetchOfferingById: async (id: string) => {
          fetched = true;
          return offering(id);
        },
      }),
    ),
    InstructorCourseOfferingNotAllowedError,
  );
  assert.equal(fetched, false, "a disallowed id must never reach the database");
});

test("instructor resolver refuses a missing courseOfferingId WITHOUT any DB lookup", async () => {
  let fetched = false;
  await assert.rejects(
    resolveInstructorCourseOfferingWithDeps(
      "",
      instructorDeps({
        fetchOfferingById: async (id: string) => {
          fetched = true;
          return offering(id);
        },
      }),
    ),
    MissingInstructorCourseOfferingIdError,
  );
  assert.equal(fetched, false);
});

test("instructor resolver does NOT probe or substitute the other offering when the requested one is missing", async () => {
  const asked: string[] = [];
  await assert.rejects(
    resolveInstructorCourseOfferingWithDeps(
      L2,
      instructorDeps({
        fetchOfferingById: async (id: string) => {
          asked.push(id);
          return null;
        },
      }),
    ),
    InstructorCourseOfferingUnavailableError,
  );
  assert.deepEqual(asked, [L2], "exactly one lookup - no fallback probe of Level 1");
});

test("instructor resolver gates on the ACTIVE-instructor check BEFORE anything else", async () => {
  class FakeUnauthenticated extends Error {}
  let authorized = false;
  await assert.rejects(
    resolveInstructorCourseOfferingWithDeps(
      L1,
      instructorDeps({
        requireActiveInstructor: async () => {
          throw new FakeUnauthenticated("no active instructor");
        },
        isAllowedOfferingId: () => {
          authorized = true;
          return true;
        },
        fetchOfferingById: async () => {
          throw new Error("must not be reached");
        },
      }),
    ),
    FakeUnauthenticated,
  );
  assert.equal(authorized, false, "an inactive/absent instructor is rejected first");
});

test("instructor resolver returns only offering fields - never policy membership", async () => {
  const result = await resolveInstructorCourseOfferingWithDeps(L2, instructorDeps());
  assert.deepEqual(Object.keys(result).sort(), [
    "activityYearId",
    "endDate",
    "id",
    "level",
    "name",
    "startDate",
    "status",
  ]);
});
