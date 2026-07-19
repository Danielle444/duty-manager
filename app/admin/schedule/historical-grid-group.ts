/**
 * W6D3-HOTFIX (admin schedule grid) - PURE per-student historical group for the
 * duty grid.
 *
 * The grid shows ONE group per trainee row across a viewed date range. That group
 * must be the group the trainee was in DURING THE VIEWED WEEK, resolved from the
 * effective-dated group already carried per duty assignment (the server resolves
 * `assignment.groupName`/`subgroupNumber` at each `DutyAssignment.date`), NEVER
 * the current `Student.groupName` mirror.
 *
 * Rule (locked): a row's group is taken from that student's EARLIEST assignment
 * within the viewed range (≈ the group at the week's start for a full-coverage
 * week). A student with NO assignment in range is simply absent from the map — the
 * caller shows null/"–", and NEVER falls back to the current mirror.
 */

/** A duty assignment carrying its server-resolved historical group. */
export interface HistoricalGroupAssignment {
  studentId: string;
  dateKey: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

/** The historical group value for one trainee row. */
export interface HistoricalGroupValue {
  groupName: string | null;
  subgroupNumber: number | null;
}

/**
 * Build a per-student historical group map for a grid over
 * `[rangeStartKey, rangeEndKey]` (inclusive; null bound = unbounded on that side),
 * taking each student's EARLIEST in-range assignment's historical group. No
 * current-mirror fallback: a student with no in-range assignment is absent.
 */
export function resolveGridGroupByStudent(
  assignments: readonly HistoricalGroupAssignment[],
  rangeStartKey: string | null,
  rangeEndKey: string | null,
): Map<string, HistoricalGroupValue> {
  const inRange = assignments
    .filter(
      (a) =>
        (rangeStartKey === null || a.dateKey >= rangeStartKey) &&
        (rangeEndKey === null || a.dateKey <= rangeEndKey),
    )
    .slice()
    .sort((x, y) => x.dateKey.localeCompare(y.dateKey));

  const map = new Map<string, HistoricalGroupValue>();
  for (const a of inRange) {
    if (!map.has(a.studentId)) {
      map.set(a.studentId, { groupName: a.groupName, subgroupNumber: a.subgroupNumber });
    }
  }
  return map;
}
