/**
 * MULTI-COURSE (Level-2-only new-trainee slice N1) - DB-free tests for the PURE
 * create-into-offering core: input normalization, offering classification,
 * duplicate detection, and the transaction body (runCreateTraineeIntoOfferingInTx)
 * exercised through a fake CreateTraineeTxClient.
 *
 * Run with: npx tsx --test lib/course/create-trainee-into-offering-core.test.ts
 * No Prisma, no DB: every transaction-local read and every write is a fake that
 * records its calls, so these tests prove the proof order, the exact three-write
 * boundary (Student -> CourseEnrollment -> GroupMembership, no horse / no legacy
 * membership), the inactive-staging + null-group containment, the PLANNED-only
 * lifecycle, the leaf/ownership proof, duplicate handling, and the
 * fail-before/rollback-by-throw guarantees without a live database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import {
  runCreateTraineeIntoOfferingInTx,
  normalizeCreateTraineeInput,
  classifyOfferingForCreate,
  isDuplicateIdentityNumberError,
  DuplicateIdentityError,
  IDENTITY_NUMBER_PATTERN,
  type CreateTraineeTxClient,
  type CreateTraineeIntoOfferingInput,
  type NormalizedCreateTraineeInput,
  type StudentCreateData,
  type EnrollmentCreateData,
  type MembershipCreateData,
  type TxOfferingRow,
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

/** A pre-normalized value for driving the tx body directly. */
const NORMALIZED: NormalizedCreateTraineeInput = {
  courseOfferingId: "off-L2",
  courseGroupId: "grp-leaf",
  firstName: "דנה",
  lastName: "כהן",
  fullName: "דנה כהן",
  identityNumber: "123456789",
  phone: "0501234567",
};

const P2002_IDENTITY = { code: "P2002", meta: { target: ["identityNumber"] } };

interface FakeTxConfig {
  offering?: TxOfferingRow | null;
  leafGroup?: { id: string } | null;
  existingStudent?: { id: string } | null;
  studentId?: string;
  enrollmentId?: string;
  createStudentError?: unknown;
  createEnrollmentError?: unknown;
  createMembershipError?: unknown;
}

interface FakeTxRecorder {
  tx: CreateTraineeTxClient;
  calls: string[];
  offeringQueried: string | null;
  leafQueried: { groupId: string; offeringId: string } | null;
  identityQueried: string | null;
  studentData: StudentCreateData | null;
  enrollmentData: EnrollmentCreateData | null;
  membershipData: MembershipCreateData | null;
}

function makeFakeTx(config: FakeTxConfig = {}): FakeTxRecorder {
  const offering =
    config.offering !== undefined
      ? config.offering
      : ({ id: "off-L2", status: "PLANNED" as CourseOfferingStatus, startDate: START });
  const leafGroup = config.leafGroup !== undefined ? config.leafGroup : { id: "grp-leaf" };
  const existingStudent =
    config.existingStudent !== undefined ? config.existingStudent : null;
  const studentId = config.studentId ?? "stu-new";
  const enrollmentId = config.enrollmentId ?? "enr-new";

  const rec: FakeTxRecorder = {
    calls: [],
    offeringQueried: null,
    leafQueried: null,
    identityQueried: null,
    studentData: null,
    enrollmentData: null,
    membershipData: null,
    tx: undefined as unknown as CreateTraineeTxClient,
  };

  rec.tx = {
    findOffering: async (courseOfferingId) => {
      rec.calls.push("findOffering");
      rec.offeringQueried = courseOfferingId;
      return offering;
    },
    findLeafGroup: async (courseGroupId, courseOfferingId) => {
      rec.calls.push("findLeafGroup");
      rec.leafQueried = { groupId: courseGroupId, offeringId: courseOfferingId };
      return leafGroup;
    },
    findStudentByIdentityNumber: async (identityNumber) => {
      rec.calls.push("findStudentByIdentityNumber");
      rec.identityQueried = identityNumber;
      return existingStudent;
    },
    createStudent: async (data) => {
      rec.calls.push("createStudent");
      rec.studentData = data;
      if (config.createStudentError !== undefined) throw config.createStudentError;
      return { id: studentId };
    },
    createEnrollment: async (data) => {
      rec.calls.push("createEnrollment");
      rec.enrollmentData = data;
      if (config.createEnrollmentError !== undefined) throw config.createEnrollmentError;
      return { id: enrollmentId };
    },
    createMembership: async (data) => {
      rec.calls.push("createMembership");
      rec.membershipData = data;
      if (config.createMembershipError !== undefined) throw config.createMembershipError;
      return { id: "mem-new" };
    },
  };

  return rec;
}

