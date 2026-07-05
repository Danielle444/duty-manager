"use client";

import { FormEvent, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { DutyDescriptionText } from "@/lib/components/DutyDescriptionText";
import { createDutyType, setDutyTypeActive, updateDutyType } from "@/lib/actions/duties";

type AllocationMode = "FIXED_COUNT" | "ONE_PER_SUBGROUP";

const ALLOCATION_MODE_LABELS: Record<AllocationMode, string> = {
  FIXED_COUNT: "כמות קבועה",
  ONE_PER_SUBGROUP: "תלמיד/ה אחד/ת לכל תת-קבוצה",
};

interface DutyTypeRow {
  id: string;
  name: string;
  description: string | null;
  defaultRequiredCount: number;
  allocationMode: AllocationMode;
  isActive: boolean;
}

export function DutiesClient({ dutyTypes }: { dutyTypes: DutyTypeRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [modalDuty, setModalDuty] = useState<DutyTypeRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result =
        modalDuty && modalDuty !== "new"
          ? await updateDutyType(modalDuty.id, formData)
          : await createDutyType(formData);
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      setModalDuty(null);
    });
  }

  function handleToggleActive(duty: DutyTypeRow) {
    startTransition(async () => {
      await setDutyTypeActive(duty.id, !duty.isActive);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setError(null);
            setModalDuty("new");
          }}
        >
          + הוספת סוג תורנות
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-right font-medium">שם התורנות</th>
              <th className="px-4 py-3 text-right font-medium">תיאור</th>
              <th className="px-4 py-3 text-right font-medium">כמות נדרשת</th>
              <th className="px-4 py-3 text-right font-medium">אופן הקצאה</th>
              <th className="px-4 py-3 text-right font-medium">סטטוס</th>
              <th className="px-4 py-3 text-right font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {dutyTypes.map((duty) => (
              <tr key={duty.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium text-card-foreground">{duty.name}</td>
                <td className="max-w-xs px-4 py-3 text-muted-foreground">
                  {duty.description ? (
                    <DutyDescriptionText description={duty.description} />
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {duty.allocationMode === "ONE_PER_SUBGROUP" ? "-" : duty.defaultRequiredCount}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {ALLOCATION_MODE_LABELS[duty.allocationMode]}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      duty.isActive
                        ? "bg-success-muted text-success"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {duty.isActive ? "פעיל" : "לא פעיל"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1"
                      onClick={() => {
                        setError(null);
                        setModalDuty(duty);
                      }}
                    >
                      עריכה
                    </Button>
                    <Button
                      variant={duty.isActive ? "danger" : "secondary"}
                      className="!px-2 !py-1"
                      disabled={isPending}
                      onClick={() => handleToggleActive(duty)}
                    >
                      {duty.isActive ? "השבתה" : "הפעלה"}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {dutyTypes.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  אין סוגי תורנות עדיין
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalDuty !== null}
        title={modalDuty === "new" ? "הוספת סוג תורנות" : "עריכת סוג תורנות"}
        onClose={() => setModalDuty(null)}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            שם התורנות
            <input
              name="name"
              defaultValue={modalDuty !== "new" ? modalDuty?.name : ""}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            תיאור (אופציונלי)
            <textarea
              name="description"
              defaultValue={modalDuty !== "new" ? modalDuty?.description ?? "" : ""}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              rows={3}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            אופן הקצאה
            <select
              name="allocationMode"
              defaultValue={modalDuty !== "new" ? modalDuty?.allocationMode : "FIXED_COUNT"}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            >
              <option value="FIXED_COUNT">כמות קבועה</option>
              <option value="ONE_PER_SUBGROUP">תלמיד/ה אחד/ת לכל תת-קבוצה</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            כמות תלמידים נדרשת כברירת מחדל
            <input
              name="defaultRequiredCount"
              type="number"
              min={1}
              defaultValue={modalDuty !== "new" ? modalDuty?.defaultRequiredCount : 1}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
            <span className="text-xs text-muted-foreground">
              מתעלמים מערך זה כאשר אופן ההקצאה הוא &quot;תלמיד/ה אחד/ת לכל תת-קבוצה&quot; -
              במקרה זה הכמות נקבעת אוטומטית לפי מספר תתי-הקבוצות הזמינות בכל תאריך.
            </span>
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalDuty(null)}>
              ביטול
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "שומר..." : "שמירה"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
