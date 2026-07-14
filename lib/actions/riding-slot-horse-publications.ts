"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { ActionResult } from "@/lib/actions/students";
import { dateKey, formatHebrewDate } from "@/lib/dates";
import { groupByGroupAndSubgroup } from "@/lib/attendance-ui";
import {
  findAssignmentForStudent,
  getAssignmentInstructorNames,
  formatInstructorNames,
} from "@/lib/riding-assignment-matching";

const NOT_FOUND_RIDING_SLOT = "רכיבה זו לא נמצאה. ייתכן שנמחקה - סגרו ורעננו את העמוד.";
const NOT_FOUND_HORSE_LIST = "יש לשמור רשימת סוסים לפני הפרסום למדריכים.";
const NO_PERMISSION = "אין הרשאה לפרסם רשימת סוסים למדריכים";

// ---------- Shared schedule-metadata helper ----------

interface RidingSlotScheduleMeta {
  date: Date;
  dateKeyStr: string;
  startTime: string;
  endTime: string;
  activityTitle: string;
}

// Resolves a RidingSlot's true date/time range and title from its full
// linked ScheduleItem set - a merged/coalesced slot can span more than one
// real row. Same first/last resolution pattern already proven by
// buildStudentRidingHistory in lib/actions/riding-slots.ts; duplicated here
// as a small local helper rather than refactoring that file for this one
// call site (per the H4 audit's explicit recommendation).
async function resolveRidingSlotScheduleMeta(ridingSlotId: string): Promise<RidingSlotScheduleMeta | null> {
  const links = await prisma.ridingSlotScheduleItem.findMany({
    where: { ridingSlotId },
    include: { scheduleItem: true },
  });
  if (links.length === 0) return null;

  const scheduleItems = links
    .map((link) => link.scheduleItem)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const first = scheduleItems[0];
  const last = scheduleItems[scheduleItems.length - 1];

  return {
    date: first.date,
    dateKeyStr: dateKey(first.date),
    startTime: first.startTime,
    endTime: last.endTime,
    activityTitle: first.title,
  };
}

function buildDefaultPublicationTitle(meta: RidingSlotScheduleMeta): string {
  return `סוסים לאיכוף — ${meta.activityTitle}, ${formatHebrewDate(meta.date)} ${meta.startTime}-${meta.endTime}`;
}

// ---------- Status (read-only) ----------

export type RidingHorsePublicationStatusLabel = "UNPUBLISHED" | "CURRENT" | "STALE";

export interface InstructorHorsePublicationSummary {
  id: string;
  title: string;
  generalNote: string | null;
  sourceVersion: number;
  firstPublishedAt: string;
  updatedAt: string;
  updatedByName: string;
}

export interface RidingSlotHorsePublicationStatus {
  ridingSlotId: string;
  hasHorseList: boolean;
  horseListVersion: number;
  publication: InstructorHorsePublicationSummary | null;
  status: RidingHorsePublicationStatusLabel;
}

async function buildInstructorHorsePublicationStatus(
  ridingSlotId: string
): Promise<RidingSlotHorsePublicationStatus> {
  const list = await prisma.ridingSlotHorseList.findUnique({
    where: { ridingSlotId },
    // At most one row can ever match - see @@unique([horseListId, audience])
    // on RidingSlotHorsePublication - so this is never more than one row.
    include: { publications: { where: { audience: "INSTRUCTORS" } } },
  });

  if (!list) {
    return {
      ridingSlotId,
      hasHorseList: false,
      horseListVersion: 0,
      publication: null,
      status: "UNPUBLISHED",
    };
  }

  const pub = list.publications[0] ?? null;
  if (!pub) {
    return {
      ridingSlotId,
      hasHorseList: true,
      horseListVersion: list.version,
      publication: null,
      status: "UNPUBLISHED",
    };
  }

  return {
    ridingSlotId,
    hasHorseList: true,
    horseListVersion: list.version,
    publication: {
      id: pub.id,
      title: pub.title,
      generalNote: pub.generalNote,
      sourceVersion: pub.sourceVersion,
      firstPublishedAt: pub.firstPublishedAt.toISOString(),
      updatedAt: pub.updatedAt.toISOString(),
      updatedByName: pub.updatedByName,
    },
    status: pub.sourceVersion < list.version ? "STALE" : "CURRENT",
  };
}

