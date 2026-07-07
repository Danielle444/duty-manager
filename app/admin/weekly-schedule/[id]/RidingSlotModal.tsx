"use client";

import {
  Dispatch,
  FormEvent,
  SetStateAction,
  useEffect,
  useState,
  useTransition,
} from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { formatHebrewDate, parseDateKey } from "@/lib/dates";
import { cleanScheduleTitle } from "@/lib/schedule-title";
import { formatInstructorNames } from "@/lib/riding-assignment-matching";
import {
  getRidingSlotForScheduleItem,
  createOrGetRidingSlot,
  updateRidingSlotVisibility,
  upsertRidingSlotAssignment,
  deleteRidingSlotAssignment,
  type RidingSlotRow,
  type RidingSlotAssignmentRow,
} from "@/lib/actions/riding-slots";

interface ScheduleItemInfo {
  title: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  groupName: string | null;
  instructorName: string | null;
  location: string | null;
}

interface InstructorOption {
  id: string;
  fullName: string;
}

interface AssignmentForm {
  groupName: string;
  subgroupNumber: string;
  instructorIds: string[];
  arena: string;
}

const EMPTY_ASSIGNMENT_FORM: AssignmentForm = {
  groupName: "",
  subgroupNumber: "",
  instructorIds: [],
  arena: "",
};

function assignmentFormFromRow(row: RidingSlotAssignmentRow): AssignmentForm {
  return {
    groupName: row.groupName ?? "",
    subgroupNumber: row.subgroupNumber != null ? String(row.subgroupNumber) : "",
    // Copied, not aliased - the form's array must never be the same
    // reference as row.instructorIds, so editing one assignment can never
    // affect another still-cached row.
    instructorIds: [...row.instructorIds],
    arena: row.arena ?? "",
  };
}

