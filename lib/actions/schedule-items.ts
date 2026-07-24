"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey, parseDateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";

const scheduleItemSchema = z.object({
  dateKey: z.string().min(1, "יש לבחור תאריך"),
  startTime: z.string().regex(/^\d{1,2}:\d{2}$/, "פורמט שעה לא תקין (HH:MM)"),
  endTime: z.string().regex(/^\d{1,2}:\d{2}$/, "פורמט שעה לא תקין (HH:MM)"),
  title: z.string().trim().min(1, "יש להזין כותרת פעילות"),
  groupName: z.string().trim().optional(),
  instructorName: z.string().trim().optional(),
  location: z.string().trim().optional(),
  description: z.string().trim().optional(),
  combinedParticipation: z.boolean().nullable().optional(),
});

export type ScheduleItemInput = z.infer<typeof scheduleItemSchema>;

export interface ScheduleItemRow {
  id: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  title: string;
  description: string | null;
  groupName: string | null;
  instructorName: string | null;
  location: string | null;
  // Optional so existing callers that build ScheduleItemRow without this
  // data-only field keep compiling; the offering editor reads it when present.
  combinedParticipation?: boolean | null;
}

export interface ScheduleItemActionResult extends ActionResult {
  item?: ScheduleItemRow;
}

export interface ScheduleItemGroupActionResult extends ActionResult {
  items?: ScheduleItemRow[];
}

