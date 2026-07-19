/**
 * MULTI-COURSE W6B - executable tests for the PURE + dependency-injected atomic
 * new-trainee creation core.
 *
 * Run with: npx tsx --test lib/course/create-trainee-enrollment-core.test.ts
 * PURE: no Prisma, no DB, no real clock, no randomness (offering resolver,
 * clock, lookups, and the atomic writer are all injected as fakes; the
 * transaction body is exercised against a fake tx client with a modelled
 * all-or-nothing rollback).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateNewTraineeGroup,
  resolveInitialEffectiveDate,
  isDuplicateIdentityNumberError,
  isKnownCurrentOfferingError,
  runTraineeCreateInTx,
  createTraineeWithEnrollmentWithDeps,
  createTraineeWithEnrollmentSafe,
  DUPLICATE_IDENTITY_MESSAGE,
  MISSING_GROUP_MESSAGE,
  MISSING_SUBGROUP_MESSAGE,
  GROUP_NOT_FOUND_MESSAGE,
  SUBGROUP_NOT_FOUND_MESSAGE,
  type AtomicTraineePlan,
  type CreateTraineeDeps,
  type CreateTraineeInput,
  type TraineeTxClient,
} from "./create-trainee-enrollment-core";
import {
  NoCurrentCourseOfferingError,
  AmbiguousCourseOfferingError,
  IncompleteCourseOfferingError,
} from "./current-offering-core";

// --- group validation (pure) ------------------------------------------------

test("validateNewTraineeGroup: valid group + subgroup resolves lookup keys", () => {
  const r = validateNewTraineeGroup({ groupName: " א ", subgroupNumber: 3 });
  assert.equal(r.ok, true);
  assert.ok(r.ok);
  assert.deepEqual(r.selection, { topName: "א", subName: "3", subgroupNumber: 3 });
});

test("validateNewTraineeGroup: missing/blank group is rejected", () => {
  for (const groupName of [null, undefined, "", "   "]) {
    const r = validateNewTraineeGroup({ groupName, subgroupNumber: 1 });
    assert.equal(r.ok, false);
    assert.ok(!r.ok);
    assert.equal(r.message, MISSING_GROUP_MESSAGE);
  }
});

test("validateNewTraineeGroup: missing/non-positive/non-integer subgroup is rejected", () => {
  for (const subgroupNumber of [null, undefined, 0, -2, 1.5]) {
    const r = validateNewTraineeGroup({ groupName: "א", subgroupNumber });
    assert.equal(r.ok, false);
    assert.ok(!r.ok);
    assert.equal(r.message, MISSING_SUBGROUP_MESSAGE);
  }
});

// --- effective-date rule (pure) ---------------------------------------------

const OFFERING_START = new Date("2026-07-05T00:00:00.000Z"); // @db.Date UTC-midnight

test("resolveInitialEffectiveDate: today AFTER course start uses today (no backdating)", () => {
  // 2026-07-19T09:00Z -> Israel-local 2026-07-19 (summer, UTC+3), later than start.
  const r = resolveInitialEffectiveDate(new Date("2026-07-19T09:00:00.000Z"), OFFERING_START);
  assert.equal(r.key, "2026-07-19");
  assert.equal(r.date.toISOString(), "2026-07-19T00:00:00.000Z");
});

test("resolveInitialEffectiveDate: today BEFORE course start uses the course start", () => {
  const r = resolveInitialEffectiveDate(new Date("2026-07-01T09:00:00.000Z"), OFFERING_START);
  assert.equal(r.key, "2026-07-05");
  assert.equal(r.date.toISOString(), "2026-07-05T00:00:00.000Z");
});

test("resolveInitialEffectiveDate: today EQUAL to course start uses that day", () => {
  const r = resolveInitialEffectiveDate(new Date("2026-07-05T09:00:00.000Z"), OFFERING_START);
  assert.equal(r.key, "2026-07-05");
});

test("resolveInitialEffectiveDate: Israel-local midnight boundary is honoured (summer DST)", () => {
  // 21:30Z + 3h = 00:30 local next day -> 2026-07-20, still after start -> today.
  const r = resolveInitialEffectiveDate(new Date("2026-07-19T21:30:00.000Z"), OFFERING_START);
  assert.equal(r.key, "2026-07-20");
});

// --- duplicate-identity error detection (pure) ------------------------------

test("isDuplicateIdentityNumberError: matches P2002 targeting identityNumber", () => {
  assert.equal(isDuplicateIdentityNumberError({ code: "P2002", meta: { target: ["identityNumber"] } }), true);
  assert.equal(isDuplicateIdentityNumberError({ code: "P2002", meta: { target: "Student_identityNumber_key" } }), true);
  // Bare P2002 (unreadable target) is still attributed to identityNumber - see rationale in core.
  assert.equal(isDuplicateIdentityNumberError({ code: "P2002" }), true);
});

test("isDuplicateIdentityNumberError: rejects non-P2002 / non-errors", () => {
  assert.equal(isDuplicateIdentityNumberError({ code: "P2003" }), false);
  assert.equal(isDuplicateIdentityNumberError(new Error("boom")), false);
  assert.equal(isDuplicateIdentityNumberError(null), false);
  assert.equal(isDuplicateIdentityNumberError("P2002"), false);
});

// --- transaction body + modelled rollback -----------------------------------

interface TxStore {
  students: { id: string }[];
  enrollments: { id: string; studentId: string; courseOfferingId: string; status: string; isPrimary: boolean; startDate: Date }[];
  horses: {
    id: string;
    studentId: string;
    courseEnrollmentId: string;
    hasPrivateHorse: boolean;
    privateHorseName: string | null;
    assignedHorseName: string | null;
    effectiveFrom: Date;
    effectiveTo: null;
  }[];
  memberships: { id: string; courseEnrollmentId: string; courseGroupId: string; effectiveFrom: Date; effectiveTo: null }[];
}

function newStore(): TxStore {
  return { students: [], enrollments: [], horses: [], memberships: [] };
}

type FailStep = "student" | "enrollment" | "horse" | "membership";

/**
 * A fake TraineeTxClient that appends to `store` and can be told to throw at a
 * specific step. It records the order of create calls so ordering is asserted.
 */
