/**
 * SECURITY / LEVEL 2 SLICES L2-F1A + L2-F1B: the PURE core for COURSE-SCOPED
 * WEEKLY FEEDBACK - the trainee read/submit surface (L2-F1A) and the ADMIN
 * DENOMINATOR / MISSING-RESPONSE surface (L2-F1B).
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * cookies, no next/headers, no React, no filesystem. It only shapes queries,
 * classifies already-fetched rows, and decides authorization from explicitly
 * supplied arguments - so the whole containment contract is unit-testable
 * without a database (see weekly-feedback-course-scope-core.test.ts).
 *
 * WHY THIS EXISTS
 * ---------------
 * The two trainee-facing weekly-feedback actions were unauthenticated and
 * course-blind. They "authenticated" a caller by accepting a client-supplied
 * studentId, re-reading that Student row and checking only the GLOBAL
 * Student.isActive flag - which authorizes nothing, because searchStudents() is
 * unauthenticated by design (it powers the login screen) and returns real
 * student ids. The read then picked the NEWEST PUBLISHED FORM IN THE ENTIRE
 * DATABASE, and the submit accepted any formId with no ownership predicate at
 * all. An activated Level 2 trainee would therefore have been served the Level 1
 * form and been able to write a response row into it - permanent, irreversible
 * contamination of Level 1 statistics.
 *
 * WHAT THIS OWNS
 * --------------
 *  1. Trainee course-context denial CLASSIFICATION (which failures mean "no
 *     single trustworthy trainee context" and must answer with the uniform safe
 *     result, versus real defects that must propagate).
 *  2. The EXACT offering-scoped query shapes for both the read and the submit,
 *     so ownership lives INSIDE the where clause and no cross-course row is ever
 *     fetched-then-filtered.
 *  3. The strict, non-null ownership predicate.
 *  4. The open-window classification for both actions.
 *  5. Two dependency-injected orchestrations that fix the authorization ORDER:
 *     actor -> offering -> owned form -> window -> response.
 *  6. (L2-F1B) The ADMIN denominator: strict form-ownership acceptance, the
 *     enrollment-backed roster query shapes, defensive per-student dedupe, the
 *     submitted/not-submitted split and the summary arithmetic - so a form's
 *     "X מתוך Y" is computed ONLY from the roster of the offering that owns it.
 *
 * HARD RULES BAKED IN HERE
 * ------------------------
 *  - The trainee course context is ALWAYS server-resolved. There is deliberately
 *    NO parameter anywhere in this module through which a caller could supply a
 *    courseOfferingId or a trainee id.
 *  - Nothing here infers an offering from a group name, subgroup, course name,
 *    level, date window, form title, form contents, "latest published form", or
 *    a cookie. There is NO Level 1 fallback and no "current offering" heuristic.
 *  - courseOfferingId === null FAILS CLOSED. A week that predates the offering
 *    spine carries no feedback form any trainee may reach.
 *  - Offering comparison is STRICT === on non-empty strings. No trimming, no
 *    case folding, no prefix matching.
 *  - Ownership is a MANDATORY, non-caller-configurable predicate of both query
 *    builders; a blank resolved offering id throws rather than silently widening
 *    the query to every course.
 *  - There is NO capability key here. Weekly feedback has no canonical
 *    capability key (capability-keys.ts owns exactly ten, none of which means
 *    weekly feedback), and none is reused: SCHEDULE in particular is ENABLED for
 *    Level 2 at launch, so gating on it would grant exactly what must be denied.
 *    Ownership scoping is the boundary; capability state is a separate, deferred
 *    product toggle.
 *  - Every denial produces the SAME result, so "denied", "nothing there" and
 *    "belongs to another course" are indistinguishable and no form or response
 *    can be probed for existence.
 *
 * Structural precedent: lib/course/course-scoped-week-options-core.ts (slice
 * S1A) and lib/course/trainee-module-containment-core.ts (slice L2-C1). This
 * module is neither's sibling by import: the former is schedule-specific, and
 * the latter is capability-parameterised in a way weekly feedback deliberately
 * is not.
 */
