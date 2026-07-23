/**
 * URGENT LEVEL 2 ACCESS - SLICE L2-0: PURE decision core for ACTOR-AWARE course
 * offering resolution (trainee and instructor).
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * auth/session/cookie read. It receives an already-authenticated actor id plus
 * already-fetched rows and either returns the stable CurrentCourseOffering view
 * or throws a typed error. The whole contract is unit-testable without a
 * database (see actor-course-offering-core.test.ts).
 *
 * The two audiences have DIFFERENT course-context models, on purpose:
 *  - TRAINEE: context is DERIVED from enrollment data. Exactly one ACTIVE
 *    CourseEnrollment into an ACTIVE CourseOffering, or it fails closed.
 *  - INSTRUCTOR: context is REQUESTED, not derived. The caller must state an
 *    explicit courseOfferingId, and the server checks it against a temporary
 *    explicit allowed-offerings policy. There is no instructor-id allow-list and
 *    no per-instructor offering assignment.
 *
 * Both resolvers FAIL CLOSED. Neither ever falls back to another offering, and
 * neither infers course context from a trainee's group/subgroup, a name, an
 * identity number, a date window, a course level, an offering name, schedule
 * contents, a status ordering, the "current" offering, or a cookie.
 *
 * NOTHING here is wired into an existing reader in this slice: schedule and
 * contact call sites still use the legacy resolver.
 */
import {
  resolveCurrentCourseOfferingFromRows,
  type CourseOfferingRow,
  type CurrentCourseOffering,
} from "./current-offering-core";
import {
  mapOfferingByIdRowToView,
  type CourseOfferingByIdRow,
  type CourseOfferingView,
} from "./offering-by-id-core";
import type { CourseEnrollmentStatus } from "@/app/generated/prisma/client";

// ---------------------------------------------------------------------------
// Trainee
// ---------------------------------------------------------------------------

/**
 * One fetched CourseEnrollment row for the authenticated trainee, carrying its
 * own status AND the full status-bearing offering row.
 *
 * `enrollmentStatus` and `offering.status` are BOTH re-checked by the core even
 * though the query is expected to filter on them: the fetch filter and the
 * decision are independent defenses, so a future query edit cannot silently
 * widen who resolves to a course.
 *
 * isPrimary is deliberately ABSENT from this row type. "Exactly one primary
 * enrollment per student" is an action-layer invariant, NOT a database
 * constraint (see the CourseEnrollment model comment), so isPrimary must not be
 * used to break a tie at launch - two eligible enrollments fail closed instead.
 */
export interface TraineeEnrollmentOfferingRow {
  readonly enrollmentId: string;
  readonly enrollmentStatus: CourseEnrollmentStatus;
  readonly offering: CourseOfferingRow;
}

/**
 * The authenticated trainee has NO enrollment that grants a course context:
 * zero ACTIVE enrollments, or none of them into an ACTIVE offering (e.g. only a
 * PLANNED offering, or only INACTIVE enrollments).
 */
export class NoTraineeCourseOfferingError extends Error {
  readonly studentId: string;
  constructor(studentId: string) {
    super(
      `Trainee ${studentId} has no ACTIVE CourseEnrollment into an ACTIVE ` +
        `CourseOffering; course context cannot be resolved and is never guessed.`,
    );
    this.name = "NoTraineeCourseOfferingError";
    this.studentId = studentId;
  }
}

/**
 * The authenticated trainee has MORE THAN ONE eligible enrollment. The launch
 * invariant is "exactly one", so this fails closed rather than choosing.
 * Carries only safe public cuids for diagnostics (never PII).
 */
export class AmbiguousTraineeCourseOfferingError extends Error {
  readonly studentId: string;
  readonly offeringIds: string[];
  constructor(studentId: string, offeringIds: string[]) {
    super(
      `Trainee ${studentId} has ${offeringIds.length} ACTIVE enrollments into ` +
        `ACTIVE offerings (ids: ${offeringIds.join(", ")}). The trainee course ` +
        `resolver refuses to choose one; isPrimary is not a database-enforced ` +
        `tie-breaker and is deliberately ignored.`,
    );
    this.name = "AmbiguousTraineeCourseOfferingError";
    this.studentId = studentId;
    this.offeringIds = offeringIds;
  }
}

/**
 * Decide the authenticated trainee's course offering from their fetched
 * enrollment rows.
 *
 *  - keeps ONLY rows whose enrollment is ACTIVE and whose offering is ACTIVE;
 *  - 0 eligible  -> NoTraineeCourseOfferingError (fail closed);
 *  - >1 eligible -> AmbiguousTraineeCourseOfferingError (fail closed, no
 *    isPrimary tie-break, no lowest-level / earliest-date / first-row pick);
 *  - exactly 1   -> the stable CurrentCourseOffering view.
 *
 * The single-row mapping (and the missing-dates check that produces
 * IncompleteCourseOfferingError) is delegated to the existing pure cardinality
 * core so the returned view model is byte-identical to the legacy resolver's.
 */