function fakeTx(
  store: TxStore,
  order: string[],
  failAt?: FailStep,
): TraineeTxClient {
  let n = 0;
  const id = (p: string) => `${p}-${(n += 1)}`;
  return {
    student: {
      create: async ({ data }) => {
        order.push("student");
        if (failAt === "student") throw new Error("student create failed");
        const row = { id: id("s"), ...data };
        store.students.push({ id: row.id });
        return { id: row.id };
      },
    },
    courseEnrollment: {
      create: async ({ data }) => {
        order.push("enrollment");
        if (failAt === "enrollment") throw new Error("enrollment create failed");
        const row = { id: id("e"), ...data };
        store.enrollments.push(row);
        return { id: row.id };
      },
    },
    traineeHorseAssignment: {
      create: async ({ data }) => {
        order.push("horse");
        if (failAt === "horse") throw new Error("horse create failed");
        const row = { id: id("h"), ...data };
        store.horses.push(row);
        return { id: row.id };
      },
    },
    groupMembership: {
      create: async ({ data }) => {
        order.push("membership");
        if (failAt === "membership") throw new Error("membership create failed");
        const row = { id: id("m"), ...data };
        store.memberships.push(row);
        return { id: row.id };
      },
    },
  };
}

const PLAN: AtomicTraineePlan = {
  student: {
    firstName: "אבי",
    lastName: "כהן",
    fullName: "אבי כהן",
    identityNumber: "123456789",
    phone: null,
    groupName: "א",
    subgroupNumber: 2,
    isActive: true,
  },
  courseOfferingId: "offering-1",
  courseGroupId: "sub-א-2",
  effectiveDate: new Date("2026-07-19T00:00:00.000Z"),
};

