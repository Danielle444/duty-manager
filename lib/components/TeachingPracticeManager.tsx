"use client";

import {
  Fragment,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { SearchableSelect, type SearchableSelectOption } from "@/lib/components/SearchableSelect";
import { formatHebrewDate, formatHebrewWeekday, parseDateKey, todayDateKey } from "@/lib/dates";
import { buildTelLink, buildWhatsAppLink } from "@/lib/phone-contact-links";
import type { ActionResult } from "@/lib/actions/students";
import {
  addMinutesToTimeString,
  ROLE_LABELS,
  TEACHING_PRACTICE_DURATION_MINUTES,
  TEACHING_PRACTICE_TEAM_SIZE,
  type TeachingPracticeRoleValue,
  type TeachingPracticeTypeValue,
} from "@/lib/teaching-practice-rotation";
import {
  buildParentKeyByChildId,
  buildSameParentOtherNamesByChildId,
  type SameParentChildInput,
} from "@/lib/teaching-practice-same-parent";
import { timeBlockColorClasses } from "@/lib/teaching-practice-time-colors";
import {
  bulkPublishFutureTeachingPracticeLessonsAsAdmin,
  bulkUnpublishFutureTeachingPracticeLessonsAsAdmin,
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
  getTeachingPracticeSameParentRowsForAdmin,
  getTeachingPracticeSameParentRowsForInstructor,
  getTeachingPracticeScheduleCheckForAdmin,
  listTeachingPracticeChildrenForAdmin,
  listTeachingPracticeChildrenForInstructor,
  listTeachingPracticeLessonsDetailForDateAsAdmin,
  listTeachingPracticeLessonsDetailForDateAsInstructor,
  listTeachingPracticeLessonsForAdmin,
  listTeachingPracticeLessonsForInstructor,
  listTeachingPracticeTracksForAdmin,
  listTeachingPracticeTracksForInstructor,
  setTeachingPracticeChildActiveAsAdmin,
  setTeachingPracticeChildActiveAsInstructor,
  setTeachingPracticeDatesForBlockAsAdmin,
  setTeachingPracticeLessonChildAssignmentsAsAdmin,
  setTeachingPracticeLessonChildAssignmentsAsInstructor,
  setTeachingPracticeLessonParticipantsAsAdmin,
  setTeachingPracticeLessonParticipantsAsInstructor,
  setTeachingPracticeLessonPublishedAsAdmin,
  setTeachingPracticeLessonPublishedAsInstructor,
  setTeachingPracticeTrackActiveAsAdmin,
  setTeachingPracticeTrackActiveAsInstructor,
  setTeachingPracticeTrackChildrenAsAdmin,
  setTeachingPracticeTrackChildrenAsInstructor,
  setTeachingPracticeTrackTraineeSlotAsAdmin,
  setTeachingPracticeTrackTraineesAsAdmin,
  setTeachingPracticeTrackTraineesAsInstructor,
  swapTeachingPracticeTrackTraineeSeatsAsAdmin,
  updateTeachingPracticeChildAsAdmin,
  updateTeachingPracticeChildAsInstructor,
  updateTeachingPracticeLessonAsAdmin,
  updateTeachingPracticeLessonAsInstructor,
  updateTeachingPracticeTrackAsAdmin,
  updateTeachingPracticeTrackAsInstructor,
  upsertTeachingPracticeFeedbackAsAdmin,
  upsertTeachingPracticeFeedbackAsInstructor,
  type TeachingPracticeBulkPublishResult,
  type TeachingPracticeChildAssignmentInput,
  type TeachingPracticeChildAssignmentRow,
  type TeachingPracticeChildInput,
  type TeachingPracticeChildRow,
  type TeachingPracticeDateBlockType,
  type TeachingPracticeFeedbackInput,
  type TeachingPracticeGroupBlockInput,
  type TeachingPracticeLessonDetail,
  type TeachingPracticeLessonInput,
  type TeachingPracticeLessonSummary,
  type TeachingPracticeParticipantFeedbackData,
  type TeachingPracticeParticipantInput,
  type TeachingPracticeParticipantRow,
  type TeachingPracticeScheduleCheckResult,
  type TeachingPracticeTrackChildInput,
  type TeachingPracticeSameParentLessonRow,
  type TeachingPracticeTrackInput,
  type TeachingPracticeTrackSummary,
  type TeachingPracticeTrackTraineeRow,
} from "@/lib/actions/teaching-practice";
import {
  commitTeachingPracticeChildrenImportAsAdmin,
  commitTeachingPracticeChildrenImportAsInstructor,
  parseTeachingPracticeChildrenExcelAsAdmin,
  parseTeachingPracticeChildrenExcelAsInstructor,
  type ChildImportRowAction,
  type TeachingPracticeChildImportCandidate,
} from "@/lib/actions/teaching-practice-child-import";
// Stage 1 - read-only trainee-assignment suggestion preview. Admin-only for
// now, same as getTeachingPracticeScheduleCheckForAdmin above.
// Stage 2 (revised) - applyTeachingPracticeTrackTraineeSlotSuggestionsAsAdmin
// writes each selected suggestion at its exact rotationOrder (no roster
// compaction) - deliberately NOT setTeachingPracticeTrackTraineesAsAdmin,
// which would shift a later slot down when an earlier one is still empty.
// See lib/actions/teaching-practice-suggestions.ts for why.
import {
  applyTeachingPracticeTrackTraineeSlotSuggestionsAsAdmin,
  getTeachingPracticeTraineeSuggestionsForAdmin,
  getTeachingPracticeFixedStructureTraineeScheduleForAdmin,
  type TeachingPracticeTrackTraineeSlotAssignment,
} from "@/lib/actions/teaching-practice-suggestions";
// Stage C2 - real, group-scoped fixed-structure -> generated-lessons sync
// ("סנכרן מבנה קבוע לתאריכים"). Admin-only, replaces the never-shipped
// trainee-only resync button; there is only ever one sync entry point in
// this UI.
import { syncTeachingPracticeFixedStructureToGeneratedLessonsAsAdmin } from "@/lib/actions/teaching-practice-full-sync";
// Result type now lives in the (non-"use server") core module - see that
// file's header for why it moved out of the action file.
import type { TeachingPracticeFullSyncApplyResult } from "@/lib/teaching-practice-full-sync-core";
// Stage D1/D2 - read-only fixed-structure assignment check ("בדוק שיבוץ").
import { checkTeachingPracticeFixedStructureForAdmin } from "@/lib/actions/teaching-practice-fixed-structure-check";
import type {
  TeachingPracticeFixedStructureCheckResult,
  TeachingPracticeFixedStructureIssue,
} from "@/lib/teaching-practice-fixed-structure-check";
import {
  TRAINEE_SUGGESTION_TARGET_PER_BUCKET,
  TRAINEE_SUGGESTION_GOOD_GAP_MINUTES,
  type ComputeTraineeSuggestionsResult,
  type ComputeTraineeScheduleResult,
  type TraineeScheduleRow,
  type TraineeScheduleAssignment,
  type TraineeSuggestionWarning,
  type TraineeSuggestionWarningKind,
  type TraineeSuggestionRankedCandidate,
} from "@/lib/teaching-practice-trainee-suggestions";

type Role = "admin" | "instructor";
type Tab = "tracks" | "lessons" | "children" | "scheduleCheck";

const TAB_LABELS: Record<Tab, string> = {
  tracks: "מבנה קבוע",
  lessons: "שיעורים שנוצרו",
  children: "ילדים",
  scheduleCheck: "בדיקת שיבוץ",
};

const TRAINEE_SCHEDULE_CHECK_WARNING_LABELS: Record<"overlap" | "short_gap" | "dense", string> = {
  overlap: "חפיפה בזמנים",
  short_gap: "מרווח קצר מדי בין התנסויות",
  dense: "אזהרה: רצף צפוף של התנסויות",
};

const HORSE_SCHEDULE_CHECK_WARNING_LABELS: Record<"overlap" | "short_gap" | "dense", string> = {
  overlap: "חפיפה בזמנים",
  short_gap: "מרווח קצר מדי בין שימושים בסוס",
  dense: "אזהרה: רצף צפוף של שימושים בסוס",
};

// Stage 1 - short scannable tag + color per warning kind returned by the
// Stage 0 suggestion engine; the engine's own `message` string is always
// shown too (see TraineeSuggestionWarningRow), this is just a quick visual
// grouping on top of it.
const TRAINEE_SUGGESTION_WARNING_STYLE: Record<TraineeSuggestionWarningKind, { label: string; className: string }> = {
  supply_below_demand: { label: "אספקת מקומות נמוכה", className: "bg-warning-muted text-warning" },
  no_suitable_candidate: { label: "אין הצעה מתאימה", className: "bg-warning-muted text-warning" },
  existing_group_mismatch: { label: "חוסר התאמת קבוצה קיים", className: "bg-danger-muted text-danger" },
  existing_overlap: { label: "חפיפת זמנים קיימת", className: "bg-danger-muted text-danger" },
  missing_or_invalid_time_data: { label: "נתוני זמן חסרים", className: "bg-muted text-muted-foreground" },
};

// Stage 2 - a slot is selectable for "apply" only when it is genuinely empty
// (no current occupant) AND has a real suggested חניך - this single
// predicate is the sole source of truth for whether a row gets a checkbox at
// all, what "בחר הכל" selects, and what the apply loop is allowed to touch.
// A filled slot never qualifies, by design - replacing an existing
// assignment is out of scope for this stage.
//
// Stage B - a BEGINNER_GROUP slot never qualifies either, regardless of
// having a (purely informational) suggestion: that track's own
// TeachingPracticeTrackTrainee rows are re-derived from its linked
// BEGINNER_PRIVATE tracks' slot-0 trainees on every fixed-structure sync
// (see processTrackForSync in lib/teaching-practice-full-sync-core.ts) - a
// direct apply here would just be silently overwritten by the next sync,
// which would be confusing rather than unsafe. The suggestion itself still
// computes and displays (see bucketNote in the pure engine) so the מנהלת
// can still see it as information; only the checkbox/apply path is blocked.
function isTraineeSuggestionSlotSelectable(slot: {
  practiceType: TeachingPracticeTypeValue;
  currentTraineeId: string | null;
  suggestedTraineeId: string | null;
}): boolean {
  return (
    slot.practiceType !== "BEGINNER_GROUP" && slot.currentTraineeId == null && slot.suggestedTraineeId != null
  );
}

// Stage C1 - "hole" is broader than isTraineeSuggestionSlotSelectable above:
// it also covers a required slot with NO suggestion at all (no eligible
// candidate survived - see rankedCandidates.length === 0), which still needs
// to surface in the holes-first section (with its own reason/excluded-list,
// just no radio group) rather than being silently buried in the filled/info
// section below. A BEGINNER_GROUP slot is never a "hole" regardless of fill
// state - its roster is always derived, never directly assignable (same
// rule as isTraineeSuggestionSlotSelectable), so it always belongs in the
// filled/info section instead.
function isHoleSlot(slot: { practiceType: TeachingPracticeTypeValue; currentTraineeId: string | null }): boolean {
  return slot.practiceType !== "BEGINNER_GROUP" && slot.currentTraineeId == null;
}

function traineeSuggestionSlotKey(trackId: string, rotationOrder: number): string {
  return `${trackId}:${rotationOrder}`;
}

// Every selectable key across the whole result, in one Set - used both to
// size the "בחר הכל"/selected-count footer and to build the default/reset
// choice map below.
function allSelectableTraineeSuggestionKeys(result: ComputeTraineeSuggestionsResult): Set<string> {
  const keys = new Set<string>();
  for (const track of result.tracks) {
    for (const slot of track.slots) {
      if (isTraineeSuggestionSlotSelectable(slot)) {
        keys.add(traineeSuggestionSlotKey(track.trackId, slot.rotationOrder));
      }
    }
  }
  return keys;
}

// Stage C1 - per-hole choice map, keyed the same way as
// allSelectableTraineeSuggestionKeys: every selectable slot defaults to the
// engine's own recommendation (rankedCandidates[0]/suggestedTraineeId) -
// this is the "בחר הכל" reset target, and also what a freshly-loaded result
// starts with, so the existing top recommendation stays the default choice,
// unchanged from before Stage C1. A slot with no candidates at all is never
// given an entry here (there's nothing to choose) - its hole card shows the
// "no suitable candidate" state instead of a radio group.
function buildDefaultSuggestionChoices(result: ComputeTraineeSuggestionsResult): Map<string, string | null> {
  const choices = new Map<string, string | null>();
  for (const track of result.tracks) {
    for (const slot of track.slots) {
      if (isTraineeSuggestionSlotSelectable(slot) && slot.suggestedTraineeId) {
        choices.set(traineeSuggestionSlotKey(track.trackId, slot.rotationOrder), slot.suggestedTraineeId);
      }
    }
  }
  return choices;
}

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

// Fixed-structure trainee slots must always be looked up by their exact
// rotationOrder, never by position in a sorted-and-compacted array - a
// sparse roster (a hole at an earlier rotationOrder, e.g. after clearing a
// slot via setTeachingPracticeTrackTraineeSlotAsAdmin) would otherwise make
// a later slot's trainee appear to have shifted into the earlier one.
function getTraineeAtRotation(
  track: Pick<TeachingPracticeTrackSummary, "trainees">,
  rotationOrder: number
): TeachingPracticeTrackTraineeRow | null {
  return track.trainees.find((t) => t.rotationOrder === rotationOrder) ?? null;
}

// Same-parent grouping for the child click-highlight feature AND the
// always-visible "אותו הורה" badge - normalize/buildParentKey/grouping now
// live in lib/teaching-practice-same-parent.ts (a plain, DB-free, JSX-free
// module) so app/student/StudentTeachingPracticeSection.tsx can reuse the
// exact same detection rule without importing anything else from this
// admin/instructor-only component.
const SAME_PARENT_BADGE_TITLE_PREFIX = "אותו הורה/איש קשר כמו: ";

// onClick is optional so this can still be used purely as a static
// indicator wherever there's no childId/popup wiring available - when
// present, stopPropagation keeps a badge click from also toggling the
// enclosing row's own click-to-highlight (ChildAssignmentCell) or opening
// the drawer (ClickableCell's onOpen).
function SameParentBadge({ otherNames, onClick }: { otherNames: string[]; onClick?: () => void }) {
  if (otherNames.length === 0) return null;
  return (
    <span
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
      className={`mr-1 rounded-full bg-warning-muted px-1.5 py-0.5 text-[10px] font-medium text-warning ${
        onClick ? "cursor-pointer hover:opacity-80" : ""
      }`}
      title={`${SAME_PARENT_BADGE_TITLE_PREFIX}${otherNames.join(", ")}`}
    >
      אותו הורה
    </span>
  );
}

// Reuses the exact same tel:/wa.me derivation as the trainee-facing PhoneCell
// in app/student/StudentTeachingPracticeSection.tsx (both consume the same
// lib/phone-contact-links.ts helpers, never a second normalization). `phone`
// is whatever text a call site already showed (joined-multiple values and
// the "—" placeholder both simply yield no action links, never a broken
// one) - the raw text always keeps rendering unchanged. Action links are
// additive only and are suppressed entirely whenever the caller says it's in
// edit mode, same "hide while editable" convention ChildAssignmentCell above
// already uses for its own same-parent badge. The actions wrapper stops
// propagation so tapping "התקשר"/WhatsApp inside a ClickableCell/clickable
// row never also opens that row's track-manager drawer.
function ParentPhoneCell({ phone, isEditMode }: { phone: string; isEditMode: boolean }) {
  if (isEditMode) return <>{phone}</>;
  const telLink = buildTelLink(phone);
  const waLink = buildWhatsAppLink(phone);
  if (!telLink && !waLink) return <>{phone}</>;
  return (
    <div className="flex flex-col items-start gap-1">
      <span>{phone}</span>
      <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
        {telLink && (
          <a
            href={telLink}
            className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground hover:opacity-80"
          >
            התקשר
          </a>
        )}
        {waLink && (
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-success-muted px-1.5 py-0.5 text-[10px] font-medium text-success hover:opacity-80"
          >
            WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}

// 1.0-5.0 in 0.5 steps, stored as ratingHalfPoints 2-10 - same convention as
// RidingLessonNote.ratingHalfPoints/RATING_OPTIONS in the riding feedback UI.
const FEEDBACK_RATING_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

// The fixed role columns shown per practiceType in the scheduled-lessons
// table (Stage A) - mirrors the 2-role LUNGE/BEGINNER_PRIVATE rotation and
// the 3-role BEGINNER_GROUP rotation from computeTeachingPracticeRotation,
// just as column headers instead of rotation math. Default labels only
// (ROLE_LABELS above) - no per-date override in this stage.
const ROLE_SLOTS_BY_PRACTICE_TYPE: Record<TeachingPracticeTypeValue, TeachingPracticeRoleValue[]> = {
  LUNGE: ["LEAD_INSTRUCTOR", "ASSISTANT_INSTRUCTOR"],
  BEGINNER_PRIVATE: ["LEAD_INSTRUCTOR", "ASSISTANT_INSTRUCTOR"],
  BEGINNER_GROUP: ["LEAD_INSTRUCTOR", "SECOND_INSTRUCTOR", "EVALUATOR"],
};

// Which of ROLE_SLOTS_BY_PRACTICE_TYPE's roles actually taught the lesson,
// i.e. may receive teaching-practice feedback for it. LUNGE keeps both
// roles (unchanged - feedback there was never role-restricted). For
// BEGINNER_PRIVATE, ASSISTANT_INSTRUCTOR ("עוזר מדריך") only assisted, not
// taught, so is excluded. For BEGINNER_GROUP, LEAD_INSTRUCTOR and
// SECOND_INSTRUCTOR both co-taught; EVALUATOR only observed, so is
// excluded. Used both to gate the trainee-name click target below and to
// scope feedbackEntries/the switcher.
const FEEDBACK_ELIGIBLE_ROLES_BY_PRACTICE_TYPE: Record<TeachingPracticeTypeValue, TeachingPracticeRoleValue[]> = {
  LUNGE: ["LEAD_INSTRUCTOR", "ASSISTANT_INSTRUCTOR"],
  BEGINNER_PRIVATE: ["LEAD_INSTRUCTOR"],
  BEGINNER_GROUP: ["LEAD_INSTRUCTOR", "SECOND_INSTRUCTOR"],
};

function isFeedbackEligibleRole(practiceType: TeachingPracticeTypeValue, role: TeachingPracticeRoleValue): boolean {
  return FEEDBACK_ELIGIBLE_ROLES_BY_PRACTICE_TYPE[practiceType].includes(role);
}

// Expected number of TeachingPracticeChildAssignment rows per practiceType
// for this one lesson's edit form - LUNGE/BEGINNER_PRIVATE normally share one
// child between both trainee rows, BEGINNER_GROUP has one child per trainee.
const EXPECTED_CHILD_SLOTS_BY_PRACTICE_TYPE: Record<TeachingPracticeTypeValue, number> = {
  LUNGE: 1,
  BEGINNER_PRIVATE: 1,
  BEGINNER_GROUP: 3,
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
  | "parentPhone"
  | "notes";

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
  { key: "notes", label: "הערות" },
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
  "notes",
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
  "notes",
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
  notes: true,
};

// Bumped to v2 - the column set changed shape (every column is now part of
// this map, not just the previously-optional ones), so an old v1 value
// would otherwise be silently misread as "these newly-hideable columns are
// hidden" for anyone who'd previously hidden something. A fresh key means
// everyone simply starts over at all-visible, which matches "all columns
// visible by default" regardless of any prior v1 preference.
// Bumped again to v3 when the "הערות" column was added, for the same reason.
const TRACK_COLUMN_VISIBILITY_STORAGE_KEY = "duty-manager:teaching-practice-columns:v3";

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

// One real TeachingPracticeParticipant, resolved with its lesson and
// (per pairLessonParticipantsWithChildren) its paired child - the shape both
// the trainee-name click target and the feedback modal's switcher/context
// are built from. See TeachingPracticeManager's feedbackEntries memo.
interface TeachingPracticeFeedbackEntry {
  participantId: string;
  traineeName: string;
  role: TeachingPracticeRoleValue;
  lesson: TeachingPracticeLessonDetail;
  child: TeachingPracticeChildAssignmentRow | null;
  feedback: TeachingPracticeParticipantFeedbackData | null;
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
  canEditTeachingPracticeFeedback = false,
  students,
  instructors,
}: {
  role: Role;
  // instructorId when role === "instructor"; unused for role === "admin".
  actorId: string | null;
  canManageAssignments: boolean;
  canManageHorses: boolean;
  canEditTeachingPracticeFeedback?: boolean;
  students: StudentOption[];
  instructors: InstructorOption[];
}) {
  const canEdit = role === "admin" || canManageAssignments;
  // Read-only fallback for "horse permission only, no assignment permission"
  // (see report) - horse-specific inputs are only ever enabled when canEdit
  // is already true, so this flag alone never unlocks editing on its own.
  const canEditHorseFields = role === "admin" || canManageHorses;
  // Separate permission from canEdit/canEditHorseFields on purpose - entering
  // Teaching Practice feedback is a distinct trust level from managing
  // tracks/lessons/participants/children/horses, and is never gated behind
  // the isEditMode toggle below (effectiveCanEdit) either, since feedback
  // entry has nothing to do with that toggle's "editing lesson structure"
  // concern.
  const canEditFeedback = role === "admin" || canEditTeachingPracticeFeedback;

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

  // Instructors land on the generated-lessons view by default (that's where
  // feedback tasks live); admin keeps opening on the fixed-structure tab.
  const [tab, setTab] = useState<Tab>(role === "instructor" ? "lessons" : "tracks");

  const [tracks, setTracks] = useState<TeachingPracticeTrackSummary[] | null>(null);
  const [lessons, setLessons] = useState<TeachingPracticeLessonSummary[] | null>(null);
  const [children, setChildren] = useState<TeachingPracticeChildRow[] | null>(null);
  // Stage A (scheduled-lessons table redesign): which date tab is selected,
  // and the full per-lesson detail (participants/childAssignments) for just
  // that date - fetched separately from the lightweight `lessons` summary
  // list so switching dates never re-fetches every lesson's roster at once.
  const [selectedLessonDate, setSelectedLessonDate] = useState<string | null>(null);
  const [lessonDateDetail, setLessonDateDetail] = useState<TeachingPracticeLessonDetail[] | null>(null);
  const [lessonDateDetailLoading, setLessonDateDetailLoading] = useState(false);
  const [lessonDateDetailError, setLessonDateDetailError] = useState<string | null>(null);
  // Admin-only (getTeachingPracticeScheduleCheckForAdmin has no instructor
  // variant yet, see report) - fetched lazily on first visit to the tab
  // rather than in the initial Promise.all below, since it's a heavier
  // cross-lesson query most sessions never open. Holds both the trainee and
  // horse timelines together (one fetch, one round trip).
  const [scheduleCheck, setScheduleCheck] = useState<TeachingPracticeScheduleCheckResult | null>(null);
  const [scheduleCheckLoading, setScheduleCheckLoading] = useState(false);
  const [scheduleCheckSubTab, setScheduleCheckSubTab] = useState<ScheduleCheckSubTab>("trainees");

  // Stage C: which participant's feedback modal is open, if any - null means
  // closed. Feedback content itself is never held here; the modal always
  // reads it fresh from feedbackEntries (derived from lessonDateDetail)
  // below, so it can never go stale relative to what the table shows.
  const [feedbackModalParticipantId, setFeedbackModalParticipantId] = useState<string | null>(null);
  // X/backdrop-close on the wrapping <Modal> below must save first (same
  // requestClose delegation pattern as the riding feedback modal's
  // studentEditorRef) - the modal component alone holds the current draft.
  const feedbackModalRef = useRef<TeachingPracticeFeedbackModalHandle>(null);

  // Every real participant across the whole selected date (not just one
  // lesson), each paired with its lesson/child context via the exact same
  // pairLessonParticipantsWithChildren helper the generated-lessons table
  // itself uses - this is both the switcher's option list and the source the
  // modal reads its currently-displayed participant's context from, so the
  // two surfaces can never disagree.
  const feedbackEntries = useMemo<TeachingPracticeFeedbackEntry[]>(() => {
    const entries: TeachingPracticeFeedbackEntry[] = [];
    for (const lesson of lessonDateDetail ?? []) {
      const roleSlots = ROLE_SLOTS_BY_PRACTICE_TYPE[lesson.practiceType];
      for (const row of pairLessonParticipantsWithChildren(lesson, roleSlots)) {
        if (!row.participant) continue;
        if (!isFeedbackEligibleRole(lesson.practiceType, row.participant.role)) continue;
        entries.push({
          participantId: row.participant.participantId,
          traineeName: row.participant.traineeName,
          role: row.participant.role,
          lesson,
          child: row.child,
          feedback: row.participant.feedback,
        });
      }
    }
    return entries;
  }, [lessonDateDetail]);

  async function handleSaveTeachingPracticeFeedback(
    participantId: string,
    input: TeachingPracticeFeedbackInput
  ): Promise<ActionResult> {
    const result =
      role === "admin"
        ? await upsertTeachingPracticeFeedbackAsAdmin(participantId, input)
        : await upsertTeachingPracticeFeedbackAsInstructor(actorId!, participantId, input);
    // Same "refetch this date's detail after a successful mutation" pattern
    // already used by handleToggleLessonPublished/handleUpdateLesson below -
    // keeps the table's own feedback-derived state (feedbackEntries) and the
    // modal in sync without a full page reload, at the cost of one extra
    // round trip per save.
    if (result.success && selectedLessonDate) {
      await refreshLessonDateDetail(selectedLessonDate);
    }
    return result;
  }

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
  async function refreshLessonDateDetail(date: string) {
    const fresh =
      role === "admin"
        ? await listTeachingPracticeLessonsDetailForDateAsAdmin(date)
        : await listTeachingPracticeLessonsDetailForDateAsInstructor(actorId!, date);
    setLessonDateDetail(fresh);
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

  // Dates that actually have at least one generated lesson, ascending
  // (lessonsByDate's Map preserves the server's [date, startTime] sort
  // order) - drives the date-tab strip in the redesigned lessons tab.
  const availableLessonDates = useMemo(() => lessonsByDate.map(([date]) => date), [lessonsByDate]);

  // Re-picks the selected date tab whenever the current selection is no
  // longer in the list (first load, or its last lesson got moved/deleted) -
  // nearest upcoming date first, falling back to the latest past date, then
  // simply the first available one, per the product's stated default order.
  useEffect(() => {
    if (tab !== "lessons") return;
    if (availableLessonDates.length === 0) {
      if (selectedLessonDate !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedLessonDate(null);
      }
      return;
    }
    if (selectedLessonDate !== null && availableLessonDates.includes(selectedLessonDate)) return;
    const today = todayDateKey();
    const upcoming = availableLessonDates.find((d) => d >= today);
    setSelectedLessonDate(upcoming ?? availableLessonDates[availableLessonDates.length - 1]);
  }, [tab, availableLessonDates, selectedLessonDate]);

  // Full per-lesson detail (participants/childAssignments) for just the
  // selected date - kept separate from the lightweight `lessons` summary
  // list above so switching date tabs never re-fetches every date's roster
  // at once, only the one currently shown.
  useEffect(() => {
    if (tab !== "lessons" || selectedLessonDate === null) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLessonDateDetailError(null);
    setLessonDateDetailLoading(true);
    refreshLessonDateDetail(selectedLessonDate)
      .catch(() => {
        if (!cancelled) setLessonDateDetailError("שגיאה בטעינת פרטי השיעורים לתאריך זה");
      })
      .finally(() => {
        if (!cancelled) setLessonDateDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedLessonDate, role, actorId]);

  // -------------------------------------------------------------------------
  // Tracks: fixed-structure assignment tables (LUNGE, and BEGINNER_PRIVATE +
  // BEGINNER_GROUP combined - "the same beginner-children flow")
  // -------------------------------------------------------------------------

  // Cross-reference from the assignment-level TeachingPracticeTrackChild (has
  // horseName/equipmentNotes) to the child-registry row (has
  // firstName/lastName/age/gender/parentName/parentPhone) - the table needs
  // fields from both, but they only ever join on childId.
  const childById = useMemo(() => new Map((children ?? []).map((c) => [c.id, c])), [children]);

  // Same-parent click-highlight AND the always-visible "אותו הורה" badge -
  // both scoped to ACTIVE children only (an inactive child's shared parent
  // is no longer surfaced by either), registry-wide (parentName/parentPhone
  // already live on the loaded child-registry row, so no new fetch is
  // needed for this feature). sameParentInputChildren feeds both
  // buildParentKeyByChildId (click-highlight) and
  // buildSameParentOtherNamesByChildId (badge) from lib/teaching-practice-same-parent.ts.
  const sameParentInputChildren: SameParentChildInput[] = useMemo(
    () =>
      (children ?? [])
        .filter((c) => c.isActive)
        .map((c) => ({ id: c.id, displayName: c.fullName, parentName: c.parentName, parentPhone: c.parentPhone })),
    [children]
  );
  const parentKeyByChildId = useMemo(
    () => buildParentKeyByChildId(sameParentInputChildren),
    [sameParentInputChildren]
  );
  const sameParentOtherNamesByChildId = useMemo(
    () => buildSameParentOtherNamesByChildId(sameParentInputChildren),
    [sameParentInputChildren]
  );

  // "אותו הורה" badge click -> row-details popup. Separate from the
  // click-to-highlight state above (that's a table-wide visual toggle on
  // the child name itself; this is a self-contained modal) - opening it
  // always fetches fresh via getTeachingPracticeSameParentRowsAsAdmin/
  // Instructor (admin/instructor may see unpublished lessons too, unlike
  // the trainee-facing surface), never reuses client-cached lesson data,
  // since a same-parent match can span dates never loaded into
  // lessonDateDetail.
  const [sameParentPopupChildId, setSameParentPopupChildId] = useState<string | null>(null);
  const [sameParentPopupRows, setSameParentPopupRows] = useState<TeachingPracticeSameParentLessonRow[] | null>(null);
  const [sameParentPopupLoading, setSameParentPopupLoading] = useState(false);
  const [sameParentPopupError, setSameParentPopupError] = useState<string | null>(null);
  const [, startSameParentPopupTransition] = useTransition();

  function handleOpenSameParentPopup(childId: string) {
    setSameParentPopupChildId(childId);
    setSameParentPopupRows(null);
    setSameParentPopupError(null);
    setSameParentPopupLoading(true);
    startSameParentPopupTransition(async () => {
      try {
        const rows =
          role === "admin"
            ? await getTeachingPracticeSameParentRowsForAdmin(childId)
            : await getTeachingPracticeSameParentRowsForInstructor(actorId!, childId);
        setSameParentPopupRows(rows);
      } catch {
        setSameParentPopupError("אירעה שגיאה בטעינת הנתונים");
      } finally {
        setSameParentPopupLoading(false);
      }
    });
  }

  function handleCloseSameParentPopup() {
    setSameParentPopupChildId(null);
    setSameParentPopupRows(null);
    setSameParentPopupError(null);
    setSameParentPopupLoading(false);
  }

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

  // View-mode-only click-to-highlight for a trainee's every appearance in
  // the fixed-structure table(s) - UI-only local state, no DB read/write
  // involved. Clicking the same trainee again clears it (toggle); clicking
  // a different trainee switches straight to it.
  const [selectedHighlightedTraineeId, setSelectedHighlightedTraineeId] = useState<string | null>(null);
  const [selectedHighlightedTraineeName, setSelectedHighlightedTraineeName] = useState<string | null>(null);

  function handleToggleTraineeHighlight(traineeId: string, traineeName: string) {
    const isSameAsCurrent = selectedHighlightedTraineeId === traineeId;
    setSelectedHighlightedTraineeId(isSameAsCurrent ? null : traineeId);
    setSelectedHighlightedTraineeName(isSameAsCurrent ? null : traineeName);
  }

  function handleClearTraineeHighlight() {
    setSelectedHighlightedTraineeId(null);
    setSelectedHighlightedTraineeName(null);
  }

  // View-mode-only click-to-highlight for a child's every appearance PLUS
  // every other child sharing the same (normalized) parent name+phone - see
  // buildParentKey/parentKeyByChildId above. Same toggle/switch/clear
  // semantics as the trainee highlight above, kept as separate state so a
  // trainee selection and a child selection can coexist independently.
  const [selectedHighlightedChildId, setSelectedHighlightedChildId] = useState<string | null>(null);
  const [selectedHighlightedChildName, setSelectedHighlightedChildName] = useState<string | null>(null);
  const [selectedHighlightedParentKey, setSelectedHighlightedParentKey] = useState<string | null>(null);

  function handleToggleChildHighlight(childId: string) {
    const isSameAsCurrent = selectedHighlightedChildId === childId;
    if (isSameAsCurrent) {
      setSelectedHighlightedChildId(null);
      setSelectedHighlightedChildName(null);
      setSelectedHighlightedParentKey(null);
      return;
    }
    setSelectedHighlightedChildId(childId);
    setSelectedHighlightedChildName(childById.get(childId)?.fullName ?? childId);
    setSelectedHighlightedParentKey(parentKeyByChildId.get(childId) ?? null);
  }

  function handleClearChildHighlight() {
    setSelectedHighlightedChildId(null);
    setSelectedHighlightedChildName(null);
    setSelectedHighlightedParentKey(null);
  }

  // Every OTHER active child (registry-wide, not just currently-assigned
  // ones) sharing the selected child's parent key - for the "אותו הורה:
  // [names]" line. Reuses the exact same map the always-visible badge uses,
  // so the click-highlight summary and the badge can never disagree.
  const sameParentChildNames = selectedHighlightedChildId
    ? (sameParentOtherNamesByChildId.get(selectedHighlightedChildId) ?? [])
    : [];

  // Stage 1 - read-only trainee-assignment suggestion preview. Admin-only
  // (role check on the button itself, below); scoped to whichever real group
  // (א/ב) is currently selected via tableGroupFilter above - "all" is
  // rejected before any fetch happens, since a suggestion run must always be
  // scoped to exactly one group (Stage 0 design). suggestionGroupName freezes
  // which group the currently-shown result belongs to, independent of
  // tableGroupFilter possibly changing afterward while the modal stays open.
  const [suggestionModalOpen, setSuggestionModalOpen] = useState(false);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [suggestionResult, setSuggestionResult] = useState<ComputeTraineeSuggestionsResult | null>(null);
  const [suggestionGroupName, setSuggestionGroupName] = useState<string | null>(null);

  // Stage C1 - per-hole manual choice: holeKey -> chosen traineeId, or null
  // for an explicit "דלג" (skip). Replaces the old Set<selected-key> model -
  // a hole now always has exactly one effective choice (a specific candidate
  // or skip), not a binary checked/unchecked over a single fixed
  // recommendation. Always recomputed from scratch (never merged) whenever a
  // fresh result loads - see loadTraineeSuggestions - so a stale key can
  // never survive into a newer result. Only ever holds entries for
  // isTraineeSuggestionSlotSelectable slots (see buildDefaultSuggestionChoices) -
  // a slot with no candidates at all has nothing to choose, so it's never
  // given a map entry.
  const [suggestionChoices, setSuggestionChoices] = useState<Map<string, string | null>>(new Map());
  const [isApplyingSuggestions, startApplySuggestionsTransition] = useTransition();
  const [applySuggestionsError, setApplySuggestionsError] = useState<string | null>(null);
  const [applySuggestionsSuccess, setApplySuggestionsSuccess] = useState<string | null>(null);

  // Shared by the initial open and the post-apply refetch (Stage 2) - always
  // defaults every hole to the engine's own recommendation (approved
  // default: preselect the recommendation, with a per-hole "דלג" radio as
  // the opt-out) and clears any apply error/success banner left over from a
  // previous run, so a refetched result never shows a stale message from
  // before it loaded.
  function loadTraineeSuggestions(groupName: string) {
    setSuggestionResult(null);
    setSuggestionError(null);
    setSuggestionLoading(true);
    setSuggestionChoices(new Map());
    setApplySuggestionsError(null);
    setApplySuggestionsSuccess(null);
    return getTeachingPracticeTraineeSuggestionsForAdmin(groupName)
      .then((data) => {
        setSuggestionResult(data);
        setSuggestionChoices(buildDefaultSuggestionChoices(data));
      })
      .catch((err: unknown) => {
        setSuggestionError(err instanceof Error ? err.message : "אירעה שגיאה בטעינת הצעות השיבוץ");
      })
      .finally(() => setSuggestionLoading(false));
  }

  function handleOpenTraineeSuggestions() {
    if (tableGroupFilter === "all") return; // button is disabled in this case; defensive no-op
    const groupName = tableGroupFilter;
    setSuggestionModalOpen(true);
    setSuggestionGroupName(groupName);
    void loadTraineeSuggestions(groupName);
  }

  // "בחר הכל" - reset every hole back to its recommended candidate (the same
  // state loadTraineeSuggestions starts with), not merely "select every key"
  // as before - meaningful now that a hole can be manually pointed at a
  // non-recommended candidate or at "דלג".
  function handleSelectAllTraineeSuggestions() {
    if (!suggestionResult) return;
    setSuggestionChoices(buildDefaultSuggestionChoices(suggestionResult));
  }

  // "נקה בחירה" - set every hole to explicit skip (null), not an empty map -
  // an empty map and an all-null map behave identically for apply purposes
  // (see handleApplySelectedTraineeSuggestions), but keeping every
  // selectable hole's key present with a null value keeps each hole's own
  // radio group showing "דלג" as checked, rather than no radio checked at
  // all.
  function handleClearTraineeSuggestionSelection() {
    if (!suggestionResult) return;
    const cleared = new Map<string, string | null>();
    for (const key of allSelectableTraineeSuggestionKeys(suggestionResult)) cleared.set(key, null);
    setSuggestionChoices(cleared);
  }

  // Wired to each hole card's radio group - traineeId is either a specific
  // candidate's id or null for the "דלג / לא לשבץ עכשיו" option.
  function setSuggestionChoice(trackId: string, rotationOrder: number, traineeId: string | null) {
    const key = traineeSuggestionSlotKey(trackId, rotationOrder);
    setSuggestionChoices((prev) => {
      const next = new Map(prev);
      next.set(key, traineeId);
      return next;
    });
  }

  // Stage C1 - apply exactly what the manager chose per hole (which may
  // differ from the engine's own recommendation), sent as explicit
  // {trackId, rotationOrder, traineeId} assignments in one call to
  // applyTeachingPracticeTrackTraineeSlotSuggestionsAsAdmin (unchanged action -
  // it already accepts any valid trainee choice, not just suggestedTraineeId,
  // see its own file). Never a full roster array, so an empty earlier slot
  // can never shift a later chosen slot's rotationOrder. That action is
  // all-or-nothing (validates every assignment before writing any of them),
  // so there is no partial-success state to reconcile here: either every
  // chosen assignment was applied, or none were and the inline error
  // explains why.
  function handleApplySelectedTraineeSuggestions() {
    if (!suggestionResult) return;
    const groupNameForRefetch = suggestionGroupName;
    setApplySuggestionsError(null);
    setApplySuggestionsSuccess(null);

    const assignments: TeachingPracticeTrackTraineeSlotAssignment[] = [];
    for (const track of suggestionResult.tracks) {
      // Stage B - defensive re-check, not just trusting that
      // suggestionChoices could never contain a BEGINNER_GROUP key
      // (isTraineeSuggestionSlotSelectable/buildDefaultSuggestionChoices
      // already keep its radio group from ever rendering) - this loop is the
      // last client-side point before the write action runs, so it never
      // forwards a BEGINNER_GROUP slot even if selection state were somehow
      // tampered with.
      if (track.practiceType === "BEGINNER_GROUP") continue;
      for (const slot of track.slots) {
        const key = traineeSuggestionSlotKey(track.trackId, slot.rotationOrder);
        const chosenTraineeId = suggestionChoices.get(key);
        if (chosenTraineeId) {
          assignments.push({
            trackId: track.trackId,
            rotationOrder: slot.rotationOrder,
            traineeId: chosenTraineeId,
          });
        }
      }
    }
    if (assignments.length === 0) {
      setApplySuggestionsError("לא נבחרו שיבוצים להחלה - כל החורים מסומנים כדלג (לא לשבץ עכשיו)");
      return;
    }

    startApplySuggestionsTransition(async () => {
      const result = await applyTeachingPracticeTrackTraineeSlotSuggestionsAsAdmin(assignments);
      if (!result.success) {
        setApplySuggestionsError(result.error ?? "אירעה שגיאה בהחלת השיבוצים שנבחרו");
        // Deliberately not touching suggestionResult/suggestionChoices here -
        // nothing was written (all-or-nothing), so the מנהלת keeps seeing
        // exactly what she chose alongside the inline error.
        return;
      }

      setApplySuggestionsSuccess(`השיבוצים הנבחרים הוחלו (${result.appliedCount ?? assignments.length} סלוטים)`);
      await refreshTracks();
      if (groupNameForRefetch) await loadTraineeSuggestions(groupNameForRefetch);
    });
  }

  // Stage B - read-only trainee schedule overview ("לו״ז חניכים"). Same
  // single-group-required convention as the suggestion modal above (no
  // write path at all here, unlike the suggestion modal - this view never
  // calls anything beyond the one read-only fetch below). scheduleGroupName
  // freezes which group the currently-shown result belongs to, independent
  // of tableGroupFilter possibly changing afterward while the modal stays
  // open - same reasoning as suggestionGroupName.
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleResult, setScheduleResult] = useState<ComputeTraineeScheduleResult | null>(null);
  const [scheduleGroupName, setScheduleGroupName] = useState<string | null>(null);

  function handleOpenTraineeSchedule() {
    if (tableGroupFilter === "all") return; // button is disabled in this case; defensive no-op
    const groupName = tableGroupFilter;
    setScheduleModalOpen(true);
    setScheduleGroupName(groupName);
    setScheduleResult(null);
    setScheduleError(null);
    setScheduleLoading(true);
    getTeachingPracticeFixedStructureTraineeScheduleForAdmin(groupName)
      .then((data) => setScheduleResult(data))
      .catch((err: unknown) => {
        setScheduleError(err instanceof Error ? err.message : "אירעה שגיאה בטעינת לו״ז החניכים");
      })
      .finally(() => setScheduleLoading(false));
  }

  // Stage C2 - real, group-scoped fixed-structure -> generated-lessons sync.
  // Same "freeze the group the open modal is about" pattern as
  // suggestionGroupName above, so the confirmation text and the eventual
  // apply call always target the group that was selected when the modal was
  // opened, even if tableGroupFilter changes while it's still open.
  // syncResult double as "have we already run this" - once set, the modal
  // shows the summary instead of the confirmation prompt; reopening always
  // resets it, so a stale summary can never be mistaken for a fresh one.
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncGroupName, setSyncGroupName] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<TeachingPracticeFullSyncApplyResult | null>(null);

  function handleOpenSyncModal() {
    if (tableGroupFilter === "all") return; // button is disabled in this case; defensive no-op
    setSyncGroupName(tableGroupFilter);
    setSyncError(null);
    setSyncResult(null);
    setSyncModalOpen(true);
  }

  function handleCloseSyncModal() {
    if (syncLoading) return; // never let the backdrop/X close mid-request
    setSyncModalOpen(false);
  }

  function handleConfirmSync() {
    if (syncLoading || !syncGroupName) return; // prevents double-click submission
    setSyncLoading(true);
    setSyncError(null);
    syncTeachingPracticeFixedStructureToGeneratedLessonsAsAdmin(syncGroupName)
      .then(async (result) => {
        setSyncResult(result);
        await refreshLessons();
        if (selectedLessonDate) await refreshLessonDateDetail(selectedLessonDate);
      })
      .catch((err: unknown) => {
        setSyncError(err instanceof Error ? err.message : "אירעה שגיאה בסנכרון המבנה הקבוע לתאריכים");
      })
      .finally(() => setSyncLoading(false));
  }

  // Bulk publish/unpublish - admin-only (button itself only rendered for
  // role === "admin", see the lessons-tab JSX), future lessons only (date >=
  // today), never touches a strictly-past lesson. Same confirm-then-summary
  // modal pattern as the sync modal above. bulkPublishTarget freezes which
  // action ("publish" vs "unpublish") the open modal is currently about, so
  // the confirmation text and the eventual call always match whichever
  // button opened it - null means closed.
  const [bulkPublishTarget, setBulkPublishTarget] = useState<boolean | null>(null);
  const [bulkPublishLoading, setBulkPublishLoading] = useState(false);
  const [bulkPublishError, setBulkPublishError] = useState<string | null>(null);
  const [bulkPublishResult, setBulkPublishResult] = useState<TeachingPracticeBulkPublishResult | null>(null);

  function handleOpenBulkPublishModal(target: boolean) {
    setBulkPublishTarget(target);
    setBulkPublishError(null);
    setBulkPublishResult(null);
  }

  function handleCloseBulkPublishModal() {
    if (bulkPublishLoading) return; // never let the backdrop/X close mid-request
    setBulkPublishTarget(null);
  }

  function handleConfirmBulkPublish() {
    if (bulkPublishLoading || bulkPublishTarget === null) return; // prevents double-click submission
    setBulkPublishLoading(true);
    setBulkPublishError(null);
    const action = bulkPublishTarget
      ? bulkPublishFutureTeachingPracticeLessonsAsAdmin
      : bulkUnpublishFutureTeachingPracticeLessonsAsAdmin;
    action()
      .then(async (result) => {
        setBulkPublishResult(result);
        await refreshLessons();
        if (selectedLessonDate) await refreshLessonDateDetail(selectedLessonDate);
      })
      .catch((err: unknown) => {
        setBulkPublishError(err instanceof Error ? err.message : "אירעה שגיאה בעדכון הפרסום");
      })
      .finally(() => setBulkPublishLoading(false));
  }

  // Stage D2 - read-only fixed-structure assignment check ("בדוק שיבוץ").
  // No confirmation modal needed (read-only) - results render inline, right
  // below the button row. fixedStructureCheckGroupName freezes which group
  // the currently-shown result belongs to, so a group-filter change afterward
  // can mark the result stale (see isFixedStructureCheckStale below) without
  // needing to clear it outright - the מנהלת can still see the last result
  // while being told it may no longer reflect the selected group.
  const [fixedStructureCheckResult, setFixedStructureCheckResult] =
    useState<TeachingPracticeFixedStructureCheckResult | null>(null);
  const [fixedStructureCheckGroupName, setFixedStructureCheckGroupName] = useState<string | null>(null);
  const [fixedStructureCheckLoading, setFixedStructureCheckLoading] = useState(false);
  const [fixedStructureCheckError, setFixedStructureCheckError] = useState<string | null>(null);

  const isFixedStructureCheckStale =
    fixedStructureCheckResult !== null && fixedStructureCheckGroupName !== tableGroupFilter;

  // Purely cosmetic "generating..." state for the fixed-structure Excel
  // export link below - see its own comment for why this is a timeout, not
  // a real completion signal.
  const [isExportingFixedStructure, setIsExportingFixedStructure] = useState(false);

  function handleRunFixedStructureCheck() {
    if (tableGroupFilter === "all" || fixedStructureCheckLoading) return; // button is disabled in this case; defensive no-op
    const groupName = tableGroupFilter;
    setFixedStructureCheckLoading(true);
    setFixedStructureCheckError(null);
    checkTeachingPracticeFixedStructureForAdmin(groupName)
      .then((result) => {
        setFixedStructureCheckResult(result);
        setFixedStructureCheckGroupName(groupName);
      })
      .catch((err: unknown) => {
        setFixedStructureCheckError(err instanceof Error ? err.message : "אירעה שגיאה בבדיקת השיבוץ");
      })
      .finally(() => setFixedStructureCheckLoading(false));
  }

  // Clears the result panel (and, implicitly, the stale-result banner, since
  // isFixedStructureCheckStale requires fixedStructureCheckResult !== null) -
  // no reload needed, and the check can be re-run freely afterward.
  function handleClearFixedStructureCheck() {
    setFixedStructureCheckResult(null);
    setFixedStructureCheckGroupName(null);
    setFixedStructureCheckError(null);
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
  // The separate "שם משפחה" (child last name) column is only useful in view
  // mode, where the child-name cell shows just the first name
  // (row.childFirstName) - in edit mode that same cell becomes a
  // SearchableSelect showing the child's full name, making a second column
  // for the last name alone redundant. Used (instead of raw
  // columnVisibility) both for the column's own conditional rendering below
  // and for the table-width/colSpan math that counts visible columns, so
  // those stay in sync with what's actually rendered in edit mode - the
  // column-visibility panel's own checkbox state (columnVisibility itself)
  // is untouched, so the user's preference is remembered and simply resumes
  // once back in view mode.
  const effectiveColumnVisibility: TrackColumnVisibility = isEditMode
    ? { ...columnVisibility, childLastName: false }
    : columnVisibility;
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
    // By exact rotationOrder (getTraineeAtRotation), never by position in a
    // sorted-and-compacted array - see that helper's own comment for why a
    // sparse roster would otherwise render as if a later slot's trainee had
    // shifted into an earlier, empty one.
    const traineeIdsBySlot = Array.from(
      { length: teamSize },
      (_, i) => getTraineeAtRotation(track, i)?.traineeId ?? ""
    );
    // Slot-0's name specifically ("חניך מתרגל") is what the Beginners
    // block table derives its group-level roster from - a private track's
    // own slot-0 trainee is the one tied to that specific child.
    const traineeNamesBySlot = Array.from(
      { length: teamSize },
      (_, i) => getTraineeAtRotation(track, i)?.fullName ?? "—"
    );
    const sortedTrainees = [...track.trainees].sort((a, b) => a.rotationOrder - b.rotationOrder);
    const rosterSummary = sortedTrainees.length > 0 ? sortedTrainees.map((t) => t.fullName).join(", ") : "—";
    const childRows = track.children.map((tc) => ({
      registryChild: tc.childId ? (childById.get(tc.childId) ?? null) : null,
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

  // Stage TP-Roles-1 - fixed-structure seat swap eligibility, read from the
  // persisted track (not the unsaved teamSelections draft) since the swap
  // action commits immediately, independent of "שמירת צוות". LUNGE is always
  // exactly a 2-seat team (TEAM_SIZE), so a swap unambiguously means seat 0
  // <-> seat 1 - no seat picker needed.
  //
  // Stage TP-Roles-2 - LUNGE only. BEGINNER_PRIVATE no longer rotates its
  // two seats by occurrence at all (rotationOrder 0 is always
  // LEAD_INSTRUCTOR, rotationOrder 1 is always ASSISTANT_INSTRUCTOR on every
  // date - see lib/teaching-practice-rotation.ts), so "swap" there would
  // really mean permanently reassigning who holds the fixed lead/assistant
  // role - that belongs in the normal per-seat trainee editor above, not
  // this rotation-position-swap action (see swapTeachingPracticeTrackTraineeSeatsAsAdmin's
  // own comment for the same reasoning, enforced server-side too).
  const swapSeatsPersistedSlot0 = openTrack?.trainees.find((t) => t.rotationOrder === 0)?.traineeId ?? "";
  const swapSeatsPersistedSlot1 = openTrack?.trainees.find((t) => t.rotationOrder === 1)?.traineeId ?? "";
  // Blocked while teamSelections has an unsaved edit relative to the
  // persisted seats - otherwise a stale draft, saved afterward via
  // handleSaveTeam, would silently undo the swap.
  const hasUnsavedTeamDraft =
    teamSelections[0] !== swapSeatsPersistedSlot0 || teamSelections[1] !== swapSeatsPersistedSlot1;
  const canSwapTrackTraineeSeats =
    !!openTrack &&
    openTrack.practiceType === "LUNGE" &&
    swapSeatsPersistedSlot0 !== "" &&
    swapSeatsPersistedSlot1 !== "" &&
    !hasUnsavedTeamDraft;

  function openTrackManager(track: TeachingPracticeTrackSummary) {
    setOpenTrackId(track.id);
    setEditTrackForm(trackToFormState(track));
    // By exact rotationOrder, not compact array index - the same rendering
    // bug as buildTrackRowData's traineeIdsBySlot (see its own comment): a
    // sparse roster (e.g. only rotationOrder 1 filled, after clearing slot
    // 0 via the inline "ללא חניך" option) must show up as an empty slot 0 +
    // filled slot 1 here too, never shifted into slot 0.
    const teamSizeForTrack = TEACHING_PRACTICE_TEAM_SIZE[track.practiceType];
    const traineeIdsByRotation = Array.from(
      { length: teamSizeForTrack },
      (_, i) => track.trainees.find((t) => t.rotationOrder === i)?.traineeId ?? ""
    );
    setTeamSelections(traineeIdsByRotation);
    setTrackChildRows(
      track.children.map((c) => ({
        // A null childId (childless horse/equipment placeholder) is shown
        // the same way the form already shows any not-yet-chosen row: an
        // empty select. handleSaveTrackChildren re-derives null from "" on
        // save (see below), so this round-trips correctly.
        childId: c.childId ?? "",
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
      // Fixed-structure field edits now auto-sync eligible future generated
      // lessons server-side (time/location/instructor/groupName/roster) -
      // refreshLessons() too, not just refreshTracks(), so the generated
      // lessons table reflects that immediately instead of only after some
      // unrelated action refetches it.
      await Promise.all([refreshTracks(), refreshLessons()]);
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
  // Admin-only leading "ללא חניך" (clear) option, value "" - handled
  // specially by handleInlineAssignTrainee below, which routes it to the
  // exact-slot clearTeachingPracticeTrackTraineeSlotAsAdmin instead of the
  // compacting replace-all path. Not offered to instructors, since that
  // action is admin-only (matches this stage's explicit scope).
  function traineeSelectOptions(
    track: TeachingPracticeTrackSummary,
    selectedId: string
  ): SearchableSelectOption[] {
    const groupName = track.groupName ?? "";
    const realOptions = teamOptionsForSlot(groupName, selectedId).map((s) => ({
      value: s.id,
      label: `${s.fullName}${s.groupName ? ` (קבוצה ${s.groupName})` : ""}${
        groupName && s.groupName !== groupName ? " - מחוץ לקבוצה שנבחרה" : ""
      }`,
    }));
    if (role !== "admin") return realOptions;
    return [{ value: "", label: "ללא חניך" }, ...realOptions];
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
      // Trainee saves now auto-sync eligible future generated lessons
      // server-side too (see handleSaveTrackFields above for why both
      // refreshes are needed).
      await Promise.all([refreshTracks(), refreshLessons()]);
    });
  }

  // Stage TP-Roles-1 - "החלפת מיקום ברוטציה": atomically swaps the trainees
  // in seat 0 and seat 1 of the fixed structure (rotationOrder is the source
  // of truth the rotation formula reads - see
  // lib/teaching-practice-rotation.ts - so this is a seat swap, not a direct
  // role edit). Admin-only, same as swapTeachingPracticeTrackTraineeSeatsAsAdmin
  // itself (no instructor counterpart, matching setTeachingPracticeTrackTraineeSlotAsAdmin
  // above). Stage TP-Roles-2 - LUNGE only now (see canSwapTrackTraineeSeats
  // and the action's own comment): BEGINNER_GROUP's roster is derived from
  // linked private tracks, and BEGINNER_PRIVATE's two seats no longer rotate
  // at all, so "swapping" either would be misleading rather than a real
  // rotation-position change.
  function handleSwapTrackTraineeSeats() {
    if (!openTrackId || !canSwapTrackTraineeSeats) return;
    if (
      !window.confirm(
        "להחליף בין החניכים במבנה הקבוע? השינוי יסונכרן לשיעורים עתידיים לפי כללי הסנכרון."
      )
    ) {
      return;
    }
    setTrackActionError(null);
    setTrackActionSuccess(null);
    startTrackActionTransition(async () => {
      const result = await swapTeachingPracticeTrackTraineeSeatsAsAdmin(openTrackId, 0, 1);
      if (!result.success) {
        setTrackActionError(result.error ?? "אירעה שגיאה");
        return;
      }
      setTrackActionSuccess("מיקום החניכים ברוטציה הוחלף");
      // Keeps the unsaved team-selection draft in sync with the swap
      // (rather than waiting for a refetch) - handleSaveTeam reads
      // teamSelections directly, so leaving it stale here would silently
      // undo this swap the next time "שמירת צוות" is clicked.
      setTeamSelections((prev) => {
        if (prev.length < 2) return prev;
        const next = [...prev];
        [next[0], next[1]] = [next[1], next[0]];
        return next;
      });
      await Promise.all([refreshTracks(), refreshLessons()]);
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

    // Exact-slot set/clear (admin only - see the admin-only "ללא חניך"
    // option in traineeSelectOptions). Deliberately NOT the replace-all path
    // below for either direction: rebuilding "the whole roster" from a
    // sorted-by-rotationOrder array indexed by POSITION (not by the actual
    // rotationOrder value) silently shifts every later slot whenever an
    // earlier one is a hole - the exact bug this fixes. setTeachingPracticeTrackTraineeSlotAsAdmin
    // only ever deletes/creates this exact (trackId, rotationOrder) row -
    // every other slot on the track is left untouched, never reindexed.
    if (role === "admin") {
      setInlineAssignError(null);
      setSavingCellKey(cellKey);
      startInlineAssignTransition(async () => {
        const result = await setTeachingPracticeTrackTraineeSlotAsAdmin(track.id, slotIndex, traineeId || null);
        setSavingCellKey(null);
        if (!result.success) {
          setInlineAssignError(result.error ?? "אירעה שגיאה בשיבוץ החניך/ה");
          return;
        }
        // Exact-slot saves now auto-sync eligible future generated lessons
        // server-side too (see handleSaveTrackFields above for why both
        // refreshes are needed).
        await Promise.all([refreshTracks(), refreshLessons()]);
      });
      return;
    }

    // Instructor path - unchanged replace-all (no exact-slot instructor
    // action exists; instructors never see the "ללא חניך" clear option, so
    // traineeId here is always a real, non-empty id).
    const teamSize = TEACHING_PRACTICE_TEAM_SIZE[track.practiceType];
    const sortedIds = [...track.trainees].sort((a, b) => a.rotationOrder - b.rotationOrder).map((t) => t.traineeId);
    const nextIds = Array.from({ length: teamSize }, (_, i) => sortedIds[i] ?? "");
    nextIds[slotIndex] = traineeId;
    const finalIds = nextIds.filter((id) => id !== "");

    setInlineAssignError(null);
    setSavingCellKey(cellKey);
    startInlineAssignTransition(async () => {
      const result = await setTeachingPracticeTrackTraineesAsInstructor(actorId!, track.id, finalIds);
      setSavingCellKey(null);
      if (!result.success) {
        setInlineAssignError(result.error ?? "אירעה שגיאה בשיבוץ החניך/ה");
        return;
      }
      // Replace-all saves now auto-sync eligible future generated lessons
      // server-side too (see handleSaveTrackFields above for why both
      // refreshes are needed).
      await Promise.all([refreshTracks(), refreshLessons()]);
    });
  }

  // Same replace-all idiom as handleInlineAssignTrainee, but for this
  // track's single child/horse/equipment row (track.children is normally 0
  // or 1 row - callers only wire this cell up when that holds). Preserves
  // whatever horseName/equipmentNotes the track already had so switching (or
  // clearing) which child is assigned never wipes them. Clearing the child
  // keeps the row - as a childless horse/equipment placeholder (Approach A)
  // - when there's still horse/equipment worth keeping, and only drops the
  // row entirely once it would otherwise be completely empty, so data is
  // never silently lost.
  function handleInlineAssignTrackChild(track: TeachingPracticeTrackSummary, childId: string) {
    const cellKey = `${track.id}-child`;
    const current = track.children[0] ?? null;
    const horseName = current?.horseName ?? null;
    const equipmentNotes = current?.equipmentNotes ?? null;
    const finalRows: TeachingPracticeTrackChildInput[] =
      childId || horseName || equipmentNotes ? [{ childId: childId || null, horseName, equipmentNotes }] : [];

    setInlineAssignError(null);
    setSavingCellKey(cellKey);
    startInlineAssignTransition(async () => {
      const result =
        role === "admin"
          ? await setTeachingPracticeTrackChildrenAsAdmin(track.id, finalRows)
          : await setTeachingPracticeTrackChildrenAsInstructor(actorId!, track.id, finalRows);
      setSavingCellKey(null);
      if (!result.success) {
        setInlineAssignError(result.error ?? "אירעה שגיאה בשיבוץ הילד/ה");
        return;
      }
      // Child assignment saves now auto-sync eligible future generated
      // lessons server-side too (see handleSaveTrackFields above for why
      // both refreshes are needed).
      await Promise.all([refreshTracks(), refreshLessons()]);
    });
  }

  // Edits just one of horseName/equipmentNotes on the track's single
  // child/horse/equipment row, leaving childId and the other field
  // untouched. Child, horse, and equipment are independent fields (product
  // rule) - this saves a childless placeholder row (childId: null) when
  // there's no child assigned yet, rather than requiring one to be picked
  // first. Later assigning a child via handleInlineAssignTrackChild reuses
  // this same row (same track.children[0]) and preserves these values.
  function handleInlineEditTrackChildField(
    track: TeachingPracticeTrackSummary,
    field: "horseName" | "equipmentNotes",
    value: string
  ) {
    const current = track.children[0] ?? null;
    const cellKey = `${track.id}-${field}`;
    const nextRow: TeachingPracticeTrackChildInput = {
      childId: current?.childId ?? null,
      horseName: field === "horseName" ? value || null : (current?.horseName ?? null),
      equipmentNotes: field === "equipmentNotes" ? value || null : (current?.equipmentNotes ?? null),
    };
    // Clearing the only field a childless row had (e.g. deleting the horse
    // text when there's no child and no equipment either) must not save a
    // completely empty placeholder row - drop it entirely instead.
    const finalRows: TeachingPracticeTrackChildInput[] =
      nextRow.childId || nextRow.horseName || nextRow.equipmentNotes ? [nextRow] : [];

    setInlineAssignError(null);
    setSavingCellKey(cellKey);
    startInlineAssignTransition(async () => {
      const result =
        role === "admin"
          ? await setTeachingPracticeTrackChildrenAsAdmin(track.id, finalRows)
          : await setTeachingPracticeTrackChildrenAsInstructor(actorId!, track.id, finalRows);
      setSavingCellKey(null);
      if (!result.success) {
        setInlineAssignError(result.error ?? "אירעה שגיאה בשמירת פרטי הסוס/ציוד");
        return;
      }
      // Horse/equipment saves now auto-sync eligible future generated
      // lessons server-side too (see handleSaveTrackFields above for why
      // both refreshes are needed).
      await Promise.all([refreshTracks(), refreshLessons()]);
    });
  }

  // Reuses the same full-object-rebuild idiom updateTeachingPracticeTrackAs*
  // already requires (see trackFormToInput) - every other field is copied
  // as-is from the already-loaded track summary, only notes changes.
  function handleInlineEditTrackNotes(track: TeachingPracticeTrackSummary, notes: string) {
    const cellKey = `${track.id}-notes`;
    const input: TeachingPracticeTrackInput = {
      practiceType: track.practiceType,
      groupName: track.groupName,
      weekday: track.weekday,
      defaultStartTime: track.defaultStartTime,
      defaultLocation: track.defaultLocation,
      defaultResponsibleInstructorId: track.defaultResponsibleInstructorId,
      groupTrackId: track.groupTrackId,
      notes: notes || null,
    };

    setInlineAssignError(null);
    setSavingCellKey(cellKey);
    startInlineAssignTransition(async () => {
      const result =
        role === "admin"
          ? await updateTeachingPracticeTrackAsAdmin(track.id, input)
          : await updateTeachingPracticeTrackAsInstructor(actorId!, track.id, input);
      setSavingCellKey(null);
      if (!result.success) {
        setInlineAssignError(result.error ?? "אירעה שגיאה בשמירת ההערות");
        return;
      }
      await refreshTracks();
    });
  }

  // Same group-filtered-with-visible-outlier pattern as teamOptionsForSlot,
  // but children aren't grouped, so this is just "make sure the currently
  // assigned child stays selectable even if somehow missing from the loaded
  // registry list" (e.g. mid-refresh). Always leads with an explicit
  // value=="" clear option - SearchableSelect only lets the user change to a
  // value that's actually in `options`, so without this there would be no
  // way to clear an already-assigned child back to childless.
  function childSelectOptions(selectedId: string): SearchableSelectOption[] {
    const clearOption: SearchableSelectOption = { value: "", label: "ללא ילד/ה" };
    const options = (children ?? []).map((c) => ({ value: c.id, label: c.fullName }));
    if (selectedId && !options.some((o) => o.value === selectedId)) {
      const selected = childById.get(selectedId);
      if (selected) return [clearOption, { value: selected.id, label: selected.fullName }, ...options];
    }
    return [clearOption, ...options];
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
    // A row with no child but real horse/equipment text is a valid childless
    // placeholder (Approach A) and must be kept, not silently dropped - only
    // a genuinely blank row (no child, no horse, no equipment - e.g. left
    // over from "הוספת ילד/ה" without filling anything in) is discarded.
    const rows = trackChildRows
      .filter((r) => r.childId !== "" || r.horseName.trim() !== "" || r.equipmentNotes.trim() !== "")
      .map((r) => ({
        childId: r.childId || null,
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

  // -------------------------------------------------------------------------
  // Block/header date assignment (admin-only) - lets an admin define dates
  // for a whole lunge group, or a whole beginner-private/beginner-group
  // set within one group (א/ב), in one call instead of generating dates one
  // track at a time. Reuses the same additive, skip-if-exists server action
  // for every block type; the modal itself doesn't need to know which
  // tracks are involved.
  // -------------------------------------------------------------------------

  interface BlockDateTarget {
    blockType: TeachingPracticeDateBlockType;
    groupName?: string | null;
    label: string;
  }

  const [blockDateTarget, setBlockDateTarget] = useState<BlockDateTarget | null>(null);
  const [blockDateDraft, setBlockDateDraft] = useState("");
  const [blockDates, setBlockDates] = useState<string[]>([]);
  const [blockDateError, setBlockDateError] = useState<string | null>(null);
  const [blockDateSummary, setBlockDateSummary] = useState<{
    createdCount: number;
    skippedExistingCount: number;
    warnings: string[];
  } | null>(null);
  const [isBlockDatePending, startBlockDateTransition] = useTransition();

  function openBlockDateModal(target: BlockDateTarget) {
    setBlockDateTarget(target);
    setBlockDateDraft("");
    setBlockDates([]);
    setBlockDateError(null);
    setBlockDateSummary(null);
  }

  function closeBlockDateModal() {
    setBlockDateTarget(null);
  }

  function addBlockDate() {
    if (!blockDateDraft) return;
    setBlockDates((prev) => (prev.includes(blockDateDraft) ? prev : [...prev, blockDateDraft].sort()));
    setBlockDateDraft("");
  }

  function removeBlockDate(date: string) {
    setBlockDates((prev) => prev.filter((d) => d !== date));
  }

  function handleSubmitBlockDates() {
    if (!blockDateTarget) return;
    if (blockDates.length === 0) {
      setBlockDateError("יש לבחור לפחות תאריך אחד");
      return;
    }
    setBlockDateError(null);
    setBlockDateSummary(null);
    startBlockDateTransition(async () => {
      const result = await setTeachingPracticeDatesForBlockAsAdmin({
        blockType: blockDateTarget.blockType,
        groupName: blockDateTarget.groupName,
        dates: blockDates,
      });
      if (!result.success) {
        setBlockDateError(result.error ?? "אירעה שגיאה");
        return;
      }
      setBlockDateSummary({
        createdCount: result.createdCount ?? 0,
        skippedExistingCount: result.skippedExistingCount ?? 0,
        warnings: result.warnings ?? [],
      });
      setBlockDates([]);
      await Promise.all([refreshTracks(), refreshLessons()]);
    });
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
  // Stage 1 (generated-lessons inline editing) - which single inline cell is
  // currently saving, so only that one cell disables while a save is in
  // flight (same convention as the fixed-structure tables' savingCellKey).
  const [savingLessonCellKey, setSavingLessonCellKey] = useState<string | null>(null);

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
      if (selectedLessonDate) await refreshLessonDateDetail(selectedLessonDate);
    });
  }

  // Saves this one lesson's own fields, then (only on success) its
  // participants/roles, then (only on success) its child assignments -
  // each call already scoped to this single lessonId by the actions
  // themselves, so this never touches any other date/lesson/track. Refreshes
  // after every step regardless of outcome so the table reflects whatever
  // partial progress was actually saved, and reports which stage failed
  // rather than a generic error.
  async function handleUpdateLesson(
    lessonId: string,
    input: TeachingPracticeLessonInput,
    participantRows: TeachingPracticeParticipantInput[],
    childAssignmentRows: TeachingPracticeChildAssignmentInput[]
  ): Promise<ActionResult> {
    const lessonResult =
      role === "admin"
        ? await updateTeachingPracticeLessonAsAdmin(lessonId, input)
        : await updateTeachingPracticeLessonAsInstructor(actorId!, lessonId, input);
    if (!lessonResult.success) {
      await refreshLessons();
      // The edit may have moved the lesson to a different date than the one
      // currently selected - refresh whichever date is selected now (its
      // old date if the date field wasn't touched, or the tab will re-pick
      // once `lessons` no longer has anything on the stale selection).
      if (selectedLessonDate) await refreshLessonDateDetail(selectedLessonDate);
      return lessonResult;
    }

    const participantsResult =
      role === "admin"
        ? await setTeachingPracticeLessonParticipantsAsAdmin(lessonId, participantRows)
        : await setTeachingPracticeLessonParticipantsAsInstructor(actorId!, lessonId, participantRows);
    if (!participantsResult.success) {
      await refreshLessons();
      if (selectedLessonDate) await refreshLessonDateDetail(selectedLessonDate);
      return {
        success: false,
        error: `פרטי השיעור נשמרו, אך שגיאה בשמירת חניכים/תפקידים: ${participantsResult.error ?? ""}`,
      };
    }

    const childAssignmentsResult =
      role === "admin"
        ? await setTeachingPracticeLessonChildAssignmentsAsAdmin(lessonId, childAssignmentRows)
        : await setTeachingPracticeLessonChildAssignmentsAsInstructor(actorId!, lessonId, childAssignmentRows);

    await refreshLessons();
    if (selectedLessonDate) await refreshLessonDateDetail(selectedLessonDate);

    if (!childAssignmentsResult.success) {
      return {
        success: false,
        error: `השיעור והחניכים/תפקידים נשמרו, אך שגיאה בשמירת ילדים/סוסים/ציוד: ${childAssignmentsResult.error ?? ""}`,
      };
    }
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Lessons: inline (Excel-like) editing, straight from the generated-lessons
  // table - Stage 1. Same reasoning as the fixed-structure inline cells
  // above (handleInlineAssignTrainee etc.): each handler rebuilds the full
  // array/object the underlying replace-all action expects, changing only
  // the one field/row being edited, and reuses the exact same actions the
  // existing "עריכה" expanded form already calls - no new server logic, no
  // new protections to reason about (feedback-drop refusal, duplicate-trainee
  // rejection, meaningful-feedback sync protection are all inherited as-is).
  // -------------------------------------------------------------------------

  // "שעה" cell. Rebuilds the full TeachingPracticeLessonInput from the
  // lesson's own already-loaded fields (same full-object-rebuild idiom as
  // handleInlineEditTrackNotes for tracks), changing only startTime.
  // date/location/responsibleInstructorId/notes are always resent unchanged
  // (location stays editable via the existing expanded "עריכה" form, not
  // inline - see its own section below); roleLabelOverrides is deliberately
  // omitted from this input so it's left completely untouched -
  // updateTeachingPracticeLessonInternal only touches that key when it's
  // present in the input at all (see its own comment). endTime is never
  // sent - it stays server-derived exactly as today.
  function handleInlineUpdateLessonField(lesson: TeachingPracticeLessonSummary, startTime: string) {
    const cellKey = `lesson-${lesson.id}-startTime`;
    const input: TeachingPracticeLessonInput = {
      date: lesson.date,
      startTime,
      responsibleInstructorId: lesson.responsibleInstructorId,
      location: lesson.location,
      notes: lesson.notes,
    };

    setLessonActionError(null);
    setSavingLessonCellKey(cellKey);
    startLessonActionTransition(async () => {
      const result =
        role === "admin"
          ? await updateTeachingPracticeLessonAsAdmin(lesson.id, input)
          : await updateTeachingPracticeLessonAsInstructor(actorId!, lesson.id, input);
      setSavingLessonCellKey(null);
      if (!result.success) {
        setLessonActionError(result.error ?? "אירעה שגיאה בעדכון שעת ההתחלה");
        return;
      }
      await refreshLessons();
      if (selectedLessonDate) await refreshLessonDateDetail(selectedLessonDate);
    });
  }

  // "הערות" cell. Same full-object-rebuild idiom as handleInlineUpdateLessonField
  // (only notes changes; roleLabelOverrides stays omitted so it's left
  // untouched) and the same shared savingLessonCellKey/lessonActionError
  // convention every other Stage 1 cell uses - rendered via the existing
  // InlineTextEditCell (see its own comment), the same always-visible
  // blur/Enter-commit control already used for horseName/equipmentNotes/
  // track notes, so this field's edit UX matches those exactly.
  function handleInlineUpdateLessonNotes(lesson: TeachingPracticeLessonSummary, notes: string) {
    const cellKey = `lesson-${lesson.id}-notes`;
    const input: TeachingPracticeLessonInput = {
      date: lesson.date,
      startTime: lesson.startTime,
      responsibleInstructorId: lesson.responsibleInstructorId,
      location: lesson.location,
      notes,
    };

    setLessonActionError(null);
    setSavingLessonCellKey(cellKey);
    startLessonActionTransition(async () => {
      const result =
        role === "admin"
          ? await updateTeachingPracticeLessonAsAdmin(lesson.id, input)
          : await updateTeachingPracticeLessonAsInstructor(actorId!, lesson.id, input);
      setSavingLessonCellKey(null);
      if (!result.success) {
        setLessonActionError(result.error ?? "אירעה שגיאה בעדכון ההערות");
        return;
      }
      await refreshLessons();
      if (selectedLessonDate) await refreshLessonDateDetail(selectedLessonDate);
    });
  }

  // "חניך"/"תפקיד" cells. Rebuilds one row per expected role slot (the exact
  // same shape lessonToEditForm already builds for the expanded form),
  // changing only the one row at changedIndex, then drops any still-empty
  // slots before saving - byte-for-byte the same construction/filter
  // handleSaveEdit already does, just triggered per-cell instead of via one
  // combined "שמירה" button. Reuses setTeachingPracticeLessonParticipantsAs*
  // as-is, so its existing meaningful-feedback drop refusal and duplicate-
  // trainee validation both still apply unchanged.
  function handleInlineUpdateLessonParticipant(
    lesson: TeachingPracticeLessonDetail,
    roleSlots: TeachingPracticeRoleValue[],
    changedIndex: number,
    patch: Partial<LessonParticipantFormRow>
  ) {
    const cellKey = `lesson-${lesson.id}-participant-${changedIndex}`;
    const roleIndex = new Map(roleSlots.map((role, i) => [role, i]));
    const sorted = [...lesson.participants].sort(
      (a, b) => (roleIndex.get(a.role) ?? roleSlots.length) - (roleIndex.get(b.role) ?? roleSlots.length)
    );
    const rows: LessonParticipantFormRow[] = roleSlots.map((role, i) => ({
      traineeId: sorted[i]?.traineeId ?? "",
      role: sorted[i]?.role ?? role,
    }));
    if (changedIndex < 0 || changedIndex >= rows.length) return; // defensive - see callers' own i < roleSlots.length guard
    rows[changedIndex] = { ...rows[changedIndex], ...patch };
    const participantRows: TeachingPracticeParticipantInput[] = rows
      .filter((r) => r.traineeId !== "")
      .map((r) => ({ traineeId: r.traineeId, role: r.role }));

    setLessonActionError(null);
    setSavingLessonCellKey(cellKey);
    startLessonActionTransition(async () => {
      const result =
        role === "admin"
          ? await setTeachingPracticeLessonParticipantsAsAdmin(lesson.id, participantRows)
          : await setTeachingPracticeLessonParticipantsAsInstructor(actorId!, lesson.id, participantRows);
      setSavingLessonCellKey(null);
      if (!result.success) {
        setLessonActionError(result.error ?? "אירעה שגיאה בשיבוץ החניך/ה או התפקיד");
        return;
      }
      await refreshLessons();
      if (selectedLessonDate) await refreshLessonDateDetail(selectedLessonDate);
    });
  }

  // Child/horse/equipment cells. Rebuilds one row per expected child slot
  // (same shape/order lessonToEditForm already uses), changing only the one
  // field on the row at changedIndex and preserving isAbsent for every row
  // exactly as it already was - captured per-row before the empty-slot
  // filter runs, so a later row's isAbsent can never be misattributed after
  // filtering shifts array positions. isAbsent is carried through
  // deliberately: the shared replace-all action defaults a missing isAbsent
  // to false (see setTeachingPracticeLessonChildAssignmentsInternal), which
  // would otherwise silently un-mark an already-absent child on every inline
  // edit - this stage never edits absence itself.
  function handleInlineUpdateLessonChild(
    lesson: TeachingPracticeLessonDetail,
    changedIndex: number,
    patch: { childId?: string; horseName?: string; equipmentNotes?: string }
  ) {
    const cellKey = `lesson-${lesson.id}-child-${changedIndex}`;
    const expectedChildSlots = EXPECTED_CHILD_SLOTS_BY_PRACTICE_TYPE[lesson.practiceType];
    const rows = Array.from({ length: expectedChildSlots }, (_, i) => ({
      childId: lesson.childAssignments[i]?.childId ?? "",
      horseName: lesson.childAssignments[i]?.horseName ?? "",
      equipmentNotes: lesson.childAssignments[i]?.equipmentNotes ?? "",
      isAbsent: lesson.childAssignments[i]?.isAbsent ?? false,
    }));
    if (changedIndex < 0 || changedIndex >= rows.length) return; // defensive - see callers' own i < expectedChildSlots guard
    rows[changedIndex] = { ...rows[changedIndex], ...patch };
    const childAssignmentRows: TeachingPracticeChildAssignmentInput[] = rows
      .filter((r) => r.childId !== "")
      .map((r) => ({
        childId: r.childId,
        horseName: r.horseName.trim() || null,
        equipmentNotes: r.equipmentNotes.trim() || null,
        isAbsent: r.isAbsent,
      }));

    setLessonActionError(null);
    setSavingLessonCellKey(cellKey);
    startLessonActionTransition(async () => {
      const result =
        role === "admin"
          ? await setTeachingPracticeLessonChildAssignmentsAsAdmin(lesson.id, childAssignmentRows)
          : await setTeachingPracticeLessonChildAssignmentsAsInstructor(actorId!, lesson.id, childAssignmentRows);
      setSavingLessonCellKey(null);
      if (!result.success) {
        setLessonActionError(result.error ?? "אירעה שגיאה בשיבוץ הילד/ה או פרטי הסוס/ציוד");
        return;
      }
      await refreshLessons();
      if (selectedLessonDate) await refreshLessonDateDetail(selectedLessonDate);
    });
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
    // min-w-0 defensively overrides the default flex-item min-width:auto -
    // without it, a wide table further down (min-w-[980px], inside its own
    // overflow-x-auto wrapper) can still inflate every ancestor's shrink-to-
    // fit width and break the whole admin page horizontally instead of just
    // scrolling within that one table's wrapper.
    <div className="flex min-w-0 flex-col gap-4">
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
        <div className="flex min-w-0 flex-col gap-4">
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

              {/* Stage 1 - read-only suggestion preview entry point,
                  admin-only. Scoped to whichever real group is currently
                  selected above; "all" has no single group to score
                  fairness against (Stage 0 design requires exactly one
                  group per run), so the button stays disabled with an
                  explanatory hint instead of silently defaulting to one. */}
              {role === "admin" && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="!px-3 !py-1.5 !text-xs"
                    disabled={tableGroupFilter === "all"}
                    onClick={handleOpenTraineeSuggestions}
                  >
                    הצע שיבוץ לקבוצה
                  </Button>
                  {/* Stage B - read-only trainee schedule overview, same
                      single-group-required convention as the suggestion
                      button. No write path at all - purely for visual
                      inspection of spacing/load. */}
                  <Button
                    type="button"
                    variant="secondary"
                    className="!px-3 !py-1.5 !text-xs"
                    disabled={tableGroupFilter === "all"}
                    onClick={handleOpenTraineeSchedule}
                  >
                    לו״ז חניכים
                  </Button>
                  {tableGroupFilter === "all" && (
                    <span className="text-xs text-muted-foreground">
                      יש לבחור קבוצה א או קבוצה ב כדי לקבל הצעות שיבוץ / לו״ז חניכים
                    </span>
                  )}
                </div>
              )}

              {/* Stage C2 - real fixed-structure -> generated-lessons sync.
                  Same single-group-required convention as the suggestion
                  button above (Stage C1 design requires exactly one group
                  per run - no system-wide sync). This is the only sync
                  entry point in this UI. */}
              {role === "admin" && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="!px-3 !py-1.5 !text-xs"
                    disabled={tableGroupFilter === "all"}
                    onClick={handleOpenSyncModal}
                  >
                    סנכרן מבנה קבוע לתאריכים
                  </Button>
                  {tableGroupFilter === "all" && (
                    <span className="text-xs text-muted-foreground">
                      יש לבחור קבוצה א או קבוצה ב כדי לסנכרן מבנה קבוע לתאריכים
                    </span>
                  )}
                </div>
              )}

              {/* Stage D1/D2 - read-only fixed-structure assignment check
                  ("בדוק שיבוץ"). Same single-group-required convention as the
                  suggestion/sync buttons above. No confirmation modal - this
                  is read-only, so results render inline right below, and can
                  be re-run freely. */}
              {role === "admin" && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="!px-3 !py-1.5 !text-xs"
                    disabled={tableGroupFilter === "all" || fixedStructureCheckLoading}
                    onClick={handleRunFixedStructureCheck}
                  >
                    {fixedStructureCheckLoading ? "בודק..." : "בדוק שיבוץ"}
                  </Button>
                  {tableGroupFilter === "all" && (
                    <span className="text-xs text-muted-foreground">
                      יש לבחור קבוצה א או קבוצה ב כדי לבדוק שיבוץ
                    </span>
                  )}
                </div>
              )}

              {/* Fixed-structure Excel export - both groups, one file, two
                  sheets ("קבוצה א"/"קבוצה ב"). No group-filter requirement
                  (always exports both), no confirmation (read-only). Plain
                  link + native browser download, same pattern as every
                  other export in this app (e.g. the day-export link below,
                  ScheduleClient.tsx). isExportingFixedStructure is a purely
                  cosmetic "generating..." affordance - the download itself
                  is a normal navigation, not a fetch, so there is no real
                  completion event to key off; the timeout just gives brief
                  visible feedback since export routes elsewhere in this app
                  show none. */}
              {role === "admin" && (
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href="/api/admin/teaching-practice/fixed-structure-export"
                    onClick={() => {
                      setIsExportingFixedStructure(true);
                      window.setTimeout(() => setIsExportingFixedStructure(false), 2000);
                    }}
                    className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:opacity-80"
                  >
                    {isExportingFixedStructure ? "מייצא..." : "ייצוא מבנה קבוע לאקסל"}
                  </a>
                </div>
              )}

              {role === "admin" && fixedStructureCheckError && (
                <p className="text-sm text-danger">{fixedStructureCheckError}</p>
              )}

              {role === "admin" && fixedStructureCheckResult && (
                <TeachingPracticeFixedStructureCheckPanel
                  result={fixedStructureCheckResult}
                  isStale={isFixedStructureCheckStale}
                  tracks={tracks}
                  childrenList={children}
                  onClear={handleClearFixedStructureCheck}
                />
              )}

              {/* View-mode-only click-to-highlight hint + current selection
                  indicator - purely a UI affordance, no DB read/write. Only
                  shown in view mode, since edit mode replaces the clickable
                  name with a live SearchableSelect (nothing to click). */}
              {!effectiveCanEdit && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>לחיצה על שם חניך מסמנת את כל ההופעות שלו במבנה.</span>
                  {selectedHighlightedTraineeId && (
                    <>
                      <span className="rounded-full bg-primary/20 px-2 py-0.5 font-medium text-primary">
                        מסומן: {selectedHighlightedTraineeName}
                      </span>
                      <button
                        type="button"
                        onClick={handleClearTraineeHighlight}
                        className="text-primary underline decoration-dotted"
                      >
                        נקה סימון
                      </button>
                    </>
                  )}
                </div>
              )}

              {!effectiveCanEdit && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>לחיצה על שם ילד/ה מסמנת הופעות נוספות ואותו הורה.</span>
                  {selectedHighlightedChildId && (
                    <>
                      <span className="rounded-full bg-primary/20 px-2 py-0.5 font-medium text-primary">
                        מסומן: {selectedHighlightedChildName}
                      </span>
                      {sameParentChildNames.length > 0 && (
                        <span className="rounded-full bg-warning-muted px-2 py-0.5 font-medium text-warning">
                          אותו הורה: {sameParentChildNames.join(", ")}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={handleClearChildHighlight}
                        className="text-primary underline decoration-dotted"
                      >
                        נקה סימון
                      </button>
                    </>
                  )}
                </div>
              )}

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
                  // View-mode-only time-block coloring (see timeBlockColorClasses) -
                  // rows are already sorted by defaultStartTime (buildAssignmentRows),
                  // so a consecutive run of equal times shares one color.
                  const rowColors = timeBlockColorClasses(rows.map((row) => row.track.defaultStartTime));
                  return (
                    <div key={`lunge-${section.groupValue ?? "none"}`}>
                      <h3 className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold text-secondary-foreground">
                        <span>{section.label}</span>
                        {role === "admin" && (
                          <Button
                            variant="secondary"
                            className="!px-2 !py-1 !text-xs font-normal"
                            onClick={() =>
                              openBlockDateModal({
                                blockType: "LUNGE_GROUP",
                                groupName: section.groupValue,
                                label: section.label,
                              })
                            }
                          >
                            הגדרת תאריכים
                          </Button>
                        )}
                      </h3>
                      {rows.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-border bg-card p-3 text-center text-xs text-muted-foreground">
                          אין עדיין סלוטים קבועים בקטגוריה זו.
                        </p>
                      ) : (
                        // Bounded self-contained scroll box (same max-h-[70vh]
                        // overflow-auto pattern as ScheduleGrid.tsx) - the
                        // header row's sticky top-0 below sticks to the top of
                        // *this* box only, never the page, so it can't collide
                        // with the admin layout's own sticky header. A short
                        // table (few tracks) never hits max-h, so it never
                        // looks boxed-in - overflow only engages once content
                        // actually exceeds 70vh. min-width keeps columns from
                        // being squeezed illegibly narrow on small screens.
                        <div className="-mx-1 min-w-0 max-h-[70vh] overflow-auto px-1 pb-1">
                          <table
                            className="w-full border-collapse text-xs"
                            style={{
                              minWidth: trackTableMinWidthPx(LUNGE_COLUMN_KEYS, effectiveColumnVisibility),
                            }}
                          >
                            <thead>
                              <tr className="bg-muted text-muted-foreground">
                                {columnVisibility.lungeTime && (
                                  <th
                                    className={`sticky top-0 bg-muted px-2 py-2 text-right font-bold ${
                                      lungeStickyKey === "lungeTime" ? "right-0 z-20" : "z-10"
                                    }`}
                                  >
                                    שעה
                                  </th>
                                )}
                                {columnVisibility.leadTrainee && (
                                  <th
                                    className={`sticky top-0 bg-muted px-2 py-2 text-right font-bold ${
                                      lungeStickyKey === "leadTrainee" ? "right-0 z-20" : "z-10"
                                    }`}
                                  >
                                    חניך מדריך
                                  </th>
                                )}
                                {columnVisibility.assistantTrainee && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">עוזר מדריך</th>
                                )}
                                {columnVisibility.childFirstName && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">שם הילד</th>
                                )}
                                {effectiveColumnVisibility.childLastName && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">שם משפחה</th>
                                )}
                                {columnVisibility.age && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">גיל</th>
                                )}
                                {columnVisibility.gender && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">מין</th>
                                )}
                                {columnVisibility.horse && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">סוס</th>
                                )}
                                {columnVisibility.equipment && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">ציוד</th>
                                )}
                                {columnVisibility.parentName && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">שם ההורה</th>
                                )}
                                {columnVisibility.parentPhone && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">טלפון</th>
                                )}
                                {columnVisibility.notes && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">הערות</th>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((row, rowIndex) => (
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
                                    !isEditMode ? rowColors[rowIndex] : ""
                                  } ${row.track.isActive ? "" : "opacity-60"}`}
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
                                      highlightedTraineeId={selectedHighlightedTraineeId}
                                      onToggleHighlight={handleToggleTraineeHighlight}
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
                                      highlightedTraineeId={selectedHighlightedTraineeId}
                                      onToggleHighlight={handleToggleTraineeHighlight}
                                    />
                                  )}
                                  {columnVisibility.childFirstName && (
                                    <ChildAssignmentCell
                                      value={row.track.children[0]?.childId ?? ""}
                                      label={row.childFirstName}
                                      options={childSelectOptions(row.track.children[0]?.childId ?? "")}
                                      editable={effectiveCanEdit && row.track.children.length <= 1}
                                      disabled={savingCellKey === `${row.track.id}-child`}
                                      onAssign={(childId) => handleInlineAssignTrackChild(row.track, childId)}
                                      parentKey={parentKeyByChildId.get(row.track.children[0]?.childId ?? "") ?? null}
                                      otherSameParentNames={sameParentOtherNamesByChildId.get(row.track.children[0]?.childId ?? "") ?? []}
                                      onOpenSameParentPopup={handleOpenSameParentPopup}
                                      highlightedChildId={selectedHighlightedChildId}
                                      highlightedParentKey={selectedHighlightedParentKey}
                                      onToggleHighlight={handleToggleChildHighlight}
                                    />
                                  )}
                                  {effectiveColumnVisibility.childLastName && (
                                    <td className="px-2 py-2">{row.childLastName}</td>
                                  )}
                                  {columnVisibility.age && <td className="px-2 py-2">{row.childAge}</td>}
                                  {columnVisibility.gender && <td className="px-2 py-2">{row.childGender}</td>}
                                  {columnVisibility.horse && (
                                    <InlineTextEditCell
                                      value={row.track.children[0]?.horseName ?? ""}
                                      label={row.horseName}
                                      editable={effectiveCanEditHorseFields && row.track.children.length <= 1}
                                      disabled={savingCellKey === `${row.track.id}-horseName`}
                                      placeholder="סוס"
                                      onCommit={(value) => handleInlineEditTrackChildField(row.track, "horseName", value)}
                                    />
                                  )}
                                  {columnVisibility.equipment && (
                                    <InlineTextEditCell
                                      value={row.track.children[0]?.equipmentNotes ?? ""}
                                      label={row.equipmentNotes}
                                      editable={effectiveCanEditHorseFields && row.track.children.length <= 1}
                                      disabled={savingCellKey === `${row.track.id}-equipmentNotes`}
                                      placeholder="ציוד"
                                      onCommit={(value) =>
                                        handleInlineEditTrackChildField(row.track, "equipmentNotes", value)
                                      }
                                    />
                                  )}
                                  {columnVisibility.parentName && (
                                    <td className="px-2 py-2">{row.parentName}</td>
                                  )}
                                  {columnVisibility.parentPhone && (
                                    <td className="px-2 py-2">
                                      <ParentPhoneCell phone={row.parentPhone} isEditMode={isEditMode} />
                                    </td>
                                  )}
                                  {columnVisibility.notes && (
                                    <InlineTextEditCell
                                      value={row.track.notes ?? ""}
                                      label={row.track.notes || "—"}
                                      editable={effectiveCanEdit}
                                      disabled={savingCellKey === `${row.track.id}-notes`}
                                      placeholder="הערות"
                                      truncateClassName="max-w-[220px] truncate"
                                      title={row.track.notes ?? undefined}
                                      onCommit={(value) => handleInlineEditTrackNotes(row.track, value)}
                                    />
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
                  // View-mode-only time-block coloring, keyed by each linked
                  // private row's OWN defaultStartTime (not the group's) -
                  // two private rows in the same group block with different
                  // private times must look different, not identical. Built
                  // as one flat list across every block in render order
                  // (block by block, row by row within each), exactly
                  // mirroring how the rows themselves are rendered below, so
                  // a run of consecutive equal private times - whether
                  // within one block or spanning a block boundary that
                  // happens to share a time - shares one color, same
                  // "consecutive equal key" convention as the LUNGE table.
                  // A block with no linked private track yet (the "טרם
                  // שויכו..." placeholder row) has no private time to key
                  // on, so it falls back to the group's own time instead -
                  // group-block cohesion for that one edge case is still
                  // visible via the group-time cell's rowSpan and the
                  // block's top border, never via a fabricated private time.
                  const blockRowCounts = blocks.map((block) => Math.max(block.privateRows.length, 1));
                  const privateRowColorKeys = blocks.flatMap((block, blockIdx) =>
                    Array.from({ length: blockRowCounts[blockIdx] }, (_, i) => {
                      const privateRow = block.privateRows[i] ?? null;
                      return privateRow ? privateRow.track.defaultStartTime : block.groupTrack.defaultStartTime;
                    })
                  );
                  const privateRowColors = timeBlockColorClasses(privateRowColorKeys);
                  const blockColorStartOffsets: number[] = [];
                  {
                    let offset = 0;
                    for (const count of blockRowCounts) {
                      blockColorStartOffsets.push(offset);
                      offset += count;
                    }
                  }
                  const unlinkedPrivate = buildUnlinkedPrivateTracks(section.groupValue);
                  // View-mode-only time-block coloring, same convention as
                  // the LUNGE table above (rows already sorted by
                  // defaultStartTime via buildUnlinkedPrivateTracks).
                  const unlinkedColors = timeBlockColorClasses(unlinkedPrivate.map((row) => row.track.defaultStartTime));
                  // Date assignment for beginners is by (practiceType,
                  // groupName), not per individual block - one action for
                  // every private track in this group, one for every group
                  // track in this group, matching how LUNGE_GROUP already
                  // works. Buttons only appear when the group actually has
                  // that kind of track to act on.
                  const hasPrivateTracks =
                    blocks.some((b) => b.privateRows.length > 0) || unlinkedPrivate.length > 0;
                  const hasGroupTracks = blocks.length > 0;
                  return (
                    <div key={`beginner-${section.groupValue ?? "none"}`}>
                      <h3 className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold text-secondary-foreground">
                        <span>{section.label}</span>
                        {role === "admin" && (hasPrivateTracks || hasGroupTracks) && (
                          <div className="flex flex-wrap gap-2">
                            {hasPrivateTracks && (
                              <Button
                                variant="secondary"
                                className="!px-2 !py-1 !text-xs font-normal"
                                onClick={() =>
                                  openBlockDateModal({
                                    blockType: "BEGINNER_PRIVATE_GROUP",
                                    groupName: section.groupValue,
                                    label: `${section.label} · פרטני`,
                                  })
                                }
                              >
                                הגדרת תאריכים - פרטני
                              </Button>
                            )}
                            {hasGroupTracks && (
                              <Button
                                variant="secondary"
                                className="!px-2 !py-1 !text-xs font-normal"
                                onClick={() =>
                                  openBlockDateModal({
                                    blockType: "BEGINNER_GROUP_LESSONS_GROUP",
                                    groupName: section.groupValue,
                                    label: `${section.label} · קבוצתי`,
                                  })
                                }
                              >
                                הגדרת תאריכים - קבוצתי
                              </Button>
                            )}
                          </div>
                        )}
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
                        // Bounded self-contained scroll box, same pattern as
                        // the LUNGE table above. Only the second header row
                        // (the actual column labels) is made sticky - the
                        // first row is just the "קבוצתי"/"פרטני" spanning
                        // label, and stacking two sticky rows would need a
                        // hardcoded pixel top-offset for the second row (its
                        // rendered height isn't known statically), which is
                        // exactly the kind of fragile guess this change
                        // avoids (same reasoning as ScheduleGrid.tsx Stage
                        // 1). It scrolls out of view normally once past.
                        <div className="-mx-1 min-w-0 max-h-[70vh] overflow-auto px-1 pb-1">
                          <table
                            className="w-full border-collapse text-xs"
                            style={{
                              minWidth: trackTableMinWidthPx(BEGINNER_BLOCK_COLUMN_KEYS, effectiveColumnVisibility),
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
                                    visibleColumnCount(BEGINNER_PRIVATE_SIDE_COLUMN_KEYS, effectiveColumnVisibility)
                                  )}
                                  className="border-b border-border px-2 py-1.5 text-center font-bold"
                                >
                                  פרטני
                                </th>
                              </tr>
                              <tr className="bg-muted text-muted-foreground">
                                {columnVisibility.groupTime && (
                                  <th
                                    className={`sticky top-0 bg-muted px-2 py-2 text-right font-bold ${
                                      beginnerStickyKey === "groupTime" ? "right-0 z-20" : "z-10"
                                    }`}
                                  >
                                    שעה לקבוצתי
                                  </th>
                                )}
                                {columnVisibility.privateTime && (
                                  <th
                                    className={`sticky top-0 bg-muted px-2 py-2 text-right font-bold ${
                                      beginnerStickyKey === "privateTime" ? "right-0 z-20" : "z-10"
                                    }`}
                                  >
                                    שעה לפרטני
                                  </th>
                                )}
                                {columnVisibility.leadTrainee && (
                                  <th
                                    className={`sticky top-0 bg-muted px-2 py-2 text-right font-bold ${
                                      beginnerStickyKey === "leadTrainee" ? "right-0 z-20" : "z-10"
                                    }`}
                                  >
                                    חניך מתרגל
                                  </th>
                                )}
                                {columnVisibility.assistantTrainee && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">עוזר מדריך</th>
                                )}
                                {columnVisibility.childFirstName && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">שם הילד</th>
                                )}
                                {effectiveColumnVisibility.childLastName && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">שם משפחה</th>
                                )}
                                {columnVisibility.age && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">גיל</th>
                                )}
                                {columnVisibility.gender && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">מין</th>
                                )}
                                {columnVisibility.horse && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">סוס</th>
                                )}
                                {columnVisibility.equipment && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">ציוד</th>
                                )}
                                {columnVisibility.parentName && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">שם ההורה</th>
                                )}
                                {columnVisibility.parentPhone && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">טלפון</th>
                                )}
                                {columnVisibility.notes && (
                                  <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">הערות</th>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {blocks.map((block, blockIndex) => {
                                const rowCount = Math.max(block.privateRows.length, 1);
                                return (
                                  <Fragment key={block.key}>
                                    {Array.from({ length: rowCount }, (_, i) => {
                                      const privateRow = block.privateRows[i] ?? null;
                                      const flatRowColor = privateRowColors[blockColorStartOffsets[blockIndex] + i];
                                      return (
                                        <tr
                                          key={privateRow?.key ?? `${block.key}-empty`}
                                          className={`border-border ${i === 0 ? "border-t-2" : "border-t"} ${
                                            !isEditMode ? flatRowColor : ""
                                          }`}
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
                                                  highlightedTraineeId={selectedHighlightedTraineeId}
                                                  onToggleHighlight={handleToggleTraineeHighlight}
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
                                                  highlightedTraineeId={selectedHighlightedTraineeId}
                                                  onToggleHighlight={handleToggleTraineeHighlight}
                                                />
                                              )}
                                              {columnVisibility.childFirstName && (
                                                <ChildAssignmentCell
                                                  value={privateRow.track.children[0]?.childId ?? ""}
                                                  label={privateRow.childFirstName}
                                                  options={childSelectOptions(
                                                    privateRow.track.children[0]?.childId ?? ""
                                                  )}
                                                  editable={effectiveCanEdit && privateRow.track.children.length <= 1}
                                                  disabled={savingCellKey === `${privateRow.track.id}-child`}
                                                  onAssign={(childId) =>
                                                    handleInlineAssignTrackChild(privateRow.track, childId)
                                                  }
                                                  onOpen={() => openTrackManager(privateRow.track)}
                                                  isActive={privateRow.track.isActive}
                                                  parentKey={parentKeyByChildId.get(privateRow.track.children[0]?.childId ?? "") ?? null}
                                                  otherSameParentNames={sameParentOtherNamesByChildId.get(privateRow.track.children[0]?.childId ?? "") ?? []}
                                                  onOpenSameParentPopup={handleOpenSameParentPopup}
                                                  highlightedChildId={selectedHighlightedChildId}
                                                  highlightedParentKey={selectedHighlightedParentKey}
                                                  onToggleHighlight={handleToggleChildHighlight}
                                                />
                                              )}
                                              {effectiveColumnVisibility.childLastName && (
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
                                                <InlineTextEditCell
                                                  value={privateRow.track.children[0]?.horseName ?? ""}
                                                  label={privateRow.horseName}
                                                  editable={
                                                    effectiveCanEditHorseFields && privateRow.track.children.length <= 1
                                                  }
                                                  disabled={savingCellKey === `${privateRow.track.id}-horseName`}
                                                  placeholder="סוס"
                                                  onCommit={(value) =>
                                                    handleInlineEditTrackChildField(privateRow.track, "horseName", value)
                                                  }
                                                  onOpen={() => openTrackManager(privateRow.track)}
                                                  isActive={privateRow.track.isActive}
                                                />
                                              )}
                                              {columnVisibility.equipment && (
                                                <InlineTextEditCell
                                                  value={privateRow.track.children[0]?.equipmentNotes ?? ""}
                                                  label={privateRow.equipmentNotes}
                                                  editable={
                                                    effectiveCanEditHorseFields && privateRow.track.children.length <= 1
                                                  }
                                                  disabled={savingCellKey === `${privateRow.track.id}-equipmentNotes`}
                                                  placeholder="ציוד"
                                                  onCommit={(value) =>
                                                    handleInlineEditTrackChildField(
                                                      privateRow.track,
                                                      "equipmentNotes",
                                                      value
                                                    )
                                                  }
                                                  onOpen={() => openTrackManager(privateRow.track)}
                                                  isActive={privateRow.track.isActive}
                                                />
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
                                                  <ParentPhoneCell phone={privateRow.parentPhone} isEditMode={isEditMode} />
                                                </ClickableCell>
                                              )}
                                              {columnVisibility.notes && (
                                                <InlineTextEditCell
                                                  value={privateRow.track.notes ?? ""}
                                                  label={privateRow.track.notes || "—"}
                                                  editable={effectiveCanEdit}
                                                  disabled={savingCellKey === `${privateRow.track.id}-notes`}
                                                  placeholder="הערות"
                                                  truncateClassName="max-w-[220px] truncate"
                                                  title={privateRow.track.notes ?? undefined}
                                                  onCommit={(value) => handleInlineEditTrackNotes(privateRow.track, value)}
                                                  onOpen={() => openTrackManager(privateRow.track)}
                                                  isActive={privateRow.track.isActive}
                                                />
                                              )}
                                            </>
                                          ) : (
                                            <td
                                              colSpan={Math.max(
                                                1,
                                                visibleColumnCount(BEGINNER_PRIVATE_SIDE_COLUMN_KEYS, effectiveColumnVisibility)
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
                          {/* Bounded self-contained scroll box, same pattern
                              as the LUNGE/Beginners tables above. */}
                          <div className="-mx-1 min-w-0 max-h-[70vh] overflow-auto px-1 pb-1">
                            <table
                              className="w-full border-collapse text-xs"
                              style={{
                                minWidth: trackTableMinWidthPx(UNLINKED_COLUMN_KEYS, effectiveColumnVisibility),
                              }}
                            >
                              <thead>
                                <tr className="bg-muted text-muted-foreground">
                                  {columnVisibility.privateTime && (
                                    <th
                                      className={`sticky top-0 bg-muted px-2 py-2 text-right font-bold ${
                                        unlinkedStickyKey === "privateTime" ? "right-0 z-20" : "z-10"
                                      }`}
                                    >
                                      שעה לפרטני
                                    </th>
                                  )}
                                  {columnVisibility.leadTrainee && (
                                    <th
                                      className={`sticky top-0 bg-muted px-2 py-2 text-right font-bold ${
                                        unlinkedStickyKey === "leadTrainee" ? "right-0 z-20" : "z-10"
                                      }`}
                                    >
                                      חניך מתרגל
                                    </th>
                                  )}
                                  {columnVisibility.assistantTrainee && (
                                    <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">עוזר מדריך</th>
                                  )}
                                  {columnVisibility.childFirstName && (
                                    <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">שם הילד</th>
                                  )}
                                  {effectiveColumnVisibility.childLastName && (
                                    <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">שם משפחה</th>
                                  )}
                                  {columnVisibility.age && (
                                    <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">גיל</th>
                                  )}
                                  {columnVisibility.gender && (
                                    <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">מין</th>
                                  )}
                                  {columnVisibility.horse && (
                                    <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">סוס</th>
                                  )}
                                  {columnVisibility.equipment && (
                                    <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">ציוד</th>
                                  )}
                                  {columnVisibility.parentName && (
                                    <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">שם ההורה</th>
                                  )}
                                  {columnVisibility.parentPhone && (
                                    <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">טלפון</th>
                                  )}
                                  {columnVisibility.notes && (
                                    <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">הערות</th>
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {unlinkedPrivate.map((row, rowIndex) => (
                                  // Whole-row hover (unlike the Beginners block
                                  // table below, every cell in this row always
                                  // belongs to the same track, so highlighting
                                  // the row as one unit is never misleading) -
                                  // matches the LUNGE table's row-level hover.
                                  // isActive dimming stays per-cell (each
                                  // ClickableCell already applies it) - adding
                                  // it here too would double-dim inactive rows.
                                  <tr
                                    key={row.key}
                                    className={`border-t border-border hover:bg-muted/40 ${
                                      !isEditMode ? unlinkedColors[rowIndex] : ""
                                    }`}
                                  >
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
                                        highlightedTraineeId={selectedHighlightedTraineeId}
                                        onToggleHighlight={handleToggleTraineeHighlight}
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
                                        highlightedTraineeId={selectedHighlightedTraineeId}
                                        onToggleHighlight={handleToggleTraineeHighlight}
                                      />
                                    )}
                                    {columnVisibility.childFirstName && (
                                      <ChildAssignmentCell
                                        value={row.track.children[0]?.childId ?? ""}
                                        label={row.childFirstName}
                                        options={childSelectOptions(row.track.children[0]?.childId ?? "")}
                                        editable={effectiveCanEdit && row.track.children.length <= 1}
                                        disabled={savingCellKey === `${row.track.id}-child`}
                                        onAssign={(childId) => handleInlineAssignTrackChild(row.track, childId)}
                                        onOpen={() => openTrackManager(row.track)}
                                        isActive={row.track.isActive}
                                        parentKey={parentKeyByChildId.get(row.track.children[0]?.childId ?? "") ?? null}
                                      otherSameParentNames={sameParentOtherNamesByChildId.get(row.track.children[0]?.childId ?? "") ?? []}
                                      onOpenSameParentPopup={handleOpenSameParentPopup}
                                        highlightedChildId={selectedHighlightedChildId}
                                        highlightedParentKey={selectedHighlightedParentKey}
                                        onToggleHighlight={handleToggleChildHighlight}
                                      />
                                    )}
                                    {effectiveColumnVisibility.childLastName && (
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
                                      <InlineTextEditCell
                                        value={row.track.children[0]?.horseName ?? ""}
                                        label={row.horseName}
                                        editable={effectiveCanEditHorseFields && row.track.children.length <= 1}
                                        disabled={savingCellKey === `${row.track.id}-horseName`}
                                        placeholder="סוס"
                                        onCommit={(value) => handleInlineEditTrackChildField(row.track, "horseName", value)}
                                        onOpen={() => openTrackManager(row.track)}
                                        isActive={row.track.isActive}
                                      />
                                    )}
                                    {columnVisibility.equipment && (
                                      <InlineTextEditCell
                                        value={row.track.children[0]?.equipmentNotes ?? ""}
                                        label={row.equipmentNotes}
                                        editable={effectiveCanEditHorseFields && row.track.children.length <= 1}
                                        disabled={savingCellKey === `${row.track.id}-equipmentNotes`}
                                        placeholder="ציוד"
                                        onCommit={(value) =>
                                          handleInlineEditTrackChildField(row.track, "equipmentNotes", value)
                                        }
                                        onOpen={() => openTrackManager(row.track)}
                                        isActive={row.track.isActive}
                                      />
                                    )}
                                    {columnVisibility.parentName && (
                                      <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                        {row.parentName}
                                      </ClickableCell>
                                    )}
                                    {columnVisibility.parentPhone && (
                                      <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                        <ParentPhoneCell phone={row.parentPhone} isEditMode={isEditMode} />
                                      </ClickableCell>
                                    )}
                                    {columnVisibility.notes && (
                                      <InlineTextEditCell
                                        value={row.track.notes ?? ""}
                                        label={row.track.notes || "—"}
                                        editable={effectiveCanEdit}
                                        disabled={savingCellKey === `${row.track.id}-notes`}
                                        placeholder="הערות"
                                        truncateClassName="max-w-[220px] truncate"
                                        title={row.track.notes ?? undefined}
                                        onCommit={(value) => handleInlineEditTrackNotes(row.track, value)}
                                        onOpen={() => openTrackManager(row.track)}
                                        isActive={row.track.isActive}
                                      />
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
                  {effectiveCanEdit && role === "admin" && (
                    <div className="mt-3 border-t border-border pt-3">
                      <p className="text-sm font-medium text-card-foreground">החלפת מיקום ברוטציה</p>
                      {openTrack.practiceType === "BEGINNER_GROUP" && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          לא ניתן להחליף מושבים ישירות בשיעור קבוצתי - הצוות כאן נגזר אוטומטית מהמסלולים
                          הפרטניים המקושרים (חניך/ה מס&apos; 1 בכל מסלול פרטני). כדי להחליף מי משתתף/ת
                          בשיעור הקבוצתי, יש לבצע את ההחלפה במסלול הפרטני המתאים ולסנכרן.
                        </p>
                      )}
                      {openTrack.practiceType === "BEGINNER_PRIVATE" && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          בשיעור פרטני אין רוטציה בין התפקידים. המדריך/ה נשאר/ת מדריך/ה, ואם משובץ/ת
                          עוזר/ת מדריך - הוא/היא נשאר/ת עוזר/ת.
                        </p>
                      )}
                      {openTrack.practiceType === "LUNGE" && (
                        <>
                          <p className="mt-1 text-xs text-muted-foreground">
                            מחליף בין שני החניכים במבנה הקבוע (לא בשיעור ספציפי בתאריך מסוים) - זו החלפת
                            מיקום ברוטציה, לא החלפת תפקיד ישירה: התפקיד בפועל נגזר מסדר הרוטציה ומתעדכן
                            אוטומטית לשיעורים עתידיים בהתאם לכללי הסנכרון הקיימים. שיעורים שכבר עברו לא
                            ישתנו, ושיעורים שכבר נכתב עבורם משוב הדרכה משמעותי מוגנים מסנכרון.
                          </p>
                          <Button
                            variant="secondary"
                            className="mt-2 !px-3 !py-1.5 !text-sm"
                            disabled={isTrackActionPending || !canSwapTrackTraineeSeats}
                            onClick={handleSwapTrackTraineeSeats}
                          >
                            החלפת מיקום
                          </Button>
                          {(swapSeatsPersistedSlot0 === "" || swapSeatsPersistedSlot1 === "") && (
                            <p className="mt-1 text-xs text-warning">
                              יש לשבץ חניך/ה בשני המושבים לפני שניתן להחליף ביניהם.
                            </p>
                          )}
                          {swapSeatsPersistedSlot0 !== "" && swapSeatsPersistedSlot1 !== "" && hasUnsavedTeamDraft && (
                            <p className="mt-1 text-xs text-warning">
                              יש לשמור את שינויי הצוות למעלה (&quot;שמירת צוות&quot;) לפני ביצוע ההחלפה.
                            </p>
                          )}
                        </>
                      )}
                    </div>
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

          {blockDateTarget && (
            <Modal open title={`הגדרת תאריכים - ${blockDateTarget.label}`} onClose={closeBlockDateModal}>
              <div className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground">
                  התאריכים שייבחרו יצרו שיעורים חסרים בלבד עבור כל הסלוטים הפעילים בבלוק הזה - שיעורים
                  שכבר קיימים לתאריך זה לא יימחקו ולא ישתנו. ניתן להגדיר תאריכים גם לפני שיבוץ חניכים.
                </p>
                {blockDateError && <p className="text-sm text-danger">{blockDateError}</p>}
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-sm">
                    הוספת תאריך
                    <input
                      type="date"
                      value={blockDateDraft}
                      onChange={(e) => setBlockDateDraft(e.target.value)}
                      className="rounded-lg border border-border px-3 py-2 text-sm"
                    />
                  </label>
                  <Button variant="secondary" className="!px-3 !py-1.5 !text-sm" onClick={addBlockDate}>
                    הוספה לרשימה
                  </Button>
                </div>
                {blockDates.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {blockDates.map((date) => (
                      <li
                        key={date}
                        className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-card-foreground"
                      >
                        {formatHebrewDate(parseDateKey(date))}
                        <button
                          type="button"
                          onClick={() => removeBlockDate(date)}
                          className="text-muted-foreground hover:text-danger"
                          aria-label={`הסרת ${date}`}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <Button disabled={isBlockDatePending || blockDates.length === 0} onClick={handleSubmitBlockDates}>
                  הגדרת {blockDates.length > 1 ? `${blockDates.length} תאריכים` : "תאריך"}
                </Button>
                {blockDateSummary && (
                  <div className="rounded-lg bg-muted p-3 text-xs text-card-foreground">
                    <p>נוצרו {blockDateSummary.createdCount} שיעורים</p>
                    <p>דולגו {blockDateSummary.skippedExistingCount} שיעורים שכבר קיימים</p>
                    {blockDateSummary.warnings.length > 0 && (
                      <ul className="mt-1 list-inside list-disc text-warning">
                        {blockDateSummary.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </Modal>
          )}
        </div>
      )}

      {tab === "lessons" &&
        (() => {
          const dateLessons = lessonDateDetail ?? [];
          const lungeGroups = groupLessonsByGroupName(
            dateLessons.filter((l) => l.practiceType === "LUNGE")
          );
          const beginnerPrivateGroups = groupLessonsByGroupName(
            dateLessons.filter((l) => l.practiceType === "BEGINNER_PRIVATE")
          );
          const beginnerGroupGroups = groupLessonsByGroupName(
            dateLessons.filter((l) => l.practiceType === "BEGINNER_GROUP")
          );
          // Normal workflow is one course group and one beginner lesson type
          // per date - these only turn true for data that doesn't match
          // that shape, in which case nothing below is hidden, only flagged.
          const distinctGroupNames = Array.from(new Set(dateLessons.map((l) => l.groupName ?? null)));
          const hasMultipleGroups = distinctGroupNames.length > 1;
          const hasBothBeginnerTypes = beginnerPrivateGroups.length > 0 && beginnerGroupGroups.length > 0;
          const groupSummaryLabel =
            distinctGroupNames.length === 0
              ? null
              : distinctGroupNames.map((g) => (g ? `קבוצה ${g}` : "ללא קבוצה")).join(" + ");
          const beginnerTypeSummaryLabel = hasBothBeginnerTypes
            ? "שיעורים פרטניים + שיעורים קבוצתיים"
            : beginnerPrivateGroups.length > 0
              ? "שיעורים פרטניים"
              : beginnerGroupGroups.length > 0
                ? "שיעורים קבוצתיים"
                : null;
          const hasAnySection =
            lungeGroups.length > 0 || beginnerPrivateGroups.length > 0 || beginnerGroupGroups.length > 0;

          return (
            <div className="flex min-w-0 flex-col gap-4">
              {lessonActionError && <p className="text-sm text-danger">{lessonActionError}</p>}
              {/* Stage 1 - compact, always-visible reminder that inline
                  edits here are per-date, not fixed-structure: sync
                  behavior itself is unchanged by this stage, this is copy
                  only. Shown only when inline editing is actually possible
                  (effectiveCanEdit), so a view-only user never sees a hint
                  about an action they can't take. */}
              {effectiveCanEdit && (
                <p className="text-xs text-muted-foreground">
                  שינויים בתאריכים הם נקודתיים לשיעור הזה. סנכרון מהמבנה הקבוע עשוי לעדכן מחדש שיעורים
                  עתידיים ללא משוב משמעותי.
                </p>
              )}
              {/* Bulk publish/unpublish - admin-only, affects ALL future
                  generated lessons (every date, every group), not just the
                  currently-selected date - placed above the date tabs so
                  it's clearly a dated-lessons-wide action, not a fixed-
                  structure one. */}
              {role === "admin" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="!px-3 !py-1.5 !text-xs"
                    onClick={() => handleOpenBulkPublishModal(true)}
                  >
                    פרסם שיבוץ לחניכים
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="!px-3 !py-1.5 !text-xs"
                    onClick={() => handleOpenBulkPublishModal(false)}
                  >
                    בטל פרסום שיבוץ עתידי
                  </Button>
                </div>
              )}
              {lessons === null ? (
                <p className="text-sm text-muted-foreground">טוען...</p>
              ) : lessons.length === 0 ? (
                <p className="rounded-xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
                  טרם נוצרו שיעורי התנסות מתחילים.
                </p>
              ) : (
                <>
                  {/* Date tabs - one per date that actually has a generated
                      lesson, oldest to newest. */}
                  <div className="flex flex-wrap gap-1.5">
                    {availableLessonDates.map((date) => (
                      <button
                        key={date}
                        type="button"
                        onClick={() => setSelectedLessonDate(date)}
                        className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          selectedLessonDate === date
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-muted/70"
                        }`}
                      >
                        {formatHebrewWeekday(parseDateKey(date))} · {formatHebrewDate(parseDateKey(date))}
                      </button>
                    ))}
                  </div>

                  {selectedLessonDate === null ? (
                    <p className="rounded-xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
                      בחר/י תאריך.
                    </p>
                  ) : lessonDateDetailLoading ? (
                    <p className="text-sm text-muted-foreground">טוען...</p>
                  ) : (
                    <>
                      {lessonDateDetailError && (
                        <p className="text-sm text-danger">{lessonDateDetailError}</p>
                      )}

                      {/* Selected-date summary: date + detected course
                          group + detected beginner lesson type. */}
                      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-4">
                        <p className="text-base font-bold text-card-foreground">
                          {formatHebrewWeekday(parseDateKey(selectedLessonDate))} ·{" "}
                          {formatHebrewDate(parseDateKey(selectedLessonDate))}
                        </p>
                        {groupSummaryLabel && (
                          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                            {groupSummaryLabel}
                          </span>
                        )}
                        {beginnerTypeSummaryLabel && (
                          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                            {beginnerTypeSummaryLabel}
                          </span>
                        )}
                        {hasAnySection && (
                          <a
                            href={`/api/admin/teaching-practice/export?date=${selectedLessonDate}`}
                            className="mr-auto rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:opacity-80"
                          >
                            ייצוא לאקסל
                          </a>
                        )}
                      </div>

                      {(hasMultipleGroups || hasBothBeginnerTypes) && (
                        <p className="rounded-xl border border-warning bg-warning-muted p-3 text-xs text-warning">
                          תאריך זה חורג מהמבנה הרגיל (
                          {hasMultipleGroups && "יותר מקבוצה אחת"}
                          {hasMultipleGroups && hasBothBeginnerTypes && " וגם "}
                          {hasBothBeginnerTypes && "גם שיעורים פרטניים וגם קבוצתיים"}) - כל השיעורים עדיין
                          מוצגים למטה, שום דבר לא הוסתר.
                        </p>
                      )}

                      {!hasAnySection ? (
                        <p className="rounded-xl border border-dashed border-border bg-card p-3 text-center text-xs text-muted-foreground">
                          אין שיעורים בתאריך זה.
                        </p>
                      ) : (
                        <>
                          {lungeGroups.length > 0 && (
                            <div className="flex min-w-0 flex-col gap-3">
                              <h3 className="rounded-lg bg-secondary px-3 py-2 text-sm font-bold text-secondary-foreground">
                                לונג׳
                              </h3>
                              {lungeGroups.map(([groupName, groupLessons]) => (
                                <LessonGroupTable
                                  key={`lunge-${groupName ?? "none"}`}
                                  groupName={groupName}
                                  lessons={groupLessons}
                                  canEdit={effectiveCanEdit}
                                  canEditHorseFields={effectiveCanEditHorseFields}
                                  canEditFeedback={canEditFeedback}
                                  isPending={isLessonActionPending}
                                  savingCellKey={savingLessonCellKey}
                                  instructors={instructors}
                                  trainees={students}
                                  childRegistry={children ?? []}
                                  onTogglePublished={handleToggleLessonPublished}
                                  onSave={handleUpdateLesson}
                                  onOpenFeedback={setFeedbackModalParticipantId}
                                  onOpenSameParentPopup={handleOpenSameParentPopup}
                                  onInlineUpdateField={handleInlineUpdateLessonField}
                                  onInlineUpdateParticipant={handleInlineUpdateLessonParticipant}
                                  onInlineUpdateChild={handleInlineUpdateLessonChild}
                                  onInlineUpdateNotes={handleInlineUpdateLessonNotes}
                                />
                              ))}
                            </div>
                          )}

                          {beginnerPrivateGroups.length > 0 && (
                            <div className="flex min-w-0 flex-col gap-3">
                              <h3 className="rounded-lg bg-secondary px-3 py-2 text-sm font-bold text-secondary-foreground">
                                שיעורים פרטניים
                              </h3>
                              {beginnerPrivateGroups.map(([groupName, groupLessons]) => (
                                <LessonGroupTable
                                  key={`private-${groupName ?? "none"}`}
                                  groupName={groupName}
                                  lessons={groupLessons}
                                  canEdit={effectiveCanEdit}
                                  canEditHorseFields={effectiveCanEditHorseFields}
                                  canEditFeedback={canEditFeedback}
                                  isPending={isLessonActionPending}
                                  savingCellKey={savingLessonCellKey}
                                  instructors={instructors}
                                  trainees={students}
                                  childRegistry={children ?? []}
                                  onTogglePublished={handleToggleLessonPublished}
                                  onSave={handleUpdateLesson}
                                  onOpenFeedback={setFeedbackModalParticipantId}
                                  onOpenSameParentPopup={handleOpenSameParentPopup}
                                  onInlineUpdateField={handleInlineUpdateLessonField}
                                  onInlineUpdateParticipant={handleInlineUpdateLessonParticipant}
                                  onInlineUpdateChild={handleInlineUpdateLessonChild}
                                  onInlineUpdateNotes={handleInlineUpdateLessonNotes}
                                />
                              ))}
                            </div>
                          )}

                          {beginnerGroupGroups.length > 0 && (
                            <div className="flex min-w-0 flex-col gap-3">
                              <h3 className="rounded-lg bg-secondary px-3 py-2 text-sm font-bold text-secondary-foreground">
                                שיעורים קבוצתיים
                              </h3>
                              {beginnerGroupGroups.map(([groupName, groupLessons]) => (
                                <LessonGroupTable
                                  key={`group-${groupName ?? "none"}`}
                                  groupName={groupName}
                                  lessons={groupLessons}
                                  canEdit={effectiveCanEdit}
                                  canEditHorseFields={effectiveCanEditHorseFields}
                                  canEditFeedback={canEditFeedback}
                                  isPending={isLessonActionPending}
                                  savingCellKey={savingLessonCellKey}
                                  instructors={instructors}
                                  trainees={students}
                                  childRegistry={children ?? []}
                                  onTogglePublished={handleToggleLessonPublished}
                                  onSave={handleUpdateLesson}
                                  onOpenFeedback={setFeedbackModalParticipantId}
                                  onOpenSameParentPopup={handleOpenSameParentPopup}
                                  onInlineUpdateField={handleInlineUpdateLessonField}
                                  onInlineUpdateParticipant={handleInlineUpdateLessonParticipant}
                                  onInlineUpdateChild={handleInlineUpdateLessonChild}
                                  onInlineUpdateNotes={handleInlineUpdateLessonNotes}
                                />
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          );
        })()}

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

      {(() => {
        const activeFeedbackEntry =
          feedbackModalParticipantId !== null
            ? (feedbackEntries.find((e) => e.participantId === feedbackModalParticipantId) ?? null)
            : null;
        // Context locking: the switcher (and therefore previous/next) may
        // only offer other participants from the same practiceType this
        // modal was opened for - never lets switching silently hop from a
        // LUNGE trainee to a private/group one or vice versa.
        const switchableEntries = activeFeedbackEntry
          ? feedbackEntries.filter((e) => e.lesson.practiceType === activeFeedbackEntry.lesson.practiceType)
          : [];
        return (
          <Modal
            open={activeFeedbackEntry !== null}
            title="משוב התנסות מתחילים"
            onClose={() => feedbackModalRef.current?.requestClose()}
          >
            {activeFeedbackEntry && (
              <TeachingPracticeFeedbackModal
                key={activeFeedbackEntry.participantId}
                ref={feedbackModalRef}
                entry={activeFeedbackEntry}
                switchOptions={switchableEntries.map((e) => ({
                  value: e.participantId,
                  label: e.traineeName,
                }))}
                onSave={handleSaveTeachingPracticeFeedback}
                onClose={() => setFeedbackModalParticipantId(null)}
                onSwitchTo={setFeedbackModalParticipantId}
              />
            )}
          </Modal>
        );
      })()}

      {/* Stage 1 (preview) + Stage 2 (apply selected) trainee-assignment
          suggestions. Always mounted (like the feedback modal above) rather
          than nested inside the tracks-tab JSX, so its own open/close state
          is never tied to which tab happens to be active. Applying only ever
          goes through setTeachingPracticeTrackTraineesAsAdmin below - no
          direct Prisma call, no new write action. */}
      <Modal
        open={suggestionModalOpen}
        size="large"
        onClose={() => setSuggestionModalOpen(false)}
        title={`הצעת שיבוץ חניכים למבנה הקבוע - קבוצה ${suggestionGroupName ?? ""}`}
      >
        <div className="flex h-full min-h-0 flex-col gap-3">
          <p className="shrink-0 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            כל חור מוצג עם כל המועמדים האפשריים - המועמד/ת המומלץ/ת מסומן/ת מראש, וניתן לבחור מועמד/ת אחר/ת או
            &quot;דלג&quot; לכל חור בנפרד. שום שינוי לא נשמר עד לחיצה על &quot;החל שיבוצים שנבחרו&quot;. שיבוצים קיימים
            אינם ניתנים להחלפה בשלב זה.
          </p>

          {suggestionLoading && <p className="shrink-0 text-sm text-muted-foreground">טוען הצעות שיבוץ...</p>}
          {suggestionError && <p className="shrink-0 text-sm text-danger">{suggestionError}</p>}

          {suggestionResult && !suggestionLoading && (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto pl-1">
                <TeachingPracticeTraineeSuggestionsPreview
                  result={suggestionResult}
                  choices={suggestionChoices}
                  onChooseCandidate={setSuggestionChoice}
                  disabled={isApplyingSuggestions}
                />
              </div>

              {(() => {
                const selectableCount = allSelectableTraineeSuggestionKeys(suggestionResult).size;
                const selectedCount = Array.from(suggestionChoices.values()).filter((v) => v != null).length;
                return (
                  <div className="shrink-0 flex flex-col gap-2 border-t border-border pt-3">
                    {applySuggestionsError && <p className="text-sm text-danger">{applySuggestionsError}</p>}
                    {applySuggestionsSuccess && <p className="text-sm text-success">{applySuggestionsSuccess}</p>}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          className="!px-3 !py-1.5 !text-xs"
                          disabled={isApplyingSuggestions || selectableCount === 0}
                          onClick={handleSelectAllTraineeSuggestions}
                        >
                          בחר הכל
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="!px-3 !py-1.5 !text-xs"
                          disabled={isApplyingSuggestions || selectedCount === 0}
                          onClick={handleClearTraineeSuggestionSelection}
                        >
                          נקה בחירה
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          נבחרו {selectedCount} שיבוצים מתוך {selectableCount} הצעות אפשריות
                        </span>
                      </div>
                      <Button
                        type="button"
                        disabled={isApplyingSuggestions || selectedCount === 0}
                        onClick={handleApplySelectedTraineeSuggestions}
                      >
                        {isApplyingSuggestions ? "מחיל שיבוצים..." : "החל שיבוצים שנבחרו"}
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </Modal>

      {/* Stage B - read-only trainee schedule overview ("לו״ז חניכים").
          Always mounted (same convention as the suggestion Modal above), so
          its open/close state never depends on which tab is active. Purely
          a different view of largely the same underlying facts the
          suggestion modal already reasons about - no write path, no
          apply/select controls. */}
      <Modal
        open={scheduleModalOpen}
        size="large"
        onClose={() => setScheduleModalOpen(false)}
        title={`לו״ז חניכים - מבנה קבוע - קבוצה ${scheduleGroupName ?? ""}`}
      >
        <div className="flex h-full min-h-0 flex-col gap-3">
          <p className="shrink-0 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            תצוגה בלבד - מציגה את שיבוצי המבנה הקבוע (לא שיעורים שנוצרו לתאריכים) לפי שעת התחלה/סיום
            ברירת המחדל של כל מסלול, בלי התייחסות ליום בשבוע. שיעור קבוצתי מתחילים מסומן כנגזר -
            הצוות שלו נקבע במסלולים הפרטניים המקושרים, לא כאן.
          </p>

          {scheduleLoading && <p className="shrink-0 text-sm text-muted-foreground">טוען לו״ז חניכים...</p>}
          {scheduleError && <p className="shrink-0 text-sm text-danger">{scheduleError}</p>}

          {scheduleResult && !scheduleLoading && (
            <div className="min-h-0 flex-1 overflow-y-auto pl-1">
              <TeachingPracticeTraineeSchedulePreview result={scheduleResult} />
            </div>
          )}
        </div>
      </Modal>

      {/* Stage C2 - real fixed-structure -> generated-lessons sync
          confirmation + result. Always mounted (same convention as the
          suggestion Modal above), so its open/close state never depends on
          which tab is active. syncResult present => show the summary;
          otherwise show the confirmation prompt (or the loading state while
          the request is in flight). */}
      <Modal
        open={syncModalOpen}
        onClose={handleCloseSyncModal}
        title={`סנכרון מבנה קבוע לתאריכים - קבוצה ${syncGroupName ?? ""}`}
      >
        <div className="flex flex-col gap-3">
          {!syncResult && !syncLoading && (
            <>
              <ul className="flex flex-col gap-1.5 text-sm text-card-foreground">
                <li>הפעולה תעדכן את השיעורים שנוצרו לפי המבנה הקבוע הנוכחי.</li>
                <li>הפעולה עשויה לדרוס שינויים ידניים שנעשו בתאריכים ספציפיים.</li>
                <li>הפעולה תסנכרן חניכים, ילדים, סוסים/ציוד אם קיימים, שעות, מיקום ומדריך אחראי.</li>
                <li>הפעולה לא תמחק משוב.</li>
                <li>הפעולה לא תיצור ולא תמחק שיעורים.</li>
                <li>הפעולה לא תייצר תאריכים חדשים.</li>
                <li>הפעולה תרוץ רק על הקבוצה שנבחרה עכשיו.</li>
              </ul>
              {syncError && <p className="text-sm text-danger">{syncError}</p>}
              <div className="flex justify-end gap-2 border-t border-border pt-3">
                <Button type="button" variant="ghost" onClick={handleCloseSyncModal}>
                  ביטול
                </Button>
                <Button type="button" variant="danger" onClick={handleConfirmSync}>
                  אישור וסנכרון
                </Button>
              </div>
            </>
          )}

          {syncLoading && <p className="text-sm text-muted-foreground">מסנכרן...</p>}

          {syncResult && !syncLoading && (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-card-foreground sm:grid-cols-3">
                <span>מסלולים נבדקו: {syncResult.tracksChecked}</span>
                <span>ללא שיעורים שנוצרו: {syncResult.tracksSkippedNoLessons}</span>
                <span>מבנה קבוע לא שלם: {syncResult.tracksSkippedIncompleteFixedStructure}</span>
                <span>צוות קבוצתי נגזר: {syncResult.beginnerGroupRostersDerived}</span>
                <span>צוות קבוצתי לא נגזר: {syncResult.beginnerGroupRostersSkipped}</span>
                <span>שיעורים נבדקו: {syncResult.lessonsChecked}</span>
                <span>שיעורים סונכרנו: {syncResult.lessonsSynced}</span>
                <span>שיעורים ללא שינוי: {syncResult.lessonsUnchanged}</span>
                <span>דולגו - יש משוב: {syncResult.lessonsSkippedFeedback}</span>
                <span>דולגו - תאריך עבר: {syncResult.lessonsSkippedPastDate}</span>
                <span>
                  חניכים: {syncResult.participants.created} נוצרו, {syncResult.participants.deleted} נמחקו,{" "}
                  {syncResult.participants.unchanged} ללא שינוי
                </span>
                <span>
                  ילדים: {syncResult.childAssignments.created} נוצרו, {syncResult.childAssignments.deleted} נמחקו,{" "}
                  {syncResult.childAssignments.unchanged} ללא שינוי
                </span>
                <span>
                  שדות שיעור: {syncResult.lessonFields.updated} עודכנו, {syncResult.lessonFields.unchanged} ללא שינוי
                </span>
              </div>
              {syncResult.errors.length > 0 && (
                <div className="rounded-lg bg-danger/10 p-3 text-xs text-danger">
                  <p className="font-semibold">שגיאות ({syncResult.errors.length}):</p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {syncResult.errors.map((e, i) => (
                      <li key={i}>
                        {e.trackId}
                        {e.lessonId ? ` / ${e.lessonId}` : ""}: {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex justify-end border-t border-border pt-3">
                <Button type="button" onClick={handleCloseSyncModal}>
                  סגירה
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Bulk publish/unpublish confirm + result - always mounted (same
          convention as the sync modal above), admin-only (the buttons that
          open it are themselves admin-only). bulkPublishResult doubles as
          "have we already run this" - once set, the modal shows the
          summary instead of the confirmation prompt; reopening (a fresh
          handleOpenBulkPublishModal call) always resets it first. */}
      <Modal
        open={bulkPublishTarget !== null}
        onClose={handleCloseBulkPublishModal}
        title={bulkPublishTarget ? "פרסום שיבוץ עתידי לחניכים" : "ביטול פרסום שיבוץ עתידי"}
      >
        <div className="flex flex-col gap-3">
          {!bulkPublishResult && !bulkPublishLoading && (
            <>
              <ul className="flex flex-col gap-1.5 text-sm text-card-foreground">
                <li>
                  הפעולה תשפיע על כל השיעורים העתידיים (כולל היום) שכבר נוצרו במסגרת התנסויות מתחילים - בכל
                  הקבוצות ובכל התאריכים, לא רק התאריך הנבחר כרגע.
                </li>
                <li>שיעורים מהעבר לא ישתנו.</li>
                <li>
                  הפעולה משנה רק את מצב הפרסום (האם החניכים רואים את השיבוץ) - היא לא משנה חניכים, ילדים,
                  סוסים, ציוד, שעות, סוג התנסות או משוב.
                </li>
                <li>הפעולה לא יוצרת ולא מוחקת שיעורים.</li>
              </ul>
              {bulkPublishError && <p className="text-sm text-danger">{bulkPublishError}</p>}
              <div className="flex justify-end gap-2 border-t border-border pt-3">
                <Button type="button" variant="ghost" onClick={handleCloseBulkPublishModal}>
                  ביטול
                </Button>
                <Button type="button" variant="danger" onClick={handleConfirmBulkPublish}>
                  {bulkPublishTarget ? "אישור ופרסום" : "אישור וביטול פרסום"}
                </Button>
              </div>
            </>
          )}

          {bulkPublishLoading && <p className="text-sm text-muted-foreground">מעדכן...</p>}

          {bulkPublishResult && !bulkPublishLoading && (
            <>
              <div className="flex flex-col gap-1.5 text-sm text-card-foreground">
                <span>
                  {bulkPublishResult.isPublished ? "פורסמו" : "בוטל פרסום עבור"}: {bulkPublishResult.changedCount}
                </span>
                <span>
                  כבר היו {bulkPublishResult.isPublished ? "מפורסמים" : "לא מפורסמים"} קודם לכן:{" "}
                  {bulkPublishResult.alreadyCount}
                </span>
                <span>סה&quot;כ שיעורים עתידיים שנבדקו: {bulkPublishResult.totalFutureCount}</span>
              </div>
              <div className="flex justify-end border-t border-border pt-3">
                <Button type="button" onClick={handleCloseBulkPublishModal}>
                  סגירה
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* "אותו הורה" row-details popup - always mounted (same convention as
          the other modals above), opened by clicking the badge anywhere in
          this component (fixed-structure tables or generated-lessons
          tables). Always re-fetches on open via
          getTeachingPracticeSameParentRowsForAdmin/Instructor rather than
          reusing any client-cached lesson list - a same-parent match can
          span dates never loaded into lessonDateDetail, and admin/
          instructor are allowed to see unpublished lessons here too. */}
      <Modal
        open={sameParentPopupChildId !== null}
        onClose={handleCloseSameParentPopup}
        title="אותו הורה / איש קשר"
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            כדאי לתאם מי יוצר קשר כדי לא לפנות לאותו הורה כמה פעמים.
          </p>
          {sameParentPopupLoading && <p className="text-sm text-muted-foreground">טוען...</p>}
          {sameParentPopupError && <p className="text-sm text-danger">{sameParentPopupError}</p>}
          {sameParentPopupRows && !sameParentPopupLoading && (
            <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
              {sameParentPopupRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">לא נמצאו שיעורים משויכים.</p>
              ) : (
                sameParentPopupRows.map((row, i) => (
                  <div
                    key={`${row.lessonId}-${row.childId}-${i}`}
                    className="rounded-lg border border-border bg-card p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="font-semibold text-card-foreground">{row.childFullName}</span>
                      {!row.isPublished && (
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                          טיוטה
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {row.parentName ?? "—"}
                      {row.parentPhone ? ` · ${row.parentPhone}` : ""}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {formatHebrewDate(parseDateKey(row.date))} · {row.startTime} ·{" "}
                      {PRACTICE_TYPE_LABELS[row.practiceType]}
                    </p>
                    {row.participantNames.length > 0 && (
                      <p className="mt-1 text-muted-foreground">חניכים: {row.participantNames.join(", ")}</p>
                    )}
                    {(row.horseName || row.equipmentNotes) && (
                      <p className="mt-1 text-muted-foreground">
                        {row.horseName ? `סוס: ${row.horseName}` : ""}
                        {row.horseName && row.equipmentNotes ? " · " : ""}
                        {row.equipmentNotes ? `ציוד: ${row.equipmentNotes}` : ""}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
          <div className="flex justify-end border-t border-border pt-3">
            <Button type="button" onClick={handleCloseSameParentPopup}>
              סגירה
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// Stage D2 - read-only fixed-structure assignment check result panel.
// Cross-references trackId/traineeId/childId back to already-loaded state
// (tracks/childrenList) purely for friendlier labels - no extra fetch.
function TeachingPracticeFixedStructureCheckPanel({
  result,
  isStale,
  tracks,
  childrenList,
  onClear,
}: {
  result: TeachingPracticeFixedStructureCheckResult;
  isStale: boolean;
  tracks: TeachingPracticeTrackSummary[] | null;
  childrenList: TeachingPracticeChildRow[] | null;
  onClear: () => void;
}) {
  const trackLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tracks ?? []) {
      map.set(t.id, `${PRACTICE_TYPE_LABELS[t.practiceType]} ${t.defaultStartTime}-${t.defaultEndTime}`);
    }
    return map;
  }, [tracks]);

  const traineeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tracks ?? []) {
      for (const tt of t.trainees) map.set(tt.traineeId, tt.fullName);
    }
    return map;
  }, [tracks]);

  const childNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of childrenList ?? []) map.set(c.id, c.fullName);
    return map;
  }, [childrenList]);

  const hasAnyIssues = result.errors.length > 0 || result.warnings.length > 0 || result.info.length > 0;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-card-foreground">תוצאות בדיקת שיבוץ - קבוצה {result.groupName}</h3>
        <Button type="button" variant="ghost" className="!px-3 !py-1.5 !text-xs" onClick={onClear}>
          סגור תוצאות
        </Button>
      </div>

      {isStale && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          התוצאות הבאות הן מבדיקה קודמת עבור קבוצה {result.groupName} - הקבוצה הנבחרת השתנתה מאז. הריצו את הבדיקה
          שוב לקבלת תוצאות עדכניות.
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <FixedStructureCheckSummaryCard label="שגיאות" value={result.summary.errorCount} tone="danger" />
        <FixedStructureCheckSummaryCard label="אזהרות" value={result.summary.warningCount} tone="warning" />
        <FixedStructureCheckSummaryCard label="מידע" value={result.summary.infoCount} tone="muted" />
        <FixedStructureCheckSummaryCard label="מסלולים שנבדקו" value={result.summary.tracksChecked} />
        <FixedStructureCheckSummaryCard label="חניכים שנבדקו" value={result.summary.traineesChecked} />
        <FixedStructureCheckSummaryCard label="ילדים שנבדקו" value={result.summary.childrenChecked} />
      </div>

      {!hasAnyIssues && (
        <p className="text-sm text-muted-foreground">לא נמצאו בעיות במבנה הקבוע של קבוצה {result.groupName}.</p>
      )}

      {result.errors.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-danger">שגיאות שחייבים לתקן ({result.errors.length})</h4>
          <FixedStructureIssueList
            issues={result.errors}
            trackLabelById={trackLabelById}
            traineeNameById={traineeNameById}
            childNameById={childNameById}
          />
        </section>
      )}

      {result.warnings.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-warning">אזהרות לבדיקה ({result.warnings.length})</h4>
          <FixedStructureIssueList
            issues={result.warnings}
            trackLabelById={trackLabelById}
            traineeNameById={traineeNameById}
            childNameById={childNameById}
          />
        </section>
      )}

      {result.info.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-muted-foreground">מידע נוסף ({result.info.length})</h4>
          <FixedStructureIssueList
            issues={result.info}
            trackLabelById={trackLabelById}
            traineeNameById={traineeNameById}
            childNameById={childNameById}
          />
        </section>
      )}
    </div>
  );
}

function FixedStructureCheckSummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger" | "warning" | "muted";
}) {
  const toneClass =
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-card-foreground";
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2.5 text-center">
      <p className={`text-lg font-semibold ${toneClass}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

// Avoids flooding the page: shows the first 10 issues in this severity
// section by default, with a "הצג עוד" toggle to reveal the rest - a group
// with many overlap_informational warnings (or any other noisy kind) never
// dumps 30+ long rows on-screen by default.
function FixedStructureIssueList({
  issues,
  trackLabelById,
  traineeNameById,
  childNameById,
}: {
  issues: TeachingPracticeFixedStructureIssue[];
  trackLabelById: Map<string, string>;
  traineeNameById: Map<string, string>;
  childNameById: Map<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const VISIBLE_LIMIT = 10;
  const visibleIssues = expanded ? issues : issues.slice(0, VISIBLE_LIMIT);
  const remaining = issues.length - visibleIssues.length;

  return (
    <div className="flex flex-col gap-1.5">
      {visibleIssues.map((issue, i) => (
        <div key={i} className="rounded-lg border border-border bg-muted/20 p-2.5 text-sm">
          <p className="text-card-foreground">{issue.message}</p>
          {(issue.trackId ||
            issue.traineeId ||
            issue.childId ||
            (issue.relatedTrackIds && issue.relatedTrackIds.length > 0)) && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {issue.trackId && <span>מסלול: {trackLabelById.get(issue.trackId) ?? issue.trackId}</span>}
              {issue.traineeId && <span>חניך/ה: {traineeNameById.get(issue.traineeId) ?? issue.traineeId}</span>}
              {issue.childId && <span>ילד/ה: {childNameById.get(issue.childId) ?? issue.childId}</span>}
              {issue.relatedTrackIds && issue.relatedTrackIds.length > 0 && (
                <span>
                  מסלולים קשורים:{" "}
                  {issue.relatedTrackIds.map((id) => trackLabelById.get(id) ?? id).join(", ")}
                </span>
              )}
            </div>
          )}
        </div>
      ))}
      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="self-start text-xs text-primary underline decoration-dotted"
        >
          הצג עוד ({remaining})
        </button>
      )}
      {expanded && issues.length > VISIBLE_LIMIT && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="self-start text-xs text-muted-foreground underline decoration-dotted"
        >
          הצג פחות
        </button>
      )}
    </div>
  );
}

// Stage C1 - decision-support preview. Displays the already-fetched result,
// holes-first: every empty, applyable-or-not slot (see isHoleSlot) is shown
// as its own card with a full ranked-candidate radio group before anything
// else, so the מנהלת never has to scroll past filled/informational rows to
// find what actually needs a decision. Warnings and the per-חניך summary
// come next (still visible, just not first), and already-filled/BEGINNER_GROUP
// slots move into a collapsed-by-default section at the end - same
// underlying data as before Stage C1, just reordered. Actual choice state
// lives in the parent (choices/onChooseCandidate), so this stays a thin
// pass-through for the radio wiring rather than a second source of truth.
function TeachingPracticeTraineeSuggestionsPreview({
  result,
  choices,
  onChooseCandidate,
  disabled,
}: {
  result: ComputeTraineeSuggestionsResult;
  choices: Map<string, string | null>;
  onChooseCandidate: (trackId: string, rotationOrder: number, traineeId: string | null) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <TeachingPracticeSuggestionHolesSection
        result={result}
        choices={choices}
        onChooseCandidate={onChooseCandidate}
        disabled={disabled}
      />

      {result.warnings.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-bold text-card-foreground">התראות</h3>
          {result.warnings.map((warning, index) => (
            <TeachingPracticeSuggestionWarningRow key={index} warning={warning} />
          ))}
        </div>
      )}

      <TeachingPracticeSuggestionSummarySection summaries={result.traineeSummaries} />

      <TeachingPracticeSuggestionFilledInfoSection result={result} />
    </div>
  );
}

// Stage C1 - the primary, holes-first section: every slot where isHoleSlot
// is true (empty and not BEGINNER_GROUP), flattened across tracks into one
// list rather than grouped/buried inside per-track cards. Covers both
// applyable holes (rankedCandidates.length > 0 - full radio group) and
// required holes with literally no surviving candidate (rankedCandidates
// empty - shown with the engine's own `reason`/excludedCandidates instead of
// a radio group), so a real "nobody available" gap is still visible here
// rather than silently absent.
function TeachingPracticeSuggestionHolesSection({
  result,
  choices,
  onChooseCandidate,
  disabled,
}: {
  result: ComputeTraineeSuggestionsResult;
  choices: Map<string, string | null>;
  onChooseCandidate: (trackId: string, rotationOrder: number, traineeId: string | null) => void;
  disabled: boolean;
}) {
  const holes = result.tracks.flatMap((track) =>
    track.slots.filter((slot) => isHoleSlot(slot)).map((slot) => ({ track, slot }))
  );
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-bold text-card-foreground">
        חורים להשלמה{holes.length > 0 && <span className="font-normal text-muted-foreground"> ({holes.length})</span>}
      </h3>
      {holes.length === 0 && (
        <p className="text-sm text-muted-foreground">אין חורים פתוחים במבנה הקבוע של קבוצה זו כרגע.</p>
      )}
      {holes.map(({ track, slot }) => (
        <TeachingPracticeSuggestionHoleCard
          key={traineeSuggestionSlotKey(track.trackId, slot.rotationOrder)}
          track={track}
          slot={slot}
          choice={choices.get(traineeSuggestionSlotKey(track.trackId, slot.rotationOrder)) ?? null}
          onChoose={(traineeId) => onChooseCandidate(track.trackId, slot.rotationOrder, traineeId)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

// One hole = one (track, empty-non-BEGINNER_GROUP-slot) pair. Shows the
// track/time context, any already-assigned teammates on the same track (for
// orientation - e.g. seeing who the lead already is when filling the
// assistant seat), then either a full ranked-candidate radio group (plus an
// explicit skip option) or, when nobody survived hard exclusion at all, the
// engine's own reason/excluded-candidates text.
function TeachingPracticeSuggestionHoleCard({
  track,
  slot,
  choice,
  onChoose,
  disabled,
}: {
  track: ComputeTraineeSuggestionsResult["tracks"][number];
  slot: ComputeTraineeSuggestionsResult["tracks"][number]["slots"][number];
  choice: string | null;
  onChoose: (traineeId: string | null) => void;
  disabled: boolean;
}) {
  const weekdayLabel =
    track.weekday != null && track.weekday >= 0 && track.weekday <= 6 ? WEEKDAY_LABELS[track.weekday] : "לא ידוע";
  const teammates = track.slots.filter((s) => s.rotationOrder !== slot.rotationOrder && s.currentTraineeName);
  const radioGroupName = `suggestion-hole-${track.trackId}-${slot.rotationOrder}`;
  const hasCandidates = slot.rankedCandidates.length > 0;

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-card-foreground">{PRACTICE_TYPE_LABELS[track.practiceType]}</span>
        <span className="text-xs text-muted-foreground">
          מס&apos; {slot.rotationOrder + 1} · {ROLE_LABELS[slot.projectedRole]}
        </span>
        <span className="text-xs text-muted-foreground">
          יום {weekdayLabel} · {track.defaultStartTime}-{track.defaultEndTime}
        </span>
      </div>
      {teammates.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          כבר משובצים באותו מסלול: {teammates.map((t) => `${t.currentTraineeName} (מס' ${t.rotationOrder + 1})`).join("; ")}
        </p>
      )}
      {slot.bucketNote && <p className="mt-0.5 text-xs italic text-muted-foreground">{slot.bucketNote}</p>}

      {!hasCandidates ? (
        <div className="mt-2 rounded-lg bg-danger-muted px-2 py-1.5 text-xs text-danger">
          <p>{slot.reason}</p>
          {slot.excludedCandidates.length > 0 && (
            <p className="mt-0.5 text-muted-foreground">
              מועמדים שנפסלו: {slot.excludedCandidates.map((c) => `${c.traineeName} (${c.reason})`).join("; ")}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          {slot.rankedCandidates.map((candidate) => (
            <TeachingPracticeSuggestionCandidateOption
              key={candidate.traineeId}
              candidate={candidate}
              radioGroupName={radioGroupName}
              checked={choice === candidate.traineeId}
              disabled={disabled}
              onChoose={() => onChoose(candidate.traineeId)}
            />
          ))}
          <label
            className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            } ${choice === null ? "bg-primary/10 ring-1 ring-primary" : "bg-muted/50"}`}
          >
            <input
              type="radio"
              name={radioGroupName}
              checked={choice === null}
              disabled={disabled}
              onChange={() => onChoose(null)}
            />
            <span className="text-muted-foreground">דלג / לא לשבץ עכשיו</span>
          </label>
        </div>
      )}
    </div>
  );
}

function TeachingPracticeSuggestionCandidateOption({
  candidate,
  radioGroupName,
  checked,
  disabled,
  onChoose,
}: {
  candidate: TraineeSuggestionRankedCandidate;
  radioGroupName: string;
  checked: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  const gapLabel =
    candidate.gapMinutes == null
      ? "אין שיבוצים אחרים בכלל"
      : candidate.gapMinutes >= TRAINEE_SUGGESTION_GOOD_GAP_MINUTES
        ? `מרווח טוב (${candidate.gapMinutes} דק')`
        : `צמוד (${candidate.gapMinutes} דק')`;
  return (
    <label
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 text-xs ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      } ${checked ? "bg-primary/10 ring-1 ring-primary" : "bg-muted/50"}`}
    >
      <input type="radio" name={radioGroupName} checked={checked} disabled={disabled} onChange={onChoose} />
      <span className="font-medium text-card-foreground">{candidate.traineeName}</span>
      {candidate.isRecommended && (
        <span className="rounded-full bg-success-muted px-2 py-0.5 font-medium text-success">מומלץ</span>
      )}
      <span className="text-muted-foreground">בתפקיד זה עד כה: {candidate.categoryCount}</span>
      <span className="text-muted-foreground">סה&quot;כ שיבוצים קבועים: {candidate.totalAssignments}</span>
      <span className="text-muted-foreground">{gapLabel}</span>
    </label>
  );
}

// Stage C1 - collapsed-by-default section for everything that isn't a hole:
// already-filled slots and BEGINNER_GROUP slots (informational/derived,
// never selectable regardless of fill state - see isHoleSlot). Reuses the
// pre-Stage-C1 track-card/slot-row rendering unchanged (same content as
// before), just fed only the non-hole slots and always rendered read-only
// (selectedKeys/onToggleSlot are inert here - none of these slots are ever
// selectable, so their radio/checkbox branch never triggers).
function TeachingPracticeSuggestionFilledInfoSection({ result }: { result: ComputeTraineeSuggestionsResult }) {
  const [expanded, setExpanded] = useState(false);
  const tracksWithNonHoleSlots = result.tracks
    .map((track) => ({ ...track, slots: track.slots.filter((slot) => !isHoleSlot(slot)) }))
    .filter((track) => track.slots.length > 0);
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between text-right text-sm font-bold text-card-foreground"
      >
        שיבוצים קיימים ומידע נוסף
        <span className="text-muted-foreground">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="mt-2 flex flex-col gap-3">
          {tracksWithNonHoleSlots.length === 0 && (
            <p className="text-sm text-muted-foreground">אין שיבוצים קיימים או מידע נוסף להצגה.</p>
          )}
          {tracksWithNonHoleSlots.map((track) => (
            <TeachingPracticeSuggestionTrackCard
              key={track.trackId}
              track={track}
              selectedKeys={EMPTY_SUGGESTION_SELECTION}
              onToggleSlot={NOOP_SUGGESTION_TOGGLE}
              disabled
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Stable, shared no-op/empty references for TeachingPracticeSuggestionFilledInfoSection
// above - TeachingPracticeSuggestionTrackCard/TeachingPracticeSuggestionSlotRow
// are reused there read-only, but none of their slots are ever selectable
// (see isHoleSlot), so these are never actually read/called - only kept as
// stable identities so a fresh object/function isn't allocated every render.
const EMPTY_SUGGESTION_SELECTION: Set<string> = new Set();
function NOOP_SUGGESTION_TOGGLE(): void {}

function TeachingPracticeSuggestionWarningRow({ warning }: { warning: TraineeSuggestionWarning }) {
  const style = TRAINEE_SUGGESTION_WARNING_STYLE[warning.kind];
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5 text-xs">
      <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${style.className}`}>{style.label}</span>
      <span className="text-card-foreground">{warning.message}</span>
    </div>
  );
}

// Collapsible per-חניך bucket-count summary. Stage C1 - defaults to
// collapsed (was expanded pre-Stage-C1): the holes-first section above is
// now the primary content, so this secondary detail no longer needs to be
// open by default.
function TeachingPracticeSuggestionSummarySection({ summaries }: { summaries: ComputeTraineeSuggestionsResult["traineeSummaries"] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between text-right text-sm font-bold text-card-foreground"
      >
        סיכום יעדים לפי חניך/ה
        <span className="text-muted-foreground">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="mt-2 flex flex-col gap-2">
          {summaries.length === 0 && (
            <p className="text-sm text-muted-foreground">אין חניכים פעילים בקבוצה זו.</p>
          )}
          {summaries.map((summary) => (
            <div key={summary.traineeId} className="rounded-lg bg-muted/50 p-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-card-foreground">{summary.traineeName}</span>
                <span className="text-muted-foreground">
                  סה&quot;כ שיבוצים קבועים נוכחיים: {summary.totalCurrentFixedStructureAssignments}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <TeachingPracticeSuggestionBucketPill
                  label="לונג׳"
                  count={summary.counts.lungeAny}
                  gap={summary.targetGaps.lungeAny}
                />
                <TeachingPracticeSuggestionBucketPill
                  label="פרטני (מוביל/ה)"
                  count={summary.counts.privateLead}
                  gap={summary.targetGaps.privateLead}
                />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                {/* Stage A - no longer "מידע בלבד" (info only): privateAssistant
                    is now a ranked category (see categoryCount in the pure
                    engine) that actively affects suggestion ordering, just
                    never a required-hole target. */}
                <span>עוזר/ת בפרטני (מאוזן, לא חובה): {summary.informational.privateAssistant}</span>
                <span>מוביל/ה בקבוצתי (מידע בלבד): {summary.informational.beginnerGroupLead}</span>
                <span>מדריך שני (מידע בלבד): {summary.informational.beginnerGroupSecond}</span>
                <span>ממשב (מידע בלבד): {summary.informational.evaluator}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeachingPracticeSuggestionBucketPill({ label, count, gap }: { label: string; count: number; gap: number }) {
  const className = gap > 0 ? "bg-warning-muted text-warning" : "bg-success-muted text-success";
  return (
    <span className={`rounded-full px-2 py-0.5 font-medium ${className}`}>
      {label}: {count}/{TRAINEE_SUGGESTION_TARGET_PER_BUCKET}
    </span>
  );
}

// Stage B - trainee schedule overview ("לו״ז חניכים"). Purely a different,
// read-only rendering of ComputeTraineeScheduleResult - no selection/apply
// state at all, unlike the suggestion preview above. Reuses
// TeachingPracticeSuggestionWarningRow (same TraineeSuggestionWarning shape)
// for the one warning kind this view ever produces
// (missing_or_invalid_time_data).
function TeachingPracticeTraineeSchedulePreview({ result }: { result: ComputeTraineeScheduleResult }) {
  return (
    <div className="flex flex-col gap-4">
      {result.warnings.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-bold text-card-foreground">התראות</h3>
          {result.warnings.map((warning, index) => (
            <TeachingPracticeSuggestionWarningRow key={index} warning={warning} />
          ))}
        </div>
      )}
      {result.trainees.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין חניכים פעילים בקבוצה זו.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {result.trainees.map((row) => (
            <TeachingPracticeTraineeScheduleCard key={row.traineeId} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function TeachingPracticeTraineeScheduleCard({ row }: { row: TraineeScheduleRow }) {
  const gapSummary = row.hasOverlap
    ? { label: "יש חפיפה", className: "bg-danger-muted text-danger" }
    : row.minGapMinutes != null
      ? {
          label: `מרווח מינימלי: ${row.minGapMinutes} דק'`,
          className:
            row.minGapMinutes >= TRAINEE_SUGGESTION_GOOD_GAP_MINUTES
              ? "bg-success-muted text-success"
              : "bg-warning-muted text-warning",
        }
      : { label: "אין מספיק שיבוצים לחישוב מרווח", className: "bg-muted text-muted-foreground" };

  return (
    <div className="rounded-xl border border-border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-card-foreground">{row.traineeName}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
            סה&quot;כ: {row.totalAssignments}
          </span>
          <span className={`rounded-full px-2 py-0.5 font-medium ${gapSummary.className}`}>{gapSummary.label}</span>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5 text-muted-foreground">
        <span className="rounded-full bg-muted px-2 py-0.5">לונג&apos;: {row.countByCategory.lungeAny}</span>
        <span className="rounded-full bg-muted px-2 py-0.5">פרטני מוביל/ה: {row.countByCategory.privateLead}</span>
        <span className="rounded-full bg-muted px-2 py-0.5">עוזר/ת בפרטני: {row.countByCategory.privateAssistant}</span>
        <span className="rounded-full bg-muted px-2 py-0.5">קבוצתי (נגזר): {row.countByCategory.beginnerGroup}</span>
      </div>
      {row.assignments.length === 0 ? (
        <p className="mt-2 text-muted-foreground">אין שיבוצים במבנה הקבוע.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-1">
          {row.assignments.map((a) => (
            <TeachingPracticeTraineeScheduleAssignmentRow key={a.trackId} assignment={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function TeachingPracticeTraineeScheduleAssignmentRow({ assignment }: { assignment: TraineeScheduleAssignment }) {
  const isOverlap = assignment.overlapsWithTrackIds.length > 0;
  const isTight =
    !isOverlap &&
    assignment.nearestGapMinutes != null &&
    assignment.nearestGapMinutes < TRAINEE_SUGGESTION_GOOD_GAP_MINUTES;
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-muted/50 px-2 py-1">
      <span className="font-medium text-card-foreground">
        {assignment.defaultStartTime}-{assignment.defaultEndTime}
      </span>
      <span className="text-muted-foreground">{PRACTICE_TYPE_LABELS[assignment.practiceType]}</span>
      <span className="text-muted-foreground">{ROLE_LABELS[assignment.projectedRole]}</span>
      {assignment.isDerived && (
        <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">נגזר</span>
      )}
      {isOverlap && <span className="rounded-full bg-danger-muted px-2 py-0.5 font-medium text-danger">חפיפה</span>}
      {isTight && (
        <span className="rounded-full bg-warning-muted px-2 py-0.5 font-medium text-warning">
          צמוד ({assignment.nearestGapMinutes} דק&apos;)
        </span>
      )}
    </div>
  );
}

function TeachingPracticeSuggestionTrackCard({
  track,
  selectedKeys,
  onToggleSlot,
  disabled,
}: {
  track: ComputeTraineeSuggestionsResult["tracks"][number];
  selectedKeys: Set<string>;
  onToggleSlot: (trackId: string, rotationOrder: number, selectable: boolean) => void;
  disabled: boolean;
}) {
  const weekdayLabel = track.weekday != null && track.weekday >= 0 && track.weekday <= 6 ? WEEKDAY_LABELS[track.weekday] : "לא ידוע";
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <h4 className="text-sm font-semibold text-card-foreground">
        {PRACTICE_TYPE_LABELS[track.practiceType]} · יום {weekdayLabel} · {track.defaultStartTime}-
        {track.defaultEndTime}
      </h4>
      <div className="mt-2 flex flex-col gap-2">
        {track.slots.map((slot) => (
          <TeachingPracticeSuggestionSlotRow
            key={slot.rotationOrder}
            trackId={track.trackId}
            slot={slot}
            selected={selectedKeys.has(traineeSuggestionSlotKey(track.trackId, slot.rotationOrder))}
            onToggle={onToggleSlot}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}

function TeachingPracticeSuggestionSlotRow({
  trackId,
  slot,
  selected,
  onToggle,
  disabled,
}: {
  trackId: string;
  slot: ComputeTraineeSuggestionsResult["tracks"][number]["slots"][number];
  selected: boolean;
  onToggle: (trackId: string, rotationOrder: number, selectable: boolean) => void;
  disabled: boolean;
}) {
  // Single source of truth for "can this row ever have a checkbox" - a
  // filled slot never qualifies (replacing an existing assignment is out of
  // scope for this stage), and neither does a BEGINNER_GROUP slot (Stage B -
  // see isTraineeSuggestionSlotSelectable's own comment), matching the same
  // predicate used to build allSelectableTraineeSuggestionKeys/preselect on
  // load.
  const selectable = isTraineeSuggestionSlotSelectable(slot);
  const status = slot.currentTraineeId
    ? { label: "משובץ/ת כבר", className: "bg-muted text-muted-foreground" }
    : slot.suggestedTraineeId
      ? selectable
        ? { label: "הצעה זמינה", className: "bg-success-muted text-success" }
        : { label: "מידע בלבד - לא ניתן להחיל כאן", className: "bg-secondary text-secondary-foreground" }
      : { label: "אין הצעה מתאימה", className: "bg-danger-muted text-danger" };

  return (
    <div
      className={`rounded-lg p-2 text-xs ${
        selectable && selected ? "bg-primary/10 ring-1 ring-primary" : "bg-muted/50"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            disabled={disabled}
            onChange={() => onToggle(trackId, slot.rotationOrder, selectable)}
            aria-label={`בחירת הצעת שיבוץ עבור מס' ${slot.rotationOrder + 1}`}
          />
        )}
        <span className="font-medium text-card-foreground">מס&apos; {slot.rotationOrder + 1}</span>
        <span className="text-muted-foreground">תפקיד צפוי: {ROLE_LABELS[slot.projectedRole]}</span>
        <span className={`rounded-full px-2 py-0.5 font-medium ${status.className}`}>{status.label}</span>
        {selectable && selected && (
          <span className="rounded-full bg-primary px-2 py-0.5 font-medium text-primary-foreground">
            נבחר לשיבוץ
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        <span>
          <span className="text-muted-foreground">נוכחי: </span>
          {slot.currentTraineeName ?? "—"}
        </span>
        <span>
          <span className="text-muted-foreground">מוצע: </span>
          {slot.suggestedTraineeName ?? "—"}
        </span>
      </div>
      <p className="mt-1 text-muted-foreground">{slot.reason}</p>
      {slot.bucketNote && <p className="mt-0.5 italic text-muted-foreground">{slot.bucketNote}</p>}
      {slot.excludedCandidates.length > 0 && (
        <p className="mt-0.5 text-muted-foreground">
          מועמדים שנפסלו: {slot.excludedCandidates.map((c) => `${c.traineeName} (${c.reason})`).join("; ")}
        </p>
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
  highlightedTraineeId,
  onToggleHighlight,
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
  // Click-to-highlight (view mode only) - the currently-selected trainee id
  // (if any) and the toggle callback. Both optional so this component still
  // works wherever a caller doesn't wire highlighting in.
  highlightedTraineeId?: string | null;
  onToggleHighlight?: (traineeId: string, traineeName: string) => void;
}) {
  if (!editable) {
    // Only a real, assigned trainee (non-empty value) is clickable - "—"
    // (no one assigned) has nothing to highlight. stopPropagation keeps this
    // click from also firing the row's/ClickableCell's own onOpen - tapping
    // the name toggles highlight instead of opening the track drawer.
    const nameContent =
      value && onToggleHighlight ? (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onToggleHighlight(value, label);
          }}
          className={`cursor-pointer rounded px-1 -mx-1 py-0.5 transition-colors ${
            value === highlightedTraineeId
              ? "bg-primary/20 font-semibold text-primary"
              : "hover:bg-muted"
          }`}
        >
          {label}
        </span>
      ) : (
        label
      );

    if (onOpen) {
      return (
        <ClickableCell rowSpan={rowSpan} isActive={isActive} onOpen={onOpen} sticky={sticky}>
          {nameContent}
        </ClickableCell>
      );
    }
    return (
      <td
        rowSpan={rowSpan}
        className={`px-2 py-2 ${sticky ? "sticky right-0 z-10 bg-card" : ""}`}
      >
        {nameContent}
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

// Same shape/behavior as TraineeAssignmentCell, for this track's single
// child assignment instead of a trainee slot - selecting a child commits
// immediately (see handleInlineAssignTrackChild), same as a trainee pick.
// Callers only ever pass editable=true when the track has at most one
// TeachingPracticeTrackChild row (the normal case) - a track with more than
// one falls back to editable=false here, showing the existing joined
// "child1 / child2" text and leaving the drawer as the only editing path.
function ChildAssignmentCell({
  value,
  label,
  options,
  editable,
  disabled,
  onAssign,
  onOpen,
  isActive = true,
  sticky,
  parentKey,
  highlightedChildId,
  highlightedParentKey,
  onToggleHighlight,
  otherSameParentNames,
  onOpenSameParentPopup,
  rowSpan,
}: {
  value: string;
  label: string;
  options: SearchableSelectOption[];
  editable: boolean;
  disabled: boolean;
  onAssign: (childId: string) => void;
  onOpen?: () => void;
  isActive?: boolean;
  sticky?: boolean;
  // This cell's own resolved same-parent key (from parentKeyByChildId), so
  // it can tell whether IT belongs to the currently-selected parent group -
  // null when this child has no usable parent name+phone pair.
  parentKey?: string | null;
  highlightedChildId?: string | null;
  highlightedParentKey?: string | null;
  onToggleHighlight?: (childId: string) => void;
  // Always-visible "אותו הורה" badge (independent of the click-highlight
  // above) - names of every OTHER active child sharing this one's parent,
  // from sameParentOtherNamesByChildId. Absent/empty = no badge.
  otherSameParentNames?: string[];
  // Opens the row-details popup for this exact child (value) when the
  // badge is clicked - see handleOpenSameParentPopup.
  onOpenSameParentPopup?: (childId: string) => void;
  // Set only by callers rendering this as a shared (rowSpan'd) cell across
  // several table rows (e.g. the generated-lessons table's shared child
  // column) - undefined everywhere else, same no-op default as
  // TraineeAssignmentCell's own rowSpan prop.
  rowSpan?: number;
}) {
  if (!editable) {
    // Only a real, assigned child (non-empty value) is clickable - "—" (no
    // child assigned) has nothing to highlight. stopPropagation keeps this
    // click from also firing the row's/ClickableCell's own onOpen.
    const isSameChild = value !== "" && value === highlightedChildId;
    const isSameParent = !isSameChild && value !== "" && !!parentKey && parentKey === highlightedParentKey;
    const nameContent =
      value && onToggleHighlight ? (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onToggleHighlight(value);
          }}
          className={`cursor-pointer rounded px-1 -mx-1 py-0.5 transition-colors ${
            isSameChild
              ? "bg-primary/20 font-semibold text-primary"
              : isSameParent
                ? "bg-warning-muted text-warning"
                : "hover:bg-muted"
          }`}
        >
          {label}
        </span>
      ) : (
        label
      );
    const badge = value && otherSameParentNames?.length ? (
      <SameParentBadge
        otherNames={otherSameParentNames}
        onClick={onOpenSameParentPopup ? () => onOpenSameParentPopup(value) : undefined}
      />
    ) : null;

    if (onOpen) {
      return (
        <ClickableCell rowSpan={rowSpan} isActive={isActive} onOpen={onOpen} sticky={sticky}>
          {nameContent}
          {badge}
        </ClickableCell>
      );
    }
    return (
      <td rowSpan={rowSpan} className={`px-2 py-2 ${sticky ? "sticky right-0 z-10 bg-card" : ""}`}>
        {nameContent}
        {badge}
      </td>
    );
  }
  return (
    <td
      rowSpan={rowSpan}
      className={`max-w-[150px] px-2 py-2 ${sticky ? "sticky right-0 z-10 bg-card" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <SearchableSelect
        value={value}
        options={options}
        onChange={onAssign}
        disabled={disabled}
        placeholder="בחרו ילד/ה"
        className="!px-2 !py-1 text-xs"
      />
    </td>
  );
}

// A free-text table cell (horse / equipment / notes) that only commits on
// blur or Enter, never per keystroke - a local `draft` buffer is the single
// source of truth while focused, reset from `value` whenever the committed
// value changes underneath it (e.g. after a save elsewhere triggers
// refreshTracks). Escape restores `draft` to `value` and blurs without
// committing (skipCommitRef guards the blur that Escape itself triggers, so
// the reverted draft - not the stale pre-Escape text - is what would apply
// if this ever fired a commit).
function InlineTextEditCell({
  value,
  label,
  editable,
  disabled,
  placeholder,
  onCommit,
  onOpen,
  isActive = true,
  sticky,
  truncateClassName,
  title,
  rowSpan,
}: {
  value: string;
  label: string;
  editable: boolean;
  disabled: boolean;
  placeholder?: string;
  onCommit: (value: string) => void;
  onOpen?: () => void;
  isActive?: boolean;
  sticky?: boolean;
  // e.g. "max-w-[220px] truncate" for the notes column - left unset for
  // horse/equipment, which never truncated in the read-only view either.
  truncateClassName?: string;
  title?: string;
  // Set only by callers rendering a lesson-level (not per-row) field shared
  // across several table rows (e.g. the generated-lessons table's shared
  // horse/equipment cell) - undefined everywhere else, same no-op default as
  // TraineeAssignmentCell's own rowSpan prop.
  rowSpan?: number;
}) {
  const [draft, setDraft] = useState(value);
  const skipCommitRef = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(value);
  }, [value]);

  if (!editable) {
    const content = truncateClassName ? (
      <span className={`block ${truncateClassName}`} title={title}>
        {label}
      </span>
    ) : (
      label
    );
    if (onOpen) {
      return (
        <ClickableCell rowSpan={rowSpan} isActive={isActive} onOpen={onOpen} sticky={sticky}>
          {content}
        </ClickableCell>
      );
    }
    return (
      <td rowSpan={rowSpan} className={`px-2 py-2 ${sticky ? "sticky right-0 z-10 bg-card" : ""}`}>
        {content}
      </td>
    );
  }

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === value.trim()) return;
    onCommit(trimmed);
  }

  return (
    <td
      rowSpan={rowSpan}
      className={`px-2 py-2 ${sticky ? "sticky right-0 z-10 bg-card" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (skipCommitRef.current) {
            skipCommitRef.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            skipCommitRef.current = true;
            setDraft(value);
            e.currentTarget.blur();
          }
        }}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full min-w-[70px] rounded-lg border border-border px-2 py-1 text-xs disabled:opacity-50"
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

// One editable row per expected role slot - a plain (traineeId, role) pair
// rather than keyed by role, since the whole point of this form is letting
// the admin change which trainee holds which role for this one date.
interface LessonParticipantFormRow {
  traineeId: string;
  role: TeachingPracticeRoleValue;
}

// One editable row per expected child slot (see EXPECTED_CHILD_SLOTS_BY_PRACTICE_TYPE).
// No isAbsent field here by design (see report) - marking a child absent for
// this date stays a separate concern, not part of this edit form.
interface LessonChildAssignmentFormRow {
  childId: string;
  horseName: string;
  equipmentNotes: string;
}

interface LessonEditFormState {
  date: string;
  startTime: string;
  responsibleInstructorId: string;
  location: string;
  notes: string;
  // Keyed by this lesson's roleSlots only - pre-filled with the currently
  // displayed label (override if set, else the ROLE_LABELS default) so the
  // input always shows what the table shows right now.
  roleLabels: Partial<Record<TeachingPracticeRoleValue, string>>;
  participants: LessonParticipantFormRow[];
  childAssignments: LessonChildAssignmentFormRow[];
}

function lessonToEditForm(
  lesson: TeachingPracticeLessonDetail,
  roleSlots: TeachingPracticeRoleValue[]
): LessonEditFormState {
  const roleLabels: Partial<Record<TeachingPracticeRoleValue, string>> = {};
  for (const role of roleSlots) {
    roleLabels[role] = lesson.roleLabelOverrides?.[role] ?? ROLE_LABELS[role];
  }

  // Sort existing participants into roleSlots order (lead before
  // second/assistant before evaluator) so row 0 is always the lead, matching
  // the read-only table's own ordering - then index-pair onto one row per
  // expected slot so a lesson with fewer participants than expected still
  // shows the remaining slots as empty, editable rows instead of hiding them.
  const roleIndex = new Map(roleSlots.map((role, i) => [role, i]));
  const sortedParticipants = [...lesson.participants].sort(
    (a, b) => (roleIndex.get(a.role) ?? roleSlots.length) - (roleIndex.get(b.role) ?? roleSlots.length)
  );
  const participants: LessonParticipantFormRow[] = roleSlots.map((role, i) => ({
    traineeId: sortedParticipants[i]?.traineeId ?? "",
    role: sortedParticipants[i]?.role ?? role,
  }));

  const expectedChildSlots = EXPECTED_CHILD_SLOTS_BY_PRACTICE_TYPE[lesson.practiceType];
  const childAssignments: LessonChildAssignmentFormRow[] = Array.from({ length: expectedChildSlots }, (_, i) => ({
    childId: lesson.childAssignments[i]?.childId ?? "",
    horseName: lesson.childAssignments[i]?.horseName ?? "",
    equipmentNotes: lesson.childAssignments[i]?.equipmentNotes ?? "",
  }));

  return {
    date: lesson.date,
    startTime: lesson.startTime,
    responsibleInstructorId: lesson.responsibleInstructorId ?? "",
    location: lesson.location ?? "",
    notes: lesson.notes ?? "",
    roleLabels,
    participants,
    childAssignments,
  };
}

// Groups an already-filtered (single practiceType) lesson list by groupName,
// sorted so א/ב come before "ללא קבוצה" - used for the LUNGE and beginner
// sections in the scheduled-lessons table (Stage A). Normally yields exactly
// one entry (one course group is on any given date), but never collapses or
// hides a second one if the data has it - see the fallback banner in the
// "lessons" tab render.
function groupLessonsByGroupName(
  lessons: TeachingPracticeLessonDetail[]
): [string | null, TeachingPracticeLessonDetail[]][] {
  const map = new Map<string | null, TeachingPracticeLessonDetail[]>();
  for (const lesson of lessons) {
    const key = lesson.groupName ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(lesson);
  }
  return Array.from(map.entries()).sort((a, b) => (a[0] ?? "￿").localeCompare(b[0] ?? "￿"));
}

// One group's worth of same-practiceType lessons on the selected date,
// rendered as a compact table (time / role columns / per-child operational
// details / status / actions) - the scheduled-lessons equivalent of the
// fixed-schedule LUNGE/Beginners tables, but one row-group per
// already-generated lesson instead of one row per recurring track. A
// BEGINNER_GROUP lesson's 3 children each get their own sub-row under the
// same shared time/role/status/actions cells (see LessonTableRow) rather
// than being collapsed into one row, since the point of this table is
// "who is teaching whom" - location/responsible-instructor aren't shown
// here, they stay in the edit form below each lesson.
function LessonGroupTable({
  groupName,
  lessons,
  canEdit,
  canEditHorseFields,
  canEditFeedback,
  isPending,
  savingCellKey,
  instructors,
  trainees,
  childRegistry,
  onTogglePublished,
  onSave,
  onOpenFeedback,
  onOpenSameParentPopup,
  onInlineUpdateField,
  onInlineUpdateParticipant,
  onInlineUpdateChild,
  onInlineUpdateNotes,
}: {
  groupName: string | null;
  lessons: TeachingPracticeLessonDetail[];
  canEdit: boolean;
  // Stage 1 inline editing - gates horseName/equipmentNotes cells only,
  // same split as the fixed-structure tables' effectiveCanEditHorseFields
  // (an instructor can have assignment permission without horse permission).
  canEditHorseFields: boolean;
  canEditFeedback: boolean;
  isPending: boolean;
  // Which single inline cell (if any) is currently saving - see
  // savingLessonCellKey in TeachingPracticeManager.
  savingCellKey: string | null;
  instructors: InstructorOption[];
  trainees: StudentOption[];
  childRegistry: TeachingPracticeChildRow[];
  onTogglePublished: (lesson: TeachingPracticeLessonDetail) => void;
  onSave: (
    lessonId: string,
    input: TeachingPracticeLessonInput,
    participantRows: TeachingPracticeParticipantInput[],
    childAssignmentRows: TeachingPracticeChildAssignmentInput[]
  ) => Promise<ActionResult>;
  onOpenFeedback: (participantId: string) => void;
  onOpenSameParentPopup: (childId: string) => void;
  onInlineUpdateField: (lesson: TeachingPracticeLessonSummary, startTime: string) => void;
  onInlineUpdateParticipant: (
    lesson: TeachingPracticeLessonDetail,
    roleSlots: TeachingPracticeRoleValue[],
    changedIndex: number,
    patch: Partial<LessonParticipantFormRow>
  ) => void;
  onInlineUpdateChild: (
    lesson: TeachingPracticeLessonDetail,
    changedIndex: number,
    patch: { childId?: string; horseName?: string; equipmentNotes?: string }
  ) => void;
  onInlineUpdateNotes: (lesson: TeachingPracticeLessonSummary, notes: string) => void;
}) {
  if (lessons.length === 0) return null;
  const roleSlots = ROLE_SLOTS_BY_PRACTICE_TYPE[lessons[0].practiceType];
  const sorted = [...lessons].sort((a, b) => a.startTime.localeCompare(b.startTime));
  // Visual-aid-only time-block coloring, keyed by each lesson's own actual
  // startTime on this generated date (never the fixed-structure track's
  // defaultStartTime) - same rotating palette/helper as the fixed-structure
  // tables (see timeBlockColorClasses), so lessons at the same actual time
  // share a color and adjacent different times are clearly distinguishable.
  const lessonColors = timeBlockColorClasses(sorted.map((lesson) => lesson.startTime));
  // Always-visible "אותו הורה" badge - same active-only, registry-wide
  // detection as the fixed-structure tables (see sameParentOtherNamesByChildId
  // in the top-level component), computed here from the same childRegistry
  // prop already passed down for the edit form's child dropdown, so no new
  // fetch/prop plumbing is needed just for this.
  const sameParentOtherNamesByChildId = buildSameParentOtherNamesByChildId(
    childRegistry
      .filter((c) => c.isActive)
      .map((c) => ({ id: c.id, displayName: c.fullName, parentName: c.parentName, parentPhone: c.parentPhone }))
  );
  return (
    <div>
      <h4 className="mb-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground">
        {groupName ? `קבוצה ${groupName}` : "ללא קבוצה"}
      </h4>
      {/* Bounded self-contained scroll box (same max-h-[70vh] overflow-auto
          pattern as ScheduleGrid.tsx and the fixed-structure tables above) -
          own scroll box per group/date table, not shared across sections, so
          each date's/group's table stays independently scrollable. The
          expanded row editor renders as a normal in-flow <tr> further down
          this same table, so it still scrolls into view within this box -
          nothing about it changes. */}
      <div className="-mx-1 min-w-0 max-h-[70vh] overflow-auto px-1 pb-1">
        <table className="w-full min-w-[980px] border-collapse text-xs">
          <thead>
            <tr className="bg-muted text-muted-foreground">
              <th className="sticky top-0 right-0 z-20 bg-muted px-2 py-2 text-right font-bold">שעה</th>
              <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">חניך</th>
              <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">תפקיד</th>
              <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">שם הילד</th>
              <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">גיל</th>
              <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">מין</th>
              <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">סוס</th>
              <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">ציוד</th>
              <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">שם ההורה</th>
              <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">טלפון הורה</th>
              <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">הערות</th>
              <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">סטטוס</th>
              <th className="sticky top-0 z-10 bg-muted px-2 py-2 text-right font-bold">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((lesson, lessonIndex) => (
              <LessonTableRow
                key={lesson.id}
                lesson={lesson}
                roleSlots={roleSlots}
                canEdit={canEdit}
                canEditHorseFields={canEditHorseFields}
                canEditFeedback={canEditFeedback}
                isPending={isPending}
                savingCellKey={savingCellKey}
                instructors={instructors}
                trainees={trainees}
                childRegistry={childRegistry}
                rowColorClass={lessonColors[lessonIndex]}
                sameParentOtherNamesByChildId={sameParentOtherNamesByChildId}
                onOpenSameParentPopup={onOpenSameParentPopup}
                onTogglePublished={() => onTogglePublished(lesson)}
                onSave={(input, participantRows, childAssignmentRows) =>
                  onSave(lesson.id, input, participantRows, childAssignmentRows)
                }
                onOpenFeedback={onOpenFeedback}
                onInlineUpdateField={onInlineUpdateField}
                onInlineUpdateParticipant={onInlineUpdateParticipant}
                onInlineUpdateChild={onInlineUpdateChild}
                onInlineUpdateNotes={onInlineUpdateNotes}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// A single generated lesson's row-group, plus (when editing) a colSpan'd
// edit row beneath it reusing the same date/startTime/instructor/location/
// notes fields the old card view had - participants/children are already
// loaded for the whole selected date (see refreshLessonDateDetail), so
// unlike the old card this never needs its own lazy detail fetch/toggle.
//
interface LessonParticipantChildPairing {
  participant: TeachingPracticeParticipantRow | null;
  child: TeachingPracticeChildAssignmentRow | null;
}

// Trainee/role and child are shown as row-based pairs (חניך + תפקיד columns,
// not one column per role slot) - built by index-pairing
// participants[i]/childAssignments[i] after sorting participants into
// roleSlots order, for rowCount = max(participants.length,
// childAssignments.length, 1). A BEGINNER_GROUP lesson's 3
// trainees/roles/children line up 1:1 into 3 rows; LUNGE/BEGINNER_PRIVATE's
// 2 trainees against a single child produce 2 rows so neither trainee is
// ever hidden, with the second row's child columns as "—".
//
// Extracted as its own function (rather than left inline in LessonTableRow)
// so the feedback modal's read-only context (see
// TeachingPracticeFeedbackModal) resolves "which child did this participant
// work with" using this exact same pairing, never a second copy of the
// algorithm - the table and the modal can then never show contradictory
// child/horse attribution for the same participant. Unlike the table's own
// display (which renders the shared child once via rowSpan and never reads
// a per-row `child` for that case), this always resolves `child` to the
// single shared child when sharedChildColumn applies, since the modal has
// no rowSpan to lean on and needs a concrete value per participant.
function pairLessonParticipantsWithChildren(
  lesson: TeachingPracticeLessonDetail,
  roleSlots: TeachingPracticeRoleValue[]
): LessonParticipantChildPairing[] {
  const roleIndex = new Map(roleSlots.map((role, i) => [role, i]));
  const sortedParticipants = [...lesson.participants].sort(
    (a, b) => (roleIndex.get(a.role) ?? roleSlots.length) - (roleIndex.get(b.role) ?? roleSlots.length)
  );
  const expectedRows = TEACHING_PRACTICE_TEAM_SIZE[lesson.practiceType];
  const sharedChildColumn = lesson.practiceType !== "BEGINNER_GROUP" && lesson.childAssignments.length <= 1;
  const rowCount = sharedChildColumn
    ? Math.max(sortedParticipants.length, expectedRows)
    : Math.max(sortedParticipants.length, lesson.childAssignments.length, expectedRows);
  const soleChild = lesson.childAssignments[0] ?? null;
  return Array.from({ length: rowCount }, (_, i) => ({
    participant: sortedParticipants[i] ?? null,
    child: sharedChildColumn ? soleChild : (lesson.childAssignments[i] ?? null),
  }));
}

// Stage 1 (generated-lessons inline editing) - the "שעה" cell's inline
// editor: same draft/commit-on-blur/Escape-revert idiom as InlineTextEditCell
// above, but for the lesson's own startTime specifically. endTime is always
// server-derived (see updateTeachingPracticeLessonInternal) and is only ever
// displayed here, never sent - this component has no way to edit it at all.
// Read-only mode renders the exact "HH:MM-HH:MM" text the table already
// showed before this stage, so the displayed format is unchanged once a
// commit round-trips through a refresh.
function LessonTimeEditCell({
  startTime,
  endTime,
  editable,
  disabled,
  onCommit,
  rowSpan,
}: {
  startTime: string;
  endTime: string;
  editable: boolean;
  disabled: boolean;
  onCommit: (startTime: string) => void;
  rowSpan?: number;
}) {
  const [draft, setDraft] = useState(startTime);
  const skipCommitRef = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(startTime);
  }, [startTime]);

  if (!editable) {
    return (
      <td
        rowSpan={rowSpan}
        className="sticky right-0 z-10 bg-card px-2 py-2 align-top font-medium text-card-foreground"
      >
        {startTime}-{endTime}
      </td>
    );
  }

  function commit() {
    if (!draft || draft === startTime) return;
    onCommit(draft);
  }

  return (
    <td
      rowSpan={rowSpan}
      className="sticky right-0 z-10 bg-card px-2 py-2 align-top"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col gap-1">
        <input
          type="time"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (skipCommitRef.current) {
              skipCommitRef.current = false;
              return;
            }
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              skipCommitRef.current = true;
              setDraft(startTime);
              e.currentTarget.blur();
            }
          }}
          disabled={disabled}
          className="w-full min-w-[90px] rounded-lg border border-border px-2 py-1 text-xs disabled:opacity-50"
        />
        <span className="text-[10px] text-muted-foreground">עד {endTime}</span>
      </div>
    </td>
  );
}

// The shared cells (time, status, actions) get rowSpan across every row in
// the group and are only rendered once, on the first one.
function LessonTableRow({
  lesson,
  roleSlots,
  canEdit,
  canEditHorseFields,
  canEditFeedback,
  isPending,
  savingCellKey,
  instructors,
  trainees,
  childRegistry,
  rowColorClass,
  sameParentOtherNamesByChildId,
  onOpenSameParentPopup,
  onTogglePublished,
  onSave,
  onOpenFeedback,
  onInlineUpdateField,
  onInlineUpdateParticipant,
  onInlineUpdateChild,
  onInlineUpdateNotes,
}: {
  lesson: TeachingPracticeLessonDetail;
  roleSlots: TeachingPracticeRoleValue[];
  canEdit: boolean;
  // Stage 1 inline editing - gates horseName/equipmentNotes cells only (see
  // LessonGroupTable's own comment).
  canEditHorseFields: boolean;
  // Separate from canEdit - gates only the trainee-name click target that
  // opens the feedback modal, never the existing עריכה/פרסום actions or
  // participant/child/horse editing (see TeachingPracticeManager's
  // canEditFeedback comment for why this must stay its own permission).
  canEditFeedback: boolean;
  isPending: boolean;
  savingCellKey: string | null;
  instructors: InstructorOption[];
  trainees: StudentOption[];
  childRegistry: TeachingPracticeChildRow[];
  // Visual-aid-only time-block background (see LessonGroupTable) - applied
  // to this lesson's own display rows only while its inline edit form isn't
  // open (isEditing below), so the edit inputs are never shown against a
  // colored background.
  rowColorClass: string;
  // Always-visible "אותו הורה" badge lookup (see LessonGroupTable) -
  // childId -> other active children's names sharing its parent, registry-wide.
  sameParentOtherNamesByChildId: Map<string, string[]>;
  onOpenSameParentPopup: (childId: string) => void;
  onTogglePublished: () => void;
  onSave: (
    input: TeachingPracticeLessonInput,
    participantRows: TeachingPracticeParticipantInput[],
    childAssignmentRows: TeachingPracticeChildAssignmentInput[]
  ) => Promise<ActionResult>;
  onOpenFeedback: (participantId: string) => void;
  onInlineUpdateField: (lesson: TeachingPracticeLessonSummary, startTime: string) => void;
  onInlineUpdateParticipant: (
    lesson: TeachingPracticeLessonDetail,
    roleSlots: TeachingPracticeRoleValue[],
    changedIndex: number,
    patch: Partial<LessonParticipantFormRow>
  ) => void;
  onInlineUpdateChild: (
    lesson: TeachingPracticeLessonDetail,
    changedIndex: number,
    patch: { childId?: string; horseName?: string; equipmentNotes?: string }
  ) => void;
  onInlineUpdateNotes: (lesson: TeachingPracticeLessonSummary, notes: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<LessonEditFormState>(() => lessonToEditForm(lesson, roleSlots));
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, startSaveEditTransition] = useTransition();

  function startEdit() {
    setEditForm(lessonToEditForm(lesson, roleSlots));
    setEditError(null);
    setIsEditing(true);
  }

  function handleSaveEdit() {
    setEditError(null);
    // Only roles whose input still differs from the default ROLE_LABELS text
    // are sent as an override - typing the default back in (or clearing the
    // field) resets that role, exactly like the dedicated reset button does.
    const roleLabelOverrides: Partial<Record<TeachingPracticeRoleValue, string>> = {};
    for (const role of roleSlots) {
      const value = (editForm.roleLabels[role] ?? "").trim();
      if (value && value !== ROLE_LABELS[role]) roleLabelOverrides[role] = value;
    }
    // Empty slots are simply omitted rather than submitted as invalid rows -
    // both target actions are replace-all for this lessonId, so the full
    // remaining set is what ends up stored (an intentionally cleared slot
    // really does drop that participant/child assignment for this date).
    const participantRows: TeachingPracticeParticipantInput[] = editForm.participants
      .filter((p) => p.traineeId !== "")
      .map((p) => ({ traineeId: p.traineeId, role: p.role }));
    const childAssignmentRows: TeachingPracticeChildAssignmentInput[] = editForm.childAssignments
      .filter((c) => c.childId !== "")
      .map((c) => ({
        childId: c.childId,
        horseName: c.horseName.trim() || null,
        equipmentNotes: c.equipmentNotes.trim() || null,
      }));
    startSaveEditTransition(async () => {
      const result = await onSave(
        {
          date: editForm.date,
          startTime: editForm.startTime,
          responsibleInstructorId: editForm.responsibleInstructorId || null,
          location: editForm.location.trim() || null,
          notes: editForm.notes.trim() || null,
          roleLabelOverrides,
        },
        participantRows,
        childAssignmentRows
      );
      if (!result.success) {
        setEditError(result.error ?? "אירעה שגיאה");
        return;
      }
      setIsEditing(false);
    });
  }

  // Same group-filtered-with-visible-outlier pattern as the track-level
  // teamOptionsForSlot - trainees outside this lesson's own group still show
  // up if already selected, so an existing cross-group assignment is never
  // silently hidden by the filter.
  function traineeOptionsFor(selectedId: string): StudentOption[] {
    const groupName = lesson.groupName ?? "";
    const filtered = groupName ? trainees.filter((s) => s.groupName === groupName) : trainees;
    if (selectedId && !filtered.some((s) => s.id === selectedId)) {
      const selected = trainees.find((s) => s.id === selectedId);
      if (selected) return [selected, ...filtered];
    }
    return filtered;
  }

  // Stage 1 (inline "חניך" cell) - same options as traineeOptionsFor above,
  // reshaped for TraineeAssignmentCell's SearchableSelect. Duplicate-trainee
  // rejection stays entirely server-side (setTeachingPracticeLessonParticipantsInternal's
  // existing check) - same as the expanded form's own plain <select>, which
  // has never filtered other rows' picks out of its own options either.
  function traineeSelectOptionsFor(selectedId: string): SearchableSelectOption[] {
    return traineeOptionsFor(selectedId).map((s) => ({
      value: s.id,
      label: `${s.fullName}${s.groupName ? ` (קבוצה ${s.groupName})` : ""}`,
    }));
  }

  // Stage 1 (inline child cell) - same registry/shape the expanded form's
  // own child <select> already reads (childRegistry, unfiltered by
  // isActive - matching that existing convention exactly), reshaped for
  // ChildAssignmentCell's SearchableSelect.
  function childOptionsFor(selectedId: string): SearchableSelectOption[] {
    const clearOption: SearchableSelectOption = { value: "", label: "ללא ילד/ה" };
    const options = childRegistry.map((c) => ({ value: c.id, label: c.fullName }));
    if (selectedId && !options.some((o) => o.value === selectedId)) {
      const selected = childRegistry.find((c) => c.id === selectedId);
      if (selected) return [clearOption, { value: selected.id, label: selected.fullName }, ...options];
    }
    return [clearOption, ...options];
  }

  const colSpan = 13;
  // Stage 1 - how many TeachingPracticeChildAssignment slots this
  // practiceType expects (see EXPECTED_CHILD_SLOTS_BY_PRACTICE_TYPE's own
  // comment) - used to bound which rows get an inline child/horse/equipment
  // editor, so an unexpected overflow row (more children than the
  // practiceType normally has) safely falls back to read-only text instead
  // of indexing past what handleInlineUpdateLessonChild's own rebuild
  // expects.
  const expectedChildSlots = EXPECTED_CHILD_SLOTS_BY_PRACTICE_TYPE[lesson.practiceType];
  // BEGINNER_GROUP always index-pairs one child per trainee/role row (3+3).
  // LUNGE/BEGINNER_PRIVATE normally have one child shared by both trainee
  // rows, so its columns are shown once with rowSpan instead of repeated
  // (or blanked) per row - unless there's unexpectedly more than one child,
  // in which case this falls back to the same per-row pairing as the group
  // table so nothing is silently hidden.
  const sharedChildColumn = lesson.practiceType !== "BEGINNER_GROUP" && lesson.childAssignments.length <= 1;
  // displayRows.child is intentionally not read below when sharedChildColumn
  // is true (the table renders soleChild once via rowSpan instead) - see
  // pairLessonParticipantsWithChildren's own comment for why it still
  // resolves a concrete value there (the feedback modal needs one).
  const displayRows = pairLessonParticipantsWithChildren(lesson, roleSlots);
  const rowCount = displayRows.length;
  const soleChild = lesson.childAssignments[0] ?? null;

  return (
    <Fragment>
      {displayRows.map((row, i) => (
        <tr
          key={[lesson.id, row.participant?.participantId ?? "no-participant", row.child?.id ?? "no-child", i].join(
            "-"
          )}
          className={`border-t border-border hover:bg-muted/60 ${!isEditing ? rowColorClass : ""}`}
        >
          {i === 0 && (
            <LessonTimeEditCell
              startTime={lesson.startTime}
              endTime={lesson.endTime}
              editable={canEdit}
              disabled={savingCellKey === `lesson-${lesson.id}-startTime`}
              onCommit={(startTime) => onInlineUpdateField(lesson, startTime)}
              rowSpan={rowCount}
            />
          )}
          {canEdit && i < roleSlots.length ? (
            <TraineeAssignmentCell
              value={row.participant?.traineeId ?? ""}
              label={row.participant?.traineeName ?? "—"}
              options={traineeSelectOptionsFor(row.participant?.traineeId ?? "")}
              editable
              disabled={savingCellKey === `lesson-${lesson.id}-participant-${i}`}
              onAssign={(traineeId) => onInlineUpdateParticipant(lesson, roleSlots, i, { traineeId })}
            />
          ) : (
            <td className="px-2 py-2">
              {row.participant &&
              canEditFeedback &&
              isFeedbackEligibleRole(lesson.practiceType, row.participant.role) ? (
                <button
                  type="button"
                  onClick={() => onOpenFeedback(row.participant!.participantId)}
                  className="text-primary underline decoration-dotted underline-offset-2 hover:opacity-80"
                >
                  {row.participant.traineeName}
                </button>
              ) : (
                (row.participant?.traineeName ?? "—")
              )}
            </td>
          )}
          {canEdit && i < roleSlots.length ? (
            <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
              <select
                value={row.participant?.role ?? roleSlots[i]}
                onChange={(e) =>
                  onInlineUpdateParticipant(lesson, roleSlots, i, {
                    role: e.target.value as TeachingPracticeRoleValue,
                  })
                }
                disabled={savingCellKey === `lesson-${lesson.id}-participant-${i}`}
                className="w-full min-w-[90px] rounded-lg border border-border px-2 py-1 text-xs disabled:opacity-50"
              >
                {roleSlots.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </td>
          ) : (
            <td className="px-2 py-2">
              {row.participant
                ? (lesson.roleLabelOverrides?.[row.participant.role] ?? ROLE_LABELS[row.participant.role])
                : "—"}
            </td>
          )}
          {sharedChildColumn ? (
            i === 0 && (
              <>
                {canEdit ? (
                  <ChildAssignmentCell
                    value={soleChild?.childId ?? ""}
                    label={soleChild ? `${soleChild.childFullName}${soleChild.isAbsent ? " (נעדר/ת)" : ""}` : "—"}
                    options={childOptionsFor(soleChild?.childId ?? "")}
                    editable
                    disabled={savingCellKey === `lesson-${lesson.id}-child-0`}
                    onAssign={(childId) => onInlineUpdateChild(lesson, 0, { childId })}
                    rowSpan={rowCount}
                  />
                ) : (
                  <td rowSpan={rowCount} className="px-2 py-2 align-top">
                    {soleChild ? `${soleChild.childFullName}${soleChild.isAbsent ? " (נעדר/ת)" : ""}` : "—"}
                    {soleChild && (
                      <SameParentBadge
                        otherNames={sameParentOtherNamesByChildId.get(soleChild.childId) ?? []}
                        onClick={() => onOpenSameParentPopup(soleChild.childId)}
                      />
                    )}
                  </td>
                )}
                <td rowSpan={rowCount} className="px-2 py-2 align-top">
                  {soleChild?.childAge ?? "—"}
                </td>
                <td rowSpan={rowCount} className="px-2 py-2 align-top">
                  {soleChild?.childGender ?? "—"}
                </td>
                {canEditHorseFields ? (
                  <InlineTextEditCell
                    value={soleChild?.horseName ?? ""}
                    label={soleChild?.horseName ?? "—"}
                    editable
                    disabled={savingCellKey === `lesson-${lesson.id}-child-0-horseName`}
                    onCommit={(value) => onInlineUpdateChild(lesson, 0, { horseName: value })}
                    rowSpan={rowCount}
                  />
                ) : (
                  <td rowSpan={rowCount} className="px-2 py-2 align-top">
                    {soleChild?.horseName ?? "—"}
                  </td>
                )}
                {canEditHorseFields ? (
                  <InlineTextEditCell
                    value={soleChild?.equipmentNotes ?? ""}
                    label={soleChild?.equipmentNotes ?? "—"}
                    editable
                    disabled={savingCellKey === `lesson-${lesson.id}-child-0-equipmentNotes`}
                    onCommit={(value) => onInlineUpdateChild(lesson, 0, { equipmentNotes: value })}
                    rowSpan={rowCount}
                  />
                ) : (
                  <td rowSpan={rowCount} className="px-2 py-2 align-top">
                    {soleChild?.equipmentNotes ?? "—"}
                  </td>
                )}
                <td rowSpan={rowCount} className="px-2 py-2 align-top">
                  {soleChild?.parentName ?? "—"}
                </td>
                <td rowSpan={rowCount} className="px-2 py-2 align-top">
                  {/* canEdit here is already effectiveCanEdit (permission AND
                      the global isEditMode toggle) - equivalent to "is this
                      table currently in edit mode" for suppressing actions. */}
                  <ParentPhoneCell phone={soleChild?.parentPhone ?? "—"} isEditMode={canEdit} />
                </td>
              </>
            )
          ) : (
            <>
              {canEdit && i < expectedChildSlots ? (
                <ChildAssignmentCell
                  value={row.child?.childId ?? ""}
                  label={row.child ? `${row.child.childFullName}${row.child.isAbsent ? " (נעדר/ת)" : ""}` : "—"}
                  options={childOptionsFor(row.child?.childId ?? "")}
                  editable
                  disabled={savingCellKey === `lesson-${lesson.id}-child-${i}`}
                  onAssign={(childId) => onInlineUpdateChild(lesson, i, { childId })}
                />
              ) : (
                <td className="px-2 py-2">
                  {row.child ? `${row.child.childFullName}${row.child.isAbsent ? " (נעדר/ת)" : ""}` : "—"}
                  {row.child && (
                    <SameParentBadge
                      otherNames={sameParentOtherNamesByChildId.get(row.child.childId) ?? []}
                      onClick={() => onOpenSameParentPopup(row.child!.childId)}
                    />
                  )}
                </td>
              )}
              <td className="px-2 py-2">{row.child?.childAge ?? "—"}</td>
              <td className="px-2 py-2">{row.child?.childGender ?? "—"}</td>
              {canEditHorseFields && i < expectedChildSlots ? (
                <InlineTextEditCell
                  value={row.child?.horseName ?? ""}
                  label={row.child?.horseName ?? "—"}
                  editable
                  disabled={savingCellKey === `lesson-${lesson.id}-child-${i}-horseName`}
                  onCommit={(value) => onInlineUpdateChild(lesson, i, { horseName: value })}
                />
              ) : (
                <td className="px-2 py-2">{row.child?.horseName ?? "—"}</td>
              )}
              {canEditHorseFields && i < expectedChildSlots ? (
                <InlineTextEditCell
                  value={row.child?.equipmentNotes ?? ""}
                  label={row.child?.equipmentNotes ?? "—"}
                  editable
                  disabled={savingCellKey === `lesson-${lesson.id}-child-${i}-equipmentNotes`}
                  onCommit={(value) => onInlineUpdateChild(lesson, i, { equipmentNotes: value })}
                />
              ) : (
                <td className="px-2 py-2">{row.child?.equipmentNotes ?? "—"}</td>
              )}
              <td className="px-2 py-2">{row.child?.parentName ?? "—"}</td>
              <td className="px-2 py-2">
                <ParentPhoneCell phone={row.child?.parentPhone ?? "—"} isEditMode={canEdit} />
              </td>
            </>
          )}
          {i === 0 && (
            <InlineTextEditCell
              value={lesson.notes ?? ""}
              label={lesson.notes || "—"}
              editable={canEdit}
              disabled={savingCellKey === `lesson-${lesson.id}-notes`}
              truncateClassName="max-w-[220px] truncate"
              title={lesson.notes ?? undefined}
              onCommit={(value) => onInlineUpdateNotes(lesson, value)}
              rowSpan={rowCount}
            />
          )}
          {i === 0 && (
            <td rowSpan={rowCount} className="px-2 py-2 align-top">
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  lesson.isPublished ? "bg-success-muted text-success" : "bg-secondary text-secondary-foreground"
                }`}
              >
                {lesson.isPublished ? "פורסם" : "טיוטה"}
              </span>
            </td>
          )}
          {i === 0 && (
            <td rowSpan={rowCount} className="px-2 py-2 align-top">
              <div className="flex flex-wrap gap-1.5">
                {canEdit && (
                  <Button
                    variant="ghost"
                    className="!px-2 !py-1 !text-[11px]"
                    disabled={isPending}
                    onClick={onTogglePublished}
                  >
                    {lesson.isPublished ? "ביטול פרסום" : "פרסום"}
                  </Button>
                )}
                {canEdit && (
                  <Button
                    variant="ghost"
                    className="!px-2 !py-1 !text-[11px]"
                    disabled={isPending}
                    onClick={() => (isEditing ? setIsEditing(false) : startEdit())}
                  >
                    {isEditing ? "ביטול" : "עריכה"}
                  </Button>
                )}
              </div>
            </td>
          )}
        </tr>
      ))}
      {isEditing && (
        <tr className="border-t border-border bg-muted/30">
          <td colSpan={colSpan} className="px-2 py-3">
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
                  onChange={(e) => setEditForm((f) => ({ ...f, responsibleInstructorId: e.target.value }))}
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
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-sm font-medium text-card-foreground">שמות תפקידים לתצוגה</p>
              <p className="text-xs text-muted-foreground">משנה רק את התצוגה בטבלה, לא את השיבוץ בפועל</p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {roleSlots.map((role) => (
                  <label key={role} className="flex flex-col gap-1 text-sm">
                    {ROLE_LABELS[role]}
                    <span className="flex gap-1.5">
                      <input
                        value={editForm.roleLabels[role] ?? ""}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, roleLabels: { ...f.roleLabels, [role]: e.target.value } }))
                        }
                        className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className="!px-2 !py-1 !text-xs"
                        disabled={editForm.roleLabels[role] === ROLE_LABELS[role]}
                        onClick={() =>
                          setEditForm((f) => ({ ...f, roleLabels: { ...f.roleLabels, [role]: ROLE_LABELS[role] } }))
                        }
                      >
                        איפוס
                      </Button>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-sm font-medium text-card-foreground">חניכים ותפקידים</p>
              <p className="text-xs text-muted-foreground">
                משפיע רק על השיעור הזה בתאריך זה - לא משנה את הצוות הקבוע במסלול
              </p>
              <div className="mt-2 flex flex-col gap-2">
                {editForm.participants.map((row, i) => (
                  <div key={i} className="flex flex-col gap-2 rounded-lg border border-border p-2 sm:flex-row">
                    <label className="flex flex-1 flex-col gap-1 text-sm">
                      חניך/ה
                      <select
                        value={row.traineeId}
                        onChange={(e) =>
                          setEditForm((f) => {
                            const next = [...f.participants];
                            next[i] = { ...next[i], traineeId: e.target.value };
                            return { ...f, participants: next };
                          })
                        }
                        className="rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <option value="">ללא</option>
                        {traineeOptionsFor(row.traineeId).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.fullName}
                            {s.groupName ? ` (קבוצה ${s.groupName})` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-1 flex-col gap-1 text-sm">
                      תפקיד
                      <select
                        value={row.role}
                        onChange={(e) =>
                          setEditForm((f) => {
                            const next = [...f.participants];
                            next[i] = { ...next[i], role: e.target.value as TeachingPracticeRoleValue };
                            return { ...f, participants: next };
                          })
                        }
                        className="rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        {roleSlots.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-sm font-medium text-card-foreground">ילדים / סוסים / ציוד</p>
              <p className="text-xs text-muted-foreground">
                משפיע רק על השיעור הזה בתאריך זה - לא משנה את שיוך הילדים הקבוע במסלול
              </p>
              <div className="mt-2 flex flex-col gap-2">
                {editForm.childAssignments.map((row, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-2 rounded-lg border border-border p-2 sm:flex-row sm:items-end"
                  >
                    <label className="flex flex-1 flex-col gap-1 text-sm">
                      ילד/ה
                      <select
                        value={row.childId}
                        onChange={(e) =>
                          setEditForm((f) => {
                            const next = [...f.childAssignments];
                            next[i] = { ...next[i], childId: e.target.value };
                            return { ...f, childAssignments: next };
                          })
                        }
                        className="rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <option value="">ללא</option>
                        {childRegistry.map((c) => (
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
                        onChange={(e) =>
                          setEditForm((f) => {
                            const next = [...f.childAssignments];
                            next[i] = { ...next[i], horseName: e.target.value };
                            return { ...f, childAssignments: next };
                          })
                        }
                        className="rounded-lg border border-border px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="flex flex-1 flex-col gap-1 text-sm">
                      ציוד
                      <input
                        value={row.equipmentNotes}
                        onChange={(e) =>
                          setEditForm((f) => {
                            const next = [...f.childAssignments];
                            next[i] = { ...next[i], equipmentNotes: e.target.value };
                            return { ...f, childAssignments: next };
                          })
                        }
                        className="rounded-lg border border-border px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                ))}
              </div>
            </div>
            {editError && <p className="mt-2 text-sm text-danger">{editError}</p>}
            <div className="mt-2 flex gap-2">
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
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export interface TeachingPracticeFeedbackModalHandle {
  requestClose: () => void;
}

// Feedback entry form for one TeachingPracticeParticipant - rendered by
// TeachingPracticeManager inside a <Modal>, keyed by entry.participantId so
// switching trainees (see the switcher below) always mounts a fresh copy
// with correctly-seeded fields, rather than needing a manual reseed effect
// that could race with in-flight typing. Mirrors the riding feedback
// StudentEditor's save/switch/close mechanics (see
// app/instructor/InstructorRidingSlotsSection.tsx) but simpler: only two
// fields (rating, free text), no per-field autosave-on-blur (nothing here
// feeds a shared suggestion pool the way session-horse/lesson-topic do for
// riding) - every save is either the explicit button, a switch, or a close.
function TeachingPracticeFeedbackModal({
  entry,
  switchOptions,
  onSave,
  onClose,
  onSwitchTo,
  ref,
}: {
  entry: TeachingPracticeFeedbackEntry;
  // Every participant on the currently selected date (see feedbackEntries),
  // including this entry itself so it shows as selected.
  switchOptions: SearchableSelectOption[];
  onSave: (participantId: string, input: TeachingPracticeFeedbackInput) => Promise<ActionResult>;
  // Called only after a successful save-then-close.
  onClose: () => void;
  // Called only after a successful save-then-switch.
  onSwitchTo: (participantId: string) => void;
  ref?: Ref<TeachingPracticeFeedbackModalHandle>;
}) {
  const [ratingHalfPoints, setRatingHalfPoints] = useState<number | null>(entry.feedback?.ratingHalfPoints ?? null);
  const [feedbackText, setFeedbackText] = useState(entry.feedback?.feedback ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  // Synchronous guard (isSaving from useTransition only updates on the next
  // render) - a duplicate save request that arrives while one is already in
  // flight is simply dropped. requestClose and switching trainees are the
  // two exceptions (pendingCloseRef/pendingSwitchToRef below) - neither may
  // be silently dropped just because a save happened to already be running.
  const isSavingRef = useRef(false);
  const pendingCloseRef = useRef(false);
  const pendingSwitchToRef = useRef<string | null>(null);

  function performSave(options?: { switchToParticipantId?: string; shouldClose?: boolean }) {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setError(null);
    startSaveTransition(async () => {
      const result = await onSave(entry.participantId, {
        ratingHalfPoints,
        feedback: feedbackText,
      });
      isSavingRef.current = false;
      // A close or switch requested while THIS save was already in flight
      // must still be honored once this save finishes. A switch takes
      // priority over a plain close if somehow both were queued.
      const switchTarget = options?.switchToParticipantId ?? pendingSwitchToRef.current;
      const shouldClose = options?.shouldClose || pendingCloseRef.current;
      pendingSwitchToRef.current = null;
      pendingCloseRef.current = false;
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      if (switchTarget) {
        onSwitchTo(switchTarget);
      } else if (shouldClose) {
        onClose();
      }
    });
  }

  function handleSave() {
    performSave();
  }

  function handleSwitchTo(participantId: string) {
    if (!participantId || participantId === entry.participantId) return;
    if (isSavingRef.current) {
      pendingSwitchToRef.current = participantId;
      return;
    }
    performSave({ switchToParticipantId: participantId });
  }

  useImperativeHandle(ref, () => ({
    requestClose: () => {
      if (isSavingRef.current) {
        pendingCloseRef.current = true;
        return;
      }
      performSave({ shouldClose: true });
    },
  }));

  const roleLabel = entry.lesson.roleLabelOverrides?.[entry.role] ?? ROLE_LABELS[entry.role];

  return (
    <div className="flex flex-col gap-3">
      {switchOptions.length > 1 && (
        <label className="flex flex-col gap-1 text-sm">
          מעבר לחניך/ה אחר/ת
          <SearchableSelect
            value={entry.participantId}
            options={switchOptions}
            onChange={handleSwitchTo}
            placeholder="בחרו חניך/ה"
          />
        </label>
      )}

      {/* Read-only context - never editable from here (child/horse/equipment/
          participant/lesson details all stay owned by the existing עריכה
          flow above). */}
      <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-muted/40 p-3 text-sm">
        <p className="font-semibold text-card-foreground">{entry.traineeName}</p>
        <p className="text-muted-foreground">
          {PRACTICE_TYPE_LABELS[entry.lesson.practiceType]} · {roleLabel}
        </p>
        <p className="text-muted-foreground">
          {entry.lesson.startTime}-{entry.lesson.endTime}
        </p>
        <p className="text-muted-foreground">
          ילד/ה: {entry.child ? `${entry.child.childFullName}${entry.child.isAbsent ? " (נעדר/ת)" : ""}` : "—"}
        </p>
        <p className="text-muted-foreground">סוס: {entry.child?.horseName ?? "—"}</p>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        דירוג
        <select
          value={ratingHalfPoints ?? ""}
          onChange={(e) => setRatingHalfPoints(e.target.value ? Number(e.target.value) : null)}
          className="w-32 rounded-lg border border-border px-3 py-2 text-sm"
        >
          <option value="">ללא</option>
          {FEEDBACK_RATING_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v / 2}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        משוב
        <textarea
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
          rows={4}
          className="rounded-lg border border-border px-3 py-2 text-sm"
        />
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex justify-end">
        <Button disabled={isSaving} onClick={handleSave}>
          {isSaving ? "שומר..." : "שמירה"}
        </Button>
      </div>
    </div>
  );
}
