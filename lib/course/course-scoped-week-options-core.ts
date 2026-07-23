/**
 * URGENT LEVEL 2 ACCESS - SLICE S1A: the PURE core for COURSE-SCOPED TRAINEE
 * schedule reading.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * cookies, no next/headers, no React. It only shapes queries, maps already
 * fetched rows, and decides authorization from explicitly supplied arguments -
 * so the whole trainee course-scoping contract is unit-testable without a
 * database (see course-scoped-week-options-core.test.ts).
 *
 * WHAT THIS OWNS
 * --------------
 *  1. The EXACT offering-scoped, published-only query shape for the trainee week
 *     option list.
 *  2. The row -> option mapping (Date -> date key) for that list.
 *  3. pickDefaultWeekId - MOVED here verbatim from lib/actions/weekly-schedule.ts
 *     so it is a single, testable source of truth. Its behaviour is unchanged and
 *     it deliberately gains NO offering parameter: it is always handed a list
 *     that has ALREADY been filtered to one offering, and it must never be able
 *     to reach across courses on its own.
 *  4. The FINAL-READ authorization predicate for a raw weeklyScheduleId.
 *  5. Two dependency-injected orchestrations (the week selection and the final
 *     read gate) that fix the order of the gates, so the "use server" actions
 *     stay thin IO shells and every decision is exercised by pure tests.
 *
 * HARD RULES BAKED IN HERE
 * ------------------------
 *  - The trainee course context is ALWAYS server-resolved. There is deliberately
 *    NO parameter anywhere in this module through which a caller could supply a
 *    courseOfferingId for the trainee audience.
 *  - Nothing here infers an offering from a group name, subgroup, course name,
 *    level, date window, schedule contents, or a cookie. There is NO Level 1
 *    fallback and no "current offering" heuristic.
 *  - courseOfferingId === null FAILS CLOSED. A week that predates the offering
 *    spine is not readable by any trainee.
 *  - An unpublished week FAILS CLOSED for the trainee audience.
 *  - Offering comparison is STRICT === on the exact resolved id. No trimming, no
 *    case folding, no prefix matching.
 *  - Every denial produces the SAME empty result. Cross-course, not-found and
 *    unpublished are never distinguishable to the caller, so a week id can never
 *    be probed across courses.
 *  - A raw weeklyScheduleId is NEVER authorization.
 */
import { dateKey, parseDateKey } from "@/lib/dates";
import {
  NoTraineeCourseOfferingError,
  AmbiguousTraineeCourseOfferingError,
} from "./actor-course-offering-core";
import { UnauthenticatedActorError } from "@/lib/auth/actor-types";
import type { CapabilityKey } from "./capabilities/capability-keys";
import type { EffectiveCapabilityStatus } from "./capabilities/effective-capability-core";

// ---------------------------------------------------------------------------
// Course-context denial
// ---------------------------------------------------------------------------

/**
 * The failures that mean "this caller has no single, trustworthy trainee course
 * context" and must therefore be answered with the uniform empty result rather
 * than an error:
 *
 *  - UnauthenticatedActorError        - anonymous / expired / wrong-audience /
 *                                       inactive trainee session;
 *  - NoTraineeCourseOfferingError     - zero eligible enrollments (including a
 *                                       PLANNED-only offering, which is exactly
 *                                       the pre-launch Level 2 state);
 *  - AmbiguousTraineeCourseOfferingError - more than one eligible enrollment.
 *
 * Everything else (Prisma failure, programming error, a defect in the resolver)
 * is NOT a denial and must propagate unchanged - a broken dependency must never
 * be silently reported to a trainee as "you have no schedule".
 *
 * This mirrors the private helper in lib/actions/contacts-instructor-directory.ts.
 * It is re-stated here rather than imported because that module is outside this
 * slice's authorized file scope and must not be touched; the session-denial case
 * is additionally covered here, which the contacts variant does not need.
 */
export function isTraineeCourseContextDenial(error: unknown): boolean {
  return (
    error instanceof UnauthenticatedActorError ||
    error instanceof NoTraineeCourseOfferingError ||
    error instanceof AmbiguousTraineeCourseOfferingError
  );
}

