"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey, parseDateKey } from "@/lib/dates";
import { buildScheduleSlots } from "@/lib/schedule-grouping";
import { getHorseDisplayInfo } from "@/lib/horse-info";
import { getKnownHorseNames } from "@/lib/actions/horse-feeding";
import type { ActionResult } from "@/lib/actions/students";
import type { AttendanceStatusValue } from "@/lib/actions/attendance";
import {
  findAssignmentForStudent,
  getAssignmentInstructors,
  formatInstructorNames,
} from "@/lib/riding-assignment-matching";

const NOT_FOUND_SCHEDULE_ITEM = 'פריט הלו"ז לא נמצא. נסי לרענן את העמוד.';
const NOT_FOUND_RIDING_SLOT = "ניהול הרכיבה לא נמצא. נסי לרענן את העמוד.";
const NOT_FOUND_INSTRUCTOR = "המדריך/ה שנבחר/ה לא נמצא/ת";
const NOT_FOUND_ASSIGNMENT = "השיוך לא נמצא. נסי לרענן את העמוד.";

export interface RidingSlotAssignmentRow {
  id: string;
  groupName: string | null;
  subgroupNumber: number | null;
  // Legacy/primary instructor - kept in sync as the first of instructorIds
  // below, or null if none. See RidingSlotAssignment.instructorId.
  instructorId: string | null;
  instructorName: string | null;
  // Full responsible-instructor list (RidingSlotAssignmentInstructor) - the
  // source of truth going forward; instructorId/instructorName above always
  // mirror instructorIds[0]/instructors[0].
  instructorIds: string[];
  instructors: { id: string; fullName: string }[];
  arena: string | null;
}

export interface RidingSlotRow {
  id: string;
  scheduleItemId: string;
  // All real ScheduleItem rows this logical riding slot covers, including
  // the anchor (scheduleItemId) - a merged/coalesced display card's full
  // "+"-joined id list, once linked, resolves to this set.
  scheduleItemIds: string[];
  showInstructorToStudents: boolean;
  showArenaToStudents: boolean;
  showSubgroupToStudents: boolean;
  assignments: RidingSlotAssignmentRow[];
}

export interface RidingSlotActionResult extends ActionResult {
  ridingSlot?: RidingSlotRow;
}

export interface RidingSlotAssignmentActionResult extends ActionResult {
  assignment?: RidingSlotAssignmentRow;
}

type AssignmentWithInstructor = {
  id: string;
  groupName: string | null;
  subgroupNumber: number | null;
  instructorId: string | null;
  arena: string | null;
  instructor: { fullName: string } | null;
  instructors: { instructor: { id: string; fullName: string } }[];
};

function toAssignmentRow(a: AssignmentWithInstructor): RidingSlotAssignmentRow {
  const instructors = getAssignmentInstructors(a);
  return {
    id: a.id,
    groupName: a.groupName,
    subgroupNumber: a.subgroupNumber,
    instructorId: a.instructorId,
    instructorName: a.instructor?.fullName ?? null,
    instructorIds: instructors.map((i) => i.id),
    instructors,
    arena: a.arena,
  };
}

// Shared include shape for RidingSlotAssignment - fetches both the legacy
// singular instructor and the full join-table list, in the order instructors
// were selected/saved (see syncAssignmentInstructors).
const ASSIGNMENT_WITH_INSTRUCTORS_INCLUDE = {
  instructor: true,
  instructors: { include: { instructor: true }, orderBy: { createdAt: "asc" as const } },
};

function toRidingSlotRow(slot: {
  id: string;
  scheduleItemId: string;
  showInstructorToStudents: boolean;
  showArenaToStudents: boolean;
  showSubgroupToStudents: boolean;
  assignments: AssignmentWithInstructor[];
  scheduleItems: { scheduleItemId: string }[];
}): RidingSlotRow {
  return {
    id: slot.id,
    scheduleItemId: slot.scheduleItemId,
    scheduleItemIds: slot.scheduleItems.map((s) => s.scheduleItemId),
    showInstructorToStudents: slot.showInstructorToStudents,
    showArenaToStudents: slot.showArenaToStudents,
    showSubgroupToStudents: slot.showSubgroupToStudents,
    assignments: slot.assignments.map(toAssignmentRow),
  };
}

const RIDING_SLOT_INCLUDE = {
  assignments: {
    include: ASSIGNMENT_WITH_INSTRUCTORS_INCLUDE,
    orderBy: [{ groupName: "asc" as const }, { subgroupNumber: "asc" as const }],
  },
  scheduleItems: { select: { scheduleItemId: true } },
};

// Shared by getRidingSlotForScheduleItem and getWeeklyRidingOverview - no
// requireAdmin() here (callers already gate), so the weekly overview isn't
// re-checking admin auth once per activity row.
async function resolveRidingSlotForIds(scheduleItemIds: string[]): Promise<RidingSlotRow | null> {
  if (scheduleItemIds.length === 0) return null;

  const link = await prisma.ridingSlotScheduleItem.findFirst({
    where: { scheduleItemId: { in: scheduleItemIds } },
  });
  if (!link) return null;

  const slot = await prisma.ridingSlot.findUnique({
    where: { id: link.ridingSlotId },
    include: RIDING_SLOT_INCLUDE,
  });
  return slot ? toRidingSlotRow(slot) : null;
}

