/**
 * Server-only Actor DAL (Stage 0A-1c) — thin IO glue (D4).
 *
 * SERVER-ONLY BY CONSTRUCTION: this module transitively imports next/headers via
 * ./session (readSessionCookie), which cannot be bundled into client code.
 * Following the repo convention, the `server-only` package is not imported.
 *
 * Responsibility is intentionally minimal: read the verified session cookie for
 * a hardcoded audience, fetch an allowlisted DB row by the session subject, and
 * delegate the actual decision to the PURE ./actor-core functions. No caching,
 * no module-level state, no redirect, no routing. Prisma/infra errors propagate
 * (never converted to null). This DAL makes NO permission allow/deny decisions.
 *
 * It is UN-WIRED in Stage 0A-1c: no existing file imports it. See
 * COURSE-ARCHITECTURE-HANDOFF.md — Stage 0A / AUTH-BLOCKER-1/2.
 */

import { readSessionCookie } from "./session";
import { prisma } from "@/lib/prisma";
import { deriveInstructorActor, deriveTraineeActor } from "./actor-core";
import {
  UnauthenticatedActorError,
  type InstructorActor,
  type TraineeActor,
} from "./actor-types";

/**
 * Derive the current instructor actor from the signed session, or null.
 *
 * Returns null without a DB call when there is no valid session. Otherwise
 * fetches the allowlisted instructor row by the session subject and delegates to
 * the pure {@link deriveInstructorActor}.
 */
export async function getCurrentInstructor(): Promise<InstructorActor | null> {
  const session = await readSessionCookie("instructor");
  if (session === null) {
    return null;
  }
  const row = await prisma.instructor.findUnique({
    where: { id: session.subject },
    select: {
      id: true,
      fullName: true,
      isActive: true,
      canEditHorseAssignments: true,
      canSendMessages: true,
      canEditAttendance: true,
      canEditRidingNotes: true,
      canEditHorseFeeding: true,
      canManageTeachingPracticeAssignments: true,
      canManageTeachingPracticeHorses: true,
      canEditTeachingPracticeFeedback: true,
      canManageChildSignatures: true,
    },
  });
  return deriveInstructorActor(session, row);
}

/**
 * Derive the current trainee actor from the signed session, or null.
 *
 * Returns null without a DB call when there is no valid session. Otherwise
 * fetches the allowlisted student row by the session subject and delegates to
 * the pure {@link deriveTraineeActor}.
 */
export async function getCurrentTrainee(): Promise<TraineeActor | null> {
  const session = await readSessionCookie("trainee");
  if (session === null) {
    return null;
  }
  const row = await prisma.student.findUnique({
    where: { id: session.subject },
    select: {
      id: true,
      fullName: true,
      isActive: true,
    },
  });
  return deriveTraineeActor(session, row);
}

/**
 * Like {@link getCurrentInstructor} but throws {@link UnauthenticatedActorError}
 * when no trustworthy instructor actor exists.
 */
export async function requireCurrentInstructor(): Promise<InstructorActor> {
  const actor = await getCurrentInstructor();
  if (actor === null) {
    throw new UnauthenticatedActorError("No authenticated instructor");
  }
  return actor;
}

/**
 * Like {@link getCurrentTrainee} but throws {@link UnauthenticatedActorError}
 * when no trustworthy trainee actor exists.
 */
export async function requireCurrentTrainee(): Promise<TraineeActor> {
  const actor = await getCurrentTrainee();
  if (actor === null) {
    throw new UnauthenticatedActorError("No authenticated trainee");
  }
  return actor;
}
