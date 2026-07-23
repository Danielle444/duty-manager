/**
 * MULTI-COURSE (course-affiliation display slice A1) - PURE core that turns a
 * trainee's already-fetched CourseEnrollment rows into a deterministic, read-only
 * course-affiliation summary. This is the data model that Slice A2 will render as
 * course badges in the admin trainee list; A1 adds NO UI.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * auth/session/cookie. It takes rows the IO reader already fetched and produces a
 * summary object. The whole contract is unit-testable without a database (see
 * trainee-affiliations-core.test.ts).
 *
 * RELATIONSHIP SOURCE OF TRUTH (locked decision 11): affiliation is derived ONLY
 * from Student -> CourseEnrollment -> CourseOffering. It NEVER reads
 * Student.groupName / Student.subgroupNumber (locked decision 9); the input row
 * shape for affiliation cannot even carry them. It NEVER resolves the ACTIVE
 * singleton, a selected-course cookie, or an offering name/level as identity
 * (locked decision 10) - the caller supplies the exact enrollment rows.
 *
 * VISIBILITY FILTER (locked decisions 1-3): an affiliation is visible ONLY when
 *   - CourseEnrollment.status === "ACTIVE", AND
 *   - CourseOffering.status !== "ARCHIVED".
 * INACTIVE enrollments and ARCHIVED offerings are excluded from the first display
 * version. A real ACTIVE enrollment into a PLANNED offering IS a valid affiliation
 * and is shown (PLANNED is not hidden merely for being PLANNED).
 *
 * FAIL-CLOSED on a malformed row (edge-case robustness): the schema types
 * CourseOffering.level as a non-null Int, so a null/NaN level is not reachable
 * through Prisma. Should one ever arrive, the affiliation is DROPPED (excluded
 * from visibleAffiliations) rather than throwing - a single malformed affiliation
 * must never fail the whole trainee list. The trainee then simply shows fewer (or
 * zero) badges, which is the safe direction for a display-only model.
 */
import type {
  CourseEnrollmentStatus,
  CourseOfferingStatus,
} from "@/app/generated/prisma/client";

/** The minimal CourseOffering fields an affiliation badge needs. */
export interface RawAffiliationOffering {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly status: CourseOfferingStatus;
}

/** One CourseEnrollment row with the minimal fields affiliation display needs. */
export interface RawAffiliationEnrollment {
  readonly id: string;
  readonly status: CourseEnrollmentStatus;
  readonly isPrimary: boolean;
  readonly courseOfferingId: string;
  readonly courseOffering: RawAffiliationOffering;
}

/** One deduplicated, visible affiliation badge (per distinct CourseOffering). */
export interface VisibleAffiliation {
  readonly courseOfferingId: string;
  readonly name: string;
  readonly level: number;
  readonly isPrimary: boolean;
}

/** The deterministic per-trainee affiliation summary Slice A2 will render. */
export interface TraineeAffiliationSummary {
  /** Visible ACTIVE affiliations, deduped by offering id, deterministically ordered. */
  readonly visibleAffiliations: VisibleAffiliation[];
  /** Count of visible affiliations (== visibleAffiliations.length). */
  readonly activeAffiliationCount: number;
  /** True when there are zero visible affiliations. */
  readonly hasNoActiveCourse: boolean;
  /** True when the trainee has two or more visible affiliations (locked decision 6). */
  readonly isCombined: boolean;
  /** Hebrew label: "ללא קורס" / "רמה N" / deduped "רמה 1 + רמה 2". */
  readonly shortLabel: string;
}

/** Label shown when a trainee has no visible active affiliation (locked decision 4). */
export const NO_COURSE_LABEL = "ללא קורס";

/**
 * PURE: is this raw enrollment row a VISIBLE affiliation?
 * ACTIVE enrollment + non-ARCHIVED offering + a usable numeric level.
 */
function isVisibleAffiliation(enrollment: RawAffiliationEnrollment): boolean {
  if (enrollment.status !== "ACTIVE") return false;
  if (enrollment.courseOffering.status === "ARCHIVED") return false;
  // Fail-closed on a non-schema-reachable malformed level (see file header).
  if (!Number.isFinite(enrollment.courseOffering.level)) return false;
  return true;
}

/**
 * Deterministic badge comparator (locked decision 7):
 *   1. isPrimary=true first
 *   2. offering level ascending
 *   3. offering name (Hebrew-aware)
 *   4. offering id (stable final tie-breaker)
 */
