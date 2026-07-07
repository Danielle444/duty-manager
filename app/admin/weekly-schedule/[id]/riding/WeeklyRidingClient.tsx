"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/lib/components/Button";
import { formatHebrewDate, formatHebrewWeekday, getLocalDateKey, parseDateKey } from "@/lib/dates";
import { cleanScheduleTitle } from "@/lib/schedule-title";
import { getScheduleGroupColorClass } from "@/lib/schedule-group-colors";
import { RidingSlotModal } from "@/app/admin/weekly-schedule/[id]/RidingSlotModal";
import { formatInstructorNames } from "@/lib/riding-assignment-matching";
import {
  getWeeklyRidingOverview,
  bulkApplyRidingAssignment,
  bulkSetRidingVisibility,
  type WeeklyRidingDay,
  type WeeklyRidingActivity,
} from "@/lib/actions/riding-slots";

interface InstructorOption {
  id: string;
  fullName: string;
}

type ViewMode = "likely" | "all";
type BulkMode = "skipExisting" | "overwrite";

interface BulkForm {
  groupName: string;
  subgroupNumber: string;
  instructorId: string;
  arena: string;
  mode: BulkMode;
}

const EMPTY_BULK_FORM: BulkForm = {
  groupName: "",
  subgroupNumber: "",
  instructorId: "",
  arena: "",
  mode: "skipExisting",
};

interface BulkVisibilityForm {
  groupName: string;
  showInstructorToStudents: boolean;
  showArenaToStudents: boolean;
  showSubgroupToStudents: boolean;
}

const EMPTY_BULK_VISIBILITY_FORM: BulkVisibilityForm = {
  groupName: "",
  showInstructorToStudents: false,
  showArenaToStudents: false,
  showSubgroupToStudents: false,
};

// A target groupName of "" (כל הרכיבה) always applies to everything shown.
// A specific group (א/ב) only applies to activities that actually belong to
// that group, OR to cross-group ("שתי הקבוצות", groupName null) activities -
// never to an activity that belongs only to the other group. This is what
// was missing before: bulk assignment/visibility applied to every
// currently-shown activity regardless of its own real group.
function isActivityTargeted(activity: WeeklyRidingActivity, targetGroupName: string): boolean {
  if (!targetGroupName) return true;
  if (activity.groupName === null) return true;
  return activity.groupName === targetGroupName;
}

