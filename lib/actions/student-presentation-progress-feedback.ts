"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";

// Admin-only, read/create/update surface for manager-entered פרזנטציה
// progress feedback - a standalone journal per trainee, structurally
// identical to lib/actions/student-riding-progress-feedback.ts and
// lib/actions/student-lunge-progress-feedback.ts (same pattern: NOT
// per-session, no relation to ScheduleItem/RidingSlot/TeachingPracticeLesson).
// No instructor/student variant in this stage - admin-only.

export interface StudentPresentationProgressFeedbackRow {
  id: string;
  studentId: string;
  date: string;
  ratingHalfPoints: number | null;
  feedback: string | null;
  topic: string | null;
  presentationType: string | null;
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
  topic: string | null;
  presentationType: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StudentPresentationProgressFeedbackRow {
  return {
    id: row.id,
    studentId: row.studentId,
    date: dateKey(row.date),
    ratingHalfPoints: row.ratingHalfPoints,
    feedback: row.feedback,
    topic: row.topic,
    presentationType: row.presentationType,
    createdByName: row.createdByName,
    updatedByName: row.updatedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Same rating range/half-point convention as RidingLessonNote/
// TeachingPracticeFeedback/StudentRidingProgressFeedback/
// StudentLungeProgressFeedback (2-10, i.e. 1.0-5.0 in 0.5 steps) - validated
// here in the action layer, not the schema, same as those.
function isValidRatingHalfPoints(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value >= 2 && value <= 10);
}

// A row must carry at least one real piece of content - never allowed to be
// saved completely empty. Same broader shape as StudentLungeProgressFeedback's
// own hasMeaningfulContent (rating, feedback, or any of the descriptive
// fields), since a פרזנטציה entry may meaningfully record only "what kind of
// presentation, on what topic," with no rating or free-text feedback at all.
function hasMeaningfulContent(input: {
  ratingHalfPoints: number | null;
  feedback: string | null;
  topic: string | null;
  presentationType: string | null;
}): boolean {
  return (
    input.ratingHalfPoints !== null ||
    input.feedback !== null ||
    input.topic !== null ||
    input.presentationType !== null
  );
}

export async function listStudentPresentationProgressFeedbackForAdmin(
  studentId: string
): Promise<StudentPresentationProgressFeedbackRow[] | null> {
  await requireAdmin();

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return null;

  const rows = await prisma.studentPresentationProgressFeedback.findMany({
    where: { studentId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return rows.map(toRow);
}

export interface StudentPresentationProgressFeedbackInput {
  date: string;
  ratingHalfPoints: number | null;
  feedback: string | null;
  topic: string | null;
  presentationType: string | null;
}

export async function createStudentPresentationProgressFeedbackAsAdmin(
  studentId: string,
  input: StudentPresentationProgressFeedbackInput
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
  const topic = input.topic?.trim() || null;
  const presentationType = input.presentationType?.trim() || null;

  if (!hasMeaningfulContent({ ratingHalfPoints, feedback, topic, presentationType })) {
    return { success: false, error: "יש להזין דירוג, משוב, נושא או סוג פרזנטציה" };
  }

  const adminName = admin.name ?? admin.email;

  await prisma.studentPresentationProgressFeedback.create({
    data: {
      studentId,
      date,
      ratingHalfPoints,
      feedback,
      topic,
      presentationType,
      createdByName: adminName,
      updatedByName: adminName,
    },
  });

  return { success: true };
}

export async function updateStudentPresentationProgressFeedbackAsAdmin(
  id: string,
  input: StudentPresentationProgressFeedbackInput
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const existing = await prisma.studentPresentationProgressFeedback.findUnique({ where: { id } });
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
  const topic = input.topic?.trim() || null;
  const presentationType = input.presentationType?.trim() || null;

  if (!hasMeaningfulContent({ ratingHalfPoints, feedback, topic, presentationType })) {
    return { success: false, error: "יש להזין דירוג, משוב, נושא או סוג פרזנטציה" };
  }

  // createdByName is intentionally never touched here - it stays whoever
  // originally wrote the entry, even when a different admin later edits it.
  await prisma.studentPresentationProgressFeedback.update({
    where: { id },
    data: {
      date,
      ratingHalfPoints,
      feedback,
      topic,
      presentationType,
      updatedByName: admin.name ?? admin.email,
    },
  });

  return { success: true };
}

// Hard delete - no soft-delete flag on this model, no cascade concerns
// beyond this one row (StudentPresentationProgressFeedback has no child
// records of its own). Never touches Student or any other model.
export async function deleteStudentPresentationProgressFeedbackAsAdmin(id: string): Promise<ActionResult> {
  await requireAdmin();

  const existing = await prisma.studentPresentationProgressFeedback.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "הרשומה לא נמצאה" };

  await prisma.studentPresentationProgressFeedback.delete({ where: { id } });

  return { success: true };
}
