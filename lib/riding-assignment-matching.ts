// Shared by lib/actions/riding-slots.ts and lib/actions/student-schedule.ts.
// Plain (non "use server") module because a "use server" file may only
// export async functions - this matcher is a pure sync helper.
export type AssignmentForMatching = {
  groupName: string | null;
  subgroupNumber: number | null;
  arena: string | null;
  instructor: { fullName: string } | null;
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
