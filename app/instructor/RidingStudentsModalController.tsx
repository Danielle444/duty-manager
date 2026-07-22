"use client";

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useTransition,
  type Ref,
} from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { SuggestInput } from "@/lib/components/SuggestInput";
import { formatHebrewDateTime } from "@/lib/dates";
import { cleanScheduleTitle } from "@/lib/schedule-title";
import { getScheduleGroupColorClass } from "@/lib/schedule-group-colors";
import { getHorseDisplayInfo } from "@/lib/horse-info";
import { formatInstructorNames } from "@/lib/riding-assignment-matching";
import { groupByGroupAndSubgroup, STATUS_BADGE_CLASS, type GroupSection } from "@/lib/attendance-ui";
import {
  getRidingSlotStudentNotes,
  upsertRidingLessonNoteAsInstructor,
  type WeeklyRidingActivity,
  type RidingSlotStudentRow,
  type RidingSlotAssignmentRow,
} from "@/lib/actions/riding-slots";
import {
  getRidingSlotComplexPlanForInstructor,
  type RidingSlotComplexPlanForEditing,
} from "@/lib/actions/riding-slot-complex";
import { resolveInitialStudentsTab } from "./instructor-riding-initial-tab-core";
// Narrow shared types, no longer imported back from the child section now that
// InstructorClient (a parent) owns this controller - see
// instructor-riding-shared-types.ts.
import type { InstructorSlotMode, RidingStudentOption } from "./instructor-riding-shared-types";

// 1.0-5.0 in 0.5 steps, shown as ratingHalfPoints/2.
const RATING_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

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