// ---------------------------------------------------------------------------
// SCHEDULE capability
// ---------------------------------------------------------------------------

/** The single capability key that authorizes any trainee schedule reading. */
export const TRAINEE_SCHEDULE_CAPABILITY_KEY: CapabilityKey = "SCHEDULE";

/**
 * Positive-ENABLED test, deliberately `!== "ENABLED"` rather than
 * `=== "DISABLED"`: a missing capability row (effective DISABLED under CAP-1), a
 * retired catalog entry, a malformed status and READ_ONLY all DENY. Schedule
 * viewing is served only on a positively ENABLED SCHEDULE capability for the
 * resolved offering. A partial/absent map denies rather than throwing.
 */
export function isTraineeScheduleCapabilityEnabled(
  capabilities: Partial<Record<CapabilityKey, EffectiveCapabilityStatus>> | null | undefined,
): boolean {
  if (!capabilities) return false;
  return capabilities[TRAINEE_SCHEDULE_CAPABILITY_KEY] === "ENABLED";
}

// ---------------------------------------------------------------------------
// Week option list - query shape, rows, mapping
// ---------------------------------------------------------------------------

/**
 * The EXACT query the trainee week option list runs. Both predicates are
 * mandatory and neither is caller-configurable:
 *  - `courseOfferingId` pins the list to ONE offering by exact id;
 *  - `isPublished: true` is the pre-existing trainee-only restriction.
 * There is no date range, no name pattern, no level and no status predicate -
 * offering scope is never inferred.
 */
export interface TraineeWeekOptionsQuery {
  where: { courseOfferingId: string; isPublished: true };
  orderBy: { startDate: "asc" };
  select: { id: true; name: true; startDate: true; endDate: true };
}

/** The exact columns the option list projects - no items, no offering id. */
export const TRAINEE_WEEK_OPTION_SELECT = {
  id: true,
  name: true,
  startDate: true,
  endDate: true,
} as const;

/**
 * Build the offering-scoped, published-only option query.
 *
 * A blank offering id is a programming error (the server resolver always yields
 * a real cuid), and building a query from it would silently widen scope, so it
 * throws rather than returning a query.
 */
export function buildTraineeWeekOptionsQuery(courseOfferingId: string): TraineeWeekOptionsQuery {
  if (typeof courseOfferingId !== "string" || courseOfferingId.length === 0) {
    throw new Error(
      "buildTraineeWeekOptionsQuery requires a non-empty, server-resolved courseOfferingId",
    );
  }
  return {
    where: { courseOfferingId, isPublished: true },
    orderBy: { startDate: "asc" },
    select: { id: true, name: true, startDate: true, endDate: true },
  };
}

/** A fetched week row, exactly as the query above projects it. */
export interface TraineeWeekOptionRow {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
}

/** The client-facing option shape (date keys, never Date objects). */
export interface TraineeWeekOption {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

/**
 * Map fetched rows to options. Identical to the mapping the legacy option
 * readers perform, so the returned shape and ordering are unchanged.
 */
export function toTraineeWeekOptions(
  rows: readonly TraineeWeekOptionRow[],
): TraineeWeekOption[] {
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    startDate: dateKey(w.startDate),
    endDate: dateKey(w.endDate),
  }));
}

// ---------------------------------------------------------------------------
// Default week selection - MOVED verbatim, behaviour unchanged
// ---------------------------------------------------------------------------

function daysBetweenKeys(a: string, b: string): number {
  return Math.abs(parseDateKey(a).getTime() - parseDateKey(b).getTime()) / 86_400_000;
}

/** The minimum an option needs for the default pick - id plus its date range. */
export interface WeekOptionForDefaultPick {
  id: string;
  startDate: string;
  endDate: string;
}

/**
 * Picks the week containing today, or - if none uploaded covers today - the
 * uploaded week whose range is closest to today (so students/instructors
 * land somewhere useful instead of an empty "no week selected" state).
 *
 * MOVED here from lib/actions/weekly-schedule.ts unchanged (S1A). It takes an
 * ALREADY-FILTERED list and deliberately has NO offering parameter: cross-course
 * isolation is the caller's query's job, never this function's, so it can never
 * become a second, date-based way to reach another course's week.
 */
