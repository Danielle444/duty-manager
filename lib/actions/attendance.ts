"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey, parseDateKey, enumerateDateKeys } from "@/lib/dates";
import { setAvailability } from "@/lib/actions/availability";
import type { ActionResult } from "@/lib/actions/students";

const attendanceStatusSchema = z.enum(["PRESENT", "ABSENT", "PARTIAL"]);
export type AttendanceStatusValue = z.infer<typeof attendanceStatusSchema>;

const timeSchema = z
  .union([z.literal(""), z.string().regex(/^\d{1,2}:\d{2}$/, "פורמט שעה לא תקין (HH:MM)")])
  .optional();

const attendanceInputSchema = z.object({
  studentId: z.string().min(1, "יש לבחור תלמיד/ה"),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "תאריך לא תקין"),
  status: attendanceStatusSchema,
  arrivalTime: timeSchema,
  departureTime: timeSchema,
  notes: z.string().trim().optional(),
});

export type AttendanceInput = z.infer<typeof attendanceInputSchema>;

export interface AttendanceRecord {
  studentId: string;
  dateKey: string;
  status: AttendanceStatusValue;
  arrivalTime: string | null;
  departureTime: string | null;
  notes: string | null;
  updatedByName: string | null;
}

export interface AttendanceActionResult extends ActionResult {
  row?: AttendanceRecord;
}

export type AttendanceWarningType =
  | "ABSENT_WITH_DUTY"
  | "UNAVAILABLE_WITH_DUTY"
  | "DUTY_INCOMPLETE"
  | "PARTIAL_DUTY_CHECK_MANUALLY";

export interface AttendanceWarning {
  type: AttendanceWarningType;
  message: string;
}

export interface AttendanceAssignedDuty {
  id: string;
  dutyTypeName: string;
  isPublished: boolean;
  isCompleted: boolean;
}

// One row per student per date in the requested range. `attendance` is null
// when no StudentAttendance row exists yet - "not yet marked", never
// inferred as PRESENT. `isAvailable` follows the same default-available
// convention already established by StudentAvailability/the scheduler (no
// row = available) - a deliberately different "missing record" default than
// attendance, because that convention is already relied on elsewhere in the
// app; attendance has no such precedent, so it stays unmarked instead.
export interface AttendanceTrackingRow {
  studentId: string;
  studentName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  dateKey: string;
  attendance: AttendanceRecord | null;
  isAvailable: boolean;
  assignedDuty: AttendanceAssignedDuty | null;
  warnings: AttendanceWarning[];
}

// Compact per-cell shape for a future week-view pivot grid, derived from an
// AttendanceTrackingRow rather than fetched separately.
export interface AttendanceDayCell {
  dateKey: string;
  status: AttendanceStatusValue | null;
  hasWarnings: boolean;
}

export function toAttendanceDayCell(row: AttendanceTrackingRow): AttendanceDayCell {
  return {
    dateKey: row.dateKey,
    status: row.attendance?.status ?? null,
    hasWarnings: row.warnings.length > 0,
  };
}

function toAttendanceRecord(row: {
  studentId: string;
  date: Date;
  status: AttendanceStatusValue;
  arrivalTime: string | null;
  departureTime: string | null;
  notes: string | null;
  updatedByName: string | null;
}): AttendanceRecord {
  return {
    studentId: row.studentId,
    dateKey: dateKey(row.date),
    status: row.status,
    arrivalTime: row.arrivalTime,
    departureTime: row.departureTime,
    notes: row.notes,
    updatedByName: row.updatedByName,
  };
}

// Day-level only - DutyAssignment/DutyType currently carry no start/end
// time, so a PARTIAL attendance record can never be precisely compared
// against a duty's actual time; that case gets a soft manual-check warning
// instead of a real conflict/no-conflict verdict.
function computeWarnings(params: {
  status: AttendanceStatusValue | null;
  isAvailable: boolean;
  assignedDuty: AttendanceAssignedDuty | null;
}): AttendanceWarning[] {
  const { status, isAvailable, assignedDuty } = params;
  const warnings: AttendanceWarning[] = [];

  if (status === "ABSENT" && assignedDuty) {
    warnings.push({
      type: "ABSENT_WITH_DUTY",
      message: "התלמיד/ה נעדר/ת אך משובץ/ת לתורנות ביום זה",
    });
  }
  if (!isAvailable && assignedDuty) {
    warnings.push({
      type: "UNAVAILABLE_WITH_DUTY",
      message: "התלמיד/ה מסומן/ת כלא זמין/ה אך משובץ/ת לתורנות ביום זה",
    });
  }
  if (assignedDuty && !assignedDuty.isCompleted) {
    warnings.push({
      type: "DUTY_INCOMPLETE",
      message: "התורנות המשובצת ביום זה טרם בוצעה",
    });
  }
  if (status === "PARTIAL" && assignedDuty) {
    warnings.push({
      type: "PARTIAL_DUTY_CHECK_MANUALLY",
      message: "יש לבדוק ידנית אם שעות הנוכחות מתאימות לתורנות",
    });
  }

  return warnings;
}