// RIDING-COMPLEX-FEEDBACK-VIEW - one trainee button/card inside the "לפי
// שיבוץ הרכיבה" hierarchy. `row` is looked up by stable trainee ID from the
// SAME slotStudents roster StudentCompactRow above already uses (never a
// second, independently-drifting fetch) - when no matching row exists (a
// trainee outside this slot's own group/subgroup assignments, or since
// deactivated), there is no feedback record UI to open for them, so the name
// renders as plain, non-interactive text instead of a dead/misleading button.
function ComplexFeedbackTraineeButton({
  traineeName,
  row,
  onOpen,
}: {
  traineeName: string | null;
  row: RidingSlotStudentRow | null;
  onOpen: (row: RidingSlotStudentRow) => void;
}) {
  const name = traineeName ?? "לא נבחר/ה";
  if (!row) {
    return (
      <span
        className="max-w-full rounded-full bg-muted px-3 py-2 text-sm break-words text-muted-foreground"
        title="אין רשומת הערכה זמינה עבור חניכ/ה זו ברכיבה זו"
      >
        {name}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground hover:border-primary/40 hover:bg-muted"
    >
      <span className="break-words">{name}</span>
      {/* Same existing-feedback indicators StudentCompactRow already shows
          in "צפייה בחניכים" (identical conditions/classes/title) -
          duplicated here rather than extracted into a shared component, so
          that file's own component is not touched at all. Both read
          directly from `row`, the exact same slotStudents entry both tabs
          share - no separate fetch, no separate state, and this updates the
          instant either tab's save patches slotStudents (see
          handleStudentSaved/handleStudentAutoSaved, unchanged). A failed
          save never calls either of those, so it never shows here either. */}
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
    </button>
  );
}

// RIDING-COMPLEX-FEEDBACK-VIEW - read-only navigation into the SAME riding
// feedback editor ("צפייה בחניכים"'s StudentEditor), organized by the live
// complex plan (block -> station -> pair) instead of a flat/grouped trainee
// list. Never a second feedback model, never a mutation control of its own -
// see this file's own audit comment above the tab-switcher render for why
// planning/publication concerns are deliberately absent here. Uses the LIVE
// plan (getRidingSlotComplexPlanForInstructor), never the trainee publication
// snapshot - instructors are allowed to see draft/live schedules regardless
// of publish status, and this view exists to reflect the current working
// schedule, not what's been published to trainees.
function ComplexScheduleFeedbackView({
  status,
  plan,
  slotStudents,
  onOpenTrainee,
}: {
  status: "idle" | "loading" | "loaded" | "not-found" | "error";
  plan: RidingSlotComplexPlanForEditing | null;
  slotStudents: RidingSlotStudentRow[] | null;
  onOpenTrainee: (row: RidingSlotStudentRow) => void;
}) {
  if (status === "idle" || status === "loading") {
    return <p className="text-sm text-muted-foreground">טוען...</p>;
  }
  if (status === "error") {
    return <p className="text-sm text-danger">שגיאה בטעינת תכנון הרכיבה. נסו לרענן.</p>;
  }
  if (status === "not-found" || !plan) {
    return <p className="text-sm text-muted-foreground">אין עדיין תכנון רכיבה מורכבת</p>;
  }

  const blocks = plan.plan.blocks;
  if (blocks.length === 0) {
    return <p className="text-sm text-muted-foreground">אין עדיין טווחי שעות בתכנון</p>;
  }

  function findRow(traineeId: string | null): RidingSlotStudentRow | null {
    if (!traineeId || !slotStudents) return null;
    return slotStudents.find((s) => s.studentId === traineeId) ?? null;
  }

  // RIDING-COMPLEX-FEEDBACK-VIEW visual-polish pass - three-tier hierarchy
  // built entirely from tokens already defined in app/globals.css (no
  // bg-primary-muted - that token does not exist in this project, unlike
  // what a first guess might suggest; verified against globals.css before
  // using anything here). Each level is deliberately a step lighter than the
  // one above it, so the eye reads block -> station -> pair -> trainee
  // without needing a fourth distinct hue: block = secondary-tinted wash +
  // solid secondary time badge (the only level using the secondary/blue
  // family at all, making it read as the "loudest"), station = muted-tinted
  // (softer, gray-blue), pair = plain card background (lightest, just a
  // hairline border), trainee = the existing bordered pill button.
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block) => (
        <div key={block.id} className="rounded-xl border-2 border-border bg-secondary/30 p-3">
          <span className="inline-block rounded-lg bg-secondary px-3 py-1.5 text-lg font-bold text-secondary-foreground">
            {block.startTime}–{block.endTime}
          </span>
          {block.stations.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">אין תחנות בטווח זה</p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {block.stations.map((station) => (
                <div key={station.id} className="rounded-lg border border-border bg-muted/60 p-2.5">
                  <p className="mb-1.5 flex flex-wrap items-baseline gap-x-1.5 text-sm text-card-foreground">
                    <span className="font-semibold">מאמן/ת: {station.instructor?.fullName ?? "לא הוגדר/ה מאמן/ת"}</span>
                    <span className="text-muted-foreground">· מגרש: {station.arena ?? "לא הוגדר מגרש"}</span>
                  </p>
                  {station.pairs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">אין זוגות בתחנה זו</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {station.pairs.map((pair) => (
                        <div key={pair.id} className="rounded-lg border border-border/50 bg-card p-2">
                          <p className="mb-1 text-xs text-muted-foreground">
                            סוס: {pair.horseName ?? "לא הוגדר סוס"}
                            {pair.note && <> · הערה: {pair.note}</>}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            <ComplexFeedbackTraineeButton
                              traineeName={pair.trainee1Name}
                              row={findRow(pair.trainee1Id)}
                              onOpen={onOpenTrainee}
                            />
                            {pair.trainee2Id && (
                              <ComplexFeedbackTraineeButton
                                traineeName={pair.trainee2Name}
                                row={findRow(pair.trainee2Id)}
                                onOpen={onOpenTrainee}
                              />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
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
      // RS-SEC-1I-W: the acting instructor is derived from the signed session
      // server-side; this no longer passes instructorId. StudentEditor used its
      // instructorId prop only for this note write, so that prop is dropped; the
      // parent controller keeps its own instructorId for the complex-plan reads
      // and the assignment-tier display, which are unaffected.
      const result = await upsertRidingLessonNoteAsInstructor(ridingSlotId, row.studentId, {
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

// Public handle for the single riding-students popup. `open` routes both
// existing entry paths (a riding card click and the "צפייה בחניכים" button)
// through this one controller - knownMode is the caller's
// modeByRidingSlotId[slotId] snapshot, used only to pick the initial tab via
// resolveInitialStudentsTab, exactly as openStudents did inline before.
export interface RidingStudentsModalControllerHandle {
  open: (activity: WeeklyRidingActivity, knownMode?: InstructorSlotMode) => void;
}

// The single riding-students "צפייה בחניכים" popup, extracted verbatim from
// InstructorRidingSlotsSection. It retains sole ownership of every piece of
// state/effect the popup exclusively owned - openActivity, slotStudents/
// loading/error, editingStudent, activeStudentsTab, the complex-plan
// display/fetch state and its fetch guard ref, the StudentEditor imperative
// ref, and the Modal itself - so the section no longer entangles with the
// riding-notes editor's own save-on-close orchestration. modeByRidingSlotId
// is read (never written) here only to keep the live isComplexModeForOpenActivity
// computation identical to the pre-extraction inline one; onReloadKnownValues
// is the section's own loadKnownValues, called after a successful save exactly
// as before.
export function RidingStudentsModalController({
  instructorId,
  canEdit,
  students,
  knownLessonTopics,
  knownHorseNames,
  modeByRidingSlotId,
  onReloadKnownValues,
  ref,
}: {
  instructorId: string;
  canEdit: boolean;
  students: RidingStudentOption[];
  knownLessonTopics: string[];
  knownHorseNames: string[];
  modeByRidingSlotId: Record<string, InstructorSlotMode>;
  onReloadKnownValues: () => void;
  ref?: Ref<RidingStudentsModalControllerHandle>;
}) {
  const [openActivity, setOpenActivity] = useState<WeeklyRidingActivity | null>(null);
  const [slotStudents, setSlotStudents] = useState<RidingSlotStudentRow[] | null>(null);
  const [studentsError, setStudentsError] = useState<string | null>(null);
  const [editingStudent, setEditingStudent] = useState<RidingSlotStudentRow | null>(null);
  // Lets the Modal's X/backdrop-close reach into the currently-mounted
  // StudentEditor and trigger its own save-then-close, without lifting the
  // editable fields up here (which would create a second, easily-desynced
  // copy of the same draft). Also reused by the new "לפי שיבוץ הרכיבה" tab's
  // own "חזרה לשיבוץ הרכיבה" control (see the Modal render below) - the same
  // save-safe departure path, not a second implementation of it.
  const studentEditorRef = useRef<StudentEditorHandle>(null);

  // RIDING-COMPLEX-FEEDBACK-VIEW - which of the two "צפייה בחניכים" tabs is
  // showing. Only ever meaningful while editingStudent is null (both tabs'
  // own list/hierarchy content is hidden while a trainee editor is open - see
  // the Modal render below), and is deliberately NOT reset by opening/closing
  // a trainee editor, only by openStudents (a genuinely new riding session) -
  // so returning from an editor lands back on whichever tab the instructor
  // was actually browsing.
  const [activeStudentsTab, setActiveStudentsTab] = useState<"list" | "schedule">("list");
  // Live complex plan for the "לפי שיבוץ הרכיבה" tab - fetched lazily (only
  // once the instructor actually opens that tab, never eagerly on every
  // "צפייה בחניכים" open) and cached for the rest of this modal session (see
  // the load effect below, gated on status === "idle"). Uses the exact same
  // getRidingSlotComplexPlanForInstructor read RidingComplexPlanEditor
  // itself uses - no new action, no new DTO.
  const [complexPlanForFeedback, setComplexPlanForFeedback] = useState<RidingSlotComplexPlanForEditing | null>(
    null
  );
  const [complexPlanForFeedbackStatus, setComplexPlanForFeedbackStatus] = useState<
    "idle" | "loading" | "loaded" | "not-found" | "error"
  >("idle");
  // Tracks the ridingSlotId a fetch has already been started for (or null,
  // before the tab has ever been opened this session) - the load effect
  // below gates on THIS ref, never on complexPlanForFeedbackStatus itself.
  // Gating on the status state was the original bug: the effect set that
  // same state to "loading" inside its own body, which is a dependency of
  // the same effect, so React reran the effect immediately, tore down the
  // first run's `cancelled` closure before the fetch resolved, and the
  // rerun's own idle-only guard then refused to start a replacement fetch -
  // the in-flight request's result arrived but was permanently discarded by
  // its own now-stale `cancelled` flag. A ref sidesteps this entirely: it is
  // never a dependency, so setting it (or the status state) can never
  // retrigger this same effect.
  const complexPlanFetchStartedForRef = useRef<string | null>(null);

  function openStudents(activity: WeeklyRidingActivity, knownMode?: InstructorSlotMode) {
    if (!activity.ridingSlot) return;
    setOpenActivity(activity);
    setSlotStudents(null);
    setStudentsError(null);
    setEditingStudent(null);
    // RIDING-COMPLEX-FEEDBACK-VIEW - a genuinely new riding session opens
    // directly on "לפי שיבוץ הרכיבה" when this slot is already complex-mode,
    // otherwise on the existing flat "צפייה בחניכים" trainee list. The initial
    // tab is decided purely from the same modeByRidingSlotId entry every card
    // already reads (undefined while still detecting -> "list"), passed in by
    // the caller as knownMode, via the pure resolveInitialStudentsTab helper -
    // no new read, no new state, no server action. The complex plan (if any)
    // is still re-fetched fresh the next time "לפי שיבוץ הרכיבה" is shown for
    // THIS session - never carries over a previous session's plan.
    setActiveStudentsTab(resolveInitialStudentsTab(knownMode));
    setComplexPlanForFeedback(null);
    setComplexPlanForFeedbackStatus("idle");
    complexPlanFetchStartedForRef.current = null;
    getRidingSlotStudentNotes(activity.ridingSlot.id)
      .then((rows) => setSlotStudents(rows))
      .catch(() => {
        setSlotStudents([]);
        setStudentsError("שגיאה בטעינת רשימת החניכים. נסו לרענן.");
      });
  }

  useImperativeHandle(ref, () => ({ open: openStudents }));

  // RIDING-COMPLEX-FEEDBACK-VIEW - fetches the live complex plan exactly
  // once per riding session, only when the instructor actually switches to
  // "לפי שיבוץ הרכיבה" - never once per trainee/pair, never eagerly for every
  // "צפייה בחניכים" open. Gated on complexPlanFetchStartedForRef (see that
  // ref's own comment for why this must be a ref, not the status state
  // itself) rather than complexPlanForFeedbackStatus, and that ref is
  // deliberately NOT a dependency either - only activeStudentsTab/
  // openActivity/instructorId are, so setting state inside this effect can
  // never retrigger it. Switching back and forth between the two tabs within
  // the SAME session reuses the already-loaded (or already-failed) result
  // instead of refetching - only openStudents (a genuinely new session)
  // resets the ref. Same cancelled-effect convention used throughout this
  // app's other load effects (e.g. RidingComplexPlanEditor's own plan-load
  // effect) - a response landing after the modal moved to a different riding
  // session is safely discarded.
  useEffect(() => {
    if (activeStudentsTab !== "schedule") return;
    const ridingSlotId = openActivity?.ridingSlot?.id;
    if (!ridingSlotId) return;
    if (complexPlanFetchStartedForRef.current === ridingSlotId) return;
    complexPlanFetchStartedForRef.current = ridingSlotId;
    let cancelled = false;
    setComplexPlanForFeedbackStatus("loading");
    getRidingSlotComplexPlanForInstructor(instructorId, ridingSlotId)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setComplexPlanForFeedback(null);
          setComplexPlanForFeedbackStatus("not-found");
          return;
        }
        setComplexPlanForFeedback(result);
        setComplexPlanForFeedbackStatus("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setComplexPlanForFeedbackStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // complexPlanFetchStartedForRef is a ref (never a dependency by React's
    // own rules) and complexPlanForFeedbackStatus is only ever written here,
    // never read - including it as a dependency was the original bug (see
    // this effect's own comment above).
  }, [activeStudentsTab, openActivity, instructorId]);

  function handleStudentSaved(updated: RidingSlotStudentRow) {
    setSlotStudents((prev) => (prev ? prev.map((s) => (s.studentId === updated.studentId ? updated : s)) : prev));
    setEditingStudent(null);
    // A newly-typed lesson topic/horse name only becomes a suggestion for
    // the *next* student once this refetches - same reasoning as
    // HorseFeedingSection's post-save loadKnownValues() call.
    onReloadKnownValues();
  }

  // Same as handleStudentSaved but for a field-level autosave - updates the
  // list's copy of this row so it reflects what was just saved, but keeps
  // the editor open (unlike a manual/close-triggered save, an autosave was
  // never a request to leave this student).
  function handleStudentAutoSaved(updated: RidingSlotStudentRow) {
    setSlotStudents((prev) => (prev ? prev.map((s) => (s.studentId === updated.studentId ? updated : s)) : prev));
    onReloadKnownValues();
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
    onReloadKnownValues();
  }

  const openAssignments = openActivity?.ridingSlot?.assignments ?? [];
  // RIDING-COMPLEX-FEEDBACK-VIEW - "לפי שיבוץ הרכיבה" only ever appears for a
  // riding slot already confirmed complex-mode via the same
  // modeByRidingSlotId map every activity card's own buttons already read -
  // never a second, independent mode check.
  const openRidingSlotId = openActivity?.ridingSlot?.id ?? null;
  const isComplexModeForOpenActivity = openRidingSlotId
    ? modeByRidingSlotId[openRidingSlotId] === "complex"
    : false;

  return (
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
          <>
            {/* RIDING-COMPLEX-FEEDBACK-VIEW - only rendered when this
                editor was reached via "לפי שיבוץ הרכיבה" (activeStudentsTab
                survives opening/closing a trainee editor - see its own
                state comment above). Deliberately routes through the SAME
                requestClose() the modal's own X/backdrop-close already
                uses (save-then-navigate for an editor, direct navigate for
                a view-only instructor, stays open with the error shown on
                a failed save) - not a second, less-safe "just go back"
                implementation. StudentEditor itself and its own existing
                "› חזרה לרשימה" (discard, unchanged) are untouched either
                way. */}
            {activeStudentsTab === "schedule" && (
              <button
                type="button"
                onClick={() => studentEditorRef.current?.requestClose()}
                className="mb-2 self-start text-sm font-medium text-primary underline decoration-dotted"
              >
                › חזרה לשיבוץ הרכיבה
              </button>
            )}
            {/* Keyed by studentId so switching trainees remounts StudentEditor
                instead of reusing the same instance - without this, its
                useState-initialized fields (note, rating, ...) would keep the
                previous trainee's in-progress edits after the row prop changes,
                showing/leaking them under the newly-selected trainee. */}
            <StudentEditor
              key={editingStudent.studentId}
              ref={studentEditorRef}
              row={editingStudent}
              ridingSlotId={openActivity!.ridingSlot!.id}
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
          </>
        ) : (
          <>
            {isComplexModeForOpenActivity && (
              <div role="tablist" aria-label="תצוגת חניכים" className="mb-3 flex gap-2 text-sm">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeStudentsTab === "list"}
                  onClick={() => setActiveStudentsTab("list")}
                  className={`rounded-full px-3 py-1.5 font-medium ${
                    activeStudentsTab === "list"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  צפייה בחניכים
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeStudentsTab === "schedule"}
                  onClick={() => setActiveStudentsTab("schedule")}
                  className={`rounded-full px-3 py-1.5 font-medium ${
                    activeStudentsTab === "schedule"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  לפי שיבוץ הרכיבה
                </button>
              </div>
            )}
            {activeStudentsTab === "schedule" && isComplexModeForOpenActivity ? (
              <ComplexScheduleFeedbackView
                status={complexPlanForFeedbackStatus}
                plan={complexPlanForFeedback}
                slotStudents={slotStudents}
                onOpenTrainee={(row) => setEditingStudent(row)}
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
          </>
        )}
      </div>
    </Modal>
  );
}
