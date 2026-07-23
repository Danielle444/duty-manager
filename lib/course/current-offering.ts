/**
 * MULTI-COURSE W9A-1 - server-side IO wrapper for the operational current-
 * offering resolver.
 *
 * Server-side only: it reads through the shared Prisma client. The cardinality
 * decision is delegated to the PURE core (current-offering-core.ts). The
 * operational resolver selects the SINGLE ACTIVE CourseOffering: the Prisma
 * query filters `where: { status: "ACTIVE" }`, so PLANNED and ARCHIVED offerings
 * never participate. This lets a future second offering exist in PLANNED status
 * without making this resolver ambiguous. No arguments, no client-controlled
 * course id, no auth/session coupling.
 *
 * The status filter and the take:2 cardinality contract are constructed in the
 * dependency-injected `resolveCurrentCourseOfferingWithDeps`, and the thin
 * `resolveCurrentCourseOffering` wrapper binds the real Prisma query. That seam
 * exists so a DB-free test can prove the operational resolver requests ONLY
 * ACTIVE offerings without a live database (see current-offering.test.ts); the
 * pure cardinality core stays deliberately status-agnostic.
 */
import { prisma } from "@/lib/prisma";
import {
  resolveCurrentCourseOfferingFromRows,
  type CourseOfferingRow,
  type CurrentCourseOffering,
} from "./current-offering-core";
import { selectLegacyCompatibleActiveRows } from "./legacy-offering-compatibility-core";
import {
  LEVEL_1_COURSE_OFFERING_ID,
  LEVEL_2_COURSE_OFFERING_ID,
} from "./temporary-level2-compatibility";

export {
  NoCurrentCourseOfferingError,
  AmbiguousCourseOfferingError,
  IncompleteCourseOfferingError,
  type CurrentCourseOffering,
  type CourseOfferingRow,
} from "./current-offering-core";

/**
 * The exact query the operational resolver issues, constructed once and passed
 * to the injected fetcher: at most THREE rows, filtered to ACTIVE only. Its
 * shape is what a DB-free test asserts to prove PLANNED/ARCHIVED are excluded.
 *
 * L2-0: take was raised 2 -> 3. Two rows can no longer settle the decision: the
 * resolver must be able to tell the KNOWN {Level 1, Level 2} two-ACTIVE state
 * apart from that pair plus an unknown third ACTIVE offering. Fetching one extra
 * row makes a third offering visible, so an unknown multi-offering state still
 * fails closed instead of being silently rewritten to Level 1. This does not
 * change behavior for zero or one ACTIVE offering.
 */
export interface CurrentOfferingQuery {
  readonly take: number;
  readonly where: { readonly status: "ACTIVE" };
}

/**
 * Injected boundary for the operational resolver. `fetchCurrentOfferingRows`
 * receives the ACTIVE-filtered, take:2 query and returns the fetched rows; the
 * real wrapper binds Prisma, a test binds a fake that records the query.
 */
export interface CurrentCourseOfferingDeps {
  fetchCurrentOfferingRows: (
    query: CurrentOfferingQuery,
  ) => Promise<readonly CourseOfferingRow[]>;
}

/**
 * Resolve the current ACTIVE CourseOffering. Constructs the ACTIVE-only, take:3
 * query, hands it to the injected fetcher, applies the TEMPORARY Level 1
 * compatibility filter, and lets the unchanged pure core decide:
 *  - 0 ACTIVE rows   -> throws NoCurrentCourseOfferingError
 *  - 1 ACTIVE row    -> returns the stable CurrentCourseOffering view
 *                       (or IncompleteCourseOfferingError if it lacks dates)
 *  - EXACTLY the known {Level 1, Level 2} ACTIVE pair -> returns the Level 1
 *    offering, so the un-migrated legacy Level-1-only callers keep working while
 *    Level 2 is ACTIVE (L2-0 compatibility; see
 *    legacy-offering-compatibility-core.ts and temporary-level2-compatibility.ts)
 *  - any OTHER multi-offering ACTIVE state -> throws AmbiguousCourseOfferingError
 *    (never picks one; no name/level/date/status-order inference)
 *
 * This function stays the LEGACY resolver. It is deliberately NOT actor-aware:
 * actor-scoped course context lives in actor-course-offering.ts.
 */
export async function resolveCurrentCourseOfferingWithDeps(
  deps: CurrentCourseOfferingDeps,
): Promise<CurrentCourseOffering> {
  const rows = await deps.fetchCurrentOfferingRows({
    take: 3,
    where: { status: "ACTIVE" },
  });
  const compatibleRows = selectLegacyCompatibleActiveRows(rows, {
    level1OfferingId: LEVEL_1_COURSE_OFFERING_ID,
    level2OfferingId: LEVEL_2_COURSE_OFFERING_ID,
  });
  return resolveCurrentCourseOfferingFromRows(compatibleRows);
}

/**
 * Resolve the current ACTIVE CourseOffering through the shared Prisma client.
 * Public contract unchanged: no arguments, same return type and error classes.
 * The Prisma select shape is kept inline so Prisma infers the exact row payload.
 */
export async function resolveCurrentCourseOffering(): Promise<CurrentCourseOffering> {
  return resolveCurrentCourseOfferingWithDeps({
    fetchCurrentOfferingRows: ({ take, where }) =>
      prisma.courseOffering.findMany({
        take,
        where,
        select: {
          id: true,
          activityYearId: true,
          name: true,
          level: true,
          startDate: true,
          endDate: true,
          status: true,
        },
      }),
  });
}
