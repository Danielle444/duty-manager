"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { ActionResult } from "@/lib/actions/students";
import { writeTraineeHorseAssignment } from "@/lib/trainee-history/horse-write-service";
import { israelDateKeyFromInstant } from "@/lib/trainee-history/israel-date";
import type { PublicErrorCode, WritePolicy } from "@/lib/trainee-history/apply-plan";
import { resolveCurrentCourseOffering } from "@/lib/course/current-offering";
import { isKnownCurrentOfferingError } from "@/lib/course/create-trainee-enrollment-core";

export interface HorseAssignmentRow {
  id: string;
  fullName: string;
  lastName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

// Read-only, no permission gate - same convention as other instructor-facing
// reads (e.g. getScheduleForInstructor in lib/actions/instructor-schedule.ts)
// which can't call requireAdmin() since students/instructors have no
// NextAuth session in this app. Callable from both the admin server
// component and the instructor client tab.
export async function getHorseAssignments(): Promise<HorseAssignmentRow[]> {
  const students = await prisma.student.findMany({
    where: { isActive: true },
    orderBy: [{ groupName: "asc" }, { subgroupNumber: "asc" }, { lastName: "asc" }],
    select: {
      id: true,
      fullName: true,
      lastName: true,
      groupName: true,
      subgroupNumber: true,
      hasPrivateHorse: true,
      privateHorseName: true,
      assignedHorseName: true,
    },
  });
  return students;
}

export interface HorseInfoUpdate {
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

// Single safe, generic message for ANY known current-offering structural failure
// (no offering / ambiguous / incomplete). Deliberately reveals no offering count,
// id, dates, class name, or Prisma detail - the manager is told only that the
// horse update is unavailable and to contact system management.
const CURRENT_OFFERING_UNAVAILABLE_MESSAGE =
  "לא ניתן לעדכן חלוקת סוסים כעת עקב בעיה בהגדרת הקורס הנוכחי. יש לפנות לניהול המערכת";

// Map an effective-dated write failure code to a clear, user-facing Hebrew
// message. Never surfaces internal DB/transaction details; unmapped codes fall
// back to a generic failure message.
function horseWriteErrorMessage(code: PublicErrorCode): string {
  switch (code) {
    case "TRAINEE_NOT_FOUND":
      return "חניך/ה לא נמצא/ה";
    case "TRAINEE_INACTIVE":
      return "חניך/ה אינו/ה פעיל/ה";
    case "INVALID_HORSE_STATE":
      return "מצב סוס לא תקין";
    case "DUPLICATE_EFFECTIVE_FROM":
      return "כבר קיים שינוי חלוקת סוסים בתאריך זה";
    default:
      return "עדכון חלוקת הסוסים נכשל";
  }
}

export async function updateStudentHorseInfo(
  studentId: string,
  data: HorseInfoUpdate
): Promise<ActionResult> {
  await requireAdmin();

  // Trusted explicit server instant; the pure service derives Israel-local
  // today from it (no hidden clock inside the service).
  const now = new Date();
  // No future-date input on this action: the change takes effect on today's
  // Israel-local calendar day, and cutover is that same day (via the single
  // GH2A1 date helper) so effectiveFrom == cutover passes the cutover gate.
  const today = israelDateKeyFromInstant(now);

  // Resolve the current CourseOffering SERVER-SIDE (never client-supplied) and
  // convert only the three KNOWN structural failures (no / ambiguous /
  // incomplete offering) into a safe Hebrew ActionResult, reusing the shared
  // classifier so this action never rejects on them. Any other error propagates.
  let courseOfferingId: string;
  try {
    const offering = await resolveCurrentCourseOffering();
    courseOfferingId = offering.id;
  } catch (err) {
    if (isKnownCurrentOfferingError(err)) {
      return { success: false, error: CURRENT_OFFERING_UNAVAILABLE_MESSAGE };
    }
    throw err;
  }

  const policy: WritePolicy = {
    actorKind: "admin",
    allowFutureEffectiveDates: false,
    allowedDomain: "horse",
    cutover: today,
  };

  const outcome = await writeTraineeHorseAssignment(
    {
      studentId,
      courseOfferingId,
      effectiveFrom: today,
      assignedHorseName: data.assignedHorseName,
      hasPrivateHorse: data.hasPrivateHorse,
      privateHorseName: data.privateHorseName,
    },
    policy,
    now
  );

  if (!outcome.ok) {
    return { success: false, error: horseWriteErrorMessage(outcome.code) };
  }

  revalidatePath("/admin/horses");
  return { success: true };
}

// Instructors have no NextAuth session in this app (see requireAdmin), so the
// permission check here re-reads canEditHorseAssignments from the DB by
// instructorId on every call - it never trusts a client-supplied boolean.
// This is the only gate; the UI hiding edit controls is not relied upon.
//
// W8A-6: rescoped onto the same enrollment-scoped write service the admin action
// uses. It no longer touches Student directly; the single service transaction
// maintains the dated TraineeHorseAssignment history (linked to the current
// offering's enrollment), the CourseEnrollment horse cache, and the Student
// compatibility mirror, and fails closed on any three-way parity anomaly. The
// public signature and the permission model are unchanged.
export async function updateStudentHorseInfoAsInstructor(
  instructorId: string,
  studentId: string,
  data: HorseInfoUpdate
): Promise<ActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });

  if (!instructor || !instructor.isActive || !instructor.canEditHorseAssignments) {
    return { success: false, error: "אין הרשאה לערוך חלוקת סוסים" };
  }

  // Trusted explicit server instant; the pure service derives Israel-local today
  // from it. This action has no client-supplied effective date - the change takes
  // effect on today's Israel-local calendar day, matching the prior behavior when
  // it wrote the caches directly (cutover == effectiveFrom == today).
  const now = new Date();
  const today = israelDateKeyFromInstant(now);

  // Resolve the current CourseOffering SERVER-SIDE (never client-supplied) and
  // convert only the three KNOWN structural offering failures into a safe Hebrew
  // ActionResult, exactly as the admin writer does. Any other error propagates.
  let courseOfferingId: string;
  try {
    const offering = await resolveCurrentCourseOffering();
    courseOfferingId = offering.id;
  } catch (err) {
    if (isKnownCurrentOfferingError(err)) {
      return { success: false, error: CURRENT_OFFERING_UNAVAILABLE_MESSAGE };
    }
    throw err;
  }

  // Instructor policy: horse domain, no future effective dates, and NO
  // field-level restriction - preserving this action's prior capability to set
  // all three horse fields (assignedHorseName, hasPrivateHorse, privateHorseName)
  // exactly as it did before. No instructor permission is broadened.
  const policy: WritePolicy = {
    actorKind: "instructor",
    allowFutureEffectiveDates: false,
    allowedDomain: "horse",
    cutover: today,
  };

  const outcome = await writeTraineeHorseAssignment(
    {
      studentId,
      courseOfferingId,
      effectiveFrom: today,
      assignedHorseName: data.assignedHorseName,
      hasPrivateHorse: data.hasPrivateHorse,
      privateHorseName: data.privateHorseName,
    },
    policy,
    now
  );

  if (!outcome.ok) {
    return { success: false, error: horseWriteErrorMessage(outcome.code) };
  }

  revalidatePath("/admin/horses");
  return { success: true };
}

