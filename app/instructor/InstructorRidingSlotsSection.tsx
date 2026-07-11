"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, useTransition, type Ref } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { RidingHistoryList } from "@/lib/components/RidingHistoryList";
import { SuggestInput } from "@/lib/components/SuggestInput";
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

// Scopes the trainee tab switcher to the same subgroup as the currently
// opened trainee: matches groupName and subgroupNumber when the current
// trainee has both, so tabs only ever show its own subgroup (e.g. א1, not
// all of קבוצה א). If the current trainee has no subgroupNumber recorded,
// falls back to matching groupName alone rather than crashing or silently
// showing every trainee in the activity. Always true for the current
// trainee against itself, so it's never filtered out of its own tab list.
function isSameSwitchScope(current: RidingSlotStudentRow, candidate: RidingSlotStudentRow): boolean {
  if (current.groupName !== candidate.groupName) return false;
  if (current.subgroupNumber == null) return true;
  return candidate.subgroupNumber === current.subgroupNumber;
}

// Tab label format: first name + first letter of last name (e.g. "דניאל ק׳").
// Falls back to the bare name for a single-token name or anything unparsable,
// so an unusual fullName never throws - it just shows as-is.
function formatTraineeTabLabel(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? fullName;
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1].charAt(0);
  return lastInitial ? `${firstName} ${lastInitial}׳` : firstName;
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
            title="קיימת הערת הדרכת מתקדמים"
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

