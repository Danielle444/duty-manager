"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { SearchableSelect, type SearchableSelectOption } from "@/lib/components/SearchableSelect";
import { formatHebrewDate, formatHebrewWeekday, parseDateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";
import {
  addMinutesToTimeString,
  TEACHING_PRACTICE_DURATION_MINUTES,
  TEACHING_PRACTICE_TEAM_SIZE,
  type TeachingPracticeRoleValue,
  type TeachingPracticeTypeValue,
} from "@/lib/teaching-practice-rotation";
import {
  createTeachingPracticeChildAsAdmin,
  createTeachingPracticeChildAsInstructor,
  createTeachingPracticeGroupBlockAsAdmin,
  createTeachingPracticeGroupBlockAsInstructor,
  createTeachingPracticeTrackAsAdmin,
  createTeachingPracticeTrackAsInstructor,
  deleteTeachingPracticeTrackAsAdmin,
  deleteTeachingPracticeTrackAsInstructor,
  generateTeachingPracticeLessonFromTrackAsAdmin,
  generateTeachingPracticeLessonFromTrackAsInstructor,
  getTeachingPracticeLessonDetailForAdmin,
  getTeachingPracticeLessonDetailForInstructor,
  getTeachingPracticeScheduleCheckForAdmin,
  listTeachingPracticeChildrenForAdmin,
  listTeachingPracticeChildrenForInstructor,
  listTeachingPracticeLessonsForAdmin,
  listTeachingPracticeLessonsForInstructor,
  listTeachingPracticeTracksForAdmin,
  listTeachingPracticeTracksForInstructor,
  setTeachingPracticeChildActiveAsAdmin,
  setTeachingPracticeChildActiveAsInstructor,
  setTeachingPracticeLessonPublishedAsAdmin,
  setTeachingPracticeLessonPublishedAsInstructor,
  setTeachingPracticeTrackActiveAsAdmin,
  setTeachingPracticeTrackActiveAsInstructor,
  setTeachingPracticeTrackChildrenAsAdmin,
  setTeachingPracticeTrackChildrenAsInstructor,
  setTeachingPracticeTrackTraineesAsAdmin,
  setTeachingPracticeTrackTraineesAsInstructor,
  updateTeachingPracticeChildAsAdmin,
  updateTeachingPracticeChildAsInstructor,
  updateTeachingPracticeLessonAsAdmin,
  updateTeachingPracticeLessonAsInstructor,
  updateTeachingPracticeTrackAsAdmin,
  updateTeachingPracticeTrackAsInstructor,
  type TeachingPracticeChildInput,
  type TeachingPracticeChildRow,
  type TeachingPracticeGroupBlockInput,
  type TeachingPracticeLessonDetail,
  type TeachingPracticeLessonInput,
  type TeachingPracticeLessonSummary,
  type TeachingPracticeScheduleCheckResult,
  type TeachingPracticeTrackInput,
  type TeachingPracticeTrackSummary,
} from "@/lib/actions/teaching-practice";
import {
  commitTeachingPracticeChildrenImportAsAdmin,
  commitTeachingPracticeChildrenImportAsInstructor,
  parseTeachingPracticeChildrenExcelAsAdmin,
  parseTeachingPracticeChildrenExcelAsInstructor,
  type ChildImportRowAction,
  type TeachingPracticeChildImportCandidate,
} from "@/lib/actions/teaching-practice-child-import";

type Role = "admin" | "instructor";
type Tab = "tracks" | "lessons" | "children" | "scheduleCheck";

const TAB_LABELS: Record<Tab, string> = {
  tracks: "מבנה קבוע",
  lessons: "שיעורים שנוצרו",
  children: "ילדים",
  scheduleCheck: "בדיקת שיבוץ",
};

const TRAINEE_SCHEDULE_CHECK_WARNING_LABELS: Record<"overlap" | "short_gap", string> = {
  overlap: "חפיפה בזמנים",
  short_gap: "מרווח קצר מדי בין התנסויות",
};

const HORSE_SCHEDULE_CHECK_WARNING_LABELS: Record<"overlap" | "short_gap", string> = {
  overlap: "חפיפה בזמנים",
  short_gap: "מרווח קצר מדי בין שימושים בסוס",
};

type ScheduleCheckSubTab = "trainees" | "horses";
const SCHEDULE_CHECK_SUB_TAB_LABELS: Record<ScheduleCheckSubTab, string> = {
  trainees: "חניכים",
  horses: "סוסים",
};

const PRACTICE_TYPE_LABELS: Record<TeachingPracticeTypeValue, string> = {
  LUNGE: "לונג׳",
  BEGINNER_PRIVATE: "שיעור פרטי מתחילים",
  BEGINNER_GROUP: "שיעור קבוצתי מתחילים",
};
const PRACTICE_TYPES: TeachingPracticeTypeValue[] = ["LUNGE", "BEGINNER_PRIVATE", "BEGINNER_GROUP"];

const ROLE_LABELS: Record<TeachingPracticeRoleValue, string> = {
  LEAD_INSTRUCTOR: "מדריך ראשון",
  SECOND_INSTRUCTOR: "מדריך שני",
  ASSISTANT_INSTRUCTOR: "עוזר מדריך",
  EVALUATOR: "ממשב",
};

const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// The only two real course groups (matches Student.groupName's existing
// values) - a fixed select instead of free text, so the group reliably
// filters trainee options below and can never drift from what
// Student.groupName actually contains.
const GROUP_OPTIONS: { value: string; label: string }[] = [
  { value: "א", label: "קבוצה א" },
  { value: "ב", label: "קבוצה ב" },
];

// Stage B (+ correction): column visibility for the LUNGE / Beginners-block /
// unlinked-private tables in the "tracks" tab only - a pure client-side
// display preference (localStorage), never sent to the server, never
// affecting which data is fetched. Every column in every one of these three
// tables is toggleable now, including the ones that used to be permanently
// visible - a single key drives the identically-meaning column in every
// table it appears in (e.g. "טלפון" hides everywhere at once), except the
// three time columns, which get their own key each since "שעה"/"שעה
// לקבוצתי"/"שעה לפרטני" are visually/positionally distinct per table (see
// TABLE_COLUMN_KEYS below for exactly which keys apply to which table).
type TrackColumnKey =
  | "lungeTime"
  | "groupTime"
  | "privateTime"
  | "leadTrainee"
  | "assistantTrainee"
  | "childFirstName"
  | "childLastName"
  | "age"
  | "gender"
  | "horse"
  | "equipment"
  | "parentName"
  | "parentPhone";

// "חניך מדריך" (LUNGE) and "חניך מתרגל" (Beginners/unlinked) share one key
// (leadTrainee) per the product decision - same slot-0 concept, just a
// different Hebrew word per practice type - so the panel shows both words
// together for that one entry.
const ALL_TRACK_COLUMNS: { key: TrackColumnKey; label: string }[] = [
  { key: "lungeTime", label: "שעה (לונג׳)" },
  { key: "groupTime", label: "שעה לקבוצתי" },
  { key: "privateTime", label: "שעה לפרטני" },
  { key: "leadTrainee", label: "חניך מדריך / חניך מתרגל" },
  { key: "assistantTrainee", label: "עוזר מדריך" },
  { key: "childFirstName", label: "שם הילד" },
  { key: "childLastName", label: "שם משפחה" },
  { key: "age", label: "גיל" },
  { key: "gender", label: "מין" },
  { key: "horse", label: "סוס" },
  { key: "equipment", label: "ציוד" },
  { key: "parentName", label: "שם ההורה" },
  { key: "parentPhone", label: "טלפון" },
];

// Which columns actually appear in each table - used both for the "don't
// let a table go fully empty" safety rule and for min-width/colSpan math.
// Beginners' own "פרטני" side (everything except groupTime) is exposed
// separately since the merged header/empty-block colSpan only ever needs to
// span that side, not the group column too.
const LUNGE_COLUMN_KEYS: TrackColumnKey[] = [
  "lungeTime",
  "leadTrainee",
  "assistantTrainee",
  "childFirstName",
  "childLastName",
  "age",
  "gender",
  "horse",
  "equipment",
  "parentName",
  "parentPhone",
];
const BEGINNER_PRIVATE_SIDE_COLUMN_KEYS: TrackColumnKey[] = [
  "privateTime",
  "leadTrainee",
  "assistantTrainee",
  "childFirstName",
  "childLastName",
  "age",
  "gender",
  "horse",
  "equipment",
  "parentName",
  "parentPhone",
];
const BEGINNER_BLOCK_COLUMN_KEYS: TrackColumnKey[] = ["groupTime", ...BEGINNER_PRIVATE_SIDE_COLUMN_KEYS];
const UNLINKED_COLUMN_KEYS: TrackColumnKey[] = BEGINNER_PRIVATE_SIDE_COLUMN_KEYS;

const TABLES_BY_COLUMN_KEYS: TrackColumnKey[][] = [
  LUNGE_COLUMN_KEYS,
  BEGINNER_BLOCK_COLUMN_KEYS,
  UNLINKED_COLUMN_KEYS,
];

type TrackColumnVisibility = Record<TrackColumnKey, boolean>;

// Nothing hidden until the user deliberately hides something - a first-time
// visitor (or anyone whose stored preference fails to parse) always sees
// every column.
const DEFAULT_TRACK_COLUMN_VISIBILITY: TrackColumnVisibility = {
  lungeTime: true,
  groupTime: true,
  privateTime: true,
  leadTrainee: true,
  assistantTrainee: true,
  childFirstName: true,
  childLastName: true,
  age: true,
  gender: true,
  horse: true,
  equipment: true,
  parentName: true,
  parentPhone: true,
};

// Bumped to v2 - the column set changed shape (every column is now part of
// this map, not just the previously-optional ones), so an old v1 value
// would otherwise be silently misread as "these newly-hideable columns are
// hidden" for anyone who'd previously hidden something. A fresh key means
// everyone simply starts over at all-visible, which matches "all columns
// visible by default" regardless of any prior v1 preference.
const TRACK_COLUMN_VISIBILITY_STORAGE_KEY = "duty-manager:teaching-practice-columns:v2";

// Reads the stored preference defensively: missing key, malformed JSON, a
// non-object value, or unknown/non-boolean fields all safely fall back to
// "visible" for that column rather than throwing - a corrupt or foreign
// localStorage value can never crash this screen or hide a column the user
// never asked to hide. Only known keys are ever copied over, so a future
// rename/removal of a column key just makes the stale stored value inert
// instead of leaking unexpected keys into state.
function loadTrackColumnVisibility(): TrackColumnVisibility {
  if (typeof window === "undefined") return DEFAULT_TRACK_COLUMN_VISIBILITY;
  try {
    const raw = window.localStorage.getItem(TRACK_COLUMN_VISIBILITY_STORAGE_KEY);
    if (!raw) return DEFAULT_TRACK_COLUMN_VISIBILITY;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_TRACK_COLUMN_VISIBILITY;
    const next = { ...DEFAULT_TRACK_COLUMN_VISIBILITY };
    for (const col of ALL_TRACK_COLUMNS) {
      const value = (parsed as Record<string, unknown>)[col.key];
      if (typeof value === "boolean") next[col.key] = value;
    }
    return next;
  } catch {
    return DEFAULT_TRACK_COLUMN_VISIBILITY;
  }
}

// Safety rule: a table may never end up with zero visible columns. Checked
// against every table a given key belongs to (a shared key like "גיל"
// affects three tables at once) - if hiding this key would leave ANY of
// them empty, the toggle is refused outright rather than silently
// re-showing something else to compensate.
function wouldEmptyAnyTrackTable(next: TrackColumnVisibility): boolean {
  return TABLES_BY_COLUMN_KEYS.some((keys) => !keys.some((key) => next[key]));
}

// Rough per-column width budget for table min-width - not pixel-exact, just
// enough that hiding columns visibly gives back horizontal space instead of
// leaving the table stretched to its old width. Sticky-column/RTL behavior
// itself is untouched by this - only the number fed into min-width changes,
// and if the sticky (first/time) column itself is hidden, the table simply
// loses its pinned-while-scrolling column until it's shown again - it stays
// fully usable either way, just without that one convenience.
const COLUMN_MIN_WIDTH_PX = 75;
const TABLE_MIN_WIDTH_BASE_PX = 160;

function visibleColumnCount(keys: TrackColumnKey[], visibility: TrackColumnVisibility): number {
  return keys.filter((key) => visibility[key]).length;
}

function trackTableMinWidthPx(keys: TrackColumnKey[], visibility: TrackColumnVisibility): number {
  return TABLE_MIN_WIDTH_BASE_PX + visibleColumnCount(keys, visibility) * COLUMN_MIN_WIDTH_PX;
}

// Stage C: which column is currently "the" sticky (pinned-while-scrolling)
// one per table. Deliberately NOT "the first visible column, whichever one
// that is" - that would mean every one of a table's 11-12 columns needs its
// own sticky-styling variant (background/z-index) for what's normally a
// rare situation. Instead each table gets a short, ordered list of the two
// columns most likely to be first (its own time column(s), then the lead-
// trainee column) - sticky falls through this list to the first one still
// visible, and if the user hides both, the table simply has no sticky
// column until one of them is shown again (same graceful degradation as
// before Stage C, just less likely to happen now that there's a fallback).
const LUNGE_STICKY_PRIORITY: TrackColumnKey[] = ["lungeTime", "leadTrainee"];
const BEGINNER_STICKY_PRIORITY: TrackColumnKey[] = ["groupTime", "privateTime", "leadTrainee"];
const UNLINKED_STICKY_PRIORITY: TrackColumnKey[] = ["privateTime", "leadTrainee"];

function stickyColumnKey(
  priority: TrackColumnKey[],
  visibility: TrackColumnVisibility
): TrackColumnKey | null {
  return priority.find((key) => visibility[key]) ?? null;
}

interface StudentOption {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

interface InstructorOption {
  id: string;
  fullName: string;
}

interface TrackFormState {
  practiceType: TeachingPracticeTypeValue;
  groupName: string;
  weekday: string;
  defaultStartTime: string;
  defaultLocation: string;
  defaultResponsibleInstructorId: string;
  // Only meaningful when practiceType === "BEGINNER_PRIVATE" - see
  // validateGroupTrackLink in lib/actions/teaching-practice.ts.
  groupTrackId: string;
  notes: string;
}

function emptyTrackForm(): TrackFormState {
  return {
    practiceType: "LUNGE",
    groupName: "",
    weekday: "",
    defaultStartTime: "",
    defaultLocation: "",
    defaultResponsibleInstructorId: "",
    groupTrackId: "",
    notes: "",
  };
}

function trackToFormState(track: TeachingPracticeTrackSummary): TrackFormState {
  return {
    practiceType: track.practiceType,
    groupName: track.groupName ?? "",
    weekday: track.weekday != null ? String(track.weekday) : "",
    defaultStartTime: track.defaultStartTime,
    defaultLocation: track.defaultLocation ?? "",
    defaultResponsibleInstructorId: track.defaultResponsibleInstructorId ?? "",
    groupTrackId: track.groupTrackId ?? "",
    notes: track.notes ?? "",
  };
}

function trackFormToInput(form: TrackFormState): TeachingPracticeTrackInput {
  return {
    practiceType: form.practiceType,
    groupName: form.groupName || null,
    weekday: form.weekday === "" ? null : Number(form.weekday),
    defaultStartTime: form.defaultStartTime.trim(),
    defaultLocation: form.defaultLocation.trim() || null,
    defaultResponsibleInstructorId: form.defaultResponsibleInstructorId || null,
    groupTrackId: form.practiceType === "BEGINNER_PRIVATE" ? form.groupTrackId || null : null,
    notes: form.notes.trim() || null,
  };
}

// Shown as a live, read-only preview only - the manager never types an end
// time; the real value saved is always computed server-side from the same
// inputs (never trusted from the client).
function previewEndTime(startTime: string, practiceType: TeachingPracticeTypeValue): string {
  return addMinutesToTimeString(startTime, TEACHING_PRACTICE_DURATION_MINUTES[practiceType]) ?? "—";
}

// Display-order comparators for the Beginners block table only (buildBeginnerBlocks/
// buildUnlinkedPrivateTracks) - purely how rows are laid out, never written back
// anywhere. defaultStartTime is "HH:MM", so a plain string compare already sorts
// chronologically; the extra fallback fields only ever matter as tie-breakers when
// two tracks share the exact same start time, so the table has a stable, predictable
// order instead of whatever order the tracks happened to come back from the server.
function compareGroupBlocks(a: TeachingPracticeTrackSummary, b: TeachingPracticeTrackSummary): number {
  return (
    a.defaultStartTime.localeCompare(b.defaultStartTime) ||
    (a.groupName ?? "").localeCompare(b.groupName ?? "") ||
    (a.defaultLocation ?? "").localeCompare(b.defaultLocation ?? "") ||
    a.id.localeCompare(b.id)
  );
}

function compareLinkedPrivateRows(a: TeachingPracticeTrackSummary, b: TeachingPracticeTrackSummary): number {
  return (
    a.defaultStartTime.localeCompare(b.defaultStartTime) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

function compareUnlinkedPrivateRows(a: TeachingPracticeTrackSummary, b: TeachingPracticeTrackSummary): number {
  return (
    a.defaultStartTime.localeCompare(b.defaultStartTime) ||
    (a.groupName ?? "").localeCompare(b.groupName ?? "") ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

// No horse field here on purpose - the "ילדים" registry is identity/contact
// only now; horse/equipment only ever lives at the track/lesson-assignment
// level (see the "ילדים וסוסים במסלול" section below).
interface ChildFormState {
  firstName: string;
  lastName: string;
  age: string;
  gender: string;
  parentName: string;
  parentPhone: string;
  notes: string;
}

function emptyChildForm(): ChildFormState {
  return {
    firstName: "",
    lastName: "",
    age: "",
    gender: "",
    parentName: "",
    parentPhone: "",
    notes: "",
  };
}

function childToFormState(child: TeachingPracticeChildRow): ChildFormState {
  return {
    firstName: child.firstName,
    lastName: child.lastName,
    age: child.age != null ? String(child.age) : "",
    gender: child.gender ?? "",
    parentName: child.parentName ?? "",
    parentPhone: child.parentPhone ?? "",
    notes: child.notes ?? "",
  };
}

function childFormToInput(form: ChildFormState): TeachingPracticeChildInput {
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    age: form.age.trim() === "" ? null : Number(form.age),
    gender: form.gender.trim() || null,
    parentName: form.parentName.trim() || null,
    parentPhone: form.parentPhone.trim() || null,
    notes: form.notes.trim() || null,
  };
}

interface TrackChildFormRow {
  childId: string;
  horseName: string;
  equipmentNotes: string;
}

// Shared by both app/admin/teaching-practice and app/instructor - one
// component adapting via `role` (same pattern as HelpContent/
// CourseMaterialsSection), so the two screens can never drift apart. Server
// actions re-verify every permission themselves; canManageAssignments/
// canManageHorses here only decide what the UI shows/enables.
export function TeachingPracticeManager({
  role,
  actorId,
  canManageAssignments,
  canManageHorses,
  students,
  instructors,
}: {
  role: Role;
  // instructorId when role === "instructor"; unused for role === "admin".
  actorId: string | null;
  canManageAssignments: boolean;
  canManageHorses: boolean;
  students: StudentOption[];
  instructors: InstructorOption[];
}) {
  const canEdit = role === "admin" || canManageAssignments;
  // Read-only fallback for "horse permission only, no assignment permission"
  // (see report) - horse-specific inputs are only ever enabled when canEdit
  // is already true, so this flag alone never unlocks editing on its own.
  const canEditHorseFields = role === "admin" || canManageHorses;

  // Stage A: view/edit mode. canEdit/canEditHorseFields above stay exactly
  // what they always meant ("is this user allowed to edit at all") - they
  // gate whether the edit-mode toggle button even appears. isEditMode is a
  // separate, purely client-side "have they actually turned editing on"
  // switch, always starting false (view-only) on every mount/reload - never
  // persisted, so there is no way to land back in edit mode without
  // deliberately pressing the button again. Every UI edit affordance in this
  // file reads effectiveCanEdit/effectiveCanEditHorseFields, never the bare
  // canEdit/canEditHorseFields, so permission alone is never enough to show
  // a live control - the user must also be in edit mode.
  const [isEditMode, setIsEditMode] = useState(false);
  const effectiveCanEdit = canEdit && isEditMode;
  const effectiveCanEditHorseFields = canEditHorseFields && isEditMode;

  const [tab, setTab] = useState<Tab>("tracks");

  const [tracks, setTracks] = useState<TeachingPracticeTrackSummary[] | null>(null);
  const [lessons, setLessons] = useState<TeachingPracticeLessonSummary[] | null>(null);
  const [children, setChildren] = useState<TeachingPracticeChildRow[] | null>(null);
  // Admin-only (getTeachingPracticeScheduleCheckForAdmin has no instructor
  // variant yet, see report) - fetched lazily on first visit to the tab
  // rather than in the initial Promise.all below, since it's a heavier
  // cross-lesson query most sessions never open. Holds both the trainee and
  // horse timelines together (one fetch, one round trip).
  const [scheduleCheck, setScheduleCheck] = useState<TeachingPracticeScheduleCheckResult | null>(null);
  const [scheduleCheckLoading, setScheduleCheckLoading] = useState(false);
  const [scheduleCheckSubTab, setScheduleCheckSubTab] = useState<ScheduleCheckSubTab>("trainees");

  async function refreshTracks() {
    const fresh =
      role === "admin"
        ? await listTeachingPracticeTracksForAdmin()
        : await listTeachingPracticeTracksForInstructor(actorId!);
    setTracks(fresh);
  }
  async function refreshLessons() {
    const fresh =
      role === "admin"
        ? await listTeachingPracticeLessonsForAdmin()
        : await listTeachingPracticeLessonsForInstructor(actorId!);
    setLessons(fresh);
  }
  async function refreshChildren() {
    const fresh =
      role === "admin"
        ? await listTeachingPracticeChildrenForAdmin()
        : await listTeachingPracticeChildrenForInstructor(actorId!);
    setChildren(fresh);
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      role === "admin" ? listTeachingPracticeTracksForAdmin() : listTeachingPracticeTracksForInstructor(actorId!),
      role === "admin"
        ? listTeachingPracticeLessonsForAdmin()
        : listTeachingPracticeLessonsForInstructor(actorId!),
      role === "admin"
        ? listTeachingPracticeChildrenForAdmin()
        : listTeachingPracticeChildrenForInstructor(actorId!),
    ]).then(([t, l, c]) => {
      if (cancelled) return;
      setTracks(t);
      setLessons(l);
      setChildren(c);
    });
    return () => {
      cancelled = true;
    };
  }, [role, actorId]);

  useEffect(() => {
    if (tab !== "scheduleCheck" || role !== "admin" || scheduleCheck !== null) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScheduleCheckLoading(true);
    getTeachingPracticeScheduleCheckForAdmin()
      .then((data) => {
        if (!cancelled) setScheduleCheck(data);
      })
      .finally(() => {
        if (!cancelled) setScheduleCheckLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, role, scheduleCheck]);

  // Trainees/horses with at least one warning are surfaced first so the panel
  // reads as a punch list rather than a full roster dump - Array#sort is
  // stable, so entries within each group keep the server's alphabetical order.
  const scheduleCheckTraineesSorted = useMemo(() => {
    if (!scheduleCheck) return null;
    return [...scheduleCheck.trainees].sort((a, b) => {
      const aHasWarnings = a.timeline.some((entry) => entry.warnings.length > 0) ? 0 : 1;
      const bHasWarnings = b.timeline.some((entry) => entry.warnings.length > 0) ? 0 : 1;
      return aHasWarnings - bHasWarnings;
    });
  }, [scheduleCheck]);

  const scheduleCheckHorsesSorted = useMemo(() => {
    if (!scheduleCheck) return null;
    return [...scheduleCheck.horses].sort((a, b) => {
      const aHasWarnings = a.timeline.some((entry) => entry.warnings.length > 0) ? 0 : 1;
      const bHasWarnings = b.timeline.some((entry) => entry.warnings.length > 0) ? 0 : 1;
      return aHasWarnings - bHasWarnings;
    });
  }, [scheduleCheck]);

  // Grouped by date for display only (already sorted [date, startTime] by
  // the server) - parallel lessons at the same date/time are never merged,
  // just rendered as separate cards under one shared date header.
  const lessonsByDate = useMemo(() => {
    if (!lessons) return [];
    const map = new Map<string, TeachingPracticeLessonSummary[]>();
    for (const lesson of lessons) {
      if (!map.has(lesson.date)) map.set(lesson.date, []);
      map.get(lesson.date)!.push(lesson);
    }
    return Array.from(map.entries());
  }, [lessons]);

  // -------------------------------------------------------------------------
  // Tracks: fixed-structure assignment tables (LUNGE, and BEGINNER_PRIVATE +
  // BEGINNER_GROUP combined - "the same beginner-children flow")
  // -------------------------------------------------------------------------

  // Cross-reference from the assignment-level TeachingPracticeTrackChild (has
  // horseName/equipmentNotes) to the child-registry row (has
  // firstName/lastName/age/gender/parentName/parentPhone) - the table needs
  // fields from both, but they only ever join on childId.
  const childById = useMemo(() => new Map((children ?? []).map((c) => [c.id, c])), [children]);

  // groupTrackId is only ever set on a BEGINNER_PRIVATE track - this maps
  // each BEGINNER_GROUP track's id to every private track linking to it, so
  // the Beginners table can render one block per group track with its
  // linked private tracks nested as sub-rows (see buildBeginnerBlocks).
  const feedingPrivateTracksByGroupId = useMemo(() => {
    const map = new Map<string, TeachingPracticeTrackSummary[]>();
    for (const t of tracks ?? []) {
      if (t.practiceType === "BEGINNER_PRIVATE" && t.groupTrackId) {
        if (!map.has(t.groupTrackId)) map.set(t.groupTrackId, []);
        map.get(t.groupTrackId)!.push(t);
      }
    }
    return map;
  }, [tracks]);

  type TableGroupFilter = "all" | "א" | "ב";
  const [tableGroupFilter, setTableGroupFilter] = useState<TableGroupFilter>("all");

  function sectionVisible(groupValue: string | null): boolean {
    if (tableGroupFilter === "all") return true;
    return groupValue === tableGroupFilter;
  }

  // Column visibility (Stage B) - starts at "everything visible" on every
  // render (including the server-rendered first paint) and only switches to
  // the user's stored preference after mount, in its own effect - loading
  // localStorage directly in the initial useState would run during SSR too
  // (no window there) and risks a hydration mismatch if the client's first
  // render already reflected a "some columns hidden" preference. Same
  // pattern already used for the instructor/student session read in
  // InstructorClient/StudentClient.
  const [columnVisibility, setColumnVisibility] = useState<TrackColumnVisibility>(
    DEFAULT_TRACK_COLUMN_VISIBILITY
  );
  const [isColumnPanelOpen, setIsColumnPanelOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setColumnVisibility(loadTrackColumnVisibility());
  }, []);

  function persistColumnVisibility(next: TrackColumnVisibility) {
    setColumnVisibility(next);
    try {
      window.localStorage.setItem(TRACK_COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable/full (private browsing, quota, etc.) - the
      // choice still applies for this session via state, it just won't
      // survive a reload. Never lets a storage failure break the toggle.
    }
  }

  // Turning a column ON can never empty a table, so the safety check only
  // ever runs when turning one OFF - the toggle is simply ignored (state
  // untouched) if doing so would leave some table with zero visible columns.
  function toggleTrackColumn(key: TrackColumnKey) {
    const next = { ...columnVisibility, [key]: !columnVisibility[key] };
    if (!next[key] && wouldEmptyAnyTrackTable(next)) return;
    persistColumnVisibility(next);
  }

  // Whether unchecking this column right now would empty some table - used
  // to disable that checkbox in the panel instead of letting the user click
  // it and see nothing happen with no explanation.
  function isLastVisibleTrackColumn(key: TrackColumnKey): boolean {
    if (!columnVisibility[key]) return false;
    return TABLES_BY_COLUMN_KEYS.some(
      (keys) => keys.includes(key) && visibleColumnCount(keys, columnVisibility) === 1
    );
  }

  function showAllTrackColumns() {
    persistColumnVisibility(DEFAULT_TRACK_COLUMN_VISIBILITY);
  }

  // Computed once per render (not per section/block) since none of these
  // depend on anything but the current column visibility.
  const lungeStickyKey = stickyColumnKey(LUNGE_STICKY_PRIORITY, columnVisibility);
  const beginnerStickyKey = stickyColumnKey(BEGINNER_STICKY_PRIORITY, columnVisibility);
  const unlinkedStickyKey = stickyColumnKey(UNLINKED_STICKY_PRIORITY, columnVisibility);

  function joinAssignmentField(values: (string | number | null)[]): string {
    if (values.length === 0) return "—";
    return values.map((v) => (v == null || v === "" ? "—" : String(v))).join(" / ");
  }

  // The per-track data every table row needs, regardless of table shape -
  // team slots (padded to the practiceType's team size, for inline
  // SearchableSelect binding), the roster summary, and the child/parent/
  // horse/equipment fields (joined with " / " if a track ever has more than
  // one assigned child - normally 0 or 1 for these practice types). Shared
  // between the flat LUNGE table and the block-structured Beginners table
  // so both read from one place.
  function buildTrackRowData(track: TeachingPracticeTrackSummary) {
    const teamSize = TEACHING_PRACTICE_TEAM_SIZE[track.practiceType];
    const sortedTrainees = [...track.trainees].sort((a, b) => a.rotationOrder - b.rotationOrder);
    const traineeIdsBySlot = Array.from({ length: teamSize }, (_, i) => sortedTrainees[i]?.traineeId ?? "");
    // Slot-0's name specifically ("חניך מתרגל") is what the Beginners
    // block table derives its group-level roster from - a private track's
    // own slot-0 trainee is the one tied to that specific child.
    const traineeNamesBySlot = Array.from({ length: teamSize }, (_, i) => sortedTrainees[i]?.fullName ?? "—");
    const rosterSummary = sortedTrainees.length > 0 ? sortedTrainees.map((t) => t.fullName).join(", ") : "—";
    const childRows = track.children.map((tc) => ({
      registryChild: childById.get(tc.childId) ?? null,
      trackChild: tc,
    }));
    return {
      track,
      traineeIdsBySlot,
      traineeNamesBySlot,
      rosterSummary,
      childFirstName: joinAssignmentField(childRows.map((c) => c.registryChild?.firstName ?? null)),
      childLastName: joinAssignmentField(childRows.map((c) => c.registryChild?.lastName ?? null)),
      childAge: joinAssignmentField(childRows.map((c) => c.registryChild?.age ?? null)),
      childGender: joinAssignmentField(childRows.map((c) => c.registryChild?.gender ?? null)),
      horseName: joinAssignmentField(childRows.map((c) => c.trackChild.horseName)),
      equipmentNotes: joinAssignmentField(childRows.map((c) => c.trackChild.equipmentNotes)),
      parentName: joinAssignmentField(childRows.map((c) => c.registryChild?.parentName ?? null)),
      parentPhone: joinAssignmentField(childRows.map((c) => c.registryChild?.parentPhone ?? null)),
    };
  }

  // Used only by the flat LUNGE table now - one row per slot, sorted by
  // start time. The Beginners table below uses buildBeginnerBlocks/
  // buildUnlinkedPrivateTracks instead, since it's no longer a flat list.
  function buildAssignmentRows(practiceType: TeachingPracticeTypeValue, groupValue: string | null) {
    if (!tracks) return [];
    return tracks
      .filter((t) => t.practiceType === practiceType && (t.groupName ?? null) === groupValue)
      .slice()
      .sort((a, b) => a.defaultStartTime.localeCompare(b.defaultStartTime))
      .map((track) => ({ key: track.id, ...buildTrackRowData(track) }));
  }

  type TrackRowData = ReturnType<typeof buildTrackRowData>;

  // One block per BEGINNER_GROUP track. Block "height" is the number of
  // BEGINNER_PRIVATE tracks linking to it via groupTrackId (min 1, so a
  // not-yet-linked group track still renders as its own one-row block
  // rather than disappearing). Membership is purely link-based - a private
  // track's own groupName isn't re-filtered here, so a deliberate cross-
  // group link (flagged in the drawer) still shows up in its block.
  //
  // The group track's own trainee team (if the drawer's generic team editor
  // was ever used on it) is deliberately NOT read here - trainee assignment
  // happens on the private rows, since each trainee is tied to the specific
  // child they teach privately. groupRosterLines is instead derived purely
  // from each linked private row's own slot-0 ("חניך מתרגل") trainee, shown
  // stacked one per line, with "—" for a private row that doesn't have one
  // yet. This is a read-only, display-only derivation - there is no
  // separate group-level team to edit in this view (see the drawer for the
  // group track's own skeleton fields, which remain editable there).
  function buildBeginnerBlocks(groupValue: string | null) {
    if (!tracks) return [];
    return tracks
      .filter((t) => t.practiceType === "BEGINNER_GROUP" && (t.groupName ?? null) === groupValue)
      .slice()
      .sort(compareGroupBlocks)
      .map((groupTrack) => {
        const privateTracks = (feedingPrivateTracksByGroupId.get(groupTrack.id) ?? [])
          .slice()
          .sort(compareLinkedPrivateRows);
        const privateRows = privateTracks.map((t) => ({ key: t.id, ...buildTrackRowData(t) }));
        return {
          key: groupTrack.id,
          groupTrack,
          privateRows,
          groupRosterLines:
            privateRows.length > 0 ? privateRows.map((p) => p.traineeNamesBySlot[0] ?? "—") : ["—"],
        };
      });
  }

  // BEGINNER_PRIVATE tracks with no groupTrackId at all - shown in their own
  // trailing "ללא שיוך" list beneath the blocks so they're never silently
  // hidden just because they haven't been linked yet.
  function buildUnlinkedPrivateTracks(groupValue: string | null): (TrackRowData & { key: string })[] {
    if (!tracks) return [];
    return tracks
      .filter((t) => t.practiceType === "BEGINNER_PRIVATE" && (t.groupName ?? null) === groupValue && !t.groupTrackId)
      .slice()
      .sort(compareUnlinkedPrivateRows)
      .map((t) => ({ key: t.id, ...buildTrackRowData(t) }));
  }

  // A slot created without picking א/ב would otherwise vanish from every
  // table entirely (silently, with no error) - these catch-all groups only
  // get rendered when that's actually happened, so nothing is ever hidden
  // without a visible trace. Only shown under the "all" filter, since they
  // don't belong to either א or ב.
  const hasUngroupedLunge = useMemo(
    () => (tracks ?? []).some((t) => t.practiceType === "LUNGE" && !t.groupName),
    [tracks]
  );
  const hasUngroupedBeginner = useMemo(
    () =>
      (tracks ?? []).some(
        (t) => (t.practiceType === "BEGINNER_PRIVATE" || t.practiceType === "BEGINNER_GROUP") && !t.groupName
      ),
    [tracks]
  );

  // -------------------------------------------------------------------------
  // Tracks: create
  // -------------------------------------------------------------------------

  const MAX_PARALLEL_SLOT_QUANTITY = 10;

  const [isAddSlotOpen, setIsAddSlotOpen] = useState(false);
  const [newTrackForm, setNewTrackForm] = useState<TrackFormState>(emptyTrackForm());
  // Kept as its own field, not part of TrackFormState/TeachingPracticeTrackInput
  // - it's a client-side "how many times to call create" instruction, never
  // sent to the server and never stored anywhere. Parallel lessons remain
  // represented purely as multiple TeachingPracticeTrack rows, not a count.
  const [parallelQuantity, setParallelQuantity] = useState("1");
  const [createTrackError, setCreateTrackError] = useState<string | null>(null);
  const [createTrackSuccess, setCreateTrackSuccess] = useState<string | null>(null);
  const [isCreatingTrack, startCreateTrackTransition] = useTransition();

  // Creates `quantity` identical tracks (same practiceType/group/weekday/
  // time/location/responsible instructor/notes) sequentially - never
  // Promise.all - so a failure partway through is easy to attribute and the
  // already-created rows aren't left in an ambiguous state. Each created row
  // is independently editable afterward (its own team/child/horse/
  // equipment), exactly like any other track.
  function handleCreateTrack() {
    setCreateTrackError(null);
    setCreateTrackSuccess(null);
    const input = trackFormToInput(newTrackForm);
    const quantity = Math.min(
      MAX_PARALLEL_SLOT_QUANTITY,
      Math.max(1, Math.trunc(Number(parallelQuantity)) || 1)
    );
    startCreateTrackTransition(async () => {
      let createdCount = 0;
      for (let i = 0; i < quantity; i++) {
        const result =
          role === "admin"
            ? await createTeachingPracticeTrackAsAdmin(input)
            : await createTeachingPracticeTrackAsInstructor(actorId!, input);
        if (!result.success) {
          setCreateTrackError(
            createdCount > 0
              ? `נוצרו ${createdCount} סלוטים לפני שאירעה שגיאה: ${result.error ?? "אירעה שגיאה"}`
              : (result.error ?? "אירעה שגיאה")
          );
          await refreshTracks();
          return;
        }
        createdCount += 1;
      }
      setNewTrackForm(emptyTrackForm());
      setParallelQuantity("1");
      setCreateTrackSuccess(createdCount === 1 ? "נוצר סלוט אחד" : `נוצרו ${createdCount} סלוטים מקבילים`);
      setIsAddSlotOpen(false);
      await refreshTracks();
    });
  }

  // -------------------------------------------------------------------------
  // Tracks: create a beginner group block (1 BEGINNER_GROUP + N linked
  // BEGINNER_PRIVATE tracks in one atomic server action)
  // -------------------------------------------------------------------------

  const DEFAULT_GROUP_BLOCK_PRIVATE_COUNT = "3";

  interface GroupBlockFormState {
    groupName: string;
    weekday: string;
    groupStartTime: string;
    privateStartTime: string;
    defaultLocation: string;
    defaultResponsibleInstructorId: string;
    notes: string;
    privateCount: string;
  }

  const emptyGroupBlockForm = (): GroupBlockFormState => ({
    groupName: "",
    weekday: "",
    groupStartTime: "",
    privateStartTime: "",
    defaultLocation: "",
    defaultResponsibleInstructorId: "",
    notes: "",
    privateCount: DEFAULT_GROUP_BLOCK_PRIVATE_COUNT,
  });

  const [isAddGroupBlockOpen, setIsAddGroupBlockOpen] = useState(false);
  const [groupBlockForm, setGroupBlockForm] = useState<GroupBlockFormState>(emptyGroupBlockForm());
  const [createGroupBlockError, setCreateGroupBlockError] = useState<string | null>(null);
  const [createGroupBlockSuccess, setCreateGroupBlockSuccess] = useState<string | null>(null);
  const [isCreatingGroupBlock, startCreateGroupBlockTransition] = useTransition();

  function handleCreateGroupBlock() {
    setCreateGroupBlockError(null);
    setCreateGroupBlockSuccess(null);
    const input: TeachingPracticeGroupBlockInput = {
      groupName: groupBlockForm.groupName,
      weekday: groupBlockForm.weekday === "" ? null : Number(groupBlockForm.weekday),
      groupStartTime: groupBlockForm.groupStartTime.trim(),
      privateStartTime: groupBlockForm.privateStartTime.trim(),
      defaultLocation: groupBlockForm.defaultLocation.trim() || null,
      defaultResponsibleInstructorId: groupBlockForm.defaultResponsibleInstructorId || null,
      notes: groupBlockForm.notes.trim() || null,
      privateCount: Number(groupBlockForm.privateCount) || 3,
    };
    startCreateGroupBlockTransition(async () => {
      const result =
        role === "admin"
          ? await createTeachingPracticeGroupBlockAsAdmin(input)
          : await createTeachingPracticeGroupBlockAsInstructor(actorId!, input);
      if (!result.success) {
        setCreateGroupBlockError(result.error ?? "אירעה שגיאה");
        return;
      }
      setGroupBlockForm(emptyGroupBlockForm());
      setCreateGroupBlockSuccess(
        `נוצר בלוק שיעור קבוצתי עם ${result.privateTrackIds?.length ?? input.privateCount} שיעורים פרטיים`
      );
      setIsAddGroupBlockOpen(false);
      await refreshTracks();
    });
  }

  // -------------------------------------------------------------------------
  // Tracks: per-track manager (edit fields / team / children / generate)
  // -------------------------------------------------------------------------

  const [openTrackId, setOpenTrackId] = useState<string | null>(null);
  const [editTrackForm, setEditTrackForm] = useState<TrackFormState>(emptyTrackForm());
  const [teamSelections, setTeamSelections] = useState<string[]>([]);
  const [trackChildRows, setTrackChildRows] = useState<TrackChildFormRow[]>([]);
  const [lessonDateDraft, setLessonDateDraft] = useState("");
  const [lessonDates, setLessonDates] = useState<string[]>([]);
  const [trackActionError, setTrackActionError] = useState<string | null>(null);
  const [trackActionSuccess, setTrackActionSuccess] = useState<string | null>(null);
  const [isTrackActionPending, startTrackActionTransition] = useTransition();

  // Re-looked-up from the live `tracks` list (rather than snapshotting the
  // track object at open-time) so the drawer always reflects the latest
  // refresh - e.g. right after handleSaveTrackFields awaits refreshTracks().
  const openTrack = tracks?.find((t) => t.id === openTrackId) ?? null;

  function openTrackManager(track: TeachingPracticeTrackSummary) {
    setOpenTrackId(track.id);
    setEditTrackForm(trackToFormState(track));
    const sortedTraineeIds = [...track.trainees]
      .sort((a, b) => a.rotationOrder - b.rotationOrder)
      .map((t) => t.traineeId);
    setTeamSelections(sortedTraineeIds);
    setTrackChildRows(
      track.children.map((c) => ({
        childId: c.childId,
        horseName: c.horseName ?? "",
        equipmentNotes: c.equipmentNotes ?? "",
      }))
    );
    setLessonDateDraft("");
    setLessonDates([]);
    setTrackActionError(null);
    setTrackActionSuccess(null);
  }

  function closeTrackManager() {
    setOpenTrackId(null);
  }

  function handleSaveTrackFields() {
    if (!openTrackId) return;
    setTrackActionError(null);
    setTrackActionSuccess(null);
    const input = trackFormToInput(editTrackForm);
    startTrackActionTransition(async () => {
      const result =
        role === "admin"
          ? await updateTeachingPracticeTrackAsAdmin(openTrackId, input)
          : await updateTeachingPracticeTrackAsInstructor(actorId!, openTrackId, input);
      if (!result.success) {
        setTrackActionError(result.error ?? "אירעה שגיאה");
        return;
      }
      setTrackActionSuccess("פרטי המסלול עודכנו");
      await refreshTracks();
    });
  }

  function handleToggleTrackActive(track: TeachingPracticeTrackSummary) {
    startTrackActionTransition(async () => {
      const result =
        role === "admin"
          ? await setTeachingPracticeTrackActiveAsAdmin(track.id, !track.isActive)
          : await setTeachingPracticeTrackActiveAsInstructor(actorId!, track.id, !track.isActive);
      if (!result.success) {
        setTrackActionError(result.error ?? "אירעה שגיאה");
        return;
      }
      await refreshTracks();
    });
  }

  // Only ever succeeds server-side when the track is genuinely empty (no
  // lessons/trainees/children, and - for a BEGINNER_GROUP track - no linked
  // private tracks); the confirm dialog is just a UX safeguard against an
  // accidental click, not the real safety check.
  function handleDeleteTrack(track: TeachingPracticeTrackSummary) {
    if (!window.confirm("למחוק את הסלוט הזה? הפעולה בלתי הפיכה.")) return;
    setTrackActionError(null);
    setTrackActionSuccess(null);
    startTrackActionTransition(async () => {
      const result =
        role === "admin"
          ? await deleteTeachingPracticeTrackAsAdmin(track.id)
          : await deleteTeachingPracticeTrackAsInstructor(actorId!, track.id);
      if (!result.success) {
        setTrackActionError(result.error ?? "אירעה שגיאה");
        return;
      }
      closeTrackManager();
      await refreshTracks();
    });
  }

  // Trainee options for team-selection slot `index`, filtered by the
  // edit form's currently-chosen group - but if that slot already has a
  // selected trainee who no longer matches (e.g. the group was just
  // changed), that trainee stays in the list (marked) rather than silently
  // disappearing, so the manager sees and can correct it intentionally
  // instead of losing the selection without noticing.
  function teamOptionsForSlot(groupName: string, selectedId: string): StudentOption[] {
    const filtered = groupName ? students.filter((s) => s.groupName === groupName) : students;
    if (selectedId && !filtered.some((s) => s.id === selectedId)) {
      const selected = students.find((s) => s.id === selectedId);
      if (selected) return [selected, ...filtered];
    }
    return filtered;
  }

  // Same group-filtered-with-visible-outlier options as teamOptionsForSlot,
  // shaped for the inline SearchableSelect cells in the assignment tables.
  function traineeSelectOptions(
    track: TeachingPracticeTrackSummary,
    selectedId: string
  ): SearchableSelectOption[] {
    const groupName = track.groupName ?? "";
    return teamOptionsForSlot(groupName, selectedId).map((s) => ({
      value: s.id,
      label: `${s.fullName}${s.groupName ? ` (קבוצה ${s.groupName})` : ""}${
        groupName && s.groupName !== groupName ? " - מחוץ לקבוצה שנבחרה" : ""
      }`,
    }));
  }

  // Options for the BEGINNER_PRIVATE-only "שייך/שיוך לשיעור קבוצתי" selects
  // (both the create form and the drawer use this) - existing BEGINNER_GROUP
  // tracks, preferably filtered to the same group and sorted by time, but
  // the currently-selected group track stays visible (marked) even if its
  // group no longer matches, so a real existing link is never silently
  // hidden by the group filter.
  function groupTrackOptionsForLink(groupName: string, selectedId: string): TeachingPracticeTrackSummary[] {
    const groupTracks = (tracks ?? []).filter((t) => t.practiceType === "BEGINNER_GROUP");
    const filtered = (groupName ? groupTracks.filter((t) => (t.groupName ?? "") === groupName) : groupTracks)
      .slice()
      .sort((a, b) => a.defaultStartTime.localeCompare(b.defaultStartTime));
    if (selectedId && !filtered.some((t) => t.id === selectedId)) {
      const selected = groupTracks.find((t) => t.id === selectedId);
      if (selected) return [selected, ...filtered];
    }
    return filtered;
  }

  // e.g. "קבוצה א · קבוצתי 17:00 · חצר האימונים" - shared by both the
  // create-form and drawer group-link selects so their option wording never
  // drifts apart.
  function groupTrackOptionLabel(groupTrack: TeachingPracticeTrackSummary, compareGroupName: string): string {
    const groupLabel = groupTrack.groupName ? `קבוצה ${groupTrack.groupName}` : "ללא קבוצה";
    const locationPart = groupTrack.defaultLocation ? ` · ${groupTrack.defaultLocation}` : "";
    const mismatchPart =
      compareGroupName && (groupTrack.groupName ?? "") !== compareGroupName ? " - קבוצה שונה" : "";
    return `${groupLabel} · קבוצתי ${groupTrack.defaultStartTime}${locationPart}${mismatchPart}`;
  }

  function handleSaveTeam() {
    if (!openTrackId) return;
    setTrackActionError(null);
    setTrackActionSuccess(null);
    const traineeIds = teamSelections.filter((id) => id !== "");
    startTrackActionTransition(async () => {
      const result =
        role === "admin"
          ? await setTeachingPracticeTrackTraineesAsAdmin(openTrackId, traineeIds)
          : await setTeachingPracticeTrackTraineesAsInstructor(actorId!, openTrackId, traineeIds);
      if (!result.success) {
        setTrackActionError(result.error ?? "אירעה שגיאה");
        return;
      }
      setTrackActionSuccess("צוות החניכים עודכן");
      await refreshTracks();
    });
  }

  // -------------------------------------------------------------------------
  // Tracks: inline trainee assignment straight from the assignment tables
  // -------------------------------------------------------------------------

  const [savingCellKey, setSavingCellKey] = useState<string | null>(null);
  const [inlineAssignError, setInlineAssignError] = useState<string | null>(null);
  const [, startInlineAssignTransition] = useTransition();

  // Reuses the exact same setTeachingPracticeTrackTraineesAs* actions as the
  // drawer's team editor (no new action) - rebuilds the track's full
  // trainee-id array in rotation order with just one slot replaced, then
  // saves the whole array, same replace-all semantics the drawer already
  // relies on (including its existing "drop any still-empty slots" filter).
  function handleInlineAssignTrainee(track: TeachingPracticeTrackSummary, slotIndex: number, traineeId: string) {
    const cellKey = `${track.id}-${slotIndex}`;
    const teamSize = TEACHING_PRACTICE_TEAM_SIZE[track.practiceType];
    const sortedIds = [...track.trainees].sort((a, b) => a.rotationOrder - b.rotationOrder).map((t) => t.traineeId);
    const nextIds = Array.from({ length: teamSize }, (_, i) => sortedIds[i] ?? "");
    nextIds[slotIndex] = traineeId;
    const finalIds = nextIds.filter((id) => id !== "");

    setInlineAssignError(null);
    setSavingCellKey(cellKey);
    startInlineAssignTransition(async () => {
      const result =
        role === "admin"
          ? await setTeachingPracticeTrackTraineesAsAdmin(track.id, finalIds)
          : await setTeachingPracticeTrackTraineesAsInstructor(actorId!, track.id, finalIds);
      setSavingCellKey(null);
      if (!result.success) {
        setInlineAssignError(result.error ?? "אירעה שגיאה בשיבוץ החניך/ה");
        return;
      }
      await refreshTracks();
    });
  }

  function addTrackChildRow() {
    setTrackChildRows((prev) => [...prev, { childId: "", horseName: "", equipmentNotes: "" }]);
  }

  function removeTrackChildRow(index: number) {
    setTrackChildRows((prev) => prev.filter((_, i) => i !== index));
  }

  function updateTrackChildRow(index: number, patch: Partial<TrackChildFormRow>) {
    setTrackChildRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function handleSaveTrackChildren() {
    if (!openTrackId) return;
    setTrackActionError(null);
    setTrackActionSuccess(null);
    const rows = trackChildRows
      .filter((r) => r.childId !== "")
      .map((r) => ({
        childId: r.childId,
        horseName: r.horseName.trim() || null,
        equipmentNotes: r.equipmentNotes.trim() || null,
      }));
    startTrackActionTransition(async () => {
      const result =
        role === "admin"
          ? await setTeachingPracticeTrackChildrenAsAdmin(openTrackId, rows)
          : await setTeachingPracticeTrackChildrenAsInstructor(actorId!, openTrackId, rows);
      if (!result.success) {
        setTrackActionError(result.error ?? "אירעה שגיאה");
        return;
      }
      setTrackActionSuccess("רשימת הילדים עודכנה");
      await refreshTracks();
    });
  }

  function addLessonDate() {
    if (!lessonDateDraft) return;
    setLessonDates((prev) => (prev.includes(lessonDateDraft) ? prev : [...prev, lessonDateDraft].sort()));
    setLessonDateDraft("");
  }

  function removeLessonDate(date: string) {
    setLessonDates((prev) => prev.filter((d) => d !== date));
  }

  // Generates one lesson per selected date, sequentially (never
  // Promise.all) - occurrenceIndex/rotation for each date depends on the
  // previous date's lesson having already committed, so calls must be
  // awaited one at a time in order. Stops at the first failure so later
  // dates never compute their rotation against a gap.
  function handleGenerateLessons(track: TeachingPracticeTrackSummary) {
    if (lessonDates.length === 0) {
      setTrackActionError("יש לבחור לפחות תאריך אחד ליצירת שיעור");
      return;
    }
    setTrackActionError(null);
    setTrackActionSuccess(null);
    startTrackActionTransition(async () => {
      let createdCount = 0;
      for (const date of lessonDates) {
        const result =
          role === "admin"
            ? await generateTeachingPracticeLessonFromTrackAsAdmin(track.id, date)
            : await generateTeachingPracticeLessonFromTrackAsInstructor(actorId!, track.id, date);
        if (!result.success) {
          setTrackActionError(`שגיאה ביצירת שיעור לתאריך ${date}: ${result.error ?? "אירעה שגיאה"}`);
          await Promise.all([refreshTracks(), refreshLessons()]);
          return;
        }
        createdCount += 1;
      }
      setLessonDates([]);
      setTrackActionSuccess(
        `נוצרו ${createdCount} שיעורים בהצלחה (כטיוטה, טרם פורסמו) - ראו בלשונית "שיעורים שנוצרו"`
      );
      await Promise.all([refreshTracks(), refreshLessons()]);
    });
  }

  // -------------------------------------------------------------------------
  // Lessons: publish/unpublish + basic-field edit
  // -------------------------------------------------------------------------

  const [lessonActionError, setLessonActionError] = useState<string | null>(null);
  const [isLessonActionPending, startLessonActionTransition] = useTransition();

  function handleToggleLessonPublished(lesson: TeachingPracticeLessonSummary) {
    setLessonActionError(null);
    startLessonActionTransition(async () => {
      const result =
        role === "admin"
          ? await setTeachingPracticeLessonPublishedAsAdmin(lesson.id, !lesson.isPublished)
          : await setTeachingPracticeLessonPublishedAsInstructor(actorId!, lesson.id, !lesson.isPublished);
      if (!result.success) {
        setLessonActionError(result.error ?? "אירעה שגיאה");
        return;
      }
      await refreshLessons();
    });
  }

  async function handleUpdateLesson(
    lessonId: string,
    input: TeachingPracticeLessonInput
  ): Promise<ActionResult> {
    const result =
      role === "admin"
        ? await updateTeachingPracticeLessonAsAdmin(lessonId, input)
        : await updateTeachingPracticeLessonAsInstructor(actorId!, lessonId, input);
    if (result.success) {
      await refreshLessons();
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Children: create / edit / activate
  // -------------------------------------------------------------------------

  const [newChildForm, setNewChildForm] = useState<ChildFormState>(emptyChildForm());
  const [createChildError, setCreateChildError] = useState<string | null>(null);
  const [createChildSuccess, setCreateChildSuccess] = useState<string | null>(null);
  const [isCreatingChild, startCreateChildTransition] = useTransition();

  function handleCreateChild() {
    setCreateChildError(null);
    setCreateChildSuccess(null);
    const input = childFormToInput(newChildForm);
    startCreateChildTransition(async () => {
      const result =
        role === "admin"
          ? await createTeachingPracticeChildAsAdmin(input)
          : await createTeachingPracticeChildAsInstructor(actorId!, input);
      if (!result.success) {
        setCreateChildError(result.error ?? "אירעה שגיאה");
        return;
      }
      setNewChildForm(emptyChildForm());
      setCreateChildSuccess("הילד/ה נוסף/ה בהצלחה");
      await refreshChildren();
    });
  }

  const [editingChildId, setEditingChildId] = useState<string | null>(null);
  const [editChildForm, setEditChildForm] = useState<ChildFormState>(emptyChildForm());
  const [childActionError, setChildActionError] = useState<string | null>(null);
  const [isChildActionPending, startChildActionTransition] = useTransition();

  function startEditChild(child: TeachingPracticeChildRow) {
    setEditingChildId(child.id);
    setEditChildForm(childToFormState(child));
    setChildActionError(null);
  }

  function cancelEditChild() {
    setEditingChildId(null);
  }

  function handleSaveChild() {
    if (!editingChildId) return;
    setChildActionError(null);
    const input = childFormToInput(editChildForm);
    startChildActionTransition(async () => {
      const result =
        role === "admin"
          ? await updateTeachingPracticeChildAsAdmin(editingChildId, input)
          : await updateTeachingPracticeChildAsInstructor(actorId!, editingChildId, input);
      if (!result.success) {
        setChildActionError(result.error ?? "אירעה שגיאה");
        return;
      }
      setEditingChildId(null);
      await refreshChildren();
    });
  }

  function handleToggleChildActive(child: TeachingPracticeChildRow) {
    startChildActionTransition(async () => {
      const result =
        role === "admin"
          ? await setTeachingPracticeChildActiveAsAdmin(child.id, !child.isActive)
          : await setTeachingPracticeChildActiveAsInstructor(actorId!, child.id, !child.isActive);
      if (!result.success) {
        setChildActionError(result.error ?? "אירעה שגיאה");
        return;
      }
      await refreshChildren();
    });
  }

  // -------------------------------------------------------------------------
  // Children: Excel import preview (Stage B - preview only, no DB writes;
  // the commit/save step is a later stage).
  // -------------------------------------------------------------------------

  const [childImportCandidates, setChildImportCandidates] = useState<
    TeachingPracticeChildImportCandidate[] | null
  >(null);
  const [childImportError, setChildImportError] = useState<string | null>(null);
  const [childImportDebugInfo, setChildImportDebugInfo] = useState<string | null>(null);
  const [isParsingChildImport, startChildImportTransition] = useTransition();

  function handleParseChildImport(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setChildImportError(null);
    setChildImportDebugInfo(null);
    setChildImportSummary(null);
    const formData = new FormData(e.currentTarget);
    startChildImportTransition(async () => {
      const result =
        role === "admin"
          ? await parseTeachingPracticeChildrenExcelAsAdmin(formData)
          : await parseTeachingPracticeChildrenExcelAsInstructor(actorId!, formData);
      if (!result.success || !result.candidates) {
        setChildImportError(result.error ?? "אירעה שגיאה");
        setChildImportCandidates(null);
        return;
      }
      setChildImportCandidates(result.candidates);
      setChildImportDebugInfo(result.debugInfo ?? null);
    });
  }

  function updateChildImportCandidate(
    key: string,
    patch: Partial<TeachingPracticeChildImportCandidate>
  ) {
    setChildImportCandidates((prev) =>
      prev ? prev.map((c) => (c.key === key ? { ...c, ...patch } : c)) : prev
    );
  }

  function resetChildImport() {
    setChildImportCandidates(null);
    setChildImportError(null);
    setChildImportDebugInfo(null);
    setChildImportSummary(null);
  }

  // -------------------------------------------------------------------------
  // Children: Excel import commit (Stage C - actually saves the reviewed
  // preview rows; "skip" rows are never sent to the server at all).
  // -------------------------------------------------------------------------

  const [isCommittingChildImport, startCommitChildImportTransition] = useTransition();
  const [childImportSummary, setChildImportSummary] = useState<string | null>(null);

  function handleCommitChildImport() {
    if (!childImportCandidates) return;
    setChildImportError(null);
    setChildImportSummary(null);
    const rows = childImportCandidates.map((c) => ({
      action: c.action,
      firstName: c.firstName,
      lastName: c.lastName,
      age: c.age,
      gender: c.gender,
      parentName: c.parentName,
      parentPhone: c.parentPhone,
      notes: c.notes,
      matchedChildId: c.matchedChildId,
    }));
    startCommitChildImportTransition(async () => {
      const result =
        role === "admin"
          ? await commitTeachingPracticeChildrenImportAsAdmin(rows)
          : await commitTeachingPracticeChildrenImportAsInstructor(actorId!, rows);
      if (!result.success) {
        setChildImportError(result.error ?? "אירעה שגיאה בשמירת הייבוא");
        return;
      }
      setChildImportSummary(
        `נוצרו ${result.createdCount} ילדים, עודכנו ${result.updatedCount}, דולגו ${result.skippedCount}`
      );
      // Cleared on success (not left open) - re-running the same saved
      // preview would otherwise be an easy way to accidentally create
      // duplicate children, since a "create" row has no matchedChildId to
      // fall back to.
      setChildImportCandidates(null);
      setChildImportDebugInfo(null);
      await refreshChildren();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TAB_LABELS) as Tab[])
            // scheduleCheck has no instructor-facing action yet (admin-only
            // read, see getTeachingPracticeScheduleCheckForAdmin) - hidden
            // rather than shown-but-erroring for instructors.
            .filter((t) => t !== "scheduleCheck" || role === "admin")
            .map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Stage C: an explicit visual cue of the current mode, shown for
              everyone (not just canEdit users) - the toggle button's own
              label already implies this, but this badge makes it readable
              at a glance without reading the button text. */}
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              effectiveCanEdit ? "bg-warning-muted text-warning" : "bg-muted text-muted-foreground"
            }`}
          >
            {effectiveCanEdit ? "מצב עריכה פעיל" : "מצב צפייה"}
          </span>
          {/* Only ever rendered for canEdit users - someone without edit
              permission never sees this button, and therefore never has a
              way to reach isEditMode=true (view-only stays view-only for
              them, with no client-side path around it). */}
          {canEdit && (
            <Button
              type="button"
              variant={isEditMode ? "secondary" : "primary"}
              className="!px-3 !py-1.5 !text-sm"
              onClick={() => setIsEditMode((prev) => !prev)}
            >
              {isEditMode ? "יציאה ממצב עריכה" : "מעבר למצב עריכה"}
            </Button>
          )}
        </div>
      </div>

      {!canEdit && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          תצוגה בלבד - אין הרשאת עריכה להתנסויות מתחילים
        </p>
      )}

      {tab === "tracks" && (
        <div className="flex flex-col gap-4">
          {effectiveCanEdit && (
            <div className="rounded-xl border border-border bg-card p-4">
              <button
                type="button"
                onClick={() => setIsAddSlotOpen((prev) => !prev)}
                className="flex w-full items-center justify-between text-right"
              >
                <h2 className="text-base font-semibold text-card-foreground">הוספת סלוט</h2>
                <span className="text-muted-foreground">{isAddSlotOpen ? "▲" : "▼"}</span>
              </button>
              {isAddSlotOpen && (
                <>
                  <p className="mb-3 mt-1 text-xs text-muted-foreground">
                    מסלול קבוע מייצג צוות התנסות יציב שחוזר על עצמו — למשל שיעור פרטי מתחילים, קבוצה א,
                    15:00–15:30, עם הצוות והילד הקבועים. את השיעורים בפועל לתאריכים ספציפיים יוצרים מהמסלול
                    בהמשך.
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  סוג התנסות
                  <select
                    value={newTrackForm.practiceType}
                    onChange={(e) =>
                      setNewTrackForm((f) => ({
                        ...f,
                        practiceType: e.target.value as TeachingPracticeTypeValue,
                      }))
                    }
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    {PRACTICE_TYPES.map((pt) => (
                      <option key={pt} value={pt}>
                        {PRACTICE_TYPE_LABELS[pt]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  קבוצה
                  <select
                    value={newTrackForm.groupName}
                    onChange={(e) => setNewTrackForm((f) => ({ ...f, groupName: e.target.value }))}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <option value="">ללא קבוצה / כל הקבוצות</option>
                    {GROUP_OPTIONS.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  יום קבוע (אופציונלי, להתמצאות בלבד)
                  <select
                    value={newTrackForm.weekday}
                    onChange={(e) => setNewTrackForm((f) => ({ ...f, weekday: e.target.value }))}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <option value="">לא נקבע</option>
                    {WEEKDAY_LABELS.map((label, i) => (
                      <option key={i} value={i}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-muted-foreground">
                    לא קובע בפועל אילו תאריכים ייווצרו — את התאריכים בוחרים בעת יצירת שיעור.
                  </span>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  מיקום
                  <input
                    value={newTrackForm.defaultLocation}
                    onChange={(e) => setNewTrackForm((f) => ({ ...f, defaultLocation: e.target.value }))}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  שעת התחלה
                  <input
                    value={newTrackForm.defaultStartTime}
                    onChange={(e) => setNewTrackForm((f) => ({ ...f, defaultStartTime: e.target.value }))}
                    placeholder="HH:MM"
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">
                    שעת סיום משוערת: {previewEndTime(newTrackForm.defaultStartTime, newTrackForm.practiceType)}{" "}
                    ({TEACHING_PRACTICE_DURATION_MINUTES[newTrackForm.practiceType]} דק&apos;)
                  </span>
                </label>
                <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                  מדריך/ה אחראי/ת
                  <select
                    value={newTrackForm.defaultResponsibleInstructorId}
                    onChange={(e) =>
                      setNewTrackForm((f) => ({ ...f, defaultResponsibleInstructorId: e.target.value }))
                    }
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
                {newTrackForm.practiceType === "BEGINNER_PRIVATE" && (
                  <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                    שייך לשיעור קבוצתי
                    <select
                      value={newTrackForm.groupTrackId}
                      onChange={(e) => setNewTrackForm((f) => ({ ...f, groupTrackId: e.target.value }))}
                      className="rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <option value="">ללא שיוך</option>
                      {groupTrackOptionsForLink(newTrackForm.groupName, newTrackForm.groupTrackId).map((t) => (
                        <option key={t.id} value={t.id}>
                          {groupTrackOptionLabel(t, newTrackForm.groupName)}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-muted-foreground">
                      אופציונלי - ניתן להשאיר ללא שיוך וליצור באמצעות &quot;יצירת בלוק שיעור קבוצתי&quot; למעלה
                      במקום, או לשייך מאוחר יותר דרך עריכת הסלוט.
                    </span>
                  </label>
                )}
                <label className="flex flex-col gap-1 text-sm">
                  כמות שיעורים במקביל
                  <input
                    type="number"
                    min={1}
                    max={MAX_PARALLEL_SLOT_QUANTITY}
                    value={parallelQuantity}
                    onChange={(e) => setParallelQuantity(e.target.value)}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">
                    יוצר כמה סלוטים זהים במקביל (אותו סוג, קבוצה, שעה, מיקום ומדריך/ה אחראי/ת) - כל אחד
                    יישאר סלוט נפרד עם צוות/ילד/סוס משלו.
                  </span>
                </label>
                <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                  הערות
                  <textarea
                    value={newTrackForm.notes}
                    onChange={(e) => setNewTrackForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </label>
              </div>
                  {createTrackError && <p className="mt-2 text-sm text-danger">{createTrackError}</p>}
                  {createTrackSuccess && <p className="mt-2 text-sm text-success">{createTrackSuccess}</p>}
                  <Button className="mt-3" disabled={isCreatingTrack} onClick={handleCreateTrack}>
                    {isCreatingTrack ? "מוסיף..." : "הוספת סלוט"}
                  </Button>
                </>
              )}
            </div>
          )}

          {effectiveCanEdit && (
            <div className="rounded-xl border border-border bg-card p-4">
              <button
                type="button"
                onClick={() => setIsAddGroupBlockOpen((prev) => !prev)}
                className="flex w-full items-center justify-between text-right"
              >
                <h2 className="text-base font-semibold text-card-foreground">יצירת בלוק שיעור קבוצתי</h2>
                <span className="text-muted-foreground">{isAddGroupBlockOpen ? "▲" : "▼"}</span>
              </button>
              {isAddGroupBlockOpen && (
                <>
                  <p className="mb-3 mt-1 text-xs text-muted-foreground">
                    יוצר בבת אחת שיעור קבוצתי אחד ומספר שיעורים פרטיים המשויכים אליו (ברירת מחדל 3) -
                    מתאים לתהליך הרגיל שבו מספר שיעורים פרטיים מתכנסים לשיעור קבוצתי משותף אחד.
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm">
                      קבוצה
                      <select
                        value={groupBlockForm.groupName}
                        onChange={(e) => setGroupBlockForm((f) => ({ ...f, groupName: e.target.value }))}
                        className="rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <option value="">בחרו קבוצה</option>
                        {GROUP_OPTIONS.map((g) => (
                          <option key={g.value} value={g.value}>
                            {g.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      יום קבוע (אופציונלי, להתמצאות בלבד)
                      <select
                        value={groupBlockForm.weekday}
                        onChange={(e) => setGroupBlockForm((f) => ({ ...f, weekday: e.target.value }))}
                        className="rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <option value="">לא נקבע</option>
                        {WEEKDAY_LABELS.map((label, i) => (
                          <option key={i} value={i}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      שעה לקבוצתי
                      <input
                        value={groupBlockForm.groupStartTime}
                        onChange={(e) => setGroupBlockForm((f) => ({ ...f, groupStartTime: e.target.value }))}
                        placeholder="HH:MM"
                        className="rounded-lg border border-border px-3 py-2 text-sm"
                      />
                      <span className="text-xs text-muted-foreground">
                        שעת סיום משוערת: {previewEndTime(groupBlockForm.groupStartTime, "BEGINNER_GROUP")} (
                        {TEACHING_PRACTICE_DURATION_MINUTES.BEGINNER_GROUP} דק&apos;)
                      </span>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      שעה לפרטי
                      <input
                        value={groupBlockForm.privateStartTime}
                        onChange={(e) => setGroupBlockForm((f) => ({ ...f, privateStartTime: e.target.value }))}
                        placeholder="HH:MM"
                        className="rounded-lg border border-border px-3 py-2 text-sm"
                      />
                      <span className="text-xs text-muted-foreground">
                        שעת סיום משוערת: {previewEndTime(groupBlockForm.privateStartTime, "BEGINNER_PRIVATE")} (
                        {TEACHING_PRACTICE_DURATION_MINUTES.BEGINNER_PRIVATE} דק&apos;)
                      </span>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      מיקום
                      <input
                        value={groupBlockForm.defaultLocation}
                        onChange={(e) => setGroupBlockForm((f) => ({ ...f, defaultLocation: e.target.value }))}
                        className="rounded-lg border border-border px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      מספר שיעורים פרטיים
                      <input
                        type="number"
                        min={1}
                        max={6}
                        value={groupBlockForm.privateCount}
                        onChange={(e) => setGroupBlockForm((f) => ({ ...f, privateCount: e.target.value }))}
                        className="rounded-lg border border-border px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                      מדריך/ה אחראי/ת
                      <select
                        value={groupBlockForm.defaultResponsibleInstructorId}
                        onChange={(e) =>
                          setGroupBlockForm((f) => ({ ...f, defaultResponsibleInstructorId: e.target.value }))
                        }
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
                    <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                      הערות
                      <textarea
                        value={groupBlockForm.notes}
                        onChange={(e) => setGroupBlockForm((f) => ({ ...f, notes: e.target.value }))}
                        rows={2}
                        className="rounded-lg border border-border px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                  {createGroupBlockError && <p className="mt-2 text-sm text-danger">{createGroupBlockError}</p>}
                  {createGroupBlockSuccess && (
                    <p className="mt-2 text-sm text-success">{createGroupBlockSuccess}</p>
                  )}
                  <Button className="mt-3" disabled={isCreatingGroupBlock} onClick={handleCreateGroupBlock}>
                    {isCreatingGroupBlock ? "יוצר..." : "יצירת בלוק"}
                  </Button>
                </>
              )}
            </div>
          )}

          {tracks === null ? (
            <p className="text-sm text-muted-foreground">טוען...</p>
          ) : tracks.length === 0 ? (
            <p className="rounded-xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
              אין עדיין מבנה קבוע להתנסויות מתחילים.
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { value: "all" as const, label: "הכל" },
                    { value: "א" as const, label: "קבוצה א" },
                    { value: "ב" as const, label: "קבוצה ב" },
                  ]
                ).map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setTableGroupFilter(f.value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                      tableGroupFilter === f.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* Column visibility (Stage B) - a display preference only,
                  available in both view and edit mode, and independent of
                  canEdit/effectiveCanEdit entirely. Applies to the LUNGE,
                  Beginners-block, and unlinked-private tables below; the
                  lessons/children tabs are untouched. Every column - not
                  just the previously-optional ones - is listed and
                  toggleable here; a checkbox disables itself when it's the
                  last visible column in some table, per the "never let a
                  table go empty" safety rule. */}
              <div className="rounded-xl border border-border bg-card p-3">
                <button
                  type="button"
                  onClick={() => setIsColumnPanelOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between text-right text-sm font-semibold text-card-foreground"
                >
                  הצגת/הסתרת עמודות
                  <span className="text-muted-foreground">{isColumnPanelOpen ? "▲" : "▼"}</span>
                </button>
                {isColumnPanelOpen && (
                  <div className="mt-2 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={showAllTrackColumns}
                      className="self-start text-xs text-primary underline decoration-dotted"
                    >
                      הצג הכל
                    </button>
                    <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
                      {ALL_TRACK_COLUMNS.map((col) => {
                        const locked = isLastVisibleTrackColumn(col.key);
                        return (
                          <label key={col.key} className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={columnVisibility[col.key]}
                              disabled={locked}
                              onChange={() => toggleTrackColumn(col.key)}
                              title={locked ? "לא ניתן להסתיר את העמודה האחרונה המוצגת בטבלה" : undefined}
                            />
                            {col.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {inlineAssignError && <p className="text-sm text-danger">{inlineAssignError}</p>}

              {(
                [
                  { groupValue: "א" as string | null, label: "התנסויות לונג׳ — קבוצה א" },
                  { groupValue: "ב" as string | null, label: "התנסויות לונג׳ — קבוצה ב" },
                  ...(hasUngroupedLunge ? [{ groupValue: null, label: "התנסויות לונג׳ — ללא קבוצה" }] : []),
                ]
              )
                .filter((section) => sectionVisible(section.groupValue))
                .map((section) => {
                  const rows = buildAssignmentRows("LUNGE", section.groupValue);
                  return (
                    <div key={`lunge-${section.groupValue ?? "none"}`}>
                      <h3 className="mb-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold text-secondary-foreground">
                        {section.label}
                      </h3>
                      {rows.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-border bg-card p-3 text-center text-xs text-muted-foreground">
                          אין עדיין סלוטים קבועים בקטגוריה זו.
                        </p>
                      ) : (
                        // Horizontal scroll is contained to this table only
                        // (never the page) - min-width keeps columns from
                        // being squeezed illegibly narrow on small screens.
                        <div className="-mx-1 overflow-x-auto px-1 pb-1">
                          <table
                            className="w-full border-collapse text-xs"
                            style={{
                              minWidth: trackTableMinWidthPx(LUNGE_COLUMN_KEYS, columnVisibility),
                            }}
                          >
                            <thead>
                              <tr className="bg-muted text-muted-foreground">
                                {columnVisibility.lungeTime && (
                                  <th
                                    className={`px-2 py-2 text-right font-bold ${
                                      lungeStickyKey === "lungeTime" ? "sticky right-0 z-10 bg-muted" : ""
                                    }`}
                                  >
                                    שעה
                                  </th>
                                )}
                                {columnVisibility.leadTrainee && (
                                  <th
                                    className={`px-2 py-2 text-right font-bold ${
                                      lungeStickyKey === "leadTrainee" ? "sticky right-0 z-10 bg-muted" : ""
                                    }`}
                                  >
                                    חניך מדריך
                                  </th>
                                )}
                                {columnVisibility.assistantTrainee && (
                                  <th className="px-2 py-2 text-right font-bold">עוזר מדריך</th>
                                )}
                                {columnVisibility.childFirstName && (
                                  <th className="px-2 py-2 text-right font-bold">שם הילד</th>
                                )}
                                {columnVisibility.childLastName && (
                                  <th className="px-2 py-2 text-right font-bold">שם משפחה</th>
                                )}
                                {columnVisibility.age && (
                                  <th className="px-2 py-2 text-right font-bold">גיל</th>
                                )}
                                {columnVisibility.gender && (
                                  <th className="px-2 py-2 text-right font-bold">מין</th>
                                )}
                                {columnVisibility.horse && (
                                  <th className="px-2 py-2 text-right font-bold">סוס</th>
                                )}
                                {columnVisibility.equipment && (
                                  <th className="px-2 py-2 text-right font-bold">ציוד</th>
                                )}
                                {columnVisibility.parentName && (
                                  <th className="px-2 py-2 text-right font-bold">שם ההורה</th>
                                )}
                                {columnVisibility.parentPhone && (
                                  <th className="px-2 py-2 text-right font-bold">טלפון</th>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((row) => (
                                // Reserved for a future per-row conflict/
                                // warning highlight (Stage C, not implemented
                                // yet) - no logic computed here, just a seam
                                // so that feature won't need a table rewrite
                                // later. Row click always opens the drawer
                                // (view-only instructors can look, just not
                                // save) - the inline SearchableSelect cells
                                // stop propagation so clicking into them
                                // doesn't also pop the drawer open.
                                <tr
                                  key={row.key}
                                  onClick={() => openTrackManager(row.track)}
                                  className={`cursor-pointer border-t border-border hover:bg-muted/60 ${
                                    row.track.isActive ? "" : "opacity-60"
                                  }`}
                                >
                                  {columnVisibility.lungeTime && (
                                    <td
                                      className={`px-2 py-2 font-medium text-card-foreground ${
                                        lungeStickyKey === "lungeTime" ? "sticky right-0 z-10 bg-card" : ""
                                      }`}
                                    >
                                      {row.track.defaultStartTime}
                                      {!row.track.isActive && (
                                        <span className="mr-1 text-[10px] text-muted-foreground">(לא פעיל)</span>
                                      )}
                                    </td>
                                  )}
                                  {columnVisibility.leadTrainee && (
                                    <TraineeAssignmentCell
                                      value={row.traineeIdsBySlot[0] ?? ""}
                                      label={row.traineeNamesBySlot[0] ?? "—"}
                                      options={traineeSelectOptions(row.track, row.traineeIdsBySlot[0] ?? "")}
                                      editable={effectiveCanEdit}
                                      sticky={lungeStickyKey === "leadTrainee"}
                                      disabled={savingCellKey === `${row.track.id}-0`}
                                      onAssign={(traineeId) => handleInlineAssignTrainee(row.track, 0, traineeId)}
                                    />
                                  )}
                                  {columnVisibility.assistantTrainee && (
                                    <TraineeAssignmentCell
                                      value={row.traineeIdsBySlot[1] ?? ""}
                                      label={row.traineeNamesBySlot[1] ?? "—"}
                                      options={traineeSelectOptions(row.track, row.traineeIdsBySlot[1] ?? "")}
                                      editable={effectiveCanEdit}
                                      disabled={savingCellKey === `${row.track.id}-1`}
                                      onAssign={(traineeId) => handleInlineAssignTrainee(row.track, 1, traineeId)}
                                    />
                                  )}
                                  {columnVisibility.childFirstName && (
                                    <td className="px-2 py-2">{row.childFirstName}</td>
                                  )}
                                  {columnVisibility.childLastName && (
                                    <td className="px-2 py-2">{row.childLastName}</td>
                                  )}
                                  {columnVisibility.age && <td className="px-2 py-2">{row.childAge}</td>}
                                  {columnVisibility.gender && <td className="px-2 py-2">{row.childGender}</td>}
                                  {columnVisibility.horse && <td className="px-2 py-2">{row.horseName}</td>}
                                  {columnVisibility.equipment && (
                                    <td className="px-2 py-2">{row.equipmentNotes}</td>
                                  )}
                                  {columnVisibility.parentName && (
                                    <td className="px-2 py-2">{row.parentName}</td>
                                  )}
                                  {columnVisibility.parentPhone && (
                                    <td className="px-2 py-2">{row.parentPhone}</td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}

              {(
                [
                  { groupValue: "א" as string | null, label: "שיעורי מתחילים — קבוצה א" },
                  { groupValue: "ב" as string | null, label: "שיעורי מתחילים — קבוצה ב" },
                  ...(hasUngroupedBeginner ? [{ groupValue: null, label: "שיעורי מתחילים — ללא קבוצה" }] : []),
                ]
              )
                .filter((section) => sectionVisible(section.groupValue))
                .map((section) => {
                  const blocks = buildBeginnerBlocks(section.groupValue);
                  const unlinkedPrivate = buildUnlinkedPrivateTracks(section.groupValue);
                  return (
                    <div key={`beginner-${section.groupValue ?? "none"}`}>
                      <h3 className="mb-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold text-secondary-foreground">
                        {section.label}
                      </h3>
                      <p className="mb-2 text-xs text-muted-foreground">
                        כל בלוק מציג שיעור קבוצתי אחד (עמודת &quot;קבוצתי&quot;, מוצגת פעם אחת לכל בלוק) יחד
                        עם שיעורי ההתנסות הפרטניים המשויכים אליו (עמודות &quot;פרטני&quot;, שורה לכל שיעור
                        פרטי) - השיוך נקבע בעריכת הסלוט הפרטני. שיבוץ החניכים המתרגלים מתבצע בשורות
                        הפרטניות בלבד. תפקידי מדריך ראשון/מדריך שני/ממשב ייקבעו בשלב עתידי, ברמת השיעור
                        הקבוצתי הספציפי לתאריך.
                      </p>
                      {blocks.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-border bg-card p-3 text-center text-xs text-muted-foreground">
                          אין עדיין שיעורים קבוצתיים בקטגוריה זו.
                        </p>
                      ) : (
                        <div className="-mx-1 overflow-x-auto px-1 pb-1">
                          <table
                            className="w-full border-collapse text-xs"
                            style={{
                              minWidth: trackTableMinWidthPx(BEGINNER_BLOCK_COLUMN_KEYS, columnVisibility),
                            }}
                          >
                            <thead>
                              <tr className="bg-secondary text-secondary-foreground">
                                {columnVisibility.groupTime && (
                                  <th
                                    colSpan={1}
                                    className="border-b border-border px-2 py-1.5 text-center font-bold"
                                  >
                                    קבוצתי
                                  </th>
                                )}
                                <th
                                  colSpan={Math.max(
                                    1,
                                    visibleColumnCount(BEGINNER_PRIVATE_SIDE_COLUMN_KEYS, columnVisibility)
                                  )}
                                  className="border-b border-border px-2 py-1.5 text-center font-bold"
                                >
                                  פרטני
                                </th>
                              </tr>
                              <tr className="bg-muted text-muted-foreground">
                                {columnVisibility.groupTime && (
                                  <th
                                    className={`px-2 py-2 text-right font-bold ${
                                      beginnerStickyKey === "groupTime" ? "sticky right-0 z-10 bg-muted" : ""
                                    }`}
                                  >
                                    שעה לקבוצתי
                                  </th>
                                )}
                                {columnVisibility.privateTime && (
                                  <th
                                    className={`px-2 py-2 text-right font-bold ${
                                      beginnerStickyKey === "privateTime" ? "sticky right-0 z-10 bg-muted" : ""
                                    }`}
                                  >
                                    שעה לפרטני
                                  </th>
                                )}
                                {columnVisibility.leadTrainee && (
                                  <th
                                    className={`px-2 py-2 text-right font-bold ${
                                      beginnerStickyKey === "leadTrainee" ? "sticky right-0 z-10 bg-muted" : ""
                                    }`}
                                  >
                                    חניך מתרגל
                                  </th>
                                )}
                                {columnVisibility.assistantTrainee && (
                                  <th className="px-2 py-2 text-right font-bold">עוזר מדריך</th>
                                )}
                                {columnVisibility.childFirstName && (
                                  <th className="px-2 py-2 text-right font-bold">שם הילד</th>
                                )}
                                {columnVisibility.childLastName && (
                                  <th className="px-2 py-2 text-right font-bold">שם משפחה</th>
                                )}
                                {columnVisibility.age && (
                                  <th className="px-2 py-2 text-right font-bold">גיל</th>
                                )}
                                {columnVisibility.gender && (
                                  <th className="px-2 py-2 text-right font-bold">מין</th>
                                )}
                                {columnVisibility.horse && (
                                  <th className="px-2 py-2 text-right font-bold">סוס</th>
                                )}
                                {columnVisibility.equipment && (
                                  <th className="px-2 py-2 text-right font-bold">ציוד</th>
                                )}
                                {columnVisibility.parentName && (
                                  <th className="px-2 py-2 text-right font-bold">שם ההורה</th>
                                )}
                                {columnVisibility.parentPhone && (
                                  <th className="px-2 py-2 text-right font-bold">טלפון</th>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {blocks.map((block) => {
                                const rowCount = Math.max(block.privateRows.length, 1);
                                return (
                                  <Fragment key={block.key}>
                                    {Array.from({ length: rowCount }, (_, i) => {
                                      const privateRow = block.privateRows[i] ?? null;
                                      return (
                                        <tr
                                          key={privateRow?.key ?? `${block.key}-empty`}
                                          className={`border-border ${i === 0 ? "border-t-2" : "border-t"}`}
                                        >
                                          {i === 0 && columnVisibility.groupTime && (
                                            <ClickableCell
                                              rowSpan={rowCount}
                                              sticky={beginnerStickyKey === "groupTime"}
                                              isActive={block.groupTrack.isActive}
                                              onOpen={() => openTrackManager(block.groupTrack)}
                                            >
                                              {block.groupTrack.defaultStartTime}
                                              {!block.groupTrack.isActive && (
                                                <span className="mr-1 text-[10px] text-muted-foreground">
                                                  (לא פעיל)
                                                </span>
                                              )}
                                            </ClickableCell>
                                          )}
                                          {privateRow ? (
                                            <>
                                              {columnVisibility.privateTime && (
                                                <ClickableCell
                                                  isActive={privateRow.track.isActive}
                                                  onOpen={() => openTrackManager(privateRow.track)}
                                                  sticky={beginnerStickyKey === "privateTime"}
                                                >
                                                  {privateRow.track.defaultStartTime}
                                                  {!privateRow.track.isActive && (
                                                    <span className="mr-1 text-[10px] text-muted-foreground">
                                                      (לא פעיל)
                                                    </span>
                                                  )}
                                                </ClickableCell>
                                              )}
                                              {columnVisibility.leadTrainee && (
                                                <TraineeAssignmentCell
                                                  value={privateRow.traineeIdsBySlot[0] ?? ""}
                                                  label={privateRow.traineeNamesBySlot[0] ?? "—"}
                                                  options={traineeSelectOptions(
                                                    privateRow.track,
                                                    privateRow.traineeIdsBySlot[0] ?? ""
                                                  )}
                                                  editable={effectiveCanEdit}
                                                  sticky={beginnerStickyKey === "leadTrainee"}
                                                  disabled={savingCellKey === `${privateRow.track.id}-0`}
                                                  onAssign={(traineeId) =>
                                                    handleInlineAssignTrainee(privateRow.track, 0, traineeId)
                                                  }
                                                  onOpen={() => openTrackManager(privateRow.track)}
                                                  isActive={privateRow.track.isActive}
                                                />
                                              )}
                                              {columnVisibility.assistantTrainee && (
                                                <TraineeAssignmentCell
                                                  value={privateRow.traineeIdsBySlot[1] ?? ""}
                                                  label={privateRow.traineeNamesBySlot[1] ?? "—"}
                                                  options={traineeSelectOptions(
                                                    privateRow.track,
                                                    privateRow.traineeIdsBySlot[1] ?? ""
                                                  )}
                                                  editable={effectiveCanEdit}
                                                  disabled={savingCellKey === `${privateRow.track.id}-1`}
                                                  onAssign={(traineeId) =>
                                                    handleInlineAssignTrainee(privateRow.track, 1, traineeId)
                                                  }
                                                  onOpen={() => openTrackManager(privateRow.track)}
                                                  isActive={privateRow.track.isActive}
                                                />
                                              )}
                                              {columnVisibility.childFirstName && (
                                                <ClickableCell
                                                  isActive={privateRow.track.isActive}
                                                  onOpen={() => openTrackManager(privateRow.track)}
                                                >
                                                  {privateRow.childFirstName}
                                                </ClickableCell>
                                              )}
                                              {columnVisibility.childLastName && (
                                                <ClickableCell
                                                  isActive={privateRow.track.isActive}
                                                  onOpen={() => openTrackManager(privateRow.track)}
                                                >
                                                  {privateRow.childLastName}
                                                </ClickableCell>
                                              )}
                                              {columnVisibility.age && (
                                                <ClickableCell
                                                  isActive={privateRow.track.isActive}
                                                  onOpen={() => openTrackManager(privateRow.track)}
                                                >
                                                  {privateRow.childAge}
                                                </ClickableCell>
                                              )}
                                              {columnVisibility.gender && (
                                                <ClickableCell
                                                  isActive={privateRow.track.isActive}
                                                  onOpen={() => openTrackManager(privateRow.track)}
                                                >
                                                  {privateRow.childGender}
                                                </ClickableCell>
                                              )}
                                              {columnVisibility.horse && (
                                                <ClickableCell
                                                  isActive={privateRow.track.isActive}
                                                  onOpen={() => openTrackManager(privateRow.track)}
                                                >
                                                  {privateRow.horseName}
                                                </ClickableCell>
                                              )}
                                              {columnVisibility.equipment && (
                                                <ClickableCell
                                                  isActive={privateRow.track.isActive}
                                                  onOpen={() => openTrackManager(privateRow.track)}
                                                >
                                                  {privateRow.equipmentNotes}
                                                </ClickableCell>
                                              )}
                                              {columnVisibility.parentName && (
                                                <ClickableCell
                                                  isActive={privateRow.track.isActive}
                                                  onOpen={() => openTrackManager(privateRow.track)}
                                                >
                                                  {privateRow.parentName}
                                                </ClickableCell>
                                              )}
                                              {columnVisibility.parentPhone && (
                                                <ClickableCell
                                                  isActive={privateRow.track.isActive}
                                                  onOpen={() => openTrackManager(privateRow.track)}
                                                >
                                                  {privateRow.parentPhone}
                                                </ClickableCell>
                                              )}
                                            </>
                                          ) : (
                                            <td
                                              colSpan={Math.max(
                                                1,
                                                visibleColumnCount(BEGINNER_PRIVATE_SIDE_COLUMN_KEYS, columnVisibility)
                                              )}
                                              className="px-2 py-2 text-center text-muted-foreground"
                                            >
                                              טרם שויכו שיעורים פרטניים לשיעור הקבוצתי הזה
                                            </td>
                                          )}
                                        </tr>
                                      );
                                    })}
                                  </Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {unlinkedPrivate.length > 0 && (
                        <div className="mt-3">
                          <h4 className="mb-1 text-xs font-bold text-muted-foreground">
                            שיעורים פרטיים ללא שיוך
                          </h4>
                          <div className="-mx-1 overflow-x-auto px-1 pb-1">
                            <table
                              className="w-full border-collapse text-xs"
                              style={{
                                minWidth: trackTableMinWidthPx(UNLINKED_COLUMN_KEYS, columnVisibility),
                              }}
                            >
                              <thead>
                                <tr className="bg-muted text-muted-foreground">
                                  {columnVisibility.privateTime && (
                                    <th
                                      className={`px-2 py-2 text-right font-bold ${
                                        unlinkedStickyKey === "privateTime" ? "sticky right-0 z-10 bg-muted" : ""
                                      }`}
                                    >
                                      שעה לפרטני
                                    </th>
                                  )}
                                  {columnVisibility.leadTrainee && (
                                    <th
                                      className={`px-2 py-2 text-right font-bold ${
                                        unlinkedStickyKey === "leadTrainee" ? "sticky right-0 z-10 bg-muted" : ""
                                      }`}
                                    >
                                      חניך מתרגל
                                    </th>
                                  )}
                                  {columnVisibility.assistantTrainee && (
                                    <th className="px-2 py-2 text-right font-bold">עוזר מדריך</th>
                                  )}
                                  {columnVisibility.childFirstName && (
                                    <th className="px-2 py-2 text-right font-bold">שם הילד</th>
                                  )}
                                  {columnVisibility.childLastName && (
                                    <th className="px-2 py-2 text-right font-bold">שם משפחה</th>
                                  )}
                                  {columnVisibility.age && (
                                    <th className="px-2 py-2 text-right font-bold">גיל</th>
                                  )}
                                  {columnVisibility.gender && (
                                    <th className="px-2 py-2 text-right font-bold">מין</th>
                                  )}
                                  {columnVisibility.horse && (
                                    <th className="px-2 py-2 text-right font-bold">סוס</th>
                                  )}
                                  {columnVisibility.equipment && (
                                    <th className="px-2 py-2 text-right font-bold">ציוד</th>
                                  )}
                                  {columnVisibility.parentName && (
                                    <th className="px-2 py-2 text-right font-bold">שם ההורה</th>
                                  )}
                                  {columnVisibility.parentPhone && (
                                    <th className="px-2 py-2 text-right font-bold">טלפון</th>
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {unlinkedPrivate.map((row) => (
                                  // Whole-row hover (unlike the Beginners block
                                  // table below, every cell in this row always
                                  // belongs to the same track, so highlighting
                                  // the row as one unit is never misleading) -
                                  // matches the LUNGE table's row-level hover.
                                  // isActive dimming stays per-cell (each
                                  // ClickableCell already applies it) - adding
                                  // it here too would double-dim inactive rows.
                                  <tr key={row.key} className="border-t border-border hover:bg-muted/40">
                                    {columnVisibility.privateTime && (
                                      <ClickableCell
                                        sticky={unlinkedStickyKey === "privateTime"}
                                        isActive={row.track.isActive}
                                        onOpen={() => openTrackManager(row.track)}
                                      >
                                        {row.track.defaultStartTime}
                                        {!row.track.isActive && (
                                          <span className="mr-1 text-[10px] text-muted-foreground">(לא פעיל)</span>
                                        )}
                                      </ClickableCell>
                                    )}
                                    {columnVisibility.leadTrainee && (
                                      <TraineeAssignmentCell
                                        value={row.traineeIdsBySlot[0] ?? ""}
                                        label={row.traineeNamesBySlot[0] ?? "—"}
                                        options={traineeSelectOptions(row.track, row.traineeIdsBySlot[0] ?? "")}
                                        editable={effectiveCanEdit}
                                        sticky={unlinkedStickyKey === "leadTrainee"}
                                        disabled={savingCellKey === `${row.track.id}-0`}
                                        onAssign={(traineeId) => handleInlineAssignTrainee(row.track, 0, traineeId)}
                                        onOpen={() => openTrackManager(row.track)}
                                        isActive={row.track.isActive}
                                      />
                                    )}
                                    {columnVisibility.assistantTrainee && (
                                      <TraineeAssignmentCell
                                        value={row.traineeIdsBySlot[1] ?? ""}
                                        label={row.traineeNamesBySlot[1] ?? "—"}
                                        options={traineeSelectOptions(row.track, row.traineeIdsBySlot[1] ?? "")}
                                        editable={effectiveCanEdit}
                                        disabled={savingCellKey === `${row.track.id}-1`}
                                        onAssign={(traineeId) => handleInlineAssignTrainee(row.track, 1, traineeId)}
                                        onOpen={() => openTrackManager(row.track)}
                                        isActive={row.track.isActive}
                                      />
                                    )}
                                    {columnVisibility.childFirstName && (
                                      <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                        {row.childFirstName}
                                      </ClickableCell>
                                    )}
                                    {columnVisibility.childLastName && (
                                      <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                        {row.childLastName}
                                      </ClickableCell>
                                    )}
                                    {columnVisibility.age && (
                                      <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                        {row.childAge}
                                      </ClickableCell>
                                    )}
                                    {columnVisibility.gender && (
                                      <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                        {row.childGender}
                                      </ClickableCell>
                                    )}
                                    {columnVisibility.horse && (
                                      <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                        {row.horseName}
                                      </ClickableCell>
                                    )}
                                    {columnVisibility.equipment && (
                                      <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                        {row.equipmentNotes}
                                      </ClickableCell>
                                    )}
                                    {columnVisibility.parentName && (
                                      <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                        {row.parentName}
                                      </ClickableCell>
                                    )}
                                    {columnVisibility.parentPhone && (
                                      <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                        {row.parentPhone}
                                      </ClickableCell>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          {openTrack && (
            <Modal
              open
              size="wide"
              onClose={closeTrackManager}
              title={`ניהול סלוט - ${PRACTICE_TYPE_LABELS[openTrack.practiceType]}${
                openTrack.groupName ? ` · קבוצה ${openTrack.groupName}` : ""
              }`}
            >
              <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto pl-1">
                {trackActionError && <p className="text-sm text-danger">{trackActionError}</p>}
                {trackActionSuccess && <p className="text-sm text-success">{trackActionSuccess}</p>}

                <div>
                  <h3 className="mb-2 text-sm font-bold text-card-foreground">א. פרטי הסלוט</h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm">
                      סוג התנסות
                      <select
                        value={editTrackForm.practiceType}
                        onChange={(e) =>
                          setEditTrackForm((f) => ({
                            ...f,
                            practiceType: e.target.value as TeachingPracticeTypeValue,
                          }))
                        }
                        disabled={!effectiveCanEdit}
                        className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
                      >
                        {PRACTICE_TYPES.map((pt) => (
                          <option key={pt} value={pt}>
                            {PRACTICE_TYPE_LABELS[pt]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      קבוצה
                      <select
                        value={editTrackForm.groupName}
                        onChange={(e) => setEditTrackForm((f) => ({ ...f, groupName: e.target.value }))}
                        disabled={!effectiveCanEdit}
                        className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
                      >
                        <option value="">ללא קבוצה / כל הקבוצות</option>
                        {GROUP_OPTIONS.map((g) => (
                          <option key={g.value} value={g.value}>
                            {g.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      יום קבוע (אופציונלי, להתמצאות בלבד)
                      <select
                        value={editTrackForm.weekday}
                        onChange={(e) => setEditTrackForm((f) => ({ ...f, weekday: e.target.value }))}
                        disabled={!effectiveCanEdit}
                        className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
                      >
                        <option value="">לא נקבע</option>
                        {WEEKDAY_LABELS.map((label, i) => (
                          <option key={i} value={i}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <span className="text-xs text-muted-foreground">
                        לא קובע בפועל אילו תאריכים ייווצרו — את התאריכים בוחרים בעת יצירת שיעור.
                      </span>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      מיקום
                      <input
                        value={editTrackForm.defaultLocation}
                        onChange={(e) => setEditTrackForm((f) => ({ ...f, defaultLocation: e.target.value }))}
                        disabled={!effectiveCanEdit}
                        className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      שעת התחלה
                      <input
                        value={editTrackForm.defaultStartTime}
                        onChange={(e) =>
                          setEditTrackForm((f) => ({ ...f, defaultStartTime: e.target.value }))
                        }
                        placeholder="HH:MM"
                        disabled={!effectiveCanEdit}
                        className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
                      />
                      <span className="text-xs text-muted-foreground">
                        שעת סיום משוערת:{" "}
                        {previewEndTime(editTrackForm.defaultStartTime, editTrackForm.practiceType)} (
                        {TEACHING_PRACTICE_DURATION_MINUTES[editTrackForm.practiceType]} דק&apos;)
                      </span>
                    </label>
                    <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                      מדריך/ה אחראי/ת
                      <select
                        value={editTrackForm.defaultResponsibleInstructorId}
                        onChange={(e) =>
                          setEditTrackForm((f) => ({
                            ...f,
                            defaultResponsibleInstructorId: e.target.value,
                          }))
                        }
                        disabled={!effectiveCanEdit}
                        className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
                      >
                        <option value="">ללא</option>
                        {instructors.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.fullName}
                          </option>
                        ))}
                      </select>
                    </label>
                    {editTrackForm.practiceType === "BEGINNER_PRIVATE" && (
                      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                        שיוך לשיעור קבוצתי
                        <select
                          value={editTrackForm.groupTrackId}
                          onChange={(e) => setEditTrackForm((f) => ({ ...f, groupTrackId: e.target.value }))}
                          disabled={!effectiveCanEdit}
                          className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
                        >
                          <option value="">ללא שיוך</option>
                          {groupTrackOptionsForLink(editTrackForm.groupName, editTrackForm.groupTrackId).map(
                            (t) => (
                              <option key={t.id} value={t.id}>
                                {groupTrackOptionLabel(t, editTrackForm.groupName)}
                              </option>
                            )
                          )}
                        </select>
                        <span className="text-xs text-muted-foreground">
                          משויך לשיעור הקבוצתי שהחניך/ה ימשיך/תמשיך אליו לאחר שלב השיעורים הפרטיים.
                        </span>
                      </label>
                    )}
                    <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                      הערות
                      <textarea
                        value={editTrackForm.notes}
                        onChange={(e) => setEditTrackForm((f) => ({ ...f, notes: e.target.value }))}
                        rows={2}
                        disabled={!effectiveCanEdit}
                        className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
                      />
                    </label>
                  </div>
                  {effectiveCanEdit && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        className="!px-3 !py-1.5 !text-sm"
                        disabled={isTrackActionPending}
                        onClick={handleSaveTrackFields}
                      >
                        שמירת פרטי סלוט
                      </Button>
                      <Button
                        variant="ghost"
                        className="!px-3 !py-1.5 !text-sm"
                        disabled={isTrackActionPending}
                        onClick={() => handleToggleTrackActive(openTrack)}
                      >
                        {openTrack.isActive ? "השבתת סלוט" : "הפעלת סלוט"}
                      </Button>
                      <Button
                        variant="danger"
                        className="!px-3 !py-1.5 !text-sm"
                        disabled={isTrackActionPending}
                        onClick={() => handleDeleteTrack(openTrack)}
                      >
                        מחיקת סלוט
                      </Button>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-bold text-card-foreground">
                    ב. שיבוץ חניכים (לפי סדר תפקידים) - נדרשים{" "}
                    {TEACHING_PRACTICE_TEAM_SIZE[editTrackForm.practiceType]}
                  </h3>
                  <div className="flex flex-col gap-2">
                    {Array.from(
                      { length: TEACHING_PRACTICE_TEAM_SIZE[editTrackForm.practiceType] },
                      (_, i) => {
                        const selectedId = teamSelections[i] ?? "";
                        const options = teamOptionsForSlot(editTrackForm.groupName, selectedId);
                        return (
                          <label key={i} className="flex flex-col gap-1 text-sm">
                            חניך/ה מס&apos; {i + 1}
                            <select
                              value={selectedId}
                              onChange={(e) =>
                                setTeamSelections((prev) => {
                                  const next = [...prev];
                                  next[i] = e.target.value;
                                  return next;
                                })
                              }
                              disabled={!effectiveCanEdit}
                              className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
                            >
                              <option value="">בחרו חניך/ה</option>
                              {options.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.fullName}
                                  {s.groupName ? ` (קבוצה ${s.groupName})` : ""}
                                  {editTrackForm.groupName && s.groupName !== editTrackForm.groupName
                                    ? " - מחוץ לקבוצה שנבחרה"
                                    : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                        );
                      }
                    )}
                  </div>
                  {effectiveCanEdit && (
                    <Button
                      className="mt-2 !px-3 !py-1.5 !text-sm"
                      disabled={isTrackActionPending}
                      onClick={handleSaveTeam}
                    >
                      שמירת צוות
                    </Button>
                  )}
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-bold text-card-foreground">ג. ילדים, סוס וציוד</h3>
                  <div className="flex flex-col gap-2">
                    {trackChildRows.map((row, i) => (
                      <div
                        key={i}
                        className="flex flex-col gap-2 rounded-lg border border-border p-2 sm:flex-row sm:items-end"
                      >
                        <label className="flex flex-1 flex-col gap-1 text-sm">
                          ילד/ה
                          <select
                            value={row.childId}
                            onChange={(e) => updateTrackChildRow(i, { childId: e.target.value })}
                            disabled={!effectiveCanEdit}
                            className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
                          >
                            <option value="">בחרו ילד/ה</option>
                            {(children ?? []).map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.fullName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex flex-1 flex-col gap-1 text-sm">
                          סוס
                          <input
                            value={row.horseName}
                            onChange={(e) => updateTrackChildRow(i, { horseName: e.target.value })}
                            disabled={!effectiveCanEdit || !effectiveCanEditHorseFields}
                            className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
                          />
                        </label>
                        <label className="flex flex-1 flex-col gap-1 text-sm">
                          ציוד
                          <input
                            value={row.equipmentNotes}
                            onChange={(e) => updateTrackChildRow(i, { equipmentNotes: e.target.value })}
                            disabled={!effectiveCanEdit || !effectiveCanEditHorseFields}
                            className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
                          />
                        </label>
                        {effectiveCanEdit && (
                          <Button
                            variant="ghost"
                            className="!px-2 !py-1 !text-xs"
                            onClick={() => removeTrackChildRow(i)}
                          >
                            הסרה
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                  {effectiveCanEdit && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button variant="secondary" className="!px-3 !py-1.5 !text-sm" onClick={addTrackChildRow}>
                        הוספת ילד/ה
                      </Button>
                      <Button
                        className="!px-3 !py-1.5 !text-sm"
                        disabled={isTrackActionPending}
                        onClick={handleSaveTrackChildren}
                      >
                        שמירת ילדים
                      </Button>
                    </div>
                  )}
                  {effectiveCanEdit && !effectiveCanEditHorseFields && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      אין הרשאה לעריכת שדות סוס/ציוד - ניתן עדיין לשנות אילו ילדים משובצים.
                    </p>
                  )}
                </div>

                {/* Kept here for now (not redesigned this stage) - the
                    dedicated date-specific timetable view is a later stage;
                    until then this remains the only entry point for turning
                    a slot into a real dated lesson. View-only instructors
                    don't get this section at all - there's nothing to look
                    at here besides in-progress draft dates, not a real
                    record. */}
                {effectiveCanEdit && (
                <div className="border-t border-border pt-4">
                  <h3 className="mb-2 text-sm font-bold text-card-foreground">
                    יצירת שיעור/ים מהסלוט לתאריכים
                  </h3>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1 text-sm">
                      הוספת תאריך
                      <input
                        type="date"
                        value={lessonDateDraft}
                        onChange={(e) => setLessonDateDraft(e.target.value)}
                        className="rounded-lg border border-border px-3 py-2 text-sm"
                      />
                    </label>
                    <Button variant="secondary" className="!px-3 !py-1.5 !text-sm" onClick={addLessonDate}>
                      הוספה לרשימה
                    </Button>
                  </div>
                  {lessonDates.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {lessonDates.map((date) => (
                        <li
                          key={date}
                          className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-card-foreground"
                        >
                          {formatHebrewDate(parseDateKey(date))}
                          <button
                            type="button"
                            onClick={() => removeLessonDate(date)}
                            className="text-muted-foreground hover:text-danger"
                            aria-label={`הסרת ${date}`}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button
                    className="mt-2"
                    disabled={
                      isTrackActionPending ||
                      openTrack.trainees.length !== TEACHING_PRACTICE_TEAM_SIZE[openTrack.practiceType] ||
                      lessonDates.length === 0
                    }
                    onClick={() => handleGenerateLessons(openTrack)}
                  >
                    יצירת {lessonDates.length > 1 ? `${lessonDates.length} שיעורים` : "שיעור"}
                  </Button>
                  {openTrack.trainees.length !== TEACHING_PRACTICE_TEAM_SIZE[openTrack.practiceType] && (
                    <p className="mt-1 text-xs text-warning">
                      יש להשלים צוות של {TEACHING_PRACTICE_TEAM_SIZE[openTrack.practiceType]} חניכים בסלוט
                      לפני יצירת שיעור
                    </p>
                  )}
                </div>
                )}
              </div>
            </Modal>
          )}
        </div>
      )}

      {tab === "lessons" && (
        <div className="flex flex-col gap-4">
          {lessonActionError && <p className="text-sm text-danger">{lessonActionError}</p>}
          {lessons === null ? (
            <p className="text-sm text-muted-foreground">טוען...</p>
          ) : lessons.length === 0 ? (
            <p className="rounded-xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
              טרם נוצרו שיעורי התנסות מתחילים.
            </p>
          ) : (
            lessonsByDate.map(([date, dateLessons]) => (
              <div key={date} className="flex flex-col gap-2">
                <div className="rounded-lg bg-secondary px-3 py-2 text-sm font-bold text-secondary-foreground">
                  {formatHebrewWeekday(parseDateKey(date))} · {formatHebrewDate(parseDateKey(date))}
                </div>
                <div className="flex flex-col gap-3">
                  {dateLessons.map((lesson) => (
                    <LessonCard
                      key={lesson.id}
                      lesson={lesson}
                      canEdit={effectiveCanEdit}
                      isPending={isLessonActionPending}
                      instructors={instructors}
                      onTogglePublished={() => handleToggleLessonPublished(lesson)}
                      onSave={(input) => handleUpdateLesson(lesson.id, input)}
                      loadDetail={() =>
                        role === "admin"
                          ? getTeachingPracticeLessonDetailForAdmin(lesson.id)
                          : getTeachingPracticeLessonDetailForInstructor(actorId!, lesson.id)
                      }
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "children" && (
        <div className="flex flex-col gap-4">
          {effectiveCanEdit && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 text-base font-semibold text-card-foreground">
                ייבוא ילדים מקובץ Excel
              </h2>
              {!childImportCandidates && (
                <form onSubmit={handleParseChildImport} className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">
                    יש לבחור קובץ Excel עם עמודות שם פרטי/שם משפחה של הילד/ה ופרטים נלווים. לאחר
                    הפענוח ניתן לבדוק ולערוך כל שורה לפני השמירה בפועל.
                  </p>
                  <input
                    type="file"
                    name="file"
                    accept=".xlsx"
                    required
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                  {childImportError && (
                    <p className="whitespace-pre-line text-sm text-danger">{childImportError}</p>
                  )}
                  <Button type="submit" disabled={isParsingChildImport} className="self-start">
                    {isParsingChildImport ? "מפענח..." : "פענוח קובץ"}
                  </Button>
                </form>
              )}

              {childImportSummary && (
                <p className="text-sm text-success">{childImportSummary}</p>
              )}

              {childImportCandidates && (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">
                    נמצאו {childImportCandidates.length} שורות. ניתן לערוך את פעולת השורה (יצירה /
                    עדכון / דילוג) לפני השמירה. שמירה תיצור/תעדכן רק את השורות שאינן מסומנות לדילוג.
                  </p>
                  {childImportDebugInfo && (
                    <p className="whitespace-pre-line text-xs text-muted-foreground">
                      {childImportDebugInfo}
                    </p>
                  )}
                  <div className="max-h-96 overflow-y-auto rounded-lg border border-border">
                    {childImportCandidates.map((c) => (
                      <div key={c.key} className="border-b border-border p-3 last:border-0">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-card-foreground">
                            {c.fullName || `שורה ${c.rowNumber}`}
                          </span>
                          <select
                            value={c.action}
                            onChange={(e) =>
                              updateChildImportCandidate(c.key, {
                                action: e.target.value as ChildImportRowAction,
                              })
                            }
                            className="rounded-lg border border-border px-2 py-1 text-sm"
                          >
                            <option value="create">יצירת חדש</option>
                            {c.matchedChildId && <option value="update">עדכון קיים</option>}
                            <option value="skip">דילוג</option>
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-muted-foreground sm:grid-cols-4">
                          <span>גיל: {c.age ?? "—"}</span>
                          <span>מגדר: {c.gender || "—"}</span>
                          <span>הורה: {c.parentName || "—"}</span>
                          <span>טלפון: {c.parentPhone || "—"}</span>
                        </div>
                        {(c.constraints.preferredTimesGroupA ||
                          c.constraints.preferredTimesGroupB ||
                          c.constraints.specialRequests) && (
                          <details
                            open
                            className="mt-2 rounded-lg border border-warning bg-warning-muted p-2"
                          >
                            <summary className="cursor-pointer text-sm font-semibold text-warning">
                              אילוצי זמנים ובקשות
                            </summary>
                            <dl className="mt-2 flex flex-col gap-1 text-sm text-card-foreground">
                              {c.constraints.preferredTimesGroupA && (
                                <div>
                                  <dt className="inline font-medium">שעות מועדפות קבוצה א: </dt>
                                  <dd className="inline">{c.constraints.preferredTimesGroupA}</dd>
                                </div>
                              )}
                              {c.constraints.preferredTimesGroupB && (
                                <div>
                                  <dt className="inline font-medium">שעות מועדפות קבוצה ב: </dt>
                                  <dd className="inline">{c.constraints.preferredTimesGroupB}</dd>
                                </div>
                              )}
                              {c.constraints.specialRequests && (
                                <div>
                                  <dt className="inline font-medium">
                                    הערות / בקשות מיוחדות:{" "}
                                  </dt>
                                  <dd className="inline">{c.constraints.specialRequests}</dd>
                                </div>
                              )}
                            </dl>
                          </details>
                        )}
                        {(c.constraints.canAttendAllLessons ||
                          c.constraints.unavailableDetails ||
                          c.constraints.priorRidingExperience ||
                          c.constraints.previousCourseParticipation ||
                          c.constraints.grade ||
                          c.constraints.city ||
                          c.constraints.parentEmail) && (
                          <details open className="mt-2 rounded-lg border border-border p-2">
                            <summary className="cursor-pointer text-sm font-medium text-card-foreground">
                              מידע נוסף על הילד
                            </summary>
                            <dl className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
                              {c.constraints.canAttendAllLessons && (
                                <div>
                                  <dt className="inline font-medium">
                                    האם יכול/ה להגיע לכל ששת השיעורים:{" "}
                                  </dt>
                                  <dd className="inline">{c.constraints.canAttendAllLessons}</dd>
                                </div>
                              )}
                              {c.constraints.unavailableDetails && (
                                <div>
                                  <dt className="inline font-medium">
                                    פירוט מתי לא יוכל/תוכל להגיע:{" "}
                                  </dt>
                                  <dd className="inline">{c.constraints.unavailableDetails}</dd>
                                </div>
                              )}
                              {c.constraints.priorRidingExperience && (
                                <div>
                                  <dt className="inline font-medium">ניסיון קודם ברכיבה: </dt>
                                  <dd className="inline">{c.constraints.priorRidingExperience}</dd>
                                </div>
                              )}
                              {c.constraints.previousCourseParticipation && (
                                <div>
                                  <dt className="inline font-medium">השתתפות קודמת בקורס: </dt>
                                  <dd className="inline">
                                    {c.constraints.previousCourseParticipation}
                                  </dd>
                                </div>
                              )}
                              {c.constraints.grade && (
                                <div>
                                  <dt className="inline font-medium">כיתה: </dt>
                                  <dd className="inline">{c.constraints.grade}</dd>
                                </div>
                              )}
                              {c.constraints.city && (
                                <div>
                                  <dt className="inline font-medium">יישוב: </dt>
                                  <dd className="inline">{c.constraints.city}</dd>
                                </div>
                              )}
                              {c.constraints.parentEmail && (
                                <div>
                                  <dt className="inline font-medium">אימייל הורה: </dt>
                                  <dd className="inline">{c.constraints.parentEmail}</dd>
                                </div>
                              )}
                            </dl>
                          </details>
                        )}
                        {c.notes && (
                          <details className="mt-2 rounded-lg bg-muted p-2">
                            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                              הערות שישמרו בכרטיס הילד
                            </summary>
                            <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                              {c.notes}
                            </p>
                          </details>
                        )}
                        {c.matchConfidence === "high" && (
                          <p className="mt-2 text-xs text-success">
                            התאמה ודאית לילד/ה קיים/ת - מוצע לעדכן
                          </p>
                        )}
                        {c.warnings.length > 0 && (
                          <ul className="mt-2 list-inside list-disc text-xs text-warning">
                            {c.warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                  {childImportError && (
                    <p className="whitespace-pre-line text-sm text-danger">{childImportError}</p>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={resetChildImport}
                      disabled={isCommittingChildImport}
                    >
                      ביטול
                    </Button>
                    <Button
                      type="button"
                      onClick={handleCommitChildImport}
                      disabled={isCommittingChildImport}
                    >
                      {isCommittingChildImport ? "שומר..." : "שמירת הייבוא"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {effectiveCanEdit && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 text-base font-semibold text-card-foreground">הוספת ילד/ה</h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  שם פרטי
                  <input
                    value={newChildForm.firstName}
                    onChange={(e) => setNewChildForm((f) => ({ ...f, firstName: e.target.value }))}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  שם משפחה
                  <input
                    value={newChildForm.lastName}
                    onChange={(e) => setNewChildForm((f) => ({ ...f, lastName: e.target.value }))}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  גיל
                  <input
                    value={newChildForm.age}
                    onChange={(e) => setNewChildForm((f) => ({ ...f, age: e.target.value }))}
                    inputMode="numeric"
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  מגדר
                  <input
                    value={newChildForm.gender}
                    onChange={(e) => setNewChildForm((f) => ({ ...f, gender: e.target.value }))}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  שם ההורה
                  <input
                    value={newChildForm.parentName}
                    onChange={(e) => setNewChildForm((f) => ({ ...f, parentName: e.target.value }))}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  טלפון ההורה
                  <input
                    value={newChildForm.parentPhone}
                    onChange={(e) => setNewChildForm((f) => ({ ...f, parentPhone: e.target.value }))}
                    inputMode="tel"
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                  הערות (כולל בקשות/הגבלות אם יש)
                  <textarea
                    value={newChildForm.notes}
                    onChange={(e) => setNewChildForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </label>
              </div>
              {createChildError && <p className="mt-2 text-sm text-danger">{createChildError}</p>}
              {createChildSuccess && <p className="mt-2 text-sm text-success">{createChildSuccess}</p>}
              <Button className="mt-3" disabled={isCreatingChild} onClick={handleCreateChild}>
                {isCreatingChild ? "מוסיף..." : "הוספת ילד/ה"}
              </Button>
            </div>
          )}

          {childActionError && <p className="text-sm text-danger">{childActionError}</p>}

          {children === null ? (
            <p className="text-sm text-muted-foreground">טוען...</p>
          ) : children.length === 0 ? (
            <p className="rounded-xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
              טרם נוספו ילדים.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {children.map((child) => (
                <div key={child.id} className="rounded-xl border border-border bg-card p-4">
                  {editingChildId === child.id ? (
                    <div className="flex flex-col gap-2">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className="flex flex-col gap-1 text-sm">
                          שם פרטי
                          <input
                            value={editChildForm.firstName}
                            onChange={(e) =>
                              setEditChildForm((f) => ({ ...f, firstName: e.target.value }))
                            }
                            className="rounded-lg border border-border px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                          שם משפחה
                          <input
                            value={editChildForm.lastName}
                            onChange={(e) =>
                              setEditChildForm((f) => ({ ...f, lastName: e.target.value }))
                            }
                            className="rounded-lg border border-border px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                          גיל
                          <input
                            value={editChildForm.age}
                            onChange={(e) => setEditChildForm((f) => ({ ...f, age: e.target.value }))}
                            inputMode="numeric"
                            className="rounded-lg border border-border px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                          מגדר
                          <input
                            value={editChildForm.gender}
                            onChange={(e) =>
                              setEditChildForm((f) => ({ ...f, gender: e.target.value }))
                            }
                            className="rounded-lg border border-border px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                          שם ההורה
                          <input
                            value={editChildForm.parentName}
                            onChange={(e) =>
                              setEditChildForm((f) => ({ ...f, parentName: e.target.value }))
                            }
                            className="rounded-lg border border-border px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                          טלפון ההורה
                          <input
                            value={editChildForm.parentPhone}
                            onChange={(e) =>
                              setEditChildForm((f) => ({ ...f, parentPhone: e.target.value }))
                            }
                            inputMode="tel"
                            className="rounded-lg border border-border px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                          הערות (כולל בקשות/הגבלות אם יש)
                          <textarea
                            value={editChildForm.notes}
                            onChange={(e) =>
                              setEditChildForm((f) => ({ ...f, notes: e.target.value }))
                            }
                            rows={2}
                            className="rounded-lg border border-border px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          className="!px-3 !py-1.5 !text-sm"
                          disabled={isChildActionPending}
                          onClick={handleSaveChild}
                        >
                          שמירה
                        </Button>
                        <Button
                          variant="ghost"
                          className="!px-3 !py-1.5 !text-sm"
                          disabled={isChildActionPending}
                          onClick={cancelEditChild}
                        >
                          ביטול
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            child.isActive
                              ? "bg-success-muted text-success"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {child.isActive ? "פעיל/ה" : "לא פעיל/ה"}
                        </span>
                        <p className="text-base font-bold text-card-foreground">{child.fullName}</p>
                        {child.age != null && (
                          <span className="text-xs text-muted-foreground">גיל {child.age}</span>
                        )}
                      </div>
                      {child.gender && (
                        <p className="text-xs text-muted-foreground">מגדר: {child.gender}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        הורה: {child.parentName ?? "—"}
                        {child.parentPhone ? ` · ${child.parentPhone}` : ""}
                      </p>
                      {child.notes && (
                        <p className="mt-1 text-xs text-muted-foreground">הערות: {child.notes}</p>
                      )}
                      {effectiveCanEdit && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            variant="ghost"
                            className="!px-2 !py-1 !text-xs"
                            onClick={() => startEditChild(child)}
                          >
                            עריכה
                          </Button>
                          <Button
                            variant="ghost"
                            className="!px-2 !py-1 !text-xs"
                            disabled={isChildActionPending}
                            onClick={() => handleToggleChildActive(child)}
                          >
                            {child.isActive ? "השבתה" : "הפעלה"}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "scheduleCheck" && (
        <div className="flex flex-col gap-4">
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            בדיקת שיבוץ - איתור חפיפות ומרווחים קצרים מדי בין כל סוגי ההתנסות (לונג׳, שיעור פרטני, שיעור קבוצתי)
            יחד, לפי כל השיעורים שנוצרו כולל טרם פורסמו. תצוגה בלבד - אינה חוסמת שמירה או פרסום.
          </p>

          <div className="flex flex-wrap gap-2">
            {(Object.keys(SCHEDULE_CHECK_SUB_TAB_LABELS) as ScheduleCheckSubTab[]).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setScheduleCheckSubTab(st)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  scheduleCheckSubTab === st ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {SCHEDULE_CHECK_SUB_TAB_LABELS[st]}
              </button>
            ))}
          </div>

          {scheduleCheckLoading && <p className="text-sm text-muted-foreground">טוען...</p>}

          {!scheduleCheckLoading && scheduleCheckSubTab === "trainees" && (
            <>
              {scheduleCheckTraineesSorted && scheduleCheckTraineesSorted.length === 0 && (
                <p className="text-sm text-muted-foreground">אין עדיין שיבוצי חניכים להתנסויות מתחילים.</p>
              )}
              {scheduleCheckTraineesSorted &&
                scheduleCheckTraineesSorted.map((trainee) => {
                  const hasWarnings = trainee.timeline.some((entry) => entry.warnings.length > 0);
                  return (
                    <div key={trainee.traineeId} className="rounded-xl border border-border bg-card p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-card-foreground">{trainee.traineeName}</h3>
                        {hasWarnings ? (
                          <span className="rounded-full bg-danger-muted px-2 py-0.5 text-xs font-medium text-danger">
                            יש התראות
                          </span>
                        ) : (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            תקין
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-col gap-1">
                        {trainee.timeline.map((entry) => (
                          <div
                            key={entry.lessonId}
                            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/50 px-2 py-1.5 text-xs"
                          >
                            <span className="font-medium text-card-foreground">
                              {formatHebrewDate(parseDateKey(entry.date))}
                            </span>
                            <span className="text-muted-foreground">
                              {entry.startTime}-{entry.endTime}
                            </span>
                            <span className="text-muted-foreground">{PRACTICE_TYPE_LABELS[entry.practiceType]}</span>
                            <span className="text-muted-foreground">{ROLE_LABELS[entry.role]}</span>
                            {entry.warnings.map((warning, index) => (
                              <span
                                key={index}
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                  warning.kind === "overlap"
                                    ? "bg-danger-muted text-danger"
                                    : "bg-warning-muted text-warning"
                                }`}
                              >
                                {TRAINEE_SCHEDULE_CHECK_WARNING_LABELS[warning.kind]}
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </>
          )}

          {!scheduleCheckLoading && scheduleCheckSubTab === "horses" && (
            <>
              <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                שם הסוס הוא טקסט חופשי - איות שונה של אותו סוס עשוי להופיע כאן כשני סוסים נפרדים. איחוד שמות אינו
                נעשה בשלב זה.
              </p>
              {scheduleCheckHorsesSorted && scheduleCheckHorsesSorted.length === 0 && (
                <p className="text-sm text-muted-foreground">אין עדיין שיבוצי סוסים להתנסויות מתחילים.</p>
              )}
              {scheduleCheckHorsesSorted &&
                scheduleCheckHorsesSorted.map((horse) => {
                  const hasWarnings = horse.timeline.some((entry) => entry.warnings.length > 0);
                  return (
                    <div key={horse.horseName} className="rounded-xl border border-border bg-card p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-card-foreground">{horse.horseName}</h3>
                        {hasWarnings ? (
                          <span className="rounded-full bg-danger-muted px-2 py-0.5 text-xs font-medium text-danger">
                            יש התראות
                          </span>
                        ) : (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            תקין
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-col gap-1">
                        {horse.timeline.map((entry) => (
                          <div
                            key={entry.lessonId}
                            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/50 px-2 py-1.5 text-xs"
                          >
                            <span className="font-medium text-card-foreground">
                              {formatHebrewDate(parseDateKey(entry.date))}
                            </span>
                            <span className="text-muted-foreground">
                              {entry.startTime}-{entry.endTime}
                            </span>
                            <span className="text-muted-foreground">{PRACTICE_TYPE_LABELS[entry.practiceType]}</span>
                            {entry.childFullName && (
                              <span className="text-muted-foreground">{entry.childFullName}</span>
                            )}
                            {entry.warnings.map((warning, index) => (
                              <span
                                key={index}
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                  warning.kind === "overlap"
                                    ? "bg-danger-muted text-danger"
                                    : "bg-warning-muted text-warning"
                                }`}
                              >
                                {HORSE_SCHEDULE_CHECK_WARNING_LABELS[warning.kind]}
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// One inline trainee-assignment cell in a fixed-structure table row. In
// effective edit mode this is a thin wrapper around SearchableSelect that
// also stops the click from bubbling up to the row's onClick (which opens
// the slot drawer), so clicking into the cell to search/select never also
// pops the drawer open. Outside edit mode (view-only, or a permitted user
// who hasn't pressed "מעבר למצב עריכה" yet) it renders the resolved trainee
// name as plain text instead - never a SearchableSelect, live or disabled -
// via the same ClickableCell every other read-only cell in these tables
// already uses, so a click still opens the drawer for viewing (except in
// the LUNGE table, where the surrounding <tr> already does that - onOpen is
// left unset there to avoid triggering the open twice for one click).
function TraineeAssignmentCell({
  value,
  label,
  options,
  editable,
  disabled,
  onAssign,
  onOpen,
  isActive = true,
  rowSpan,
  sticky,
}: {
  value: string;
  // Resolved display name for the currently-assigned trainee (or "—") -
  // only ever rendered when !editable.
  label: string;
  options: SearchableSelectOption[];
  // Whether this cell may render a live SearchableSelect at all - callers
  // pass effectiveCanEdit here, never the bare canEdit permission flag.
  editable: boolean;
  disabled: boolean;
  onAssign: (traineeId: string) => void;
  // Only set for tables with no row-level onClick of their own (Beginners
  // blocks / unlinked private rows) - see the function doc above.
  onOpen?: () => void;
  isActive?: boolean;
  // Set when this cell represents a BEGINNER_GROUP block's own team slot,
  // shared (merged) across all of that block's private sub-rows.
  rowSpan?: number;
  // Set when this cell is currently the table's designated fallback sticky
  // column (Stage C) - only ever true when the table's own time column is
  // hidden, so the table doesn't lose its pinned-while-scrolling column
  // just because one specific column was hidden. Works the same whether
  // this cell is showing plain text or a live SearchableSelect - sticky
  // positioning on the wrapping <td> doesn't affect where the select's own
  // dropdown (itself position:relative-anchored one level in) renders.
  sticky?: boolean;
}) {
  if (!editable) {
    if (onOpen) {
      return (
        <ClickableCell rowSpan={rowSpan} isActive={isActive} onOpen={onOpen} sticky={sticky}>
          {label}
        </ClickableCell>
      );
    }
    return (
      <td
        rowSpan={rowSpan}
        className={`px-2 py-2 ${sticky ? "sticky right-0 z-10 bg-card" : ""}`}
      >
        {label}
      </td>
    );
  }
  return (
    <td
      rowSpan={rowSpan}
      // max-w keeps this select from stretching the whole column just
      // because one option's name happens to be long - SearchableSelect's
      // own trigger already truncates its selected-label text, the column
      // just needs a cap so that truncation actually kicks in.
      className={`max-w-[150px] px-2 py-2 ${sticky ? "sticky right-0 z-10 bg-card" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <SearchableSelect
        value={value}
        options={options}
        onChange={onAssign}
        disabled={disabled}
        placeholder="בחרו חניך/ה"
        className="!px-2 !py-1 text-xs"
      />
    </td>
  );
}

// A plain (non-select) table cell that opens the given track's drawer when
// clicked - used for every read-only cell in the Beginners block table
// (group-level rowspanned cells and private-level per-row cells alike),
// since a shared <tr onClick> doesn't work once a row mixes cells that
// belong to two different tracks (the group track's rowspanned cells vs.
// that row's own private track).
function ClickableCell({
  children,
  onOpen,
  rowSpan,
  sticky,
  isActive = true,
}: {
  children: ReactNode;
  onOpen: () => void;
  rowSpan?: number;
  sticky?: boolean;
  isActive?: boolean;
}) {
  return (
    <td
      rowSpan={rowSpan}
      onClick={onOpen}
      className={`cursor-pointer px-2 py-2 hover:bg-muted/60 ${sticky ? "sticky right-0 z-10 bg-card" : ""} ${
        isActive ? "" : "opacity-60"
      }`}
    >
      {children}
    </td>
  );
}

interface LessonEditFormState {
  date: string;
  startTime: string;
  responsibleInstructorId: string;
  location: string;
  notes: string;
}

function lessonToEditForm(lesson: TeachingPracticeLessonSummary): LessonEditFormState {
  return {
    date: lesson.date,
    startTime: lesson.startTime,
    responsibleInstructorId: lesson.responsibleInstructorId ?? "",
    location: lesson.location ?? "",
    notes: lesson.notes ?? "",
  };
}

// Detail (participants/child assignments) is view-only in this stage -
// editing them is deferred to a later stage. Fetched lazily on first expand
// rather than for every card up front, to avoid N lesson-detail queries
// firing on every list load.
function LessonCard({
  lesson,
  canEdit,
  isPending,
  instructors,
  onTogglePublished,
  onSave,
  loadDetail,
}: {
  lesson: TeachingPracticeLessonSummary;
  canEdit: boolean;
  isPending: boolean;
  instructors: InstructorOption[];
  onTogglePublished: () => void;
  onSave: (input: TeachingPracticeLessonInput) => Promise<ActionResult>;
  loadDetail: () => Promise<TeachingPracticeLessonDetail | null>;
}) {
  const [detail, setDetail] = useState<TeachingPracticeLessonDetail | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<LessonEditFormState>(() => lessonToEditForm(lesson));
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, startSaveEditTransition] = useTransition();

  function handleToggleDetail() {
    const opening = !isDetailOpen;
    setIsDetailOpen(opening);
    if (opening && detail === null) {
      setIsDetailLoading(true);
      loadDetail().then((result) => {
        setDetail(result);
        setIsDetailLoading(false);
      });
    }
  }

  function startEdit() {
    setEditForm(lessonToEditForm(lesson));
    setEditError(null);
    setIsEditing(true);
  }

  function handleSaveEdit() {
    setEditError(null);
    startSaveEditTransition(async () => {
      const result = await onSave({
        date: editForm.date,
        startTime: editForm.startTime,
        responsibleInstructorId: editForm.responsibleInstructorId || null,
        location: editForm.location.trim() || null,
        notes: editForm.notes.trim() || null,
      });
      if (!result.success) {
        setEditError(result.error ?? "אירעה שגיאה");
        return;
      }
      setIsEditing(false);
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {isEditing ? (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              תאריך
              <input
                type="date"
                value={editForm.date}
                onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              שעת התחלה
              <input
                value={editForm.startTime}
                onChange={(e) => setEditForm((f) => ({ ...f, startTime: e.target.value }))}
                placeholder="HH:MM"
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
              <span className="text-xs text-muted-foreground">
                שעת סיום משוערת: {previewEndTime(editForm.startTime, lesson.practiceType)} (
                {TEACHING_PRACTICE_DURATION_MINUTES[lesson.practiceType]} דק&apos;)
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              מדריך/ה אחראי/ת
              <select
                value={editForm.responsibleInstructorId}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, responsibleInstructorId: e.target.value }))
                }
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
              מיקום
              <input
                value={editForm.location}
                onChange={(e) => setEditForm((f) => ({ ...f, location: e.target.value }))}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              הערות
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
          </div>
          {editError && <p className="text-sm text-danger">{editError}</p>}
          <div className="flex gap-2">
            <Button className="!px-3 !py-1.5 !text-sm" disabled={isSavingEdit} onClick={handleSaveEdit}>
              {isSavingEdit ? "שומר..." : "שמירה"}
            </Button>
            <Button
              variant="ghost"
              className="!px-3 !py-1.5 !text-sm"
              disabled={isSavingEdit}
              onClick={() => setIsEditing(false)}
            >
              ביטול
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                lesson.isPublished ? "bg-success-muted text-success" : "bg-secondary text-secondary-foreground"
              }`}
            >
              {lesson.isPublished ? "פורסם" : "טיוטה"}
            </span>
            <p className="text-base font-bold text-card-foreground">
              {PRACTICE_TYPE_LABELS[lesson.practiceType]}
              {lesson.groupName ? ` · קבוצה ${lesson.groupName}` : ""}
            </p>
          </div>
          <p className="mb-1 text-xs text-muted-foreground">
            {formatHebrewDate(parseDateKey(lesson.date))} · {lesson.startTime}-{lesson.endTime}
            {lesson.location ? ` · ${lesson.location}` : ""}
          </p>
          <p className="mb-1 text-xs text-muted-foreground">
            מדריך/ה אחראי/ת: {lesson.responsibleInstructorName ?? "ללא"}
          </p>
          <p className="mb-1 text-xs text-muted-foreground">
            {lesson.participantCount} משתתפים · {lesson.childCount} ילדים
          </p>
          {lesson.notes && <p className="mb-1 text-xs text-muted-foreground">הערות: {lesson.notes}</p>}

          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="ghost" className="!px-3 !py-1.5 !text-sm" onClick={handleToggleDetail}>
              {isDetailOpen ? "הסתרת פרטים" : "פרטים"}
            </Button>
            {canEdit && (
              <>
                <Button
                  variant="ghost"
                  className="!px-3 !py-1.5 !text-sm"
                  disabled={isPending}
                  onClick={startEdit}
                >
                  עריכת שיעור
                </Button>
                <Button
                  variant="secondary"
                  className="!px-3 !py-1.5 !text-sm"
                  disabled={isPending}
                  onClick={onTogglePublished}
                >
                  {lesson.isPublished ? "ביטול פרסום" : "פרסום"}
                </Button>
              </>
            )}
          </div>

          {isDetailOpen && (
            <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
              {isDetailLoading || !detail ? (
                <p className="text-xs text-muted-foreground">טוען...</p>
              ) : (
                <>
                  <div>
                    <p className="mb-1 text-xs font-semibold text-muted-foreground">משתתפים</p>
                    {detail.participants.length === 0 ? (
                      <p className="text-xs text-muted-foreground">טרם שובצו משתתפים</p>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {detail.participants.map((p) => (
                          <li key={p.participantId} className="text-xs text-card-foreground">
                            {p.traineeName} - {ROLE_LABELS[p.role]}
                            {p.isManualOverride ? " (שינוי ידני)" : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold text-muted-foreground">ילדים</p>
                    {detail.childAssignments.length === 0 ? (
                      <p className="text-xs text-muted-foreground">טרם שובצו ילדים</p>
                    ) : (
                      <ul className="flex flex-col gap-1.5">
                        {detail.childAssignments.map((c) => (
                          <li key={c.id} className="rounded-lg bg-muted p-2 text-xs">
                            <p className="font-medium text-card-foreground">
                              {c.childFullName}
                              {c.childAge != null ? ` (גיל ${c.childAge})` : ""}
                              {c.isAbsent && <span className="text-danger"> · נעדר/ת</span>}
                            </p>
                            <p className="text-muted-foreground">
                              הורה: {c.parentName ?? "—"}
                              {c.parentPhone ? ` · ${c.parentPhone}` : ""}
                            </p>
                            <p className="text-muted-foreground">
                              סוס: {c.horseName ?? "—"} · ציוד: {c.equipmentNotes ?? "—"}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
