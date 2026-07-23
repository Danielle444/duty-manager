/**
 * MULTI-COURSE (Level-2-only new-trainee slice N1) - DB-free tests for the DI IO
 * orchestration createTraineeIntoOfferingWithDeps, plus a comment-stripped
 * source scan that enforces the negative-safety contract on BOTH source files.
 *
 * Run with: npx tsx --test lib/course/create-trainee-into-offering.test.ts
 * No Prisma, no DB: the interactive transaction is injected as a fake that
 * observes commit-vs-rollback and passes a fake CreateTraineeTxClient to the core
 * body. These tests prove: invalid_input short-circuits BEFORE any transaction is
 * opened; proof failures pass through unchanged (never mislabelled "unexpected");
 * a concurrent Student identity unique violation maps to duplicate_identity with a
 * rolled back transaction; any other write failure maps to unexpected with
 * rollback; and the EXACT courseOfferingId is used (no ACTIVE-singleton / cookie /
 * name lookup).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import {
  createTraineeIntoOfferingWithDeps,
  type CreateTraineeIntoOfferingDeps,
} from "./create-trainee-into-offering";
import type {
  CreateTraineeTxClient,
  CreateTraineeIntoOfferingInput,
  TxOfferingRow,
} from "./create-trainee-into-offering-core";

const START = new Date("2026-07-26T00:00:00.000Z");

const VALID_INPUT: CreateTraineeIntoOfferingInput = {
  courseOfferingId: "off-L2",
  courseGroupId: "grp-leaf",
  firstName: "דנה",
  lastName: "כהן",
  identityNumber: "123456789",
  phone: "0501234567",
};

const P2002_IDENTITY = { code: "P2002", meta: { target: ["identityNumber"] } };

interface FakeTxConfig {
  offering?: TxOfferingRow | null;
  leafGroup?: { id: string } | null;
  existingStudent?: { id: string } | null;
  createStudentError?: unknown;
  createEnrollmentError?: unknown;
  createMembershipError?: unknown;
}

function makeFakeTxClient(
  config: FakeTxConfig,
  rec: { offeringQueried: string | null },
): CreateTraineeTxClient {
  const offering =
    config.offering !== undefined
      ? config.offering
      : ({ id: "off-L2", status: "PLANNED" as CourseOfferingStatus, startDate: START });
  const leafGroup = config.leafGroup !== undefined ? config.leafGroup : { id: "grp-leaf" };
  const existingStudent =
    config.existingStudent !== undefined ? config.existingStudent : null;

  return {
    findOffering: async (courseOfferingId) => {
      rec.offeringQueried = courseOfferingId;
      return offering;
    },
    findLeafGroup: async () => leafGroup,
    findStudentByIdentityNumber: async () => existingStudent,
    createStudent: async () => {
      if (config.createStudentError !== undefined) throw config.createStudentError;
      return { id: "stu-new" };
    },
    createEnrollment: async () => {
      if (config.createEnrollmentError !== undefined) throw config.createEnrollmentError;
      return { id: "enr-new" };
    },
    createMembership: async () => {
      if (config.createMembershipError !== undefined) throw config.createMembershipError;
      return { id: "mem-new" };
    },
  };
}

interface FakeTransaction {
  deps: CreateTraineeIntoOfferingDeps;
  opened: boolean;
  committed: boolean;
  rolledBack: boolean;
  offeringQueried: string | null;
}

function makeFakeTransaction(config: FakeTxConfig = {}): FakeTransaction {
  const state: FakeTransaction = {
    opened: false,
    committed: false,
    rolledBack: false,
    offeringQueried: null,
    deps: undefined as unknown as CreateTraineeIntoOfferingDeps,
  };
  state.deps = {
    transaction: async (fn) => {
      state.opened = true;
      const tx = makeFakeTxClient(config, state);
      try {
        const result = await fn(tx);
        state.committed = true;
        return result;
      } catch (err) {
        state.rolledBack = true;
        throw err;
      }
    },
  };
  return state;
}

// ---------------------------------------------------------------------------
// DI orchestration
// ---------------------------------------------------------------------------

test("invalid_input short-circuits BEFORE any transaction is opened", async () => {
  const t = makeFakeTransaction();
  const r = await createTraineeIntoOfferingWithDeps({ ...VALID_INPUT, firstName: "  " }, t.deps);
  assert.deepEqual(r, { success: false, error: "invalid_input" });
  assert.equal(t.opened, false);
});

test("invalid identityNumber short-circuits before any transaction", async () => {
  const t = makeFakeTransaction();
  const r = await createTraineeIntoOfferingWithDeps({ ...VALID_INPUT, identityNumber: "12ab" }, t.deps);
  assert.deepEqual(r, { success: false, error: "invalid_input" });
  assert.equal(t.opened, false);
});

test("happy path returns success with both ids and commits the transaction", async () => {
  const t = makeFakeTransaction();
  const r = await createTraineeIntoOfferingWithDeps(VALID_INPUT, t.deps);
  assert.deepEqual(r, { success: true, studentId: "stu-new", enrollmentId: "enr-new" });
  assert.equal(t.opened, true);
  assert.equal(t.committed, true);
  assert.equal(t.rolledBack, false);
});

test("uses the EXACT courseOfferingId (no ACTIVE-singleton / cookie / name lookup)", async () => {
  const t = makeFakeTransaction();
  await createTraineeIntoOfferingWithDeps({ ...VALID_INPUT, courseOfferingId: "off-explicit" }, t.deps);
  assert.equal(t.offeringQueried, "off-explicit");
});

test("a proof failure passes through unchanged (NOT mislabelled unexpected)", async () => {
  const t = makeFakeTransaction({ offering: null });
  const r = await createTraineeIntoOfferingWithDeps(VALID_INPUT, t.deps);
  assert.deepEqual(r, { success: false, error: "offering_not_found" });
  // Proof failure returns before any write, so the (empty) transaction commits.
  assert.equal(t.committed, true);
  assert.equal(t.rolledBack, false);
});

test("ACTIVE offering -> operation_not_allowed (proof failure, no rollback)", async () => {
  const t = makeFakeTransaction({ offering: { id: "off-L2", status: "ACTIVE", startDate: START } });
  const r = await createTraineeIntoOfferingWithDeps(VALID_INPUT, t.deps);
  assert.deepEqual(r, { success: false, error: "operation_not_allowed" });
});

test("invalid group -> invalid_group (proof failure, no rollback)", async () => {
  const t = makeFakeTransaction({ leafGroup: null });
  const r = await createTraineeIntoOfferingWithDeps(VALID_INPUT, t.deps);
  assert.deepEqual(r, { success: false, error: "invalid_group" });
  assert.equal(t.committed, true);
});

test("pre-existing identity -> duplicate_identity (proof failure, no rollback, no re-enroll)", async () => {
  const t = makeFakeTransaction({ existingStudent: { id: "stu-existing" } });
  const r = await createTraineeIntoOfferingWithDeps(VALID_INPUT, t.deps);
  assert.deepEqual(r, { success: false, error: "duplicate_identity" });
  assert.equal(t.committed, true);
  assert.equal(t.rolledBack, false);
});

test("concurrent Student identity unique violation (P2002) -> duplicate_identity with rollback", async () => {
  const t = makeFakeTransaction({ createStudentError: P2002_IDENTITY });
  const r = await createTraineeIntoOfferingWithDeps(VALID_INPUT, t.deps);
  assert.deepEqual(r, { success: false, error: "duplicate_identity" });
  assert.equal(t.rolledBack, true);
  assert.equal(t.committed, false);
});

test("any other write failure (membership) -> unexpected with rollback", async () => {
  const t = makeFakeTransaction({ createMembershipError: new Error("membership write failed") });
  const r = await createTraineeIntoOfferingWithDeps(VALID_INPUT, t.deps);
  assert.deepEqual(r, { success: false, error: "unexpected" });
  assert.equal(t.rolledBack, true);
  assert.equal(t.committed, false);
});

test("a write failure during enrollment -> unexpected with rollback", async () => {
  const t = makeFakeTransaction({ createEnrollmentError: new Error("enrollment write failed") });
  const r = await createTraineeIntoOfferingWithDeps(VALID_INPUT, t.deps);
  assert.deepEqual(r, { success: false, error: "unexpected" });
  assert.equal(t.rolledBack, true);
});

// ---------------------------------------------------------------------------
// Negative-safety source scan (both source files, comments stripped)
// ---------------------------------------------------------------------------

/** Strip block and line comments so the scan only sees executable code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function readSibling(name: string): string {
  const path = fileURLToPath(new URL(`./${name}`, import.meta.url));
  return stripComments(readFileSync(path, "utf8"));
}

const CORE_CODE = readSibling("create-trainee-into-offering-core.ts");
const IO_CODE = readSibling("create-trainee-into-offering.ts");

// Forbidden in the executable code of BOTH files (comments excluded).
const FORBIDDEN = [
  "resolveCurrentCourseOffering",
  "current-offering",
  "next/headers",
  "cookies",
  "traineeHorseAssignment",
  "TraineeHorseAssignment",
  "TraineeGroupMembership",
  "traineeGroupMembership",
  ".update(",
  "activate",
];

test("no active-offering resolver, cookie, auth-header, horse, legacy-membership, update, or activation in code", () => {
  for (const token of FORBIDDEN) {
    assert.equal(CORE_CODE.includes(token), false, `core must not contain '${token}'`);
    assert.equal(IO_CODE.includes(token), false, `io must not contain '${token}'`);
  }
});

test("core is DB-free: it does not import the Prisma client", () => {
  assert.equal(CORE_CODE.includes('from "@/lib/prisma"'), false);
  assert.equal(CORE_CODE.includes("next/cache"), false);
});

test("Student is written inactive by construction: 'isActive: false' present, 'isActive: true' absent", () => {
  assert.equal(CORE_CODE.includes("isActive: false"), true);
  assert.equal(CORE_CODE.includes("isActive: true"), false);
  assert.equal(IO_CODE.includes("isActive: true"), false);
});

test("no auth/session dependency is imported in either file", () => {
  assert.equal(CORE_CODE.includes("@/lib/auth"), false);
  assert.equal(IO_CODE.includes("@/lib/auth"), false);
});
