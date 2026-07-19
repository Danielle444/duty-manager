/**
 * MULTI-COURSE (dormant foundation, Slice 1) - PURE core for the explicit-ID
 * CourseOffering primitives.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * auth/session/cookie. It only normalizes an input id, maps already-fetched
 * rows to stable read-only view models, and ranks/orders rows deterministically,
 * so the whole contract is unit-testable without a database
 * (see offering-by-id-core.test.ts).
 *
 * These are NOT the singleton resolver. Unlike current-offering-core.ts, nothing
 * here selects "the current offering", counts cardinality, or invents dates: an
 * offering is addressed by its exact primary key, and PLANNED offerings may
 * legitimately have null start/end dates (schema: @db.Date optional), so dates
 * are passed through as Date | null rather than rejected.
 *
 * A NEW, narrowly named view type is used on purpose (rather than reusing
 * CurrentCourseOffering) to avoid coupling this ID-addressed slice to the
 * singleton resolver's view.
 *
 * DORMANT: no runtime consumer imports this slice; nothing is wired.
 */
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";

/**
 * Stable, read-only view of a single CourseOffering addressed by exact id.
 * Contains ONLY the fields required for course context - never a raw Prisma
 * record, never relations (enrollments/groups/students). Dates are Date | null
 * because a PLANNED offering may not yet be dated; the view never fabricates a
 * date.
 */
export interface CourseOfferingView {
  readonly id: string;
  readonly activityYearId: string;
  readonly name: string;
  readonly level: number;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
  readonly status: CourseOfferingStatus;
}

/**
 * Stable, read-only view for a future admin selector row. Adds the owning
 * ActivityYear's display name on top of the single-offering view fields. Still
 * never exposes relations or a "selected" marker - ordering position carries no
 * selection meaning.
 */
export interface SelectableCourseOfferingView {
  readonly id: string;
  readonly activityYearId: string;
  readonly activityYearName: string;
  readonly name: string;
  readonly level: number;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
  readonly status: CourseOfferingStatus;
}

/** The exact CourseOffering columns the by-id mapper consumes. */
export interface CourseOfferingByIdRow {
  id: string;
  activityYearId: string;
  name: string;
  level: number;
  startDate: Date | null;
  endDate: Date | null;
  status: CourseOfferingStatus;
}

/**
 * The exact narrow row the selectable-list mapper consumes: the by-id columns
 * plus the ActivityYear relation projected to just its name. The relation is
 * REQUIRED in the schema (CourseOffering.activityYear, onDelete: Restrict), so
 * it is always present - never modelled as nullable.
 */
export interface SelectableCourseOfferingRow extends CourseOfferingByIdRow {
  activityYear: { name: string };
}

/**
 * Normalize an explicit offering id. Empty or whitespace-only input is invalid
 * and maps to null; a valid id is returned UNCHANGED (never trimmed/rewritten),
 * so it can be used as an exact primary-key lookup. Non-string input is treated
 * as invalid defensively.
 */
export function normalizeOfferingId(id: string): string | null {
  if (typeof id !== "string") {
    return null;
  }
  return id.trim().length === 0 ? null : id;
}

/** Map one fetched row to the single-offering view. No relations, no fabrication. */
export function mapOfferingByIdRowToView(row: CourseOfferingByIdRow): CourseOfferingView {
  return {
    id: row.id,
    activityYearId: row.activityYearId,
    name: row.name,
    level: row.level,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
  };
}

/** Map one fetched row (with its ActivityYear name) to the selectable view. */
export function mapSelectableOfferingRowToView(
  row: SelectableCourseOfferingRow,
): SelectableCourseOfferingView {
  return {
    id: row.id,
    activityYearId: row.activityYearId,
    activityYearName: row.activityYear.name,
    name: row.name,
    level: row.level,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
  };
}

/**
 * Deterministic status ordering rank (smaller = earlier). ACTIVE first, then
 * PLANNED, then ARCHIVED. ARCHIVED is ranked LAST but is never excluded - the
 * future selector needs historical access.
 */
const STATUS_RANK: Record<CourseOfferingStatus, number> = {
  ACTIVE: 0,
  PLANNED: 1,
  ARCHIVED: 2,
};

function courseOfferingStatusRank(status: CourseOfferingStatus): number {
  return STATUS_RANK[status];
}

/**
 * Total, deterministic comparator for the admin selector list. Ordering
 * contract:
 *   1. status rank ascending: ACTIVE, then PLANNED, then ARCHIVED;
 *   2. within a status, newest startDate first (descending);
 *   3. null startDate sorts AFTER all dated rows within the same status;
 *   4. stable tie-breaker: name ascending, then id ascending.
 *
 * The id tie-breaker (a unique primary key) makes the order fully deterministic
 * independent of the underlying sort's stability. Returning first here carries
 * NO selection meaning. Module-private: exercised only through the public
 * orderSelectableOfferings().
 */
function compareSelectableOfferings(
  a: SelectableCourseOfferingView,
  b: SelectableCourseOfferingView,
): number {
  const rankDiff = courseOfferingStatusRank(a.status) - courseOfferingStatusRank(b.status);
  if (rankDiff !== 0) {
    return rankDiff;
  }

  const at = a.startDate === null ? null : a.startDate.getTime();
  const bt = b.startDate === null ? null : b.startDate.getTime();
  if (at !== bt) {
    if (at === null) {
      return 1; // a undated -> after b
    }
    if (bt === null) {
      return -1; // b undated -> after a
    }
    return bt - at; // newer (larger time) first
  }

  if (a.name !== b.name) {
    return a.name < b.name ? -1 : 1;
  }
  if (a.id !== b.id) {
    return a.id < b.id ? -1 : 1;
  }
  return 0;
}

/**
 * Map narrow rows to selectable views and return them in the deterministic
 * contract order above. Does NOT mark, flag or imply an automatically selected
 * offering - the caller must select explicitly by id.
 */
export function orderSelectableOfferings(
  rows: readonly SelectableCourseOfferingRow[],
): SelectableCourseOfferingView[] {
  return rows.map(mapSelectableOfferingRowToView).sort(compareSelectableOfferings);
}
