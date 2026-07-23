/**
 * MULTI-COURSE (enrollment slice E3) - PURE core for the admin enrollment-setup
 * verification list of ONE exact CourseOffering.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * auth/session/cookie. It takes already-fetched CourseEnrollment rows for EXACTLY
 * ONE offering (the IO reader owns the courseOfferingId predicate) plus an
 * explicit `asOf` date, and produces a deterministic, privacy-narrow display list
 * for the admin setup page. The whole contract is unit-testable without a
 * database (see offering-enrollments-admin-core.test.ts).
 *
 * WHY A DEDICATED CORE (and not buildEnrollmentRoster): the E1 enrollment writer
 * creates the initial GroupMembership with effectiveFrom = offering.startDate,
 * which for a PLANNED Level 2 offering is a FUTURE date relative to "today". A
 * reader resolving membership "current at today" would report the freshly created
 * enrollment as having NO current membership and mislabel it as broken. This core
 * therefore resolves membership at `asOf = offering.startDate` (passed by the IO
 * reader), so an enrollment whose only membership starts on the offering start
 * date is correctly shown as current. It reuses the committed, tested interval
 * and group-resolution helpers from enrollment-view (isMembershipCurrentAt,
 * resolveGroupFromMembership) rather than re-deriving them.
 *
 * Deliberate NON-responsibilities:
 *   - it reads no phone / horse / schedule / duty / capability data - the input
 *     row shape cannot even carry them;
 *   - it never masks the identity number (that is the page's presentation
 *     concern); it surfaces the raw identityNumber so the page can mask it;
 *   - it never mutates its input and never picks an arbitrary membership when the
 *     count current at `asOf` is not exactly one - such enrollments are surfaced
 *     with a stable membership-state marker instead.
 */
import type { CourseEnrollmentStatus } from "@/app/generated/prisma/client";
import {
  isMembershipCurrentAt,
  resolveGroupFromMembership,
  type RawMembershipGroup,
} from "./enrollment-view";

/** One GroupMembership row with its dated interval and target group. */
export interface AdminEnrollmentMembershipRow {
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly courseGroup: RawMembershipGroup;
}

/** One CourseEnrollment row for this offering, with its minimal student fields. */
export interface AdminEnrollmentRow {
  readonly id: string;
  readonly status: CourseEnrollmentStatus;
  readonly isPrimary: boolean;
  readonly student: {
    readonly id: string;
    readonly fullName: string;
    readonly identityNumber: string;
  };
  readonly memberships: readonly AdminEnrollmentMembershipRow[];
}

/**
 * Stable membership-state marker for the display row. OK = exactly one membership
 * current at `asOf` and its group resolved; the others are surfaced (never
 * hidden, never repaired) so an admin can spot a malformed enrollment.
 */
export type AdminEnrollmentMembershipState =
  | "OK"
  | "NO_CURRENT"
  | "MULTIPLE"
  | "UNRESOLVED";

/** The privacy-narrow display row the admin verification list renders. */
export interface AdminEnrollmentDisplayRow {
  readonly studentId: string;
  readonly fullName: string;
  readonly identityNumber: string;
  readonly status: CourseEnrollmentStatus;
  readonly isPrimary: boolean;
  /** e.g. "ג / 1"; a top-level target -> the group name; null when unresolved. */
  readonly subgroupLabel: string | null;
  /** The current membership's effectiveFrom, or null when not exactly one. */
  readonly effectiveFrom: Date | null;
  readonly membershipState: AdminEnrollmentMembershipState;
}

/** Deterministic comparator: fullName asc (Hebrew-aware), then studentId asc. */
function compareDisplayRow(
  a: AdminEnrollmentDisplayRow,
  b: AdminEnrollmentDisplayRow,
): number {
  const byName = a.fullName.localeCompare(b.fullName, "he");
  if (byName !== 0) return byName;
  if (a.studentId < b.studentId) return -1;
  if (a.studentId > b.studentId) return 1;
  return 0;
}

/**
 * Build the deterministic display list for ONE offering's enrollments, resolving
 * each enrollment's membership at `asOf`.
 *
 * Per enrollment:
 *   - filter memberships current at `asOf` (half-open interval; a null `asOf`
 *     resolves nothing -> NO_CURRENT, which the offering-with-no-startDate case
 *     cannot actually reach because E1 never creates an enrollment without a
 *     start date);
 *   - 0 current -> NO_CURRENT; >1 -> MULTIPLE (never pick one arbitrarily);
 *   - exactly 1 -> resolve its group. A top-level group yields its own name; a
 *     subgroup yields "parentName / subgroupNumber". An unmappable group ->
 *     UNRESOLVED.
 *
 * Never mutates the input; the output order is fully deterministic.
 */
export function buildAdminEnrollmentDisplayRows(
  enrollments: readonly AdminEnrollmentRow[],
  asOf: Date | null,
): AdminEnrollmentDisplayRow[] {
  const rows: AdminEnrollmentDisplayRow[] = enrollments.map((enrollment) => {
    const base = {
      studentId: enrollment.student.id,
      fullName: enrollment.student.fullName,
      identityNumber: enrollment.student.identityNumber,
      status: enrollment.status,
      isPrimary: enrollment.isPrimary,
    } as const;

    const current =
      asOf === null
        ? []
        : enrollment.memberships.filter((m) => isMembershipCurrentAt(m, asOf));

    if (current.length === 0) {
      return { ...base, subgroupLabel: null, effectiveFrom: null, membershipState: "NO_CURRENT" };
    }
    if (current.length > 1) {
      return { ...base, subgroupLabel: null, effectiveFrom: null, membershipState: "MULTIPLE" };
    }

    const membership = current[0];
    const resolution = resolveGroupFromMembership(membership.courseGroup);
    if (!resolution.ok) {
      return {
        ...base,
        subgroupLabel: null,
        effectiveFrom: membership.effectiveFrom,
        membershipState: "UNRESOLVED",
      };
    }

    const subgroupLabel =
      resolution.subgroupNumber === null
        ? resolution.groupName
        : `${resolution.groupName} / ${resolution.subgroupNumber}`;

    return {
      ...base,
      subgroupLabel,
      effectiveFrom: membership.effectiveFrom,
      membershipState: "OK",
    };
  });

  rows.sort(compareDisplayRow);
  return rows;
}
