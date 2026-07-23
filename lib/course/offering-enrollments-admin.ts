/**
 * MULTI-COURSE (enrollment slice E3) - server-side IO for the admin enrollment-
 * setup verification list of ONE exact CourseOffering.
 *
 * Server-side only: reads through the shared Prisma client. All membership
 * resolution, ordering and display shaping is delegated to the PURE core
 * (offering-enrollments-admin-core.ts), so this stays a thin IO shell.
 *
 * OFFERING SCOPING: the offering is ALWAYS the exact id supplied by the caller,
 * normalized with the committed Slice-1 primitive (normalizeOfferingId). It NEVER
 * resolves the ACTIVE singleton, NEVER reads a selected-course cookie, and NEVER
 * identifies an offering by name/level. An invalid id FAILS CLOSED to an EMPTY
 * list (no query issued), matching getCourseGroupTreeByOfferingId's convention.
 *
 * READ-ONLY and privacy-narrow: it issues exactly ONE `courseEnrollment.findMany`
 * scoped by courseOfferingId. The Student select is EXACTLY id/fullName/
 * identityNumber (no phone, no horse, no compatibility fields); the membership
 * select carries only the dated interval and the target group's name + parent
 * name. It performs no write and reads no schedule / duty / horse / capability
 * data.
 *
 * TRUST BOUNDARY: this is admin-only infrastructure. It performs NO requireAdmin()
 * itself - the server page MUST call requireAdmin()/requireAdminCourseOffering()
 * and pass the validated offering id (and its startDate as `asOf`) BEFORE using
 * this reader, mirroring the enrollable-trainees / course-group-tree layering.
 */
import { prisma } from "@/lib/prisma";
import { normalizeOfferingId } from "./offering-by-id-core";
import {
  buildAdminEnrollmentDisplayRows,
  type AdminEnrollmentDisplayRow,
} from "./offering-enrollments-admin-core";

export type { AdminEnrollmentDisplayRow } from "./offering-enrollments-admin-core";

/**
 * Read the deterministic, privacy-narrow enrollment verification list for EXACTLY
 * the given offering id, resolving each enrollment's membership at `asOf` (the
 * caller passes offering.startDate, so an enrollment whose initial membership
 * starts on the offering start date is shown as current rather than mislabeled).
 *
 * An invalid id fails closed to []. A valid id with no enrollments returns [].
 */
export async function readOfferingEnrollmentsForAdmin(
  courseOfferingId: string,
  asOf: Date | null,
): Promise<AdminEnrollmentDisplayRow[]> {
  const normalizedId = normalizeOfferingId(courseOfferingId);
  if (normalizedId === null) {
    return [];
  }

  const rows = await prisma.courseEnrollment.findMany({
    where: { courseOfferingId: normalizedId },
    select: {
      id: true,
      status: true,
      isPrimary: true,
      student: { select: { id: true, fullName: true, identityNumber: true } },
      memberships: {
        select: {
          effectiveFrom: true,
          effectiveTo: true,
          courseGroup: {
            select: {
              name: true,
              parentGroupId: true,
              parentGroup: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  return buildAdminEnrollmentDisplayRows(rows, asOf);
}