test("runTraineeCreateInTx: creates student -> enrollment -> horse -> membership in order with correct data", async () => {
  const store = newStore();
  const order: string[] = [];
  await runTraineeCreateInTx(fakeTx(store, order), PLAN);
  // Horse create happens AFTER Student and CourseEnrollment, BEFORE membership.
  assert.deepEqual(order, ["student", "enrollment", "horse", "membership"]);
  assert.equal(store.students.length, 1);
  assert.equal(store.enrollments.length, 1);
  assert.equal(store.horses.length, 1);
  assert.equal(store.memberships.length, 1);

  const enr = store.enrollments[0];
  assert.equal(enr.studentId, store.students[0].id);
  assert.equal(enr.courseOfferingId, "offering-1");
  assert.equal(enr.status, "ACTIVE");
  assert.equal(enr.isPrimary, true);
  assert.equal(enr.startDate.toISOString(), "2026-07-19T00:00:00.000Z");

  // Canonical-empty initial horse interval, linked to the just-created rows.
  const horse = store.horses[0];
  assert.equal(horse.studentId, store.students[0].id);
  assert.equal(horse.courseEnrollmentId, enr.id);
  assert.equal(horse.hasPrivateHorse, false);
  assert.equal(horse.privateHorseName, null);
  assert.equal(horse.assignedHorseName, null);
  assert.equal(horse.effectiveFrom.toISOString(), "2026-07-19T00:00:00.000Z");
  assert.equal(horse.effectiveTo, null);
  // Exactly false/null/null - no other horse shape leaks through.
  assert.deepEqual(
    { hasPrivateHorse: horse.hasPrivateHorse, privateHorseName: horse.privateHorseName, assignedHorseName: horse.assignedHorseName },
    { hasPrivateHorse: false, privateHorseName: null, assignedHorseName: null },
  );

  const mem = store.memberships[0];
  assert.equal(mem.courseEnrollmentId, enr.id);
  assert.equal(mem.courseGroupId, "sub-א-2");
  assert.equal(mem.effectiveFrom.toISOString(), "2026-07-19T00:00:00.000Z");
  assert.equal(mem.effectiveTo, null);

  // enrollment.startDate == GroupMembership.effectiveFrom == horse.effectiveFrom.
  assert.equal(enr.startDate.getTime(), mem.effectiveFrom.getTime());
  assert.equal(enr.startDate.getTime(), horse.effectiveFrom.getTime());
  assert.equal(horse.effectiveFrom.getTime(), PLAN.effectiveDate.getTime());
});

test("runTraineeCreateInTx: writes exactly the four models - no TraineeGroupMembership access", async () => {
  const store = newStore();
  const order: string[] = [];
  const accessed = new Set<string>();
  const base = fakeTx(store, order) as unknown as Record<string, unknown>;
  const spy = new Proxy(base, {
    get(target, prop) {
      if (typeof prop === "string") accessed.add(prop);
      return target[prop as string];
    },
  }) as unknown as TraineeTxClient;
  await runTraineeCreateInTx(spy, PLAN);
  assert.equal(accessed.has("traineeGroupMembership"), false);
  assert.deepEqual(
    [...accessed].sort(),
    ["courseEnrollment", "groupMembership", "student", "traineeHorseAssignment"],
  );
});

/**
 * Model prisma.$transaction's all-or-nothing guarantee: run the body against a
 * SCRATCH store; only if it resolves do we commit the scratch rows to the
 * COMMITTED store. A thrown body commits nothing (rollback).
 */
async function atomic(
  committed: TxStore,
  failAt: FailStep | undefined,
  order: string[],
): Promise<void> {
  const scratch = newStore();
  await runTraineeCreateInTx(fakeTx(scratch, order, failAt), PLAN);
  committed.students.push(...scratch.students);
  committed.enrollments.push(...scratch.enrollments);
  committed.horses.push(...scratch.horses);
  committed.memberships.push(...scratch.memberships);
}

