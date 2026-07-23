/**
 * URGENT LEVEL 2 ACCESS - SLICE L2-0: the SINGLE, TEMPORARY, SERVER-ONLY module
 * that owns the hardcoded course-context compatibility data required to launch
 * narrow Level 2 access without breaking the existing Level 1 paths.
 *
 * WHY THIS EXISTS
 * ---------------
 * 1. resolveCurrentCourseOffering() is a SINGLETON resolver: it throws
 *    AmbiguousCourseOfferingError the moment two offerings are ACTIVE. Several
 *    live Level 1 paths depend on it. It therefore needs an EXPLICIT, id-based
 *    statement of "the established Level 1 offering" for exactly the known
 *    two-ACTIVE state, so a future Level 2 activation cannot break them all at
 *    once.
 * 2. There is no schema relation between Instructor and CourseOffering, and no
 *    relation may be added under this deadline (locked decision 5). The
 *    temporary instructor policy is therefore an explicit, server-side list of
 *    the offerings an authenticated ACTIVE instructor is allowed to address.
 *
 * TEMPORARY INSTRUCTOR POLICY (decision change, this slice)
 * --------------------------------------------------------
 * Instructors are NOT assigned to one offering. There is NO instructor-id
 * allow-list and NO instructor id is required. Every authenticated ACTIVE
 * instructor may address BOTH verified offerings; which one a request means must
 * be stated EXPLICITLY by the caller as a courseOfferingId, and the server
 * verifies that id is one of the two allowed offerings and that it exists.
 * Inactive instructors are denied upstream by the existing Actor DAL
 * (getCurrentInstructor / requireCurrentInstructor), not here.
 *
 * "May address both offerings" is a COURSE-CONTEXT statement only. It grants no
 * module, and it must never be read as a reason to expose a global Level 1
 * module (contacts, schedule readers, navigation, admin surfaces) in a Level 2
 * context. Module-level gating is a separate, later slice.
 *
 * HARD RULES BAKED IN HERE
 * ------------------------
 *  - IDs are EXACT primary keys, verified out-of-band. Nothing in this module
 *    infers an offering from a name, a level number, a date window, a status or
 *    status ordering, an ActivityYear, schedule contents, a cookie, or a
 *    "current offering" heuristic.
 *  - Nothing here inspects an instructor's name, identity number or dates - the
 *    instructor policy is not keyed by instructor identity at all.
 *  - SERVER-ONLY BY POLICY: no value in this module may be returned to, or
 *    embedded in props for, a client component. (The repo convention is not to
 *    import the `server-only` package; a contract test enforces the
 *    no-client-import rule instead - see
 *    temporary-level2-compatibility.contract.test.ts.)
 *  - PURE: no Prisma, no DB, no clock, no randomness, no env, no cookies. It is
 *    the CALLER's job to verify that a requested offering actually exists before
 *    trusting it (fail closed).
 *  - This module never changes an offering's status. Level 2 is NOT made ACTIVE
 *    by this slice.
 *
 * REMOVAL CRITERIA (delete this whole module when ALL of these hold)
 * -----------------------------------------------------------------
 *  A. A permanent Instructor <-> CourseOffering relation exists in the schema and
 *     is populated, so INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS has no remaining
 *     purpose and instructor scope is answered by data, not by a constant.
 *  B. Every remaining resolveCurrentCourseOffering() call site has been migrated
 *     to an explicit, actor-aware or admin-selected offering, so the legacy
 *     two-ACTIVE compatibility branch is never taken.
 *  C. No module imports LEVEL_1_COURSE_OFFERING_ID or
 *     LEVEL_2_COURSE_OFFERING_ID.
 * At that point deleting this file must break nothing; if it does, the migration
 * above is incomplete.
 */

/**
 * The established Level 1 CourseOffering (verified primary key). This is the
 * offering the pre-Level-2 application implicitly meant by "the current course".
 */
export const LEVEL_1_COURSE_OFFERING_ID = "cmrqngqhn00017gcndjixzrh0";

/** The Level 2 CourseOffering (verified primary key) being launched. */
export const LEVEL_2_COURSE_OFFERING_ID = "cmrxk58vc0000lscnfm54bpze";

/**
 * The EXACT ACTIVE-offering multiset the legacy singleton resolver is permitted
 * to disambiguate. Any other multi-offering ACTIVE state (a third offering, an
 * unknown pair, a duplicate) is NOT a known compatibility state and must still
 * fail closed with AmbiguousCourseOfferingError.
 */
export const LEGACY_COMPATIBILITY_ACTIVE_OFFERING_IDS: readonly [string, string] = [
  LEVEL_1_COURSE_OFFERING_ID,
  LEVEL_2_COURSE_OFFERING_ID,
];

/**
 * TEMPORARY instructor course-context policy: the complete, explicit set of
 * offerings an authenticated ACTIVE instructor may address. Identical for every
 * instructor - deliberately NOT keyed by instructor id, name or identity number.
 *
 * Frozen so no caller can widen the policy at runtime by pushing onto it.
 */
export const INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS: readonly string[] = Object.freeze([
  LEVEL_1_COURSE_OFFERING_ID,
  LEVEL_2_COURSE_OFFERING_ID,
]);

const INSTRUCTOR_ALLOWED_OFFERING_ID_SET: ReadonlySet<string> = new Set(
  INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS,
);

/**
 * Exact-id membership test for the temporary instructor offering policy.
 * No trimming, no case folding, no prefix matching: an id either is or is not
 * allowed. A blank/non-string id is never allowed.
 */
export function isInstructorAllowedCourseOfferingId(courseOfferingId: string): boolean {
  if (typeof courseOfferingId !== "string" || courseOfferingId.length === 0) {
    return false;
  }
  return INSTRUCTOR_ALLOWED_OFFERING_ID_SET.has(courseOfferingId);
}
