"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { RidingHistoryList } from "@/lib/components/RidingHistoryList";
import { SuggestInput } from "@/lib/components/SuggestInput";
import { SearchableMultiSelect } from "@/lib/components/SearchableMultiSelect";
import {
  formatHebrewDate,
  formatHebrewDateTime,
  formatHebrewWeekday,
  getLocalDateKey,
  getWeekDateKeys,
  parseDateKey,
} from "@/lib/dates";
import { cleanScheduleTitle } from "@/lib/schedule-title";
import { getScheduleGroupColorClass } from "@/lib/schedule-group-colors";
import { getHorseDisplayInfo } from "@/lib/horse-info";
import { formatInstructorNames } from "@/lib/riding-assignment-matching";
import { groupByGroupAndSubgroup, STATUS_BADGE_CLASS, type GroupSection } from "@/lib/attendance-ui";
import {
  getInstructorRidingSlots,
  getRidingSlotStudentNotes,
  getStudentRidingHistoryForInstructor,
  upsertRidingLessonNoteAsInstructor,
  getKnownRidingLessonTopics,
  getKnownRidingHorseNames,
  type WeeklyRidingDay,
  type WeeklyRidingActivity,
  type RidingSlotStudentRow,
  type RidingSlotAssignmentRow,
  type StudentRidingHistoryResult,
} from "@/lib/actions/riding-slots";

type ViewMode = "day" | "week";
type ScopeMode = "mine" | "all";
type BrowseMode = "slot" | "student";