export function pickDefaultWeekId<T extends WeekOptionForDefaultPick>(
  weeks: readonly T[],
  todayKey: string,
): string | null {
  if (weeks.length === 0) return null;
  const current = weeks.find((w) => w.startDate <= todayKey && todayKey <= w.endDate);
  if (current) return current.id;

  let best = weeks[0];
  let bestDist = Infinity;
  for (const w of weeks) {
    const dist =
      todayKey < w.startDate
        ? daysBetweenKeys(todayKey, w.startDate)
        : daysBetweenKeys(w.endDate, todayKey);
    if (dist < bestDist) {
      bestDist = dist;
      best = w;
    }
  }
  return best.id;
}

// ---------------------------------------------------------------------------
// Final-read authorization for a raw weeklyScheduleId
// ---------------------------------------------------------------------------

/**
 * The exact week columns the FINAL READ must fetch before it may touch a single
 * ScheduleItem. `courseOfferingId` and `isPublished` are what authorize the
 * read; `name` is the only content column, and it is not returned unless the
 * read is authorized.
 */
export const TRAINEE_WEEK_META_SELECT = {
  id: true,
  name: true,
  courseOfferingId: true,
  isPublished: true,
} as const;

/** A fetched week header, exactly as TRAINEE_WEEK_META_SELECT projects it. */
export interface TraineeWeekMetaRow {
  id: string;
  name: string;
  courseOfferingId: string | null;
  isPublished: boolean;
}

/**
 * The final-read authorization predicate. ALL of the following must hold:
 *
 *  1. the requested week actually exists;
 *  2. its courseOfferingId is NOT null (a NULL-scoped week fails closed - there
 *     is no legacy pass-through and no Level 1 default);
 *  3. its courseOfferingId is STRICTLY EQUAL to the server-resolved offering id;
 *  4. it is published.
 *
 * The resolved id itself must be a non-empty string - a blank resolved id can
 * never match anything, including a blank stored value.
 */
export function isTraineeWeekReadAuthorized(
  week: TraineeWeekMetaRow | null | undefined,
  resolvedCourseOfferingId: string,
): boolean {
  if (typeof resolvedCourseOfferingId !== "string" || resolvedCourseOfferingId.length === 0) {
    return false;
  }
  if (!week) return false;
  if (typeof week.courseOfferingId !== "string" || week.courseOfferingId.length === 0) {
    return false;
  }
  if (week.courseOfferingId !== resolvedCourseOfferingId) return false;
  return week.isPublished === true;
}

// ---------------------------------------------------------------------------
// Dependency-injected orchestrations
// ---------------------------------------------------------------------------

/**
 * The trainee course-context dependencies shared by both orchestrations.
 *
 * `resolveTraineeCourseOffering` takes NO arguments by design - there is no
 * parameter through which any caller could supply an offering id, and the
 * student id comes from the signed session inside the real binding.
 */
export interface TraineeCourseContextDeps {
  resolveTraineeCourseOffering: () => Promise<{ id: string }>;
  getEffectiveCapabilities: (
    courseOfferingId: string,
  ) => Promise<Record<CapabilityKey, EffectiveCapabilityStatus>>;
}

/** The selection shape returned to the trainee week picker. */
export interface TraineeWeeklyScheduleSelection {
  weeks: TraineeWeekOption[];
  defaultWeekId: string | null;
}

/**
 * The uniform empty selection. Built fresh on every call (never a shared frozen
 * singleton) so no caller can mutate another caller's result.
 */
export function emptyTraineeWeeklyScheduleSelection(): TraineeWeeklyScheduleSelection {
  return { weeks: [], defaultWeekId: null };
}

export interface TraineeWeeklyScheduleSelectionDeps extends TraineeCourseContextDeps {
  fetchPublishedWeekRows: (
    query: TraineeWeekOptionsQuery,
  ) => Promise<readonly TraineeWeekOptionRow[]>;
  todayDateKey: () => string;
}