async function buildAttendanceTrackingRows(
  startDateKey: string,
  endDateKey: string
): Promise<AttendanceTrackingRow[]> {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);
  const dateKeys = enumerateDateKeys(start, end);

  const [students, attendanceRows, availabilityRows, dutyAssignments] = await Promise.all([
    prisma.student.findMany({
      where: { isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, groupName: true, subgroupNumber: true },
    }),
    prisma.studentAttendance.findMany({ where: { date: { gte: start, lte: end } } }),
    prisma.studentAvailability.findMany({ where: { date: { gte: start, lte: end } } }),
    prisma.dutyAssignment.findMany({
      where: { date: { gte: start, lte: end } },
      include: { dutyType: true },
    }),
  ]);

  const attendanceByKey = new Map(
    attendanceRows.map((r) => [`${r.studentId}|${dateKey(r.date)}`, r])
  );
  const availabilityByKey = new Map(
    availabilityRows.map((r) => [`${r.studentId}|${dateKey(r.date)}`, r.isAvailable])
  );
  const dutyByKey = new Map(
    dutyAssignments.map((a) => [`${a.studentId}|${dateKey(a.date)}`, a])
  );

  const result: AttendanceTrackingRow[] = [];
  for (const student of students) {
    for (const dk of dateKeys) {
      const key = `${student.id}|${dk}`;
      const attendanceRaw = attendanceByKey.get(key);
      const attendance = attendanceRaw ? toAttendanceRecord(attendanceRaw) : null;
      // No explicit row = available, mirroring the scheduler's own default
      // (see lib/scheduler.ts / getAvailabilityForRange).
      const isAvailable = availabilityByKey.get(key) ?? true;
      const dutyRaw = dutyByKey.get(key);
      const assignedDuty: AttendanceAssignedDuty | null = dutyRaw
        ? {
            id: dutyRaw.id,
            dutyTypeName: dutyRaw.dutyType.name,
            isPublished: dutyRaw.isPublished,
            isCompleted: dutyRaw.isCompleted,
          }
        : null;

      result.push({
        studentId: student.id,
        studentName: student.fullName,
        groupName: student.groupName,
        subgroupNumber: student.subgroupNumber,
        dateKey: dk,
        attendance,
        isAvailable,
        assignedDuty,
        warnings: computeWarnings({ status: attendance?.status ?? null, isAvailable, assignedDuty }),
      });
    }
  }

  return result;
}

export async function getAttendanceTrackingForAdmin(
  startDateKey: string,
  endDateKey: string
): Promise<AttendanceTrackingRow[]> {
  await requireAdmin();
  return buildAttendanceTrackingRows(startDateKey, endDateKey);
}

// Instructors have no NextAuth session in this app - viewing attendance is
// intentionally unrestricted here, mirroring the existing
// getDutyAssignmentsForInstructor precedent (every instructor can already
// see every student's duties/schedule this way). No student is exposed here
// that isn't already visible to instructors elsewhere. Only editing is
// gated - see updateAttendanceAsInstructor.
export async function getAttendanceTrackingForInstructor(
  startDateKey: string,
  endDateKey: string
): Promise<AttendanceTrackingRow[]> {
  return buildAttendanceTrackingRows(startDateKey, endDateKey);
}

function validateAttendanceInput(input: AttendanceInput): string | null {
  const parsed = attendanceInputSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "קלט לא תקין";
  if (input.status === "PARTIAL" && !input.arrivalTime && !input.departureTime) {
    return "יש להזין שעת הגעה או שעת עזיבה עבור נוכחות חלקית";
  }
  return null;
}

function timeOrNull(t?: string): string | null {
  return t && t.trim() ? t.trim() : null;
}

async function upsertAttendanceRecord(
  input: AttendanceInput,
  updatedByName: string | null
): Promise<AttendanceActionResult> {
  const error = validateAttendanceInput(input);
  if (error) return { success: false, error };

  const student = await prisma.student.findUnique({ where: { id: input.studentId } });
  if (!student) {
    return { success: false, error: "התלמיד/ה לא נמצא/ה" };
  }

  const date = parseDateKey(input.dateKey);
  const isPartial = input.status === "PARTIAL";
  // Only PARTIAL ever keeps arrival/departure times - cleared server-side
  // for PRESENT/ABSENT regardless of what the client sent.
  const arrivalTime = isPartial ? timeOrNull(input.arrivalTime) : null;
  const departureTime = isPartial ? timeOrNull(input.departureTime) : null;
  const notes = input.notes?.trim() || null;

  const saved = await prisma.studentAttendance.upsert({
    where: { studentId_date: { studentId: input.studentId, date } },
    update: { status: input.status, arrivalTime, departureTime, notes, updatedByName },
    create: {
      studentId: input.studentId,
      date,
      status: input.status,
      arrivalTime,
      departureTime,
      notes,
      updatedByName,
    },
  });

  revalidatePath("/admin/daily-tracking");
  revalidatePath("/instructor");

  return { success: true, row: toAttendanceRecord(saved) };
}

export async function upsertAttendanceAsAdmin(input: AttendanceInput): Promise<AttendanceActionResult> {
  const admin = await requireAdmin();
  return upsertAttendanceRecord(input, admin.name ?? admin.email);
}

// Instructors have no NextAuth session in this app, so the permission check
// re-reads canEditAttendance from the DB by instructorId on every call - it
// never trusts a client-supplied boolean. This is the only gate; UI hiding
// of edit controls is not relied upon.
export async function upsertAttendanceAsInstructor(
  instructorId: string,
  input: AttendanceInput
): Promise<AttendanceActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditAttendance) {
    return { success: false, error: "אין הרשאה לערוך נוכחות" };
  }
  return upsertAttendanceRecord(input, instructor.fullName);
}

// Explicit, admin-initiated action for the future "סמני גם כלא זמין/ה
// לתורנויות" button - never called automatically from the upsert actions
// above. Reuses the existing, unmodified setAvailability(); this wrapper
// only adds an explicit admin gate at this new call site.
export async function markStudentUnavailableForDuty(
  studentId: string,
  dateKeyStr: string
): Promise<ActionResult> {
  await requireAdmin();
  return setAvailability(studentId, dateKeyStr, false);
}
