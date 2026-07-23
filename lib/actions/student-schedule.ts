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
// LEVEL 2 SLICE S1A - server-derived trainee course context for the final read.
import { resolveTraineeCourseOffering } from "@/lib/course/actor-course-offering";
import { getEffectiveCapabilities } from "@/lib/course/capabilities/offering-capabilities";
import {
  authorizeTraineeWeekReadWithDeps,
  TRAINEE_WEEK_META_SELECT,
} from "@/lib/course/course-scoped-week-options-core";

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
  // True when this is a complex-mode riding slot - i.e. its RidingSlot has a
  // complexPlan relation. Presence of that row IS the canonical complex
  // signal (see RidingSlotComplexPlan's schema comment); never inferred from
  // the item title or from publication state (an unpublished complex slot is
  // still complex). Always false for non-riding items and simple-mode riding
  // slots. Drives the student-facing title ("תרגול הדרכה" vs "רכיבה") and the
  // suppression of ridingInfo below.
  isComplex: boolean;
  // Null for non-riding items, for a complex-mode riding slot (its
  // coach/arena come only from the published complex plan below, never from
  // the generic assignment box - see the isComplex suppression in the
  // mapper), or for a simple-mode riding slot where no field is currently
  // visible to students - the card should render no info box at all in that
  // case, not an empty one.
  ridingInfo: ScheduleItemRidingInfo | null;
  // RIDING-COMPLEX-PUBLICATION P7C - a separate field/variant from ridingInfo
  // above, never a replacement for it. For a complex-mode slot, ridingInfo is
  // suppressed (null) and coach/arena come only from here; for a simple-mode
  // slot this stays null and coach/arena come only from ridingInfo - so the
  // two never both populate for one item. (This non-overlap is enforced by
  // the isComplex suppression in the mapper, not by storage shape: a
  // RidingSlot's independent RidingSlotAssignment rows would otherwise still
  // build a generic ridingInfo for a complex slot, which is exactly the
  // duplicate this suppression prevents.) Non-null only for a complex-mode
  // riding slot that currently has a publication; null for a simple-mode
  // slot, a complex-mode slot with no publication yet, and every non-riding
  // item - never inferred from the live draft.
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

// The single, uniform "you get nothing" result. Every denial - unknown student,
// unresolvable course context, SCHEDULE not ENABLED, missing week, NULL-scoped
// week, another course's week, unpublished week - returns exactly this, so none
// of those cases is distinguishable to the caller and a week id can never be
// probed across courses.
function emptyStudentScheduleResult(): StudentScheduleResult {
  return { hasSchedule: false, weekName: null, items: [] };
}

// dayKey: a specific date within the week, or "all" for the whole week.
//
// LEVEL 2 SLICE S1A - COURSE-SCOPED. The signature is deliberately UNCHANGED
// (four parameters, no courseOfferingId): the trainee's course context is
// resolved server-side from the signed session via the committed, no-argument
// resolveTraineeCourseOffering(), so there is no parameter through which a
// client could name a course, and no group/subgroup/name/level/date heuristic
// and no Level 1 fallback is used.
//
// A raw weeklyScheduleId is NEVER authorization. This action is independently
// invocable as a Server Action, so it must never assume the id came from the
// filtered picker (getWeeklyScheduleSelectionForTrainee): the id is re-checked
// here against the freshly resolved offering, and ScheduleItems are read ONLY
// after that check passes.
export async function getScheduleForStudent(
  studentId: string,
  weeklyScheduleId: string,
  dayKey: string | "all",
  groupFilter: GroupFilter
): Promise<StudentScheduleResult> {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return emptyStudentScheduleResult();

  // Course gate. Resolves the trainee offering INDEPENDENTLY of the week picker
  // (nothing is carried over from that call, by prop or by argument), requires
  // SCHEDULE === "ENABLED" for that exact offering, then fetches ONLY the week
  // header and verifies: exists -> courseOfferingId non-NULL -> strictly equal
  // to the resolved offering -> published. The pre-existing publication guard is
  // preserved inside that predicate, not dropped. See the pure core for the
  // full ordering contract and the fail-closed rules.
  const authorization = await authorizeTraineeWeekReadWithDeps(weeklyScheduleId, {
    resolveTraineeCourseOffering,
    getEffectiveCapabilities,
    fetchWeekMeta: (id) =>
      prisma.weeklySchedule.findUnique({ where: { id }, select: TRAINEE_WEEK_META_SELECT }),
  });
  if (!authorization.authorized) return emptyStudentScheduleResult();
  const week = authorization.week;

  // Authorized only. The items read is a SEPARATE query issued after the gate -
  // never a nested include on the header fetch above - so no ScheduleItem and no
  // nested riding/complex-plan row is ever loaded for a week this trainee may
  // not see. The include shape is unchanged from before S1A.
  const weekItems = await prisma.scheduleItem.findMany({
    where: { weeklyScheduleId },
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
              // Relation presence only - the canonical complex signal.
              // Selecting just `id` keeps it to a presence check.
              complexPlan: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  const items = weekItems.filter((i) => {
    if (groupFilter === "mine" && i.groupName && i.groupName !== student.groupName) return false;
    if (dayKey !== "all" && dateKey(i.date) !== dayKey) return false;
    return true;
  });

  // RIDING-COMPLEX-PUBLICATION P7C - collected from the already-filtered
  // `items` only (never the raw, unfiltered weekItems), so a ridingSlotId
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
      // Canonical complex signal: presence of the complexPlan relation, never
      // the title text or publication state (an unpublished complex slot is
      // still complex).
      const isComplex = ridingSlot?.complexPlan != null;
      // Single data-layer choke point: a complex slot never carries the
      // generic assignment coach/arena box - that info comes only from its
      // published complex plan, so building ridingInfo here would double it.
      const ridingInfo =
        ridingSlot && !isComplex
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
        isComplex,
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
