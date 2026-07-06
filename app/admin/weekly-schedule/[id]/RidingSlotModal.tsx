"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { formatHebrewDate, parseDateKey } from "@/lib/dates";
import { cleanScheduleTitle } from "@/lib/schedule-title";
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
  instructorId: string;
  arena: string;
}

const EMPTY_ASSIGNMENT_FORM: AssignmentForm = {
  groupName: "",
  subgroupNumber: "",
  instructorId: "",
  arena: "",
};

function assignmentFormFromRow(row: RidingSlotAssignmentRow): AssignmentForm {
  return {
    groupName: row.groupName ?? "",
    subgroupNumber: row.subgroupNumber != null ? String(row.subgroupNumber) : "",
    instructorId: row.instructorId ?? "",
    arena: row.arena ?? "",
  };
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
    setAssignmentForm({ ...EMPTY_ASSIGNMENT_FORM, groupName: defaultGroupName });
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
        instructorId: assignmentForm.instructorId || undefined,
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
      <div className="flex flex-col gap-4">
        <div className="rounded-lg bg-secondary p-3 text-sm text-secondary-foreground">
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

              {ridingSlot.assignments.map((a) => (
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
                      מדריך/ה: {a.instructorName ?? "לא נבחר"} · מגרש: {a.arena ?? "לא הוזן"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1 !text-xs"
                      disabled={isSavingAssignment}
                      onClick={() => openEditAssignment(a)}
                    >
                      עריכה
                    </Button>
                    <Button
                      variant="danger"
                      className="!px-2 !py-1 !text-xs"
                      disabled={isSavingAssignment}
                      onClick={() => handleDeleteAssignment(a.id)}
                    >
                      מחיקה
                    </Button>
                  </div>
                </div>
              ))}

              {editingAssignmentId !== null && (
                <form
                  onSubmit={handleAssignmentSubmit}
                  className="flex flex-col gap-2 rounded-lg border border-border p-3"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 text-sm">
                      קבוצה (ריק = כל הרכיבה)
                      <select
                        value={assignmentForm.groupName}
                        onChange={(e) =>
                          setAssignmentForm((f) => ({ ...f, groupName: e.target.value }))
                        }
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
                        onChange={(e) =>
                          setAssignmentForm((f) => ({ ...f, subgroupNumber: e.target.value }))
                        }
                        className="rounded-lg border border-border px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 text-sm">
                    מדריך/ה
                    <select
                      value={assignmentForm.instructorId}
                      onChange={(e) =>
                        setAssignmentForm((f) => ({ ...f, instructorId: e.target.value }))
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
                    מגרש
                    <input
                      value={assignmentForm.arena}
                      onChange={(e) => setAssignmentForm((f) => ({ ...f, arena: e.target.value }))}
                      placeholder="למשל: מגרש 1"
                      className="rounded-lg border border-border px-3 py-2 text-sm"
                    />
                  </label>
                  {assignmentFormError && (
                    <p className="text-sm text-danger">{assignmentFormError}</p>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setEditingAssignmentId(null)}
                    >
                      ביטול
                    </Button>
                    <Button type="submit" disabled={isSavingAssignment}>
                      {isSavingAssignment ? "שומר..." : "שמירה"}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            סגירה
          </Button>
        </div>
      </div>
    </Modal>
  );
}
