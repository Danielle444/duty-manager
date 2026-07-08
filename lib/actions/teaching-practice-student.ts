"use server";

import { prisma } from "@/lib/prisma";
import { dateKey } from "@/lib/dates";
import type {
  TeachingPracticeRoleValue,
  TeachingPracticeTypeValue,
} from "@/lib/teaching-practice-rotation";

// Read-only, trainee-facing surface for published Teaching Practice lessons
// only. Deliberately separate from lib/actions/teaching-practice.ts (the
// admin/instructor CRUD module) - this file must never expose feedback,
// lesson notes, unpublished lessons, or any write path, so it stays a
// distinct, narrowly-scoped file rather than reusing that module's mappers.

export interface TeachingPracticeTraineeParticipantRow {
  traineeId: string;
  traineeName: string;
  role: TeachingPracticeRoleValue;
  isSelf: boolean;
}

export interface TeachingPracticeTraineeChildRow {
  childId: string;
  firstName: string;
  lastName: string | null;
  age: number | null;
  gender: string | null;
  horseName: string | null;
  equipmentNotes: string | null;
  // Intentionally included - product decision: parent contact details are
  // visible to trainees for published Teaching Practice lessons, unlike
  // every other trainee-facing surface in this app.
  parentName: string | null;
  parentPhone: string | null;
}

export interface TeachingPracticeTraineeLessonRow {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  practiceType: TeachingPracticeTypeValue;
  location: string | null;
  responsibleInstructorName: string | null;
  participants: TeachingPracticeTraineeParticipantRow[];
  children: TeachingPracticeTraineeChildRow[];
}

const TRAINEE_LESSON_INCLUDE = {
  responsibleInstructor: { select: { fullName: true } },
  participants: {
    orderBy: { createdAt: "asc" as const },
    include: { trainee: { select: { fullName: true } } },
  },
  childAssignments: {
    include: {
      child: {
        select: {
          firstName: true,
          lastName: true,
          age: true,
          gender: true,
          parentName: true,
          parentPhone: true,
        },
      },
    },
  },
};

type TraineeLessonWithIncludes = Awaited<
  ReturnType<typeof prisma.teachingPracticeLesson.findFirstOrThrow<{ include: typeof TRAINEE_LESSON_INCLUDE }>>
>;

// viewerTraineeId drives isSelf in both actions below - even in the
// "כל ההתנסויות" (all published lessons) view, a viewer's own participant
// row should still be marked isSelf=true wherever they happen to appear.
function toTraineeLessonRow(
  lesson: TraineeLessonWithIncludes,
  viewerTraineeId: string
): TeachingPracticeTraineeLessonRow {
  return {
    id: lesson.id,
    date: dateKey(lesson.date),
    startTime: lesson.startTime,
    endTime: lesson.endTime,
    practiceType: lesson.practiceType,
    location: lesson.location,
    responsibleInstructorName: lesson.responsibleInstructor?.fullName ?? null,
    participants: lesson.participants.map((p) => ({
      traineeId: p.traineeId,
      traineeName: p.trainee.fullName,
      role: p.role,
      isSelf: p.traineeId === viewerTraineeId,
    })),
    children: lesson.childAssignments.map((c) => ({
      childId: c.childId,
      firstName: c.child.firstName,
      lastName: c.child.lastName || null,
      age: c.child.age,
      gender: c.child.gender,
      horseName: c.horseName,
      equipmentNotes: c.equipmentNotes,
      parentName: c.child.parentName,
      parentPhone: c.child.parentPhone,
    })),
  };
}

// Re-verified fresh from the DB on every call, same convention as every
// other student-facing action in this app (students have no NextAuth
// session) - a deactivated/deleted trainee id silently yields [] rather
// than an error, so a stale client session never leaks data.
async function getActiveTraineeOrNull(studentId: string) {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student || !student.isActive) return null;
  return student;
}

// "ההתנסויות שלי" - published lessons the trainee actually participates in.
export async function listMyTeachingPracticeLessonsForTrainee(
  studentId: string
): Promise<TeachingPracticeTraineeLessonRow[]> {
  const student = await getActiveTraineeOrNull(studentId);
  if (!student) return [];

  const lessons = await prisma.teachingPracticeLesson.findMany({
    where: {
      isPublished: true,
      participants: { some: { traineeId: studentId } },
    },
    include: TRAINEE_LESSON_INCLUDE,
    orderBy: [{ date: "asc" }, { startTime: "asc" }, { id: "asc" }],
  });

  return lessons.map((lesson) => toTraineeLessonRow(lesson, studentId));
}

// "כל ההתנסויות" - every published lesson, visible to any active trainee.
export async function listPublishedTeachingPracticeLessonsForTrainee(
  studentId: string
): Promise<TeachingPracticeTraineeLessonRow[]> {
  const student = await getActiveTraineeOrNull(studentId);
  if (!student) return [];

  const lessons = await prisma.teachingPracticeLesson.findMany({
    where: { isPublished: true },
    include: TRAINEE_LESSON_INCLUDE,
    orderBy: [{ date: "asc" }, { startTime: "asc" }, { id: "asc" }],
  });

  return lessons.map((lesson) => toTraineeLessonRow(lesson, studentId));
}