// Read-only - does not create a RidingSlot just for viewing. A merged
// display card's full source id list is passed in so this resolves to an
// existing slot if ANY of those real rows already belong to one - not just
// the card's first row. Returns null when none of the given ids are linked
// to a riding slot yet.
export async function getRidingSlotForScheduleItem(
  scheduleItemIds: string[]
): Promise<RidingSlotRow | null> {
  await requireAdmin();
  return resolveRidingSlotForIds(scheduleItemIds);
}

type ResolveRidingSlotResult =
  | { success: true; ridingSlotId: string; created: boolean }
  | { success: false; error: string };

// Shared core of createOrGetRidingSlot and bulkApplyRidingAssignment - no
// requireAdmin() here (callers already gate) and no revalidatePath (callers
// do that once, after their own loop/single call). Takes the full source id
// list of the (possibly merged/coalesced) displayed card: if any of those
// real rows already belong to a riding slot, that slot is reused and any of
// the card's rows not yet linked are linked to it (self-healing, so the
// slot always ends up covering the full currently-displayed activity);
// otherwise a new slot is created anchored at the first id, then every id
// is linked to it.
async function resolveOrCreateRidingSlot(scheduleItemIds: string[]): Promise<ResolveRidingSlotResult> {
  if (scheduleItemIds.length === 0) {
    return { success: false, error: NOT_FOUND_SCHEDULE_ITEM };
  }

  const scheduleItems = await prisma.scheduleItem.findMany({
    where: { id: { in: scheduleItemIds } },
  });
  if (scheduleItems.length !== scheduleItemIds.length) {
    return { success: false, error: NOT_FOUND_SCHEDULE_ITEM };
  }

  const existingLink = await prisma.ridingSlotScheduleItem.findFirst({
    where: { scheduleItemId: { in: scheduleItemIds } },
  });

  let ridingSlotId = existingLink?.ridingSlotId ?? null;
  let created = false;

  if (!ridingSlotId) {
    // Defends against a RidingSlot that predates this join-table fix (or
    // was otherwise created without a corresponding link row) - reuse it
    // rather than colliding on the unique scheduleItemId anchor constraint.
    const existingAnchor = await prisma.ridingSlot.findUnique({
      where: { scheduleItemId: scheduleItemIds[0] },
    });
    ridingSlotId = existingAnchor?.id ?? null;
  }

  if (!ridingSlotId) {
    const createdSlot = await prisma.ridingSlot.create({ data: { scheduleItemId: scheduleItemIds[0] } });
    ridingSlotId = createdSlot.id;
    created = true;
  }

  const alreadyLinked = await prisma.ridingSlotScheduleItem.findMany({
    where: { ridingSlotId },
    select: { scheduleItemId: true },
  });
  const linkedIds = new Set(alreadyLinked.map((l) => l.scheduleItemId));
  const missingIds = scheduleItemIds.filter((id) => !linkedIds.has(id));

  if (missingIds.length > 0) {
    await prisma.ridingSlotScheduleItem.createMany({
      data: missingIds.map((scheduleItemId) => ({ ridingSlotId: ridingSlotId!, scheduleItemId })),
    });
  }

  return { success: true, ridingSlotId, created };
}

// The only place a RidingSlot row is ever created for a single displayed
// card - never touches ScheduleItem itself.
export async function createOrGetRidingSlot(
  scheduleItemIds: string[]
): Promise<RidingSlotActionResult> {
  await requireAdmin();

  const resolved = await resolveOrCreateRidingSlot(scheduleItemIds);
  if (!resolved.success) {
    return { success: false, error: resolved.error };
  }

  const slot = await prisma.ridingSlot.findUnique({
    where: { id: resolved.ridingSlotId },
    include: RIDING_SLOT_INCLUDE,
  });
  if (!slot) {
    return { success: false, error: NOT_FOUND_RIDING_SLOT };
  }

  revalidatePath("/admin/weekly-schedule");
  return { success: true, ridingSlot: toRidingSlotRow(slot) };
}

const visibilitySchema = z.object({
  showInstructorToStudents: z.boolean(),
  showArenaToStudents: z.boolean(),
  showSubgroupToStudents: z.boolean(),
});

export type RidingSlotVisibilityInput = z.infer<typeof visibilitySchema>;

// These flags are saved now but have no effect on student-facing display
// yet - that comes in a later stage. Purely a data-save action here.
export async function updateRidingSlotVisibility(
  ridingSlotId: string,
  flags: RidingSlotVisibilityInput
): Promise<RidingSlotActionResult> {
  await requireAdmin();

  const parsed = visibilitySchema.safeParse(flags);
  if (!parsed.success) {
    return { success: false, error: "קלט לא תקין" };
  }

  const existing = await prisma.ridingSlot.findUnique({ where: { id: ridingSlotId } });
  if (!existing) {
    return { success: false, error: NOT_FOUND_RIDING_SLOT };
  }

  const updated = await prisma.ridingSlot.update({
    where: { id: ridingSlotId },
    data: parsed.data,
    include: RIDING_SLOT_INCLUDE,
  });

  revalidatePath("/admin/weekly-schedule");
  return { success: true, ridingSlot: toRidingSlotRow(updated) };
}

const assignmentInputSchema = z.object({
  id: z.string().trim().optional(),
  ridingSlotId: z.string().min(1),
  groupName: z.string().trim().optional(),
  subgroupNumber: z.coerce.number().int().positive().optional(),
  // Legacy single-instructor input - still accepted so any caller that
  // hasn't been upgraded to instructorIds keeps working unchanged.
  instructorId: z.string().trim().optional(),
  // Full instructor list for this split. When provided (even as an empty
  // array, meaning "no instructors"), this wins over instructorId. When
  // omitted, instructorId (if any) is used as a single-element list.
  instructorIds: z.array(z.string().trim().min(1)).optional(),
  arena: z.string().trim().optional(),
});