// ---------------------------------------------------------------------------
// normalizeCreateTraineeInput
// ---------------------------------------------------------------------------

test("normalize: rejects empty courseOfferingId", () => {
  const r = normalizeCreateTraineeInput({ ...VALID_INPUT, courseOfferingId: "  " });
  assert.equal(r.ok, false);
});

test("normalize: rejects empty courseGroupId", () => {
  const r = normalizeCreateTraineeInput({ ...VALID_INPUT, courseGroupId: "" });
  assert.equal(r.ok, false);
});

test("normalize: rejects missing/blank firstName", () => {
  const r = normalizeCreateTraineeInput({ ...VALID_INPUT, firstName: "   " });
  assert.equal(r.ok, false);
});

test("normalize: rejects missing/blank lastName", () => {
  const r = normalizeCreateTraineeInput({ ...VALID_INPUT, lastName: "" });
  assert.equal(r.ok, false);
});

test("normalize: rejects missing identityNumber", () => {
  const r = normalizeCreateTraineeInput({ ...VALID_INPUT, identityNumber: "   " });
  assert.equal(r.ok, false);
});

test("normalize: rejects identityNumber with a non-digit / wrong length", () => {
  assert.equal(normalizeCreateTraineeInput({ ...VALID_INPUT, identityNumber: "12ab567" }).ok, false);
  assert.equal(normalizeCreateTraineeInput({ ...VALID_INPUT, identityNumber: "1234" }).ok, false); // < 5
  assert.equal(normalizeCreateTraineeInput({ ...VALID_INPUT, identityNumber: "1234567890" }).ok, false); // > 9
});

test("IDENTITY_NUMBER_PATTERN mirrors the create-trainee 5-9 digit rule", () => {
  assert.equal(IDENTITY_NUMBER_PATTERN.test("12345"), true);
  assert.equal(IDENTITY_NUMBER_PATTERN.test("123456789"), true);
  assert.equal(IDENTITY_NUMBER_PATTERN.test("1234"), false);
  assert.equal(IDENTITY_NUMBER_PATTERN.test("1234567890"), false);
  assert.equal(IDENTITY_NUMBER_PATTERN.test("12a45"), false);
});

test("normalize: trims all identifiers and derives fullName deterministically", () => {
  const r = normalizeCreateTraineeInput({
    courseOfferingId: "  off-L2 ",
    courseGroupId: " grp-leaf ",
    firstName: "  דנה ",
    lastName: " כהן  ",
    identityNumber: "  123456789 ",
    phone: " 0501234567 ",
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.value, {
      courseOfferingId: "off-L2",
      courseGroupId: "grp-leaf",
      firstName: "דנה",
      lastName: "כהן",
      fullName: "דנה כהן",
      identityNumber: "123456789",
      phone: "0501234567",
    });
  }
});

test("normalize: fullName is exactly `${firstName} ${lastName}` trimmed", () => {
  const r = normalizeCreateTraineeInput({ ...VALID_INPUT, firstName: "A", lastName: "B" });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.fullName, "A B");
});

test("normalize: absent phone -> null; empty/whitespace phone -> null; never rejects", () => {
  const noPhone = normalizeCreateTraineeInput({
    courseOfferingId: "off-L2",
    courseGroupId: "grp-leaf",
    firstName: "A",
    lastName: "B",
    identityNumber: "123456789",
  });
  assert.equal(noPhone.ok, true);
  if (noPhone.ok) assert.equal(noPhone.value.phone, null);

  const blankPhone = normalizeCreateTraineeInput({ ...VALID_INPUT, phone: "   " });
  assert.equal(blankPhone.ok, true);
  if (blankPhone.ok) assert.equal(blankPhone.value.phone, null);
});

