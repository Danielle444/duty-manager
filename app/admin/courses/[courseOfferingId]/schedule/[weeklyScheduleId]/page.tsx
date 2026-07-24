/**
 * MULTI-COURSE Schedule Slice W-S3B - the OFFERING-SCOPED weekly-schedule
 * VIEW/EDIT page.
 *
 * Server Component only. The URL owns BOTH scopes: [courseOfferingId] is the
 * authoritative offering, [weeklyScheduleId] the target week. In a fixed order:
 *   1. requireAdminCourseOffering() re-validates the admin AND exactly this
 *      offering (admin-authorization-first, exact-id lookup, no cookie, no
 *      fallback, no current-offering resolver). Only the typed not-found fails
 *      closed as notFound(), without reflecting the raw id;
 *   2. the READ is gated by the pure default-deny policy under HISTORICAL_READ
 *      (PLANNED/ACTIVE/ARCHIVED), mirroring the offering's other pages;
 *   3. the week is fetched with a COMPOUND scope - findFirst({ where: { id,
 *      courseOfferingId: context.id } }). A missing week, a NULL-scoped legacy
 *      week and another offering's week ALL return null -> notFound(). The
 *      offering is never trusted from a later client comparison; the query itself
 *      is the ownership boundary.
 *
 * The edit affordances are shown only when the offering's status permits
 * SCHEDULE_DRAFT_CONFIGURATION (PLANNED + ACTIVE; ARCHIVED never). Each bound
 * action re-proves ownership server-side, so this only gates the visible UI.
 *
 * Deliberately absent: publication toggle (read-only chip only), delete-week,
 * riding, duty generation, no-duty marking, day-plan and Excel export. The
 * publication STATE is displayed but never mutated here.
 */
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
  type AdminCourseContext,
} from "@/lib/course/admin-course-context";
import {
  assertCourseOperationAllowed,
  evaluateCourseOperationPolicy,
} from "@/lib/course/operation-policy-core";
import { dateKey } from "@/lib/dates";
import {
  createOfferingScheduleItemAction,
  deleteOfferingScheduleItemAction,
  updateOfferingScheduleItemAction,
  updateOfferingWeekMetadataAction,
} from "./actions";
import {
  OfferingWeekEditorClient,
  type OfferingWeekEditorView,
} from "./OfferingWeekEditorClient";

export const dynamic = "force-dynamic";

export default async function CourseWeekEditorPage({
  params,
}: {
  params: Promise<{ courseOfferingId: string; weeklyScheduleId: string }>;
}) {
  const { courseOfferingId, weeklyScheduleId } = await params;

  // 1. Authorize the admin and re-validate EXACTLY this offering first.
  let context: AdminCourseContext;
  try {
    context = await requireAdminCourseOffering(courseOfferingId);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      notFound();
    }
    throw error;
  }

  // 2. Gate the READ by the offering's status.
  assertCourseOperationAllowed(context.status, "HISTORICAL_READ");

  // 3. COMPOUND-scoped fetch: the week must exist AND belong to this exact
  //    offering. A foreign / NULL-scoped / missing week is null -> notFound().
  const week = await prisma.weeklySchedule.findFirst({
    where: { id: weeklyScheduleId, courseOfferingId: context.id },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      uploadedFileName: true,
      isPublished: true,
      items: {
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        select: {
          id: true,
          date: true,
          startTime: true,
          endTime: true,
          title: true,
          description: true,
          groupName: true,
          instructorName: true,
          location: true,
          combinedParticipation: true,
        },
      },
    },
  });

  if (!week) {
    notFound();
  }

  const view: OfferingWeekEditorView = {
    id: week.id,
    name: week.name,
    startDate: dateKey(week.startDate),
    endDate: dateKey(week.endDate),
    uploadedFileName: week.uploadedFileName,
    isPublished: week.isPublished,
    items: week.items.map((item) => ({
      id: item.id,
      dateKey: dateKey(item.date),
      startTime: item.startTime,
      endTime: item.endTime,
      title: item.title,
      description: item.description,
      groupName: item.groupName,
      instructorName: item.instructorName,
      location: item.location,
      combinedParticipation: item.combinedParticipation,
    })),
  };

  const canEdit = evaluateCourseOperationPolicy(
    context.status,
    "SCHEDULE_DRAFT_CONFIGURATION",
  ).allowed;

  return (
    <OfferingWeekEditorClient
      week={view}
      canEdit={canEdit}
      backHref={`/admin/courses/${encodeURIComponent(context.id)}/schedule`}
      updateMetadataAction={updateOfferingWeekMetadataAction.bind(null, context.id, week.id)}
      createItemAction={createOfferingScheduleItemAction.bind(null, context.id, week.id)}
      updateItemAction={updateOfferingScheduleItemAction.bind(null, context.id)}
      deleteItemAction={deleteOfferingScheduleItemAction.bind(null, context.id)}
    />
  );
}