interface RidingStudentOption {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

// 1.0-5.0 in 0.5 steps, shown as ratingHalfPoints/2.
const RATING_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

function isAssignedToInstructor(activity: WeeklyRidingActivity, instructorId: string): boolean {
  return activity.ridingSlot?.assignments.some((a) => a.instructorIds.includes(instructorId)) ?? false;
}

// Finds the assignment responsible for a given group/subgroup section,
// falling back from an exact (group, subgroup) split to a whole-group split
// to a whole-slot split - mirrors the same fallback getRidingSlotStudentNotes
// uses server-side to decide which students belong to which split, just in
// reverse (section -> assignment instead of assignment -> students).
function findAssignmentForSection(
  assignments: RidingSlotAssignmentRow[],
  groupName: string | null,
  subgroupNumber: number | null
): RidingSlotAssignmentRow | null {
  const exact = assignments.find((a) => a.groupName === groupName && a.subgroupNumber === subgroupNumber);
  if (exact) return exact;
  const groupLevel = assignments.find((a) => a.groupName === groupName && a.subgroupNumber === null);
  if (groupLevel) return groupLevel;
  const wholeSlot = assignments.find((a) => a.groupName === null && a.subgroupNumber === null);
  return wholeSlot ?? null;
}

type AssignmentTier = "exact" | "group" | "none";

// Classifies the assignment resolved for this exact group/subgroup (via the
// same exact -> group-level -> whole-slot fallback above) by how specific
// it is, but only when it actually belongs to the given instructor:
// - "exact": a real per-subgroup assignment row (groupName + subgroupNumber
//   both set) assigned to this instructor - the strongest signal, since it
//   names this precise subgroup.
// - "group": a group-level row (groupName set, subgroupNumber null)
//   assigned to this instructor - applies to the whole group, not one
//   specific subgroup.
// - "none": no assignment resolved here belongs to this instructor, OR it
//   only resolved via a whole-slot (null/null) row - deliberately not
//   promoted, since a whole-slot assignment already covers every section
//   equally and shouldn't reorder anything.
function getInstructorAssignmentTier(
  assignments: RidingSlotAssignmentRow[],
  groupName: string | null,
  subgroupNumber: number | null,
  instructorId: string
): AssignmentTier {
  const assignment = findAssignmentForSection(assignments, groupName, subgroupNumber);
  if (!assignment || !assignment.instructorIds.includes(instructorId)) return "none";
  if (assignment.groupName !== null && assignment.subgroupNumber !== null) return "exact";
  if (assignment.groupName !== null && assignment.subgroupNumber === null) return "group";
  return "none";
}

interface FlatStudentSection<T> {
  groupName: string | null;
  subgroupNumber: number | null;
  items: T[];
}

// Flattens groupByGroupAndSubgroup's nested group -> subgroups shape into
// one subgroup-per-entry list, in the exact same order (group alpha, then
// subgroup numeric) - the baseline order before any instructor-priority
// reordering runs.
function flattenGroupSections<T>(sections: GroupSection<T>[]): FlatStudentSection<T>[] {
  const flat: FlatStudentSection<T>[] = [];
  for (const section of sections) {
    for (const sub of section.subgroups) {
      flat.push({ groupName: section.groupName, subgroupNumber: sub.subgroupNumber, items: sub.items });
    }
  }
  return flat;
}

// Moves the current instructor's own subgroup section(s) to the very top -
// not just their parent group - so an instructor assigned to "קבוצה א /
// תת-קבוצה 2" sees that exact section first, even ahead of "קבוצה א /
// תת-קבוצה 1". A three-bucket stable sort: exact-assigned subgroups first,
// then other subgroups within a group-level-assigned group, then
// everything else untouched - each bucket keeps its own original relative
// order. A whole-slot assignment (or no assignment at all) puts every
// section in the "none" bucket, so nothing moves.
function sortFlatSectionsForInstructor<T>(
  flatSections: FlatStudentSection<T>[],
  assignments: RidingSlotAssignmentRow[],
  instructorId: string
): (FlatStudentSection<T> & { tier: AssignmentTier })[] {
  const withTier = flatSections.map((section) => ({
    ...section,
    tier: getInstructorAssignmentTier(assignments, section.groupName, section.subgroupNumber, instructorId),
  }));
  const exact = withTier.filter((s) => s.tier === "exact");
  const group = withTier.filter((s) => s.tier === "group");
  const none = withTier.filter((s) => s.tier === "none");
  return [...exact, ...group, ...none];
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// Sorts one day's activities so, for today only, whatever hasn't finished
// yet (endTime after now) leads chronologically, followed by whatever
// already ended earlier today, also chronological - any other day is
// either entirely future or entirely past already, so its own order is
// left as-is.
function sortActivitiesForDisplay(
  activities: WeeklyRidingActivity[],
  isToday: boolean,
  nowMinutes: number
): WeeklyRidingActivity[] {
  if (!isToday) {
    return [...activities].sort((a, b) => a.startTime.localeCompare(b.startTime));
  }
  const upcoming = activities
    .filter((a) => timeToMinutes(a.endTime) > nowMinutes)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const past = activities
    .filter((a) => timeToMinutes(a.endTime) <= nowMinutes)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  return [...upcoming, ...past];
}

// A day still counts as "upcoming" if it's strictly in the future, or it's
// today and at least one of today's (already scope/assignment-filtered)
// activities hasn't finished yet - so once today's last ride ends, today
// drops behind tomorrow instead of still blocking the top of the list.
function isDayUpcoming(day: WeeklyRidingDay, todayKey: string, nowMinutes: number): boolean {
  if (day.dateKey > todayKey) return true;
  if (day.dateKey < todayKey) return false;
  return day.activities.some((a) => timeToMinutes(a.endTime) > nowMinutes);
}

// Orders day sections so the nearest upcoming day (today, if it still has
// something left, otherwise the next future day) comes first, continuing
// chronologically into the future; fully-past days are pushed to the end,
// closest (most recent) first - so a week view that's entirely in the past
// still opens on the most recent day instead of the oldest one.
function sortDaysForDisplay(
  days: WeeklyRidingDay[],
  todayKey: string,
  nowMinutes: number
): WeeklyRidingDay[] {
  const upcoming = days
    .filter((d) => isDayUpcoming(d, todayKey, nowMinutes))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const past = days
    .filter((d) => !isDayUpcoming(d, todayKey, nowMinutes))
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  return [...upcoming, ...past];
}

// A session-specific horse (this riding slot/student only) always wins over
// the student's normal horse - never written back to Student itself.
function resolvedHorseLine(row: { sessionHorseName: string | null } & Parameters<typeof getHorseDisplayInfo>[0]): string {
  const sessionHorse = row.sessionHorseName?.trim();
  if (sessionHorse) return `סוס בשיעור: ${sessionHorse}`;
  return `סוס: ${getHorseDisplayInfo(row).horseNameDisplay}`;
}

// One compact line per student - name, horse, and small rating/note badges.
// Deliberately no editor here, even when canEdit is true: the list must
// stay scannable regardless of permission, and only one student's full
// editor opens at a time (see StudentEditor below). Group/subgroup badges
// are intentionally omitted here since the surrounding section header
// already shows them.
function StudentCompactRow({
  row,
  canEdit,
  onOpen,
}: {
  row: RidingSlotStudentRow;
  canEdit: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full flex-col gap-1 rounded-lg border p-2.5 text-right hover:bg-muted ${
        row.attendanceStatus === "ABSENT" ? "border-danger/40 bg-danger-muted/30" : "border-border bg-card"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-card-foreground">
          {row.studentName}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {canEdit ? "עריכה ›" : "צפייה ›"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="max-w-full truncate">{resolvedHorseLine(row)}</span>
        {row.ratingHalfPoints != null && (
          <span className="shrink-0 rounded-full bg-success-muted px-1.5 py-0.5 text-[10px] font-medium text-success">
            {row.ratingHalfPoints / 2}
          </span>
        )}
        {row.note && (
          <span
            title="קיימת הערת רכיבה"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-secondary-foreground"
          />
        )}
        {row.attendanceStatus === "ABSENT" && (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE_CLASS.ABSENT}`}
          >
            נעדר/ת היום
          </span>
        )}
        {row.attendanceStatus === "PARTIAL" && (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE_CLASS.PARTIAL}`}
          >
            נוכחות חלקית
          </span>
        )}
        {row.attendanceNotes && (
          <span
            title="קיימת הערת נוכחות"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
          />
        )}
      </div>
      {row.attendanceStatus === "PARTIAL" && (row.attendanceArrivalTime || row.attendanceDepartureTime) && (
        <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
          {row.attendanceArrivalTime && <span>הגעה: {row.attendanceArrivalTime}</span>}
          {row.attendanceDepartureTime && <span>יציאה: {row.attendanceDepartureTime}</span>}
        </div>
      )}
    </button>
  );
}

// Full note/rating detail for exactly one student - opened from a compact
// row, never rendered for every student at once. The session-horse input
// stays collapsed behind its own small button so the default view is just
// the resolved horse line, note, and rating - not a busy form up front.
function StudentEditor({
  row,
  ridingSlotId,
  instructorId,
  canEdit,
  students,
  knownLessonTopics,
  knownHorseNames,
  onBack,
  onSaved,
}: {
  row: RidingSlotStudentRow;
  ridingSlotId: string;
  instructorId: string;
  canEdit: boolean;
  students: RidingStudentOption[];
  knownLessonTopics: string[];
  knownHorseNames: string[];
  onBack: () => void;
  onSaved: (updated: RidingSlotStudentRow) => void;
}) {
  const [note, setNote] = useState(row.note ?? "");
  const [rating, setRating] = useState(row.ratingHalfPoints != null ? String(row.ratingHalfPoints) : "");
  const [sessionHorseName, setSessionHorseName] = useState(row.sessionHorseName ?? "");
  const [isEditingHorse, setIsEditingHorse] = useState(false);
  const [lessonTopic, setLessonTopic] = useState(row.lessonTopic ?? "");
  const [taughtStudentIds, setTaughtStudentIds] = useState(row.taughtStudents.map((s) => s.id));
  const [isSaving, startSaveTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // A trainee can't be recorded as teaching themselves - excluded from the
  // "who did they teach" options rather than left selectable-but-nonsensical.
  const taughtStudentOptions = useMemo(
    () =>
      students
        .filter((s) => s.id !== row.studentId)
        .map((s) => ({ value: s.id, label: s.fullName })),
    [students, row.studentId]
  );

  function handleSave() {
    setError(null);
    startSaveTransition(async () => {
      const ratingHalfPoints = rating ? Number(rating) : null;
      const result = await upsertRidingLessonNoteAsInstructor(instructorId, ridingSlotId, row.studentId, {
        note,
        ratingHalfPoints,
        sessionHorseName,
        lessonTopic,
        taughtStudentIds,
      });
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      const taughtStudents = students
        .filter((s) => taughtStudentIds.includes(s.id))
        .map((s) => ({ id: s.id, fullName: s.fullName }));
      onSaved({
        ...row,
        note: note.trim() || null,
        ratingHalfPoints,
        sessionHorseName: sessionHorseName.trim() || null,
        lessonTopic: lessonTopic.trim() || null,
        taughtStudents,
        updatedByName: result.updatedByName ?? row.updatedByName,
        updatedAt: result.updatedAt ?? row.updatedAt,
      });
      setIsEditingHorse(false);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-muted-foreground underline"
      >
        › חזרה לרשימה
      </button>

      <div>
        <p className="font-semibold text-card-foreground">{row.studentName}</p>
        <p className="text-xs text-muted-foreground">
          {row.groupName ? `קבוצה ${row.groupName}` : "ללא קבוצה"}
          {row.subgroupNumber != null ? ` / תת-קבוצה ${row.subgroupNumber}` : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          {resolvedHorseLine({ ...row, sessionHorseName })}
        </p>
        {(row.updatedByName || row.updatedAt) && (
          <p className="mt-1 text-xs text-muted-foreground">
            {row.updatedByName && `עודכן על ידי: ${row.updatedByName}`}
            {row.updatedByName && row.updatedAt && " · "}
            {row.updatedAt && `עודכן בתאריך: ${formatHebrewDateTime(new Date(row.updatedAt))}`}
          </p>
        )}
      </div>

      {(row.attendanceStatus === "ABSENT" || row.attendanceStatus === "PARTIAL" || row.attendanceNotes) && (
        <div className="rounded-lg border border-border p-2.5">
          {row.attendanceStatus === "ABSENT" && (
            <p className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS.ABSENT}`}>
              נעדר/ת היום
            </p>
          )}
          {row.attendanceStatus === "PARTIAL" && (
            <p className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS.PARTIAL}`}>
              נוכחות חלקית
            </p>
          )}
          {(row.attendanceArrivalTime || row.attendanceDepartureTime) && (
            <p className="mt-1 text-xs text-muted-foreground">
              {row.attendanceArrivalTime && `הגעה: ${row.attendanceArrivalTime}`}
              {row.attendanceArrivalTime && row.attendanceDepartureTime && " · "}
              {row.attendanceDepartureTime && `יציאה: ${row.attendanceDepartureTime}`}
            </p>
          )}
          {row.attendanceNotes && (
            <p className="mt-1 text-xs text-card-foreground">הערת נוכחות: {row.attendanceNotes}</p>
          )}
        </div>
      )}

      {canEdit && !isEditingHorse && (
        <button
          type="button"
          onClick={() => setIsEditingHorse(true)}
          className="self-start text-xs text-muted-foreground underline decoration-dotted"
        >
          עריכת סוס בשיעור
        </button>
      )}

      {canEdit && isEditingHorse && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
          <label className="flex flex-col gap-1 text-sm">
            סוס בשיעור זה (לא משנה את השיוך הרגיל)
            <SuggestInput
              value={sessionHorseName}
              onChange={setSessionHorseName}
              suggestions={knownHorseNames}
              placeholder={getHorseDisplayInfo(row).horseNameDisplay}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {sessionHorseName && (
              <button
                type="button"
                onClick={() => setSessionHorseName("")}
                className="text-xs text-muted-foreground underline"
              >
                נקה שינוי - חזרה לסוס הרגיל
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsEditingHorse(false)}
              className="text-xs text-muted-foreground underline"
            >
              סגירה
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            השינוי נשמר יחד עם ההערה/דירוג בלחיצה על &quot;שמירה&quot; למטה.
          </p>
        </div>
      )}

      {canEdit ? (
        <>
          <label className="flex flex-col gap-1 text-sm">
            הערת רכיבה
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            דירוג
            <select
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              className="w-32 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <option value="">ללא</option>
              {RATING_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v / 2}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            נושא השיעור
            <SuggestInput
              value={lessonTopic}
              onChange={setLessonTopic}
              suggestions={knownLessonTopics}
              placeholder="לדוגמה: מעברים"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            את מי החניך/ה הדריך/ה
            <SearchableMultiSelect
              values={taughtStudentIds}
              options={taughtStudentOptions}
              onChange={setTaughtStudentIds}
              placeholder="לא הדריך/ה אף אחד"
              searchPlaceholder="הקלידו שם..."
              emptyMessage="לא נמצאו חניכים"
            />
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onBack}>
              ביטול
            </Button>
            <Button type="button" disabled={isSaving} onClick={handleSave}>
              {isSaving ? "שומר..." : "שמירה"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">הערת רכיבה: {row.note ?? "אין הערה"}</p>
          <p className="text-sm text-muted-foreground">
            דירוג: {row.ratingHalfPoints != null ? row.ratingHalfPoints / 2 : "ללא"}
          </p>
          <p className="text-sm text-muted-foreground">נושא השיעור: {row.lessonTopic ?? "אין"}</p>
          <p className="text-sm text-muted-foreground">
            הדריך/ה:{" "}
            {row.taughtStudents.length > 0 ? row.taughtStudents.map((s) => s.fullName).join(", ") : "אין"}
          </p>
        </>
      )}
    </div>
  );
}

export function InstructorRidingSlotsSection({
  instructorId,
  canEdit,
  students,
}: {
  instructorId: string;
  canEdit: boolean;
  students: RidingStudentOption[];
}) {
  const [browseMode, setBrowseMode] = useState<BrowseMode>("slot");
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("mine");
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateKey());
  const [days, setDays] = useState<WeeklyRidingDay[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [openActivity, setOpenActivity] = useState<WeeklyRidingActivity | null>(null);
  const [slotStudents, setSlotStudents] = useState<RidingSlotStudentRow[] | null>(null);
  const [studentsError, setStudentsError] = useState<string | null>(null);
  const [editingStudent, setEditingStudent] = useState<RidingSlotStudentRow | null>(null);

  const [studentSearch, setStudentSearch] = useState("");
  const [historyStudentId, setHistoryStudentId] = useState<string | null>(null);
  const [historyResult, setHistoryResult] = useState<StudentRidingHistoryResult | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Loaded once at the section level (not per student row) and passed down
  // to StudentEditor - same "load once, reuse" convention as
  // HorseFeedingSection's loadKnownValues. Only editors ever open the form
  // that uses these, so there's nothing to fetch for a view-only instructor.
  const [knownLessonTopics, setKnownLessonTopics] = useState<string[]>([]);
  const [knownHorseNames, setKnownHorseNames] = useState<string[]>([]);

  function loadKnownValues() {
    if (!canEdit) return;
    getKnownRidingLessonTopics().then(setKnownLessonTopics);
    getKnownRidingHorseNames().then(setKnownHorseNames);
  }

  useEffect(() => {
    loadKnownValues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  const rangeKeys = viewMode === "day" ? [selectedDate] : getWeekDateKeys(selectedDate);
  const rangeStart = rangeKeys[0] ?? selectedDate;
  const rangeEnd = rangeKeys[rangeKeys.length - 1] ?? selectedDate;

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadError(null);
    setDays(null);
    getInstructorRidingSlots(rangeStart, rangeEnd)
      .then((r) => {
        if (cancelled) return;
        setDays(r);
      })
      .catch(() => {
        if (cancelled) return;
        setDays([]);
        setLoadError("שגיאה בטעינת רכיבות. נסו לרענן.");
      });
    return () => {
      cancelled = true;
    };
  }, [rangeStart, rangeEnd]);

  function openStudents(activity: WeeklyRidingActivity) {
    if (!activity.ridingSlot) return;
    setOpenActivity(activity);
    setSlotStudents(null);
    setStudentsError(null);
    setEditingStudent(null);
    getRidingSlotStudentNotes(activity.ridingSlot.id)
      .then((rows) => setSlotStudents(rows))
      .catch(() => {
        setSlotStudents([]);
        setStudentsError("שגיאה בטעינת רשימת החניכים. נסו לרענן.");
      });
  }

  function handleStudentSaved(updated: RidingSlotStudentRow) {
    setSlotStudents((prev) => (prev ? prev.map((s) => (s.studentId === updated.studentId ? updated : s)) : prev));
    setEditingStudent(null);
    // A newly-typed lesson topic/horse name only becomes a suggestion for
    // the *next* student once this refetches - same reasoning as
    // HorseFeedingSection's post-save loadKnownValues() call.
    loadKnownValues();
  }

  function openHistory(studentId: string) {
    setHistoryStudentId(studentId);
    setHistoryResult(null);
    setHistoryError(null);
    getStudentRidingHistoryForInstructor(studentId)
      .then((r) => setHistoryResult(r))
      .catch(() => setHistoryError("שגיאה בטעינת היסטוריית הרכיבה. נסו לרענן."));
  }

  const filteredStudents = students.filter((s) =>
    s.fullName.toLowerCase().includes(studentSearch.trim().toLowerCase())
  );

  const todayKey = getLocalDateKey();
  const nowMinutes = (() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  })();

  const visibleDays = sortDaysForDisplay(
    (days ?? [])
      .map((day) => ({
        ...day,
        activities: sortActivitiesForDisplay(
          day.activities.filter((a) => scopeMode === "all" || isAssignedToInstructor(a, instructorId)),
          day.dateKey === todayKey,
          nowMinutes
        ),
      }))
      .filter((day) => day.activities.length > 0),
    todayKey,
    nowMinutes
  );

  const openAssignments = openActivity?.ridingSlot?.assignments ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 text-sm">
        עיון
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setBrowseMode("slot")}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              browseMode === "slot"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            לפי רכיבה
          </button>
          <button
            type="button"
            onClick={() => setBrowseMode("student")}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              browseMode === "student"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            לפי חניך
          </button>
        </div>
      </div>

      {browseMode === "student" ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            חיפוש חניך/ה
            <input
              type="text"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder="הקלידו שם..."
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>

          {filteredStudents.length === 0 ? (
            <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              לא נמצאו חניכים תואמים
            </p>
          ) : (
            <div className="flex max-w-full flex-col gap-3 overflow-x-hidden">
              {groupByGroupAndSubgroup(filteredStudents).map((section) => (
                <div
                  key={section.groupName ?? "__none__"}
                  className={`rounded-xl border-2 border-border p-3 ${getScheduleGroupColorClass(
                    section.groupName
                  )}`}
                >
                  <p className="mb-2 text-sm font-bold text-card-foreground">
                    {section.groupName ? `קבוצה ${section.groupName}` : "ללא קבוצה"}
                  </p>
                  <div className="flex flex-col gap-2">
                    {section.subgroups.map((sub) => (
                      <div
                        key={sub.subgroupNumber ?? "__none__"}
                        className="rounded-lg border border-border bg-card p-2"
                      >
                        <p className="mb-2 text-xs font-bold text-card-foreground">
                          {sub.subgroupNumber != null
                            ? `תת-קבוצה ${sub.subgroupNumber}`
                            : "ללא תת-קבוצה"}
                        </p>
                        <div className="flex flex-col gap-1.5">
                          {sub.items.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => openHistory(s.id)}
                              className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card p-2.5 text-right hover:bg-muted"
                            >
                              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-card-foreground">
                                {s.fullName}
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground">היסטוריה ›</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-1 text-sm">
          תצוגה
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setViewMode("day")}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                viewMode === "day"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              יום
            </button>
            <button
              type="button"
              onClick={() => setViewMode("week")}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                viewMode === "week"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              שבוע
            </button>
          </div>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          תאריך
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        <div className="flex flex-col gap-1 text-sm">
          היקף
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setScopeMode("mine")}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                scopeMode === "mine"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              הרכיבות שלי
            </button>
            <button
              type="button"
              onClick={() => setScopeMode("all")}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                scopeMode === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              כל הרכיבות
            </button>
          </div>
        </div>
        {!canEdit && (
          <p className="text-xs text-muted-foreground">תצוגה בלבד - אין הרשאת עריכת הערות רכיבה</p>
        )}
      </div>

      {loadError && <p className="rounded-lg bg-danger-muted p-3 text-sm text-danger">{loadError}</p>}

      {days === null ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          טוען...
        </p>
      ) : visibleDays.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          אין רכיבות מוגדרות להצגה
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {visibleDays.map((day) => (
            <div key={day.dateKey} className="rounded-2xl border border-border bg-card p-5">
              <p className="mb-3 inline-block rounded-lg bg-secondary px-3 py-2 text-base font-bold text-secondary-foreground">
                {formatHebrewWeekday(parseDateKey(day.dateKey))} ·{" "}
                {formatHebrewDate(parseDateKey(day.dateKey))}
              </p>
              <div className="flex flex-col gap-3">
                {day.activities.map((activity) => {
                  const assignedToMe = isAssignedToInstructor(activity, instructorId);
                  return (
                    <div
                      key={activity.scheduleItemIds.join("+")}
                      // The whole card opens the same "צפייה בחניכים" modal -
                      // the button below is kept for discoverability/keyboard
                      // access, but on mobile the button alone was too small
                      // a target. Only clickable once a ridingSlot exists
                      // (openStudents itself already no-ops otherwise), so an
                      // unconfigured slot's card never shows a false
                      // clickable affordance.
                      onClick={activity.ridingSlot ? () => openStudents(activity) : undefined}
                      className={`rounded-xl border-2 border-border p-4 ${getScheduleGroupColorClass(
                        activity.groupName
                      )} ${activity.ridingSlot ? "cursor-pointer active:bg-black/5" : ""}`}
                    >
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
                        <span className="font-semibold text-card-foreground">
                          {activity.startTime}-{activity.endTime}
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {activity.groupName ? `קבוצה ${activity.groupName}` : "שתי הקבוצות"}
                          </span>
                          {assignedToMe && (
                            <span className="rounded-full bg-success-muted px-2 py-0.5 text-xs text-success">
                              משובץ/ת אליי
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-lg font-bold text-card-foreground">
                        {cleanScheduleTitle(activity.title)}
                      </p>

                      {activity.ridingSlot && activity.ridingSlot.assignments.length > 0 && (
                        <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                          {activity.ridingSlot.assignments.map((a) => (
                            <p key={a.id}>
                              {a.groupName ? `קבוצה ${a.groupName}` : "כל הרכיבה"}
                              {a.subgroupNumber != null ? ` / תת-קבוצה ${a.subgroupNumber}` : ""} -
                              מדריך/ה: {formatInstructorNames(a.instructors.map((i) => i.fullName)) ?? "לא נבחר"} ·
                              מגרש: {a.arena ?? "לא הוזן"}
                            </p>
                          ))}
                        </div>
                      )}

                      <div className="mt-2">
                        {activity.ridingSlot ? (
                          <Button
                            variant="secondary"
                            className="!px-2 !py-1 !text-xs"
                            onClick={(e) => {
                              // Stops the click from also bubbling to the
                              // card's own onClick above, which would
                              // otherwise call openStudents twice for one tap.
                              e.stopPropagation();
                              openStudents(activity);
                            }}
                          >
                            צפייה בחניכים
                          </Button>
                        ) : (
                          <p className="text-xs italic text-muted-foreground">
                            רכיבה זו טרם הוגדרה ע&quot;י המנהל/ת
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={openActivity !== null}
        title={openActivity ? cleanScheduleTitle(openActivity.title) : "רכיבה"}
        onClose={() => {
          setOpenActivity(null);
          setSlotStudents(null);
          setEditingStudent(null);
        }}
      >
        <div className="flex max-h-[70vh] flex-col overflow-y-auto ps-1">
          {studentsError && <p className="mb-2 text-sm text-danger">{studentsError}</p>}
          {editingStudent ? (
            <StudentEditor
              row={editingStudent}
              ridingSlotId={openActivity!.ridingSlot!.id}
              instructorId={instructorId}
              canEdit={canEdit}
              students={students}
              knownLessonTopics={knownLessonTopics}
              knownHorseNames={knownHorseNames}
              onBack={() => setEditingStudent(null)}
              onSaved={handleStudentSaved}
            />
          ) : slotStudents === null ? (
            <p className="text-sm text-muted-foreground">טוען...</p>
          ) : slotStudents.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין חניכים רלוונטיים לרכיבה זו</p>
          ) : (
            <div className="flex max-w-full flex-col gap-3 overflow-x-hidden">
              {sortFlatSectionsForInstructor(
                flattenGroupSections(groupByGroupAndSubgroup(slotStudents)),
                openAssignments,
                instructorId
              ).map((section) => {
                const assignment = findAssignmentForSection(
                  openAssignments,
                  section.groupName,
                  section.subgroupNumber
                );
                return (
                  <div
                    key={`${section.groupName ?? "__none__"}-${section.subgroupNumber ?? "__none__"}`}
                    className={`rounded-xl border-2 border-border p-3 ${getScheduleGroupColorClass(
                      section.groupName
                    )}`}
                  >
                    <p className="mb-2 flex flex-wrap items-center gap-1.5 text-xs font-bold text-card-foreground">
                      {section.groupName ? `קבוצה ${section.groupName}` : "ללא קבוצה"}
                      {" · "}
                      {section.subgroupNumber != null
                        ? `תת-קבוצה ${section.subgroupNumber}`
                        : "ללא תת-קבוצה"}
                      {section.tier !== "none" && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          הקבוצה שלך
                        </span>
                      )}
                    </p>
                    <p className="mb-2 text-[11px] text-muted-foreground">
                      מאמן/ת:{" "}
                      {(assignment && formatInstructorNames(assignment.instructors.map((i) => i.fullName))) ??
                        "לא הוגדר"}{" "}
                      · מגרש: {assignment?.arena ?? "לא הוגדר"}
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {section.items.map((row) => (
                        <StudentCompactRow
                          key={row.studentId}
                          row={row}
                          canEdit={canEdit}
                          onOpen={() => setEditingStudent(row)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>
        </>
      )}

      <Modal
        open={historyStudentId !== null}
        title={historyResult ? `היסטוריית רכיבה - ${historyResult.student.fullName}` : "היסטוריית רכיבה"}
        onClose={() => {
          setHistoryStudentId(null);
          setHistoryResult(null);
          setHistoryError(null);
        }}
      >
        <div className="flex max-h-[70vh] max-w-full flex-col gap-3 overflow-y-auto overflow-x-hidden ps-1">
          {historyError && <p className="text-sm text-danger">{historyError}</p>}
          {!historyError && historyResult === null ? (
            <p className="text-sm text-muted-foreground">טוען...</p>
          ) : historyResult ? (
            <>
              <p className="text-xs text-muted-foreground">
                {historyResult.student.groupName ? `קבוצה ${historyResult.student.groupName}` : "ללא קבוצה"}
                {historyResult.student.subgroupNumber != null
                  ? ` / תת-קבוצה ${historyResult.student.subgroupNumber}`
                  : ""}{" "}
                · סוס: {historyResult.student.horseNameDisplay}
              </p>

              <RidingHistoryList rows={historyResult.rows} />
            </>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
