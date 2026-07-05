// Shared by the Excel export and the admin schedule grid: how many distinct
// students have an assignment on each date, out of how many active
// students there are in total. Used to surface a manager-facing coverage
// warning when a non-no-duty date leaves some students unassigned - this
// never changes what the scheduler does, only how existing results are
// summarized for display.

export interface DateCoverage {
  dateKey: string;
  assignedCount: number;
  activeStudentCount: number;
  isNoDuty: boolean;
  // Only meaningful when !isNoDuty - a no-duty date is expected to have
  // zero assignments, so it's never "short."
  isShort: boolean;
}

export function computeCoverageByDate(
  dateKeys: string[],
  activeStudentCount: number,
  cellByStudentAndDate: Map<string, Map<string, unknown>>,
  noDutyDateKeys: Set<string>,
  // Optional - when provided (currently only the admin schedule grid does),
  // "is this day short" is judged against how many students were actually
  // available that day, not the full active roster. A day where several
  // students are legitimately unavailable/absent should not be flagged short
  // just because of that. Callers that don't pass this (the Excel export,
  // the diagnostics panel) keep their existing behavior unchanged.
  availableCountByDate?: Map<string, number>
): Map<string, DateCoverage> {
  const assignedCounts = new Map<string, number>();
  for (const dk of dateKeys) assignedCounts.set(dk, 0);

  for (const perDate of cellByStudentAndDate.values()) {
    for (const dk of perDate.keys()) {
      if (assignedCounts.has(dk)) {
        assignedCounts.set(dk, (assignedCounts.get(dk) ?? 0) + 1);
      }
    }
  }

  const result = new Map<string, DateCoverage>();
  for (const dk of dateKeys) {
    const assignedCount = assignedCounts.get(dk) ?? 0;
    const isNoDuty = noDutyDateKeys.has(dk);
    const expectedCount = availableCountByDate?.get(dk) ?? activeStudentCount;
    result.set(dk, {
      dateKey: dk,
      assignedCount,
      activeStudentCount: expectedCount,
      isNoDuty,
      isShort: !isNoDuty && assignedCount < expectedCount,
    });
  }
  return result;
}
