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
import { createTraineeIntoOffering } from "@/lib/course/create-trainee-into-offering";

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

/**
 * MULTI-COURSE (new-trainee slice N2A) - the single admin action for creating ONE
 * brand-new, INACTIVE-STAGED trainee in ONE exact PLANNED CourseOffering and
 * assigning them to ONE leaf subgroup.
 *
 * It reuses the EXACT safety shape of enrollExistingTraineeAction above:
 *   1. requireAdmin() FIRST - authorize the manager before any FormData read, any
 *      coercion, and any call into the committed N1 service. Direct server-action
 *      invocation therefore fails closed; the page/layout is never the only guard;
 *   2. the courseOfferingId is a SERVER-BOUND leading argument taken from the
 *      validated course route (the future page binds context.id via .bind), NEVER a
 *      client form field - so a client cannot retarget creation at another offering.
 *      The bound arg is part of the encrypted server-action payload, not forgeable;
 *   3. read ONLY the five approved trainee fields from the form (firstName,
 *      lastName, identityNumber, phone, courseGroupId). Every operational value
 *      (isActive, groupName, subgroupNumber, enrollment status, isPrimary, dates,
 *      effectiveFrom, activation) is SERVER-DERIVED inside N1 and is deliberately
 *      NOT read from the client - N1's input type cannot even carry them;
 *   4. invoke createTraineeIntoOffering(...), whose interactive transaction re-reads
 *      and re-proves the exact offering (PLANNED-only), the leaf-subgroup ownership,
 *      and the no-duplicate-identity rule before its three additive writes. That
 *      transaction-local re-read IS the exact-route-offering validation, so the
 *      action does not duplicate requireAdminCourseOffering (mirrors the enrollment
 *      / rename / group-create actions). N1 also owns ALL normalization/validation;
 *   5. on failure, redirect back to THIS enrollments page carrying only a stable,
 *      non-PII N1 error code (never the raw name/identity/phone/ids); an invalid
 *      offering scope routes to the safe courses list instead of reflecting an
 *      unvalidated id;
 *   6. on success, revalidate exactly this enrollments page and redirect back with
 *      a stable created flag so the new inactive trainee appears in the enrollment
 *      verification list.
 * It uses query keys DISTINCT from the enrollment flow (newError / created, never
 * error / enrolled) so the two flows' banners never collide.
 *
 * redirect() signals via NEXT_REDIRECT, so every branch sits outside any try/catch
 * and propagates. This action imports NO Prisma and does NOTHING but invoke N1
 * (three additive writes): it never touches Student directly, TraineeHorseAssignment,
 * an activation helper, or Level 1.
 */
export async function createTraineeIntoOfferingAction(
  courseOfferingId: string,
  formData: FormData,
): Promise<void> {
  await requireAdmin();

  // Only the five approved trainee fields are read from the client; the offering
  // id is the server-bound route argument, never a form field. N1 owns all
  // trimming, validation and normalization - the action does not pre-validate.
  const firstName = formData.get("firstName");
  const lastName = formData.get("lastName");
  const identityNumber = formData.get("identityNumber");
  const phone = formData.get("phone");
  const courseGroupId = formData.get("courseGroupId");

  const result = await createTraineeIntoOffering({
    courseOfferingId,
    courseGroupId: typeof courseGroupId === "string" ? courseGroupId : "",
    firstName: typeof firstName === "string" ? firstName : "",
    lastName: typeof lastName === "string" ? lastName : "",
    identityNumber: typeof identityNumber === "string" ? identityNumber : "",
    phone: typeof phone === "string" ? phone : "",
  });

  const enrollPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/enrollments`;

  if (!result.success) {
    if (result.error === "offering_not_found") {
      // The bound id did not resolve to a real offering; do not build an
      // enrollments URL from it - fall back to the safe courses list.
      redirect("/admin/courses?error=invalid");
    }
    // For a validated offering (input/policy/group/duplicate errors), return to
    // this enrollments page with only a stable code under the N2-specific key.
    redirect(`${enrollPath}?newError=${encodeURIComponent(result.error)}`);
  }

  // Success: revalidate exactly this enrollments page so the new inactive-staged
  // trainee appears in the enrollment verification list.
  revalidatePath(enrollPath);
  redirect(`${enrollPath}?created=1`);
}