export async function getInstructorHorsePublicationStatusForAdmin(
  ridingSlotId: string
): Promise<RidingSlotHorsePublicationStatus> {
  await requireAdmin();
  return buildInstructorHorsePublicationStatus(ridingSlotId);
}

// instructorId is checked for existence/isActive only - NOT
// canEditRidingNotes. Viewing this status has no permission-level gate,
// matching the existing riding-slot read conventions already established in
// lib/actions/riding-slot-horses.ts (getRidingSlotHorseListForInstructor) -
// only publishing/updating is gated. Returns null (rather than throwing or
// inventing a separate error channel) when the instructor doesn't exist or
// isn't active; otherwise the shape is identical to the admin action's.
export async function getInstructorHorsePublicationStatusForInstructor(
  instructorId: string,
  ridingSlotId: string
): Promise<RidingSlotHorsePublicationStatus | null> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive) return null;

  return buildInstructorHorsePublicationStatus(ridingSlotId);
}

// ---------- Publish / update (write) ----------

export interface PublishHorseListToInstructorsInput {
  ridingSlotId: string;
  title?: string;
  generalNote?: string | null;
}

export interface PublishHorseListToInstructorsResult extends ActionResult {
  status?: RidingSlotHorsePublicationStatus;
}

interface PublicationActor {
  instructorId: string | null;
  adminEmail: string | null;
  adminName: string | null;
  displayName: string;
}

