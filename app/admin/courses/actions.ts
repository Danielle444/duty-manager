"use server";

/**
 * MULTI-COURSE (Slice 4) - the single validated admin course-selection action.
 *
 * Ordering is a hard safety contract (see below): validate the submitted id as an
 * admin-authorized real offering BEFORE writing the convenience cookie, build the
 * redirect target ONLY from the validated context.id (never from raw input), and
 * accept no client-provided returnTo. The convenience cookie write is the only
 * mutation this slice performs; it is NOT authorization - every destination
 * independently re-runs requireAdminCourseOffering(id).
 */
import { redirect } from "next/navigation";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
  type AdminCourseContext,
} from "@/lib/course/admin-course-context";
import { setRememberedAdminCourseOfferingId } from "@/lib/course/admin-course-cookie";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createCourseOffering } from "@/lib/course/create-offering";

/**
 * Validate and remember an explicitly chosen CourseOffering, then redirect to its
 * course shell. Exact order:
 *   1. extract the `courseOfferingId` candidate from the form;
 *   2. reject missing / non-string / empty input to the safe static error state;
 *   3. requireAdminCourseOffering(candidate) - admin authorization FIRST, then an
 *      exact-id lookup of precisely the submitted offering (no fallback);
 *   4. only after validation succeeds, write the convenience cookie with the
 *      validated context.id;
 *   5. redirect to `/admin/courses/${encodeURIComponent(context.id)}` built from
 *      the validated id, never from the raw candidate.
 *
 * Only the typed CourseOfferingNotFoundError is caught (translated to the safe
 * static `?error=invalid` state, with no raw id reflected). redirect() signals by
 * throwing NEXT_REDIRECT, so successful redirects sit OUTSIDE any try/catch and
 * propagate; unexpected errors also propagate unchanged.
 */
export async function selectAdminCourseOffering(formData: FormData): Promise<void> {
  const candidate = formData.get("courseOfferingId");

  // Fail closed on missing / non-string / empty input - no lookup, no reflection.
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    redirect("/admin/courses?error=invalid");
  }

  let context: AdminCourseContext;
  try {
    // Admin-authorization-first, then exact-id validation of the submitted id.
    context = await requireAdminCourseOffering(candidate);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      // Safe static error state; never reflect the raw candidate id.
      redirect("/admin/courses?error=invalid");
    }
    // Unexpected errors (and NEXT_REDIRECT, though none is thrown in this try)
    // propagate untouched.
    throw error;
  }

  // Only now, with a validated offering, remember the selection (convenience
  // only) and redirect using the VALIDATED id - never the raw candidate.
  await setRememberedAdminCourseOfferingId(context.id);
  redirect(`/admin/courses/${encodeURIComponent(context.id)}`);
}

/**
 * MULTI-COURSE W9A-2 - create exactly one PLANNED CourseOffering under an
 * existing ActivityYear. Order (hard safety contract):
 *   1. requireAdmin() FIRST - authorize before any read or write;
 *   2. hand the raw FormData fields to the create-offering IO, which validates,
 *      verifies the ActivityYear exists, and performs the single
 *      prisma.courseOffering.create with status hard-coded "PLANNED" server-side
 *      (offering status is never read from the client);
 *   3. on failure, redirect to the safe static error state carrying only a
 *      stable, non-PII error code (never the raw submitted values);
 *   4. on success, redirect to the new course shell built from the VALIDATED
 *      new id, which independently re-runs requireAdminCourseOffering(id).
 * redirect() signals via NEXT_REDIRECT, so both branches sit outside any
 * try/catch and propagate. This action creates NOTHING but one CourseOffering.
 */
export async function createCourseOfferingAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const result = await createCourseOffering({
    activityYearId: formData.get("activityYearId"),
    name: formData.get("name"),
    level: formData.get("level"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
  });

  if (!result.success) {
    // Safe static error state; only a stable code is reflected, never raw input.
    redirect(`/admin/courses?error=${encodeURIComponent(result.error)}`);
  }

  redirect(`/admin/courses/${encodeURIComponent(result.id)}`);
}