export type RidingSlotAssignmentInput = z.infer<typeof assignmentInputSchema>;

// Resolves the two possible instructor inputs (legacy singular vs. the new
// list) down to one deduped id list - instructorIds wins when present.
function resolveInstructorIds(data: { instructorId?: string; instructorIds?: string[] }): string[] {
  if (data.instructorIds !== undefined) {
    return Array.from(new Set(data.instructorIds.filter((id) => id.length > 0)));
  }
  return data.instructorId ? [data.instructorId] : [];
}

async function validateInstructorIds(instructorIds: string[]): Promise<boolean> {
  if (instructorIds.length === 0) return true;
  const found = await prisma.instructor.findMany({ where: { id: { in: instructorIds } } });
  return found.length === instructorIds.length;
}

// Replaces the full RidingSlotAssignmentInstructor set for one assignment -
// always a full delete+recreate, matching the "each save overwrites" upsert
// convention used elsewhere in this module (e.g. RidingLessonNote fields).
async function syncAssignmentInstructors(
  tx: Prisma.TransactionClient,
  ridingSlotAssignmentId: string,
  instructorIds: string[]
): Promise<void> {
  await tx.ridingSlotAssignmentInstructor.deleteMany({ where: { ridingSlotAssignmentId } });
  if (instructorIds.length > 0) {
    await tx.ridingSlotAssignmentInstructor.createMany({
      data: instructorIds.map((instructorId) => ({ ridingSlotAssignmentId, instructorId })),
    });
  }
}

// Create (or edit, when input.id is set) one group/subgroup split of a
// riding slot. Creating without an id upserts on the DB's own unique key
// (ridingSlotId + groupName + subgroupNumber), so re-submitting the same
// split just updates it rather than erroring; editing by id can freely
// change that split's own group/subgroup, with the DB unique constraint
// still guarding against colliding with a different existing row.
export async function upsertRidingSlotAssignment(
  input: RidingSlotAssignmentInput
): Promise<RidingSlotAssignmentActionResult> {
  await requireAdmin();

  const parsed = assignmentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }
  const data = parsed.data;

  const ridingSlot = await prisma.ridingSlot.findUnique({ where: { id: data.ridingSlotId } });
  if (!ridingSlot) {
    return { success: false, error: NOT_FOUND_RIDING_SLOT };
  }

  const instructorIds = resolveInstructorIds(data);
  if (!(await validateInstructorIds(instructorIds))) {
    return { success: false, error: NOT_FOUND_INSTRUCTOR };
  }

  if (data.id) {
    const existingAssignment = await prisma.ridingSlotAssignment.findUnique({
      where: { id: data.id },
    });
    if (!existingAssignment) {
      return { success: false, error: NOT_FOUND_ASSIGNMENT };
    }
  }

  const groupName = data.groupName || null;
  const subgroupNumber = data.subgroupNumber ?? null;
  const primaryInstructorId = instructorIds[0] ?? null;
  const arena = data.arena || null;

  try {
    const saved = data.id
      ? await prisma.$transaction(async (tx) => {
          const updated = await tx.ridingSlotAssignment.update({
            where: { id: data.id! },
            data: { groupName, subgroupNumber, instructorId: primaryInstructorId, arena },
          });
          await syncAssignmentInstructors(tx, updated.id, instructorIds);
          return tx.ridingSlotAssignment.findUniqueOrThrow({
            where: { id: updated.id },
            include: ASSIGNMENT_WITH_INSTRUCTORS_INCLUDE,
          });
        })
      : (
          await applyAssignmentSplit({
            ridingSlotId: data.ridingSlotId,
            groupName,
            subgroupNumber,
            instructorIds,
            arena,
            skipIfExists: false,
          })
        ).assignment!;

    revalidatePath("/admin/weekly-schedule");
    return { success: true, assignment: toAssignmentRow(saved) };
  } catch {
    return {
      success: false,
      error: "כבר קיים שיוך לאותה קבוצה/תת-קבוצה עבור רכיבה זו",
    };
  }
}

// Shared core for creating/updating one group/subgroup split, reused by
// upsertRidingSlotAssignment (single, no id) and bulkApplyRidingAssignment
// (always a single-or-zero-element instructorIds list, per the v1 decision
// to keep bulk-assign single-instructor). Postgres unique constraints treat
// NULL as distinct from any other NULL, so the DB-level
// @@unique([ridingSlotId, groupName, subgroupNumber]) constraint (and
// Prisma's compound-key upsert shorthand, which requires non-null values for
// those fields) can't reliably match a "whole slot" (both null) row.
// findFirst's `where` still filters null fields correctly (translates to IS
// NULL), so this replicates upsert-by-split manually. The assignment row and
// its RidingSlotAssignmentInstructor rows are written in one transaction so
// the legacy instructorId column and the join table never diverge.
async function applyAssignmentSplit(params: {
  ridingSlotId: string;
  groupName: string | null;
  subgroupNumber: number | null;
  instructorIds: string[];
  arena: string | null;
  skipIfExists: boolean;
}): Promise<{ outcome: "created" | "updated" | "skipped"; assignment: AssignmentWithInstructor | null }> {
  const existingMatch = await prisma.ridingSlotAssignment.findFirst({
    where: {
      ridingSlotId: params.ridingSlotId,
      groupName: params.groupName,
      subgroupNumber: params.subgroupNumber,
    },
  });

  const primaryInstructorId = params.instructorIds[0] ?? null;

  if (existingMatch) {
    if (params.skipIfExists) {
      return { outcome: "skipped", assignment: null };
    }
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.ridingSlotAssignment.update({
        where: { id: existingMatch.id },
        data: { instructorId: primaryInstructorId, arena: params.arena },
      });
      await syncAssignmentInstructors(tx, u.id, params.instructorIds);
      return tx.ridingSlotAssignment.findUniqueOrThrow({
        where: { id: u.id },
        include: ASSIGNMENT_WITH_INSTRUCTORS_INCLUDE,
      });
    });
    return { outcome: "updated", assignment: updated };
  }

  const created = await prisma.$transaction(async (tx) => {
    const c = await tx.ridingSlotAssignment.create({
      data: {
        ridingSlotId: params.ridingSlotId,
        groupName: params.groupName,
        subgroupNumber: params.subgroupNumber,
        instructorId: primaryInstructorId,
        arena: params.arena,
      },
    });
    await syncAssignmentInstructors(tx, c.id, params.instructorIds);
    return tx.ridingSlotAssignment.findUniqueOrThrow({
      where: { id: c.id },
      include: ASSIGNMENT_WITH_INSTRUCTORS_INCLUDE,
    });
  });
  return { outcome: "created", assignment: created };
}