test("rollback: failure at Student.create leaves nothing committed", async () => {
  const committed = newStore();
  const order: string[] = [];
  await assert.rejects(atomic(committed, "student", order), /student create failed/);
  assert.deepEqual(order, ["student"]);
  assert.deepEqual(committed, newStore()); // no student, no enrollment, no membership
});

test("rollback: failure at horse create leaves nothing committed and no membership is attempted", async () => {
  const committed = newStore();
  const order: string[] = [];
  await assert.rejects(atomic(committed, "horse", order), /horse create failed/);
  // membership is NEVER reached once the horse create throws.
  assert.deepEqual(order, ["student", "enrollment", "horse"]);
  assert.equal(order.includes("membership"), false);
  // Student, enrollment, and (attempted) horse rolled back - nothing committed.
  assert.deepEqual(committed, newStore());
});

test("rollback: failure after enrollment create leaves nothing committed", async () => {
  const committed = newStore();
  const order: string[] = [];
  await assert.rejects(atomic(committed, "membership", order), /membership create failed/);
  assert.deepEqual(order, ["student", "enrollment", "horse", "membership"]);
  // Student, enrollment, and horse were written to scratch but the throw prevents commit.
  assert.deepEqual(committed, newStore());
});

// --- orchestration ----------------------------------------------------------

const VALID_INPUT: CreateTraineeInput = {
  firstName: "אבי",
  lastName: "כהן",
  identityNumber: "123456789",
  phone: "050-0000000",
  groupName: "א",
  subgroupNumber: 2,
};

interface OrchestrationRecorder {
  calls: string[];
  createdPlan: AtomicTraineePlan | null;
}

function newRecorder(): OrchestrationRecorder {
  return { calls: [], createdPlan: null };
}

function fakeDeps(
  rec: OrchestrationRecorder,
  overrides: Partial<CreateTraineeDeps> = {},
): CreateTraineeDeps {
  return {
    resolveCurrentCourseOffering: async () => {
      rec.calls.push("resolveOffering");
      return { id: "offering-1", startDate: OFFERING_START };
    },
    now: () => new Date("2026-07-19T09:00:00.000Z"),
    identityNumberExists: async () => {
      rec.calls.push("identityCheck");
      return false;
    },
    findTopGroupId: async () => {
      rec.calls.push("findTop");
      return "top-א";
    },
    findSubGroupId: async () => {
      rec.calls.push("findSub");
      return "sub-א-2";
    },
    createAtomically: async (plan) => {
      rec.calls.push("createAtomically");
      rec.createdPlan = plan;
    },
    ...overrides,
  };
}

test("orchestration: happy path creates the exact atomic plan and reports success", async () => {
  const rec = newRecorder();
  const result = await createTraineeWithEnrollmentWithDeps(VALID_INPUT, fakeDeps(rec));
  assert.deepEqual(result, { success: true });
  assert.deepEqual(rec.calls, [
    "resolveOffering",
    "findTop",
    "findSub",
    "identityCheck",
    "createAtomically",
  ]);
  assert.ok(rec.createdPlan);
  assert.deepEqual(rec.createdPlan, {
    student: {
      firstName: "אבי",
      lastName: "כהן",
      fullName: "אבי כהן",
      identityNumber: "123456789",
      phone: "050-0000000",
      groupName: "א",
      subgroupNumber: 2,
      isActive: true, // compatibility mirror
    },
    courseOfferingId: "offering-1",
    courseGroupId: "sub-א-2", // membership targets the SUBGROUP
    effectiveDate: new Date("2026-07-19T00:00:00.000Z"), // max(today, start) = today
  });
});

