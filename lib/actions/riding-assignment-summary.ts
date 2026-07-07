"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey, todayDateKey } from "@/lib/dates";

// Counts RidingSlots an instructor is ASSIGNED to via RidingSlotAssignment -
// deliberately not "completed rides", since there's no confirmed/completed
// field on riding data yet. A slot with several assignment rows for the same
// instructor (e.g. two different subgroups) still counts once.
export interface InstructorRidingAssignmentSummary {
  instructorId: string;
  totalAssigned: number;
  pastAssigned: number;
  todayAssigned: number;
  upcomingAssigned: number;
}

function emptySummary(instructorId: string): InstructorRidingAssignmentSummary {
  return { instructorId, totalAssigned: 0, pastAssigned: 0, todayAssigned: 0, upcomingAssigned: 0 };
}

// A slot's own date is the earliest linked ScheduleItem's date (all linked
// rows share one calendar day - see RidingSlotScheduleItem's own docs) -
// mirrors the same reconstruction used by the student/instructor riding
// history feature, just without needing the full start/end time range here.
function resolveSlotDateKey(scheduleItems: { date: Date; startTime: string }[]): string | null {
  if (scheduleItems.length === 0) return null;
  const sorted = [...scheduleItems].sort((a, b) => a.startTime.localeCompare(b.startTime));
  return dateKey(sorted[0].date);
}

// past/today/upcoming are mutually exclusive by date only (not time-of-day
// within today) - a slot dated today counts as "today" even if it already
// finished a few hours ago, so the three buckets always add up to the total.
function classifyBucket(slotDateKey: string, todayKey: string): "past" | "today" | "upcoming" {
  if (slotDateKey < todayKey) return "past";
  if (slotDateKey > todayKey) return "upcoming";
  return "today";
}

// Shared core: builds one summary per instructor referenced by at least one
// RidingSlotAssignment, optionally restricted to a single instructor and/or
// a [startDateKey, endDateKey] date range (both inclusive). RidingSlots with
// no linked schedule item at all are skipped entirely, per spec.
async function buildRidingAssignmentSummaries(options: {
  instructorId?: string;
  startDateKey?: string;
  endDateKey?: string;
}): Promise<InstructorRidingAssignmentSummary[]> {
  // Matches on either the legacy instructorId column or a
  // RidingSlotAssignmentInstructor join row - a co-instructor who isn't the
  // assignment's "primary" (legacy) instructor must still be found here.
  const assignments = await prisma.ridingSlotAssignment.findMany({
    where: options.instructorId
      ? {
          OR: [
            { instructorId: options.instructorId },
            { instructors: { some: { instructorId: options.instructorId } } },
          ],
        }
      : {
          OR: [{ instructorId: { not: null } }, { instructors: { some: {} } }],
        },
    select: {
      instructorId: true,
      ridingSlotId: true,
      instructors: { select: { instructorId: true } },
      ridingSlot: {
        select: {
          scheduleItems: {
            select: { scheduleItem: { select: { date: true, startTime: true } } },
          },
        },
      },
    },
  });

  // Dedupe to (ridingSlotId -> set of instructorIds) first, so an instructor
  // with multiple assignment rows in the same slot (e.g. two subgroups, or a
  // split they co-instruct alongside someone else) is only ever counted once
  // for that slot. Legacy instructorId ∪ join-table instructor ids - the
  // legacy column is always a subset of the join table post-Stage-1-backfill
  // and post-Stage-2 saves, but unioning keeps this correct defensively.
  const instructorIdsBySlot = new Map<string, Set<string>>();
  const scheduleItemsBySlot = new Map<string, { date: Date; startTime: string }[]>();
  for (const a of assignments) {
    const ids = new Set<string>();
    if (a.instructorId) ids.add(a.instructorId);
    for (const j of a.instructors) ids.add(j.instructorId);
    if (ids.size === 0) continue;

    if (!instructorIdsBySlot.has(a.ridingSlotId)) instructorIdsBySlot.set(a.ridingSlotId, new Set());
    const slotInstructorIds = instructorIdsBySlot.get(a.ridingSlotId)!;
    for (const id of ids) {
      if (options.instructorId && id !== options.instructorId) continue;
      slotInstructorIds.add(id);
    }
    if (!scheduleItemsBySlot.has(a.ridingSlotId)) {
      scheduleItemsBySlot.set(
        a.ridingSlotId,
        a.ridingSlot.scheduleItems.map((link) => link.scheduleItem)
      );
    }
  }

  const todayKey = todayDateKey();
  const summaries = new Map<string, InstructorRidingAssignmentSummary>();

  for (const [ridingSlotId, instructorIds] of instructorIdsBySlot) {
    const slotDateKey = resolveSlotDateKey(scheduleItemsBySlot.get(ridingSlotId) ?? []);
    if (!slotDateKey) continue;
    if (options.startDateKey && slotDateKey < options.startDateKey) continue;
    if (options.endDateKey && slotDateKey > options.endDateKey) continue;

    const bucket = classifyBucket(slotDateKey, todayKey);
    for (const instructorId of instructorIds) {
      if (!summaries.has(instructorId)) summaries.set(instructorId, emptySummary(instructorId));
      const summary = summaries.get(instructorId)!;
      summary.totalAssigned += 1;
      if (bucket === "past") summary.pastAssigned += 1;
      else if (bucket === "today") summary.todayAssigned += 1;
      else summary.upcomingAssigned += 1;
    }
  }

  return Array.from(summaries.values());
}

// All-time totals (no date range) - the least-risky option for the admin
// instructors page, which has no week/date context of its own to scope a
// "current week" calculation against.
export async function getRidingAssignmentSummaryForAllInstructors(): Promise<
  InstructorRidingAssignmentSummary[]
> {
  await requireAdmin();
  return buildRidingAssignmentSummaries({});
}

// Scoped to a date range (the instructor home screen passes its own current
// week) - unrestricted, matching the same "any instructor can view riding
// data" convention already used by getInstructorRidingSlots/history.
export async function getRidingAssignmentSummaryForInstructor(
  instructorId: string,
  startDateKey: string,
  endDateKey: string
): Promise<InstructorRidingAssignmentSummary> {
  const [summary] = await buildRidingAssignmentSummaries({ instructorId, startDateKey, endDateKey });
  return summary ?? emptySummary(instructorId);
}
