/**
 * URGENT LEVEL 2 ACCESS - SLICE L2-0: server-side IO bindings for ACTOR-AWARE
 * course offering resolution.
 *
 * SERVER-ONLY BY CONSTRUCTION: transitively imports next/headers via the Actor
 * DAL (@/lib/auth/actor), which cannot be bundled into client code. Following
 * the repo convention the `server-only` package is not imported.
 *
 * These are THIN bindings by design: every decision (cardinality, status gating,
 * explicit-id authorization, existence verification) lives in the PURE core
 * (actor-course-offering-core.ts), which is where the DB-free tests exercise the
 * query shapes and the failure contract. This file only supplies the real
 * session reader, the real temporary policy, and the real Prisma queries.
 *
 * The actor is ALWAYS derived server-side from the signed session. The trainee
 * resolver takes NO arguments at all. The instructor resolver takes ONLY an
 * explicit courseOfferingId, which is authorized server-side against the
 * temporary policy - it is a request, never a grant. No client-supplied student
 * or instructor id is trusted or even accepted, and nothing about the login,
 * session or cookie format changes.
 *
 * UN-WIRED IN THIS SLICE: no existing schedule, contact, navigation or UI reader
 * imports this module yet. Migrating those call sites is a later slice.
 */
import { prisma } from "@/lib/prisma";
import { requireCurrentTrainee, requireCurrentInstructor } from "@/lib/auth/actor";
import {
  resolveTraineeCourseOfferingWithDeps,
  resolveInstructorCourseOfferingWithDeps,
} from "./actor-course-offering-core";
import type { CurrentCourseOffering } from "./current-offering-core";
import type { CourseOfferingView } from "./offering-by-id-core";
import { isInstructorAllowedCourseOfferingId } from "./temporary-level2-compatibility";

export {
  NoTraineeCourseOfferingError,
  AmbiguousTraineeCourseOfferingError,
  MissingInstructorCourseOfferingIdError,
  InstructorCourseOfferingNotAllowedError,
  InstructorCourseOfferingUnavailableError,
  resolveTraineeCourseOfferingWithDeps,
  resolveInstructorCourseOfferingWithDeps,
  type TraineeEnrollmentOfferingRow,
  type TraineeEnrollmentQuery,
  type TraineeCourseOfferingDeps,
  type InstructorCourseOfferingDeps,
} from "./actor-course-offering-core";

/** The exact offering columns every actor-aware fetch projects. */
const OFFERING_SELECT = {
  id: true,
  activityYearId: true,
  name: true,
  level: true,
  startDate: true,
  endDate: true,
  status: true,
} as const;

/**
 * Resolve the authenticated trainee's course offering through the signed
 * session and the shared Prisma client. Takes no arguments: the student id comes
 * from the session, never from the caller.
 */
export async function resolveTraineeCourseOffering(): Promise<CurrentCourseOffering> {
  return resolveTraineeCourseOfferingWithDeps({
    requireTraineeId: async () => (await requireCurrentTrainee()).id,
    fetchTraineeEnrollmentRows: async ({ take, where }) => {
      const rows = await prisma.courseEnrollment.findMany({
        take,
        where,
        select: {
          id: true,
          status: true,
          courseOffering: { select: OFFERING_SELECT },
        },
      });
      return rows.map((r) => ({
        enrollmentId: r.id,
        enrollmentStatus: r.status,
        offering: r.courseOffering,
      }));
    },
  });
}

/**
 * Authorize and resolve an EXPLICITLY REQUESTED course offering for the
 * authenticated instructor.
 *
 * requireCurrentInstructor() supplies the audience gate - it throws for an
 * anonymous, wrong-audience, invalid-session or INACTIVE instructor, which is
 * how inactive instructors stay denied without any new logic. Its result is
 * discarded on purpose: no instructor identity influences the decision. The
 * requested id is then checked against the temporary allowed-offerings policy
 * and verified to exist.
 *
 * Returning an offering here means ONLY "this course context is addressable by
 * an instructor". It grants no module: a Level 1 global module must not become
 * reachable in a Level 2 context on the strength of this call.
 */
export async function resolveInstructorCourseOffering(
  requestedCourseOfferingId: string,
): Promise<CourseOfferingView> {
  return resolveInstructorCourseOfferingWithDeps(requestedCourseOfferingId, {
    requireActiveInstructor: requireCurrentInstructor,
    isAllowedOfferingId: isInstructorAllowedCourseOfferingId,
    fetchOfferingById: (offeringId) =>
      prisma.courseOffering.findUnique({
        where: { id: offeringId },
        select: OFFERING_SELECT,
      }),
  });
}