// Shared core of publishRidingHorseListToInstructorsAsAdmin/AsInstructor.
//
// Consistency: the live RidingSlotHorseList + its RidingSlotHorseListItem
// rows are read INSIDE the transaction below, and the publication
// upsert/snapshot-replace uses exactly that read's version/items - never a
// value read before the transaction opened. Schedule metadata and
// RidingSlotAssignment data are read beforehand deliberately: they are not
// part of the "what got published" versioned guarantee (a title/instructor-
// name typo fixed after publish doesn't need to invalidate a horse-list
// version), so keeping them out of the transaction keeps its body to exactly
// the three writes required (upsert publication, delete old items, create
// new items) - no network/unrelated work inside it, well below the
// timeout margin that bit the Excel-import job.
async function publishRidingHorseListToInstructorsInternal(
  input: PublishHorseListToInstructorsInput,
  actor: PublicationActor
): Promise<PublishHorseListToInstructorsResult> {
  const ridingSlotId = input.ridingSlotId?.trim();
  if (!ridingSlotId) {
    return { success: false, error: NOT_FOUND_RIDING_SLOT };
  }

  const scheduleMeta = await resolveRidingSlotScheduleMeta(ridingSlotId);
  if (!scheduleMeta) {
    return { success: false, error: NOT_FOUND_RIDING_SLOT };
  }

  const assignments = await prisma.ridingSlotAssignment.findMany({
    where: { ridingSlotId },
    include: {
      instructor: true,
      instructors: { include: { instructor: true }, orderBy: { createdAt: "asc" } },
    },
  });

  const trimmedTitle = input.title?.trim() || null;
  const generalNoteProvided = input.generalNote !== undefined;
  const generalNoteToApply =
    input.generalNote === null || input.generalNote === undefined
      ? null
      : input.generalNote.trim() || null;

  const actorData = {
    updatedByInstructorId: actor.instructorId,
    updatedByAdminEmail: actor.adminEmail,
    updatedByAdminName: actor.adminName,
    updatedByName: actor.displayName,
  };

  const txResult = await prisma.$transaction(async (tx) => {
    // The one consistent transactional read this whole publish is built
    // from - list.version and list.items below are never re-read or mixed
    // with a value obtained outside this call.
    const list = await tx.ridingSlotHorseList.findUnique({
      where: { ridingSlotId },
      include: {
        items: {
          include: { student: { select: { id: true, fullName: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!list) {
      return { ok: false as const };
    }

    // Stable ordering: group, then subgroup, then existing source-item order
    // (createdAt asc, from the query above) - reuses the same grouping
    // helper already used throughout this feature's UI, rather than
    // inventing new sort rules.
    const orderedItems = groupByGroupAndSubgroup(list.items).flatMap((section) =>
      section.subgroups.flatMap((sub) => sub.items)
    );

    const snapshotRows = orderedItems.map((item) => {
      const assignment = findAssignmentForStudent(assignments, item.groupName, item.subgroupNumber);
      const responsibleInstructorNames = assignment
        ? formatInstructorNames(getAssignmentInstructorNames(assignment))
        : null;
      return {
        groupName: item.groupName,
        subgroupNumber: item.subgroupNumber,
        responsibleInstructorNames,
        // studentId/studentName resolved live from THIS transactional read's
        // included Student relation, then frozen into the snapshot below.
        // Null Student (never assigned, or the relation went null via
        // onDelete: SetNull) is preserved as null - never recovered, never
        // invented - the future feed renders "ללא חניכ/ה משויכ/ת" for it.
        studentId: item.studentId,
        studentName: item.student?.fullName ?? null,
        horseName: item.horseName,
      };
    });

    const existing = await tx.ridingSlotHorsePublication.findUnique({
      where: { horseListId_audience: { horseListId: list.id, audience: "INSTRUCTORS" } },
    });

    // Title: an explicitly provided, non-blank title always wins. Otherwise
    // (omitted or blank/whitespace-only) preserve the existing title on an
    // update, or fall back to the generated default on a first publish -
    // a blank submission must never blank out a previously-set title.
    const titleToUse = trimmedTitle ?? existing?.title ?? buildDefaultPublicationTitle(scheduleMeta);

    // generalNote: undefined means "not touched, preserve existing" (or
    // null on a first publish, since there's nothing to preserve yet);
    // null/blank means "explicitly cleared."
    const generalNoteToUse = generalNoteProvided ? generalNoteToApply : (existing?.generalNote ?? null);

    // Native upsert on the exact unique key - a single atomic
    // INSERT ... ON CONFLICT DO UPDATE, so two concurrent publish/update
    // calls for the same horse list can never both "create" and collide on
    // the unique constraint (the race a manual find-then-branch would have).
    const publication = await tx.ridingSlotHorsePublication.upsert({
      where: { horseListId_audience: { horseListId: list.id, audience: "INSTRUCTORS" } },
      create: {
        horseListId: list.id,
        audience: "INSTRUCTORS",
        title: titleToUse,
        generalNote: generalNoteToUse,
        sourceVersion: list.version,
        ...actorData,
        // firstPublishedAt intentionally omitted - uses the schema default
        // (now()) on create, and is never listed in `update` below, so an
        // existing value is always left untouched on every subsequent call.
      },
      update: {
        title: titleToUse,
        generalNote: generalNoteToUse,
        sourceVersion: list.version,
        ...actorData,
      },
    });

    await tx.ridingSlotHorsePublicationItem.deleteMany({ where: { publicationId: publication.id } });
    if (snapshotRows.length > 0) {
      await tx.ridingSlotHorsePublicationItem.createMany({
        data: snapshotRows.map((row) => ({ ...row, publicationId: publication.id })),
      });
    }

    return { ok: true as const, listVersion: list.version, publication };
  });

  if (!txResult.ok) {
    return { success: false, error: NOT_FOUND_HORSE_LIST };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");

  return {
    success: true,
    status: {
      ridingSlotId,
      hasHorseList: true,
      horseListVersion: txResult.listVersion,
      publication: {
        id: txResult.publication.id,
        title: txResult.publication.title,
        generalNote: txResult.publication.generalNote,
        sourceVersion: txResult.publication.sourceVersion,
        firstPublishedAt: txResult.publication.firstPublishedAt.toISOString(),
        updatedAt: txResult.publication.updatedAt.toISOString(),
        updatedByName: txResult.publication.updatedByName,
      },
      // sourceVersion was just set to this exact listVersion above, so the
      // publication is always CURRENT immediately after a successful call.
      status: "CURRENT",
    },
  };
}

export async function publishRidingHorseListToInstructorsAsAdmin(
  input: PublishHorseListToInstructorsInput
): Promise<PublishHorseListToInstructorsResult> {
  const admin = await requireAdmin();
  return publishRidingHorseListToInstructorsInternal(input, {
    instructorId: null,
    adminEmail: admin.email,
    adminName: admin.name ?? null,
    displayName: admin.name ?? admin.email,
  });
}

// Instructors have no NextAuth session in this app (see requireAdmin), so
// this re-reads isActive/canEditRidingNotes from the DB by instructorId on
// every call - it never trusts a client-supplied boolean. canEditHorseFeeding
// alone does NOT grant publish/update access - that flag only widens the
// viewing audience (see getRidingHorsePublicationsForInstructor below), not
// who may write. No new permission is introduced; this reuses the exact
// flag that already gates saveRidingSlotHorseListAsInstructor.
export async function publishRidingHorseListToInstructorsAsInstructor(
  instructorId: string,
  input: PublishHorseListToInstructorsInput
): Promise<PublishHorseListToInstructorsResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return publishRidingHorseListToInstructorsInternal(input, {
    instructorId: instructor.id,
    adminEmail: null,
    adminName: null,
    displayName: instructor.fullName,
  });
}

// ---------- Instructor feed (read-only) ----------

export interface RidingHorsePublicationFeedSubgroup {
  subgroupNumber: number | null;
  responsibleInstructorNames: string | null;
  items: { horseName: string; studentName: string | null }[];
}

export interface RidingHorsePublicationFeedGroup {
  groupName: string | null;
  subgroups: RidingHorsePublicationFeedSubgroup[];
}

export interface RidingHorsePublicationFeedItem {
  id: string;
  ridingSlotId: string;
  title: string;
  generalNote: string | null;
  date: string;
  startTime: string;
  endTime: string;
  activityTitle: string;
  firstPublishedAt: string;
  updatedAt: string;
  updatedByName: string;
  // Empty array means "אין סוסים לאיכוף בסשן זה" for the future UI to
  // render - never a fake placeholder snapshot row.
  groups: RidingHorsePublicationFeedGroup[];
}

// Re-reads isActive/(canEditRidingNotes OR canEditHorseFeeding) from the DB
// on every call - never trusts a client-supplied boolean, and returns []
// (not an error) for an instructor who doesn't qualify, matching the
// "graceful, no-error" convention already used elsewhere for view gates.
// One query with an OR condition naturally returns each qualifying
// instructor's own publications without any recipient-row materialization
// or a two-audience-then-concatenate query - there is exactly one row per
// (horseListId, audience) regardless of how many permissions grant a given
// instructor visibility into it.
export async function getRidingHorsePublicationsForInstructor(
  instructorId: string
): Promise<RidingHorsePublicationFeedItem[]> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !(instructor.canEditRidingNotes || instructor.canEditHorseFeeding)) {
    return [];
  }

  const publications = await prisma.ridingSlotHorsePublication.findMany({
    where: { audience: "INSTRUCTORS" },
    include: {
      horseList: { select: { ridingSlotId: true } },
      items: { orderBy: { createdAt: "asc" } },
    },
  });

  const withMeta = await Promise.all(
    publications.map(async (pub) => {
      const meta = await resolveRidingSlotScheduleMeta(pub.horseList.ridingSlotId);
      return meta ? { pub, meta } : null;
    })
  );

  const feedItems: RidingHorsePublicationFeedItem[] = [];
  for (const entry of withMeta) {
    // Defensive only - a publication's RidingSlot is cascade-deleted along
    // with it, so this should not happen in practice; skip rather than
    // throw if the schedule linkage is ever missing.
    if (!entry) continue;
    const { pub, meta } = entry;

    const groups: RidingHorsePublicationFeedGroup[] = groupByGroupAndSubgroup(pub.items).map((section) => ({
      groupName: section.groupName,
      subgroups: section.subgroups.map((sub) => ({
        subgroupNumber: sub.subgroupNumber,
        responsibleInstructorNames: sub.items[0]?.responsibleInstructorNames ?? null,
        items: sub.items.map((item) => ({ horseName: item.horseName, studentName: item.studentName })),
      })),
    }));

    feedItems.push({
      id: pub.id,
      ridingSlotId: pub.horseList.ridingSlotId,
      title: pub.title,
      generalNote: pub.generalNote,
      date: meta.dateKeyStr,
      startTime: meta.startTime,
      endTime: meta.endTime,
      activityTitle: meta.activityTitle,
      firstPublishedAt: pub.firstPublishedAt.toISOString(),
      updatedAt: pub.updatedAt.toISOString(),
      updatedByName: pub.updatedByName,
      groups,
    });
  }

  // Sorted by riding-session date/time descending (most recent session
  // first) - date first, start time as the tiebreaker for same-day sessions.
  feedItems.sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));

  return feedItems;
}
