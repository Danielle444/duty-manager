"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { generateSchedule, type GenerateMode } from "@/lib/scheduler";
import { parseDateKey } from "@/lib/dates";
import { requireAdmin } from "@/lib/auth/require-admin";
import { blockedGroupsForDayPlan } from "@/lib/duty-constraints";
import { subgroupKey } from "@/lib/subgroup-identity";
import type { ActionResult } from "@/lib/actions/students";

export interface GenerateResult extends ActionResult {
  daysProcessed?: number;
  assignedCount?: number;
  warnings?: string[];
}

export interface RunGenerateOptions {
  startDate?: Date;
  endDate?: Date;
  mode?: GenerateMode;
}

function revalidateScheduleRelatedPaths() {
  revalidatePath("/admin/schedule");
  revalidatePath("/admin/completion");
  revalidatePath("/admin");
  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/student");
}

export async function runGenerateSchedule(
  options: RunGenerateOptions = {}
): Promise<GenerateResult> {
  await requireAdmin();

  let { startDate, endDate } = options;
  const mode = options.mode ?? "regeneratePreserveManual";

  if (!startDate || !endDate) {
    const settings = await prisma.courseSettings.findUnique({ where: { id: 1 } });
    if (!settings) {
      return { success: false, error: "יש להגדיר תחילה את תאריכי הקורס" };
    }
    startDate = settings.startDate;
    endDate = settings.endDate;
  }

  const result = await generateSchedule({ startDate, endDate, mode });

  revalidateScheduleRelatedPaths();

  return { success: true, ...result };
}

export async function setPublishStatus(
  startDate: Date,
  endDate: Date,
  isPublished: boolean
): Promise<ActionResult> {
  await requireAdmin();

  await prisma.dutyAssignment.updateMany({
    where: { date: { gte: startDate, lte: endDate } },
    data: { isPublished },
  });

  revalidateScheduleRelatedPaths();
  return { success: true };
}

export async function reassignDuty(
  assignmentId: string,
  newStudentId: string
): Promise<ActionResult> {
  await requireAdmin();

  const assignment = await prisma.dutyAssignment.findUnique({
    where: { id: assignmentId },
  });
  if (!assignment) {
    return { success: false, error: "השיבוץ לא נמצא" };
  }

  const conflict = await prisma.dutyAssignment.findUnique({
    where: { date_studentId: { date: assignment.date, studentId: newStudentId } },
  });
  if (conflict && conflict.id !== assignmentId) {
    return { success: false, error: "לתלמיד/ה זה כבר יש תורנות ביום זה" };
  }

  await prisma.dutyAssignment.update({
    where: { id: assignmentId },
    data: { studentId: newStudentId, isManual: true },
  });

  revalidateScheduleRelatedPaths();
  return { success: true };
}

export async function createManualAssignment(
  dateKeyStr: string,
  dutyTypeId: string,
  studentId: string
): Promise<ActionResult> {
  await requireAdmin();

  const date = parseDateKey(dateKeyStr);
  const conflict = await prisma.dutyAssignment.findUnique({
    where: { date_studentId: { date, studentId } },
  });
  if (conflict) {
    return { success: false, error: "לתלמיד/ה זה כבר יש תורנות ביום זה" };
  }

  await prisma.dutyAssignment.create({
    data: { date, dutyTypeId, studentId, isManual: true },
  });

  revalidateScheduleRelatedPaths();
  return { success: true };
}

export async function deleteAssignment(assignmentId: string): Promise<ActionResult> {
  await requireAdmin();

  await prisma.dutyAssignment.delete({ where: { id: assignmentId } });

  revalidateScheduleRelatedPaths();
  return { success: true };
}

// Powers the admin schedule grid's cell editor: assigning a duty to an empty
// cell, or changing the duty type of an existing assignment, in one call.
// Always re-validates constraints and ONE_PER_SUBGROUP rules server-side,
// even though the UI already disables the same options - the UI's disabled
// state is a convenience, not the enforcement boundary.
export async function upsertManualAssignment(
  dateKeyStr: string,
  studentId: string,
  dutyTypeId: string
): Promise<ActionResult> {
  await requireAdmin();

  const date = parseDateKey(dateKeyStr);

  const [student, dutyType, existing, dayPlan, constraints] = await Promise.all([
    prisma.student.findUnique({ where: { id: studentId } }),
    prisma.dutyType.findUnique({ where: { id: dutyTypeId } }),
    prisma.dutyAssignment.findUnique({ where: { date_studentId: { date, studentId } } }),
    prisma.courseDayPlan.findUnique({ where: { date } }),
    prisma.dutyConstraint.findMany({ where: { dutyTypeId, isActive: true } }),
  ]);

  if (!student) {
    return { success: false, error: "התלמיד/ה לא נמצא/ה" };
  }
  if (!dutyType) {
    return { success: false, error: "סוג התורנות לא נמצא" };
  }

  const blockedGroups = blockedGroupsForDayPlan(dayPlan, constraints);
  if (student.groupName && blockedGroups.has(student.groupName)) {
    return {
      success: false,
      error: `לא ניתן לשבץ את "${dutyType.name}" לתלמיד/ה זו בתאריך זה עקב אילוץ פעיל`,
    };
  }

  if (dutyType.allocationMode === "ONE_PER_SUBGROUP" && student.subgroupNumber != null) {
    const key = subgroupKey(student.groupName, student.subgroupNumber);
    const sameDutySameDay = await prisma.dutyAssignment.findMany({
      where: { date, dutyTypeId, studentId: { not: studentId } },
      include: { student: { select: { groupName: true, subgroupNumber: true } } },
    });
    const conflict = sameDutySameDay.some(
      (a) =>
        a.student.subgroupNumber != null &&
        subgroupKey(a.student.groupName, a.student.subgroupNumber) === key
    );
    if (conflict) {
      return {
        success: false,
        error: `בתת-הקבוצה של תלמיד/ה זו כבר קיים שיבוץ לתורנות "${dutyType.name}" בתאריך זה`,
      };
    }
  }

  if (existing) {
    const dutyTypeChanged = existing.dutyTypeId !== dutyTypeId;
    await prisma.dutyAssignment.update({
      where: { id: existing.id },
      data: {
        dutyTypeId,
        isManual: true,
        ...(dutyTypeChanged ? { isCompleted: false, completedAt: null } : {}),
      },
    });
  } else {
    await prisma.dutyAssignment.create({
      data: { date, studentId, dutyTypeId, isManual: true, isPublished: false },
    });
  }

  revalidateScheduleRelatedPaths();
  return { success: true };
}