/**
 * Trainee week option list + default week, fully course-scoped.
 *
 * Order is deliberate and fail-closed at every step:
 *  1. resolve the trainee's own offering server-side (denial -> empty selection,
 *     any other error propagates);
 *  2. read THAT EXACT offering's effective capabilities and require SCHEDULE to
 *     be ENABLED (denial -> empty selection, before any week is queried);
 *  3. query weeks by that exact offering id AND isPublished;
 *  4. hand the ALREADY-FILTERED list to pickDefaultWeekId - which therefore can
 *     never see, or land on, another course's week.
 */
export async function loadTraineeWeeklyScheduleSelectionWithDeps(
  deps: TraineeWeeklyScheduleSelectionDeps,
): Promise<TraineeWeeklyScheduleSelection> {
  let courseOfferingId: string;
  try {
    courseOfferingId = (await deps.resolveTraineeCourseOffering()).id;
  } catch (error) {
    if (isTraineeCourseContextDenial(error)) {
      return emptyTraineeWeeklyScheduleSelection();
    }
    throw error;
  }

  const capabilities = await deps.getEffectiveCapabilities(courseOfferingId);
  if (!isTraineeScheduleCapabilityEnabled(capabilities)) {
    return emptyTraineeWeeklyScheduleSelection();
  }

  const rows = await deps.fetchPublishedWeekRows(buildTraineeWeekOptionsQuery(courseOfferingId));
  const weeks = toTraineeWeekOptions(rows);
  return { weeks, defaultWeekId: pickDefaultWeekId(weeks, deps.todayDateKey()) };
}

/** The result of the final-read gate - authorized carries the verified header. */
export type TraineeWeekReadAuthorization =
  | { authorized: false }
  | { authorized: true; courseOfferingId: string; week: TraineeWeekMetaRow };

/** The single, uniform denial value for the final-read gate. */
const TRAINEE_WEEK_READ_DENIED: TraineeWeekReadAuthorization = Object.freeze({
  authorized: false as const,
});

export interface TraineeWeekReadDeps extends TraineeCourseContextDeps {
  fetchWeekMeta: (weeklyScheduleId: string) => Promise<TraineeWeekMetaRow | null>;
}

/**
 * The FINAL-READ gate for a raw, caller-supplied weeklyScheduleId.
 *
 * This is what makes a week id not-authorization: the option list having been
 * filtered is never trusted, because the schedule action is an independently
 * invocable Server Action and its id may be stale, tampered with, or copied from
 * another course entirely.
 *
 * Order is deliberate and fail-closed at every step:
 *  1. resolve the trainee's own offering server-side (denial -> denied, any
 *     other error propagates);
 *  2. require SCHEDULE ENABLED for THAT EXACT offering - checked BEFORE the week
 *     is fetched, so a denied caller cannot even confirm a week id exists;
 *  3. fetch ONLY the week header (no items, no nested riding/publication data);
 *  4. apply {@link isTraineeWeekReadAuthorized}.
 *
 * Every failure returns the SAME denial value, so cross-course, not-found and
 * unpublished are indistinguishable. Only an authorized result carries the week
 * header onward, and only then may the caller read ScheduleItems.
 */
export async function authorizeTraineeWeekReadWithDeps(
  weeklyScheduleId: string,
  deps: TraineeWeekReadDeps,
): Promise<TraineeWeekReadAuthorization> {
  let courseOfferingId: string;
  try {
    courseOfferingId = (await deps.resolveTraineeCourseOffering()).id;
  } catch (error) {
    if (isTraineeCourseContextDenial(error)) {
      return TRAINEE_WEEK_READ_DENIED;
    }
    throw error;
  }

  const capabilities = await deps.getEffectiveCapabilities(courseOfferingId);
  if (!isTraineeScheduleCapabilityEnabled(capabilities)) {
    return TRAINEE_WEEK_READ_DENIED;
  }

  const week = await deps.fetchWeekMeta(weeklyScheduleId);
  if (!isTraineeWeekReadAuthorized(week, courseOfferingId)) {
    return TRAINEE_WEEK_READ_DENIED;
  }

  return { authorized: true, courseOfferingId, week: week as TraineeWeekMetaRow };
}
