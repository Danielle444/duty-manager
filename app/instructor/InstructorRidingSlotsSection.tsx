"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { RidingHistoryList } from "@/lib/components/RidingHistoryList";
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
import { groupByGroupAndSubgroup, STATUS_BADGE_CLASS } from "@/lib/attendance-ui";
import {
  getInstructorRidingSlots,
  getRidingSlotStudentNotes,
  getStudentRidingHistoryForInstructor,
  upsertRidingLessonNoteAsInstructor,
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
  return activity.ridingSlot?.assignments.some((a) => a.instructorId === instructorId) ?? false;
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
  onBack,
  onSaved,
}: {
  row: RidingSlotStudentRow;
  ridingSlotId: string;
  instructorId: string;
  canEdit: boolean;
  onBack: () => void;
  onSaved: (updated: RidingSlotStudentRow) => void;
}) {
  const [note, setNote] = useState(row.note ?? "");
  const [rating, setRating] = useState(row.ratingHalfPoints != null ? String(row.ratingHalfPoints) : "");
  const [sessionHorseName, setSessionHorseName] = useState(row.sessionHorseName ?? "");
  const [isEditingHorse, setIsEditingHorse] = useState(false);
  const [isSaving, startSaveTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setError(null);
    startSaveTransition(async () => {
      const ratingHalfPoints = rating ? Number(rating) : null;
      const result = await upsertRidingLessonNoteAsInstructor(instructorId, ridingSlotId, row.studentId, {
        note,
        ratingHalfPoints,
        sessionHorseName,
      });
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      onSaved({
        ...row,
        note: note.trim() || null,
        ratingHalfPoints,
        sessionHorseName: sessionHorseName.trim() || null,
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
            <input
              value={sessionHorseName}
              onChange={(e) => setSessionHorseName(e.target.value)}
              placeholder={getHorseDisplayInfo(row).horseNameDisplay}
              className="rounded-lg border border-border px-3 py-2 text-sm"
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
        setStudentsError("שגיאה בטעינת רשימת התלמידים. נסו לרענן.");
      });
  }

  function handleStudentSaved(updated: RidingSlotStudentRow) {
    setSlotStudents((prev) => (prev ? prev.map((s) => (s.studentId === updated.studentId ? updated : s)) : prev));
    setEditingStudent(null);
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

  const visibleDays = (days ?? [])
    .map((day) => ({
      ...day,
      activities: day.activities.filter(
        (a) => scopeMode === "all" || isAssignedToInstructor(a, instructorId)
      ),
    }))
    .filter((day) => day.activities.length > 0);

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
                      className={`rounded-xl border-2 border-border p-4 ${getScheduleGroupColorClass(
                        activity.groupName
                      )}`}
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
                              מדריך/ה: {a.instructorName ?? "לא נבחר"} · מגרש: {a.arena ?? "לא הוזן"}
                            </p>
                          ))}
                        </div>
                      )}

                      <div className="mt-2">
                        {activity.ridingSlot ? (
                          <Button
                            variant="secondary"
                            className="!px-2 !py-1 !text-xs"
                            onClick={() => openStudents(activity)}
                          >
                            צפייה בתלמידים
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
              onBack={() => setEditingStudent(null)}
              onSaved={handleStudentSaved}
            />
          ) : slotStudents === null ? (
            <p className="text-sm text-muted-foreground">טוען...</p>
          ) : slotStudents.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין תלמידים רלוונטיים לרכיבה זו</p>
          ) : (
            <div className="flex max-w-full flex-col gap-3 overflow-x-hidden">
              {groupByGroupAndSubgroup(slotStudents).map((section) => (
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
                    {section.subgroups.map((sub) => {
                      const assignment = findAssignmentForSection(
                        openAssignments,
                        section.groupName,
                        sub.subgroupNumber
                      );
                      return (
                        <div
                          key={sub.subgroupNumber ?? "__none__"}
                          className="rounded-lg border border-border bg-card p-2"
                        >
                          <p className="text-xs font-bold text-card-foreground">
                            {sub.subgroupNumber != null
                              ? `תת-קבוצה ${sub.subgroupNumber}`
                              : "ללא תת-קבוצה"}
                          </p>
                          <p className="mb-2 text-[11px] text-muted-foreground">
                            מאמן/ת: {assignment?.instructorName ?? "לא הוגדר"} · מגרש:{" "}
                            {assignment?.arena ?? "לא הוגדר"}
                          </p>
                          <div className="flex flex-col gap-1.5">
                            {sub.items.map((row) => (
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
                </div>
              ))}
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
