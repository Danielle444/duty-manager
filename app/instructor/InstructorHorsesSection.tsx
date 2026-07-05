"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import {
  getHorseAssignments,
  updateStudentHorseInfoAsInstructor,
  type HorseAssignmentRow,
} from "@/lib/actions/horses";
import { getHorseDisplayInfo, type HorseBadgeType } from "@/lib/horse-info";

type HorseTypeFilter = "all" | HorseBadgeType;

const HORSE_TYPE_LABELS: Record<HorseTypeFilter, string> = {
  all: "הכל",
  private: "סוס פרטי",
  assigned: "סוס קורס",
  none: "לא שובץ",
};

const NO_GROUP_LABEL = "ללא קבוצה";
const NO_SUBGROUP_LABEL = "ללא תת-קבוצה";

function badgeClass(badgeType: HorseBadgeType): string {
  if (badgeType === "private") return "bg-success-muted text-success";
  if (badgeType === "assigned") return "bg-secondary text-secondary-foreground";
  return "bg-muted text-muted-foreground";
}

// Only groups "א"/"ב" get a dedicated color - any other group value (or no
// group) falls back to the neutral card styling already used everywhere else.
function groupColorClasses(groupName: string | null): {
  section: string;
  header: string;
  subBox: string;
} {
  if (groupName === "א") {
    return {
      section: "border-blue-200 bg-blue-50",
      header: "text-blue-900",
      subBox: "border-blue-200 bg-white",
    };
  }
  if (groupName === "ב") {
    return {
      section: "border-violet-200 bg-violet-50",
      header: "text-violet-900",
      subBox: "border-violet-200 bg-white",
    };
  }
  return {
    section: "border-border bg-muted",
    header: "text-card-foreground",
    subBox: "border-border bg-card",
  };
}

interface SubgroupBucket {
  subgroupNumber: number | null;
  students: HorseAssignmentRow[];
}

interface GroupSection {
  groupName: string | null;
  subgroups: SubgroupBucket[];
}

// Rows arrive from getHorseAssignments already ordered by groupName ->
// subgroupNumber -> lastName, so grouping by simple insertion order here
// preserves that order without needing to re-sort.
function buildSections(rows: HorseAssignmentRow[]): GroupSection[] {
  const sections: GroupSection[] = [];
  const sectionByGroup = new Map<string, GroupSection>();

  for (const row of rows) {
    const groupKey = row.groupName ?? "__none__";
    let section = sectionByGroup.get(groupKey);
    if (!section) {
      section = { groupName: row.groupName, subgroups: [] };
      sectionByGroup.set(groupKey, section);
      sections.push(section);
    }

    const subKey = row.subgroupNumber ?? -1;
    let bucket = section.subgroups.find((b) => (b.subgroupNumber ?? -1) === subKey);
    if (!bucket) {
      bucket = { subgroupNumber: row.subgroupNumber, students: [] };
      section.subgroups.push(bucket);
    }
    bucket.students.push(row);
  }

  return sections;
}

// Stage B: every instructor can see this tab; only instructors whose
// canEditHorseAssignments is true (re-verified server-side on every save,
// never trusted from this prop alone) get edit controls.
export function InstructorHorsesSection({
  instructorId,
  canEdit,
}: {
  instructorId: string;
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<HorseAssignmentRow[] | null>(null);
  const [groupTab, setGroupTab] = useState("all");
  const [nameQuery, setNameQuery] = useState("");
  const [horseQuery, setHorseQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<HorseTypeFilter>("all");

  const [modalStudent, setModalStudent] = useState<HorseAssignmentRow | null>(null);
  const [hasPrivateHorse, setHasPrivateHorse] = useState(false);
  const [privateHorseName, setPrivateHorseName] = useState("");
  const [assignedHorseName, setAssignedHorseName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getHorseAssignments().then((result) => {
      if (!cancelled) setRows(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    if (!rows) return [];
    return Array.from(new Set(rows.map((r) => r.groupName).filter((g): g is string => Boolean(g)))).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const nameQ = nameQuery.trim().toLowerCase();
    const horseQ = horseQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (groupTab !== "all" && (r.groupName ?? "") !== groupTab) return false;
      if (nameQ && !r.fullName.toLowerCase().includes(nameQ)) return false;
      const info = getHorseDisplayInfo(r);
      if (typeFilter !== "all" && info.badgeType !== typeFilter) return false;
      if (horseQ && !(info.horseName ?? "").toLowerCase().includes(horseQ)) return false;
      return true;
    });
  }, [rows, groupTab, nameQuery, horseQuery, typeFilter]);

  const sections = useMemo(() => buildSections(filteredRows), [filteredRows]);

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
      const result = await updateStudentHorseInfoAsInstructor(instructorId, studentId, data);
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      setRows((prev) => (prev ? prev.map((r) => (r.id === studentId ? { ...r, ...data } : r)) : prev));
      setModalStudent(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-lg font-bold text-card-foreground">חלוקה לקבוצות וסוסים</h2>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setGroupTab("all")}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                groupTab === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              כל הקבוצות
            </button>
            {groups.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroupTab(g)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                  groupTab === g
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                קבוצה {g}
              </button>
            ))}
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as HorseTypeFilter)}
            className="rounded-xl border border-border px-3 py-2.5 text-base"
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
            placeholder="חיפוש לפי שם תלמיד/ה..."
            className="rounded-xl border border-border px-3 py-2.5 text-base"
          />
          <input
            value={horseQuery}
            onChange={(e) => setHorseQuery(e.target.value)}
            placeholder="חיפוש לפי שם סוס..."
            className="rounded-xl border border-border px-3 py-2.5 text-base"
          />
        </div>
      </div>

      {rows === null ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : sections.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
          אין תלמידים התואמים את הסינון
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {sections.map((section) => {
            const colors = groupColorClasses(section.groupName);
            const groupLabel = section.groupName ? `קבוצה ${section.groupName}` : NO_GROUP_LABEL;
            return (
              <div
                key={section.groupName ?? "__none__"}
                className={`rounded-2xl border-2 p-4 ${colors.section}`}
              >
                <h3 className={`mb-3 text-base font-bold ${colors.header}`}>{groupLabel}</h3>
                <div className="flex flex-col gap-3">
                  {section.subgroups.map((sub) => {
                    const subLabel =
                      sub.subgroupNumber != null ? `תת-קבוצה ${sub.subgroupNumber}` : NO_SUBGROUP_LABEL;
                    return (
                      <div
                        key={sub.subgroupNumber ?? "__none__"}
                        className={`rounded-xl border p-3 ${colors.subBox}`}
                      >
                        <p className={`mb-2 text-sm font-semibold ${colors.header}`}>
                          {groupLabel} · {subLabel}
                        </p>
                        <div className="flex flex-col gap-2">
                          {sub.students.map((row) => {
                            const info = getHorseDisplayInfo(row);
                            return (
                              <div
                                key={row.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-card px-3 py-2"
                              >
                                <p className="text-base font-bold text-card-foreground">{row.fullName}</p>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${badgeClass(info.badgeType)}`}
                                  >
                                    {info.badgeLabel}
                                  </span>
                                  <span
                                    className={`text-sm font-semibold ${
                                      info.horseName ? "text-card-foreground" : "italic text-muted-foreground"
                                    }`}
                                  >
                                    {info.horseNameDisplay}
                                  </span>
                                  {canEdit && (
                                    <Button
                                      variant="ghost"
                                      className="!px-2 !py-1 !text-xs"
                                      onClick={() => openModal(row)}
                                    >
                                      עריכה
                                    </Button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canEdit && (
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
      )}
    </div>
  );
}