test("normalize: phone is stored trimmed and NOT reformatted", () => {
  const r = normalizeCreateTraineeInput({ ...VALID_INPUT, phone: "  +972-50-123-4567 " });
  assert.equal(r.ok, true);
  // The existing create convention stores the trimmed raw value verbatim.
  if (r.ok) assert.equal(r.value.phone, "+972-50-123-4567");
});

// ---------------------------------------------------------------------------
// classifyOfferingForCreate
// ---------------------------------------------------------------------------

test("classify: PLANNED + startDate is allowed", () => {
  const r = classifyOfferingForCreate("PLANNED", START);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.startDate, START);
});

test("classify: ACTIVE is rejected in slice N1 (operation_not_allowed)", () => {
  assert.deepEqual(classifyOfferingForCreate("ACTIVE", START), {
    ok: false,
    error: "operation_not_allowed",
  });
});

test("classify: ARCHIVED is rejected (operation_not_allowed)", () => {
  assert.deepEqual(classifyOfferingForCreate("ARCHIVED", START), {
    ok: false,
    error: "operation_not_allowed",
  });
});

test("classify: PLANNED with null startDate -> offering_start_date_missing", () => {
  assert.deepEqual(classifyOfferingForCreate("PLANNED", null), {
    ok: false,
    error: "offering_start_date_missing",
  });
});

// ---------------------------------------------------------------------------
// isDuplicateIdentityNumberError
// ---------------------------------------------------------------------------

test("isDuplicateIdentityNumberError: true only for a P2002 (identity target)", () => {
  assert.equal(isDuplicateIdentityNumberError(P2002_IDENTITY), true);
  assert.equal(isDuplicateIdentityNumberError({ code: "P2002", meta: { target: "identityNumber" } }), true);
  // P2002 with an unreadable target is still safely attributed to identityNumber.
  assert.equal(isDuplicateIdentityNumberError({ code: "P2002" }), true);
  assert.equal(isDuplicateIdentityNumberError({ code: "P2003" }), false);
  assert.equal(isDuplicateIdentityNumberError(new Error("boom")), false);
  assert.equal(isDuplicateIdentityNumberError(null), false);
});

// ---------------------------------------------------------------------------
// runCreateTraineeIntoOfferingInTx - proof failures (no writes)
// ---------------------------------------------------------------------------

test("offering not found -> offering_not_found; no writes", async () => {
  const rec = makeFakeTx({ offering: null });
  const r = await runCreateTraineeIntoOfferingInTx(rec.tx, NORMALIZED);
  assert.deepEqual(r, { success: false, error: "offering_not_found" });
  assert.deepEqual(rec.calls, ["findOffering"]);
});

test("stale re-read sees ACTIVE -> operation_not_allowed; no writes", async () => {
  const rec = makeFakeTx({ offering: { id: "off-L2", status: "ACTIVE", startDate: START } });
  const r = await runCreateTraineeIntoOfferingInTx(rec.tx, NORMALIZED);
  assert.deepEqual(r, { success: false, error: "operation_not_allowed" });
  assert.deepEqual(rec.calls, ["findOffering"]);
});

test("ARCHIVED offering -> operation_not_allowed; no writes", async () => {
  const rec = makeFakeTx({ offering: { id: "off-L2", status: "ARCHIVED", startDate: START } });
  const r = await runCreateTraineeIntoOfferingInTx(rec.tx, NORMALIZED);
  assert.deepEqual(r, { success: false, error: "operation_not_allowed" });
});

test("PLANNED with missing startDate -> offering_start_date_missing; no writes", async () => {
  const rec = makeFakeTx({ offering: { id: "off-L2", status: "PLANNED", startDate: null } });
  const r = await runCreateTraineeIntoOfferingInTx(rec.tx, NORMALIZED);
  assert.deepEqual(r, { success: false, error: "offering_start_date_missing" });
  assert.deepEqual(rec.calls, ["findOffering"]);
});

