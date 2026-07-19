/**
 * MULTI-COURSE (dormant foundation, Slice 2) - reusable admin CourseOffering
 * context resolver.
 *
 * Given an EXPLICIT courseOfferingId, this resolver:
 *   1. authorizes the caller as an admin server-side via the existing
 *      requireAdmin() (which redirects unauthenticated/non-admin callers);
 *   2. ONLY THEN fetches exactly that offering via the committed Slice 1 reader
 *      getCourseOfferingById();
 *   3. returns a narrow, immutable AdminCourseContext, or throws a typed
 *      CourseOfferingNotFoundError.
 *
 * The admin-first ordering matters: it prevents an unauthenticated caller from
 * probing which offering IDs exist. The offering lookup never runs until
 * requireAdmin() has resolved.
 *
 * Deliberate NON-responsibilities (kept separate by design):
 *   - it never calls resolveCurrentCourseOffering() and never falls back to
 *     another offering (no first/newest/only-ACTIVE guess);
 *   - it never inspects a course-selection cookie or the auth session for course
 *     context - course context stays OUTSIDE the identity session;
 *   - it never authorizes a write by status (that is the operation-policy core's
 *     job) and never mutates data.
 *
 * Reusability: the pure orchestration `requireAdminCourseOfferingWithDeps` takes
 * its dependencies by injection so it can be unit-tested without a DB and reused
 * later from Server Components, Server Actions and route handlers. It does NOT
 * hard-wire notFound(); callers translate the typed error themselves:
 *   - pages          -> notFound();
 *   - server actions -> a safe ActionResult error;
 *   - route handlers -> a 404 JSON response.
 * The thin wrapper `requireAdminCourseOffering` binds the real dependencies.
 *
 * DORMANT: no runtime consumer imports this slice; nothing is wired.
 */
import { requireAdmin, type CurrentAdmin } from "@/lib/auth/require-admin";
import { getCourseOfferingById } from "./offering-by-id";
import type { CourseOfferingView } from "./offering-by-id-core";

/**
 * The narrow, immutable course context returned to callers. Contains ONLY the
 * fields future course-scoped admin pages need - never students, enrollments,
 * groups, permissions, cookies, session data or a raw Prisma record. Dates are
 * Date | null because a PLANNED offering may not yet be dated; the context never
 * fabricates a date.
 */
export interface AdminCourseContext {
  readonly id: string;
  readonly activityYearId: string;
  readonly name: string;
  readonly level: number;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
  readonly status: CourseOfferingView["status"];
}

/**
 * Injected dependencies for the pure orchestration. `requireAdmin` is called
 * only for its authorization side effect (it redirects unauthenticated/non-admin
 * callers); its return value is intentionally not surfaced in the course context.
 * `getCourseOfferingById` is the committed Slice 1 explicit-ID reader, which
 * already normalizes the id and returns null for empty/whitespace/not-found.
 */
export interface AdminCourseContextDeps {
  requireAdmin: () => Promise<CurrentAdmin>;
  getCourseOfferingById: (id: string) => Promise<CourseOfferingView | null>;
}

/**
 * Thrown when the requested offering does not exist, or the id is empty /
 * whitespace-only / otherwise invalid - all of which collapse to a fail-closed
 * "not found". Carries only the requested id (a public cuid, never PII) for
 * diagnostics. Callers translate this into notFound() / a 404 / an ActionResult
 * error as appropriate for their surface.
 */
export class CourseOfferingNotFoundError extends Error {
  readonly code = "COURSE_OFFERING_NOT_FOUND" as const;
  readonly requestedId: string;

  constructor(requestedId: string) {
    // Generic, stable message: it never interpolates or reflects the caller-
    // provided id, so accidental serialization of Error.message (in a future
    // action/route) cannot echo arbitrary input back to a client. The requested
    // id is retained ONLY as a structured property for server-side diagnostics.
    super("CourseOffering not found.");
    this.name = "CourseOfferingNotFoundError";
    this.requestedId = requestedId;
  }
}

/** Map the Slice 1 offering view to a frozen, narrow admin context. */
function toAdminCourseContext(offering: CourseOfferingView): AdminCourseContext {
  return Object.freeze({
    id: offering.id,
    activityYearId: offering.activityYearId,
    name: offering.name,
    level: offering.level,
    startDate: offering.startDate,
    endDate: offering.endDate,
    status: offering.status,
  });
}

/**
 * Pure, dependency-injected orchestration. Ordering is a hard contract:
 *   1. authorize the admin FIRST (may redirect for unauthenticated callers);
 *   2. only after authorization succeeds, look up exactly the requested id;
 *   3. return that exact offering as a narrow context, or throw the typed
 *      not-found error. No fallback lookup ever occurs.
 *
 * The read status is never rejected here: PLANNED, ACTIVE and ARCHIVED can all be
 * returned. Read-vs-write authorization by status is a separate concern.
 */
export async function requireAdminCourseOfferingWithDeps(
  courseOfferingId: string,
  deps: AdminCourseContextDeps,
): Promise<AdminCourseContext> {
  // 1. Admin authorization first - blocks unauthenticated ID probing.
  await deps.requireAdmin();

  // 2. Exactly the requested offering, through the committed Slice 1 reader.
  const offering = await deps.getCourseOfferingById(courseOfferingId);

  // 3. Fail closed on empty/whitespace/invalid/not-found; never fall back.
  if (offering === null) {
    throw new CourseOfferingNotFoundError(courseOfferingId);
  }

  return toAdminCourseContext(offering);
}

/**
 * Thin concrete wrapper binding the real dependencies (the existing requireAdmin
 * and the committed Slice 1 reader) via normal static server imports, matching
 * repository conventions. All behavior lives in the injectable orchestration
 * above, which the DB-free unit test exercises through fakes.
 */
export async function requireAdminCourseOffering(
  courseOfferingId: string,
): Promise<AdminCourseContext> {
  return requireAdminCourseOfferingWithDeps(courseOfferingId, {
    requireAdmin,
    getCourseOfferingById,
  });
}
