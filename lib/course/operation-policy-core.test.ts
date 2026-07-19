/**
 * MULTI-COURSE (dormant foundation, Slice 2) - executable tests for the PURE
 * CourseOffering operation-policy core.
 *
 * Run with: npx tsx --test lib/course/operation-policy-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import {
  COURSE_OFFERING_OPERATIONS,
  evaluateCourseOperationPolicy,
  assertCourseOperationAllowed,
  CourseOperationNotPermittedError,
  type CourseOfferingOperation,
} from "./operation-policy-core";

const STATUSES: readonly CourseOfferingStatus[] = ["PLANNED", "ACTIVE", "ARCHIVED"];

/**
 * The full expected matrix, stated independently of the implementation so the
 * table-driven test proves the whole PLANNED/ACTIVE/ARCHIVED contract compactly.
 * `true` = allowed, `false` = blocked.
 */
const EXPECTED: Record<CourseOfferingStatus, Record<CourseOfferingOperation, boolean>> = {
  PLANNED: {
    OFFERING_METADATA_UPDATE: true,
    OFFERING_STRUCTURE_UPDATE: true,
    ENROLLMENT_MANAGEMENT: true,
    GROUP_ASSIGNMENT: true,
    HORSE_ASSIGNMENT: true,
    SCHEDULE_DRAFT_CONFIGURATION: true,
    SCHEDULE_PUBLICATION: false,
    DUTY_ASSIGNMENT: false,
    ATTENDANCE_LOGGING: false,
    RIDING_OPERATION: false,
    TEACHING_PRACTICE_OPERATION: false,
    FEEDBACK_SUBMISSION: false,
    MESSAGE_OR_TASK_SEND: false,
    HISTORICAL_READ: true,
    DESTRUCTIVE_MAINTENANCE: false,
  },
  ACTIVE: {
    OFFERING_METADATA_UPDATE: true,
    OFFERING_STRUCTURE_UPDATE: false,
    ENROLLMENT_MANAGEMENT: true,
    GROUP_ASSIGNMENT: true,
    HORSE_ASSIGNMENT: true,
    SCHEDULE_DRAFT_CONFIGURATION: true,
    SCHEDULE_PUBLICATION: true,
    DUTY_ASSIGNMENT: true,
    ATTENDANCE_LOGGING: true,
    RIDING_OPERATION: true,
    TEACHING_PRACTICE_OPERATION: true,
    FEEDBACK_SUBMISSION: true,
    MESSAGE_OR_TASK_SEND: true,
    HISTORICAL_READ: true,
    DESTRUCTIVE_MAINTENANCE: false,
  },
  ARCHIVED: {
    OFFERING_METADATA_UPDATE: false,
    OFFERING_STRUCTURE_UPDATE: false,
    ENROLLMENT_MANAGEMENT: false,
    GROUP_ASSIGNMENT: false,
    HORSE_ASSIGNMENT: false,
    SCHEDULE_DRAFT_CONFIGURATION: false,
    SCHEDULE_PUBLICATION: false,
    DUTY_ASSIGNMENT: false,
    ATTENDANCE_LOGGING: false,
    RIDING_OPERATION: false,
    TEACHING_PRACTICE_OPERATION: false,
    FEEDBACK_SUBMISSION: false,
    MESSAGE_OR_TASK_SEND: false,
    HISTORICAL_READ: true,
    DESTRUCTIVE_MAINTENANCE: false,
  },
};

// --- A. full matrix (every PLANNED/ACTIVE/ARCHIVED cell) ---------------------

test("every status x operation cell matches the approved matrix", () => {
  for (const status of STATUSES) {
    for (const operation of COURSE_OFFERING_OPERATIONS) {
      const decision = evaluateCourseOperationPolicy(status, operation);
      assert.equal(
        decision.allowed,
        EXPECTED[status][operation],
        `${status}/${operation} expected allowed=${EXPECTED[status][operation]}`,
      );
      // Every real cell is classified - never an unknown-status/operation reason.
      assert.equal(
        decision.reason,
        EXPECTED[status][operation] ? "ALLOWED" : "DENIED_BY_STATUS_POLICY",
      );
    }
  }
});

// --- B. targeted spot-checks required by the contract ------------------------

test("DESTRUCTIVE_MAINTENANCE is denied for every status", () => {
  for (const status of STATUSES) {
    const decision = evaluateCourseOperationPolicy(status, "DESTRUCTIVE_MAINTENANCE");
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "DENIED_BY_STATUS_POLICY");
  }
});

test("ARCHIVED permits ONLY HISTORICAL_READ", () => {
  for (const operation of COURSE_OFFERING_OPERATIONS) {
    const allowed = evaluateCourseOperationPolicy("ARCHIVED", operation).allowed;
    assert.equal(allowed, operation === "HISTORICAL_READ", `ARCHIVED/${operation}`);
  }
});

