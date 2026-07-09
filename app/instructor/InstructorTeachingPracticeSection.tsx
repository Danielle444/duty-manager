"use client";

import { TeachingPracticeManager } from "@/lib/components/TeachingPracticeManager";

interface StudentOption {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

interface InstructorOption {
  id: string;
  fullName: string;
}

export function InstructorTeachingPracticeSection({
  instructorId,
  canManageAssignments,
  canManageHorses,
  canEditTeachingPracticeFeedback,
  students,
  instructors,
}: {
  instructorId: string;
  canManageAssignments: boolean;
  canManageHorses: boolean;
  canEditTeachingPracticeFeedback: boolean;
  students: StudentOption[];
  instructors: InstructorOption[];
}) {
  return (
    <TeachingPracticeManager
      role="instructor"
      actorId={instructorId}
      canManageAssignments={canManageAssignments}
      canManageHorses={canManageHorses}
      canEditTeachingPracticeFeedback={canEditTeachingPracticeFeedback}
      students={students}
      instructors={instructors}
    />
  );
}
