// Standalone copy of the constraint-blocking check inline in
// lib/scheduler.ts's generateSchedule (blockedGroupsFor). Duplicated rather
// than imported so this phase's manual-assignment validation never touches
// the scheduler file itself - the logic is small and pure, and scheduler.ts
// stays untouched.
import type { CourseDayPlan, DutyConstraint } from "@/app/generated/prisma/client";

function dayPlanSlotValue(dayPlan: CourseDayPlan, slot: DutyConstraint["slot"]): string | null {
  switch (slot) {
    case "FIRST_MORNING":
      return dayPlan.firstMorningGroup;
    case "SECOND_MORNING":
      return dayPlan.secondMorningGroup;
    case "FIRST_AFTER_LUNCH":
      return dayPlan.firstAfterLunchGroup;
    case "SECOND_AFTER_LUNCH":
      return dayPlan.secondAfterLunchGroup;
    default:
      return null;
  }
}

// Which group names are blocked from a given duty type on a given day plan,
// based on that duty type's active constraints. A student in a blocked group
// cannot be assigned that duty type on that date.
export function blockedGroupsForDayPlan(
  dayPlan: CourseDayPlan | null | undefined,
  constraints: DutyConstraint[]
): Set<string> {
  const blocked = new Set<string>();
  if (!dayPlan || constraints.length === 0) return blocked;
  for (const rule of constraints) {
    const group = dayPlanSlotValue(dayPlan, rule.slot);
    if (group) blocked.add(group);
  }
  return blocked;
}