test("leaf/ownership proof fails (null) -> invalid_group; no writes", async () => {
  const rec = makeFakeTx({ leafGroup: null });
  const r = await runCreateTraineeIntoOfferingInTx(rec.tx, NORMALIZED);
  assert.deepEqual(r, { success: false, error: "invalid_group" });
  assert.deepEqual(rec.calls, ["findOffering", "findLeafGroup"]);
  // The proof is scoped to the re-read offering id and the requested group id
  // (proves a top-level group / another offering's subgroup would be rejected).
  assert.deepEqual(rec.leafQueried, { groupId: "grp-leaf", offeringId: "off-L2" });
});

test("existing identity found before insert -> duplicate_identity; no writes; no re-enroll", async () => {
  const rec = makeFakeTx({ existingStudent: { id: "stu-existing" } });
  const r = await runCreateTraineeIntoOfferingInTx(rec.tx, NORMALIZED);
  assert.deepEqual(r, { success: false, error: "duplicate_identity" });
  assert.deepEqual(rec.calls, ["findOffering", "findLeafGroup", "findStudentByIdentityNumber"]);
  // No Student is created and NO enrollment/membership is written for the match.
  assert.equal(rec.calls.includes("createStudent"), false);
  assert.equal(rec.calls.includes("createEnrollment"), false);
  assert.equal(rec.calls.includes("createMembership"), false);
});

// ---------------------------------------------------------------------------
// runCreateTraineeIntoOfferingInTx - happy path (exact three writes)
// ---------------------------------------------------------------------------

test("happy path: Student -> CourseEnrollment -> GroupMembership in exact order", async () => {
  const rec = makeFakeTx();
  const r = await runCreateTraineeIntoOfferingInTx(rec.tx, NORMALIZED);
  assert.deepEqual(r, { success: true, studentId: "stu-new", enrollmentId: "enr-new" });
  assert.deepEqual(rec.calls, [
    "findOffering",
    "findLeafGroup",
    "findStudentByIdentityNumber",
    "createStudent",
    "createEnrollment",
    "createMembership",
  ]);
});

test("happy path: Student is staged inactive with NO group mirror", async () => {
  const rec = makeFakeTx();
  await runCreateTraineeIntoOfferingInTx(rec.tx, NORMALIZED);
  const s = rec.studentData;
  assert.ok(s);
  assert.equal(s.isActive, false);
  assert.equal(s.groupName, null);
  assert.equal(s.subgroupNumber, null);
  assert.equal(s.firstName, "דנה");
  assert.equal(s.lastName, "כהן");
  assert.equal(s.fullName, "דנה כהן");
  assert.equal(s.identityNumber, "123456789");
  assert.equal(s.phone, "0501234567");
});

test("happy path: enrollment is ACTIVE, primary, startDate = offering.startDate", async () => {
  const rec = makeFakeTx();
  await runCreateTraineeIntoOfferingInTx(rec.tx, NORMALIZED);
  const d = rec.enrollmentData;
  assert.ok(d);
  assert.equal(d.studentId, "stu-new");
  assert.equal(d.courseOfferingId, "off-L2");
  assert.equal(d.status, "ACTIVE");
  assert.equal(d.isPrimary, true);
  assert.equal(d.startDate.getTime(), START.getTime());
});

test("happy path: membership targets the proven leaf, uses the new enrollment id, shares the effective date", async () => {
  const rec = makeFakeTx();
  await runCreateTraineeIntoOfferingInTx(rec.tx, NORMALIZED);
  const m = rec.membershipData;
  assert.ok(m);
  assert.equal(m.courseEnrollmentId, "enr-new");
  assert.equal(m.courseGroupId, "grp-leaf");
  assert.equal(m.effectiveFrom.getTime(), START.getTime());
  assert.equal(m.effectiveTo, null);
});

test("happy path: enrollment.startDate and membership.effectiveFrom both derive from offering.startDate", async () => {
  const rec = makeFakeTx();
  await runCreateTraineeIntoOfferingInTx(rec.tx, NORMALIZED);
  const t = START.getTime();
  assert.equal(rec.enrollmentData?.startDate.getTime(), t);
  assert.equal(rec.membershipData?.effectiveFrom.getTime(), t);
});

