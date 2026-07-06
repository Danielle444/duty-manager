"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { HorseFeedingSection } from "@/lib/components/HorseFeedingSection";
import { updateStudentHorseInfo, type HorseAssignmentRow } from "@/lib/actions/horses";
import {
  getHorseFeedingOverviewForAdmin,
  upsertHorseFeedingMealsAsAdmin,
} from "@/lib/actions/horse-feeding";
import { getHorseDisplayInfo, type HorseBadgeType } from "@/lib/horse-info";

type HorseTypeFilter = "all" | HorseBadgeType;
type ViewMode = "assignments" | "feeding";

const HORSE_TYPE_LABELS: Record<HorseTypeFilter, string> = {
  all: "הכל",
  private: "סוס פרטי",
  assigned: "סוס קורס",
  none: "לא שובץ",
};

function badgeClass(badgeType: HorseBadgeType): string {
  if (badgeType === "private") return "bg-success-muted text-success";
  if (badgeType === "assigned") return "bg-secondary text-secondary-foreground";
  return "bg-muted text-muted-foreground";
}

export function HorsesClient({ students }: { students: HorseAssignmentRow[] }) {
  const [viewMode, setViewMode] = useState<ViewMode>("assignments");
  const [rows, setRows] = useState(students);
  const [groupFilter, setGroupFilter] = useState("all");
  const [nameQuery, setNameQuery] = useState("");
  const [horseQuery, setHorseQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<HorseTypeFilter>("all");

  const [modalStudent, setModalStudent] = useState<HorseAssignmentRow | null>(null);
  const [hasPrivateHorse, setHasPrivateHorse] = useState(false);
  const [privateHorseName, setPrivateHorseName] = useState("");
  const [assignedHorseName, setAssignedHorseName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const groups = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.groupName).filter((g): g is string => Boolean(g)))).sort(),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const nameQ = nameQuery.trim().toLowerCase();
    const horseQ = horseQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (groupFilter !== "all" && r.groupName !== groupFilter) return false;
      if (nameQ && !r.fullName.toLowerCase().includes(nameQ)) return false;
      const info = getHorseDisplayInfo(r);
      if (typeFilter !== "all" && info.badgeType !== typeFilter) return false;
      if (horseQ && !(info.horseName ?? "").toLowerCase().includes(horseQ)) return false;
      return true;
    });
  }, [rows, groupFilter, nameQuery, horseQuery, typeFilter]);

  function openModal(student: HorseAssignmentRow) {
    setError(null);
    setModalStudent(student);
    setHasPrivateHorse(student.hasPrivateHorse);
    setPrivateHorseName(student.privateHorseName ?? "");
    setAssignedHorseName(student.assignedHorseName ?? "");
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modalStudent) return;
    setError(null);
    const studentId = modalStudent.id;
    const data = {
      hasPrivateHorse,
      privateHorseName: hasPrivateHorse ? privateHorseName : null,
      assignedHorseName: !hasPrivateHorse ? assignedHorseName : null,
    };
    startTransition(async () => {
      const result = await updateStudentHorseInfo(studentId, data);
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      setRows((prev) => prev.map((r) => (r.id === studentId ? { ...r, ...data } : r)));
      setModalStudent(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setViewMode("assignments")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            viewMode === "assignments"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          שיוך סוסים
        </button>
        <button
          type="button"
          onClick={() => setViewMode("feeding")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            viewMode === "feeding"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          האכלות
        </button>
      </div>

      {viewMode === "feeding" ? (
        <HorseFeedingSection
          canEdit
          fetchOverview={getHorseFeedingOverviewForAdmin}
          onSave={upsertHorseFeedingMealsAsAdmin}
        />
      ) : (
        <>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap gap-2">
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="all">כל הקבוצות</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                קבוצה {g}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as HorseTypeFilter)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            {(Object.keys(HORSE_TYPE_LABELS) as HorseTypeFilter[]).map((key) => (
              <option key={key} value={key}>
                {HORSE_TYPE_LABELS[key]}
              </option>
            ))}
          </select>
          <input
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="חיפוש לפי שם חניך/ה..."
            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm"
          />
          <input
            value={horseQuery}
            onChange={(e) => setHorseQuery(e.target.value)}
            placeholder="חיפוש לפי שם סוס..."
            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-right font-medium">שם מלא</th>
              <th className="px-4 py-3 text-right font-medium">קבוצה</th>
              <th className="px-4 py-3 text-right font-medium">מס קבוצה</th>
              <th className="px-4 py-3 text-right font-medium">סוג סוס</th>
              <th className="px-4 py-3 text-right font-medium">שם סוס</th>
              <th className="px-4 py-3 text-right font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((student) => {
              const info = getHorseDisplayInfo(student);
              return (
                <tr key={student.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-card-foreground">{student.fullName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{student.groupName ?? "-"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {student.subgroupNumber ?? "-"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass(info.badgeType)}`}
                    >
                      {info.badgeLabel}
                    </span>
                  </td>
                  <td
                    className={`px-4 py-3 ${info.horseName ? "text-muted-foreground" : "italic text-muted-foreground/70"}`}
                  >
                    {info.horseNameDisplay}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1"
                      onClick={() => openModal(student)}
                    >
                      עריכה
                    </Button>
                  </td>
                </tr>
              );
            })}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  אין חניכים התואמים את הסינון
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalStudent !== null}
        title={modalStudent ? `עריכת סוס - ${modalStudent.fullName}` : ""}
        onClose={() => setModalStudent(null)}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="hasPrivateHorse"
                checked={!hasPrivateHorse}
                onChange={() => setHasPrivateHorse(false)}
              />
              סוס קורס
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="hasPrivateHorse"
                checked={hasPrivateHorse}
                onChange={() => setHasPrivateHorse(true)}
              />
              סוס פרטי
            </label>
          </div>

          {hasPrivateHorse ? (
            <label className="flex flex-col gap-1 text-sm">
              שם הסוס הפרטי
              <input
                value={privateHorseName}
                onChange={(e) => setPrivateHorseName(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              שם סוס הקורס המשובץ
              <input
                value={assignedHorseName}
                onChange={(e) => setAssignedHorseName(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalStudent(null)}>
              ביטול
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "שומר..." : "שמירה"}
            </Button>
          </div>
        </form>
      </Modal>
        </>
      )}
    </div>
  );
}
