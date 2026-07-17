"use server";

import { prisma } from "@/lib/prisma";
import { dateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";
import type {
  StudentRidingProgressFeedbackInput,
  StudentRidingProgressFeedbackRow,
} from "@/lib/actions/student-riding-progress-feedback";
import { requireInstructorWithTraineeProgressAccess } from "@/lib/actions/trainee-progress-instructor-access";

// Instructor/coach read/create/update/delete surface for
// StudentRidingProgressFeedback - the trainee-progress-journal counterpart
// to lib/actions/student-riding-progress-feedback.ts's admin-only actions.
// That admin file is completely unmodified by this file and keeps seeing
// every row (admin- and instructor-created alike) regardless of who wrote
// it. Never touches RidingLessonNote - the existing "הדרכת מתקדמים"
// instructor flow (upsertRidingLessonNoteAsInstructor), which happens to be
// gated by the same canEditRidingNotes flag but is otherwise a completely
// separate model/screen.
//
// Permission (Stage I1 product decision): deliberately reuses
// Instructor.canEditRidingNotes - admin UI label "עריכת הערות רכיבה" - as
// the gate for this journal, rather than a dedicated permission. This is
// intentional and temporary, not an oversight: canEditRidingNotes today
// also gates RidingLessonNote edits, so an instructor granted that flag now
// additionally gets create/edit/delete access to this trainee-progress
// journal (and the לונג׳/פרזנטציה journals in the two sibling instructor
// action files) with no separate admin action required. Revisit with a
// dedicated permission once real usage shows whether that's actually fine.
//
// Ownership: every row created here gets createdByInstructorId set to the
// acting instructor's id (and createdByName to their fullName, same
// denormalized-snapshot convention every model in this app already uses).
// Update/delete are only permitted when row.createdByInstructorId matches
// the acting instructor - an instructor can never touch another
// instructor's or an admin's row (admin-created rows always have
// createdByInstructorId = null, which never equals a real instructor id).

// Re-checks the instructor fresh from the DB on every call - the caller-
// supplied instructorId is never trusted for identity, and the permission
// flag is never trusted from a cached client session, same "never trust
// the client" discipline as every other instructor action in this app
// (e.g. upsertRidingLessonNoteAsInstructor). Duplicated (not extracted to a
// shared helper) in the two sibling instructor action files
// (student-lunge-progress-feedback-instructor.ts,
// student-presentation-progress-feedback-instructor.ts) - see this stage's
// implementation report for why: keeps each new action file self-contained
// and independently reviewable; worth extracting if a 4th caller appears.
async function requireInstructorWithRidingNotesPermission(instructorId: string) {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return null;
  }
  return instructor;
}

// Duplicated from lib/actions/student-riding-progress-feedback.ts rather
// than imported - see this stage's implementation report for the
// duplication-vs-extraction decision.
function isValidRatingHalfPoints(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value >= 2 && value <= 10);
}

function hasMeaningfulContent(ratingHalfPoints: number | null, feedback: string | null): boolean {
  return ratingHalfPoints !== null || (feedback?.trim() ?? "") !== "";
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
  createdByInstructorId: string | null;
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
    createdByInstructorId: row.createdByInstructorId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Own rows only - never another instructor's or an admin's row. studentId
// is optional: omit it to list every trainee this instructor has ever
// written a row for, or pass it to scope to one trainee (the screen's
// typical use). Returns null when the instructor doesn't exist, is
// inactive, or lacks canEditRidingNotes - never a partial/empty result for
// a permission failure, so a caller can't mistake "not permitted" for
// "permitted but nothing written yet" (which is a real, valid `[]`).
export async function listStudentRidingProgressFeedbackForInstructor(
  instructorId: string,
  studentId?: string
): Promise<StudentRidingProgressFeedbackRow[] | null> {
  const instructor = await requireInstructorWithRidingNotesPermission(instructorId);
  if (!instructor) return null;

  const rows = await prisma.studentRidingProgressFeedback.findMany({
    where: { createdByInstructorId: instructor.id, ...(studentId ? { studentId } : {}) },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return rows.map(toRow);
}

// The shared trainee-progress detail view's counterpart to
// listStudentRidingProgressFeedbackForAdmin - EVERY row for the trainee
// (admin- and every instructor-created alike), not just this instructor's
// own, so the instructor sees the exact same "רכיבה" section content the
// manager sees (goal: "same progress information"). Gated by
// requireInstructorWithTraineeProgressAccess (canEditRidingNotes OR
// canEditTeachingPracticeFeedback) rather than
// requireInstructorWithRidingNotesPermission above - viewing this section is
// part of the full-page-access grant, not itself gated to the narrower
// riding-notes permission; only create/update/delete stay gated to
// canEditRidingNotes (via the unchanged functions below). The returned
// row's createdByInstructorId lets the caller decide, per row, whether to
// show edit/delete controls for the acting instructor (never trusted to
// enforce anything on its own - update/delete below still re-check
// ownership server-side regardless of what the UI shows).
export async function listStudentRidingProgressFeedbackForInstructorView(
  instructorId: string,
  studentId: string
): Promise<StudentRidingProgressFeedbackRow[] | null> {
  const instructor = await requireInstructorWithTraineeProgressAccess(instructorId);
  if (!instructor) return null;

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return null;

  const rows = await prisma.studentRidingProgressFeedback.findMany({
    where: { studentId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return rows.map(toRow);
}

export async function createStudentRidingProgressFeedbackAsInstructor(
  instructorId: string,
  studentId: string,
  input: StudentRidingProgressFeedbackInput
): Promise<ActionResult> {
  const instructor = await requireInstructorWithRidingNotesPermission(instructorId);
  if (!instructor) return { success: false, error: "אין הרשאה להזין משוב רכיבה" };

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

  await prisma.studentRidingProgressFeedback.create({
    data: {
      studentId,
      date,
      ratingHalfPoints,
      feedback,
      horseName,
      topic,
      createdByName: instructor.fullName,
      updatedByName: instructor.fullName,
      createdByInstructorId: instructor.id,
      updatedByInstructorId: instructor.id,
    },
  });

  return { success: true };
}

export async function updateStudentRidingProgressFeedbackAsInstructor(
  instructorId: string,
  id: string,
  input: StudentRidingProgressFeedbackInput
): Promise<ActionResult> {
  const instructor = await requireInstructorWithRidingNotesPermission(instructorId);
  if (!instructor) return { success: false, error: "אין הרשאה לערוך משוב רכיבה" };

  const existing = await prisma.studentRidingProgressFeedback.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "הרשומה לא נמצאה" };
  if (existing.createdByInstructorId !== instructor.id) {
    return { success: false, error: "ניתן לערוך רק משובים שהוזנו על ידך" };
  }

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

  // createdByInstructorId/createdByName are intentionally never touched
  // here - same "preserve original author" convention as the admin action.
  await prisma.studentRidingProgressFeedback.update({
    where: { id },
    data: {
      date,
      ratingHalfPoints,
      feedback,
      horseName,
      topic,
      updatedByName: instructor.fullName,
      updatedByInstructorId: instructor.id,
    },
  });

  return { success: true };
}
