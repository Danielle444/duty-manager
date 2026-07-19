/**
 * MULTI-COURSE W6D3 - PURE server-side builder for the admin group-change
 * control's option list.
 *
 * PURE by construction: no Prisma, no DB, no clock, no Next.js runtime. It takes
 * already-loaded CourseGroup rows for ONE offering and produces the whitelist of
 * selectable LEAF subgroup options, each carrying a stable `courseGroupId` and a
 * server-derived display label. The admin UI submits ONLY a `courseGroupId` from
 * this list - never a free-text group label - so label parsing never round-trips
 * through the client. See group-change-service.ts (the write authority).
 */

/** A loaded CourseGroup row (this offering) plus its parent's name, if any. */
export interface CourseGroupOptionRow {
  id: string;
  name: string;
  parentGroupId: string | null;
  parentName: string | null;
}

/** One selectable leaf-subgroup option for the admin group-change control. */
export interface GroupChangeOption {
  courseGroupId: string;
  /** Server-derived display label, e.g. "א׳ — תת־קבוצה 1". */
  label: string;
  /** The parent (top-level) group name — the Student.groupName mirror value. */
  parentName: string;
  /** The positive-integer subgroup — the Student.subgroupNumber mirror value. */
  subgroupNumber: number;
}

/** Strict positive-integer parse of a subgroup CourseGroup name (e.g. "1"). */
function parsePositiveIntegerSubgroup(name: string): number | null {
  const trimmed = name.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Build the server-derived display label for a leaf subgroup option. */
export function groupChangeOptionLabel(parentName: string, subgroupNumber: number): string {
  return `${parentName}׳ — תת־קבוצה ${subgroupNumber}`;
}

/**
 * Build the whitelist of valid leaf-subgroup options from one offering's
 * CourseGroup rows. A row qualifies ONLY when it is a leaf (non-null parent),
 * its parent name is non-empty, and its own name parses to a strict positive
 * integer subgroup. Top-level groups and malformed subgroups are excluded.
 * Sorted by parent name (Hebrew) then subgroup number for a stable UI order.
 */
export function buildLeafGroupOptions(rows: readonly CourseGroupOptionRow[]): GroupChangeOption[] {
  const options: GroupChangeOption[] = [];
  for (const row of rows) {
    if (row.parentGroupId === null) {
      continue;
    }
    const parentName = typeof row.parentName === "string" ? row.parentName.trim() : "";
    if (parentName.length === 0) {
      continue;
    }
    const subgroupNumber = parsePositiveIntegerSubgroup(row.name);
    if (subgroupNumber === null) {
      continue;
    }
    options.push({
      courseGroupId: row.id,
      label: groupChangeOptionLabel(parentName, subgroupNumber),
      parentName,
      subgroupNumber,
    });
  }
  return options.sort(
    (a, b) => a.parentName.localeCompare(b.parentName, "he") || a.subgroupNumber - b.subgroupNumber,
  );
}
