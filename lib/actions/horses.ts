"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { ActionResult } from "@/lib/actions/students";
import { writeTraineeHorseAssignment } from "@/lib/trainee-history/horse-write-service";
import { israelDateKeyFromInstant } from "@/lib/trainee-history/israel-date";
import type { PublicErrorCode, WritePolicy } from "@/lib/trainee-history/apply-plan";

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

  const policy: WritePolicy = {
    actorKind: "admin",
    allowFutureEffectiveDates: false,
    allowedDomain: "horse",
    cutover: today,
  };

  const outcome = await writeTraineeHorseAssignment(
    {
      studentId,
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
export async function updateStudentHorseInfoAsInstructor(
  instructorId: string,
  studentId: string,
  data: HorseInfoUpdate
): Promise<ActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });

  if (!instructor || !instructor.isActive || !instructor.canEditHorseAssignments) {
    return { success: false, error: "אין הרשאה לערוך חלוקת סוסים" };
  }

  await prisma.student.update({
    where: { id: studentId },
    data: {
      hasPrivateHorse: data.hasPrivateHorse,
      privateHorseName: data.privateHorseName?.trim() || null,
      assignedHorseName: data.assignedHorseName?.trim() || null,
    },
  });

  revalidatePath("/admin/horses");
  return { success: true };
}

// Students have no NextAuth session in this app (see requireAdmin), so this
// re-reads hasPrivateHorse from the DB by studentId on every call - it never
// trusts a client-supplied flag. A student may only ever set their own
// privateHorseName, and only while marked as having a private horse;
// hasPrivateHorse and assignedHorseName are never touched here.
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

  await prisma.student.update({
    where: { id: studentId },
    data: { privateHorseName: privateHorseName.trim() || null },
  });

  revalidatePath("/admin/horses");
  return { success: true };
}
