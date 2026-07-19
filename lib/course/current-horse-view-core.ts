/**
 * MULTI-COURSE W8A-4 - PURE current-horse VIEW core (enrollment-scoped).
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * "use server". It accepts already-fetched CourseEnrollment candidate rows for a
 * single (student, current offering) pair and either returns the enrollment's
 * current-horse cache view or throws a typed, fail-closed error. The whole
 * cardinality/active contract is therefore unit-testable without a database
 * (see current-horse-view-core.test.ts).
 *
 * AUTHORITY (W8A-4): the CourseEnrollment horse cache
 * (hasPrivateHorse/privateHorseName/assignedHorseName, populated by the W8A-2/3
 * backfill from the current TraineeHorseAssignment interval) is the value this
 * view returns. There is DELIBERATELY NO Student fallback here - the Student
 * horse columns are only a temporary compatibility mirror, never a fallback
 * source for this enrollment-scoped view.
 *
 * FAIL CLOSED (locked): this core refuses to invent a horse view. It throws on
 *  - zero enrollment candidates       -> NoCurrentHorseEnrollmentError
 *  - two or more enrollment candidates -> AmbiguousCurrentHorseEnrollmentError
 *  - a single but non-ACTIVE enrollment -> InactiveCurrentHorseEnrollmentError
 * Every error carries only safe public ids (cuids) - never a horse name, person
 * name, phone, or identity number.
 *
 * NOTE (W8A-4 scope): this core and its IO wrapper (current-horse-view.ts) are
 * NOT wired into any existing screen or action in this stage. No runtime read or
 * write behavior changes.
 */
import type { CourseEnrollmentStatus } from "@/app/generated/prisma/client";
import type { HorseInfoInput } from "@/lib/horse-info";

/**
 * One CourseEnrollment candidate for a single (student, current offering) pair,
 * already fetched by the IO wrapper. The unique constraint
 * (studentId, courseOfferingId) means at most one row can legitimately exist;
 * the wrapper still fetches up to two so a violated invariant surfaces as an
 * AmbiguousCurrentHorseEnrollmentError rather than being silently collapsed.
 */
export interface CurrentHorseEnrollmentCandidate {
  id: string;
  status: CourseEnrollmentStatus;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

/**
 * The returned view is exactly the shape `getHorseDisplayInfo` accepts, so a
 * caller can pipe it straight into the shared badge/label logic without any
 * reshaping. Kept structurally identical to HorseInfoInput by aliasing it, so a
 * future change to that input is a compile error here rather than silent drift.
 */
export type CurrentHorseView = HorseInfoInput;

/** No enrollment candidate exists - there is no current horse view to return. */
export class NoCurrentHorseEnrollmentError extends Error {
  constructor() {
    super(
      "No CourseEnrollment exists for this student in the current offering; " +
        "cannot resolve an enrollment-scoped current-horse view.",
    );
    this.name = "NoCurrentHorseEnrollmentError";
  }
}

/**
 * Two or more enrollment candidates exist for one (student, offering) pair - the
 * (studentId, courseOfferingId) uniqueness invariant is violated, so this core
 * refuses to choose. Carries the safe enrollment ids (public cuids, never PII).
 */
export class AmbiguousCurrentHorseEnrollmentError extends Error {
  readonly enrollmentIds: string[];
  constructor(enrollmentIds: string[]) {
    super(
      `Ambiguous current-horse enrollment: ${enrollmentIds.length} enrollments exist ` +
        `for this student in the current offering (ids: ${enrollmentIds.join(", ")}). ` +
        `The enrollment-scoped horse view refuses to choose one.`,
    );
    this.name = "AmbiguousCurrentHorseEnrollmentError";
    this.enrollmentIds = enrollmentIds;
  }
}

/**
 * Exactly one enrollment exists but it is not ACTIVE. The current-horse view is
 * only meaningful for an active enrollment, so this fails closed rather than
 * returning an inactive enrollment's stale cache. Carries the safe enrollment id
 * and its status (an enum value, not PII).
 */
export class InactiveCurrentHorseEnrollmentError extends Error {
  readonly enrollmentId: string;
  readonly status: CourseEnrollmentStatus;
  constructor(enrollmentId: string, status: CourseEnrollmentStatus) {
    super(
      `CourseEnrollment ${enrollmentId} is ${status} (not ACTIVE); the enrollment-` +
        `scoped current-horse view refuses to read a non-active enrollment's cache.`,
    );
    this.name = "InactiveCurrentHorseEnrollmentError";
    this.enrollmentId = enrollmentId;
    this.status = status;
  }
}

/**
 * The pure cardinality/active decision. The caller fetches AT MOST TWO rows, so
 * "two or more" is detectable without counting; passing more than two is still
 * treated as ambiguous. Never returns the first of several, never falls back to
 * Student, never invents a view.
 *
 * On the single ACTIVE enrollment it returns that enrollment's three cache
 * fields verbatim (the cache is the authority) - it does not re-derive or
 * normalize them here.
 */
export function resolveCurrentHorseView(
  candidates: readonly CurrentHorseEnrollmentCandidate[],
): CurrentHorseView {
  if (candidates.length === 0) {
    throw new NoCurrentHorseEnrollmentError();
  }
  if (candidates.length > 1) {
    throw new AmbiguousCurrentHorseEnrollmentError([...candidates].map((c) => c.id).sort());
  }
  const enrollment = candidates[0];
  if (enrollment.status !== "ACTIVE") {
    throw new InactiveCurrentHorseEnrollmentError(enrollment.id, enrollment.status);
  }
  return {
    hasPrivateHorse: enrollment.hasPrivateHorse,
    privateHorseName: enrollment.privateHorseName,
    assignedHorseName: enrollment.assignedHorseName,
  };
}
