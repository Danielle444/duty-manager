// Shared by lib/actions/riding-slots.ts and lib/actions/student-schedule.ts.
// Plain (non "use server") module because a "use server" file may only
// export async functions - this matcher is a pure sync helper.
export type AssignmentForMatching = {
  groupName: string | null;
  subgroupNumber: number | null;
  arena: string | null;
  // Legacy/primary instructor - kept as a fallback for any assignment the
  // join table below doesn't (yet) cover. See RidingSlotAssignment.instructorId.
  instructorId: string | null;
  instructor: { fullName: string } | null;
  // Full responsible-instructor list via RidingSlotAssignmentInstructor -
  // source of truth once populated (always includes the legacy instructor
  // too, since upsertRidingSlotAssignment keeps them in sync).
  instructors: { instructor: { id: string; fullName: string } }[];
};

// Same fallback direction used everywhere a riding slot's per-group/subgroup
// splits need to be resolved for one specific student - exact (group,
// subgroup) split first, then a whole-group split, then a whole-slot split.
export function findAssignmentForStudent<T extends AssignmentForMatching>(
  assignments: T[],
  groupName: string | null,
  subgroupNumber: number | null
): T | null {
  const exact = assignments.find((a) => a.groupName === groupName && a.subgroupNumber === subgroupNumber);
  if (exact) return exact;
  const groupLevel = assignments.find((a) => a.groupName === groupName && a.subgroupNumber === null);
  if (groupLevel) return groupLevel;
  const wholeSlot = assignments.find((a) => a.groupName === null && a.subgroupNumber === null);
  return wholeSlot ?? null;
}

// Full list of {id, fullName} for every instructor responsible for this
// assignment - reads the join table when it has rows, falling back to the
// legacy singular instructor only when the join table is empty (defensive;
// shouldn't happen for any assignment saved after Stage 2, since saving
// always keeps both in sync).
export function getAssignmentInstructors(
  assignment: AssignmentForMatching
): { id: string; fullName: string }[] {
  if (assignment.instructors.length > 0) {
    return assignment.instructors.map((i) => i.instructor);
  }
  return assignment.instructorId && assignment.instructor
    ? [{ id: assignment.instructorId, fullName: assignment.instructor.fullName }]
    : [];
}

export function getAssignmentInstructorNames(assignment: AssignmentForMatching): string[] {
  return getAssignmentInstructors(assignment).map((i) => i.fullName);
}

// "" -> null, so callers can drop straight into an `instructorName: string |
// null` field without an extra empty-string check - matches how every other
// nullable display field in this app is represented.
export function formatInstructorNames(names: string[]): string | null {
  return names.length > 0 ? names.join(", ") : null;
}

// Whether the given instructor is one of this assignment's responsible
// instructors - checks the join-table list first, falling back to the
// legacy scalar instructorId when the join table is empty (same defensive
// fallback as getAssignmentInstructors).
export function assignmentBelongsToInstructor(
  assignment: AssignmentForMatching,
  instructorId: string
): boolean {
  return getAssignmentInstructors(assignment).some((i) => i.id === instructorId);
}