export async function deleteRidingSlotAssignment(assignmentId: string): Promise<ActionResult> {
  await requireAdmin();

  const existing = await prisma.ridingSlotAssignment.findUnique({ where: { id: assignmentId } });
  if (!existing) {
    return { success: false, error: NOT_FOUND_ASSIGNMENT };
  }

  await prisma.ridingSlotAssignment.delete({ where: { id: assignmentId } });

  revalidatePath("/admin/weekly-schedule");
  return { success: true };
}

export interface WeeklyRidingActivity {
  // Full real ScheduleItem id set behind this displayed activity - split of
  // a "+"-joined merged/coalesced id, same recovery used everywhere else.
  scheduleItemIds: string[];
  dateKey: string;
  startTime: string;
  endTime: string;
  title: string;
  groupName: string | null;
  // Reference-only, from the original ScheduleItem(s) - never written to.
  instructorName: string | null;
  location: string | null;
  isLikelyRiding: boolean;
  ridingSlot: RidingSlotRow | null;
}

export interface WeeklyRidingDay {
  dateKey: string;
  activities: WeeklyRidingActivity[];
}

type ScheduleItemForOverview = {
  id: string;
  startTime: string;
  endTime: string;
  title: string;
  description: string | null;
  groupName: string | null;
  instructorName: string | null;
  location: string | null;
};

// Shared by getWeeklyRidingOverview and getInstructorRidingSlots - classifies
// one day's ScheduleItem rows exactly like the admin already sees them.
// Callers must only ever pass items from a single date; buildScheduleSlots
// compares startTime/endTime as plain strings, so mixing dates could
// incorrectly merge unrelated activities that happen to share HH:MM times.
async function buildActivitiesForDay<T extends ScheduleItemForOverview>(
  dk: string,
  dayItems: T[]
): Promise<WeeklyRidingActivity[]> {
  const slots = buildScheduleSlots(dayItems);

  // Flatten each display "box" into one activity row: single/merged is one
  // box; pair is two separate boxes (different titles, shown side by side);
  // span is the one long box plus each of the other side's several short
  // boxes.
  const rawActivities: T[] = [];
  for (const slot of slots) {
    if (slot.kind === "single" || slot.kind === "merged") {
      rawActivities.push(slot.item);
    } else if (slot.kind === "pair") {
      rawActivities.push(slot.items[0], slot.items[1]);
    } else {
      const longSide = slot.groupA.length === 1 ? slot.groupA : slot.groupB;
      const shortSide = slot.groupA.length === 1 ? slot.groupB : slot.groupA;
      rawActivities.push(...longSide, ...shortSide);
    }
  }

  const activities: WeeklyRidingActivity[] = [];
  for (const item of rawActivities) {
    const scheduleItemIds = item.id.split("+");
    const isLikelyRiding =
      item.title.includes("רכיבה") || (item.description ?? "").includes("רכיבה");
    const ridingSlot = await resolveRidingSlotForIds(scheduleItemIds);
    activities.push({
      scheduleItemIds,
      dateKey: dk,
      startTime: item.startTime,
      endTime: item.endTime,
      title: item.title,
      groupName: item.groupName,
      instructorName: item.instructorName,
      location: item.location,
      isLikelyRiding,
      ridingSlot,
    });
  }
  activities.sort(
    (a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime)
  );

  return activities;
}

// Read-only overview of every displayed activity across a whole week,
// classified exactly like the admin already sees it.
export async function getWeeklyRidingOverview(weeklyScheduleId: string): Promise<WeeklyRidingDay[]> {
  await requireAdmin();

  const week = await prisma.weeklySchedule.findUnique({
    where: { id: weeklyScheduleId },
    include: { items: { orderBy: [{ date: "asc" }, { startTime: "asc" }] } },
  });
  if (!week) return [];

  const byDate = new Map<string, typeof week.items>();
  for (const item of week.items) {
    const dk = dateKey(item.date);
    if (!byDate.has(dk)) byDate.set(dk, []);
    byDate.get(dk)!.push(item);
  }

  const days: WeeklyRidingDay[] = [];
  const sortedDateKeys = Array.from(byDate.keys()).sort();

  for (const dk of sortedDateKeys) {
    const activities = await buildActivitiesForDay(dk, byDate.get(dk)!);
    days.push({ dateKey: dk, activities });
  }

  return days;
}