// Deliberately NOT SearchableMultiSelect here - see the identical note on
// InstructorChecklist in RidingSlotModal.tsx: that component kept its own
// internal open/search/highlight state, and combining it with this editor's
// other field re-renders made a freshly-toggled id disappear a moment after
// being selected. This checklist holds no selection state of its own -
// every checkbox's checked value reads taughtStudentIds directly, and
// toggling calls straight back out via onToggle (owned by StudentEditor,
// which computes the next array itself so it can autosave with a value
// that's guaranteed fresh, not a stale pre-toggle closure).
function TaughtStudentsChecklist({
  options,
  selectedIds,
  onToggle,
}: {
  options: { value: string; label: string }[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const [search, setSearch] = useState("");

  const filteredOptions = options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()));
  const selectedOptions = options.filter((o) => selectedIds.includes(o.value));

  return (
    <div className="flex flex-col gap-1.5">
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedOptions.map((o) => (
            <span
              key={o.value}
              className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
            >
              {o.label}
              <button
                type="button"
                onClick={() => onToggle(o.value)}
                aria-label={`הסרת ${o.label}`}
                className="text-secondary-foreground/70 hover:text-secondary-foreground"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="הקלידו שם..."
        className="rounded-lg border border-border px-3 py-2 text-sm"
      />
      <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border p-1.5">
        {filteredOptions.length === 0 ? (
          <p className="px-1.5 py-1 text-sm text-muted-foreground">לא נמצאו חניכים</p>
        ) : (
          filteredOptions.map((o) => (
            <label
              key={o.value}
              className="flex items-center gap-2 rounded px-1.5 py-1 text-base hover:bg-muted"
            >
              <input type="checkbox" checked={selectedIds.includes(o.value)} onChange={() => onToggle(o.value)} />
              {o.label}
            </label>
          ))
        )}
      </div>
    </div>
  );
}

// Full note/rating detail for exactly one student - opened from a compact
// row, never rendered for every student at once. The session-horse input
// stays collapsed behind its own small button so the default view is just
// the resolved horse line, note, and rating - not a busy form up front.
// Imperative handle so the parent's Modal close button (X / backdrop click)
// can trigger a full save from inside StudentEditor before returning to the
// list - without lifting the editable fields up into the parent (which would
// mean two places tracking the same draft and risking them drifting apart).
// The parent only ever calls requestClose(); StudentEditor remains the sole
// owner of every field's state.
export interface StudentEditorHandle {
  requestClose: () => void;
}

function StudentEditor({
  row,
  ridingSlotId,
  instructorId,
  canEdit,
  students,
  switchOptions,
  knownLessonTopics,
  knownHorseNames,
  onBack,
  onSaved,
  onAutoSaved,
  onSwitchTo,
  onSavedAndSwitchTo,
  ref,
}: {
  row: RidingSlotStudentRow;
  ridingSlotId: string;
  instructorId: string;
  canEdit: boolean;
  students: RidingStudentOption[];
  // Trainees from the same subgroup as the currently opened row only (see
  // isSameSwitchScope in the parent, which filters the activity's full
  // slotStudents list down to this scope), including the current row itself
  // so it shows as selected. Rendered as tabs; label is first name + first
  // letter of last name (see formatTraineeTabLabel).
  switchOptions: { studentId: string; label: string }[];
  knownLessonTopics: string[];
  knownHorseNames: string[];
  onBack: () => void;
  onSaved: (updated: RidingSlotStudentRow) => void;
  // Same shape as onSaved, but for a field-level autosave (topic/session-
  // horse blur, taught-students toggle) - updates the parent's copy of this
  // row without closing the editor, unlike onSaved which also returns to the
  // list (see handleStudentSaved vs handleStudentAutoSaved in the parent).
  onAutoSaved: (updated: RidingSlotStudentRow) => void;
  // View-only path: nothing to save, just switch which row is shown.
  onSwitchTo: (studentId: string) => void;
  // Editable path: called only after a successful save-before-switch,
  // updates the parent's copy of the just-saved row AND moves editingStudent
  // to the target in one step (see handleStudentSavedAndSwitchTo).
  onSavedAndSwitchTo: (updated: RidingSlotStudentRow, studentId: string) => void;
  ref?: Ref<StudentEditorHandle>;
}) {
  const [note, setNote] = useState(row.note ?? "");
  const [rating, setRating] = useState(row.ratingHalfPoints != null ? String(row.ratingHalfPoints) : "");
  const [sessionHorseName, setSessionHorseName] = useState(row.sessionHorseName ?? "");
  const [isEditingHorse, setIsEditingHorse] = useState(false);
  const [lessonTopic, setLessonTopic] = useState(row.lessonTopic ?? "");
  const [taughtStudentIds, setTaughtStudentIds] = useState(row.taughtStudents.map((s) => s.id));
  const [isSaving, startSaveTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Synchronous guard (isSaving from useTransition only updates on the next
  // render) so a manual save, an autosave, and requestClose/switch can never
  // overlap - a duplicate save request that arrives while one is already in
  // flight is simply dropped rather than racing it. requestClose and
  // switching trainees are the two exceptions (see pendingCloseRef/
  // pendingSwitchToRef below) - neither may be silently dropped just because
  // an autosave happened to be mid-flight.
  const isSavingRef = useRef(false);
  const pendingCloseRef = useRef(false);
  const pendingSwitchToRef = useRef<string | null>(null);

  // A trainee can't be recorded as teaching themselves - excluded from the
  // "who did they teach" options rather than left selectable-but-nonsensical.
  const taughtStudentOptions = useMemo(
    () =>
      students
        .filter((s) => s.id !== row.studentId)
        .map((s) => ({ value: s.id, label: s.fullName })),
    [students, row.studentId]
  );

  // Single save path for the manual button, every autosave trigger,
  // requestClose, and switching trainees - always sends the full current
  // snapshot of every field (never a partial diff), per the product rule
  // that note/rating stay optional while topic/taught-students/session-horse
  // must be independently saveable. `overrideTaughtStudentIds` exists only
  // because a just-computed toggle result isn't in `taughtStudentIds` yet
  // (state updates are async) - every other field is read directly from
  // current state, which is already up to date by the time a blur fires.
  function performSave(options?: {
    manual?: boolean;
    overrideTaughtStudentIds?: string[];
    switchToStudentId?: string;
  }) {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setError(null);
    const nextTaughtStudentIds = options?.overrideTaughtStudentIds ?? taughtStudentIds;
    startSaveTransition(async () => {
      const ratingHalfPoints = rating ? Number(rating) : null;
      const result = await upsertRidingLessonNoteAsInstructor(instructorId, ridingSlotId, row.studentId, {
        note,
        ratingHalfPoints,
        sessionHorseName,
        lessonTopic,
        taughtStudentIds: nextTaughtStudentIds,
      });
      isSavingRef.current = false;
      // A close or switch requested while THIS save was already in flight
      // (see requestClose/handleSwitchTo below, which set the pending*Ref
      // instead of starting a second overlapping save) must still be
      // honored once this save finishes, even if this particular save was
      // only an autosave. A switch takes priority over a plain close if
      // somehow both were queued against the same in-flight save.
      const switchTarget = options?.switchToStudentId ?? pendingSwitchToRef.current;
      const shouldReturnToList = options?.manual || pendingCloseRef.current;
      pendingSwitchToRef.current = null;
      pendingCloseRef.current = false;
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      const taughtStudents = students
        .filter((s) => nextTaughtStudentIds.includes(s.id))
        .map((s) => ({ id: s.id, fullName: s.fullName }));
      const updated: RidingSlotStudentRow = {
        ...row,
        note: note.trim() || null,
        ratingHalfPoints,
        sessionHorseName: sessionHorseName.trim() || null,
        lessonTopic: lessonTopic.trim() || null,
        taughtStudents,
        updatedByName: result.updatedByName ?? row.updatedByName,
        updatedAt: result.updatedAt ?? row.updatedAt,
      };
      if (switchTarget) {
        setIsEditingHorse(false);
        onSavedAndSwitchTo(updated, switchTarget);
      } else if (shouldReturnToList) {
        setIsEditingHorse(false);
        onSaved(updated);
      } else {
        onAutoSaved(updated);
      }
    });
  }

  function handleSave() {
    performSave({ manual: true });
  }

  function handleToggleTaughtStudent(id: string) {
    const next = taughtStudentIds.includes(id)
      ? taughtStudentIds.filter((v) => v !== id)
      : [...taughtStudentIds, id];
    setTaughtStudentIds(next);
    performSave({ overrideTaughtStudentIds: next });
  }

  // Selecting a different trainee from the switcher: view-only instructors
  // have nothing to save, so this just switches immediately. Editors get the
  // same full save the manual button performs first - the switch only
  // happens once that save actually succeeds (see performSave above), so an
  // unsaved note/rating is never silently discarded by picking someone else.
  function handleSwitchTo(studentId: string) {
    if (!studentId || studentId === row.studentId) return;
    if (!canEdit) {
      onSwitchTo(studentId);
      return;
    }
    if (isSavingRef.current) {
      pendingSwitchToRef.current = studentId;
      return;
    }
    performSave({ manual: true, switchToStudentId: studentId });
  }

  useImperativeHandle(ref, () => ({
    // View-only instructors have no editable state to save - just go back.
    // Editors get a full save (same fields the manual button saves,
    // including note/rating) before returning to the list; a failed save
    // leaves the editor open with `error` set, same as the manual button.
    //
    // If an autosave is already mid-flight, this must NOT be silently
    // dropped just because performSave's own duplicate-request guard would
    // otherwise ignore it - set pendingCloseRef instead, so the in-flight
    // save's own completion (above) returns to the list once it succeeds,
    // or leaves the editor open with the error shown if it fails.
    requestClose: () => {
      if (!canEdit) {
        onBack();
        return;
      }
      if (isSavingRef.current) {
        pendingCloseRef.current = true;
        return;
      }
      performSave({ manual: true });
    },
  }));

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-muted-foreground underline"
      >
        › חזרה לרשימה
      </button>

      {switchOptions.length > 1 && (
        <div
          role="tablist"
          aria-label="מעבר בין חניכים"
          className="flex max-w-full flex-wrap gap-1.5"
        >
          {switchOptions.map((o) => {
            const isActive = o.studentId === row.studentId;
            return (
              <button
                key={o.studentId}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => handleSwitchTo(o.studentId)}
                className={`max-w-full truncate rounded-full px-3 py-1.5 text-sm font-medium ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}

      <div>
        <p className="font-semibold text-card-foreground">{row.studentName}</p>
        <p className="text-sm text-muted-foreground">
          {row.groupName ? `קבוצה ${row.groupName}` : "ללא קבוצה"}
          {row.subgroupNumber != null ? ` / תת-קבוצה ${row.subgroupNumber}` : ""}
        </p>
        <p className="text-sm text-muted-foreground">
          {resolvedHorseLine({ ...row, sessionHorseName })}
        </p>
        {(row.updatedByName || row.updatedAt) && (
          <p className="mt-1 text-sm text-muted-foreground">
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
            <p className="mt-1 text-sm text-muted-foreground">
              {row.attendanceArrivalTime && `הגעה: ${row.attendanceArrivalTime}`}
              {row.attendanceArrivalTime && row.attendanceDepartureTime && " · "}
              {row.attendanceDepartureTime && `יציאה: ${row.attendanceDepartureTime}`}
            </p>
          )}
          {row.attendanceNotes && (
            <p className="mt-1 text-sm text-card-foreground">הערת נוכחות: {row.attendanceNotes}</p>
          )}
        </div>
      )}

      {canEdit && !isEditingHorse && (
        <button
          type="button"
          onClick={() => setIsEditingHorse(true)}
          className="self-start text-sm text-muted-foreground underline decoration-dotted"
        >
          עריכת סוס בשיעור
        </button>
      )}

      {canEdit && isEditingHorse && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
          <label className="flex flex-col gap-1 text-base" onBlur={() => performSave()}>
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
                className="text-sm text-muted-foreground underline"
              >
                נקה שינוי - חזרה לסוס הרגיל
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsEditingHorse(false)}
              className="text-sm text-muted-foreground underline"
            >
              סגירה
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            שינויים כאן נשמרים אוטומטית ביציאה מהשדה - אין צורך ללחוץ &quot;שמירה&quot;.
          </p>
        </div>
      )}

      {canEdit ? (
        <>
          <label className="flex flex-col gap-1 text-base">
            הערת הדרכת מתקדמים
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="rounded-lg border border-border px-3 py-2 text-base"
            />
          </label>
          <label className="flex flex-col gap-1 text-base">
            דירוג
            <select
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              className="w-32 rounded-lg border border-border px-3 py-2 text-base"
            >
              <option value="">ללא</option>
              {RATING_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v / 2}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-base" onBlur={() => performSave()}>
            נושא השיעור
            <SuggestInput
              value={lessonTopic}
              onChange={setLessonTopic}
              suggestions={knownLessonTopics}
              placeholder="לדוגמה: מעברים"
            />
          </label>
          <label className="flex flex-col gap-1 text-base">
            את מי החניך/ה הדריך/ה
            <TaughtStudentsChecklist
              options={taughtStudentOptions}
              selectedIds={taughtStudentIds}
              onToggle={handleToggleTaughtStudent}
            />
          </label>
          {error && <p className="text-base text-danger">{error}</p>}
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
          <p className="text-base text-muted-foreground">הערת הדרכת מתקדמים: {row.note ?? "אין הערה"}</p>
          <p className="text-base text-muted-foreground">
            דירוג: {row.ratingHalfPoints != null ? row.ratingHalfPoints / 2 : "ללא"}
          </p>
          <p className="text-base text-muted-foreground">נושא השיעור: {row.lessonTopic ?? "אין"}</p>
          <p className="text-base text-muted-foreground">
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
  // Lets the Modal's X/backdrop-close reach into the currently-mounted
  // StudentEditor and trigger its own save-then-close, without lifting the
  // editable fields up here (which would create a second, easily-desynced
  // copy of the same draft).
  const studentEditorRef = useRef<StudentEditorHandle>(null);

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

  // Same as handleStudentSaved but for a field-level autosave - updates the
  // list's copy of this row so it reflects what was just saved, but keeps
  // the editor open (unlike a manual/close-triggered save, an autosave was
  // never a request to leave this student).
  function handleStudentAutoSaved(updated: RidingSlotStudentRow) {
    setSlotStudents((prev) => (prev ? prev.map((s) => (s.studentId === updated.studentId ? updated : s)) : prev));
    loadKnownValues();
  }

  // View-only path for the trainee switcher - nothing was saved, just move
  // to the target row already in slotStudents.
  function handleSwitchToStudent(studentId: string) {
    const target = slotStudents?.find((s) => s.studentId === studentId) ?? null;
    if (target) setEditingStudent(target);
  }

  // Editable path for the trainee switcher - StudentEditor only calls this
  // after its own save already succeeded, so this is a single state
  // transition (update the list, then move editingStudent to the target)
  // rather than two separate close-then-reopen steps.
  function handleStudentSavedAndSwitchTo(updated: RidingSlotStudentRow, studentId: string) {
    const nextList = slotStudents
      ? slotStudents.map((s) => (s.studentId === updated.studentId ? updated : s))
      : slotStudents;
    setSlotStudents(nextList);
    const target = nextList?.find((s) => s.studentId === studentId) ?? null;
    if (target) setEditingStudent(target);
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
        size="wide"
        onClose={() => {
          // Inside a specific student's editor, X/backdrop-close should save
          // (same fields the manual button saves) and return to this slot's
          // grouped list, not close the whole modal back to the main
          // schedule - delegate to the editor itself (see StudentEditorHandle),
          // since it alone holds the current draft. A failed save leaves the
          // editor's own error state visible and the modal open.
          if (editingStudent) {
            studentEditorRef.current?.requestClose();
            return;
          }
          setOpenActivity(null);
          setSlotStudents(null);
          setEditingStudent(null);
        }}
      >
        <div className="flex max-h-[70vh] flex-col overflow-y-auto ps-1">
          {studentsError && <p className="mb-2 text-sm text-danger">{studentsError}</p>}
          {editingStudent ? (
            // Keyed by studentId so switching trainees remounts StudentEditor
            // instead of reusing the same instance - without this, its
            // useState-initialized fields (note, rating, ...) would keep the
            // previous trainee's in-progress edits after the row prop changes,
            // showing/leaking them under the newly-selected trainee.
            <StudentEditor
              key={editingStudent.studentId}
              ref={studentEditorRef}
              row={editingStudent}
              ridingSlotId={openActivity!.ridingSlot!.id}
              instructorId={instructorId}
              canEdit={canEdit}
              students={students}
              switchOptions={(slotStudents ?? [])
                .filter((s) => isSameSwitchScope(editingStudent, s))
                .map((s) => ({
                  studentId: s.studentId,
                  label: formatTraineeTabLabel(s.studentName),
                }))}
              knownLessonTopics={knownLessonTopics}
              knownHorseNames={knownHorseNames}
              onBack={() => setEditingStudent(null)}
              onSaved={handleStudentSaved}
              onAutoSaved={handleStudentAutoSaved}
              onSwitchTo={handleSwitchToStudent}
              onSavedAndSwitchTo={handleStudentSavedAndSwitchTo}
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