test("PLANNED blocks MESSAGE_OR_TASK_SEND", () => {
  assert.equal(evaluateCourseOperationPolicy("PLANNED", "MESSAGE_OR_TASK_SEND").allowed, false);
});

test("ACTIVE blocks OFFERING_STRUCTURE_UPDATE", () => {
  assert.equal(
    evaluateCourseOperationPolicy("ACTIVE", "OFFERING_STRUCTURE_UPDATE").allowed,
    false,
  );
});

// --- C. default-deny for bypassed runtime values -----------------------------

test("unknown runtime operation fails closed", () => {
  const decision = evaluateCourseOperationPolicy(
    "ACTIVE",
    "TOTALLY_MADE_UP" as CourseOfferingOperation,
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "DENIED_UNKNOWN_OPERATION");
});

test("unknown runtime status fails closed", () => {
  const decision = evaluateCourseOperationPolicy(
    "SOMETHING_ELSE" as CourseOfferingStatus,
    "HISTORICAL_READ",
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "DENIED_UNKNOWN_STATUS");
});

test("prototype-polluting operation key is denied, not treated as allowed", () => {
  for (const key of ["__proto__", "constructor", "toString"] as string[]) {
    const decision = evaluateCourseOperationPolicy("ACTIVE", key as CourseOfferingOperation);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "DENIED_UNKNOWN_OPERATION");
  }
});

// --- D. assert helper --------------------------------------------------------

test("assertCourseOperationAllowed does not throw when allowed", () => {
  assert.doesNotThrow(() => assertCourseOperationAllowed("ACTIVE", "FEEDBACK_SUBMISSION"));
  assert.doesNotThrow(() => assertCourseOperationAllowed("ARCHIVED", "HISTORICAL_READ"));
});

test("assertCourseOperationAllowed throws CourseOperationNotPermittedError when blocked", () => {
  assert.throws(
    () => assertCourseOperationAllowed("ARCHIVED", "FEEDBACK_SUBMISSION"),
    (err: unknown) => {
      assert.ok(err instanceof CourseOperationNotPermittedError);
      assert.equal(err.status, "ARCHIVED");
      assert.equal(err.operation, "FEEDBACK_SUBMISSION");
      assert.equal(err.reason, "DENIED_BY_STATUS_POLICY");
      assert.equal(err.code, "COURSE_OPERATION_NOT_PERMITTED");
      return true;
    },
  );
});

test("typed error keeps structured status/operation/reason but a generic message (no reflection)", () => {
  try {
    assertCourseOperationAllowed("PLANNED", "DESTRUCTIVE_MAINTENANCE");
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof CourseOperationNotPermittedError);
    // Structured, non-PII fields remain available for server-side diagnostics.
    assert.equal(err.status, "PLANNED");
    assert.equal(err.operation, "DESTRUCTIVE_MAINTENANCE");
    assert.equal(err.reason, "DENIED_BY_STATUS_POLICY");
    // The human-readable message is generic and reflects none of those values.
    assert.equal(err.message, "Course operation is not permitted.");
    assert.doesNotMatch(err.message, /PLANNED/);
    assert.doesNotMatch(err.message, /DESTRUCTIVE_MAINTENANCE/);
    assert.doesNotMatch(err.message, /DENIED_BY_STATUS_POLICY/);
  }
});

test("typed error message does not reflect a deliberately supplied unknown operation", () => {
  const bogus = "PWN'; DROP TABLE offerings;--";
  try {
    assertCourseOperationAllowed("ACTIVE", bogus as CourseOfferingOperation);
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof CourseOperationNotPermittedError);
    assert.equal(err.reason, "DENIED_UNKNOWN_OPERATION");
    assert.equal(err.message, "Course operation is not permitted.");
    assert.doesNotMatch(err.message, /DROP TABLE/);
  }
});

// --- E. immutability of the public surface -----------------------------------

test("the closed operation list is frozen (no mutation of the exported categories)", () => {
  assert.ok(Object.isFrozen(COURSE_OFFERING_OPERATIONS));
});

// --- F. exhaustive coverage of the real status set ---------------------------

test("all three real statuses are fully classified for every operation", () => {
  // If a future Prisma status were added, the policy table would fail to compile
  // (Record<CourseOfferingStatus, ...>). At runtime we additionally prove none of
  // the three current statuses leaves any operation unclassified.
  for (const status of STATUSES) {
    for (const operation of COURSE_OFFERING_OPERATIONS) {
      const reason = evaluateCourseOperationPolicy(status, operation).reason;
      assert.notEqual(reason, "DENIED_UNKNOWN_STATUS", `${status} should be known`);
      assert.notEqual(reason, "DENIED_UNKNOWN_OPERATION", `${operation} should be known`);
    }
  }
});