export function resolveTraineeCourseOfferingFromRows(
  studentId: string,
  rows: readonly TraineeEnrollmentOfferingRow[],
): CurrentCourseOffering {
  const eligible = rows.filter(
    (r) => r.enrollmentStatus === "ACTIVE" && r.offering.status === "ACTIVE",
  );

  if (eligible.length === 0) {
    throw new NoTraineeCourseOfferingError(studentId);
  }
  if (eligible.length > 1) {
    throw new AmbiguousTraineeCourseOfferingError(
      studentId,
      eligible.map((r) => r.offering.id),
    );
  }
  // Exactly one eligible row: reuse the shared mapper so completeness (dates)
  // is enforced identically. The zero/many branches of that core are
  // unreachable here - the cardinality was already decided above.
  return resolveCurrentCourseOfferingFromRows([eligible[0].offering]);
}

// ---------------------------------------------------------------------------
// Instructor
// ---------------------------------------------------------------------------

/**
 * TEMPORARY instructor course-context policy, INJECTED so this core never
 * imports the compatibility module and stays testable with arbitrary fake
 * policies.
 *
 * There is deliberately NO instructor id in this policy: instructors are not
 * assigned to an offering and no instructor-id allow-list exists. The policy
 * answers exactly one question - "is this EXPLICITLY REQUESTED offering id one
 * the instructor audience is allowed to address?".
 */
export interface InstructorOfferingAccessPolicy {
  readonly isAllowedOfferingId: (courseOfferingId: string) => boolean;
}

/**
 * The request did not state which offering it means (missing/blank
 * courseOfferingId). Course context is NEVER inferred - not from the
 * instructor's name or identity number, not from dates, not from a course
 * level, not from an offering name, not from schedule contents, not from the
 * "current" offering, and not from a cookie - so this fails closed.
 */
export class MissingInstructorCourseOfferingIdError extends Error {
  constructor() {
    super(
      "No explicit courseOfferingId was supplied; instructor course context is " +
        "never inferred from instructor identity, dates, level, offering name, " +
        "schedule contents, the current offering, or cookies.",
    );
    this.name = "MissingInstructorCourseOfferingIdError";
  }
}

/**
 * The explicitly requested offering is outside the temporary instructor policy.
 * Fails closed: the resolver NEVER substitutes an allowed offering for a
 * disallowed request.
 */
export class InstructorCourseOfferingNotAllowedError extends Error {
  readonly offeringId: string;
  constructor(offeringId: string) {
    super(
      `CourseOffering ${offeringId} is not one of the offerings the instructor ` +
        `audience may address; the request is refused and no other offering is ` +
        `substituted.`,
    );
    this.name = "InstructorCourseOfferingNotAllowedError";
    this.offeringId = offeringId;
  }
}

/**
 * The requested (and allowed) offering does not exist, or the fetch returned a
 * different row than was asked for. Fails closed - never falls back.
 */
export class InstructorCourseOfferingUnavailableError extends Error {
  readonly offeringId: string;
  readonly reason: "missing" | "id-mismatch";
  constructor(offeringId: string, reason: "missing" | "id-mismatch") {
    super(
      `The requested CourseOffering (${offeringId}) is unavailable (${reason}); ` +
        `instructor course context fails closed and never falls back to another ` +
        `offering.`,
    );
    this.name = "InstructorCourseOfferingUnavailableError";
    this.offeringId = offeringId;
    this.reason = reason;
  }
}

/**
 * Authorize an EXPLICITLY REQUESTED offering id for the instructor audience.
 *
 * Blank/non-string -> MissingInstructorCourseOfferingIdError (the caller must
 * state which course it means). Outside the policy ->
 * InstructorCourseOfferingNotAllowedError. Otherwise the id is returned
 * UNCHANGED, so it can be used as an exact primary-key lookup.
 *
 * This is a pure check: it does NOT prove the offering exists. The caller must
 * verify that too (see assertInstructorCourseOfferingExists).
 */
export function authorizeInstructorCourseOfferingId(
  requestedCourseOfferingId: string,
  policy: InstructorOfferingAccessPolicy,
): string {
  if (
    typeof requestedCourseOfferingId !== "string" ||
    requestedCourseOfferingId.length === 0
  ) {
    throw new MissingInstructorCourseOfferingIdError();
  }
  if (!policy.isAllowedOfferingId(requestedCourseOfferingId)) {
    throw new InstructorCourseOfferingNotAllowedError(requestedCourseOfferingId);
  }
  return requestedCourseOfferingId;
}

