"use server";

import { prisma } from "@/lib/prisma";
import {
  dateKey,
  enumerateDateKeys,
  formatHebrewDate,
  formatHebrewWeekday,
  parseDateKey,
} from "@/lib/dates";
import {
  findAssignmentForStudent,
  getAssignmentInstructorNames,
  formatInstructorNames,
  type AssignmentForMatching,
} from "@/lib/riding-assignment-matching";
import {
  getPublishedComplexRidingPlansForStudentInternal,
  type PublishedComplexRidingPlanForStudent,
} from "@/lib/actions/riding-slot-complex-publications";

// Only the fields a student is allowed to see about their riding slot's
// instructor/field/subgroup - never notes, ratings, sessionHorseName, or
// history. Each field is independently null when its own visibility flag is
// off (or there's nothing to show), never a raw ScheduleItem fallback.
export interface ScheduleItemRidingInfo {
  instructorName: string | null;
  arena: string | null;
  subgroupLabel: string | null;
}

export interface ScheduleItemView {
  id: string;
  dateKey: string;
  dateLabel: string;
  dayLabel: string;
  startTime: string;
  endTime: string;
  title: string;
  description: string | null;
  groupName: string | null;
  instructorName: string | null;
  location: string | null;
  // Null for non-riding items, or for riding items where no field is
  // currently visible to students - the card should render no info box at
  // all in that case, not an empty one.
  ridingInfo: ScheduleItemRidingInfo | null;
  // RIDING-COMPLEX-PUBLICATION P7C - a separate field/variant from
  // ridingInfo above, never a replacement for it: simple-mode riding slots
  // (ridingInfo) and complex-mode riding slots (this field) are mutually
  // exclusive by construction (a RidingSlot has either a horseList or a
  // complexPlan, never both - see RidingSlotComplexPlan's own schema
  // comment), so a given item only ever populates one of the two. Non-null
  // only for a complex-mode riding slot that currently has a publication;
  // null for a simple-mode slot, a complex-mode slot with no publication
  // yet, and every non-riding item - never inferred from the live draft.
  publishedComplexRidingPlan: PublishedComplexRidingPlanForStudent | null;
}

type RidingSlotForStudentView = {
  showInstructorToStudents: boolean;
  showArenaToStudents: boolean;
  showSubgroupToStudents: boolean;
  assignments: AssignmentForMatching[];
};

// Resolves the same (group, subgroup) -> assignment fallback used by the
// instructor/admin riding views, then gates each field behind its own
// visibility flag - never behind whether the raw ScheduleItem fields happen
// to be set.
function buildRidingInfoForStudent(
  ridingSlot: RidingSlotForStudentView,
  groupName: string | null,
  subgroupNumber: number | null
): ScheduleItemRidingInfo | null {
  const assignment = findAssignmentForStudent(ridingSlot.assignments, groupName, subgroupNumber);

  // Multiple co-instructors are joined into one display string (e.g. "דנה,
  // יעל") - the field itself stays a plain string, so this needs no change
  // on the student-facing rendering side.
  const instructorNames = assignment ? getAssignmentInstructorNames(assignment) : [];
  const instructorName = ridingSlot.showInstructorToStudents ? formatInstructorNames(instructorNames) : null;
  const arena = ridingSlot.showArenaToStudents && assignment?.arena ? assignment.arena : null;
  const subgroupLabel =
    ridingSlot.showSubgroupToStudents && subgroupNumber != null ? `תת-קבוצה ${subgroupNumber}` : null;

  if (!instructorName && !arena && !subgroupLabel) return null;
  return { instructorName, arena, subgroupLabel };
}

export interface StudentScheduleResult {
  hasSchedule: boolean;
  weekName: string | null;
  items: ScheduleItemView[];
}

export type GroupFilter = "mine" | "both";

