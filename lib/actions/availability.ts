"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { dateKey, parseDateKey } from "@/lib/dates";
import { applyDateRangeAvailability } from "@/lib/availability-helpers";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { ActionResult } from "@/lib/actions/students";

export interface AvailabilityRow {
  studentId: string;
  dateKey: string;
  isAvailable: boolean;
}

// Read-only. Used by the admin schedule grid to distinguish "student
// legitimately unavailable that day" (not a problem) from "student
// available but unassigned" (a genuine coverage gap) - mirrors the
// scheduler's own default-available-unless-explicit-false rule
// (see isAvailable() in lib/scheduler.ts).
export async function getAvailabilityForRange(
  startDateKey: string,
  endDateKey: string
): Promise<AvailabilityRow[]> {
  await requireAdmin();
  const rows = await prisma.studentAvailability.findMany({
    where: { date: { gte: parseDateKey(startDateKey), lte: parseDateKey(endDateKey) } },
  });
  return rows.map((r) => ({
    studentId: r.studentId,
    dateKey: dateKey(r.date),
    isAvailable: r.isAvailable,
  }));
}

export async function setAvailability(
  studentId: string,
  dateKeyStr: string,
  isAvailable: boolean
): Promise<ActionResult> {
  const date = parseDateKey(dateKeyStr);

  await prisma.studentAvailability.upsert({
    where: { studentId_date: { studentId, date } },
    update: { isAvailable },
    create: { studentId, date, isAvailable },
  });

  revalidatePath("/admin/availability");
  return { success: true };
}

export async function setAvailabilityForAllStudents(
  dateKeyStr: string,
  isAvailable: boolean
): Promise<ActionResult> {
  const date = parseDateKey(dateKeyStr);
  const students = await prisma.student.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  await prisma.$transaction(
    students.map((s) =>
      prisma.studentAvailability.upsert({
        where: { studentId_date: { studentId: s.id, date } },
        update: { isAvailable },
        create: { studentId: s.id, date, isAvailable },
      })
    )
  );

  revalidatePath("/admin/availability");
  return { success: true };
}

export type StudentAvailabilityScheme =
  | { mode: "whole-course" }
  | { mode: "range"; startDate: string; endDate: string };

// Used from the student edit modal in /admin/students - sets this one
// student's availability across the whole course in one action, writing to
// the same StudentAvailability rows the scheduler and /admin/availability
// read. "whole-course" clears any existing rows for this student (back to
// the default-available behavior); "range" marks them available inside the
// range and unavailable elsewhere in the course, same as the presets flow.
export async function setStudentAvailabilityScheme(
  studentId: string,
  scheme: StudentAvailabilityScheme
): Promise<ActionResult> {
  const settings = await prisma.courseSettings.findUnique({ where: { id: 1 } });
  if (!settings) {
    return { success: false, error: "יש להגדיר תחילה את תאריכי הקורס" };
  }

  if (scheme.mode === "whole-course") {
    await prisma.studentAvailability.deleteMany({
      where: {
        studentId,
        date: { gte: settings.startDate, lte: settings.endDate },
      },
    });
  } else {
    if (!scheme.startDate || !scheme.endDate) {
      return { success: false, error: "יש לבחור טווח תאריכים" };
    }
    await applyDateRangeAvailability(
      [studentId],
      settings.startDate,
      settings.endDate,
      parseDateKey(scheme.startDate),
      parseDateKey(scheme.endDate)
    );
  }

  revalidatePath("/admin/students");
  revalidatePath("/admin/availability");
  revalidatePath("/admin");
  return { success: true };
}