import {
  NoTraineeCourseOfferingError,
  AmbiguousTraineeCourseOfferingError,
} from "./actor-course-offering-core";
import { UnauthenticatedActorError } from "@/lib/auth/actor-types";

// ---------------------------------------------------------------------------
// Course-context denial
// ---------------------------------------------------------------------------

/**
 * The failures that mean "this caller has no single, trustworthy trainee course
 * context" and must therefore be answered with the uniform safe result rather
 * than an error:
 *
 *  - UnauthenticatedActorError            - anonymous / expired / wrong-audience
 *                                           / inactive trainee session;
 *  - NoTraineeCourseOfferingError         - zero eligible enrollments (including
 *                                           a PLANNED-only offering, which is
 *                                           exactly the pre-launch Level 2
 *                                           state);
 *  - AmbiguousTraineeCourseOfferingError  - more than one eligible enrollment.
 *
 * Everything else (Prisma failure, programming error, a defect in the resolver)
 * is NOT a denial and must propagate unchanged - a broken dependency must never
 * be silently reported to a trainee as "there is no feedback for you".
 *
 * Mirrors the classifiers in course-scoped-week-options-core.ts and
 * trainee-module-containment-core.ts. It is re-stated here rather than imported
 * because both of those modules are outside this slice's authorized file scope.
 */