// dayKey: a specific date within the week, or "all" for the whole week.
export async function getScheduleForStudent(
  studentId: string,
  weeklyScheduleId: string,
  dayKey: string | "all",
  groupFilter: GroupFilter
): Promise<StudentScheduleResult> {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return { hasSchedule: false, weekName: null, items: [] };

  const week = await prisma.weeklySchedule.findUnique({
    where: { id: weeklyScheduleId },
    include: {
      items: {
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        include: {
          ridingSlotLink: {
            include: {
              ridingSlot: {
                include: {
                  assignments: {
                    include: {
                      instructor: true,
                      instructors: { include: { instructor: true }, orderBy: { createdAt: "asc" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  // Defense-in-depth: the student week picker already only offers published
  // weeks (see getWeeklyScheduleSelectionForStudent), but a stale/tampered
  // weeklyScheduleId must never leak an unpublished week's items either.
  if (!week || !week.isPublished) return { hasSchedule: false, weekName: null, items: [] };

  const items = week.items.filter((i) => {
    if (groupFilter === "mine" && i.groupName && i.groupName !== student.groupName) return false;
    if (dayKey !== "all" && dateKey(i.date) !== dayKey) return false;
    return true;
  });

  // RIDING-COMPLEX-PUBLICATION P7C - collected from the already-filtered
  // `items` only (never the raw, unfiltered week.items), so a ridingSlotId
  // this student shouldn't even see in "mine" scope is never sent onward
  // either. One batched call covers every riding-linked item in this
  // response, never one call per item - see
  // getPublishedComplexRidingPlansForStudentInternal's own comment for the
  // additional server-side "must belong to a published week" check it
  // performs regardless of what's passed here.
  const ridingSlotIds = Array.from(
    new Set(
      items
        .map((i) => i.ridingSlotLink?.ridingSlot?.id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const complexPlansByRidingSlotId = await getPublishedComplexRidingPlansForStudentInternal(
    studentId,
    ridingSlotIds
  );

  return {
    hasSchedule: true,
    weekName: week.name,
    items: items.map((i) => {
      const ridingSlot = i.ridingSlotLink?.ridingSlot ?? null;
      const ridingInfo = ridingSlot
        ? buildRidingInfoForStudent(ridingSlot, student.groupName, student.subgroupNumber)
        : null;
      return {
        id: i.id,
        dateKey: dateKey(i.date),
        dateLabel: formatHebrewDate(i.date),
        dayLabel: formatHebrewWeekday(i.date),
        startTime: i.startTime,
        endTime: i.endTime,
        title: i.title,
        description: i.description,
        groupName: i.groupName,
        // Riding-slot-linked items never fall back to the raw free-text
        // fields - a student only sees instructor/location for those via
        // ridingInfo, gated by the slot's own visibility flags.
        instructorName: ridingSlot ? null : i.instructorName,
        location: ridingSlot ? null : i.location,
        ridingInfo,
        publishedComplexRidingPlan: ridingSlot ? (complexPlansByRidingSlotId.get(ridingSlot.id) ?? null) : null,
      };
    }),
  };
}

export interface StudentDutyDayInfo {
  dateKey: string;
  dateLabel: string;
  dayLabel: string;
  assignmentId: string | null;
  dutyTypeName: string | null;
  dutyTypeDescription: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  // Other students published to the same duty type on the same date -
  // never includes the current student. Only populated when status is
  // "has-duty" (there's nothing to pair up on a day with no duty of ours).
  teammateNames: string[];
  // "no-duty-day": the date is marked in NoDutyDate - always wins over the
  // other statuses below, even if an assignment happens to still exist for
  // this student that day (it's preserved in the DB, just not shown as the
  // day's duty - see NoDutyDate's admin-facing docs for why one might exist).
  // "not-published": no published assignment exists for anyone on this date.
  // "no-duty": the day is published, this student just has no duty that day.
  // "has-duty": a published assignment exists for this student that day.
  status: "has-duty" | "no-duty" | "not-published" | "no-duty-day";
}

export async function getStudentDutiesForRange(
  studentId: string,
  startDateKey: string,
  endDateKey: string
): Promise<StudentDutyDayInfo[]> {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student || !student.isActive) return [];

  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);

  const [mine, publishedAll, noDutyDates] = await Promise.all([
    prisma.dutyAssignment.findMany({
      where: { studentId, date: { gte: start, lte: end }, isPublished: true },
      include: { dutyType: true },
    }),
    // Only published assignments, and only the fields needed to group
    // teammates by date + duty type - no instructor/admin-only data.
    prisma.dutyAssignment.findMany({
      where: { date: { gte: start, lte: end }, isPublished: true },
      select: {
        date: true,
        studentId: true,
        dutyTypeId: true,
        student: { select: { fullName: true } },
      },
    }),
    prisma.noDutyDate.findMany({ where: { date: { gte: start, lte: end } } }),
  ]);

  const mineByDate = new Map(mine.map((a) => [dateKey(a.date), a]));
  const publishedDates = new Set(publishedAll.map((a) => dateKey(a.date)));
  const noDutyDateKeys = new Set(noDutyDates.map((n) => dateKey(n.date)));

  const teammatesByDateAndDuty = new Map<string, string[]>();
  for (const a of publishedAll) {
    if (a.studentId === studentId) continue;
    const key = `${dateKey(a.date)}|${a.dutyTypeId}`;
    if (!teammatesByDateAndDuty.has(key)) teammatesByDateAndDuty.set(key, []);
    teammatesByDateAndDuty.get(key)!.push(a.student.fullName);
  }

  return enumerateDateKeys(start, end).map((dk) => {
    const date = parseDateKey(dk);
    const assignment = mineByDate.get(dk);
    const status: StudentDutyDayInfo["status"] = noDutyDateKeys.has(dk)
      ? "no-duty-day"
      : assignment
        ? "has-duty"
        : publishedDates.has(dk)
          ? "no-duty"
          : "not-published";
    const teammateNames = assignment
      ? teammatesByDateAndDuty.get(`${dk}|${assignment.dutyTypeId}`) ?? []
      : [];
    return {
      teammateNames,
      dateKey: dk,
      dateLabel: formatHebrewDate(date),
      dayLabel: formatHebrewWeekday(date),
      assignmentId: assignment?.id ?? null,
      dutyTypeName: assignment?.dutyType.name ?? null,
      dutyTypeDescription: assignment?.dutyType.description ?? null,
      isCompleted: assignment?.isCompleted ?? false,
      completedAt: assignment?.completedAt ? assignment.completedAt.toISOString() : null,
      status,
    };
  });
}
