/**
 * RS-SEC-1I-W - focused behavioral tests for the session-bound instructor
 * riding-lesson-note WRITE orchestration (lib/actions/riding-slots-write-auth.ts).
 *
 * These exercise the dependency-injected orchestration with plain fakes, so no
 * Next.js cookies and no live Prisma are needed. They lock the RS-SEC-1I-W
 * contract:
 *  - the note write derives identity + permission + authorship ONLY from the
 *    server actor; a null actor, an actor without canEditRidingNotes, or a thrown
 *    resolution is rejected BEFORE the note mutator runs;
 *  - there is no instructor-id parameter a client could supply to select another
 *    actor, borrow a permission, or choose updatedByName;
 *  - authorship (updatedByName) is the signed actor's fullName;
 *  - the authorized path forwards ridingSlotId / studentId / the full
 *    RidingLessonNoteInput unchanged (upsert identity + validation preserved);
 *  - a genuine mutator error is NOT converted into an authorization denial.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/riding-slots-write-auth.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  upsertRidingLessonNoteWithDeps,
  type RidingLessonNoteWriteDeps,
} from "./riding-slots-write-auth";
import type { RidingLessonNoteInput } from "./riding-slots";

const NO_PERMISSION_ERROR = "אין הרשאה לערוך הערות הדרכת מתקדמים";

// A representative full payload. Its content is never inspected by the
// orchestration under test (validation lives in the real mutator), so the exact
// values only matter for the "forwarded unchanged" assertions.
function samplePayload(): RidingLessonNoteInput {
  return {
    note: "good seat",
    ratingHalfPoints: 8,
    sessionHorseName: "Rakia",
    lessonTopic: "trot transitions",
    taughtStudentIds: ["stud-a", "stud-b"],
  };
}

// A writeNote that records what it received and reports success.
function recordingWriteNote() {
  const calls: {
    ridingSlotId: string;
    studentId: string;
    input: RidingLessonNoteInput;
    updatedByName: string;
  }[] = [];
  const writeNote: RidingLessonNoteWriteDeps["writeNote"] = async (
    ridingSlotId,
    studentId,
    input,
    updatedByName,
  ) => {
    calls.push({ ridingSlotId, studentId, input, updatedByName });
    return { success: true, updatedByName, updatedAt: "2026-07-22T00:00:00.000Z" };
  };
  return { calls, writeNote };
}

// A writeNote that MUST NOT be reached on denial paths.
const mutatorThatMustNotRun: RidingLessonNoteWriteDeps["writeNote"] = async () => {
  throw new Error("note mutator must not run after an authorization denial");
};

// ===========================================================================
// Authorized
// ===========================================================================

test("authorized active instructor with canEditRidingNotes writes; authorship = signed actor", async () => {
  const { calls, writeNote } = recordingWriteNote();
  const deps: RidingLessonNoteWriteDeps = {
    getCurrentInstructor: async () => ({ canEditRidingNotes: true, fullName: "Dana Instructor" }),
    writeNote,
  };
  const payload = samplePayload();
  const result = await upsertRidingLessonNoteWithDeps(deps, "slot-1", "stud-9", payload);
  assert.deepEqual(result, {
    success: true,
    updatedByName: "Dana Instructor",
    updatedAt: "2026-07-22T00:00:00.000Z",
  });
  assert.equal(calls.length, 1, "mutator runs exactly once for an authorized instructor");
  assert.equal(calls[0].updatedByName, "Dana Instructor", "updatedByName is the signed actor's fullName");
});

test("authorized path forwards ridingSlotId, studentId and the full input unchanged (upsert identity + validation preserved)", async () => {
  const { calls, writeNote } = recordingWriteNote();
  const deps: RidingLessonNoteWriteDeps = {
    getCurrentInstructor: async () => ({ canEditRidingNotes: true, fullName: "Dana" }),
    writeNote,
  };
  const payload = samplePayload();
  await upsertRidingLessonNoteWithDeps(deps, "slot-77", "stud-42", payload);
  assert.equal(calls[0].ridingSlotId, "slot-77", "ridingSlotId is the target selector, forwarded");
  assert.equal(calls[0].studentId, "stud-42", "studentId is the target selector, forwarded");
  assert.equal(calls[0].input, payload, "the exact RidingLessonNoteInput is forwarded to the mutator");
  assert.equal(calls[0].input.ratingHalfPoints, 8);
  assert.equal(calls[0].input.note, "good seat");
  assert.equal(calls[0].input.sessionHorseName, "Rakia");
  assert.equal(calls[0].input.lessonTopic, "trot transitions");
  assert.deepEqual(calls[0].input.taughtStudentIds, ["stud-a", "stud-b"]);
});

// ===========================================================================
// Denial paths (mutator must never run)
// ===========================================================================

test("signed instructor WITHOUT canEditRidingNotes is denied; mutator does not run", async () => {
  const deps: RidingLessonNoteWriteDeps = {
    getCurrentInstructor: async () => ({ canEditRidingNotes: false, fullName: "No Perm" }),
    writeNote: mutatorThatMustNotRun,
  };
  const result = await upsertRidingLessonNoteWithDeps(deps, "slot", "stud", samplePayload());
  assert.deepEqual(result, { success: false, error: NO_PERMISSION_ERROR });
});

test("unauthenticated (null actor) is denied; mutator does not run", async () => {
  let calls = 0;
  const deps: RidingLessonNoteWriteDeps = {
    getCurrentInstructor: async () => null,
    writeNote: async () => {
      calls++;
      return { success: true };
    },
  };
  const result = await upsertRidingLessonNoteWithDeps(deps, "slot", "stud", samplePayload());
  assert.deepEqual(result, { success: false, error: NO_PERMISSION_ERROR });
  assert.equal(calls, 0, "mutator must NOT run for a null actor");
});

test("trainee / wrong-role / missing / inactive actor all resolve to null -> denied, mutator does not run", async () => {
  // getCurrentInstructor returns null in every such case (wrong audience,
  // missing/deleted row, inactive row, subject mismatch); one null case proves
  // the whole class fails closed without mutating.
  const deps: RidingLessonNoteWriteDeps = {
    getCurrentInstructor: async () => null,
    writeNote: mutatorThatMustNotRun,
  };
  const result = await upsertRidingLessonNoteWithDeps(deps, "slot", "stud", samplePayload());
  assert.equal(result.success, false);
});

test("actor-resolution rejection fails closed; mutator does not run", async () => {
  const deps: RidingLessonNoteWriteDeps = {
    getCurrentInstructor: async () => {
      throw new Error("session/infra failure");
    },
    writeNote: mutatorThatMustNotRun,
  };
  const result = await upsertRidingLessonNoteWithDeps(deps, "slot", "stud", samplePayload());
  assert.deepEqual(result, { success: false, error: NO_PERMISSION_ERROR });
});

test("permission-infrastructure failure (resolver throws) fails closed to the permission error", async () => {
  // Same fail-closed contract: any throw while resolving/authorizing the actor
  // yields the permission error, never an allowed write.
  const deps: RidingLessonNoteWriteDeps = {
    getCurrentInstructor: async () => {
      throw new Error("permission resolution failed");
    },
    writeNote: mutatorThatMustNotRun,
  };
  const result = await upsertRidingLessonNoteWithDeps(deps, "slot", "stud", samplePayload());
  assert.equal(result.success, false);
  assert.equal(result.error, NO_PERMISSION_ERROR);
});

test("denial happens strictly before the mutator dependency across every denial path", async () => {
  const denialActors = [
    null,
    { canEditRidingNotes: false, fullName: "x" },
  ] as const;
  for (const actor of denialActors) {
    const result = await upsertRidingLessonNoteWithDeps(
      { getCurrentInstructor: async () => actor, writeNote: mutatorThatMustNotRun },
      "slot",
      "stud",
      samplePayload(),
    );
    assert.equal(result.success, false, "every denial returns a failure without reaching the mutator");
  }
});

// ===========================================================================
// No client-selected identity; authorship cannot be chosen
// ===========================================================================

test("no client-selected instructor identity participates in the contract (arity)", () => {
  // Arity guard (secondary evidence): the orchestration takes deps + the two
  // record selectors + the input - there is NO positional instructor-id slot.
  assert.equal(
    upsertRidingLessonNoteWithDeps.length,
    4,
    "deps + ridingSlotId + studentId + input only - no client instructor id",
  );
});

test("another instructor's permission cannot be consumed and another name cannot be used for updatedByName", async () => {
  // The ONLY source of both permission and authorship is the server actor. There
  // is no parameter through which a caller could name a different permissioned
  // instructor or a different updatedByName - the mutator always receives the
  // resolver's own fullName.
  const { calls, writeNote } = recordingWriteNote();
  const deps: RidingLessonNoteWriteDeps = {
    getCurrentInstructor: async () => ({ canEditRidingNotes: true, fullName: "Signed Actor" }),
    writeNote,
  };
  await upsertRidingLessonNoteWithDeps(deps, "slot", "stud", samplePayload());
  assert.equal(calls[0].updatedByName, "Signed Actor", "updatedByName can only be the signed actor's name");
});

// ===========================================================================
// Authorized failures propagate (not converted into denial)
// ===========================================================================

test("an authorized mutator/database error propagates (not converted into an authorization denial)", async () => {
  const deps: RidingLessonNoteWriteDeps = {
    getCurrentInstructor: async () => ({ canEditRidingNotes: true, fullName: "Dana" }),
    writeNote: async () => {
      throw new Error("db transaction failed");
    },
  };
  await assert.rejects(
    () => upsertRidingLessonNoteWithDeps(deps, "slot", "stud", samplePayload()),
    /db transaction failed/,
    "a real mutator failure is not swallowed into a {success:false} authorization denial",
  );
});

test("riding-slots-write-auth is a pure orchestration (no prisma / next / use-server)", () => {
  const src = readFileSync(fileURLToPath(new URL("./riding-slots-write-auth.ts", import.meta.url)), "utf8");
  assert.ok(!/^\s*["']use server["']\s*;?\s*$/m.test(src), "must not be a Server Action module");
  assert.ok(!/from ["']@\/lib\/prisma["']/.test(src), "must not import prisma");
  assert.ok(!/from ["']next\/(headers|cache)["']/.test(src), "must not import next/headers or next/cache");
});

// ===========================================================================
// Wiring assertion (SECONDARY evidence).
// The behavioral DI tests above are the primary proof. This source check only
// confirms the public "use server" action is wired to the gate and that its
// signature no longer carries a client instructorId (it can't be imported here -
// it transitively pulls in Prisma / next). Same convention as
// attendance-write-auth.test.ts's source assertion.
// ===========================================================================

test("wiring: the public note writer delegates to the gate and drops the client instructorId", () => {
  const src = readFileSync(fileURLToPath(new URL("./riding-slots.ts", import.meta.url)), "utf8");
  assert.match(src, /upsertRidingLessonNoteWithDeps/, "the action must delegate to the session-bound gate");
  assert.match(
    src,
    /export async function upsertRidingLessonNoteAsInstructor\(\s*ridingSlotId: string,\s*studentId: string,\s*input: RidingLessonNoteInput\s*\)/,
    "the public signature must be (ridingSlotId, studentId, input) - no instructorId",
  );
  // The private mutator must NOT re-read an instructor row by a client id.
  const bodyStart = src.indexOf("async function writeRidingLessonNote(");
  const bodyEnd = src.indexOf("export async function upsertRidingLessonNoteAsInstructor(");
  const body = src.slice(bodyStart, bodyEnd);
  assert.ok(
    !/prisma\.instructor\.findUnique/.test(body),
    "the note mutator must not look up an instructor row (identity comes from the signed session)",
  );
});
