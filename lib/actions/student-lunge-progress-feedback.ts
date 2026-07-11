"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";

// Admin-only, read/create/update surface for manager-entered "לונג׳ בלי
// רוכב" progress feedback - a standalone journal per trainee, structurally
// identical to lib/actions/student-riding-progress-feedback.ts (same
// StudentRidingProgressFeedback pattern: NOT per-session, no relation to
// ScheduleItem/RidingSlot). Deliberately unrelated to
// TeachingPracticeFeedback/TeachingPracticeLesson - a LUNGE-practiceType
// Teaching Practice lesson is "לונג׳ עם רוכב/ילד," a completely different,
// already-existing concept (see lib/actions/teaching-practice-feedback-history.ts
// and StudentLungeProgressFeedback's own schema comment). No instructor/
// student variant in this stage - admin-only.

export interface StudentLungeProgressFeedbackRow {
  id: string;
  studentId: string;
  date: string;
  ratingHalfPoints: number | null;
  feedback: string | null;
  horseName: string | null;
  topic: string | null;
  instructorName: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

function toRow(row: {
  id: string;
  studentId: string;
  date: Date;
  ratingHalfPoints: number | null;
  feedback: string | null;
  horseName: string | null;
  topic: string | null;
  instructorName: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StudentLungeProgressFeedbackRow {
  return {
    id: row.id,
    studentId: row.studentId,
    date: dateKey(row.date),
    ratingHalfPoints: row.ratingHalfPoints,
    feedback: row.feedback,
    horseName: row.horseName,
    topic: row.topic,
    instructorName: row.instructorName,
    createdByName: row.createdByName,
    updatedByName: row.updatedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Same rating range/half-point convention as RidingLessonNote/
// TeachingPracticeFeedback/StudentRidingProgressFeedback (2-10, i.e.
// 1.0-5.0 in 0.5 steps) - validated here in the action layer, not the
// schema, same as those.
function isValidRatingHalfPoints(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value >= 2 && value <= 10);
}

// A row must carry at least one real piece of content - never allowed to be
// saved completely empty. Broader than StudentRidingProgressFeedback's own
// hasMeaningfulContent (rating or feedback only): horseName/topic/
// instructorName also count here, since a לונג׳-בלי-רוכב entry may
// meaningfully record only "who worked the horse and on what," with no
// rating or free-text feedback at all.
function hasMeaningfulContent(input: {
  ratingHalfPoints: number | null;
  feedback: string | null;
  horseName: string | null;
  topic: string | null;
  instructorName: string | null;
}): boolean {
  return (
    input.ratingHalfPoints !== null ||
    input.feedback !== null ||
    input.horseName !== null ||
    input.topic !== null ||
    input.instructorName !== null
  );
}

export async function listStudentLungeProgressFeedbackForAdmin(
  studentId: string
): Promise<StudentLungeProgressFeedbackRow[] | null> {
  await requireAdmin();

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return null;

  const rows = await prisma.studentLungeProgressFeedback.findMany({
    where: { studentId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return rows.map(toRow);
}

export interface StudentLungeProgressFeedbackInput {
  date: string;
  ratingHalfPoints: number | null;
  feedback: string | null;
  horseName: string | null;
  topic: string | null;
  instructorName: string | null;
}

export async function createStudentLungeProgressFeedbackAsAdmin(
  studentId: string,
  input: StudentLungeProgressFeedbackInput
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return { success: false, error: "חניך/ה לא נמצא/ה" };

  const date = new Date(input.date);
  if (Number.isNaN(date.getTime())) {
    return { success: false, error: "תאריך לא תקין" };
  }

  const ratingHalfPoints = input.ratingHalfPoints ?? null;
  if (!isValidRatingHalfPoints(ratingHalfPoints)) {
    return { success: false, error: "דירוג לא תקין" };
  }

  const feedback = input.feedback?.trim() || null;
  const horseName = input.horseName?.trim() || null;
  const topic = input.topic?.trim() || null;
  const instructorName = input.instructorName?.trim() || null;

  if (!hasMeaningfulContent({ ratingHalfPoints, feedback, horseName, topic, instructorName })) {
    return { success: false, error: "יש להזין דירוג, משוב, סוס, נושא או שם מדריך/ה" };
  }

  const adminName = admin.name ?? admin.email;

  await prisma.studentLungeProgressFeedback.create({
    data: {
      studentId,
      date,
      ratingHalfPoints,
      feedback,
      horseName,
      topic,
      instructorName,
      createdByName: adminName,
      updatedByName: adminName,
    },
  });

  return { success: true };
}

export async function updateStudentLungeProgressFeedbackAsAdmin(
  id: string,
  input: StudentLungeProgressFeedbackInput
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const existing = await prisma.studentLungeProgressFeedback.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "הרשומה לא נמצאה" };

  const date = new Date(input.date);
  if (Number.isNaN(date.getTime())) {
    return { success: false, error: "תאריך לא תקין" };
  }

  const ratingHalfPoints = input.ratingHalfPoints ?? null;
  if (!isValidRatingHalfPoints(ratingHalfPoints)) {
    return { success: false, error: "דירוג לא תקין" };
  }

  const feedback = input.feedback?.trim() || null;
  const horseName = input.horseName?.trim() || null;
  const topic = input.topic?.trim() || null;
  const instructorName = input.instructorName?.trim() || null;

  if (!hasMeaningfulContent({ ratingHalfPoints, feedback, horseName, topic, instructorName })) {
    return { success: false, error: "יש להזין דירוג, משוב, סוס, נושא או שם מדריך/ה" };
  }

  // createdByName is intentionally never touched here - it stays whoever
  // originally wrote the entry, even when a different admin later edits it.
  await prisma.studentLungeProgressFeedback.update({
    where: { id },
    data: {
      date,
      ratingHalfPoints,
      feedback,
      horseName,
      topic,
      instructorName,
      updatedByName: admin.name ?? admin.email,
    },
  });

  return { success: true };
}

// Hard delete - no soft-delete flag on this model, no cascade concerns
// beyond this one row (StudentLungeProgressFeedback has no child records of
// its own). Never touches Student or any other model.
export async function deleteStudentLungeProgressFeedbackAsAdmin(id: string): Promise<ActionResult> {
  await requireAdmin();

  const existing = await prisma.studentLungeProgressFeedback.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "הרשומה לא נמצאה" };

  await prisma.studentLungeProgressFeedback.delete({ where: { id } });

  return { success: true };
}
