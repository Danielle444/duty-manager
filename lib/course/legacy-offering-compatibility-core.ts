/**
 * URGENT LEVEL 2 ACCESS - SLICE L2-0: PURE compatibility filter that lets the
 * LEGACY singleton current-offering resolver keep working for the established
 * Level 1 paths while the Level 2 offering is ACTIVE.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * auth/session/cookie. It receives already-fetched ACTIVE CourseOffering rows
 * and the two EXPLICIT compatibility ids, and returns the row set that the
 * unchanged pure cardinality core (current-offering-core.ts) should decide on.
 *
 * CONTRACT - deliberately narrow:
 *  - 0 rows          -> unchanged (caller still throws NoCurrentCourseOffering).
 *  - 1 row           -> unchanged (caller still returns it, whichever it is).
 *  - EXACTLY the two known ids {Level 1, Level 2} -> the Level 1 row alone, so
 *    legacy Level-1-only callers resolve explicitly to Level 1 instead of
 *    throwing.
 *  - ANYTHING ELSE (3+ rows, an unknown pair, a known id paired with an unknown
 *    third, duplicates) -> unchanged, so the caller still throws
 *    AmbiguousCourseOfferingError. This filter NEVER "picks the lower level",
 *    "picks the earlier start date", "picks the first row", or resolves an
 *    arbitrary multi-offering state.
 *
 * It performs NO inference from name, level, startDate/endDate, activityYearId,
 * status ordering, or row order - only exact id-set equality. It never mutates
 * the input array and never mutates offering status.
 *
 * This module is TEMPORARY: it exists only to bridge the un-migrated legacy call
 * sites. See temporary-level2-compatibility.ts for the removal criteria.
 */
import type { CourseOfferingRow } from "./current-offering-core";

/** The two EXPLICIT offering ids that define the single known two-ACTIVE state. */
export interface LegacyOfferingCompatibility {
  readonly level1OfferingId: string;
  readonly level2OfferingId: string;
}

/**
 * Narrow the fetched ACTIVE rows to the set the legacy cardinality core should
 * decide on. Returns the input array itself (not a copy) whenever no
 * compatibility rewrite applies, so the caller's behavior is bit-for-bit the
 * previous behavior outside the one known state.
 */
export function selectLegacyCompatibleActiveRows(
  rows: readonly CourseOfferingRow[],
  compat: LegacyOfferingCompatibility,
): readonly CourseOfferingRow[] {
  // Only the exact two-row shape can be the known compatibility state. Zero/one
  // row keeps the pre-Level-2 behavior verbatim; three or more is always
  // ambiguous (the caller fetches one extra row precisely so a third ACTIVE
  // offering is visible here and defeats the rewrite).
  if (rows.length !== 2) {
    return rows;
  }

  const level1Row = rows.find((r) => r.id === compat.level1OfferingId);
  const level2Row = rows.find((r) => r.id === compat.level2OfferingId);
  if (level1Row === undefined || level2Row === undefined) {
    return rows;
  }
  // Defensive: a degenerate row set where both ids resolve to the same row (or
  // the two compatibility ids were configured identically) is NOT the known
  // two-offering state - fail closed by leaving the rows untouched.
  if (level1Row === level2Row) {
    return rows;
  }

  return [level1Row];
}
