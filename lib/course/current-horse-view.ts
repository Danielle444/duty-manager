/**
 * MULTI-COURSE W8A-4 - server-side IO wrapper for the enrollment-scoped
 * current-horse VIEW.
 *
 * Server-side only: reads through the shared Prisma client. It resolves the
 * current CourseOffering SERVER-SIDE (never from a client-supplied offering id),
 * finds the student's enrollment in that offering by (studentId + offering.id),
 * and delegates the cardinality/active decision to the PURE core
 * (current-horse-view-core.ts). This file stays a thin, un-tested-by-design IO
 * shell.
 *
 * TRUST BOUNDARY (locked): the ONLY caller-supplied input is `studentId`. The
 * offering is resolved solely from the server's single-offering invariant, so a
 * client can never widen or redirect the scope by passing an offering id.
 *
 * NOTE (W8A-4 scope): NOT wired into any existing screen/action in this stage.
 * The Student horse columns remain the authoritative runtime source; this
 * wrapper reads the enrollment cache and returns it, but nothing consumes it
 * yet. No runtime read/write behavior changes.
 */
import { prisma } from "@/lib/prisma";
import { resolveCurrentCourseOffering } from "./current-offering";
import { resolveCurrentHorseView, type CurrentHorseView } from "./current-horse-view-core";

export {
  NoCurrentHorseEnrollmentError,
  AmbiguousCurrentHorseEnrollmentError,
  InactiveCurrentHorseEnrollmentError,
  type CurrentHorseView,
  type CurrentHorseEnrollmentCandidate,
} from "./current-horse-view-core";

/**
 * Resolve the enrollment-scoped current-horse view for one student in the
 * current offering. Fetches at most two candidate enrollments (defensive: the
 * (studentId, courseOfferingId) unique constraint permits one) and lets the pure
 * core decide:
 *  - 0 candidates        -> throws NoCurrentHorseEnrollmentError
 *  - 1 ACTIVE candidate  -> returns its horse cache view
 *  - 1 non-ACTIVE        -> throws InactiveCurrentHorseEnrollmentError
 *  - >=2 candidates      -> throws AmbiguousCurrentHorseEnrollmentError
 *
 * Status is NOT filtered in the query on purpose: an INACTIVE enrollment must
 * surface as the distinct InactiveCurrentHorseEnrollmentError (fail closed), not
 * be silently reduced to a "no enrollment" case. The ACTIVE requirement is
 * enforced by the pure core.
 */
export async function getCurrentEnrollmentHorseView(
  studentId: string,
): Promise<CurrentHorseView> {
  const offering = await resolveCurrentCourseOffering();

  const candidates = await prisma.courseEnrollment.findMany({
    where: { studentId, courseOfferingId: offering.id },
    take: 2,
    select: {
      id: true,
      status: true,
      hasPrivateHorse: true,
      privateHorseName: true,
      assignedHorseName: true,
    },
  });

  return resolveCurrentHorseView(candidates);
}
