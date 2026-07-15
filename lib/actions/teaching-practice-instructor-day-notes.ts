"use server";

import { prisma } from "@/lib/prisma";
import { parseDateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";
import type { TeachingPracticeTypeValue } from "@/lib/teaching-practice-rotation";

// TP-DAY-NOTES - instructor-private working notes kept under one activity
// section (LUNGE/BEGINNER_PRIVATE/BEGINNER_GROUP) on one generated Teaching
// Practice date. See TeachingPracticeInstructorDayNote's own schema comment
// for why this is a freestanding (date, practiceType) pair rather than a
// lesson/track reference. v1 is instructor-private only - deliberately no
// "AsAdmin" read/write action in this file, so admin's teaching-practice
// surfaces stay structurally incapable of joining this table in.

const NOT_FOUND_INSTRUCTOR = "המדריך/ה לא נמצא/ה או אינו/ה פעיל/ה";
const INVALID_DATE = "תאריך לא תקין";
const INVALID_PRACTICE_TYPE = "סוג התנסות לא תקין";

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const VALID_PRACTICE_TYPES: TeachingPracticeTypeValue[] = ["LUNGE", "BEGINNER_PRIVATE", "BEGINNER_GROUP"];

// Same re-read-from-DB convention as every other instructor-facing Teaching
// Practice action (see getInstructorForAssignmentWrite in
// lib/actions/teaching-practice.ts) - students/instructors have no NextAuth
// session in this app, so the passed-in id is never trusted on its own,
// only what's re-read for it right now. Deliberately just isActive, no
// canManageAssignments/canEditTeachingPracticeFeedback check - per the
// TP-DAY-NOTES product decision, any active instructor who can view the
// generated date may keep notes for themselves, independent of those
// scheduling/feedback-editing permissions.
async function getActiveInstructor(instructorId: string) {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive) return null;
  return instructor;
}

function isValidPracticeType(value: string): value is TeachingPracticeTypeValue {
  return (VALID_PRACTICE_TYPES as string[]).includes(value);
}

export type TeachingPracticeDayNotesByType = Record<TeachingPracticeTypeValue, string>;

const EMPTY_DAY_NOTES: TeachingPracticeDayNotesByType = {
  LUNGE: "",
  BEGINNER_PRIVATE: "",
  BEGINNER_GROUP: "",
};

// Every query below is scoped by the re-read instructor's own id - there is
// no code path here that can return or touch another instructor's rows.
export async function getMyTeachingPracticeDayNotes(
  instructorId: string,
  date: string
): Promise<TeachingPracticeDayNotesByType | null> {
  const instructor = await getActiveInstructor(instructorId);
  if (!instructor) return null;
  if (!DATE_KEY_REGEX.test(date)) return null;

  const rows = await prisma.teachingPracticeInstructorDayNote.findMany({
    where: { instructorId: instructor.id, date: parseDateKey(date) },
    select: { practiceType: true, content: true },
  });

  const result: TeachingPracticeDayNotesByType = { ...EMPTY_DAY_NOTES };
  for (const row of rows) {
    result[row.practiceType] = row.content;
  }
  return result;
}

export interface SaveMyTeachingPracticeDayNoteInput {
  date: string;
  practiceType: TeachingPracticeTypeValue;
  content: string;
}

// Upsert-by-ownership-key, never by a client-supplied note id - the update
// authority is always (instructorId, date, practiceType) re-derived from the
// re-read instructor and the validated input, so this can never be pointed
// at another instructor's row. Trimmed-empty content deletes the row instead
// of writing/keeping a blank placeholder (deleteMany, not delete, since a
// "nothing to delete" empty-save is a normal no-op, not an error).
export async function saveMyTeachingPracticeDayNote(
  instructorId: string,
  input: SaveMyTeachingPracticeDayNoteInput
): Promise<ActionResult> {
  const instructor = await getActiveInstructor(instructorId);
  if (!instructor) return { success: false, error: NOT_FOUND_INSTRUCTOR };

  if (!DATE_KEY_REGEX.test(input.date)) return { success: false, error: INVALID_DATE };
  if (!isValidPracticeType(input.practiceType)) return { success: false, error: INVALID_PRACTICE_TYPE };

  const date = parseDateKey(input.date);
  const content = input.content.trim();

  try {
    if (!content) {
      await prisma.teachingPracticeInstructorDayNote.deleteMany({
        where: { instructorId: instructor.id, date, practiceType: input.practiceType },
      });
      return { success: true };
    }

    await prisma.teachingPracticeInstructorDayNote.upsert({
      where: {
        instructorId_date_practiceType: {
          instructorId: instructor.id,
          date,
          practiceType: input.practiceType,
        },
      },
      create: { instructorId: instructor.id, date, practiceType: input.practiceType, content },
      update: { content },
    });
    return { success: true };
  } catch {
    return { success: false, error: "אירעה שגיאה בשמירת ההערה" };
  }
}
