/**
 * Pure actor-derivation decision logic for the Stage 0A-1c Actor DAL.
 *
 * PURE by construction: no next/headers, no Prisma, no environment access. It
 * takes an already-verified session (or null) and an already-fetched DB row (or
 * null) and decides whether a trustworthy actor exists. All IO lives in
 * ./actor.ts. This module performs NO permission allow/deny decisions.
 *
 * See COURSE-ARCHITECTURE-HANDOFF.md — Stage 0A / AUTH-BLOCKER-1/2.
 */

import type { VerifiedSession } from "./session-types";
import type {
  InstructorActor,
  InstructorActorRow,
  TraineeActor,
  TraineeActorRow,
} from "./actor-types";

/**
 * Derive an {@link InstructorActor} from a verified session and its DB row.
 *
 * Total function: never throws; returns null unless ALL hold:
 *  - session !== null
 *  - session.audience === "instructor"  (defensive audience check)
 *  - row !== null
 *  - row.isActive === true
 *  - row.id === session.subject  (defensive subject-binding check)
 *
 * On success returns ONLY the actor fields (id, fullName, nine can* flags),
 * mapped explicitly so `isActive` and any future row field cannot leak.
 */
export function deriveInstructorActor(
  session: VerifiedSession | null,
  row: InstructorActorRow | null,
): InstructorActor | null {
  if (session === null) {
    return null;
  }
  if (session.audience !== "instructor") {
    return null;
  }
  if (row === null) {
    return null;
  }
  if (row.isActive !== true) {
    return null;
  }
  if (row.id !== session.subject) {
    return null;
  }
  return {
    id: row.id,
    fullName: row.fullName,
    canEditHorseAssignments: row.canEditHorseAssignments,
    canSendMessages: row.canSendMessages,
    canEditAttendance: row.canEditAttendance,
    canEditRidingNotes: row.canEditRidingNotes,
    canEditHorseFeeding: row.canEditHorseFeeding,
    canManageTeachingPracticeAssignments:
      row.canManageTeachingPracticeAssignments,
    canManageTeachingPracticeHorses: row.canManageTeachingPracticeHorses,
    canEditTeachingPracticeFeedback: row.canEditTeachingPracticeFeedback,
    canManageChildSignatures: row.canManageChildSignatures,
  };
}

/**
 * Derive a {@link TraineeActor} from a verified session and its DB row.
 *
 * Total function: never throws; returns null unless ALL hold:
 *  - session !== null
 *  - session.audience === "trainee"  (defensive audience check)
 *  - row !== null
 *  - row.isActive === true
 *  - row.id === session.subject  (defensive subject-binding check)
 *
 * On success returns ONLY { id, fullName }, mapped explicitly so `isActive` and
 * any future row field cannot leak.
 */
export function deriveTraineeActor(
  session: VerifiedSession | null,
  row: TraineeActorRow | null,
): TraineeActor | null {
  if (session === null) {
    return null;
  }
  if (session.audience !== "trainee") {
    return null;
  }
  if (row === null) {
    return null;
  }
  if (row.isActive !== true) {
    return null;
  }
  if (row.id !== session.subject) {
    return null;
  }
  return {
    id: row.id,
    fullName: row.fullName,
  };
}