// Instructors have no NextAuth session in this app - viewing riding slots is
// intentionally unrestricted here, mirroring getAttendanceTrackingForInstructor
// / getDutyAssignmentsForInstructor. Takes a plain date range (not a specific
// WeeklySchedule id) since the instructor screen has its own day/week picker,
// independent of any single uploaded schedule.
//
// Operational view, not a setup view: unlike getWeeklyRidingOverview (which
// admin uses to find/mark candidate activities and deliberately includes
// every schedule item), this only ever returns activities that already have
// a RidingSlot - an instructor's "כל הרכיבות" must mean "all riding slots
// admin has defined," never "the entire weekly timetable."
export async function getInstructorRidingSlots(
  startDateKey: string,
  endDateKey: string
): Promise<WeeklyRidingDay[]> {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);

  const items = await prisma.scheduleItem.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  const byDate = new Map<string, typeof items>();
  for (const item of items) {
    const dk = dateKey(item.date);
    if (!byDate.has(dk)) byDate.set(dk, []);
    byDate.get(dk)!.push(item);
  }

  const days: WeeklyRidingDay[] = [];
  const sortedDateKeys = Array.from(byDate.keys()).sort();

  for (const dk of sortedDateKeys) {
    const activities = (await buildActivitiesForDay(dk, byDate.get(dk)!)).filter(
      (a) => a.ridingSlot !== null
    );
    if (activities.length > 0) {
      days.push({ dateKey: dk, activities });
    }
  }

  return days;
}

const bulkAssignmentInputSchema = z.object({
  groupName: z.enum(["", "א", "ב"]).optional(),
  subgroupNumber: z.coerce.number().int().positive().optional(),
  instructorId: z.string().trim().optional(),
  arena: z.string().trim().optional(),
  mode: z.enum(["skipExisting", "overwrite"]),
});

export interface BulkRidingAssignmentInput {
  // Exactly the activities currently shown in the caller's filtered list -
  // never recomputed server-side, so the bulk action only ever touches what
  // the admin actually sees on screen.
  activities: { scheduleItemIds: string[] }[];
  groupName?: string;
  subgroupNumber?: number;
  instructorId?: string;
  arena?: string;
  mode: "skipExisting" | "overwrite";
}

export interface BulkRidingAssignmentSummary {
  totalActivities: number;
  createdSlots: number;
  createdAssignments: number;
  updatedAssignments: number;
  skippedAssignments: number;
  errors: string[];
}

export interface BulkRidingAssignmentResult extends ActionResult {
  summary?: BulkRidingAssignmentSummary;
}