test("orchestration: offering resolver ZERO/AMBIGUOUS/INCOMPLETE propagates, no writes", async () => {
  for (const boom of ["No offering", "Ambiguous", "Incomplete"]) {
    const rec = newRecorder();
    await assert.rejects(
      createTraineeWithEnrollmentWithDeps(
        VALID_INPUT,
        fakeDeps(rec, {
          resolveCurrentCourseOffering: async () => {
            rec.calls.push("resolveOffering");
            throw new Error(boom);
          },
        }),
      ),
      new RegExp(boom),
    );
    assert.equal(rec.calls.includes("createAtomically"), false);
    assert.equal(rec.createdPlan, null);
  }
});

test("orchestration: missing group fails before any group lookup or write", async () => {
  const rec = newRecorder();
  const result = await createTraineeWithEnrollmentWithDeps(
    { ...VALID_INPUT, groupName: null },
    fakeDeps(rec),
  );
  assert.deepEqual(result, { success: false, error: MISSING_GROUP_MESSAGE });
  assert.deepEqual(rec.calls, ["resolveOffering"]);
  assert.equal(rec.createdPlan, null);
});

test("orchestration: missing subgroup fails before any group lookup or write", async () => {
  const rec = newRecorder();
  const result = await createTraineeWithEnrollmentWithDeps(
    { ...VALID_INPUT, subgroupNumber: null },
    fakeDeps(rec),
  );
  assert.deepEqual(result, { success: false, error: MISSING_SUBGROUP_MESSAGE });
  assert.deepEqual(rec.calls, ["resolveOffering"]);
  assert.equal(rec.createdPlan, null);
});

test("orchestration: top group not found fails before Student creation", async () => {
  const rec = newRecorder();
  const result = await createTraineeWithEnrollmentWithDeps(
    VALID_INPUT,
    fakeDeps(rec, { findTopGroupId: async () => (rec.calls.push("findTop"), null) }),
  );
  assert.deepEqual(result, { success: false, error: GROUP_NOT_FOUND_MESSAGE });
  assert.equal(rec.calls.includes("createAtomically"), false);
  assert.equal(rec.calls.includes("findSub"), false);
  assert.equal(rec.createdPlan, null);
});

test("orchestration: subgroup not found fails before Student creation", async () => {
  const rec = newRecorder();
  const result = await createTraineeWithEnrollmentWithDeps(
    VALID_INPUT,
    fakeDeps(rec, { findSubGroupId: async () => (rec.calls.push("findSub"), null) }),
  );
  assert.deepEqual(result, { success: false, error: SUBGROUP_NOT_FOUND_MESSAGE });
  assert.equal(rec.calls.includes("createAtomically"), false);
  assert.equal(rec.createdPlan, null);
});

test("orchestration: duplicate identity (pre-check) is rejected before writes", async () => {
  const rec = newRecorder();
  const result = await createTraineeWithEnrollmentWithDeps(
    VALID_INPUT,
    fakeDeps(rec, { identityNumberExists: async () => (rec.calls.push("identityCheck"), true) }),
  );
  assert.deepEqual(result, { success: false, error: DUPLICATE_IDENTITY_MESSAGE });
  assert.equal(rec.calls.includes("createAtomically"), false);
  assert.equal(rec.createdPlan, null);
});

test("orchestration: concurrent duplicate (P2002 from the tx) maps to the friendly message", async () => {
  const rec = newRecorder();
  const result = await createTraineeWithEnrollmentWithDeps(
    VALID_INPUT,
    fakeDeps(rec, {
      createAtomically: async () => {
        rec.calls.push("createAtomically");
        throw { code: "P2002", meta: { target: ["identityNumber"] } };
      },
    }),
  );
  assert.deepEqual(result, { success: false, error: DUPLICATE_IDENTITY_MESSAGE });
});

test("orchestration: a non-duplicate transaction error propagates (not swallowed)", async () => {
  const rec = newRecorder();
  await assert.rejects(
    createTraineeWithEnrollmentWithDeps(
      VALID_INPUT,
      fakeDeps(rec, {
        createAtomically: async () => {
          rec.calls.push("createAtomically");
          throw new Error("db down");
        },
      }),
    ),
    /db down/,
  );
});

