"use server";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { dateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";
import type {
  StudentPresentationProgressFeedbackInput,
  StudentPresentationProgressFeedbackRow,
} from "@/lib/actions/student-presentation-progress-feedback";
import {
  PRESENTATION_BASE_SCORE,
  PRESENTATION_CATEGORY_KEYS,
  defaultPresentationCategoryScores,
  isValidPresentationCategoryScoreValue,
  sumPresentationCategoryScores,
  type PresentationCategoryKey,
  type PresentationCategoryScores,
} from "@/lib/presentation-rubric";
import { requireInstructorWithTraineeProgressAccess } from "@/lib/actions/trainee-progress-instructor-access";

// Instructor/coach read/create/update/delete surface for
// StudentPresentationProgressFeedback - the trainee-progress-journal
// counterpart to lib/actions/student-presentation-progress-feedback.ts's
// admin-only actions. That admin file is completely unmodified by this file
// and keeps seeing every row (admin- and instructor-created alike).
// lib/presentation-rubric.ts (the fixed 10-category rubric, base/passing
// score constants) is imported directly, never duplicated - it's already
// the intended shared source of truth for both admin and instructor code.
//
// Permission (Stage I1 product decision): deliberately reuses
// Instructor.canEditRidingNotes - admin UI label "עריכת הערות רכיבה" - same
// temporary, intentional choice as the sibling riding/lunge instructor
// action files (see student-riding-progress-feedback-instructor.ts's own
// comment for the full rationale). Not a dedicated permission.
//
// Ownership: same convention as the sibling instructor files -
// createdByInstructorId set on create, update/delete require
// row.createdByInstructorId to match the acting instructor.
//
// finalScore stays Decimal end-to-end here exactly as the admin action
// handles it: computed server-side, never accepted from the client, and
// converted to a plain JS number only when crossing the server-action
// boundary (Prisma.Decimal is a class instance and can't serialize as a
// server action return value) - see toRow below.

// Duplicated across the three instructor action files rather than
// extracted to a shared helper - see
// student-riding-progress-feedback-instructor.ts's own comment on this
// choice.
async function requireInstructorWithRidingNotesPermission(instructorId: string) {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return null;
  }
  return instructor;
}

// Duplicated from lib/actions/student-presentation-progress-feedback.ts
// rather than imported - see this stage's implementation report for the
// duplication-vs-extraction decision. (lib/presentation-rubric.ts itself,
// used by these helpers, is imported/shared, not duplicated - only the
// action-layer logic built on top of it is duplicated.)
function parseCategoryScores(value: unknown): PresentationCategoryScores {
  const scores = defaultPresentationCategoryScores();
  if (value === null || typeof value !== "object" || Array.isArray(value)) return scores;
  const record = value as Record<string, unknown>;
  for (const key of PRESENTATION_CATEGORY_KEYS) {
    const candidate = record[key];
    if (isValidPresentationCategoryScoreValue(candidate)) {
      scores[key] = candidate;
    }
  }
  return scores;
}

function sanitizeCategoryScores(input: unknown): PresentationCategoryScores | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;

  const knownKeys = new Set<string>(PRESENTATION_CATEGORY_KEYS);
  for (const key of Object.keys(record)) {
    if (!knownKeys.has(key)) return null;
  }

  const scores = defaultPresentationCategoryScores();
  for (const key of PRESENTATION_CATEGORY_KEYS) {
    if (key in record) {
      const value = record[key];
      if (!isValidPresentationCategoryScoreValue(value)) return null;
      scores[key as PresentationCategoryKey] = value;
    }
  }
  return scores;
}

function computeFinalScore(categoryScores: PresentationCategoryScores): number {
  return PRESENTATION_BASE_SCORE + sumPresentationCategoryScores(categoryScores);
}

function hasMeaningfulContent(input: {
  feedback: string | null;
  topic: string | null;
  presentationType: string | null;
  categoryScores: PresentationCategoryScores;
}): boolean {
  return (
    input.feedback !== null ||
    input.topic !== null ||
    input.presentationType !== null ||
    PRESENTATION_CATEGORY_KEYS.some((key) => input.categoryScores[key] !== 0)
  );
}