// Applies one (groupName, subgroupNumber, instructorId, arena) assignment
// template across every given activity - reuses the exact same
// resolveOrCreateRidingSlot (self-healing join-table logic, safe for merged
// activities) and applyAssignmentSplit (safe null-aware upsert) used by the
// single-activity actions above, just looped. Sequential and idempotent:
// re-running with the same input is safe (skipExisting leaves already-set
// splits untouched; overwrite re-applies the same values). Not wrapped in
// one DB transaction - a partial failure is recoverable by re-running.
export async function bulkApplyRidingAssignment(
  input: BulkRidingAssignmentInput
): Promise<BulkRidingAssignmentResult> {
  await requireAdmin();

  if (!input.activities || input.activities.length === 0) {
    return { success: false, error: "לא נבחרו פעילויות להחלת השיוך" };
  }

  const parsed = bulkAssignmentInputSchema.safeParse({
    groupName: input.groupName,
    subgroupNumber: input.subgroupNumber,
    instructorId: input.instructorId,
    arena: input.arena,
    mode: input.mode,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }
  const data = parsed.data;

  if (data.instructorId) {
    const instructor = await prisma.instructor.findUnique({ where: { id: data.instructorId } });
    if (!instructor) {
      return { success: false, error: NOT_FOUND_INSTRUCTOR };
    }
  }

  const groupName = data.groupName || null;
  const subgroupNumber = data.subgroupNumber ?? null;
  const instructorId = data.instructorId || null;
  const arena = data.arena || null;
  const skipIfExists = data.mode === "skipExisting";

  const summary: BulkRidingAssignmentSummary = {
    totalActivities: input.activities.length,
    createdSlots: 0,
    createdAssignments: 0,
    updatedAssignments: 0,
    skippedAssignments: 0,
    errors: [],
  };

  for (const activity of input.activities) {
    const scheduleItemIds = activity.scheduleItemIds;
    if (!scheduleItemIds || scheduleItemIds.length === 0) {
      summary.errors.push('פעילות ללא פריטי לו"ז - דולגה');
      continue;
    }

    const resolved = await resolveOrCreateRidingSlot(scheduleItemIds);
    if (!resolved.success) {
      summary.errors.push(resolved.error);
      continue;
    }
    if (resolved.created) summary.createdSlots++;

    try {
      const applied = await applyAssignmentSplit({
        ridingSlotId: resolved.ridingSlotId,
        groupName,
        subgroupNumber,
        instructorIds: instructorId ? [instructorId] : [],
        arena,
        skipIfExists,
      });
      if (applied.outcome === "created") summary.createdAssignments++;
      else if (applied.outcome === "updated") summary.updatedAssignments++;
      else summary.skippedAssignments++;
    } catch {
      summary.errors.push(`שגיאה בשמירת שיוך עבור פעילות ב-${scheduleItemIds[0]}`);
    }
  }

  revalidatePath("/admin/weekly-schedule");
  return { success: true, summary };
}

export interface BulkRidingVisibilitySummary {
  totalActivities: number;
  createdSlots: number;
  updatedSlots: number;
  errors: string[];
}

export interface BulkRidingVisibilityResult extends ActionResult {
  summary?: BulkRidingVisibilitySummary;
}

// Unconditionally sets the three visibility flags on every given activity's
// RidingSlot (creating it first via the same self-healing
// resolveOrCreateRidingSlot if it doesn't exist yet) - no skip/overwrite
// mode, since a boolean has no meaningful "missing" state to preserve (see
// the single-slot updateRidingSlotVisibility, which is the same
// unconditional set). These flags still only save for later use - no
// effect on student-facing display yet.
export async function bulkSetRidingVisibility(
  activities: { scheduleItemIds: string[] }[],
  flags: RidingSlotVisibilityInput
): Promise<BulkRidingVisibilityResult> {
  await requireAdmin();

  if (!activities || activities.length === 0) {
    return { success: false, error: "לא נבחרו פעילויות להחלת הגדרות התצוגה" };
  }

  const parsed = visibilitySchema.safeParse(flags);
  if (!parsed.success) {
    return { success: false, error: "קלט לא תקין" };
  }

  const summary: BulkRidingVisibilitySummary = {
    totalActivities: activities.length,
    createdSlots: 0,
    updatedSlots: 0,
    errors: [],
  };

  for (const activity of activities) {
    const scheduleItemIds = activity.scheduleItemIds;
    if (!scheduleItemIds || scheduleItemIds.length === 0) {
      summary.errors.push('פעילות ללא פריטי לו"ז - דולגה');
      continue;
    }

    const resolved = await resolveOrCreateRidingSlot(scheduleItemIds);
    if (!resolved.success) {
      summary.errors.push(resolved.error);
      continue;
    }
    if (resolved.created) summary.createdSlots++;

    try {
      await prisma.ridingSlot.update({ where: { id: resolved.ridingSlotId }, data: parsed.data });
      summary.updatedSlots++;
    } catch {
      summary.errors.push(`שגיאה בעדכון תצוגה עבור פעילות ב-${scheduleItemIds[0]}`);
    }
  }

  revalidatePath("/admin/weekly-schedule");
  return { success: true, summary };
}

export interface RidingSlotStudentRow {
  studentId: string;
  studentName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
  note: string | null;
  ratingHalfPoints: number | null;
  // Overrides the student's normal horse for this riding session only - see
  // RidingLessonNote.sessionHorseName. Null means "no override, use the
  // normal horse."
  sessionHorseName: string | null;
  // Free-text topic recorded for this student's lesson - see
  // RidingLessonNote.lessonTopic. Null means none recorded yet.
  lessonTopic: string | null;
  // Which חניך/ים this student (as trainee) instructed/taught during this
  // session - see RidingLessonNoteTaughtStudent. Empty when none recorded.
  taughtStudents: { id: string; fullName: string }[];
  updatedByName: string | null;
  // ISO string, null when no note/rating has ever been saved for this
  // student+slot - kept for the future student history view too.
  updatedAt: string | null;
  // Read-only attendance snapshot for the riding slot's own date - never
  // written from this screen. Null status means no StudentAttendance row
  // exists for that date (treated the same as PRESENT for display purposes).
  attendanceStatus: AttendanceStatusValue | null;
  attendanceArrivalTime: string | null;
  attendanceDepartureTime: string | null;
  attendanceNotes: string | null;
}

// Read-only, unrestricted view (same "all instructors can view" convention
// as the riding slot itself) - never creates anything. Derives which
// students are "relevant" to this slot from its own assignment splits:
// - a (groupName, subgroupNumber) split -> students matching both fields.
// - a (groupName, null) split -> students matching that group, any subgroup.
// - a whole-slot split (null, null), or no assignments at all yet -> falls
//   back to the underlying ScheduleItem's own groupName (every student in
//   that group), or every active student when the item has no single group
//   (a "שתי הקבוצות" activity) - matching how the item is actually displayed.
// Multiple splits are unioned (a student matching more than one split still
// appears once - Prisma OR against one table never duplicates rows).
export async function getRidingSlotStudentNotes(ridingSlotId: string): Promise<RidingSlotStudentRow[]> {
  const slot = await prisma.ridingSlot.findUnique({
    where: { id: ridingSlotId },
    include: {
      assignments: true,
      notes: {
        include: { taughtStudents: { include: { student: { select: { id: true, fullName: true } } } } },
      },
      scheduleItem: { select: { groupName: true, date: true } },
    },
  });
  if (!slot) return [];

  const scheduleItemGroupName = slot.scheduleItem.groupName;

  const filters: { groupName: string | null; subgroupNumber: number | null }[] =
    slot.assignments.length > 0
      ? slot.assignments.map((a) =>
          a.groupName === null && a.subgroupNumber === null
            ? { groupName: scheduleItemGroupName, subgroupNumber: null }
            : { groupName: a.groupName, subgroupNumber: a.subgroupNumber }
        )
      : [{ groupName: scheduleItemGroupName, subgroupNumber: null }];

  const students = await prisma.student.findMany({
    where: {
      isActive: true,
      OR: filters.map((f) => ({
        ...(f.groupName !== null ? { groupName: f.groupName } : {}),
        ...(f.subgroupNumber !== null ? { subgroupNumber: f.subgroupNumber } : {}),
      })),
    },
    orderBy: { fullName: "asc" },
  });

  const noteByStudentId = new Map(slot.notes.map((n) => [n.studentId, n]));

  const attendanceRecords = await prisma.studentAttendance.findMany({
    where: { date: slot.scheduleItem.date, studentId: { in: students.map((s) => s.id) } },
  });
  const attendanceByStudentId = new Map(attendanceRecords.map((a) => [a.studentId, a]));

  return students.map((s) => {
    const note = noteByStudentId.get(s.id);
    const attendance = attendanceByStudentId.get(s.id);
    return {
      studentId: s.id,
      studentName: s.fullName,
      groupName: s.groupName,
      subgroupNumber: s.subgroupNumber,
      hasPrivateHorse: s.hasPrivateHorse,
      privateHorseName: s.privateHorseName,
      assignedHorseName: s.assignedHorseName,
      note: note?.note ?? null,
      ratingHalfPoints: note?.ratingHalfPoints ?? null,
      sessionHorseName: note?.sessionHorseName ?? null,
      lessonTopic: note?.lessonTopic ?? null,
      taughtStudents: note?.taughtStudents.map((t) => ({ id: t.student.id, fullName: t.student.fullName })) ?? [],
      updatedByName: note?.updatedByName ?? null,
      updatedAt: note?.updatedAt ? note.updatedAt.toISOString() : null,
      attendanceStatus: attendance?.status ?? null,
      attendanceArrivalTime: attendance?.arrivalTime ?? null,
      attendanceDepartureTime: attendance?.departureTime ?? null,
      attendanceNotes: attendance?.notes ?? null,
    };
  });
}

export interface RidingLessonNoteInput {
  note?: string;
  ratingHalfPoints?: number | null;
  sessionHorseName?: string;
  lessonTopic?: string;
  // Full replacement list of taught חניכים - a save always overwrites the
  // previously recorded set (same convention as note/rating/sessionHorseName),
  // never a partial add/remove. Omitted or empty clears it.
  taughtStudentIds?: string[];
}

export interface RidingLessonNoteActionResult extends ActionResult {
  updatedByName?: string | null;
  updatedAt?: string | null;
}

// Instructors have no NextAuth session in this app, so the permission check
// re-reads canEditRidingNotes from the DB by instructorId on every call - it
// never trusts a client-supplied boolean. This is the only gate; UI hiding
// of edit controls is not relied upon. Viewing (getRidingSlotStudentNotes
// above) has no such gate - matches the attendance pattern exactly.
export async function upsertRidingLessonNoteAsInstructor(
  instructorId: string,
  ridingSlotId: string,
  studentId: string,
  input: RidingLessonNoteInput
): Promise<RidingLessonNoteActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: "אין הרשאה לערוך הערות הדרכת מתקדמים" };
  }

  const ridingSlot = await prisma.ridingSlot.findUnique({ where: { id: ridingSlotId } });
  if (!ridingSlot) {
    return { success: false, error: NOT_FOUND_RIDING_SLOT };
  }

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) {
    return { success: false, error: "החניך/ה לא נמצא/ה" };
  }

  const ratingHalfPoints = input.ratingHalfPoints ?? null;
  if (
    ratingHalfPoints !== null &&
    (!Number.isInteger(ratingHalfPoints) || ratingHalfPoints < 2 || ratingHalfPoints > 10)
  ) {
    return { success: false, error: "דירוג לא תקין - יש לבחור ערך בין 1 ל-5" };
  }

  const note = input.note?.trim() || null;
  const sessionHorseName = input.sessionHorseName?.trim() || null;
  const lessonTopic = input.lessonTopic?.trim() || null;
  const taughtStudentIds = Array.from(
    new Set((input.taughtStudentIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0))
  );

  if (taughtStudentIds.length > 0) {
    const foundTaughtStudents = await prisma.student.findMany({
      where: { id: { in: taughtStudentIds } },
      select: { id: true },
    });
    if (foundTaughtStudents.length !== taughtStudentIds.length) {
      return { success: false, error: "אחד או יותר מהחניכים שנבחרו כמודרכים לא נמצא/ו" };
    }
  }

  const saved = await prisma.$transaction(async (tx) => {
    const savedNote = await tx.ridingLessonNote.upsert({
      where: { ridingSlotId_studentId: { ridingSlotId, studentId } },
      update: { note, ratingHalfPoints, sessionHorseName, lessonTopic, updatedByName: instructor.fullName },
      create: {
        ridingSlotId,
        studentId,
        note,
        ratingHalfPoints,
        sessionHorseName,
        lessonTopic,
        updatedByName: instructor.fullName,
      },
    });

    // Full replace, same as the other fields above - re-running with an
    // empty/omitted taughtStudentIds clears whatever was previously saved.
    await tx.ridingLessonNoteTaughtStudent.deleteMany({ where: { ridingLessonNoteId: savedNote.id } });
    if (taughtStudentIds.length > 0) {
      await tx.ridingLessonNoteTaughtStudent.createMany({
        data: taughtStudentIds.map((taughtStudentId) => ({
          ridingLessonNoteId: savedNote.id,
          studentId: taughtStudentId,
        })),
      });
    }

    return savedNote;
  });

  revalidatePath("/instructor");
  return { success: true, updatedByName: saved.updatedByName, updatedAt: saved.updatedAt.toISOString() };
}

