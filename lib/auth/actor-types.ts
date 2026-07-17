/**
 * Actor type contract for the Stage 0A-1c Actor DAL.
 *
 * These are PURE types: this module imports nothing from next/headers, Prisma,
 * or the environment. It describes the server-derived actor identity that later
 * stages will read from the signed session — never from client-supplied
 * studentId/instructorId (AUTH-BLOCKER-1/2). See COURSE-ARCHITECTURE-HANDOFF.md
 * — Stage 0A.
 *
 * The *Actor interfaces are the ONLY shapes callers should receive. The
 * *ActorRow interfaces are the exact DB select projections (they additionally
 * carry `isActive`, used only for the internal active-check) and must never be
 * returned to callers.
 */

/**
 * Server-derived instructor actor.
 *
 * D1 — the nine `can*` flags below remain AUTHORITATIVE for current application
 * behavior until their separately approved behavioral authorization cutover
 * (behavioral `can*` authorization-fallback removal, which precedes L2
 * activation; see COURSE-ARCHITECTURE-HANDOFF.md Part 2). They are carried here
 * because current app behavior still depends on them; they are NOT the future
 * offering-aware authorization model (session + CourseInstructorAssignment +
 * role permissions + CourseOffering capabilities + lifecycle + resource-offering
 * ownership). This DAL performs NO permission allow/deny decisions — it only
 * derives trustworthy actor identity plus these still-authoritative flags.
 */
export interface InstructorActor {
  id: string;
  fullName: string;
  /** D1: authoritative for current behavior until the behavioral cutover; not the future authz model. */
  canEditHorseAssignments: boolean;
  /** D1: authoritative for current behavior until the behavioral cutover; not the future authz model. */
  canSendMessages: boolean;
  /** D1: authoritative for current behavior until the behavioral cutover; not the future authz model. */
  canEditAttendance: boolean;
  /** D1: authoritative for current behavior until the behavioral cutover; not the future authz model. */
  canEditRidingNotes: boolean;
  /** D1: authoritative for current behavior until the behavioral cutover; not the future authz model. */
  canEditHorseFeeding: boolean;
  /** D1: authoritative for current behavior until the behavioral cutover; not the future authz model. */
  canManageTeachingPracticeAssignments: boolean;
  /** D1: authoritative for current behavior until the behavioral cutover; not the future authz model. */
  canManageTeachingPracticeHorses: boolean;
  /** D1: authoritative for current behavior until the behavioral cutover; not the future authz model. */
  canEditTeachingPracticeFeedback: boolean;
  /** D1: authoritative for current behavior until the behavioral cutover; not the future authz model. */
  canManageChildSignatures: boolean;
}

/** Server-derived trainee actor. Identity only — no capability/authorization data. */
export interface TraineeActor {
  id: string;
  fullName: string;
}

/**
 * Exact DB select projection for an instructor actor: all {@link InstructorActor}
 * fields PLUS `isActive`. `isActive` is used only for the internal active-check
 * in the pure derive logic and is NEVER included in the returned actor.
 */
export interface InstructorActorRow {
  id: string;
  fullName: string;
  isActive: boolean;
  canEditHorseAssignments: boolean;
  canSendMessages: boolean;
  canEditAttendance: boolean;
  canEditRidingNotes: boolean;
  canEditHorseFeeding: boolean;
  canManageTeachingPracticeAssignments: boolean;
  canManageTeachingPracticeHorses: boolean;
  canEditTeachingPracticeFeedback: boolean;
  canManageChildSignatures: boolean;
}

/**
 * Exact DB select projection for a trainee actor: {@link TraineeActor} fields
 * PLUS `isActive`. `isActive` is used only for the internal active-check and is
 * NEVER included in the returned actor.
 */
export interface TraineeActorRow {
  id: string;
  fullName: string;
  isActive: boolean;
}

/**
 * Thrown by the require* DAL functions when no trustworthy server-derived actor
 * exists (no/expired/invalid session, missing/inactive row, or subject-binding
 * mismatch). Callers translate this into their own 401/redirect handling; the
 * DAL itself makes no routing decision.
 */
export class UnauthenticatedActorError extends Error {
  constructor(message = "No authenticated actor") {
    super(message);
    this.name = "UnauthenticatedActorError";
  }
}