test("all writes use the transaction-proven offering.id, new student.id, and proven group.id", async () => {
  const rec = makeFakeTx({
    offering: { id: "off-canonical", status: "PLANNED", startDate: START },
    leafGroup: { id: "grp-canonical" },
    studentId: "stu-canonical",
    enrollmentId: "enr-canonical",
  });
  await runCreateTraineeIntoOfferingInTx(rec.tx, NORMALIZED);
  assert.equal(rec.enrollmentData?.courseOfferingId, "off-canonical");
  assert.equal(rec.enrollmentData?.studentId, "stu-canonical");
  assert.equal(rec.membershipData?.courseGroupId, "grp-canonical");
  assert.equal(rec.membershipData?.courseEnrollmentId, "enr-canonical");
  // The identity pre-read is scoped to the normalized identity number.
  assert.equal(rec.identityQueried, "123456789");
});

// ---------------------------------------------------------------------------
// runCreateTraineeIntoOfferingInTx - duplicate / concurrency / rollback (throws)
// ---------------------------------------------------------------------------

test("P2002 on Student create -> throws DuplicateIdentityError; no enrollment/membership; single attempt", async () => {
  const rec = makeFakeTx({ createStudentError: P2002_IDENTITY });
  await assert.rejects(
    () => runCreateTraineeIntoOfferingInTx(rec.tx, NORMALIZED),
    (err) => err instanceof DuplicateIdentityError,
  );
  assert.equal(rec.calls.includes("createEnrollment"), false);
  assert.equal(rec.calls.includes("createMembership"), false);
  // No fallback Student creation after the duplicate: exactly one attempt.
  assert.equal(rec.calls.filter((c) => c === "createStudent").length, 1);
});

test("non-P2002 error on Student create propagates unchanged; no later writes", async () => {
  const boom = new Error("infra down");
  const rec = makeFakeTx({ createStudentError: boom });
  await assert.rejects(
    () => runCreateTraineeIntoOfferingInTx(rec.tx, NORMALIZED),
    (err) => err === boom,
  );
  assert.equal(rec.calls.includes("createEnrollment"), false);
  assert.equal(rec.calls.includes("createMembership"), false);
});

test("failure during enrollment propagates (rollback by throw); Student was attempted first, no membership", async () => {
  const boom = new Error("enrollment write failed");
  const rec = makeFakeTx({ createEnrollmentError: boom });
  await assert.rejects(
    () => runCreateTraineeIntoOfferingInTx(rec.tx, NORMALIZED),
    (err) => err === boom,
  );
  assert.deepEqual(rec.calls.slice(-2), ["createStudent", "createEnrollment"]);
  assert.equal(rec.calls.includes("createMembership"), false);
});

test("failure during membership propagates (rollback by throw); Student + enrollment attempted first", async () => {
  const boom = new Error("membership write failed");
  const rec = makeFakeTx({ createMembershipError: boom });
  await assert.rejects(
    () => runCreateTraineeIntoOfferingInTx(rec.tx, NORMALIZED),
    (err) => err === boom,
  );
  assert.deepEqual(rec.calls.slice(-3), ["createStudent", "createEnrollment", "createMembership"]);
});

// ---------------------------------------------------------------------------
// Compatibility protection (structural / negative safety)
// ---------------------------------------------------------------------------

test("the tx surface exposes NO horse / legacy-membership / student-update / activate / resolver method", () => {
  const rec = makeFakeTx();
  const keys = Object.keys(rec.tx);
  assert.deepEqual(keys.sort(), [
    "createEnrollment",
    "createMembership",
    "createStudent",
    "findLeafGroup",
    "findOffering",
    "findStudentByIdentityNumber",
  ]);
  for (const k of keys) {
    assert.equal(/horse/i.test(k), false);
    assert.equal(/traineeGroupMembership/i.test(k), false);
    assert.equal(/update|activate/i.test(k), false);
    assert.equal(/resolveCurrent|cookie|offeringByName|level/i.test(k), false);
  }
});

test("a full run performs EXACTLY three writes (student + enrollment + membership); no horse write", async () => {
  const rec = makeFakeTx();
  await runCreateTraineeIntoOfferingInTx(rec.tx, NORMALIZED);
  const writes = rec.calls.filter((c) => c.startsWith("create"));
  assert.deepEqual(writes, ["createStudent", "createEnrollment", "createMembership"]);
});