/**
 * Verify the authorized offering actually EXISTS and is the exact row that was
 * asked for, then map it to the stable by-id view.
 *
 * Status is deliberately NOT gated here. The instructor policy is "these two
 * offerings are addressable", and the Level 2 offering is NOT being made ACTIVE
 * by this slice, so requiring ACTIVE would deny the very access being launched.
 * Dates are likewise passed through as Date | null - a PLANNED offering may
 * legitimately be undated (schema: @db.Date optional) and this view never
 * invents one. Any status/date requirement belongs to the individual
 * course-scoped reader, not to this identity check.
 */
export function assertInstructorCourseOfferingExists(
  offeringId: string,
  row: CourseOfferingByIdRow | null,
): CourseOfferingView {
  if (row === null) {
    throw new InstructorCourseOfferingUnavailableError(offeringId, "missing");
  }
  if (row.id !== offeringId) {
    throw new InstructorCourseOfferingUnavailableError(offeringId, "id-mismatch");
  }
  return mapOfferingByIdRowToView(row);
}

// ---------------------------------------------------------------------------
// Dependency-injected orchestration
//
// These live in the PURE core (not in the IO wrapper) on purpose: they perform
// no IO themselves, only sequence injected boundaries. Keeping them here lets
// the DB-free tests exercise the exact query shapes and the fail-closed wiring
// without importing the Prisma client or the next/headers-backed Actor DAL.
// ---------------------------------------------------------------------------

/**
 * The exact query the trainee resolver issues. Filtered to the authenticated
 * student's ACTIVE enrollments into ACTIVE offerings; take:3 so "more than one"
 * is detectable (and reportable) without counting the whole table.
 */
export interface TraineeEnrollmentQuery {
  readonly take: number;
  readonly where: {
    readonly studentId: string;
    readonly status: "ACTIVE";
    readonly courseOffering: { readonly status: "ACTIVE" };
  };
}

/** Injected boundary for the trainee resolver (session read + enrollment fetch). */
export interface TraineeCourseOfferingDeps {
  requireTraineeId: () => Promise<string>;
  fetchTraineeEnrollmentRows: (
    query: TraineeEnrollmentQuery,
  ) => Promise<readonly TraineeEnrollmentOfferingRow[]>;
}

/**
 * Resolve the authenticated trainee's single course offering.
 *
 * Course authority is EXACTLY: one ACTIVE CourseEnrollment belonging to an
 * ACTIVE CourseOffering. Zero or more than one fails closed. Student.groupName /
 * Student.subgroupNumber are never read, isPrimary is never used as a
 * tie-breaker, no selected-course cookie is consulted, and there is NO fallback
 * to the legacy Level 1 offering.
 */
export async function resolveTraineeCourseOfferingWithDeps(
  deps: TraineeCourseOfferingDeps,
): Promise<CurrentCourseOffering> {
  const studentId = await deps.requireTraineeId();
  const rows = await deps.fetchTraineeEnrollmentRows({
    take: 3,
    where: {
      studentId,
      status: "ACTIVE",
      courseOffering: { status: "ACTIVE" },
    },
  });
  return resolveTraineeCourseOfferingFromRows(studentId, rows);
}

/**
 * Injected boundary for the instructor resolver.
 *
 * `requireActiveInstructor` exists purely to enforce "an authenticated ACTIVE
 * instructor is present" - it is expected to THROW otherwise. Its result is
 * intentionally discarded: no part of the decision is keyed by instructor
 * identity. Inactive instructors are denied inside this dependency by the
 * existing Actor DAL checks, not by any new logic here.
 */
export interface InstructorCourseOfferingDeps {
  requireActiveInstructor: () => Promise<unknown>;
  isAllowedOfferingId: (courseOfferingId: string) => boolean;
  fetchOfferingById: (offeringId: string) => Promise<CourseOfferingByIdRow | null>;
}

/**
 * Resolve an EXPLICITLY REQUESTED course offering for the instructor audience.
 *
 * Order is deliberate and fail-closed at every step:
 *  1. require an authenticated ACTIVE instructor (throws if absent/inactive);
 *  2. require an explicit courseOfferingId (never inferred);
 *  3. require that id to be inside the temporary instructor policy;
 *  4. require the offering to exist, as exactly that id.
 * Exactly ONE offering lookup is performed and no other offering is ever
 * substituted or probed.
 */
export async function resolveInstructorCourseOfferingWithDeps(
  requestedCourseOfferingId: string,
  deps: InstructorCourseOfferingDeps,
): Promise<CourseOfferingView> {
  await deps.requireActiveInstructor();
  const offeringId = authorizeInstructorCourseOfferingId(requestedCourseOfferingId, {
    isAllowedOfferingId: deps.isAllowedOfferingId,
  });
  const row = await deps.fetchOfferingById(offeringId);
  return assertInstructorCourseOfferingExists(offeringId, row);
}
