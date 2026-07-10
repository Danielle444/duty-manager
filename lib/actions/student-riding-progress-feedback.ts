"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";

// Admin-only, read/create/update surface for manager-entered riding
// progress feedback - a standalone journal per trainee, NOT per scheduled
// session, and NOT related to ScheduleItem/RidingSlot/RidingLessonNote (see
// StudentRidingProgressFeedback's own schema comment). Never touches
// RidingLessonNote or any Teaching Practice/weekly feedback model. No
// instructor/student variant in this stage - admin-only.

export interface StudentRidingProgressFeedbackRow {
  id: string;
  studentId: string;
  date: string;
  ratingHalfPoints: number | null;
  feedback: string | null;
  horseName: string | null;
  topic: string | null;
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
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StudentRidingProgressFeedbackRow {
  return {
    id: row.id,
    studentId: row.studentId,
    date: dateKey(row.date),
    ratingHalfPoints: row.ratingHalfPoints,
    feedback: row.feedback,
    horseName: row.horseName,
    topic: row.topic,
    createdByName: row.createdByName,
    updatedByName: row.updatedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Same rating range/half-point convention as RidingLessonNote/
// TeachingPracticeFeedback (2-10, i.e. 1.0-5.0 in 0.5 steps) - validated
// here in the action layer, not the schema, same as those two.
function isValidRatingHalfPoints(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value >= 2 && value <= 10);
}

// A row must carry a real rating or real feedback text - never allowed to
// be saved completely empty, same "meaningful content" guard convention as
// hasMeaningfulTeachingPracticeFeedback, duplicated here (not imported)
// since that helper's name ties it to Teaching Practice specifically and
// this is an unrelated feature that happens to share the same shape.
function hasMeaningfulContent(ratingHalfPoints: number | null, feedback: string | null): boolean {
  return ratingHalfPoints !== null || (feedback?.trim() ?? "") !== "";
}

export async function listStudentRidingProgressFeedbackForAdmin(
  studentId: string
): Promise<StudentRidingProgressFeedbackRow[] | null> {
  await requireAdmin();

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return null;

  const rows = await prisma.studentRidingProgressFeedback.findMany({
    where: { studentId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return rows.map(toRow);
}

export interface StudentRidingProgressFeedbackInput {
  date: string;
  ratingHalfPoints: number | null;
  feedback: string | null;
  horseName: string | null;
  topic: string | null;
}

export async function createStudentRidingProgressFeedbackAsAdmin(
  studentId: string,
  input: StudentRidingProgressFeedbackInput
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
  if (!hasMeaningfulContent(ratingHalfPoints, feedback)) {
    return { success: false, error: "יש להזין דירוג או משוב" };
  }

  const horseName = input.horseName?.trim() || null;
  const topic = input.topic?.trim() || null;
  const adminName = admin.name ?? admin.email;

  await prisma.studentRidingProgressFeedback.create({
    data: {
      studentId,
      date,
      ratingHalfPoints,
      feedback,
      horseName,
      topic,
      createdByName: adminName,
      updatedByName: adminName,
    },
  });

  return { success: true };
}

export async function updateStudentRidingProgressFeedbackAsAdmin(
  id: string,
  input: StudentRidingProgressFeedbackInput
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const existing = await prisma.studentRidingProgressFeedback.findUnique({ where: { id } });
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
  if (!hasMeaningfulContent(ratingHalfPoints, feedback)) {
    return { success: false, error: "יש להזין דירוג או משוב" };
  }

  const horseName = input.horseName?.trim() || null;
  const topic = input.topic?.trim() || null;

  // createdByName is intentionally never touched here - it stays whoever
  // originally wrote the entry, even when a different admin later edits it.
  await prisma.studentRidingProgressFeedback.update({
    where: { id },
    data: {
      date,
      ratingHalfPoints,
      feedback,
      horseName,
      topic,
      updatedByName: admin.name ?? admin.email,
    },
  });

  return { success: true };
}

// Hard delete - no soft-delete flag on this model, no cascade concerns
// beyond this one row (StudentRidingProgressFeedback has no child records
// of its own). Never touches Student or any other model.
export async function deleteStudentRidingProgressFeedbackAsAdmin(id: string): Promise<ActionResult> {
  await requireAdmin();

  const existing = await prisma.studentRidingProgressFeedback.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "הרשומה לא נמצאה" };

  await prisma.studentRidingProgressFeedback.delete({ where: { id } });

  return { success: true };
}
