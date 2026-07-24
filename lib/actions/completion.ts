"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { ActionResult } from "@/lib/actions/students";
// SECURITY / LEVEL 2 SLICE L2-C3 - server-derived trainee identity + DUTIES
// capability gate for the trainee-facing markDutyCompleted below.
// adminSetCompletion is untouched and keeps its own requireAdmin() gate.
import { requireCurrentTrainee } from "@/lib/auth/actor";
import { resolveTraineeCourseOffering } from "@/lib/course/actor-course-offering";
import { getEffectiveCapabilities } from "@/lib/course/capabilities/offering-capabilities";
import type { CapabilityKey } from "@/lib/course/capabilities/capability-keys";
import {
  authorizeTraineeModuleWithDeps,
  type TraineeModuleContextDeps,
} from "@/lib/course/trainee-module-containment-core";

/**
 * The single capability that authorizes trainee duty completion (L2-C3). An
 * EXISTING canonical key (capability-keys.ts); the CapabilityKey annotation
 * makes a typo a compile error. Deliberately the same key the trainee duty
 * READER uses (lib/actions/student-schedule.ts) - reading and completing a duty
 * are one module.
 */
const TRAINEE_DUTIES_CAPABILITY_KEY: CapabilityKey = "DUTIES";

// Real, server-owned dependencies only: the trainee id from the signed session
// via the canonical Actor DAL (requireCurrentTrainee rejects anonymous,
// expired, wrong-audience and INACTIVE sessions), the offering from the
// committed no-argument resolveTraineeCourseOffering(), and that exact
// offering's capabilities. No courseOfferingId parameter, no legacy singleton
// offering resolver, no Level 1 fallback, no inference.
const TRAINEE_DUTIES_DEPS: TraineeModuleContextDeps = {
  requireTraineeId: async () => (await requireCurrentTrainee()).id,
  resolveTraineeCourseOffering,
  getEffectiveCapabilities,
};

// SECURITY / LEVEL 2 SLICE L2-C3 - CONTAINED. This action previously accepted
// the trainee identity from the client: any caller who knew (or guessed) an
// assignment id plus the matching student id - both obtainable without a
// session, since the login-screen search is unauthenticated - could mark
// another trainee's duty complete. Identity is now session-derived and the
// resolved offering's DUTIES capability must be positively ENABLED. Every
// denial returns the SAME "not found" failure as a genuinely missing,
// unpublished or someone-else's assignment, so no assignment id can be probed
// for existence, and nothing is mutated. The studentId parameter is retained
// for caller compatibility and deliberately discarded; it is never identity.
export async function markDutyCompleted(
  assignmentId: string,
  studentId: string
): Promise<ActionResult> {
  void studentId;
  const authorization = await authorizeTraineeModuleWithDeps(
    TRAINEE_DUTIES_CAPABILITY_KEY,
    TRAINEE_DUTIES_DEPS
  );
  if (!authorization.authorized) {
    return { success: false, error: "השיבוץ לא נמצא" };
  }
  const traineeId = authorization.context.traineeId;

  const assignment = await prisma.dutyAssignment.findUnique({
    where: { id: assignmentId },
  });
  // The pre-existing isPublished guard is preserved, not replaced - ownership
  // is now compared against the SESSION-derived trainee id.
  if (!assignment || assignment.studentId !== traineeId || !assignment.isPublished) {
    return { success: false, error: "השיבוץ לא נמצא" };
  }

  await prisma.dutyAssignment.update({
    where: { id: assignmentId },
    data: { isCompleted: true, completedAt: new Date() },
  });

  revalidatePath("/admin/completion");
  revalidatePath("/student");
  return { success: true };
}

export async function adminSetCompletion(
  assignmentId: string,
  isCompleted: boolean
): Promise<ActionResult> {
  await requireAdmin();
  await prisma.dutyAssignment.update({
    where: { id: assignmentId },
    data: { isCompleted, completedAt: isCompleted ? new Date() : null },
  });

  revalidatePath("/admin/completion");
  revalidatePath("/student");
  return { success: true };
}