export interface RidingHistoryRow {
  ridingSlotId: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  title: string;
  groupName: string | null;
  subgroupNumber: number | null;
  instructorName: string | null;
  arena: string | null;
  // Already resolved: "סוס בשיעור: X" when this note has a session override,
  // otherwise the student's normal horse via getHorseDisplayInfo. Computed
  // server-side so both the admin and instructor views render identically
  // without duplicating the resolution rule.
  horseDisplay: string;
  ratingHalfPoints: number | null;
  note: string | null;
  lessonTopic: string | null;
  taughtStudents: { id: string; fullName: string }[];
  updatedByName: string | null;
  updatedAt: string;
}

export interface StudentRidingHistoryResult {
  student: {
    id: string;
    fullName: string;
    groupName: string | null;
    subgroupNumber: number | null;
    horseNameDisplay: string;
  };
  rows: RidingHistoryRow[];
}

// Read-only, reused by both the admin and instructor history views (neither
// creates or mutates anything). One row per RidingLessonNote the student
// has - never per ScheduleItem, so a merged/multi-row riding slot still
// only ever produces one history row, matching how notes are actually
// stored (one per ridingSlotId + studentId). The slot's own date/time range
// is reconstructed from its full linked ScheduleItem set (via
// RidingSlotScheduleItem), not just the anchor row, so a 2-hour lesson
// stored as two contiguous rows still shows its true 08:00-10:00 range.
async function buildStudentRidingHistory(studentId: string): Promise<StudentRidingHistoryResult | null> {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return null;

  const notes = await prisma.ridingLessonNote.findMany({
    where: { studentId },
    include: {
      taughtStudents: { include: { student: { select: { id: true, fullName: true } } } },
      ridingSlot: {
        include: {
          assignments: { include: ASSIGNMENT_WITH_INSTRUCTORS_INCLUDE },
          scheduleItems: { include: { scheduleItem: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const rows: RidingHistoryRow[] = [];
  for (const n of notes) {
    const scheduleItems = n.ridingSlot.scheduleItems.map((link) => link.scheduleItem);
    if (scheduleItems.length === 0) continue;
    scheduleItems.sort((a, b) => a.startTime.localeCompare(b.startTime));
    const first = scheduleItems[0];
    const last = scheduleItems[scheduleItems.length - 1];

    const assignment = findAssignmentForStudent(
      n.ridingSlot.assignments,
      student.groupName,
      student.subgroupNumber
    );

    const sessionHorse = n.sessionHorseName?.trim();
    const horseDisplay = sessionHorse
      ? `סוס בשיעור: ${sessionHorse}`
      : `סוס: ${getHorseDisplayInfo(student).horseNameDisplay}`;

    rows.push({
      ridingSlotId: n.ridingSlotId,
      dateKey: dateKey(first.date),
      startTime: first.startTime,
      endTime: last.endTime,
      title: first.title,
      groupName: student.groupName,
      subgroupNumber: student.subgroupNumber,
      instructorName: assignment ? formatInstructorNames(getAssignmentInstructors(assignment).map((i) => i.fullName)) : null,
      arena: assignment?.arena ?? null,
      horseDisplay,
      ratingHalfPoints: n.ratingHalfPoints,
      note: n.note,
      lessonTopic: n.lessonTopic,
      taughtStudents: n.taughtStudents.map((t) => ({ id: t.student.id, fullName: t.student.fullName })),
      updatedByName: n.updatedByName,
      updatedAt: n.updatedAt.toISOString(),
    });
  }

  return {
    student: {
      id: student.id,
      fullName: student.fullName,
      groupName: student.groupName,
      subgroupNumber: student.subgroupNumber,
      horseNameDisplay: getHorseDisplayInfo(student).horseNameDisplay,
    },
    rows,
  };
}

export async function getStudentRidingHistoryForAdmin(
  studentId: string
): Promise<StudentRidingHistoryResult | null> {
  await requireAdmin();
  return buildStudentRidingHistory(studentId);
}

// Unrestricted view - matches the existing "all instructors can view"
// convention (attendance, riding slots). Never called from student-facing
// code; students must not see notes/ratings at all.
export async function getStudentRidingHistoryForInstructor(
  studentId: string
): Promise<StudentRidingHistoryResult | null> {
  return buildStudentRidingHistory(studentId);
}

// Suggestions for the lesson-topic input - same "grows from whatever gets
// typed" convention as getKnownHayTypes/getKnownConcentrateTypes, never a
// closed list.
export async function getKnownRidingLessonTopics(): Promise<string[]> {
  const rows = await prisma.ridingLessonNote.findMany({
    where: { lessonTopic: { not: null } },
    select: { lessonTopic: true },
    distinct: ["lessonTopic"],
  });
  return rows
    .map((r) => r.lessonTopic!)
    .filter((v) => v.trim().length > 0)
    .sort((a, b) => a.localeCompare(b, "he"));
}

// Suggestions for the session-horse input - unions the same known-horse-name
// set horse feeding already exposes (getKnownHorseNames) with horse names
// previously typed into sessionHorseName, so a name only ever entered as a
// one-off session override still becomes a future suggestion. No Horse
// table - horseName stays the natural key everywhere in this app.
export async function getKnownRidingHorseNames(): Promise<string[]> {
  const [feedingNames, sessionHorseRows] = await Promise.all([
    getKnownHorseNames(),
    prisma.ridingLessonNote.findMany({
      where: { sessionHorseName: { not: null } },
      select: { sessionHorseName: true },
      distinct: ["sessionHorseName"],
    }),
  ]);

  const names = new Set(feedingNames);
  for (const row of sessionHorseRows) {
    const name = row.sessionHorseName?.trim();
    if (name) names.add(name);
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b, "he"));
}