test("orchestration: offering id is ALWAYS server-derived (no client courseOfferingId honoured)", async () => {
  const rec = newRecorder();
  // Even if the input object is polluted with a stray courseOfferingId, it is ignored.
  const polluted = { ...VALID_INPUT, courseOfferingId: "attacker-supplied" } as CreateTraineeInput;
  await createTraineeWithEnrollmentWithDeps(polluted, fakeDeps(rec));
  assert.equal(rec.createdPlan?.courseOfferingId, "offering-1");
});

// --- boundary error classification + safe wrapper ---------------------------

test("isKnownCurrentOfferingError: matches the three structural offering errors only", () => {
  assert.equal(isKnownCurrentOfferingError(new NoCurrentCourseOfferingError()), true);
  assert.equal(isKnownCurrentOfferingError(new AmbiguousCourseOfferingError(["a", "b"])), true);
  assert.equal(isKnownCurrentOfferingError(new IncompleteCourseOfferingError("offer-1")), true);
  assert.equal(isKnownCurrentOfferingError(new Error("db down")), false);
  assert.equal(isKnownCurrentOfferingError({ code: "P2002" }), false);
  assert.equal(isKnownCurrentOfferingError(null), false);
});

const SAFE_MSG = "לא ניתן להוסיף חניך/ה כעת";

for (const [label, makeError] of [
  ["no offering", () => new NoCurrentCourseOfferingError()],
  ["ambiguous offering", () => new AmbiguousCourseOfferingError(["a", "b"])],
  ["incomplete offering", () => new IncompleteCourseOfferingError("offer-1")],
] as const) {
  test(`safe wrapper: ${label} -> safe ActionResult, zero transaction calls`, async () => {
    const rec = newRecorder();
    const result = await createTraineeWithEnrollmentSafe(
      VALID_INPUT,
      fakeDeps(rec, {
        resolveCurrentCourseOffering: async () => {
          rec.calls.push("resolveOffering");
          throw makeError();
        },
      }),
      SAFE_MSG,
    );
    assert.deepEqual(result, { success: false, error: SAFE_MSG });
    // No offering count/id/date leaked into the message.
    assert.equal(/offer-1|\bids?\b|\d{4}-\d{2}-\d{2}/.test(result.error ?? ""), false);
    assert.equal(rec.calls.includes("createAtomically"), false);
    assert.equal(rec.createdPlan, null);
  });
}

test("safe wrapper: an UNEXPECTED resolver error still throws (not swallowed)", async () => {
  const rec = newRecorder();
  await assert.rejects(
    createTraineeWithEnrollmentSafe(
      VALID_INPUT,
      fakeDeps(rec, {
        resolveCurrentCourseOffering: async () => {
          throw new Error("unexpected boom");
        },
      }),
      SAFE_MSG,
    ),
    /unexpected boom/,
  );
});

test("safe wrapper: duplicate-identity mapping is unchanged (friendly result, not the offering message)", async () => {
  const rec = newRecorder();
  const result = await createTraineeWithEnrollmentSafe(
    VALID_INPUT,
    fakeDeps(rec, { identityNumberExists: async () => (rec.calls.push("identityCheck"), true) }),
    SAFE_MSG,
  );
  assert.deepEqual(result, { success: false, error: DUPLICATE_IDENTITY_MESSAGE });
  assert.equal(rec.calls.includes("createAtomically"), false);
});

test("safe wrapper: group/subgroup resolution failures stay friendly ActionResults", async () => {
  const rec = newRecorder();
  const result = await createTraineeWithEnrollmentSafe(
    VALID_INPUT,
    fakeDeps(rec, { findTopGroupId: async () => (rec.calls.push("findTop"), null) }),
    SAFE_MSG,
  );
  assert.deepEqual(result, { success: false, error: GROUP_NOT_FOUND_MESSAGE });
  assert.equal(rec.calls.includes("createAtomically"), false);
});