// Shared by both "editing an existing split" (rendered inline, in place of
// that row) and "adding a new split" (rendered after the list) - factored
// out so the two call sites can't drift, and so the row being edited is
// never ALSO rendered as a separate, still-clickable list item at the same
// time (that used to let its own "עריכה" button re-fire openEditAssignment
// mid-edit, silently resetting assignmentForm back to the pre-edit row).
// Deliberately NOT SearchableMultiSelect here - that component kept its own
// internal open/search/highlight state, and something about combining it
// with this modal's edit-form re-renders made a freshly-toggled id disappear
// a moment after being selected. This picker holds no selection state of its
// own at all: every checkbox's checked value reads assignmentForm.instructorIds
// directly, and toggling writes straight back into it via a functional
// setState - there is no intermediate copy that could ever fall out of sync.
function InstructorChecklist({
  instructors,
  selectedIds,
  setAssignmentForm,
}: {
  instructors: InstructorOption[];
  selectedIds: string[];
  setAssignmentForm: Dispatch<SetStateAction<AssignmentForm>>;
}) {
  const [search, setSearch] = useState("");

  const filteredInstructors = instructors.filter((i) =>
    i.fullName.toLowerCase().includes(search.trim().toLowerCase())
  );
  const selectedInstructors = instructors.filter((i) => selectedIds.includes(i.id));

  function toggleInstructor(instructorId: string) {
    setAssignmentForm((current) => {
      const exists = current.instructorIds.includes(instructorId);
      return {
        ...current,
        instructorIds: exists
          ? current.instructorIds.filter((id) => id !== instructorId)
          : [...current.instructorIds, instructorId],
      };
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      {selectedInstructors.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedInstructors.map((i) => (
            <span
              key={i.id}
              className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
            >
              {i.fullName}
              <button
                type="button"
                onClick={() => toggleInstructor(i.id)}
                aria-label={`הסרת ${i.fullName}`}
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
        placeholder="חיפוש מדריך"
        className="rounded-lg border border-border px-3 py-2 text-sm"
      />
      <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border p-1.5">
        {filteredInstructors.length === 0 ? (
          <p className="px-1.5 py-1 text-xs text-muted-foreground">לא נמצאו מדריכים</p>
        ) : (
          filteredInstructors.map((i) => (
            <label
              key={i.id}
              className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(i.id)}
                onChange={() => toggleInstructor(i.id)}
              />
              {i.fullName}
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function AssignmentEditForm({
  assignmentForm,
  setAssignmentForm,
  instructors,
  assignmentFormError,
  isSavingAssignment,
  onSubmit,
  onCancel,
}: {
  assignmentForm: AssignmentForm;
  setAssignmentForm: Dispatch<SetStateAction<AssignmentForm>>;
  instructors: InstructorOption[];
  assignmentFormError: string | null;
  isSavingAssignment: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm">
          קבוצה (ריק = כל הרכיבה)
          <select
            value={assignmentForm.groupName}
            onChange={(e) => setAssignmentForm((f) => ({ ...f, groupName: e.target.value }))}
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
            value={assignmentForm.subgroupNumber}
            onChange={(e) => setAssignmentForm((f) => ({ ...f, subgroupNumber: e.target.value }))}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
      </div>
      <div className="flex flex-col gap-1 text-sm">
        מדריכים/ות אחראים/ות
        <InstructorChecklist
          instructors={instructors}
          selectedIds={assignmentForm.instructorIds}
          setAssignmentForm={setAssignmentForm}
        />
      </div>
      <label className="flex flex-col gap-1 text-sm">
        מגרש
        <input
          value={assignmentForm.arena}
          onChange={(e) => setAssignmentForm((f) => ({ ...f, arena: e.target.value }))}
          placeholder="למשל: מגרש 1"
          className="rounded-lg border border-border px-3 py-2 text-sm"
        />
      </label>
      {assignmentFormError && <p className="text-sm text-danger">{assignmentFormError}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          ביטול
        </Button>
        <Button type="submit" disabled={isSavingAssignment}>
          {isSavingAssignment ? "שומר..." : "שמירה"}
        </Button>
      </div>
    </form>
  );
}

export function RidingSlotModal({
  open,
  onClose,
  scheduleItemIds,
  scheduleItemInfo,
  isMergedDisplay,
  instructors,
}: {
  open: boolean;
  onClose: () => void;
  scheduleItemIds: string[];
  scheduleItemInfo: ScheduleItemInfo;
  isMergedDisplay: boolean;
  instructors: InstructorOption[];
}) {
  const [ridingSlot, setRidingSlot] = useState<RidingSlotRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [editingAssignmentId, setEditingAssignmentId] = useState<string | "new" | null>(null);
  const [assignmentForm, setAssignmentForm] = useState<AssignmentForm>(EMPTY_ASSIGNMENT_FORM);
  const [assignmentFormError, setAssignmentFormError] = useState<string | null>(null);
  const [isSavingAssignment, startAssignmentTransition] = useTransition();

  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Reset to the loading state every time the modal opens (or targets a
    // different schedule item) so a slow request never leaves a previous
    // item's riding slot data visible under the new one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setLoadError(null);
    setEditingAssignmentId(null);
    setDeleteError(null);
    getRidingSlotForScheduleItem(scheduleItemIds)
      .then((slot) => {
        if (cancelled) return;
        setRidingSlot(slot);
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError("שגיאה בטעינת נתוני הרכיבה. נסי לרענן.");
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // scheduleItemIds is a fresh array reference on every parent render;
    // joining it into a primitive key avoids refetching on unrelated parent
    // re-renders while the modal is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scheduleItemIds.join(",")]);

  function handleCreateSlot() {
    setLoadError(null);
    startTransition(async () => {
      const result = await createOrGetRidingSlot(scheduleItemIds);
      if (!result.success || !result.ridingSlot) {
        setLoadError(result.error ?? "אירעה שגיאה");
        return;
      }
      setRidingSlot(result.ridingSlot);
    });
  }

  function handleToggleVisibility(
    field: "showInstructorToStudents" | "showArenaToStudents" | "showSubgroupToStudents"
  ) {
    if (!ridingSlot) return;
    const next = {
      showInstructorToStudents: ridingSlot.showInstructorToStudents,
      showArenaToStudents: ridingSlot.showArenaToStudents,
      showSubgroupToStudents: ridingSlot.showSubgroupToStudents,
      [field]: !ridingSlot[field],
    };
    startTransition(async () => {
      const result = await updateRidingSlotVisibility(ridingSlot.id, next);
      if (!result.success || !result.ridingSlot) {
        setLoadError(result.error ?? "אירעה שגיאה");
        return;
      }
      setRidingSlot(result.ridingSlot);
    });
  }

  function openAddAssignment() {
    setEditingAssignmentId("new");
    // A new assignment defaults to the activity's own group, if it has a
    // single clear one (א/ב) - just a form default, not a saved value; a
    // "שתי הקבוצות" activity (groupName null, or anything else unexpected)
    // keeps the existing "כל הרכיבה" (empty) default. Admin can still
    // change it before saving.
    const defaultGroupName =
      scheduleItemInfo.groupName === "א" || scheduleItemInfo.groupName === "ב"
        ? scheduleItemInfo.groupName
        : "";
    // instructorIds gets its own fresh array (not EMPTY_ASSIGNMENT_FORM's
    // shared one) so this session's selections can never be confused with
    // another "add new" session's.
    setAssignmentForm({ ...EMPTY_ASSIGNMENT_FORM, groupName: defaultGroupName, instructorIds: [] });
    setAssignmentFormError(null);
  }

  function openEditAssignment(row: RidingSlotAssignmentRow) {
    setEditingAssignmentId(row.id);
    setAssignmentForm(assignmentFormFromRow(row));
    setAssignmentFormError(null);
  }

  function handleAssignmentSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ridingSlot || editingAssignmentId === null) return;
    setAssignmentFormError(null);

    startAssignmentTransition(async () => {
      const result = await upsertRidingSlotAssignment({
        id: editingAssignmentId !== "new" ? editingAssignmentId : undefined,
        ridingSlotId: ridingSlot.id,
        groupName: assignmentForm.groupName || undefined,
        subgroupNumber: assignmentForm.subgroupNumber
          ? Number(assignmentForm.subgroupNumber)
          : undefined,
        instructorIds: assignmentForm.instructorIds,
        arena: assignmentForm.arena || undefined,
      });
      if (!result.success || !result.assignment) {
        setAssignmentFormError(result.error ?? "אירעה שגיאה");
        return;
      }
      const saved = result.assignment;
      setRidingSlot((slot) => {
        if (!slot) return slot;
        const exists = slot.assignments.some((a) => a.id === saved.id);
        return {
          ...slot,
          assignments: exists
            ? slot.assignments.map((a) => (a.id === saved.id ? saved : a))
            : [...slot.assignments, saved],
        };
      });
      setEditingAssignmentId(null);
    });
  }

  function handleDeleteAssignment(assignmentId: string) {
    setDeleteError(null);
    startAssignmentTransition(async () => {
      const result = await deleteRidingSlotAssignment(assignmentId);
      if (!result.success) {
        setDeleteError(result.error ?? "אירעה שגיאה");
        return;
      }
      setRidingSlot((slot) =>
        slot ? { ...slot, assignments: slot.assignments.filter((a) => a.id !== assignmentId) } : slot
      );
    });
  }

  return (
    <Modal open={open} title="ניהול רכיבה" onClose={onClose}>
      {/* Bounded to a viewport-relative height with the schedule-item summary
          pinned above and the "סגירה" button pinned below - only the
          middle (visibility/assignments) section scrolls internally, so a
          long assignment list or the multi-instructor picker's dropdown
          never pushes the modal itself past the visible screen. */}
      <div className="flex max-h-[80vh] flex-col gap-4">
        <div className="shrink-0 rounded-lg bg-secondary p-3 text-sm text-secondary-foreground">
          <p className="font-semibold">{cleanScheduleTitle(scheduleItemInfo.title)}</p>
          <p className="text-xs">
            {formatHebrewDate(parseDateKey(scheduleItemInfo.dateKey))} ·{" "}
            {scheduleItemInfo.startTime}-{scheduleItemInfo.endTime} ·{" "}
            {scheduleItemInfo.groupName ? `קבוצה ${scheduleItemInfo.groupName}` : "שתי הקבוצות"}
          </p>
          {scheduleItemInfo.instructorName && (
            <p className="text-xs">מהלו&quot;ז המקורי: מדריך/ה {scheduleItemInfo.instructorName}</p>
          )}
          {scheduleItemInfo.location && (
            <p className="text-xs">מהלו&quot;ז המקורי: מיקום {scheduleItemInfo.location}</p>
          )}
          {isMergedDisplay && (
            <p className="mt-1 text-xs italic">
              פעילות זו מורכבת מכמה שורות לו&quot;ז ומנוהלת כסלוט רכיבה אחד.
            </p>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto ps-1">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">טוען...</p>
        ) : !ridingSlot ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              עדיין לא הוגדר ניהול רכיבה עבור פריט זה.
            </p>
            {loadError && <p className="text-sm text-danger">{loadError}</p>}
            <Button disabled={isPending} onClick={handleCreateSlot} className="self-start">
              {isPending ? "יוצר..." : "צור ניהול רכיבה"}
            </Button>
          </div>
        ) : (
          <>
            {loadError && <p className="text-sm text-danger">{loadError}</p>}

            <div className="rounded-lg border border-border p-3">
              <p className="mb-2 text-sm font-semibold text-card-foreground">
                חשיפה לחניכים
              </p>
              <div className="flex flex-col gap-1.5 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ridingSlot.showInstructorToStudents}
                    disabled={isPending}
                    onChange={() => handleToggleVisibility("showInstructorToStudents")}
                  />
                  הצג מדריך/ה לחניכים
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ridingSlot.showArenaToStudents}
                    disabled={isPending}
                    onChange={() => handleToggleVisibility("showArenaToStudents")}
                  />
                  הצג מגרש לחניכים
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ridingSlot.showSubgroupToStudents}
                    disabled={isPending}
                    onChange={() => handleToggleVisibility("showSubgroupToStudents")}
                  />
                  הצג שיוך תת-קבוצה לחניכים
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-card-foreground">שיוכי רכיבה</p>
                {editingAssignmentId === null && (
                  <Button
                    variant="secondary"
                    className="!px-2 !py-1 !text-xs"
                    onClick={openAddAssignment}
                  >
                    + הוספת שיוך
                  </Button>
                )}
              </div>

              {deleteError && <p className="text-sm text-danger">{deleteError}</p>}

              {ridingSlot.assignments.length === 0 && editingAssignmentId === null && (
                <p className="text-sm text-muted-foreground">
                  אין עדיין שיוכים - ניתן להוסיף שיוך לכל הרכיבה או לפי קבוצה/תת-קבוצה.
                </p>
              )}

              {ridingSlot.assignments.map((a) =>
                editingAssignmentId === a.id ? (
                  <AssignmentEditForm
                    key={a.id}
                    assignmentForm={assignmentForm}
                    setAssignmentForm={setAssignmentForm}
                    instructors={instructors}
                    assignmentFormError={assignmentFormError}
                    isSavingAssignment={isSavingAssignment}
                    onSubmit={handleAssignmentSubmit}
                    onCancel={() => setEditingAssignmentId(null)}
                  />
                ) : (
                  <div
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm"
                  >
                    <div>
                      <p className="font-medium text-card-foreground">
                        {a.groupName ? `קבוצה ${a.groupName}` : "כל הרכיבה"}
                        {a.subgroupNumber != null ? ` / תת-קבוצה ${a.subgroupNumber}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        מדריך/ה:{" "}
                        {formatInstructorNames(a.instructors.map((i) => i.fullName)) ?? "לא נבחר"} · מגרש:{" "}
                        {a.arena ?? "לא הוזן"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        className="!px-2 !py-1 !text-xs"
                        // Disabled (not just for this row) while ANY edit is in
                        // progress - editingAssignmentId already renders that
                        // row as a form above, so this button, for every OTHER
                        // row, must not be able to start a second, conflicting
                        // edit session mid-way through the first.
                        disabled={editingAssignmentId !== null || isSavingAssignment}
                        onClick={() => openEditAssignment(a)}
                      >
                        עריכה
                      </Button>
                      <Button
                        variant="danger"
                        className="!px-2 !py-1 !text-xs"
                        disabled={editingAssignmentId !== null || isSavingAssignment}
                        onClick={() => handleDeleteAssignment(a.id)}
                      >
                        מחיקה
                      </Button>
                    </div>
                  </div>
                )
              )}

              {editingAssignmentId === "new" && (
                <AssignmentEditForm
                  assignmentForm={assignmentForm}
                  setAssignmentForm={setAssignmentForm}
                  instructors={instructors}
                  assignmentFormError={assignmentFormError}
                  isSavingAssignment={isSavingAssignment}
                  onSubmit={handleAssignmentSubmit}
                  onCancel={() => setEditingAssignmentId(null)}
                />
              )}
            </div>
          </>
        )}
        </div>

        <div className="flex shrink-0 justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            סגירה
          </Button>
        </div>
      </div>
    </Modal>
  );
}
