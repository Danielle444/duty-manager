/**
 * Executable tests for the pure actor-derivation logic (Stage 0A-1c).
 *
 * Uses the existing `tsx` runner with Node built-ins `node:test` and
 * `node:assert/strict`. No test framework is installed. Run with:
 *   npx tsx --test lib/auth/actor-core.test.ts
 *
 * These tests are PURE: they exercise only ./actor-core (no next/headers, no
 * Prisma). Helper factories build a valid VerifiedSession and valid rows so each
 * case can vary exactly one condition.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { deriveInstructorActor, deriveTraineeActor } from "./actor-core";
import type { VerifiedSession } from "./session-types";
import type {
  InstructorActorRow,
  TraineeActorRow,
} from "./actor-types";

const INSTRUCTOR_ID = "instructor-123";
const TRAINEE_ID = "student-789";

function instructorSession(
  overrides: Partial<VerifiedSession> = {},
): VerifiedSession {
  return {
    audience: "instructor",
    subject: INSTRUCTOR_ID,
    issuedAt: 1000,
    expiresAt: 4600,
    sessionId: "sess-instructor",
    ...overrides,
  };
}

function traineeSession(
  overrides: Partial<VerifiedSession> = {},
): VerifiedSession {
  return {
    audience: "trainee",
    subject: TRAINEE_ID,
    issuedAt: 1000,
    expiresAt: 4600,
    sessionId: "sess-trainee",
    ...overrides,
  };
}

function instructorRow(
  overrides: Partial<InstructorActorRow> = {},
): InstructorActorRow {
  return {
    id: INSTRUCTOR_ID,
    fullName: "Instructor Name",
    isActive: true,
    canEditHorseAssignments: true,
    canSendMessages: false,
    canEditAttendance: true,
    canEditRidingNotes: false,
    canEditHorseFeeding: true,
    canManageTeachingPracticeAssignments: false,
    canManageTeachingPracticeHorses: true,
    canEditTeachingPracticeFeedback: false,
    canManageChildSignatures: true,
    ...overrides,
  };
}

function traineeRow(
  overrides: Partial<TraineeActorRow> = {},
): TraineeActorRow {
  return {
    id: TRAINEE_ID,
    fullName: "Trainee Name",
    isActive: true,
    ...overrides,
  };
}

const INSTRUCTOR_ACTOR_KEYS = [
  "id",
  "fullName",
  "canEditHorseAssignments",
  "canSendMessages",
  "canEditAttendance",
  "canEditRidingNotes",
  "canEditHorseFeeding",
  "canManageTeachingPracticeAssignments",
  "canManageTeachingPracticeHorses",
  "canEditTeachingPracticeFeedback",
  "canManageChildSignatures",
];

// 1. valid active instructor → exact actor with all nine can* values
test("valid active instructor session+row yields the exact InstructorActor", () => {
  const actor = deriveInstructorActor(instructorSession(), instructorRow());
  assert.ok(actor);
  assert.equal(actor.id, INSTRUCTOR_ID);
  assert.equal(actor.fullName, "Instructor Name");
  assert.equal(actor.canEditHorseAssignments, true);
  assert.equal(actor.canSendMessages, false);
  assert.equal(actor.canEditAttendance, true);
  assert.equal(actor.canEditRidingNotes, false);
  assert.equal(actor.canEditHorseFeeding, true);
  assert.equal(actor.canManageTeachingPracticeAssignments, false);
  assert.equal(actor.canManageTeachingPracticeHorses, true);
  assert.equal(actor.canEditTeachingPracticeFeedback, false);
  assert.equal(actor.canManageChildSignatures, true);
});

// 2. instructor actor key set excludes isActive and any other field
test("instructor actor key set is exactly the eleven actor keys (no isActive)", () => {
  const actor = deriveInstructorActor(instructorSession(), instructorRow());
  assert.ok(actor);
  assert.deepEqual(
    Object.keys(actor).sort(),
    [...INSTRUCTOR_ACTOR_KEYS].sort(),
  );
  assert.equal("isActive" in actor, false);
});

// 3. valid active trainee → exactly { id, fullName }
test("valid active trainee session+row yields exactly { id, fullName }", () => {
  const actor = deriveTraineeActor(traineeSession(), traineeRow());
  assert.ok(actor);
  assert.equal(actor.id, TRAINEE_ID);
  assert.equal(actor.fullName, "Trainee Name");
  assert.deepEqual(Object.keys(actor).sort(), ["fullName", "id"]);
  assert.equal("isActive" in actor, false);
});

// 4. null session → null (both)
test("null session yields null for both derive functions", () => {
  assert.equal(deriveInstructorActor(null, instructorRow()), null);
  assert.equal(deriveTraineeActor(null, traineeRow()), null);
});

// 5. null row → null (both)
test("null row yields null for both derive functions", () => {
  assert.equal(deriveInstructorActor(instructorSession(), null), null);
  assert.equal(deriveTraineeActor(traineeSession(), null), null);
});

// 6. inactive row → null (both)
test("inactive row yields null for both derive functions", () => {
  assert.equal(
    deriveInstructorActor(
      instructorSession(),
      instructorRow({ isActive: false }),
    ),
    null,
  );
  assert.equal(
    deriveTraineeActor(traineeSession(), traineeRow({ isActive: false })),
    null,
  );
});

// 7. wrong audience → null
test("wrong audience yields null (instructor-derive on trainee session; trainee-derive on instructor session)", () => {
  assert.equal(
    deriveInstructorActor(
      instructorSession({ audience: "trainee" }),
      instructorRow(),
    ),
    null,
  );
  assert.equal(
    deriveTraineeActor(
      traineeSession({ audience: "instructor" }),
      traineeRow(),
    ),
    null,
  );
});

// 8. tablet audience → null for both
test("tablet audience yields null for both derive functions", () => {
  assert.equal(
    deriveInstructorActor(
      instructorSession({ audience: "tablet" }),
      instructorRow(),
    ),
    null,
  );
  assert.equal(
    deriveTraineeActor(
      traineeSession({ audience: "tablet" }),
      traineeRow(),
    ),
    null,
  );
});

// 9. subject-binding mismatch → null (both)
test("row.id not equal to session.subject yields null for both derive functions", () => {
  assert.equal(
    deriveInstructorActor(
      instructorSession(),
      instructorRow({ id: "someone-else" }),
    ),
    null,
  );
  assert.equal(
    deriveTraineeActor(traineeSession(), traineeRow({ id: "someone-else" })),
    null,
  );
});

// 10. totality: no input combination throws
test("derive functions are total (never throw) across the tested combinations", () => {
  assert.doesNotThrow(() => deriveInstructorActor(null, null));
  assert.doesNotThrow(() => deriveTraineeActor(null, null));
  assert.doesNotThrow(() =>
    deriveInstructorActor(instructorSession({ audience: "tablet" }), null),
  );
  assert.doesNotThrow(() =>
    deriveTraineeActor(traineeSession({ audience: "tablet" }), null),
  );
  assert.doesNotThrow(() =>
    deriveInstructorActor(
      instructorSession(),
      instructorRow({ isActive: false, id: "x" }),
    ),
  );
});
