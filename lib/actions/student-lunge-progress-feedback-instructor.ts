"use server";

import { prisma } from "@/lib/prisma";
import { dateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";
import type {
  StudentLungeProgressFeedbackInput,
  StudentLungeProgressFeedbackRow,
} from "@/lib/actions/student-lunge-progress-feedback";
import { requireInstructorWithTraineeProgressAccess } from "@/lib/actions/trainee-progress-instructor-access";

// Instructor/coach read/create/update/delete surface for
// StudentLungeProgressFeedback ("לונג׳ בלי רוכב") - the trainee-progress-
// journal counterpart to lib/actions/student-lunge-progress-feedback.ts's
// admin-only actions. That admin file is completely unmodified by this file
// and keeps seeing every row (admin- and instructor-created alike). Never
// touches TeachingPracticeFeedback/TeachingPracticeLesson - a LUNGE-
// practiceType Teaching Practice lesson is "לונג׳ עם רוכב/ילד," a
// completely different, already-existing concept with its own instructor
// flow gated by canEditTeachingPracticeFeedback.
//
// Permission (Stage I1 product decision): deliberately reuses
// Instructor.canEditRidingNotes - admin UI label "עריכת הערות רכיבה" - same
// temporary, intentional choice as
// student-riding-progress-feedback-instructor.ts (see that file's own
// comment for the full rationale). Not a dedicated permission.
//
// Ownership: same convention as the sibling riding-progress instructor
// file - createdByInstructorId set on create, update/delete require
// row.createdByInstructorId to match the acting instructor.

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

// Duplicated from lib/actions/student-lunge-progress-feedback.ts rather
// than imported - see this stage's implementation report for the
// duplication-vs-extraction decision.
function isValidRatingHalfPoints(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value >= 2 && value <= 10);
}

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
  createdByInstructorId: string | null;
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
    createdByInstructorId: row.createdByInstructorId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Own rows only - see student-riding-progress-feedback-instructor.ts's own
// comment on the null-vs-empty-array contract this mirrors.
export async function listStudentLungeProgressFeedbackForInstructor(
  instructorId: string,
  studentId?: string
): Promise<StudentLungeProgressFeedbackRow[] | null> {
  const instructor = await requireInstructorWithRidingNotesPermission(instructorId);
  if (!instructor) return null;

  const rows = await prisma.studentLungeProgressFeedback.findMany({
    where: { createdByInstructorId: instructor.id, ...(studentId ? { studentId } : {}) },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return rows.map(toRow);
}

// Same "view all, edit own" purpose as
// listStudentRidingProgressFeedbackForInstructorView - see that function's
// own comment.
export async function listStudentLungeProgressFeedbackForInstructorView(
  instructorId: string,
  studentId: string
): Promise<StudentLungeProgressFeedbackRow[] | null> {
  const instructor = await requireInstructorWithTraineeProgressAccess(instructorId);
  if (!instructor) return null;

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return null;

  const rows = await prisma.studentLungeProgressFeedback.findMany({
    where: { studentId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return rows.map(toRow);
}

export async function createStudentLungeProgressFeedbackAsInstructor(
  instructorId: string,
  studentId: string,
  input: StudentLungeProgressFeedbackInput
): Promise<ActionResult> {
  const instructor = await requireInstructorWithRidingNotesPermission(instructorId);
  if (!instructor) return { success: false, error: "אין הרשאה להזין משוב לונג׳" };

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
  const instructorNameField = input.instructorName?.trim() || null;

  if (!hasMeaningfulContent({ ratingHalfPoints, feedback, horseName, topic, instructorName: instructorNameField })) {
    return { success: false, error: "יש להזין דירוג, משוב, סוס, נושא או שם מדריך/ה" };
  }

  await prisma.studentLungeProgressFeedback.create({
    data: {
      studentId,
      date,
      ratingHalfPoints,
      feedback,
      horseName,
      topic,
      instructorName: instructorNameField,
      createdByName: instructor.fullName,
      updatedByName: instructor.fullName,
      createdByInstructorId: instructor.id,
      updatedByInstructorId: instructor.id,
    },
  });

  return { success: true };
}

export async function updateStudentLungeProgressFeedbackAsInstructor(
  instructorId: string,
  id: string,
  input: StudentLungeProgressFeedbackInput
): Promise<ActionResult> {
  const instructor = await requireInstructorWithRidingNotesPermission(instructorId);
  if (!instructor) return { success: false, error: "אין הרשאה לערוך משוב לונג׳" };

  const existing = await prisma.studentLungeProgressFeedback.findUnique({ where: { id } });
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
  const horseName = input.horseName?.trim() || null;
  const topic = input.topic?.trim() || null;
  const instructorNameField = input.instructorName?.trim() || null;

  if (!hasMeaningfulContent({ ratingHalfPoints, feedback, horseName, topic, instructorName: instructorNameField })) {
    return { success: false, error: "יש להזין דירוג, משוב, סוס, נושא או שם מדריך/ה" };
  }

  // createdByInstructorId/createdByName are intentionally never touched
  // here - same "preserve original author" convention as the admin action.
  await prisma.studentLungeProgressFeedback.update({
    where: { id },
    data: {
      date,
      ratingHalfPoints,
      feedback,
      horseName,
      topic,
      instructorName: instructorNameField,
      updatedByName: instructor.fullName,
      updatedByInstructorId: instructor.id,
    },
  });

  return { success: true };
}
