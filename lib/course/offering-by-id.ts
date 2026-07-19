/**
 * MULTI-COURSE (dormant foundation, Slice 1) - server-side IO wrappers for
 * explicit-ID CourseOffering access.
 *
 * Server-side only: reads through the shared Prisma client. All normalization,
 * mapping and ordering is delegated to the PURE core (offering-by-id-core.ts),
 * so these stay thin, un-tested-by-design IO shells.
 *
 * DORMANT: NOT wired into any route, layout, action, resolver, navigation item
 * or component. Deliberately independent of the singleton resolver
 * (current-offering.ts is NOT imported). These helpers do not authorize an
 * actor, read a cookie, inspect the auth session, apply write-status policy, or
 * fall back to another offering - authorization and context wiring are a later
 * stage's concern.
 */
import { prisma } from "@/lib/prisma";
import {
  normalizeOfferingId,
  mapOfferingByIdRowToView,
  orderSelectableOfferings,
  type CourseOfferingView,
  type SelectableCourseOfferingView,
} from "./offering-by-id-core";

export type {
  CourseOfferingView,
  SelectableCourseOfferingView,
} from "./offering-by-id-core";

/**
 * Fetch exactly one CourseOffering by its explicit primary-key id.
 *
 * Returns null when the id is invalid (empty/whitespace-only) or no row exists;
 * a normal not-found is NOT an error. Uses findUnique by exact id - never
 * findFirst, never a status/date/year/count guess, never the singleton
 * resolver, never a fallback offering.
 */
export async function getCourseOfferingById(id: string): Promise<CourseOfferingView | null> {
  const normalized = normalizeOfferingId(id);
  if (normalized === null) {
    return null;
  }

  const row = await prisma.courseOffering.findUnique({
    where: { id: normalized },
    select: {
      id: true,
      activityYearId: true,
      name: true,
      level: true,
      startDate: true,
      endDate: true,
      status: true,
    },
  });

  if (row === null) {
    return null;
  }
  return mapOfferingByIdRowToView(row);
}

/**
 * List CourseOfferings selectable by a future admin selector, in the
 * deterministic contract order (ACTIVE, PLANNED, ARCHIVED; newest startDate
 * first within a status; undated last; stable name/id tie-break).
 *
 * This is a DATA READER, not the final authorization wrapper: it is deliberately
 * NOT coupled to the auth session in this dormant slice. It includes ARCHIVED
 * offerings (the future selector needs historical access) and never marks an
 * automatically selected offering - list position carries no selection meaning.
 */
export async function listSelectableCourseOfferingsForAdmin(): Promise<
  SelectableCourseOfferingView[]
> {
  const rows = await prisma.courseOffering.findMany({
    select: {
      id: true,
      activityYearId: true,
      name: true,
      level: true,
      startDate: true,
      endDate: true,
      status: true,
      activityYear: { select: { name: true } },
    },
  });

  return orderSelectableOfferings(rows);
}