// Students have no NextAuth session in this app (see requireAdmin), so this
// re-reads hasPrivateHorse from the DB by studentId on every call - it never
// trusts a client-supplied flag. A student may only ever set their own
// privateHorseName, and only while marked as having a private horse;
// hasPrivateHorse and assignedHorseName are never touched here.
//
// TRUST BOUNDARY (unchanged this stage): studentId is still client-supplied
// under the existing local trainee-login model; this action does NOT prove the
// caller owns studentId. The pre-existing server-side checks below (Student
// exists / isActive / hasPrivateHorse) are preserved exactly, with their exact
// Hebrew messages, and the client-supplied hasPrivateHorse flag is never
// trusted (it is re-read from the DB here).
//
// W8A-7: rescoped onto the same enrollment-scoped write service the admin and
// instructor actions use. It no longer writes Student directly; the single
// service transaction maintains the dated TraineeHorseAssignment history (linked
// to the current offering's enrollment), the CourseEnrollment horse cache, and
// the Student compatibility mirror, and fails closed on any three-way parity
// anomaly. A trainee-scoped WritePolicy allows ONLY privateHorseName to change;
// hasPrivateHorse and assignedHorseName are passed through with the values just
// read from Student, so if they became stale the service field-policy check
// fails closed rather than letting a trainee move a forbidden field. The public
// signature and the trainee identity/auth model are unchanged.
export async function updateOwnPrivateHorseName(
  studentId: string,
  privateHorseName: string
): Promise<ActionResult> {
  const student = await prisma.student.findUnique({ where: { id: studentId } });

  if (!student || !student.isActive) {
    return { success: false, error: "חניך/ה לא נמצא/ה" };
  }
  if (!student.hasPrivateHorse) {
    return { success: false, error: "לא סומן/ה כבעל/ת סוס פרטי" };
  }

  // Trusted explicit server instant; the pure service derives Israel-local today
  // from it. This action has no client-supplied effective date - the change
  // takes effect on today's Israel-local calendar day, matching the prior
  // behavior when it wrote the Student cache directly (cutover == effectiveFrom
  // == today).
  const now = new Date();
  const today = israelDateKeyFromInstant(now);

  // Resolve the current CourseOffering SERVER-SIDE (never client-supplied) and
  // convert only the three KNOWN structural offering failures into the same safe
  // Hebrew ActionResult the admin/instructor writers use. Any other error
  // propagates.
  let courseOfferingId: string;
  try {
    const offering = await resolveCurrentCourseOffering();
    courseOfferingId = offering.id;
  } catch (err) {
    if (isKnownCurrentOfferingError(err)) {
      return { success: false, error: CURRENT_OFFERING_UNAVAILABLE_MESSAGE };
    }
    throw err;
  }

  // Trainee policy: horse domain, no future effective dates, and a HARD
  // field-level restriction to privateHorseName only. hasPrivateHorse and
  // assignedHorseName are NOT in the allow-list, so any attempt (or a stale
  // pass-through) to change them is rejected as UNAUTHORIZED_ACTOR by the
  // service.
  const policy: WritePolicy = {
    actorKind: "trainee",
    allowFutureEffectiveDates: false,
    allowedDomain: "horse",
    allowedHorseFields: ["privateHorseName"],
    cutover: today,
  };

  const outcome = await writeTraineeHorseAssignment(
    {
      studentId,
      courseOfferingId,
      effectiveFrom: today,
      // Pass through the two forbidden fields with the values just read from
      // Student; only privateHorseName is the trainee-requested change. The
      // locked transaction data remains authoritative - stale pass-through
      // values fail the field-policy check closed.
      assignedHorseName: student.assignedHorseName,
      hasPrivateHorse: student.hasPrivateHorse,
      privateHorseName: privateHorseName.trim() || null,
    },
    policy,
    now
  );

  if (!outcome.ok) {
    return { success: false, error: horseWriteErrorMessage(outcome.code) };
  }

  revalidatePath("/admin/horses");
  return { success: true };
}