function compareVisibleAffiliation(
  a: VisibleAffiliation,
  b: VisibleAffiliation,
): number {
  const byPrimary = Number(b.isPrimary) - Number(a.isPrimary);
  if (byPrimary !== 0) return byPrimary;
  if (a.level !== b.level) return a.level - b.level;
  const byName = a.name.localeCompare(b.name, "he");
  if (byName !== 0) return byName;
  if (a.courseOfferingId < b.courseOfferingId) return -1;
  if (a.courseOfferingId > b.courseOfferingId) return 1;
  return 0;
}

/**
 * Build the deterministic "רמה 1 + רמה 2" label from the visible affiliations.
 * Deduplicates identical levels (locked decision: duplicate levels collapse), and
 * orders the joined levels ascending so the label is order-independent of the
 * badge sort (which is isPrimary-first).
 */
function buildShortLabel(visibleAffiliations: readonly VisibleAffiliation[]): string {
  if (visibleAffiliations.length === 0) return NO_COURSE_LABEL;
  const uniqueLevels = Array.from(
    new Set(visibleAffiliations.map((a) => a.level)),
  ).sort((a, b) => a - b);
  return uniqueLevels.map((level) => `רמה ${level}`).join(" + ");
}

/**
 * PURE: turn a trainee's raw enrollment rows into their affiliation summary.
 *
 * Steps: filter to visible affiliations -> dedupe by courseOfferingId (so a
 * repeated raw row for the same offering yields ONE badge; isPrimary is OR-ed so
 * any primary row for that offering marks the badge primary) -> sort
 * deterministically -> derive counts and the short label.
 *
 * Never mutates its input; the output is fully deterministic and independent of
 * the input row order.
 */
export function buildTraineeAffiliationSummary(
  enrollments: readonly RawAffiliationEnrollment[],
): TraineeAffiliationSummary {
  const byOfferingId = new Map<string, VisibleAffiliation>();

  for (const enrollment of enrollments) {
    if (!isVisibleAffiliation(enrollment)) continue;
    const offering = enrollment.courseOffering;
    const existing = byOfferingId.get(offering.id);
    if (existing) {
      // Same offering appeared more than once: collapse to one badge and treat
      // it as primary if ANY of its rows is primary. name/level come from the
      // same CourseOffering, so they are identical across duplicate rows.
      if (enrollment.isPrimary && !existing.isPrimary) {
        byOfferingId.set(offering.id, { ...existing, isPrimary: true });
      }
      continue;
    }
    byOfferingId.set(offering.id, {
      courseOfferingId: offering.id,
      name: offering.name,
      level: offering.level,
      isPrimary: enrollment.isPrimary,
    });
  }

  const visibleAffiliations = Array.from(byOfferingId.values()).sort(
    compareVisibleAffiliation,
  );

  return {
    visibleAffiliations,
    activeAffiliationCount: visibleAffiliations.length,
    hasNoActiveCourse: visibleAffiliations.length === 0,
    isCombined: visibleAffiliations.length >= 2,
    shortLabel: buildShortLabel(visibleAffiliations),
  };
}

/** The minimal Student display fields carried alongside the affiliation summary. */
export interface RawStudentWithAffiliations {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly groupName: string | null;
  readonly subgroupNumber: number | null;
  readonly identityNumber: string;
  readonly phone: string | null;
  readonly isActive: boolean;
  readonly courseEnrollments: readonly RawAffiliationEnrollment[];
}

/**
 * One admin-trainee-list row: the existing display fields PLUS the derived
 * affiliation summary. groupName/subgroupNumber are carried ONLY for the existing
 * list display continuity (Slice A2) - they are NEVER used to derive affiliation.
 */
export interface TraineeAffiliationRow {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly groupName: string | null;
  readonly subgroupNumber: number | null;
  readonly identityNumber: string;
  readonly phone: string | null;
  readonly isActive: boolean;
  readonly affiliation: TraineeAffiliationSummary;
}

/**
 * PURE: map already-fetched, already-ordered raw student rows into display rows
 * with their affiliation summaries. Student ORDER is preserved exactly as the DB
 * query returned it (the reader owns the deterministic Student orderBy); this core
 * never reorders students - it only orders each trainee's badges internally.
 * Never mutates its input.
 */
export function buildTraineeAffiliationRows(
  students: readonly RawStudentWithAffiliations[],
): TraineeAffiliationRow[] {
  return students.map((student) => ({
    id: student.id,
    firstName: student.firstName,
    lastName: student.lastName,
    fullName: student.fullName,
    groupName: student.groupName,
    subgroupNumber: student.subgroupNumber,
    identityNumber: student.identityNumber,
    phone: student.phone,
    isActive: student.isActive,
    affiliation: buildTraineeAffiliationSummary(student.courseEnrollments),
  }));
}
