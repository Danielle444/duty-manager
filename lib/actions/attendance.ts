"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getCurrentInstructor, getCurrentTrainee } from "@/lib/auth/actor";
import { dateKey, parseDateKey, enumerateDateKeys } from "@/lib/dates";
import { setAvailability } from "@/lib/actions/availability";
import { syncAttendanceMarkedNotification } from "@/lib/actions/notifications";
import {
  loadInstructorAttendanceTrackingWithDeps,
  loadStudentAttendanceNoticeWithDeps,
} from "@/lib/actions/attendance-read-auth";
import {
  upsertInstructorAttendanceWithDeps,
  clearInstructorAttendanceWithDeps,
} from "@/lib/actions/attendance-write-auth";
import { resolveCurrentAttendanceCapabilityAccess } from "@/lib/course/capabilities/current-attendance-capability";
import type { ActionResult } from "@/lib/actions/students";

const attendanceStatusSchema = z.enum(["PRESENT", "ABSENT", "PARTIAL"]);
export type AttendanceStatusValue = z.infer<typeof attendanceStatusSchema>;

const timeSchema = z
  .union([z.literal(""), z.string().regex(/^\d{1,2}:\d{2}$/, "פורמט שעה לא תקין (HH:MM)")])
  .optional();

const attendanceInputSchema = z.object({
  studentId: z.string().min(1, "יש לבחור חניך/ה"),
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
  // Raw Student horse fields (no schema change - already existed on
  // Student), shaped to match HorseInfoInput so callers can pass a row
  // straight into getHorseDisplayInfo() from lib/horse-info.ts.
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

// Compact per-cell shape for a future week-view pivot grid, derived from an
// AttendanceTrackingRow rather than fetched separately.
export interface AttendanceDayCell {
  dateKey: string;
  status: AttendanceStatusValue | null;
  hasWarnings: boolean;
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
      message: "החניך/ה נעדר/ת אך משובץ/ת לתורנות ביום זה",
    });
  }
  if (!isAvailable && assignedDuty) {
    warnings.push({
      type: "UNAVAILABLE_WITH_DUTY",
      message: "החניך/ה מסומן/ת כלא זמין/ה אך משובץ/ת לתורנות ביום זה",
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
      select: {
        id: true,
        fullName: true,
        groupName: true,
        subgroupNumber: true,
        hasPrivateHorse: true,
        privateHorseName: true,
        assignedHorseName: true,
      },
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
        hasPrivateHorse: student.hasPrivateHorse,
        privateHorseName: student.privateHorseName,
        assignedHorseName: student.assignedHorseName,
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

// ATT-SEC-1: authenticated instructors only. Identity is derived from the
// signed session via the canonical actor DAL (getCurrentInstructor) - never
// from a client-supplied instructorId (there is no such parameter). A missing/
// invalid/inactive/wrong-audience session yields a null actor and this fails
// closed to [] (the same fail-closed read convention as getStudentContacts),
// revealing nothing. Viewing is intentionally NOT gated on canEditAttendance:
// per the StudentAttendance/canEditAttendance schema note, all instructors may
// view attendance and that flag gates editing only (see the *AsInstructor write
// actions). The returned DTO and date-range behaviour are unchanged for a valid
// active instructor. The pure gate + delegation lives in ./attendance-read-auth
// so it is unit-testable without a session or a database.
export async function getAttendanceTrackingForInstructor(
  startDateKey: string,
  endDateKey: string
): Promise<AttendanceTrackingRow[]> {
  return loadInstructorAttendanceTrackingWithDeps(
    { getCurrentInstructor, buildRows: buildAttendanceTrackingRows },
    startDateKey,
    endDateKey
  );
}

export interface StudentAttendanceNotice {
  dateKey: string;
  status: "ABSENT" | "PARTIAL";
  arrivalTime: string | null;
  departureTime: string | null;
  notes: string | null;
}

// ATT-SEC-1: the current trainee's OWN notice only. Identity is derived from
// the signed session via the canonical actor DAL (getCurrentTrainee) - the
// public signature no longer accepts a studentId, so a caller can never select
// another trainee's row (the previous version trusted a client-supplied
// studentId). The injected reader is scoped to exactly the authenticated
// trainee's id + date. A missing/invalid/inactive/wrong-audience session yields
// a null actor and returns null. Behaviour is otherwise unchanged: a missing
// record or a PRESENT status returns null, only ABSENT/PARTIAL are surfaced, and
// notes/time fields are preserved. The pure gate + shaping lives in
// ./attendance-read-auth so it is unit-testable without a session or a database.
export async function getStudentAttendanceNotice(
  dateKeyStr: string
): Promise<StudentAttendanceNotice | null> {
  return loadStudentAttendanceNoticeWithDeps(
    {
      getCurrentTrainee,
      readAttendanceRow: (studentId, dk) =>
        prisma.studentAttendance.findUnique({
          where: { studentId_date: { studentId, date: parseDateKey(dk) } },
          select: {
            status: true,
            arrivalTime: true,
            departureTime: true,
            notes: true,
          },
        }),
    },
    dateKeyStr
  );
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
    return { success: false, error: "החניך/ה לא נמצא/ה" };
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

  await syncAttendanceMarkedNotification({
    studentId: saved.studentId,
    attendanceId: saved.id,
    status: saved.status,
    notes: saved.notes,
  });

  revalidatePath("/admin/daily-tracking");
  revalidatePath("/instructor");

  return { success: true, row: toAttendanceRecord(saved) };
}

export async function upsertAttendanceAsAdmin(input: AttendanceInput): Promise<AttendanceActionResult> {
  const admin = await requireAdmin();
  return upsertAttendanceRecord(input, admin.name ?? admin.email);
}

// ATT-SEC-2: authenticated instructors only. Identity is derived from the
// signed session via the canonical actor DAL (getCurrentInstructor) - never
// from a client-supplied instructorId (there is no such parameter anymore; the
// previous version trusted a client id, letting a caller borrow another
// instructor's edit permission and stamp that instructor's name as authorship).
// A missing/invalid/inactive/wrong-audience/subject-mismatched session yields a
// null actor and the write is rejected before any mutation; an authenticated
// instructor whose canEditAttendance is false is likewise rejected. Authorship
// (updatedByName) is the server-derived actor's own fullName. The existing
// payload validation + upsert (and its unchanged success/error contract) run
// only for an authorized actor. The pure gate + delegation lives in
// ./attendance-write-auth so it is unit-testable without a session or database.
// ATT-3W: the write now ALSO requires the current CourseOffering's ATTENDANCE
// capability to permit writes (canWrite === true), injected as the parameterless
// server-owned resolveCurrentAttendanceCapabilityAccess. It is an ADDITIONAL
// restriction checked only AFTER the actor + canEditAttendance gate, so it never
// weakens the existing actor authorization and no client-supplied offering
// identity is accepted.
export async function upsertAttendanceAsInstructor(
  input: AttendanceInput
): Promise<AttendanceActionResult> {
  return upsertInstructorAttendanceWithDeps(
    {
      getCurrentInstructor,
      resolveAttendanceAccess: resolveCurrentAttendanceCapabilityAccess,
      upsertRecord: upsertAttendanceRecord,
    },
    input
  );
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

// Returns a student/date back to "no known absence" by deleting the
// StudentAttendance row entirely (including its notes) rather than writing
// a PRESENT row to represent the default state - a missing row is always
// the default, never a stored status. deleteMany is a no-op (not an error)
// if no row exists.
export async function clearAttendanceAsAdmin(
  studentId: string,
  dateKeyStr: string
): Promise<ActionResult> {
  await requireAdmin();
  const date = parseDateKey(dateKeyStr);
  await prisma.studentAttendance.deleteMany({ where: { studentId, date } });

  revalidatePath("/admin/daily-tracking");
  revalidatePath("/instructor");
  return { success: true };
}

// Delete-then-revalidate mutator shared by the instructor clear path (the same
// body clearAttendanceAsAdmin runs inline). Deliberately unauthenticated: it is
// a private helper, never exported and never registered as a Server Action, and
// is only reached after the caller has passed its own authorization gate.
async function clearAttendanceRecord(
  studentId: string,
  dateKeyStr: string
): Promise<ActionResult> {
  const date = parseDateKey(dateKeyStr);
  await prisma.studentAttendance.deleteMany({ where: { studentId, date } });

  revalidatePath("/admin/daily-tracking");
  revalidatePath("/instructor");
  return { success: true };
}

// ATT-SEC-2: same delete behavior as clearAttendanceAsAdmin, but the instructor
// identity is now derived from the signed session via getCurrentInstructor -
// never from a client-supplied instructorId (removed). A null actor
// (unauthenticated / invalid / inactive / wrong-audience / subject-mismatched)
// or an actor whose canEditAttendance is false is rejected before any delete.
// studentId/dateKeyStr remain the client-supplied TARGET of the authorized
// clear (not actor identity) and are passed through unchanged. The pure gate +
// delegation lives in ./attendance-write-auth. ATT-3W: the clear now ALSO
// requires the current CourseOffering's ATTENDANCE capability to permit writes
// (canWrite === true), injected as the parameterless server-owned
// resolveCurrentAttendanceCapabilityAccess - an ADDITIONAL restriction checked
// only AFTER the actor + canEditAttendance gate, so it never weakens the
// existing actor authorization and no client-supplied offering identity is
// accepted.
export async function clearAttendanceAsInstructor(
  studentId: string,
  dateKeyStr: string
): Promise<ActionResult> {
  return clearInstructorAttendanceWithDeps(
    {
      getCurrentInstructor,
      resolveAttendanceAccess: resolveCurrentAttendanceCapabilityAccess,
      clearRecord: clearAttendanceRecord,
    },
    studentId,
    dateKeyStr
  );
}
