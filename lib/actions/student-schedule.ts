"use server";

import { prisma } from "@/lib/prisma";
import {
  dateKey,
  enumerateDateKeys,
  formatHebrewDate,
  formatHebrewWeekday,
  parseDateKey,
} from "@/lib/dates";

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
    include: { items: { orderBy: [{ date: "asc" }, { startTime: "asc" }] } },
  });
  if (!week) return { hasSchedule: false, weekName: null, items: [] };

  const items = week.items.filter((i) => {
    if (groupFilter === "mine" && i.groupName && i.groupName !== student.groupName) return false;
    if (dayKey !== "all" && dateKey(i.date) !== dayKey) return false;
    return true;
  });

  return {
    hasSchedule: true,
    weekName: week.name,
    items: items.map((i) => ({
      id: i.id,
      dateKey: dateKey(i.date),
      dateLabel: formatHebrewDate(i.date),
      dayLabel: formatHebrewWeekday(i.date),
      startTime: i.startTime,
      endTime: i.endTime,
      title: i.title,
      description: i.description,
      groupName: i.groupName,
      instructorName: i.instructorName,
      location: i.location,
    })),
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
