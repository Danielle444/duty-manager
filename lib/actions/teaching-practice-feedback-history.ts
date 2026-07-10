"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey } from "@/lib/dates";
import { hasMeaningfulTeachingPracticeFeedback } from "@/lib/teaching-practice-feedback";
import type { TeachingPracticeRoleValue, TeachingPracticeTypeValue } from "@/lib/teaching-practice-rotation";

// Read-only, admin-only surface for Stage P2 of the trainee progress page
// (/admin/trainee-progress) - a per-trainee feedback HISTORY, not a
// date-level results dashboard and not an editing screen. Deliberately
// separate from lib/actions/teaching-practice.ts (2600+ lines already,
// admin/instructor CRUD + sync/generation/publish) so this narrow read path
// stays easy to read on its own and never risks touching write/sync logic.
// Never mutates anything - no create/update/delete call anywhere here.

// Mirrors ROLE_SLOTS_BY_PRACTICE_TYPE in lib/components/TeachingPracticeManager.tsx
// - duplicated rather than imported since that file is a client component
// this server module can't import from (same small-constant duplication
// convention already used elsewhere for PRACTICE_TYPE_LABELS/
// compareLinkedPrivateTracks). Only used here to resolve which specific
// TeachingPracticeChildAssignment belongs to one participant, mirroring
// that file's own pairLessonParticipantsWithChildren rule exactly so this
// screen never attributes a child to the wrong participant.
const ROLE_SLOTS_BY_PRACTICE_TYPE: Record<TeachingPracticeTypeValue, TeachingPracticeRoleValue[]> = {
  LUNGE: ["LEAD_INSTRUCTOR", "ASSISTANT_INSTRUCTOR"],
  BEGINNER_PRIVATE: ["LEAD_INSTRUCTOR", "ASSISTANT_INSTRUCTOR"],
  BEGINNER_GROUP: ["LEAD_INSTRUCTOR", "SECOND_INSTRUCTOR", "EVALUATOR"],
};

export interface TeachingPracticeFeedbackHistoryRow {
  feedbackId: string;
  lessonId: string;
  date: string;
  startTime: string;
  endTime: string;
  practiceType: TeachingPracticeTypeValue;
  groupName: string | null;
  location: string | null;
  // The trainee's own role in this lesson - TeachingPracticeParticipant has
  // no rotationOrder of its own (that's a TeachingPracticeTrackTrainee/track
  // concept, not stored per-lesson), so role is the only per-participant
  // "position" field that actually exists to show here.
  role: TeachingPracticeRoleValue;
  ratingHalfPoints: number | null;
  feedback: string | null;
  updatedByName: string | null;
  updatedAt: string;
  childFullName: string | null;
  horseName: string | null;
  equipmentNotes: string | null;
}

type LessonParticipantForPairing = { traineeId: string; role: TeachingPracticeRoleValue };
type ChildAssignmentForPairing = {
  child: { fullName: string };
  horseName: string | null;
  equipmentNotes: string | null;
};

// Resolves which child (if any) this one participant's feedback relates to.
// Same rule TeachingPracticeManager.tsx's pairLessonParticipantsWithChildren
// already uses: LUNGE/BEGINNER_PRIVATE lessons with at most one child
// assignment share that single child across every participant (both
// trainees taught the same one child); BEGINNER_GROUP (or the unexpected
// case of more than one child on a LUNGE/BEGINNER_PRIVATE lesson) instead
// index-pairs participants - sorted into the practiceType's fixed role-slot
// order - with childAssignments position-for-position. Looked up by
// traineeId (not just role) so a genuine data anomaly - two participants
// somehow sharing a role - still resolves this exact participant's own
// position rather than the first same-role match.
function resolveChildForParticipant(
  practiceType: TeachingPracticeTypeValue,
  traineeId: string,
  lessonParticipants: LessonParticipantForPairing[],
  childAssignments: ChildAssignmentForPairing[]
): { childFullName: string | null; horseName: string | null; equipmentNotes: string | null } {
  if (childAssignments.length === 0) {
    return { childFullName: null, horseName: null, equipmentNotes: null };
  }

  const sharedChildColumn = practiceType !== "BEGINNER_GROUP" && childAssignments.length <= 1;
  if (sharedChildColumn) {
    const only = childAssignments[0];
    return { childFullName: only.child.fullName, horseName: only.horseName, equipmentNotes: only.equipmentNotes };
  }

  const roleSlots = ROLE_SLOTS_BY_PRACTICE_TYPE[practiceType];
  const roleIndex = new Map(roleSlots.map((role, i) => [role, i]));
  const sortedParticipants = [...lessonParticipants].sort(
    (a, b) => (roleIndex.get(a.role) ?? roleSlots.length) - (roleIndex.get(b.role) ?? roleSlots.length)
  );
  const position = sortedParticipants.findIndex((p) => p.traineeId === traineeId);
  const match = position >= 0 ? childAssignments[position] : undefined;
  if (!match) return { childFullName: null, horseName: null, equipmentNotes: null };
  return { childFullName: match.child.fullName, horseName: match.horseName, equipmentNotes: match.equipmentNotes };
}

// One row per participant with MEANINGFUL feedback (hasMeaningfulTeachingPracticeFeedback
// - a saved-but-empty TeachingPracticeFeedback row, e.g. from opening and
// closing the feedback modal without entering anything, is excluded, same
// rule the sync/overwrite-protection logic already uses elsewhere). Sorted
// newest lesson first (date desc, then startTime desc). Returns null only
// when the student itself doesn't exist - a student that exists but has no
// (meaningful) feedback yet returns an empty array, never null.
export async function getStudentTeachingPracticeFeedbackForAdmin(
  studentId: string
): Promise<TeachingPracticeFeedbackHistoryRow[] | null> {
  await requireAdmin();

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return null;

  const participants = await prisma.teachingPracticeParticipant.findMany({
    where: { traineeId: studentId },
    include: {
      feedback: true,
      lesson: {
        include: {
          participants: { select: { traineeId: true, role: true } },
          childAssignments: { include: { child: { select: { fullName: true } } } },
        },
      },
    },
  });

  const rows: TeachingPracticeFeedbackHistoryRow[] = participants
    .filter((p) => hasMeaningfulTeachingPracticeFeedback(p.feedback))
    .map((p) => {
      const childContext = resolveChildForParticipant(
        p.lesson.practiceType,
        p.traineeId,
        p.lesson.participants,
        p.lesson.childAssignments
      );
      return {
        feedbackId: p.feedback!.id,
        lessonId: p.lessonId,
        date: dateKey(p.lesson.date),
        startTime: p.lesson.startTime,
        endTime: p.lesson.endTime,
        practiceType: p.lesson.practiceType,
        groupName: p.lesson.groupName,
        location: p.lesson.location,
        role: p.role,
        ratingHalfPoints: p.feedback!.ratingHalfPoints,
        feedback: p.feedback!.feedback,
        updatedByName: p.feedback!.updatedByName,
        updatedAt: p.feedback!.updatedAt.toISOString(),
        ...childContext,
      };
    });

  rows.sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));

  return rows;
}
