/**
 * RS-SEC-1I-W - PURE, dependency-injected orchestration that binds the instructor
 * riding-lesson-note WRITE path to the server-derived actor identity.
 *
 * Like ./attendance-write-auth, ./horse-feeding-auth, and ./riding-slots-read-auth,
 * this is deliberately NOT a "use server" module: it is a plain server-side
 * library, so nothing here is registered as a Server Action. It carries the
 * testable orchestration (the session-actor gate + the canEditRidingNotes check +
 * delegation to the already-built note mutator) that the public server action in
 * ./riding-slots imports and wires to real dependencies (the canonical actor DAL
 * getCurrentInstructor + the existing validate-then-upsert note writer).
 *
 * NO runtime side effects at import time, and NO Prisma / next-cookies / next-
 * cache import: every impure capability (the session actor resolver, the note
 * mutator) is passed in via the *Deps interface. The only edge back to
 * ./riding-slots is erased `import type`s, so the type-only edge creates no
 * runtime circular import and pulls in neither next/headers nor Prisma.
 *
 * SECURITY CONTRACT (why this exists):
 *  - upsertRidingLessonNoteAsInstructor previously trusted a CLIENT-SUPPLIED
 *    instructorId: it re-read the instructor row by that id and evaluated
 *    canEditRidingNotes on it, so a caller could submit ANOTHER instructor's id
 *    to borrow that instructor's edit permission, and the persisted authorship
 *    (updatedByName) was that borrowed instructor's name.
 * The write now derives identity ONLY from the injected server-side actor
 * resolver (getCurrentInstructor), never from a client-supplied id. There is no
 * instructorId parameter. A missing/invalid/inactive/wrong-audience/subject-
 * mismatched session yields a null actor (the resolver returns null in every such
 * case) and the write is rejected WITHOUT invoking the note mutator. Authorship is
 * taken from the server-derived actor's fullName, never from client input.
 *
 * FAIL-CLOSED ON RESOLVER REJECTION: per the RS-SEC-1I-W contract, a THROWN actor
 * resolution (session/infra failure - e.g. a missing/weak SESSION_SECRET or a
 * Prisma error inside getCurrentInstructor) is caught around the actor resolution
 * ONLY and treated exactly like a null actor: the write returns the permission
 * error without touching the note mutator. The catch is scoped strictly to the
 * actor resolution so a genuine mutator error still propagates unchanged
 * (preserving current note-upsert database-error behaviour), and no internal
 * session/reason-code detail is surfaced.
 *
 * This stage binds WHO the instructor is and enforces the existing
 * canEditRidingNotes permission on that signed actor. It intentionally introduces
 * NO slot-assignment ownership, NO CourseOffering capability/membership, and does
 * NOT change note identity or upsert semantics (the note mutator's slot+student
 * upsert key is unchanged; instructor identity is not part of note uniqueness).
 */
import type { RidingLessonNoteInput, RidingLessonNoteActionResult } from "./riding-slots";

// Shared rejection contract - identical wording to the pre-existing instructor
// note write action so the UI-visible error is unchanged.
const NO_PERMISSION_ERROR = "אין הרשאה לערוך הערות הדרכת מתקדמים";

/** Actor fields the note write path consumes: the edit permission + authorship name. */
export interface InstructorRidingNoteWriteActor {
  canEditRidingNotes: boolean;
  fullName: string;
}

/**
 * Injectable dependencies for {@link upsertRidingLessonNoteWithDeps}.
 * `getCurrentInstructor` is the canonical server-side actor resolver (null for any
 * unauthenticated / invalid / inactive / wrong-audience / subject-mismatched
 * session); `writeNote` is the existing validate-then-upsert note mutator, which
 * receives the server-derived authorship name and returns the unchanged action
 * result.
 */
export interface RidingLessonNoteWriteDeps {
  getCurrentInstructor: () => Promise<InstructorRidingNoteWriteActor | null>;
  writeNote: (
    ridingSlotId: string,
    studentId: string,
    input: RidingLessonNoteInput,
    updatedByName: string,
  ) => Promise<RidingLessonNoteActionResult>;
}

/**
 * Gate an instructor riding-lesson-note upsert on a trustworthy server-derived
 * actor that holds canEditRidingNotes, THEN delegate to the unchanged note
 * mutator.
 *
 * Identity comes solely from deps.getCurrentInstructor(); there is no instructor
 * id parameter, so no client value can select or impersonate an instructor or
 * borrow another instructor's permission. A null actor (unauthenticated / invalid
 * / inactive / wrong-audience / subject-mismatched) OR an actor whose
 * canEditRidingNotes is false is rejected with the unchanged permission error and
 * the mutator is NEVER invoked - so no protected slot/student/note read, no
 * transaction, no mutation, and no revalidation occur on rejection (the denial
 * happens strictly before the mutation dependency). A THROWN actor resolution is
 * caught around the resolver ONLY and fails closed to the same permission error;
 * a genuine writeNote() error still propagates unchanged (it is outside the
 * catch). For an authorized actor the mutator runs exactly as before - it performs
 * the existing ridingSlotId / studentId / rating / taughtStudentIds validation and
 * the slot+student upsert - and authorship (updatedByName) is the actor's own
 * fullName, never a client value.
 *
 * ridingSlotId and studentId remain record selectors only (the target slot +
 * trainee), never actor identity.
 */
export async function upsertRidingLessonNoteWithDeps(
  deps: RidingLessonNoteWriteDeps,
  ridingSlotId: string,
  studentId: string,
  input: RidingLessonNoteInput,
): Promise<RidingLessonNoteActionResult> {
  let instructor: InstructorRidingNoteWriteActor | null;
  try {
    instructor = await deps.getCurrentInstructor();
  } catch {
    return { success: false, error: NO_PERMISSION_ERROR };
  }
  if (!instructor || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION_ERROR };
  }
  return deps.writeNote(ridingSlotId, studentId, input, instructor.fullName);
}
