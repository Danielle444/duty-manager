"use client";

import { useEffect, useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { RidingHistoryList } from "@/lib/components/RidingHistoryList";
import {
  formatHebrewDate,
  formatHebrewWeekday,
  getLocalDateKey,
  getWeekDateKeys,
  parseDateKey,
} from "@/lib/dates";
import { cleanScheduleTitle } from "@/lib/schedule-title";
import { getScheduleGroupColorClass } from "@/lib/schedule-group-colors";
import { formatInstructorNames } from "@/lib/riding-assignment-matching";
import { groupByGroupAndSubgroup } from "@/lib/attendance-ui";
import { RidingHorseListEditor } from "@/lib/components/RidingHorseListEditor";
import { RidingComplexPlanEditor } from "@/lib/components/RidingComplexPlanEditor";
import {
  getInstructorRidingSlots,
  getStudentRidingHistoryForInstructor,
  type WeeklyRidingDay,
  type WeeklyRidingActivity,
  type StudentRidingHistoryResult,
} from "@/lib/actions/riding-slots";
import { getRidingSlotHorseListForInstructor } from "@/lib/actions/riding-slot-horses";
import {
  getRidingSlotComplexPlanForInstructor,
  createRidingSlotComplexPlanAsInstructor,
} from "@/lib/actions/riding-slot-complex";
// Existing, already-exported, read-only, no-permission-gate action (used
// today by ContactsSection) - reused here as-is for the complex block
// editor's instructor multi-select, exactly the same active-instructor
// roster shape RidingSlotModal.tsx already gets server-side via
// prisma.instructor.findMany({ where: { isActive: true } }). No server
// action was added or modified for this.
import { getInstructorContacts } from "@/lib/actions/contacts";
import type { InstructorSlotMode, RidingStudentOption } from "./instructor-riding-shared-types";

type ViewMode = "day" | "week";
type ScopeMode = "mine" | "all";
type BrowseMode = "slot" | "student";

function isAssignedToInstructor(activity: WeeklyRidingActivity, instructorId: string): boolean {
  return activity.ridingSlot?.assignments.some((a) => a.instructorIds.includes(instructorId)) ?? false;
}

// "loading" is represented by absence from the modeByRidingSlotId map, not a
// fourth enum value here - see the batch-detection effect below. The
// server/database is the sole source of truth for mode, same convention as
// the admin RidingSlotModal's own detectRidingSlotMode - never a client-side
// flag. Checks the complex plan first (cheap - a single read, returns null
// fast when no plan exists) and only falls back to the simple horse-list
// read when no complex plan exists, since the two modes are mutually
// exclusive by construction (P2's server-side guard). Both underlying reads
// already return null for an inactive instructor (isActive re-checked
// server-side on every call) - no extra handling needed here for that case.
async function detectInstructorRidingSlotMode(instructorId: string, ridingSlotId: string): Promise<InstructorSlotMode> {
  const complexPlan = await getRidingSlotComplexPlanForInstructor(instructorId, ridingSlotId);
  if (complexPlan) return "complex";
  const horseList = await getRidingSlotHorseListForInstructor(instructorId, ridingSlotId);
  if (horseList?.listId) return "simple";
  return "none";
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

export function InstructorRidingSlotsSection({
  instructorId,
  canEdit,
  students,
  modeByRidingSlotId,
  setModeByRidingSlotId,
  onOpenRidingStudents,
}: {
  instructorId: string;
  canEdit: boolean;
  students: RidingStudentOption[];
  // Per-RidingSlot mode map + its setter are owned by InstructorClient (so the
  // single shared RidingStudentsModalController can read the same live modes);
  // detection/refresh/choose/delete below still run here and write through this
  // setter, exactly as when the state was local.
  modeByRidingSlotId: Record<string, InstructorSlotMode>;
  setModeByRidingSlotId: Dispatch<SetStateAction<Record<string, InstructorSlotMode>>>;
  // Opens the single shared riding-students popup (owned by InstructorClient).
  // Both existing entry paths call this; knownMode is the same
  // modeByRidingSlotId[slotId] snapshot the inline openStudents read before.
  onOpenRidingStudents: (activity: WeeklyRidingActivity, knownMode?: InstructorSlotMode) => void;
}) {
  const [browseMode, setBrowseMode] = useState<BrowseMode>("slot");
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("mine");
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateKey());
  const [days, setDays] = useState<WeeklyRidingDay[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [studentSearch, setStudentSearch] = useState("");
  const [historyStudentId, setHistoryStudentId] = useState<string | null>(null);
  const [historyResult, setHistoryResult] = useState<StudentRidingHistoryResult | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Separate from openActivity/editingStudent above so this modal never
  // entangles with the riding-notes editor's own save-on-close orchestration
  // (see StudentEditor.requestClose) - opening/closing this one is a plain
  // independent action.
  const [horseListActivity, setHorseListActivity] = useState<WeeklyRidingActivity | null>(null);

  // Complex-plan editor - same independence from openActivity/editingStudent
  // as horseListActivity above. Per-RidingSlot mode is looked up in
  // modeByRidingSlotId (keyed by ridingSlot.id, absence = still loading) so
  // every visible card can show its own choice/label without a single
  // section-wide mode state.
  const [complexActivity, setComplexActivity] = useState<WeeklyRidingActivity | null>(null);
  const [creatingComplexForId, setCreatingComplexForId] = useState<string | null>(null);
  const [isCreatingComplex, startCreateComplexTransition] = useTransition();
  const [chooseError, setChooseError] = useState<{ ridingSlotId: string; message: string } | null>(null);

  // Active-instructor roster for the complex block editor's multi-select -
  // loaded once regardless of canEdit (a read-only viewer still needs it to
  // resolve/display already-assigned instructor names; RidingComplexPlanEditor
  // itself decides whether the picker is interactive via canEdit).
  const [instructorOptions, setInstructorOptions] = useState<{ id: string; fullName: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    getInstructorContacts().then((rows) => {
      if (cancelled) return;
      setInstructorOptions(rows.map((r) => ({ id: r.id, fullName: r.fullName })));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rangeKeys = viewMode === "day" ? [selectedDate] : getWeekDateKeys(selectedDate);
  const rangeStart = rangeKeys[0] ?? selectedDate;
  const rangeEnd = rangeKeys[rangeKeys.length - 1] ?? selectedDate;

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadError(null);
    setDays(null);
    // Reset every time the date range changes - a stale mode from the
    // previous range's RidingSlot ids must never appear to still apply
    // after switching day/week, same "switching must reset state" rule
    // applied to this per-card map instead of a single mode variable.
    setModeByRidingSlotId({});
    setChooseError(null);
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
    // setModeByRidingSlotId is InstructorClient's stable useState dispatcher
    // (lifted in Stage B1) - referentially stable, so listing it never re-runs
    // this effect; it is present only to satisfy exhaustive-deps.
  }, [rangeStart, rangeEnd, setModeByRidingSlotId]);

  // Batch-detects mode for every visible RidingSlot once `days` loads -
  // keyed on the full (unfiltered) days list rather than the scopeMode-
  // filtered visibleDays below, so toggling "הרכיבות שלי"/"כל הרכיבות" never
  // re-triggers a fetch for data already retrieved. Each result writes to
  // its own map key, so a stale response landing after a later range switch
  // is harmless on its own (the map was already reset above) - `cancelled`
  // still guards against writing into a map that belongs to an even later
  // range switch.
  useEffect(() => {
    const ridingSlotIds = Array.from(
      new Set(
        (days ?? [])
          .flatMap((day) => day.activities)
          .map((a) => a.ridingSlot?.id)
          .filter((id): id is string => Boolean(id))
      )
    );
    if (ridingSlotIds.length === 0) return;
    let cancelled = false;
    for (const ridingSlotId of ridingSlotIds) {
      detectInstructorRidingSlotMode(instructorId, ridingSlotId)
        .then((detected) => {
          if (cancelled) return;
          setModeByRidingSlotId((prev) => ({ ...prev, [ridingSlotId]: detected }));
        })
        .catch(() => {
          if (cancelled) return;
          setModeByRidingSlotId((prev) => ({ ...prev, [ridingSlotId]: "error" }));
        });
    }
    return () => {
      cancelled = true;
    };
    // setModeByRidingSlotId: stable dispatcher lifted to InstructorClient (see
    // the range-reset effect above) - listed only to satisfy exhaustive-deps.
  }, [days, instructorId, setModeByRidingSlotId]);

  function refreshModeFor(ridingSlotId: string) {
    detectInstructorRidingSlotMode(instructorId, ridingSlotId)
      .then((detected) => setModeByRidingSlotId((prev) => ({ ...prev, [ridingSlotId]: detected })))
      .catch(() => setModeByRidingSlotId((prev) => ({ ...prev, [ridingSlotId]: "error" })));
  }

  // Complex mode is created eagerly right when chosen (mirrors the admin
  // RidingSlotModal's identical behavior) via the P2 instructor create
  // action - a SIMPLE_LIST_EXISTS conflict shows its exact Hebrew message
  // inline on this card and re-derives mode from the server, never deletes
  // or converts either mode. creatingComplexForId (not just isCreatingComplex)
  // prevents a double-tap on a DIFFERENT card from being silently ignored
  // while also making sure only the tapped card shows "יוצר...".
  function handleChooseComplex(activity: WeeklyRidingActivity) {
    if (!activity.ridingSlot || creatingComplexForId) return;
    const ridingSlotId = activity.ridingSlot.id;
    setChooseError(null);
    setCreatingComplexForId(ridingSlotId);
    startCreateComplexTransition(async () => {
      const result = await createRidingSlotComplexPlanAsInstructor(instructorId, ridingSlotId);
      setCreatingComplexForId(null);
      if (!result.success) {
        setChooseError({ ridingSlotId, message: result.error ?? "אירעה שגיאה" });
        refreshModeFor(ridingSlotId);
        return;
      }
      setModeByRidingSlotId((prev) => ({ ...prev, [ridingSlotId]: "complex" }));
      setComplexActivity(activity);
    });
  }

  // Fired after a successful מחיקת התכנון המורכב inside RidingComplexPlanEditor
  // (admin-only there, but the callback itself is generic) - returns this
  // card to the mode-selection state, never auto-creates a simple list.
  function handleComplexPlanDeleted(ridingSlotId: string) {
    setComplexActivity(null);
    setModeByRidingSlotId((prev) => ({ ...prev, [ridingSlotId]: "none" }));
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
          <p className="text-xs text-muted-foreground">תצוגה בלבד - אין הרשאת עריכת הערות הדרכת מתקדמים</p>
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
                      onClick={
                        activity.ridingSlot
                          ? () =>
                              onOpenRidingStudents(
                                activity,
                                modeByRidingSlotId[activity.ridingSlot!.id]
                              )
                          : undefined
                      }
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

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {activity.ridingSlot ? (
                          <>
                            <Button
                              variant="secondary"
                              className="!px-2 !py-1 !text-xs"
                              onClick={(e) => {
                                // Stops the click from also bubbling to the
                                // card's own onClick above, which would
                                // otherwise call openStudents twice for one tap.
                                e.stopPropagation();
                                onOpenRidingStudents(
                                  activity,
                                  modeByRidingSlotId[activity.ridingSlot!.id]
                                );
                              }}
                            >
                              צפייה בחניכים
                            </Button>
                            {(() => {
                              const ridingSlotId = activity.ridingSlot!.id;
                              const slotMode = modeByRidingSlotId[ridingSlotId];
                              if (slotMode === undefined) return null; // still detecting - no placeholder, avoids per-card jitter
                              if (slotMode === "error") {
                                return (
                                  <span className="text-xs text-danger">שגיאה בבדיקת מצב הרכיבה</span>
                                );
                              }
                              if (slotMode === "none") {
                                if (!canEdit) {
                                  return (
                                    <span className="text-xs italic text-muted-foreground">
                                      עדיין לא הוגדר תכנון סוסים לרכיבה זו
                                    </span>
                                  );
                                }
                                return (
                                  <>
                                    <Button
                                      variant="secondary"
                                      className="!px-2 !py-1 !text-xs"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setChooseError(null);
                                        setHorseListActivity(activity);
                                      }}
                                    >
                                      רשימת סוסים רגילה
                                    </Button>
                                    <Button
                                      variant="secondary"
                                      className="!px-2 !py-1 !text-xs"
                                      disabled={isCreatingComplex && creatingComplexForId === ridingSlotId}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleChooseComplex(activity);
                                      }}
                                    >
                                      {isCreatingComplex && creatingComplexForId === ridingSlotId
                                        ? "יוצר..."
                                        : "תכנון רכיבה מורכבת — בלוקים וזוגות"}
                                    </Button>
                                  </>
                                );
                              }
                              if (slotMode === "simple") {
                                return (
                                  <>
                                    {canEdit && (
                                      <Button
                                        variant="secondary"
                                        className="!px-2 !py-1 !text-xs"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setHorseListActivity(activity);
                                        }}
                                      >
                                        הגדרת סוסים לאיכוף
                                      </Button>
                                    )}
                                    <span className="text-xs text-muted-foreground">מצב: רשימת סוסים רגילה</span>
                                  </>
                                );
                              }
                              // "complex" - open/view is available to every active
                              // instructor regardless of canEdit; the shared editor
                              // itself renders read-only ("צפייה") when
                              // canEditRidingNotes is false, per the P3b correction.
                              return (
                                <>
                                  <Button
                                    variant="secondary"
                                    className="!px-2 !py-1 !text-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setComplexActivity(activity);
                                    }}
                                  >
                                    פתיחת תכנון רכיבה מורכבת
                                  </Button>
                                  <span className="text-xs text-muted-foreground">מצב: תכנון רכיבה מורכבת</span>
                                </>
                              );
                            })()}
                          </>
                        ) : (
                          <p className="text-xs italic text-muted-foreground">
                            רכיבה זו טרם הוגדרה ע&quot;י המנהל/ת
                          </p>
                        )}
                      </div>
                      {activity.ridingSlot && chooseError?.ridingSlotId === activity.ridingSlot.id && (
                        <p className="mt-1 text-xs text-danger">{chooseError.message}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
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

      {horseListActivity && horseListActivity.ridingSlot && (
        <RidingHorseListEditor
          open={horseListActivity !== null}
          onClose={() => {
            const ridingSlotId = horseListActivity.ridingSlot!.id;
            setHorseListActivity(null);
            // Re-derives this card's mode after closing - if the save
            // inside hit a COMPLEX_PLAN_EXISTS conflict (already shown
            // inline by the unmodified editor itself), this reflects the
            // true server state instead of leaving a stale "none"/"simple"
            // label on the card.
            refreshModeFor(ridingSlotId);
          }}
          ridingSlotId={horseListActivity.ridingSlot.id}
          contextLabel={`${cleanScheduleTitle(horseListActivity.title)} · ${horseListActivity.startTime}-${horseListActivity.endTime}`}
          actor={{ type: "instructor", instructorId }}
        />
      )}

      {complexActivity && complexActivity.ridingSlot && (
        <RidingComplexPlanEditor
          open={complexActivity !== null}
          onClose={() => setComplexActivity(null)}
          ridingSlotId={complexActivity.ridingSlot.id}
          contextLabel={`${cleanScheduleTitle(complexActivity.title)} · ${complexActivity.startTime}-${complexActivity.endTime}`}
          instructors={instructorOptions}
          actor={{ type: "instructor", instructorId }}
          onDeleted={() => handleComplexPlanDeleted(complexActivity.ridingSlot!.id)}
        />
      )}
    </div>
  );
}