function toRow(row: {
  id: string;
  studentId: string;
  date: Date;
  baseScore: number;
  categoryScores: unknown;
  finalScore: Prisma.Decimal;
  feedback: string | null;
  topic: string | null;
  presentationType: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  createdByInstructorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StudentPresentationProgressFeedbackRow {
  return {
    id: row.id,
    studentId: row.studentId,
    date: dateKey(row.date),
    baseScore: row.baseScore,
    categoryScores: parseCategoryScores(row.categoryScores),
    finalScore: row.finalScore.toNumber(),
    feedback: row.feedback,
    topic: row.topic,
    presentationType: row.presentationType,
    createdByName: row.createdByName,
    updatedByName: row.updatedByName,
    createdByInstructorId: row.createdByInstructorId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Own rows only - see student-riding-progress-feedback-instructor.ts's own
// comment on the null-vs-empty-array contract this mirrors.
export async function listStudentPresentationProgressFeedbackForInstructor(
  instructorId: string,
  studentId?: string
): Promise<StudentPresentationProgressFeedbackRow[] | null> {
  const instructor = await requireInstructorWithRidingNotesPermission(instructorId);
  if (!instructor) return null;

  const rows = await prisma.studentPresentationProgressFeedback.findMany({
    where: { createdByInstructorId: instructor.id, ...(studentId ? { studentId } : {}) },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return rows.map(toRow);
}

// Same "view all, edit own" purpose as
// listStudentRidingProgressFeedbackForInstructorView - see that function's
// own comment. This is the wiring that was previously missing: the CRUD
// actions below already existed but were never called from any UI - this
// view-all read (plus the shared component rendering
// PresentationProgressFeedbackList with these CRUD actions when the acting
// instructor has canEditRidingNotes) is what actually exposes them.
export async function listStudentPresentationProgressFeedbackForInstructorView(
  instructorId: string,
  studentId: string
): Promise<StudentPresentationProgressFeedbackRow[] | null> {
  const instructor = await requireInstructorWithTraineeProgressAccess(instructorId);
  if (!instructor) return null;

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return null;

  const rows = await prisma.studentPresentationProgressFeedback.findMany({
    where: { studentId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return rows.map(toRow);
}

export async function createStudentPresentationProgressFeedbackAsInstructor(
  instructorId: string,
  studentId: string,
  input: StudentPresentationProgressFeedbackInput
): Promise<ActionResult> {
  const instructor = await requireInstructorWithRidingNotesPermission(instructorId);
  if (!instructor) return { success: false, error: "אין הרשאה להזין משוב פרזנטציה" };

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return { success: false, error: "חניך/ה לא נמצא/ה" };

  const date = new Date(input.date);
  if (Number.isNaN(date.getTime())) {
    return { success: false, error: "תאריך לא תקין" };
  }

  const categoryScores = sanitizeCategoryScores(input.categoryScores);
  if (categoryScores === null) {
    return { success: false, error: "ניקוד קטגוריה לא תקין - יש לבחור ערך מהרשימה עבור כל קטגוריה" };
  }

  const feedback = input.feedback?.trim() || null;
  const topic = input.topic?.trim() || null;
  const presentationType = input.presentationType?.trim() || null;

  if (!hasMeaningfulContent({ feedback, topic, presentationType, categoryScores })) {
    return { success: false, error: "יש להזין משוב, נושא, סוג פרזנטציה או ניקוד בקטגוריה כלשהי" };
  }

  await prisma.studentPresentationProgressFeedback.create({
    data: {
      studentId,
      date,
      baseScore: PRESENTATION_BASE_SCORE,
      categoryScores: categoryScores as unknown as Prisma.InputJsonValue,
      finalScore: computeFinalScore(categoryScores),
      feedback,
      topic,
      presentationType,
      createdByName: instructor.fullName,
      updatedByName: instructor.fullName,
      createdByInstructorId: instructor.id,
      updatedByInstructorId: instructor.id,
    },
  });

  return { success: true };
}

export async function updateStudentPresentationProgressFeedbackAsInstructor(
  instructorId: string,
  id: string,
  input: StudentPresentationProgressFeedbackInput
): Promise<ActionResult> {
  const instructor = await requireInstructorWithRidingNotesPermission(instructorId);
  if (!instructor) return { success: false, error: "אין הרשאה לערוך משוב פרזנטציה" };

  const existing = await prisma.studentPresentationProgressFeedback.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "הרשומה לא נמצאה" };
  if (existing.createdByInstructorId !== instructor.id) {
    return { success: false, error: "ניתן לערוך רק משובים שהוזנו על ידך" };
  }

  const date = new Date(input.date);
  if (Number.isNaN(date.getTime())) {
    return { success: false, error: "תאריך לא תקין" };
  }

  const categoryScores = sanitizeCategoryScores(input.categoryScores);
  if (categoryScores === null) {
    return { success: false, error: "ניקוד קטגוריה לא תקין - יש לבחור ערך מהרשימה עבור כל קטגוריה" };
  }

  const feedback = input.feedback?.trim() || null;
  const topic = input.topic?.trim() || null;
  const presentationType = input.presentationType?.trim() || null;

  if (!hasMeaningfulContent({ feedback, topic, presentationType, categoryScores })) {
    return { success: false, error: "יש להזין משוב, נושא, סוג פרזנטציה או ניקוד בקטגוריה כלשהי" };
  }

  // createdByInstructorId/createdByName are intentionally never touched
  // here - same "preserve original author" convention as the admin action.
  // baseScore/finalScore are always recomputed the same way create does -
  // baseScore is never client-controlled, finalScore is always freshly
  // derived from this update's own categoryScores.
  await prisma.studentPresentationProgressFeedback.update({
    where: { id },
    data: {
      date,
      baseScore: PRESENTATION_BASE_SCORE,
      categoryScores: categoryScores as unknown as Prisma.InputJsonValue,
      finalScore: computeFinalScore(categoryScores),
      feedback,
      topic,
      presentationType,
      updatedByName: instructor.fullName,
      updatedByInstructorId: instructor.id,
    },
  });

  return { success: true };
}
