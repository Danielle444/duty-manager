"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { ActionResult } from "@/lib/actions/students";

// Admin-only, read/create/update/delete surface for
// StudentGeneralNote - a chronological history of general notes about a
// חניך/ה, not tied to any specific session or feedback type (unlike
// StudentRidingProgressFeedback/StudentLungeProgressFeedback/
// StudentPresentationProgressFeedback, which are all rating/score journals
// for one specific topic - see that model's own schema comment). Stage N1
// only: no instructor variant yet, no UI yet - see schema.prisma's own
// comment on why createdByInstructorId/updatedByInstructorId already exist
// despite that.

export interface StudentGeneralNoteRow {
  id: string;
  studentId: string;
  content: string;
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

function toRow(row: {
  id: string;
  studentId: string;
  content: string;
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StudentGeneralNoteRow {
  return {
    id: row.id,
    studentId: row.studentId,
    content: row.content,
    createdByName: row.createdByName,
    updatedByName: row.updatedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Newest first - createdAt desc, id as a stable tie-break for same-instant
// rows (matches the project's general "stable fallback" convention).
export async function getStudentGeneralNotesAsAdmin(
  studentId: string
): Promise<StudentGeneralNoteRow[] | null> {
  await requireAdmin();

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return null;

  const rows = await prisma.studentGeneralNote.findMany({
    where: { studentId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  return rows.map(toRow);
}

export interface CreateStudentGeneralNoteInput {
  studentId: string;
  content: string;
}

export async function createStudentGeneralNoteAsAdmin(
  input: CreateStudentGeneralNoteInput
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const student = await prisma.student.findUnique({ where: { id: input.studentId } });
  if (!student) return { success: false, error: "חניך/ה לא נמצא/ה" };

  const content = input.content.trim();
  if (!content) return { success: false, error: "יש להזין תוכן להערה" };

  const adminName = admin.name ?? admin.email;

  await prisma.studentGeneralNote.create({
    data: {
      studentId: input.studentId,
      content,
      createdByName: adminName,
      updatedByName: adminName,
    },
  });

  return { success: true };
}

export interface UpdateStudentGeneralNoteInput {
  noteId: string;
  content: string;
}

export async function updateStudentGeneralNoteAsAdmin(
  input: UpdateStudentGeneralNoteInput
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const existing = await prisma.studentGeneralNote.findUnique({ where: { id: input.noteId } });
  if (!existing) return { success: false, error: "ההערה לא נמצאה" };

  const content = input.content.trim();
  if (!content) return { success: false, error: "יש להזין תוכן להערה" };

  // studentId/createdByName/createdAt/createdByInstructorId are intentionally
  // never touched here - same "preserve original author" convention as
  // StudentRidingProgressFeedback and its siblings.
  await prisma.studentGeneralNote.update({
    where: { id: input.noteId },
    data: {
      content,
      updatedByName: admin.name ?? admin.email,
    },
  });

  return { success: true };
}

// Hard delete - no soft-delete flag on this model, no cascade concerns
// beyond this one row (StudentGeneralNote has no child records of its own).
// Never touches Student or any other feedback record.
export async function deleteStudentGeneralNoteAsAdmin(noteId: string): Promise<ActionResult> {
  await requireAdmin();

  const existing = await prisma.studentGeneralNote.findUnique({ where: { id: noteId } });
  if (!existing) return { success: false, error: "ההערה לא נמצאה" };

  await prisma.studentGeneralNote.delete({ where: { id: noteId } });

  return { success: true };
}
