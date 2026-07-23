"use server";

/**
 * MULTI-COURSE (enrollment slice E3) - the single admin action for enrolling ONE
 * existing trainee into ONE exact CourseOffering and assigning that enrollment to
 * ONE leaf subgroup.
 *
 * Ordering is a hard safety contract:
 *   1. requireAdmin() FIRST - authorize the manager before any read or write;
 *   2. the courseOfferingId is a SERVER-BOUND argument taken from the validated
 *      course route (the page binds context.id via .bind), NEVER a client form
 *      field - so a client cannot retarget the enrollment at another offering. The
 *      bound arg is part of the encrypted server-action payload and is not
 *      forgeable from the client;
 *   3. extract ONLY studentId and courseGroupId from the form. Every operational
 *      value (status, isPrimary, startDate, effectiveFrom) is server-derived
 *      inside E1 and is deliberately NOT read from the client;
 *   4. invoke enrollExistingTrainee(...), whose interactive transaction re-reads
 *      and re-proves the exact offering (PLANNED-only), the active student, the
 *      leaf-subgroup ownership, and the no-duplicate rule before its two writes.
 *      This transaction-local re-read IS the exact-route-offering validation, so
 *      the action does not duplicate requireAdminCourseOffering (mirrors the
 *      committed rename / group-create actions);
 *   5. on failure, redirect back to THIS enrollments page carrying only a stable,
 *      non-PII E1 error code (never the raw ids); an invalid offering scope routes
 *      to the safe courses list instead of reflecting an unvalidated id;
 *   6. on success, revalidate exactly this enrollments page and redirect back with
 *      a stable enrolled flag so the new enrollment appears and the trainee leaves
 *      the eligible selector.
 * redirect() signals via NEXT_REDIRECT, so every branch sits outside any
 * try/catch and propagates. This action does NOTHING but invoke E1 (two additive
 * writes): it never touches Student, TraineeHorseAssignment, or Level 1.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { enrollExistingTrainee } from "@/lib/course/enroll-existing-trainee";

export async function enrollExistingTraineeAction(
  courseOfferingId: string,
  formData: FormData,
): Promise<void> {
  await requireAdmin();

  // Only the two selected identifiers are read from the client; the offering id
  // is the server-bound route argument, never a form field.
  const studentId = formData.get("studentId");
  const courseGroupId = formData.get("courseGroupId");

  const result = await enrollExistingTrainee({
    courseOfferingId,
    studentId: typeof studentId === "string" ? studentId : "",
    courseGroupId: typeof courseGroupId === "string" ? courseGroupId : "",
  });

  const enrollPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/enrollments`;

  if (!result.success) {
    if (result.error === "offering_not_found") {
      // The bound id did not resolve to a real offering; do not build an
      // enrollments URL from it - fall back to the safe courses list.
      redirect("/admin/courses?error=invalid");
    }
    // For a validated offering (input/policy/student/group/duplicate errors),
    // return to this enrollments page with only a stable code.
    redirect(`${enrollPath}?error=${encodeURIComponent(result.error)}`);
  }

  // Success: revalidate exactly this enrollments page so the new enrollment
  // appears and the trainee leaves the eligible selector.
  revalidatePath(enrollPath);
  redirect(`${enrollPath}?enrolled=1`);
}