function timeToMinutes(t: string): number {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function toRow(item: {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  title: string;
  description: string | null;
  groupName: string | null;
  instructorName: string | null;
  location: string | null;
  combinedParticipation: boolean | null;
}): ScheduleItemRow {
  return {
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
  };
}

function validate(input: ScheduleItemInput): string | null {
  const parsed = scheduleItemSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "קלט לא תקין";
  if (timeToMinutes(input.endTime) <= timeToMinutes(input.startTime)) {
    return "שעת הסיום חייבת להיות אחרי שעת ההתחלה";
  }
  return null;
}

const NOT_FOUND_ERROR = "פריט הלו\"ז לא נמצא. נסי לרענן את העמוד.";

export async function updateScheduleItem(
  itemId: string,
  input: ScheduleItemInput
): Promise<ScheduleItemActionResult> {
  await requireAdmin();
  const error = validate(input);
  if (error) return { success: false, error };

  // The "all groups" grid view can display two or more real rows merged
  // into one card (continuous same-title activities, or same-time
  // cross-group pairs) with a synthetic "realId1+realId2" display id - that
  // id was never a real row, so an update/delete against it would otherwise
  // throw a Prisma "record not found" error instead of failing cleanly.
  const existing = await prisma.scheduleItem.findUnique({ where: { id: itemId } });
  if (!existing) {
    return { success: false, error: NOT_FOUND_ERROR };
  }

  const updated = await prisma.scheduleItem.update({
    where: { id: itemId },
    data: {
      date: parseDateKey(input.dateKey),
      startTime: input.startTime,
      endTime: input.endTime,
      title: input.title,
      description: input.description || null,
      groupName: input.groupName || null,
      instructorName: input.instructorName || null,
      location: input.location || null,
      // `?? null` preserves an explicit `false` (false is not nullish); only
      // null/undefined collapse to null. Data-only; not read by any filter yet.
      combinedParticipation: input.combinedParticipation ?? null,
    },
  });

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/student");
  revalidatePath("/instructor");
  return { success: true, item: toRow(updated) };
}

// Updates a "merged" display card - one continuous logical activity that the
// admin/student/instructor timetable views coalesce from 2+ real
// ScheduleItem rows (contiguous same-group same-title rows, and/or a
// same-time cross-group pair). title/instructor/location/description/date
// apply to every source row; groupName only applies when every source row
// already shares one group (see isCrossGroup below - a cross-group merge
// never gets its rows reassigned to one group). startTime only changes on
// the earliest row and endTime only on the latest row, so the internal
// split boundaries between the original rows are left exactly as they were
// - no rows are collapsed or created.
export async function updateMergedScheduleItems(
  sourceIds: string[],
  input: ScheduleItemInput
): Promise<ScheduleItemGroupActionResult> {
  await requireAdmin();
  const error = validate(input);
  if (error) return { success: false, error };

  if (sourceIds.length === 0) {
    return { success: false, error: NOT_FOUND_ERROR };
  }

  const existing = await prisma.scheduleItem.findMany({ where: { id: { in: sourceIds } } });
  if (existing.length !== sourceIds.length) {
    return { success: false, error: NOT_FOUND_ERROR };
  }

  const ordered = [...existing].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const firstRow = ordered[0];
  const lastRow = ordered[ordered.length - 1];

  // Guards against corrupting an internal row: the new overall start must
  // stay before the first row's own original end, and the new overall end
  // must stay after the last row's own original start - otherwise that edge
  // row would end up with startTime >= endTime.
  if (timeToMinutes(input.startTime) >= timeToMinutes(firstRow.endTime) && ordered.length > 1) {
    return {
      success: false,
      error: "שעת ההתחלה החדשה חייבת להיות לפני סיום הפריט הראשון המקורי",
    };
  }
  if (timeToMinutes(input.endTime) <= timeToMinutes(lastRow.startTime) && ordered.length > 1) {
    return {
      success: false,
      error: "שעת הסיום החדשה חייבת להיות אחרי תחילת הפריט האחרון המקורי",
    };
  }

  // A cross-group "שתי הקבוצות" merged card (source rows spanning more than
  // one groupName) must never have all its rows reassigned to a single
  // group - that would silently move a row out of its real group. Detected
  // server-side (not just trusted from the UI) so groupName is only ever
  // included in the shared update when every source row already shares one
  // group; otherwise it's simply omitted and each row keeps its own value.
  const distinctGroups = new Set(existing.map((row) => row.groupName));
  const isCrossGroup = distinctGroups.size > 1;

  const sharedData = {
    date: parseDateKey(input.dateKey),
    title: input.title,
    description: input.description || null,
    instructorName: input.instructorName || null,
    location: input.location || null,
    ...(isCrossGroup ? {} : { groupName: input.groupName || null }),
  };

  const updated = await prisma.$transaction(
    ordered.map((row) =>
      prisma.scheduleItem.update({
        where: { id: row.id },
        data: {
          ...sharedData,
          ...(row.id === firstRow.id ? { startTime: input.startTime } : {}),
          ...(row.id === lastRow.id ? { endTime: input.endTime } : {}),
        },
      })
    )
  );

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/student");
  revalidatePath("/instructor");
  return { success: true, items: updated.map(toRow) };
}

export async function createScheduleItem(
  weeklyScheduleId: string,
  input: ScheduleItemInput
): Promise<ScheduleItemActionResult> {
  await requireAdmin();
  const error = validate(input);
  if (error) return { success: false, error };

  const created = await prisma.scheduleItem.create({
    data: {
      weeklyScheduleId,
      date: parseDateKey(input.dateKey),
      startTime: input.startTime,
      endTime: input.endTime,
      title: input.title,
      description: input.description || null,
      groupName: input.groupName || null,
      instructorName: input.instructorName || null,
      location: input.location || null,
      // `?? null` preserves an explicit `false` (false is not nullish); only
      // null/undefined collapse to null. Data-only; not read by any filter yet.
      combinedParticipation: input.combinedParticipation ?? null,
    },
  });

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/student");
  revalidatePath("/instructor");
  return { success: true, item: toRow(created) };
}

// Only ever deletes the single ScheduleItem row - there is no relation
// between ScheduleItem and DutyAssignment in the schema, so existing duty
// assignments/publication/completion status are always preserved, never
// touched or regenerated by this action.
export async function deleteScheduleItem(itemId: string): Promise<ActionResult> {
  await requireAdmin();

  const existing = await prisma.scheduleItem.findUnique({ where: { id: itemId } });
  if (!existing) {
    return { success: false, error: NOT_FOUND_ERROR };
  }

  await prisma.scheduleItem.delete({ where: { id: itemId } });

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/student");
  revalidatePath("/instructor");
  return { success: true };
}
