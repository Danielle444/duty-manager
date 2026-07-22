/**
 * ATT-SEC-2 - PURE, dependency-injected orchestration that binds the two
 * instructor attendance WRITE paths to the server-derived actor identity.
 *
 * Like ./attendance-read-auth, this is deliberately NOT a "use server" module:
 * it is a plain server-side library, so nothing here is registered as a Server
 * Action. It carries the testable orchestration (server-actor gate +
 * canEditAttendance check + delegation to the already-built mutator) that the
 * public server actions in ./attendance import and wire to real dependencies
 * (the canonical actor DAL getCurrentInstructor + the existing Prisma
 * upsert/delete). Same split-of-concerns convention as ./attendance-read-auth.
 *
 * NO runtime side effects at import time, and NO Prisma / next-cookies / next-
 * cache import: every impure capability (the session actor resolver, the record
 * mutators) is passed in via the *Deps interfaces. The only edges back to
 * ./attendance and ./students are erased `import type`s, so the type-only edge
 * creates no runtime circular import and pulls in neither next/headers nor
 * Prisma.
 *
 * SECURITY CONTRACT (why this exists):
 *  - Both instructor write actions previously trusted a CLIENT-SUPPLIED
 *    instructorId: they re-read the instructor row by that id and evaluated
 *    canEditAttendance on it. A caller could therefore submit ANOTHER
 *    instructor's id to borrow that instructor's edit permission, and the
 *    persisted authorship (updatedByName) was that borrowed instructor's name.
 *  - Both now derive identity ONLY from the injected server-side actor resolver
 *    (getCurrentInstructor), never from a client-supplied id. There is no
 *    instructorId parameter. A missing/invalid/inactive/wrong-audience/subject-
 *    mismatched session yields a null actor (the resolver returns null in every
 *    such case) and the write is rejected WITHOUT invoking the mutator. An
 *    authenticated instructor whose canEditAttendance is false is likewise
 *    rejected before any mutation. Authorship is taken from the server-derived
 *    actor's fullName, never from client input.
 *
 * This stage protects WHO the instructor is and whether that instructor holds
 * the existing canEditAttendance permission.
 *
 * ATT-3W EXTENSION: both write paths now carry an ADDITIONAL, later-ordered
 * authorization condition — the current CourseOffering's ATTENDANCE capability
 * must permit writes (canWrite === true). It is injected as
 * `resolveAttendanceAccess` (a parameterless server-owned resolver whose real
 * wiring is resolveCurrentAttendanceCapabilityAccess). It is a STRICT ADDITION:
 * it runs ONLY AFTER the existing actor + canEditAttendance checks pass, so it
 * never replaces or weakens them and is never consulted for a missing/invalid
 * actor or an actor lacking canEditAttendance (that avoids needless capability
 * work and guarantees the capability can never open an actor-level denial).
 * READ_ONLY / DISABLED / any denied capability result yields the SAME unchanged
 * permission error and the mutator is NEVER invoked; a resolver rejection
 * (missing/ambiguous offering, or infrastructure failure) propagates unchanged
 * and is never converted into allowed access.
 */
import type { AttendanceInput, AttendanceActionResult } from "./attendance";
import type { ActionResult } from "./students";
import type { AttendanceCapabilityAccess } from "@/lib/course/capabilities/attendance-capability-policy-core";

// The minimal server-derived actor shape each write path needs. Both are
// structural subsets of InstructorActor (from lib/auth/actor-types), so the
// canonical getCurrentInstructor resolver satisfies them directly - kept inline
// here so this pure module needs no import from the actor DAL layer.

/** Actor fields the upsert path consumes: the edit permission + authorship name. */
export interface InstructorAttendanceWriteActor {
  canEditAttendance: boolean;
  fullName: string;
}

/** Actor fields the clear path consumes: the edit permission only (no authorship). */
export interface InstructorAttendanceClearActor {
  canEditAttendance: boolean;
}

// Shared rejection contract - identical wording to the pre-existing instructor
// write actions so the UI-visible error is unchanged.
const NO_PERMISSION_ERROR = "אין הרשאה לערוך נוכחות";

// --- instructor attendance upsert -------------------------------------------

/**
 * Injectable dependencies for {@link upsertInstructorAttendanceWithDeps}.
 * `getCurrentInstructor` is the canonical server-side actor resolver (null for
 * any unauthenticated / invalid / inactive / wrong-audience session);
 * `upsertRecord` is the existing validate-then-persist mutator, which receives
 * the server-derived authorship name and returns the unchanged action result.
 */
