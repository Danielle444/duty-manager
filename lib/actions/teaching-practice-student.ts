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
  // "א"/"ב" (or null) - not sensitive, used purely for client-side
  // grouping/filtering (Stage S3's "כל ההתנסויות" table).
  groupName: string | null;
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
    groupName: lesson.groupName,
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

// Fixed-structure ("מבנה קבוע") read-only surface, added for Stage S3's
// "כל ההתנסויות" -> "מבנה קבוע" mode. TeachingPracticeTrack has no
// isPublished flag of its own (unlike TeachingPracticeLesson) - the
// approved visibility rule instead reuses the EXISTING publish mechanism
// transitively: a track is visible here only if it's active AND has at
// least one generated lesson that's actually published. A track with zero
// published lessons (including one with only unpublished/draft lessons, or
// no generated lessons at all yet) never appears. No new flag, no schema
// change.

export interface TeachingPracticeTraineeTrackTraineeRow {
  traineeId: string;
  traineeName: string;
  rotationOrder: number;
  isSelf: boolean;
}

export interface TeachingPracticeTraineeTrackChildRow {
  childId: string;
  firstName: string;
  lastName: string | null;
  age: number | null;
  gender: string | null;
  horseName: string | null;
  equipmentNotes: string | null;
  parentName: string | null;
  parentPhone: string | null;
}

export interface TeachingPracticeTraineeTrackRow {
  id: string;
  practiceType: TeachingPracticeTypeValue;
  groupName: string | null;
  defaultStartTime: string;
  defaultEndTime: string;
  defaultLocation: string | null;
  // Only ever set on a BEGINNER_PRIVATE track - the BEGINNER_GROUP track it
  // feeds. Used purely for client-side grouping (nest a private track under
  // its linked group in the "מבנה קבוע" view), same as the admin/instructor
  // fixed-structure table's own convention.
  groupTrackId: string | null;
  trainees: TeachingPracticeTraineeTrackTraineeRow[];
  children: TeachingPracticeTraineeTrackChildRow[];
}

// "מבנה קבוע" - active tracks with at least one published lesson only. No
// notes, no defaultResponsibleInstructorId/name, no isActive, no
// createdAt/updatedAt, no manual-override or feedback-related field -
// deliberately narrower than the admin/instructor track shape.
export async function listPublishedTeachingPracticeTracksForTrainee(
  studentId: string
): Promise<TeachingPracticeTraineeTrackRow[]> {
  const student = await getActiveTraineeOrNull(studentId);
  if (!student) return [];

  const tracks = await prisma.teachingPracticeTrack.findMany({
    where: {
      isActive: true,
      lessons: { some: { isPublished: true } },
    },
    select: {
      id: true,
      practiceType: true,
      groupName: true,
      defaultStartTime: true,
      defaultEndTime: true,
      defaultLocation: true,
      groupTrackId: true,
      trainees: {
        select: {
          traineeId: true,
          rotationOrder: true,
          trainee: { select: { fullName: true } },
        },
      },
      children: {
        select: {
          childId: true,
          horseName: true,
          equipmentNotes: true,
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
    },
    orderBy: [{ practiceType: "asc" }, { defaultStartTime: "asc" }, { id: "asc" }],
  });

  return tracks.map((track) => ({
    id: track.id,
    practiceType: track.practiceType,
    groupName: track.groupName,
    defaultStartTime: track.defaultStartTime,
    defaultEndTime: track.defaultEndTime,
    defaultLocation: track.defaultLocation,
    groupTrackId: track.groupTrackId,
    trainees: track.trainees.map((t) => ({
      traineeId: t.traineeId,
      traineeName: t.trainee.fullName,
      rotationOrder: t.rotationOrder,
      isSelf: t.traineeId === studentId,
    })),
    // Childless horse/equipment placeholder rows (childId null) have
    // nothing to show a trainee - skipped rather than rendered as a blank
    // row.
    children: track.children
      .filter((c): c is typeof c & { childId: string; child: NonNullable<(typeof c)["child"]> } => c.childId !== null && c.child !== null)
      .map((c) => ({
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
  }));
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