export function WeeklyRidingClient({
  weekId,
  weekName,
  initialDays,
  instructors,
}: {
  weekId: string;
  weekName: string;
  initialDays: WeeklyRidingDay[];
  instructors: InstructorOption[];
}) {
  const [days, setDays] = useState(initialDays);
  const [viewMode, setViewMode] = useState<ViewMode>("likely");
  const [ridingTarget, setRidingTarget] = useState<WeeklyRidingActivity | null>(null);
  // This view is a vertical stack of day sections (no day tabs), so "focus
  // today" means scrolling today's section into view once, the first time
  // it's actually on screen - never again afterward, so it doesn't fight a
  // manual scroll/selection later.
  const todayDateKey = getLocalDateKey();
  const todaySectionRef = useRef<HTMLDivElement | null>(null);
  const hasScrolledToTodayRef = useRef(false);

  useEffect(() => {
    if (hasScrolledToTodayRef.current) return;
    if (!todaySectionRef.current) return;
    todaySectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    hasScrolledToTodayRef.current = true;
  }, []);

  const [bulkForm, setBulkForm] = useState<BulkForm>(EMPTY_BULK_FORM);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [isBulkApplying, startBulkTransition] = useTransition();

  const [bulkVisibilityForm, setBulkVisibilityForm] = useState<BulkVisibilityForm>(
    EMPTY_BULK_VISIBILITY_FORM
  );
  const [bulkVisibilityError, setBulkVisibilityError] = useState<string | null>(null);
  const [bulkVisibilityMessage, setBulkVisibilityMessage] = useState<string | null>(null);
  const [isBulkVisibilityApplying, startBulkVisibilityTransition] = useTransition();

  function refetch() {
    getWeeklyRidingOverview(weekId).then(setDays);
  }

  function closeModal() {
    setRidingTarget(null);
    // The modal may have created/edited the slot behind this activity (or
    // any other) - refresh so the list's status/assignments summary and
    // "טרם הוגדר" badges stay accurate.
    refetch();
  }

  const visibleDays = days
    .map((day) => ({
      ...day,
      activities: day.activities.filter((a) => viewMode === "all" || a.isLikelyRiding),
    }))
    .filter((day) => day.activities.length > 0);

  const visibleActivityCount = visibleDays.reduce((sum, day) => sum + day.activities.length, 0);

  // The set of activities a bulk action would actually touch: currently
  // shown (likely-riding/show-all filter) AND relevant to the selected
  // target group - never the full visible list when a specific group (א/ב)
  // is chosen.
  function getTargetedActivities(targetGroupName: string) {
    return visibleDays.flatMap((day) =>
      day.activities.filter((a) => isActivityTargeted(a, targetGroupName))
    );
  }

  const assignmentTargetedCount = getTargetedActivities(bulkForm.groupName).length;
  const visibilityTargetedCount = getTargetedActivities(bulkVisibilityForm.groupName).length;

  function handleBulkApply() {
    setBulkError(null);
    setBulkMessage(null);

    const activities = getTargetedActivities(bulkForm.groupName).map((a) => ({
      scheduleItemIds: a.scheduleItemIds,
    }));

    startBulkTransition(async () => {
      const result = await bulkApplyRidingAssignment({
        activities,
        groupName: bulkForm.groupName || undefined,
        subgroupNumber: bulkForm.subgroupNumber ? Number(bulkForm.subgroupNumber) : undefined,
        instructorId: bulkForm.instructorId || undefined,
        arena: bulkForm.arena || undefined,
        mode: bulkForm.mode,
      });
      if (!result.success || !result.summary) {
        setBulkError(result.error ?? "אירעה שגיאה");
        return;
      }
      const s = result.summary;
      setBulkMessage(
        `הפעולה הסתיימה: נוצרו ${s.createdSlots} סלוטים, נוצרו ${s.createdAssignments} שיוכים, עודכנו ${s.updatedAssignments}, דולגו ${s.skippedAssignments}.` +
          (s.errors.length > 0 ? ` (${s.errors.length} שגיאות)` : "")
      );
      refetch();
    });
  }

  function handleBulkVisibilityApply() {
    setBulkVisibilityError(null);
    setBulkVisibilityMessage(null);

    const activities = getTargetedActivities(bulkVisibilityForm.groupName).map((a) => ({
      scheduleItemIds: a.scheduleItemIds,
    }));

    startBulkVisibilityTransition(async () => {
      const result = await bulkSetRidingVisibility(activities, {
        showInstructorToStudents: bulkVisibilityForm.showInstructorToStudents,
        showArenaToStudents: bulkVisibilityForm.showArenaToStudents,
        showSubgroupToStudents: bulkVisibilityForm.showSubgroupToStudents,
      });
      if (!result.success || !result.summary) {
        setBulkVisibilityError(result.error ?? "אירעה שגיאה");
        return;
      }
      const s = result.summary;
      setBulkVisibilityMessage(
        `הפעולה הסתיימה: נוצרו ${s.createdSlots} סלוטים, עודכנו ${s.updatedSlots} הגדרות תצוגה.` +
          (s.errors.length > 0 ? ` (${s.errors.length} שגיאות)` : "")
      );
      refetch();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href={`/admin/weekly-schedule/${weekId}`}
          className="text-sm text-muted-foreground underline hover:text-card-foreground"
        >
          &larr; חזרה ללו&quot;ז השבועי
        </Link>
        <h1 className="mt-1 text-xl font-bold text-card-foreground">ניהול רכיבות - {weekName}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setViewMode("likely")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            viewMode === "likely"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          פעילויות רכיבה סבירות
        </button>
        <button
          type="button"
          onClick={() => setViewMode("all")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            viewMode === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          הצג את כל הפעילויות
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-card-foreground">החלת שיוך בכמות (Bulk)</p>
        <p className="text-xs text-warning">
          הפעולה תחול על כל הפעילויות המוצגות שמתאימות לקבוצה שנבחרה ({assignmentTargetedCount}{" "}
          מתוך {visibleActivityCount} פעילויות מוצגות) - לא על פעילויות מוסתרות ע&quot;י הסינון ולא
          על פעילויות של הקבוצה השנייה בלבד.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            קבוצה
            <select
              value={bulkForm.groupName}
              onChange={(e) => setBulkForm((f) => ({ ...f, groupName: e.target.value }))}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            >
              <option value="">כל הרכיבה</option>
              <option value="א">קבוצה א</option>
              <option value="ב">קבוצה ב</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            תת-קבוצה (אופציונלי)
            <input
              type="number"
              min={1}
              value={bulkForm.subgroupNumber}
              onChange={(e) => setBulkForm((f) => ({ ...f, subgroupNumber: e.target.value }))}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            מדריך/ה
            <select
              value={bulkForm.instructorId}
              onChange={(e) => setBulkForm((f) => ({ ...f, instructorId: e.target.value }))}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            >
              <option value="">ללא</option>
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            מגרש
            <input
              value={bulkForm.arena}
              onChange={(e) => setBulkForm((f) => ({ ...f, arena: e.target.value }))}
              placeholder="למשל: מגרש 1"
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="bulkMode"
              checked={bulkForm.mode === "skipExisting"}
              onChange={() => setBulkForm((f) => ({ ...f, mode: "skipExisting" }))}
            />
            רק איפה שחסר שיוך
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="bulkMode"
              checked={bulkForm.mode === "overwrite"}
              onChange={() => setBulkForm((f) => ({ ...f, mode: "overwrite" }))}
            />
            דריסה ועדכון שיוכים קיימים
          </label>
        </div>

        {bulkError && <p className="text-sm text-danger">{bulkError}</p>}
        {bulkMessage && <p className="text-sm text-success">{bulkMessage}</p>}

        <Button
          className="self-start"
          disabled={isBulkApplying || assignmentTargetedCount === 0}
          onClick={handleBulkApply}
        >
          {isBulkApplying ? "מחיל..." : `החל על ${assignmentTargetedCount} פעילויות מתאימות`}
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-card-foreground">החלת הגדרות תצוגה בכמות</p>
        <p className="text-xs text-warning">
          החלת הגדרות תצוגה על כל הפעילויות המתאימות שמוצגות כרגע ({visibilityTargetedCount} מתוך{" "}
          {visibleActivityCount} פעילויות מוצגות). ההגדרות עדיין לא משפיעות על תצוגת החניך/ה בשלב
          זה.
        </p>

        <label className="flex flex-col gap-1 text-sm">
          קבוצה
          <select
            value={bulkVisibilityForm.groupName}
            onChange={(e) =>
              setBulkVisibilityForm((f) => ({ ...f, groupName: e.target.value }))
            }
            className="w-40 rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">כל הרכיבה</option>
            <option value="א">קבוצה א</option>
            <option value="ב">קבוצה ב</option>
          </select>
        </label>

        <div className="flex flex-col gap-1.5 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={bulkVisibilityForm.showInstructorToStudents}
              onChange={() =>
                setBulkVisibilityForm((f) => ({
                  ...f,
                  showInstructorToStudents: !f.showInstructorToStudents,
                }))
              }
            />
            הצגת מדריך/ה לחניכים
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={bulkVisibilityForm.showArenaToStudents}
              onChange={() =>
                setBulkVisibilityForm((f) => ({
                  ...f,
                  showArenaToStudents: !f.showArenaToStudents,
                }))
              }
            />
            הצגת מגרש לחניכים
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={bulkVisibilityForm.showSubgroupToStudents}
              onChange={() =>
                setBulkVisibilityForm((f) => ({
                  ...f,
                  showSubgroupToStudents: !f.showSubgroupToStudents,
                }))
              }
            />
            הצגת תת־קבוצה לחניכים
          </label>
        </div>

        {bulkVisibilityError && <p className="text-sm text-danger">{bulkVisibilityError}</p>}
        {bulkVisibilityMessage && (
          <p className="text-sm text-success">{bulkVisibilityMessage}</p>
        )}

        <Button
          className="self-start"
          disabled={isBulkVisibilityApplying || visibilityTargetedCount === 0}
          onClick={handleBulkVisibilityApply}
        >
          {isBulkVisibilityApplying
            ? "מחיל..."
            : `החל על ${visibilityTargetedCount} פעילויות מתאימות`}
        </Button>
      </div>

      {visibleDays.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          אין פעילויות להצגה
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {visibleDays.map((day) => (
            <div
              key={day.dateKey}
              ref={day.dateKey === todayDateKey ? todaySectionRef : undefined}
              className="rounded-2xl border border-border bg-card p-5"
            >
              <p className="mb-3 inline-block rounded-lg bg-secondary px-3 py-2 text-base font-bold text-secondary-foreground">
                {formatHebrewWeekday(parseDateKey(day.dateKey))} ·{" "}
                {formatHebrewDate(parseDateKey(day.dateKey))}
              </p>
              <div className="flex flex-col gap-3">
                {day.activities.map((activity) => (
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
                        {activity.isLikelyRiding && (
                          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                            רכיבה (זוהה אוטומטית)
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            activity.ridingSlot
                              ? "bg-success-muted text-success"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {activity.ridingSlot ? "מוגדר כרכיבה" : "טרם הוגדר"}
                        </span>
                      </div>
                    </div>

                    <p className="text-lg font-bold text-card-foreground">
                      {cleanScheduleTitle(activity.title)}
                    </p>

                    {activity.ridingSlot && (
                      <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                        <p>
                          חשיפה לחניכים: מדריך/ה{" "}
                          {activity.ridingSlot.showInstructorToStudents ? "מוצג" : "מוסתר"} · מגרש{" "}
                          {activity.ridingSlot.showArenaToStudents ? "מוצג" : "מוסתר"} · תת-קבוצה{" "}
                          {activity.ridingSlot.showSubgroupToStudents ? "מוצג" : "מוסתר"}
                        </p>
                        {activity.ridingSlot.assignments.length === 0 ? (
                          <p>אין שיוכים עדיין</p>
                        ) : (
                          activity.ridingSlot.assignments.map((a) => (
                            <p key={a.id}>
                              {a.groupName ? `קבוצה ${a.groupName}` : "כל הרכיבה"}
                              {a.subgroupNumber != null ? ` / תת-קבוצה ${a.subgroupNumber}` : ""} -
                              מדריך/ה: {formatInstructorNames(a.instructors.map((i) => i.fullName)) ?? "לא נבחר"} ·
                              מגרש: {a.arena ?? "לא הוזן"}
                            </p>
                          ))
                        )}
                      </div>
                    )}

                    <div className="mt-2">
                      <Button
                        variant="secondary"
                        className="!px-2 !py-1 !text-xs"
                        onClick={() => setRidingTarget(activity)}
                      >
                        ניהול רכיבה
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {ridingTarget && (
        <RidingSlotModal
          open={ridingTarget !== null}
          onClose={closeModal}
          scheduleItemIds={ridingTarget.scheduleItemIds}
          scheduleItemInfo={{
            title: ridingTarget.title,
            dateKey: ridingTarget.dateKey,
            startTime: ridingTarget.startTime,
            endTime: ridingTarget.endTime,
            groupName: ridingTarget.groupName,
            instructorName: ridingTarget.instructorName,
            location: ridingTarget.location,
          }}
          isMergedDisplay={ridingTarget.scheduleItemIds.length > 1}
          instructors={instructors}
        />
      )}
    </div>
  );
}