export interface InstructorAttendanceUpsertDeps {
  getCurrentInstructor: () => Promise<InstructorAttendanceWriteActor | null>;
  /**
   * ATT-3W: parameterless, server-owned current-offering ATTENDANCE capability
   * resolver (real wiring: resolveCurrentAttendanceCapabilityAccess). Called
   * ONLY after the actor + canEditAttendance checks pass; a rejection (missing/
   * ambiguous offering or infrastructure failure) propagates and is never
   * converted into allowed access.
   */
  resolveAttendanceAccess: () => Promise<AttendanceCapabilityAccess>;
  upsertRecord: (
    input: AttendanceInput,
    updatedByName: string,
  ) => Promise<AttendanceActionResult>;
}

/**
 * Gate an instructor attendance upsert on a trustworthy server-derived actor
 * that holds canEditAttendance, THEN delegate to the unchanged mutator.
 *
 * Identity comes solely from deps.getCurrentInstructor(); there is no instructor
 * id parameter, so no client value can select or impersonate an instructor. A
 * null actor (unauthenticated / invalid / inactive / wrong-audience) OR an actor
 * whose canEditAttendance is false is rejected with the unchanged permission
 * error and the mutator is NEVER invoked (so no DB write and no input
 * validation side effects occur on rejection), and the capability resolver is
 * NOT consulted (it can never open an actor-level denial).
 *
 * ATT-3W: only AFTER those actor checks pass is deps.resolveAttendanceAccess()
 * called; the current CourseOffering's ATTENDANCE capability must yield
 * canWrite === true. READ_ONLY / DISABLED / any denied capability result is
 * rejected with the SAME unchanged permission error and the mutator is NEVER
 * invoked; a resolver rejection propagates unchanged (never permissive). For an
 * authorized actor whose offering permits writes the mutator runs exactly as
 * before - it performs the existing payload validation and upsert - and
 * authorship (updatedByName) is the actor's own fullName, never a client value.
 */
export async function upsertInstructorAttendanceWithDeps(
  deps: InstructorAttendanceUpsertDeps,
  input: AttendanceInput,
): Promise<AttendanceActionResult> {
  const instructor = await deps.getCurrentInstructor();
  if (!instructor || !instructor.canEditAttendance) {
    return { success: false, error: NO_PERMISSION_ERROR };
  }
  const access = await deps.resolveAttendanceAccess();
  if (!access.canWrite) {
    return { success: false, error: NO_PERMISSION_ERROR };
  }
  return deps.upsertRecord(input, instructor.fullName);
}

// --- instructor attendance clear --------------------------------------------

/**
 * Injectable dependencies for {@link clearInstructorAttendanceWithDeps}.
 * `getCurrentInstructor` is the canonical server-side actor resolver;
 * `clearRecord` is the existing delete-then-revalidate mutator (no authorship).
 */
export interface InstructorAttendanceClearDeps {
  getCurrentInstructor: () => Promise<InstructorAttendanceClearActor | null>;
  /**
   * ATT-3W: parameterless, server-owned current-offering ATTENDANCE capability
   * resolver (real wiring: resolveCurrentAttendanceCapabilityAccess). Called
   * ONLY after the actor + canEditAttendance checks pass; a rejection (missing/
   * ambiguous offering or infrastructure failure) propagates and is never
   * converted into allowed access.
   */
  resolveAttendanceAccess: () => Promise<AttendanceCapabilityAccess>;
  clearRecord: (
    studentId: string,
    dateKeyStr: string,
  ) => Promise<ActionResult>;
}

/**
 * Gate an instructor attendance clear on a trustworthy server-derived actor that
 * holds canEditAttendance, THEN delegate to the unchanged mutator.
 *
 * Identity comes solely from deps.getCurrentInstructor(); there is no instructor
 * id parameter. A null actor OR an actor whose canEditAttendance is false is
 * rejected with the unchanged permission error and the mutator is NEVER invoked
 * (no DB delete), and the capability resolver is NOT consulted.
 *
 * ATT-3W: only AFTER those actor checks pass is deps.resolveAttendanceAccess()
 * called; the current CourseOffering's ATTENDANCE capability must yield
 * canWrite === true. READ_ONLY / DISABLED / any denied capability result is
 * rejected with the SAME unchanged permission error and the mutator is NEVER
 * invoked; a resolver rejection propagates unchanged (never permissive). For an
 * authorized actor whose offering permits writes the mutator runs exactly as
 * before, receiving the client-supplied target studentId + dateKey unchanged
 * (the target of the authorized operation, not actor identity).
 */
export async function clearInstructorAttendanceWithDeps(
  deps: InstructorAttendanceClearDeps,
  studentId: string,
  dateKeyStr: string,
): Promise<ActionResult> {
  const instructor = await deps.getCurrentInstructor();
  if (!instructor || !instructor.canEditAttendance) {
    return { success: false, error: NO_PERMISSION_ERROR };
  }
  const access = await deps.resolveAttendanceAccess();
  if (!access.canWrite) {
    return { success: false, error: NO_PERMISSION_ERROR };
  }
  return deps.clearRecord(studentId, dateKeyStr);
}