export function isTraineeCourseContextDenial(error: unknown): boolean {
  return (
    error instanceof UnauthenticatedActorError ||
    error instanceof NoTraineeCourseOfferingError ||
    error instanceof AmbiguousTraineeCourseOfferingError
  );
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/**
 * Strict, non-null form ownership.
 *
 * `formCourseOfferingId` is the offering of the form's own WeeklySchedule
 * (WeeklyFeedbackForm.weeklyScheduleId is @unique, so the week - and therefore
 * the offering - is single-valued and unambiguous). ALL of the following must
 * hold:
 *
 *  1. the resolved offering id is a non-empty string (a blank resolved id can
 *     never match anything, including a blank stored value);
 *  2. the form's offering is NOT null/blank (a NULL-scoped legacy week fails
 *     closed - there is no legacy pass-through and no Level 1 default);
 *  3. the two are STRICTLY EQUAL.
 *
 * No trimming, no case folding, no prefix matching: an id either is or is not
 * the resolved one.
 */
export function isWeeklyFeedbackFormOwnedByOffering(
  formCourseOfferingId: string | null | undefined,
  resolvedCourseOfferingId: string,
): boolean {
  if (typeof resolvedCourseOfferingId !== "string" || resolvedCourseOfferingId.length === 0) {
    return false;
  }
  if (typeof formCourseOfferingId !== "string" || formCourseOfferingId.length === 0) {
    return false;
  }
  return formCourseOfferingId === resolvedCourseOfferingId;
}

// ---------------------------------------------------------------------------
// Query shapes
// ---------------------------------------------------------------------------

/**
 * The EXACT query the trainee form read runs. Both predicates are mandatory and
 * neither is caller-configurable:
 *  - `weeklySchedule.courseOfferingId` pins the form to ONE offering by exact
 *    id, INSIDE the where clause, so a cross-course form is never fetched;
 *  - `status in (PUBLISHED, CLOSED)` is the pre-existing trainee-only
 *    restriction (a DRAFT was never trainee-visible).
 *
 * There is no date range, no title pattern, no level, no group and no
 * "most recent form in the database" - the ordering only ranks forms that are
 * ALREADY restricted to the trainee's own offering.
 */
export interface TraineeWeeklyFeedbackFormQuery {
  where: {
    weeklySchedule: { courseOfferingId: string };
    status: { in: ["PUBLISHED", "CLOSED"] };
  };
  orderBy: { publishedAt: "desc" };
}

/**
 * The EXACT query the trainee submission runs. The caller-supplied formId is
 * ANDed with the same mandatory ownership predicate, so a formId belonging to
 * another course simply does not match - it is never fetched and then rejected.
 * A raw formId is NEVER authorization.
 */
export interface TraineeWeeklyFeedbackSubmissionFormQuery {
  where: {
    id: string;
    weeklySchedule: { courseOfferingId: string };
  };
}

/**
 * A blank offering id is a programming error (the server resolver always yields
 * a real cuid), and building a query from it would silently widen scope to every
 * course, so both builders throw rather than returning a query.
 */
function assertResolvedCourseOfferingId(courseOfferingId: string): void {
  if (typeof courseOfferingId !== "string" || courseOfferingId.length === 0) {
    throw new Error(
      "weekly feedback course scoping requires a non-empty, server-resolved courseOfferingId",
    );
  }
}

/** Build the offering-scoped, trainee-visible form query. */
export function buildTraineeWeeklyFeedbackFormQuery(
  courseOfferingId: string,
): TraineeWeeklyFeedbackFormQuery {
  assertResolvedCourseOfferingId(courseOfferingId);
  return {
    where: {
      weeklySchedule: { courseOfferingId },
      status: { in: ["PUBLISHED", "CLOSED"] },
    },
    orderBy: { publishedAt: "desc" },
  };
}

/** Build the offering-scoped single-form query for a submission. */
export function buildTraineeWeeklyFeedbackSubmissionFormQuery(
  formId: string,
  courseOfferingId: string,
): TraineeWeeklyFeedbackSubmissionFormQuery {
  assertResolvedCourseOfferingId(courseOfferingId);
  if (typeof formId !== "string" || formId.length === 0) {
    throw new Error("weekly feedback submission requires a non-empty formId");
  }
  return { where: { id: formId, weeklySchedule: { courseOfferingId } } };
}

// ---------------------------------------------------------------------------
// Form rows and window classification
// ---------------------------------------------------------------------------

/** The three WeeklyFeedbackForm statuses, restated to keep this module pure. */
export type WeeklyFeedbackFormStatus = "DRAFT" | "PUBLISHED" | "CLOSED";

/**
 * The MINIMUM a fetched form must carry for every decision in this module. Both
 * orchestrations are generic over a superset of this shape, so a caller may
 * project extra columns (questions, for instance) without this core knowing or
 * caring what they are.
 *
 * `weeklySchedule.courseOfferingId` is projected deliberately even though the
 * where clause already guarantees it: re-asserting it on the fetched row is
 * defense in depth against a future query edit that drops the predicate.
 */
export interface TraineeWeeklyFeedbackFormRow {
  id: string;
  title: string;
  status: WeeklyFeedbackFormStatus;
  opensAt: Date | null;
  closesAt: Date | null;
  weeklySchedule: { courseOfferingId: string | null };
}

/**
 * Whether a form is currently open for answering. Unchanged in behaviour from
 * the inline predicate this replaces: PUBLISHED, opensAt absent-or-past, and
 * closesAt absent-or-future. CLOSED and DRAFT are never open.
 */
export function isWeeklyFeedbackFormCurrentlyOpen(
  form: Pick<TraineeWeeklyFeedbackFormRow, "status" | "opensAt" | "closesAt">,
  now: Date,
): boolean {
  return (
    form.status === "PUBLISHED" &&
    (!form.opensAt || form.opensAt <= now) &&
    (!form.closesAt || form.closesAt > now)
  );
}

/**
 * The submission window state of an ALREADY-OWNED form.
 *
 * The submit path needs the three distinct states because it reports three
 * distinct, pre-existing messages. That is not an information leak: this is only
 * ever reached for a form the caller's OWN offering owns, so it discloses
 * nothing about another course. Cross-course and not-found never reach here -
 * they are denied earlier and uniformly.
 */
export type WeeklyFeedbackSubmissionWindowState =
  | "OPEN"
  | "NOT_PUBLISHED"
  | "NOT_YET_OPEN"
  | "CLOSED";

/** Classify in the same order as the checks this replaces. */
export function classifyWeeklyFeedbackSubmissionWindow(
  form: Pick<TraineeWeeklyFeedbackFormRow, "status" | "opensAt" | "closesAt">,
  now: Date,
): WeeklyFeedbackSubmissionWindowState {
  if (form.status !== "PUBLISHED") return "NOT_PUBLISHED";
  if (form.opensAt && form.opensAt > now) return "NOT_YET_OPEN";
  if (form.closesAt && form.closesAt <= now) return "CLOSED";
  return "OPEN";
}

// ---------------------------------------------------------------------------
// Read orchestration
// ---------------------------------------------------------------------------

/**
 * The outcome of the trainee read. `"none"` is the SINGLE, uniform answer to
 * every denial and every empty state: anonymous, expired, inactive trainee,
 * no eligible offering, ambiguous offering, no form for this offering,
 * NULL-scoped form, another course's form, and a not-currently-open form are all
 * indistinguishable to the caller.
 */
export type TraineeWeeklyFeedbackOutcome<TForm> =
  | { status: "none" }
  | { status: "submitted"; form: TForm; submittedAt: Date }
  | { status: "open"; form: TForm };

/**
 * The uniform "nothing for you" result. Built FRESH on every call (never a
 * shared frozen singleton) so no caller can mutate another caller's result.
 */
export function emptyWeeklyFeedbackForStudent<TForm>(): TraineeWeeklyFeedbackOutcome<TForm> {
  return { status: "none" };
}

/**
 * The trainee read dependencies.
 *
 * `requireTraineeId` is the server-derived actor step: it resolves the trainee
 * id from the SIGNED SESSION and throws UnauthenticatedActorError when there is
 * no trustworthy trainee. `resolveTraineeCourseOffering` takes NO arguments by
 * design. `fetchResponse` receives the trainee id from THIS module, never from a
 * caller argument.
 */
export interface TraineeWeeklyFeedbackReadDeps<TForm extends TraineeWeeklyFeedbackFormRow> {
  requireTraineeId: () => Promise<string>;
  resolveTraineeCourseOffering: () => Promise<{ id: string }>;
  fetchOwnedForm: (query: TraineeWeeklyFeedbackFormQuery) => Promise<TForm | null>;
  fetchResponse: (args: { formId: string; traineeId: string }) => Promise<{ submittedAt: Date } | null>;
  now: () => Date;
}

/**
 * The trainee weekly-feedback read.
 *
 * Order is deliberate and fail-closed at every step:
 *  1. derive the trainee from the signed session, then resolve THAT trainee's
 *     own offering server-side (denial -> "none"; any other error propagates);
 *  2. fetch at most ONE form, already restricted to that exact offering by the
 *     query's own where clause - no form belonging to another course is ever
 *     read into this process;
 *  3. re-assert ownership on the fetched row (defense in depth);
 *  4. only now look up THIS trainee's response, by the session-derived id;
 *  5. "already submitted" is answered BEFORE the open-window gate, so a trainee
 *     who submitted while the form was open keeps seeing the confirmation after
 *     it closes - unchanged from the behaviour this replaces.
 */
export async function loadTraineeWeeklyFeedbackWithDeps<TForm extends TraineeWeeklyFeedbackFormRow>(
  deps: TraineeWeeklyFeedbackReadDeps<TForm>,
): Promise<TraineeWeeklyFeedbackOutcome<TForm>> {
  let traineeId: string;
  let courseOfferingId: string;
  try {
    traineeId = await deps.requireTraineeId();
    courseOfferingId = (await deps.resolveTraineeCourseOffering()).id;
  } catch (error) {
    if (isTraineeCourseContextDenial(error)) {
      return emptyWeeklyFeedbackForStudent<TForm>();
    }
    throw error;
  }

  const form = await deps.fetchOwnedForm(buildTraineeWeeklyFeedbackFormQuery(courseOfferingId));
  if (!form) return emptyWeeklyFeedbackForStudent<TForm>();
  if (!isWeeklyFeedbackFormOwnedByOffering(form.weeklySchedule.courseOfferingId, courseOfferingId)) {
    return emptyWeeklyFeedbackForStudent<TForm>();
  }

  const response = await deps.fetchResponse({ formId: form.id, traineeId });
  if (response) {
    return { status: "submitted", form, submittedAt: response.submittedAt };
  }

  if (!isWeeklyFeedbackFormCurrentlyOpen(form, deps.now())) {
    return emptyWeeklyFeedbackForStudent<TForm>();
  }
  return { status: "open", form };
}

// ---------------------------------------------------------------------------
// Submission authorization
// ---------------------------------------------------------------------------

/**
 * The result of the submission gate. Only an authorized result carries the
 * SESSION-DERIVED trainee id and the verified owned form onward; that trainee id
 * is the only one that may ever reach a response lookup or a response write.
 */
export type TraineeWeeklyFeedbackSubmissionAuthorization<TForm> =
  | { authorized: false }
  | { authorized: true; traineeId: string; courseOfferingId: string; form: TForm };

/** The single, uniform denial value for the submission gate. */
const TRAINEE_WEEKLY_FEEDBACK_SUBMISSION_DENIED: TraineeWeeklyFeedbackSubmissionAuthorization<never> =
  Object.freeze({ authorized: false as const });

export interface TraineeWeeklyFeedbackSubmissionDeps<TForm extends TraineeWeeklyFeedbackFormRow> {
  requireTraineeId: () => Promise<string>;
  resolveTraineeCourseOffering: () => Promise<{ id: string }>;
  fetchOwnedFormById: (
    query: TraineeWeeklyFeedbackSubmissionFormQuery,
  ) => Promise<TForm | null>;
}

/**
 * The submission gate for a raw, caller-supplied formId.
 *
 * This is what makes a formId not-authorization: the read having been scoped is
 * never trusted, because the submit action is an independently invocable Server
 * Action and its formId may be stale, tampered with, or copied from another
 * course entirely.
 *
 * Order is deliberate and fail-closed at every step:
 *  1. derive the trainee from the signed session, then resolve THAT trainee's
 *     own offering server-side (denial -> denied; any other error propagates);
 *  2. fetch the form by id AND by that exact offering - a cross-course form
 *     never matches, so it is never read into this process;
 *  3. re-assert ownership on the fetched row (defense in depth).
 *
 * Every failure returns the SAME denial value, so unauthenticated,
 * no/ambiguous-course, not-found and cross-course are indistinguishable, and no
 * response row is read or written before it returns. The window/status gates are
 * deliberately NOT here: they apply to an already-owned form and produce
 * distinct, pre-existing messages the caller is entitled to see.
 */
export async function authorizeTraineeWeeklyFeedbackSubmissionWithDeps<
  TForm extends TraineeWeeklyFeedbackFormRow,
>(
  formId: string,
  deps: TraineeWeeklyFeedbackSubmissionDeps<TForm>,
): Promise<TraineeWeeklyFeedbackSubmissionAuthorization<TForm>> {
  let traineeId: string;
  let courseOfferingId: string;
  try {
    traineeId = await deps.requireTraineeId();
    courseOfferingId = (await deps.resolveTraineeCourseOffering()).id;
  } catch (error) {
    if (isTraineeCourseContextDenial(error)) {
      return TRAINEE_WEEKLY_FEEDBACK_SUBMISSION_DENIED;
    }
    throw error;
  }

  // A blank/absent formId is a denial, not a thrown defect: unlike the resolved
  // offering id it is caller-supplied, and it must be answered exactly like any
  // other unmatched id.
  if (typeof formId !== "string" || formId.length === 0) {
    return TRAINEE_WEEKLY_FEEDBACK_SUBMISSION_DENIED;
  }

  const form = await deps.fetchOwnedFormById(
    buildTraineeWeeklyFeedbackSubmissionFormQuery(formId, courseOfferingId),
  );
  if (!form) return TRAINEE_WEEKLY_FEEDBACK_SUBMISSION_DENIED;
  if (!isWeeklyFeedbackFormOwnedByOffering(form.weeklySchedule.courseOfferingId, courseOfferingId)) {
    return TRAINEE_WEEKLY_FEEDBACK_SUBMISSION_DENIED;
  }

  return { authorized: true, traineeId, courseOfferingId, form };
}

// ===========================================================================
// ADMIN DENOMINATOR SCOPING - SECURITY / LEVEL 2 SLICE L2-F1B
// ===========================================================================
//
// L2-F1A contained the trainee side: a Level 2 trainee can no longer READ or
// ANSWER a Level 1 form. This section contains the remaining half - the ADMIN
// side - where a Level 2 trainee could still silently distort Level 1 numbers
// merely by EXISTING.
//
// Both admin readers counted the GLOBAL active-student population
// (`Student.isActive = true`, no course predicate whatsoever) as the
// denominator of every form: listWeeklyFeedbackForms attached one global
// `activeStudentCount` to every row, and getWeeklyFeedbackResults built
// activeTraineeCount, submittedCount, notSubmittedCount and the whole
// notSubmittedTrainees list from it. The moment a Level 2 trainee is activated,
// every Level 1 form's denominator grows, its completion percentage drops, and
// the Level 2 trainee is listed BY NAME as owing a Level 1 response they are
// (correctly, since L2-F1A) not even able to see. That is a permanent
// misreading of Level 1 statistics and a cross-course disclosure of who exists
// in the other course.
//
// AUTHORITATIVE OWNERSHIP, and nothing else:
//
//     WeeklyFeedbackForm -> WeeklySchedule.courseOfferingId
//
// WeeklyFeedbackForm.weeklyScheduleId is @unique, so a form belongs to exactly
// one week and therefore to exactly one offering. Nothing here infers ownership
// from a date window, a title, a level, a group, a course name, the "current"
// offering, or an offering-id constant, and there is NO resolveCurrentCourse-
// Offering and NO Level 1 fallback. A NULL/blank courseOfferingId (a week that
// predates the offering spine) FAILS CLOSED to an EMPTY roster - denominator 0,
// no missing-response list - rather than widening to everyone.
//
// The roster itself is ENROLLMENT-BACKED, never the global Student table:
// an ACTIVE CourseEnrollment into the form's exact offering whose Student is
// also globally active. Both predicates live INSIDE the where clause, so
// another offering's trainees are never fetched and then filtered.
//
// HISTORICAL RESPONSES ARE NEVER HIDDEN. The roster governs only the
// DENOMINATOR and the MISSING list. Responses are still read from the form's
// own responses relation, so a since-deactivated trainee - or any respondent
// outside today's roster - keeps appearing in submittedTrainees,
// traineeResponses and every question's answers. A non-roster response is
// simply not subtracted from the missing count, because notSubmitted is
// computed FROM THE ROSTER rather than as (denominator - responses); that
// asymmetry is deliberate and is what keeps notSubmittedCount from ever going
// negative or under-reporting.

/**
 * Strict acceptance of a form's own offering id, returning the usable id or
 * `null` when there is none.
 *
 * This is the single place the admin side decides "is this form scoped at all",
 * and it is deliberately the same strictness the trainee ownership predicate
 * uses: a non-empty string is accepted verbatim, everything else (null,
 * undefined, non-string, empty string) yields null. No trimming, no case
 * folding, no default, no inference. `null` means FAIL CLOSED: an empty roster.
 */
export function acceptWeeklyFeedbackFormOfferingId(
  formCourseOfferingId: string | null | undefined,
): string | null {
  if (typeof formCourseOfferingId !== "string" || formCourseOfferingId.length === 0) {
    return null;
  }
  return formCourseOfferingId;
}

/**
 * The DISTINCT, accepted offering ids of a batch of forms, in first-seen order.
 *
 * listWeeklyFeedbackForms lists every form ever created, and in practice many
 * of them share one offering. Rather than one roster query per form (N queries,
 * and N chances to get the scoping wrong), the action collects the distinct
 * offerings once and loads them in a SINGLE query. Unscoped (NULL) forms
 * contribute nothing here - they resolve to denominator 0 without ever widening
 * the query.
 */
export function collectWeeklyFeedbackOfferingIds(
  formCourseOfferingIds: readonly (string | null | undefined)[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of formCourseOfferingIds) {
    const id = acceptWeeklyFeedbackFormOfferingId(raw);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Roster query shapes
// ---------------------------------------------------------------------------

/**
 * The EXACT roster query for ONE form's offering. All three predicates are
 * mandatory and none is caller-configurable:
 *  - `courseOfferingId` pins the roster to the form's own offering by exact id;
 *  - `status: "ACTIVE"` excludes an ended/withdrawn (INACTIVE) enrollment;
 *  - `student: { isActive: true }` excludes a globally deactivated trainee.
 *
 * Ordering matches the fullName-ascending order the global read it replaces
 * used, so the missing-response list keeps its existing presentation order.
 */
export interface WeeklyFeedbackRosterQuery {
  where: {
    courseOfferingId: string;
    status: "ACTIVE";
    student: { isActive: true };
  };
  orderBy: { student: { fullName: "asc" } };
}

/**
 * The EXACT roster query for the DISTINCT offerings of a batch of forms - the
 * same three mandatory predicates, widened only across an explicit, already
 * accepted id list. An EMPTY list is a valid query that matches nothing; it is
 * never "no filter".
 */
export interface WeeklyFeedbackRosterCountQuery {
  where: {
    courseOfferingId: { in: string[] };
    status: "ACTIVE";
    student: { isActive: true };
  };
}

/**
 * A blank offering id would silently widen the roster to every course, so - as
 * with the trainee builders above - it throws rather than returning a query.
 * Callers must fail closed BEFORE they get here, via
 * acceptWeeklyFeedbackFormOfferingId.
 */
function assertRosterCourseOfferingId(courseOfferingId: string): void {
  if (typeof courseOfferingId !== "string" || courseOfferingId.length === 0) {
    throw new Error(
      "weekly feedback roster scoping requires a non-empty courseOfferingId owned by the form",
    );
  }
}

/** Build the offering-scoped roster query for a single form. */
export function buildWeeklyFeedbackRosterQuery(courseOfferingId: string): WeeklyFeedbackRosterQuery {
  assertRosterCourseOfferingId(courseOfferingId);
  return {
    where: {
      courseOfferingId,
      status: "ACTIVE",
      student: { isActive: true },
    },
    orderBy: { student: { fullName: "asc" } },
  };
}

/** Build the roster query covering the distinct offerings of a form batch. */
export function buildWeeklyFeedbackRosterCountQuery(
  courseOfferingIds: readonly string[],
): WeeklyFeedbackRosterCountQuery {
  for (const id of courseOfferingIds) assertRosterCourseOfferingId(id);
  return {
    where: {
      courseOfferingId: { in: [...courseOfferingIds] },
      status: "ACTIVE",
      student: { isActive: true },
    },
  };
}

// ---------------------------------------------------------------------------
// Roster projection and dedupe
// ---------------------------------------------------------------------------

/**
 * The MINIMUM an enrollment row must carry to become a roster member. Only the
 * two fields the admin surface actually needs are projected: the student id
 * (for the submitted/not-submitted split) and the display name. Group and
 * subgroup are deliberately NOT projected - the results reader resolves those
 * effective-dated for the feedback week via loadHistoricalTraineeState, and the
 * current Student mirror must never leak back in as a fallback.
 */
export interface WeeklyFeedbackRosterEnrollmentRow {
  studentId: string;
  student: { fullName: string };
}

/** A trainee on the form's own roster: exactly one row per student. */
export interface WeeklyFeedbackRosterMember {
  id: string;
  fullName: string;
}

/**
 * Project enrollment rows to roster members, DEDUPED by student id.
 *
 * The dedupe is defensive rather than expected: `@@unique([studentId,
 * courseOfferingId])` already makes a duplicate impossible within one offering.
 * It matters for the DUAL-ENROLLED trainee - someone enrolled in both Level 1
 * and Level 2 - who legitimately has two enrollment rows and must be counted
 * ONCE for the form's offering, and it makes any future query change unable to
 * inflate a denominator by double-counting. First occurrence wins, so the
 * query's fullName ordering is preserved.
 */
export function toWeeklyFeedbackRosterMembers(
  rows: readonly WeeklyFeedbackRosterEnrollmentRow[],
): WeeklyFeedbackRosterMember[] {
  const seen = new Set<string>();
  const members: WeeklyFeedbackRosterMember[] = [];
  for (const row of rows) {
    if (seen.has(row.studentId)) continue;
    seen.add(row.studentId);
    members.push({ id: row.studentId, fullName: row.student.fullName });
  }
  return members;
}

/** An enrollment row reduced to the pair the batch count needs. */
export interface WeeklyFeedbackRosterCountRow {
  courseOfferingId: string;
  studentId: string;
}

/**
 * Roster SIZE per offering, deduped per (offering, student) pair.
 *
 * A dual-enrolled trainee contributes exactly one to EACH of their offerings -
 * which is correct: they really are on both rosters, and each course's own
 * denominator must include them once. An offering with no active roster simply
 * has no entry, which reads as 0.
 */
export function countWeeklyFeedbackRosterByOffering(
  rows: readonly WeeklyFeedbackRosterCountRow[],
): Map<string, number> {
  const seenPerOffering = new Map<string, Set<string>>();
  for (const row of rows) {
    const id = acceptWeeklyFeedbackFormOfferingId(row.courseOfferingId);
    if (id === null) continue;
    let students = seenPerOffering.get(id);
    if (!students) {
      students = new Set<string>();
      seenPerOffering.set(id, students);
    }
    students.add(row.studentId);
  }
  const counts = new Map<string, number>();
  for (const [id, students] of seenPerOffering) counts.set(id, students.size);
  return counts;
}

/**
 * The denominator for ONE form: the roster size of the offering that owns it.
 *
 * An unscoped (NULL) form and an offering with no active roster BOTH yield 0.
 * There is deliberately no distinction and no fallback - a form nobody can be
 * enrolled into has nobody who owes it a response.
 */
export function weeklyFeedbackDenominatorForForm(
  formCourseOfferingId: string | null | undefined,
  countsByOffering: ReadonlyMap<string, number>,
): number {
  const id = acceptWeeklyFeedbackFormOfferingId(formCourseOfferingId);
  if (id === null) return 0;
  return countsByOffering.get(id) ?? 0;
}

// ---------------------------------------------------------------------------
// Submitted / not-submitted split
// ---------------------------------------------------------------------------

/**
 * The roster members who HAVE submitted. Generic over the member shape so the
 * caller may carry extra columns through it.
 */
export function selectSubmittedRosterMembers<TMember extends { id: string }>(
  roster: readonly TMember[],
  submittedStudentIds: ReadonlySet<string>,
): TMember[] {
  return roster.filter((member) => submittedStudentIds.has(member.id));
}

/**
 * The roster members who have NOT submitted - the missing-response list.
 *
 * Computed FROM THE ROSTER, never as "denominator minus responses". A response
 * from outside the roster (a since-deactivated trainee, or a trainee whose
 * enrollment ended) therefore cannot decrement this list or its count, and the
 * count can never go negative.
 */
export function selectNotSubmittedRosterMembers<TMember extends { id: string }>(
  roster: readonly TMember[],
  submittedStudentIds: ReadonlySet<string>,
): TMember[] {
  return roster.filter((member) => !submittedStudentIds.has(member.id));
}

/** The three numbers the admin results summary reports. */
export interface WeeklyFeedbackDenominatorSummary {
  activeTraineeCount: number;
  submittedCount: number;
  notSubmittedCount: number;
}

/**
 * The summary arithmetic, entirely roster-derived:
 *  - activeTraineeCount  = the scoped roster size;
 *  - submittedCount      = roster members who submitted;
 *  - notSubmittedCount   = roster members who did not.
 *
 * The two always sum to activeTraineeCount by construction, so an off-roster
 * response can neither inflate submittedCount nor deflate notSubmittedCount.
 */
export function summarizeWeeklyFeedbackDenominator(
  roster: readonly { id: string }[],
  submittedStudentIds: ReadonlySet<string>,
): WeeklyFeedbackDenominatorSummary {
  const submittedCount = selectSubmittedRosterMembers(roster, submittedStudentIds).length;
  return {
    activeTraineeCount: roster.length,
    submittedCount,
    notSubmittedCount: roster.length - submittedCount,
  };
}
