"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/lib/components/Modal";
import { Button } from "@/lib/components/Button";
import { formatHebrewDate, formatHebrewWeekday, parseDateKey } from "@/lib/dates";
import { upsertManualAssignment, deleteAssignment } from "@/lib/actions/schedule";

export interface CellEditorDutyType {
  id: string;
  name: string;
  allocationMode: string;
}

export interface CellEditorAssignment {
  id: string;
  dutyTypeId: string;
  dutyTypeName: string;
  isManual: boolean;
  isPublished: boolean;
  isCompleted: boolean;
}

export function ScheduleCellEditor({
  studentId,
  studentName,
  groupName,
  subgroupNumber,
  dateKey: cellDateKey,
  existingAssignment,
  dutyTypes,
  blockedDutyTypeIds,
  subgroupConflictDutyTypeIds,
  isNoDutyDate,
  onClose,
  onSaved,
}: {
  studentId: string;
  studentName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  dateKey: string;
  existingAssignment: CellEditorAssignment | null;
  dutyTypes: CellEditorDutyType[];
  blockedDutyTypeIds: Set<string>;
  subgroupConflictDutyTypeIds: Set<string>;
  isNoDutyDate: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [selectedDutyTypeId, setSelectedDutyTypeId] = useState(existingAssignment?.dutyTypeId ?? "");
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    if (!selectedDutyTypeId) {
      setError("יש לבחור סוג תורנות");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await upsertManualAssignment(cellDateKey, studentId, selectedDutyTypeId);
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      onSaved();
    });
  }

  function handleRemove() {
    if (!existingAssignment) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteAssignment(existingAssignment.id);
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      onSaved();
    });
  }

  return (
    <Modal open title={`שיבוץ תורנות · ${studentName}`} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-muted-foreground">
          <div>
            קבוצה: <span className="text-card-foreground">{groupName ?? "–"}</span>
          </div>
          <div>
            תת-קבוצה: <span className="text-card-foreground">{subgroupNumber ?? "–"}</span>
          </div>
          <div className="col-span-2">
            תאריך:{" "}
            <span className="text-card-foreground">
              {formatHebrewWeekday(parseDateKey(cellDateKey))} ·{" "}
              {formatHebrewDate(parseDateKey(cellDateKey))}
            </span>
          </div>
        </div>

        {isNoDutyDate && (
          <p className="rounded-lg bg-warning-muted px-3 py-2 text-warning">
            תאריך זה מסומן כ&quot;אין תורנויות ביום זה&quot; - שיבוץ ידני עדיין אפשרי אך אינו מומלץ
          </p>
        )}

        {existingAssignment && (
          <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            שיבוץ נוכחי:{" "}
            <span className="font-medium text-card-foreground">
              {existingAssignment.dutyTypeName}
            </span>{" "}
            · {existingAssignment.isManual ? "ידני" : "אוטומטי"} ·{" "}
            {existingAssignment.isPublished ? "פורסם" : "טיוטה"}
            {existingAssignment.isCompleted && " · בוצע"}
          </div>
        )}

        <label className="flex flex-col gap-1">
          סוג תורנות
          <select
            value={selectedDutyTypeId}
            onChange={(e) => setSelectedDutyTypeId(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">בחרו סוג תורנות</option>
            {dutyTypes.map((d) => {
              const blocked = blockedDutyTypeIds.has(d.id);
              const conflict = subgroupConflictDutyTypeIds.has(d.id);
              return (
                <option key={d.id} value={d.id} disabled={blocked || conflict}>
                  {d.name}
                  {blocked ? " (חסום עקב אילוץ)" : conflict ? " (תפוס בתת-הקבוצה)" : ""}
                </option>
              );
            })}
          </select>
        </label>

        {error && <p className="text-danger">{error}</p>}

        <div className="mt-2 flex items-center justify-between gap-2">
          <Button variant="primary" disabled={isPending} onClick={handleSave}>
            שמירה
          </Button>
          {existingAssignment && (
            <Button variant="danger" disabled={isPending} onClick={handleRemove}>
              הסרת שיבוץ
            </Button>
          )}
          <Button variant="ghost" disabled={isPending} onClick={onClose}>
            ביטול
          </Button>
        </div>
      </div>
    </Modal>
  );
}
