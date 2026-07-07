"use client";

import { Fragment, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
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
  type TeachingPracticeTrackInput,
  type TeachingPracticeTrackSummary,
} from "@/lib/actions/teaching-practice";

type Role = "admin" | "instructor";
type Tab = "tracks" | "lessons" | "children";

const TAB_LABELS: Record<Tab, string> = {
  tracks: "מבנה קבוע",
  lessons: "שיעורים שנוצרו",
  children: "ילדים",
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
      .sort((a, b) => a.defaultStartTime.localeCompare(b.defaultStartTime))
      .map((groupTrack) => {
        const privateTracks = (feedingPrivateTracksByGroupId.get(groupTrack.id) ?? [])
          .slice()
          .sort((a, b) => a.defaultStartTime.localeCompare(b.defaultStartTime));
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
      .sort((a, b) => a.defaultStartTime.localeCompare(b.defaultStartTime))
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
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
        {/* Only ever rendered for canEdit users - someone without edit
            permission never sees this button, and therefore never has a way
            to reach isEditMode=true (view-only stays view-only for them,
            with no client-side path around it). */}
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
                          <table className="w-full min-w-[880px] border-collapse text-xs">
                            <thead>
                              <tr className="bg-muted text-muted-foreground">
                                <th className="sticky right-0 z-10 bg-muted px-2 py-2 text-right font-bold">
                                  שעה
                                </th>
                                <th className="px-2 py-2 text-right font-bold">חניך מדריך</th>
                                <th className="px-2 py-2 text-right font-bold">עוזר מדריך</th>
                                <th className="px-2 py-2 text-right font-bold">שם הילד</th>
                                <th className="px-2 py-2 text-right font-bold">שם משפחה</th>
                                <th className="px-2 py-2 text-right font-bold">גיל</th>
                                <th className="px-2 py-2 text-right font-bold">מין</th>
                                <th className="px-2 py-2 text-right font-bold">סוס</th>
                                <th className="px-2 py-2 text-right font-bold">ציוד</th>
                                <th className="px-2 py-2 text-right font-bold">שם ההורה</th>
                                <th className="px-2 py-2 text-right font-bold">טלפון</th>
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
                                  <td className="sticky right-0 z-10 bg-card px-2 py-2 font-medium text-card-foreground">
                                    {row.track.defaultStartTime}
                                    {!row.track.isActive && (
                                      <span className="mr-1 text-[10px] text-muted-foreground">(לא פעיל)</span>
                                    )}
                                  </td>
                                  <TraineeAssignmentCell
                                    value={row.traineeIdsBySlot[0] ?? ""}
                                    label={row.traineeNamesBySlot[0] ?? "—"}
                                    options={traineeSelectOptions(row.track, row.traineeIdsBySlot[0] ?? "")}
                                    editable={effectiveCanEdit}
                                    disabled={savingCellKey === `${row.track.id}-0`}
                                    onAssign={(traineeId) => handleInlineAssignTrainee(row.track, 0, traineeId)}
                                  />
                                  <TraineeAssignmentCell
                                    value={row.traineeIdsBySlot[1] ?? ""}
                                    label={row.traineeNamesBySlot[1] ?? "—"}
                                    options={traineeSelectOptions(row.track, row.traineeIdsBySlot[1] ?? "")}
                                    editable={effectiveCanEdit}
                                    disabled={savingCellKey === `${row.track.id}-1`}
                                    onAssign={(traineeId) => handleInlineAssignTrainee(row.track, 1, traineeId)}
                                  />
                                  <td className="px-2 py-2">{row.childFirstName}</td>
                                  <td className="px-2 py-2">{row.childLastName}</td>
                                  <td className="px-2 py-2">{row.childAge}</td>
                                  <td className="px-2 py-2">{row.childGender}</td>
                                  <td className="px-2 py-2">{row.horseName}</td>
                                  <td className="px-2 py-2">{row.equipmentNotes}</td>
                                  <td className="px-2 py-2">{row.parentName}</td>
                                  <td className="px-2 py-2">{row.parentPhone}</td>
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
                          <table className="w-full min-w-[900px] border-collapse text-xs">
                            <thead>
                              <tr className="bg-secondary text-secondary-foreground">
                                <th colSpan={1} className="border-b border-border px-2 py-1.5 text-center font-bold">
                                  קבוצתי
                                </th>
                                <th
                                  colSpan={11}
                                  className="border-b border-border px-2 py-1.5 text-center font-bold"
                                >
                                  פרטני
                                </th>
                              </tr>
                              <tr className="bg-muted text-muted-foreground">
                                <th className="sticky right-0 z-10 bg-muted px-2 py-2 text-right font-bold">
                                  שעה לקבוצתי
                                </th>
                                <th className="px-2 py-2 text-right font-bold">שעה לפרטני</th>
                                <th className="px-2 py-2 text-right font-bold">חניך מתרגל</th>
                                <th className="px-2 py-2 text-right font-bold">עוזר מדריך</th>
                                <th className="px-2 py-2 text-right font-bold">שם הילד</th>
                                <th className="px-2 py-2 text-right font-bold">שם משפחה</th>
                                <th className="px-2 py-2 text-right font-bold">גיל</th>
                                <th className="px-2 py-2 text-right font-bold">מין</th>
                                <th className="px-2 py-2 text-right font-bold">סוס</th>
                                <th className="px-2 py-2 text-right font-bold">ציוד</th>
                                <th className="px-2 py-2 text-right font-bold">שם ההורה</th>
                                <th className="px-2 py-2 text-right font-bold">טלפון</th>
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
                                          {i === 0 && (
                                            <ClickableCell
                                              rowSpan={rowCount}
                                              sticky
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
                                              <ClickableCell
                                                isActive={privateRow.track.isActive}
                                                onOpen={() => openTrackManager(privateRow.track)}
                                              >
                                                {privateRow.track.defaultStartTime}
                                                {!privateRow.track.isActive && (
                                                  <span className="mr-1 text-[10px] text-muted-foreground">
                                                    (לא פעיל)
                                                  </span>
                                                )}
                                              </ClickableCell>
                                              <TraineeAssignmentCell
                                                value={privateRow.traineeIdsBySlot[0] ?? ""}
                                                label={privateRow.traineeNamesBySlot[0] ?? "—"}
                                                options={traineeSelectOptions(
                                                  privateRow.track,
                                                  privateRow.traineeIdsBySlot[0] ?? ""
                                                )}
                                                editable={effectiveCanEdit}
                                                disabled={savingCellKey === `${privateRow.track.id}-0`}
                                                onAssign={(traineeId) =>
                                                  handleInlineAssignTrainee(privateRow.track, 0, traineeId)
                                                }
                                                onOpen={() => openTrackManager(privateRow.track)}
                                                isActive={privateRow.track.isActive}
                                              />
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
                                              <ClickableCell
                                                isActive={privateRow.track.isActive}
                                                onOpen={() => openTrackManager(privateRow.track)}
                                              >
                                                {privateRow.childFirstName}
                                              </ClickableCell>
                                              <ClickableCell
                                                isActive={privateRow.track.isActive}
                                                onOpen={() => openTrackManager(privateRow.track)}
                                              >
                                                {privateRow.childLastName}
                                              </ClickableCell>
                                              <ClickableCell
                                                isActive={privateRow.track.isActive}
                                                onOpen={() => openTrackManager(privateRow.track)}
                                              >
                                                {privateRow.childAge}
                                              </ClickableCell>
                                              <ClickableCell
                                                isActive={privateRow.track.isActive}
                                                onOpen={() => openTrackManager(privateRow.track)}
                                              >
                                                {privateRow.childGender}
                                              </ClickableCell>
                                              <ClickableCell
                                                isActive={privateRow.track.isActive}
                                                onOpen={() => openTrackManager(privateRow.track)}
                                              >
                                                {privateRow.horseName}
                                              </ClickableCell>
                                              <ClickableCell
                                                isActive={privateRow.track.isActive}
                                                onOpen={() => openTrackManager(privateRow.track)}
                                              >
                                                {privateRow.equipmentNotes}
                                              </ClickableCell>
                                              <ClickableCell
                                                isActive={privateRow.track.isActive}
                                                onOpen={() => openTrackManager(privateRow.track)}
                                              >
                                                {privateRow.parentName}
                                              </ClickableCell>
                                              <ClickableCell
                                                isActive={privateRow.track.isActive}
                                                onOpen={() => openTrackManager(privateRow.track)}
                                              >
                                                {privateRow.parentPhone}
                                              </ClickableCell>
                                            </>
                                          ) : (
                                            <td colSpan={11} className="px-2 py-2 text-center text-muted-foreground">
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
                            <table className="w-full min-w-[880px] border-collapse text-xs">
                              <thead>
                                <tr className="bg-muted text-muted-foreground">
                                  <th className="sticky right-0 z-10 bg-muted px-2 py-2 text-right font-bold">
                                    שעה לפרטני
                                  </th>
                                  <th className="px-2 py-2 text-right font-bold">חניך מתרגל</th>
                                  <th className="px-2 py-2 text-right font-bold">עוזר מדריך</th>
                                  <th className="px-2 py-2 text-right font-bold">שם הילד</th>
                                  <th className="px-2 py-2 text-right font-bold">שם משפחה</th>
                                  <th className="px-2 py-2 text-right font-bold">גיל</th>
                                  <th className="px-2 py-2 text-right font-bold">מין</th>
                                  <th className="px-2 py-2 text-right font-bold">סוס</th>
                                  <th className="px-2 py-2 text-right font-bold">ציוד</th>
                                  <th className="px-2 py-2 text-right font-bold">שם ההורה</th>
                                  <th className="px-2 py-2 text-right font-bold">טלפון</th>
                                </tr>
                              </thead>
                              <tbody>
                                {unlinkedPrivate.map((row) => (
                                  <tr key={row.key} className="border-t border-border">
                                    <ClickableCell
                                      sticky
                                      isActive={row.track.isActive}
                                      onOpen={() => openTrackManager(row.track)}
                                    >
                                      {row.track.defaultStartTime}
                                      {!row.track.isActive && (
                                        <span className="mr-1 text-[10px] text-muted-foreground">(לא פעיל)</span>
                                      )}
                                    </ClickableCell>
                                    <TraineeAssignmentCell
                                      value={row.traineeIdsBySlot[0] ?? ""}
                                      label={row.traineeNamesBySlot[0] ?? "—"}
                                      options={traineeSelectOptions(row.track, row.traineeIdsBySlot[0] ?? "")}
                                      editable={effectiveCanEdit}
                                      disabled={savingCellKey === `${row.track.id}-0`}
                                      onAssign={(traineeId) => handleInlineAssignTrainee(row.track, 0, traineeId)}
                                      onOpen={() => openTrackManager(row.track)}
                                      isActive={row.track.isActive}
                                    />
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
                                    <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                      {row.childFirstName}
                                    </ClickableCell>
                                    <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                      {row.childLastName}
                                    </ClickableCell>
                                    <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                      {row.childAge}
                                    </ClickableCell>
                                    <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                      {row.childGender}
                                    </ClickableCell>
                                    <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                      {row.horseName}
                                    </ClickableCell>
                                    <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                      {row.equipmentNotes}
                                    </ClickableCell>
                                    <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                      {row.parentName}
                                    </ClickableCell>
                                    <ClickableCell isActive={row.track.isActive} onOpen={() => openTrackManager(row.track)}>
                                      {row.parentPhone}
                                    </ClickableCell>
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
}) {
  if (!editable) {
    if (onOpen) {
      return (
        <ClickableCell rowSpan={rowSpan} isActive={isActive} onOpen={onOpen}>
          {label}
        </ClickableCell>
      );
    }
    return (
      <td rowSpan={rowSpan} className="px-2 py-2">
        {label}
      </td>
    );
  }
  return (
    <td rowSpan={rowSpan} className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
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
