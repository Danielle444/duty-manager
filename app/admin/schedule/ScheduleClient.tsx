"use client";

import { Fragment, FormEvent, useMemo, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import {
  createManualAssignment,
  deleteAssignment,
  reassignDuty,
  runGenerateSchedule,
  setPublishStatus,
} from "@/lib/actions/schedule";
import {
  dateKey,
  enumerateDateKeys,
  formatHebrewDate,
  formatHebrewWeekday,
  parseDateKey,
  weekKey,
} from "@/lib/dates";
import { subgroupKey } from "@/lib/subgroup-identity";
import type { GenerateMode } from "@/lib/scheduler";
import { ScheduleGrid } from "@/app/admin/schedule/ScheduleGrid";
import { ScheduleDiagnosticsPanel } from "@/app/admin/schedule/ScheduleDiagnosticsPanel";
import { ScheduleFairnessPanel } from "@/app/admin/schedule/ScheduleFairnessPanel";
import { ScheduleCellEditor } from "@/app/admin/schedule/ScheduleCellEditor";

interface AssignmentRow {
  id: string;
  dateKey: string;
  studentId: string;
  studentName: string;
  dutyTypeId: string;
  dutyTypeName: string;
  isManual: boolean;
  isPublished: boolean;
  isCompleted: boolean;
}

interface Option {
  id: string;
  fullName?: string;
  name?: string;
  lastName?: string;
  groupName?: string | null;
  subgroupNumber?: number | null;
  allocationMode?: string;
}

interface SelectedCellAssignment {
  id: string;
  dutyTypeId: string;
  dutyTypeName: string;
  isManual: boolean;
  isPublished: boolean;
  isCompleted: boolean;
}

interface SelectedCell {
  studentId: string;
  dateKey: string;
  assignment: SelectedCellAssignment | null;
}

type ViewMode = "list" | "grid";

interface WeeklyScheduleOption {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

interface CourseRange {
  startDate: string;
  endDate: string;
}

type RangeSource = "course" | "week" | "weeklySchedule" | "custom";

const MODE_LABELS: Record<GenerateMode, string> = {
  fillMissing: "השלמת חוסרים בלבד",
  regeneratePreserveManual: "ייצור מחדש, שמירה על שיבוצים ידניים",
  clearAndRegenerate: "מחיקה וייצור מחדש מלא",
};

export function ScheduleClient({
  assignments,
  students,
  dutyTypes,
  courseRange,
  weeklySchedules,
  noDutyDateKeys,
  blockedGroupsByDate,
}: {
  assignments: AssignmentRow[];
  students: Option[];
  dutyTypes: Option[];
  courseRange: CourseRange | null;
  weeklySchedules: WeeklyScheduleOption[];
  noDutyDateKeys: string[];
  blockedGroupsByDate: Record<string, Record<string, string[]>>;
}) {
  const [isPending, startTransition] = useTransition();
  const [view, setView] = useState<ViewMode>("grid");
  const [filterDate, setFilterDate] = useState("");
  const [filterStudent, setFilterStudent] = useState("");
  const [filterDuty, setFilterDuty] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [diagnosticsRefreshKey, setDiagnosticsRefreshKey] = useState(0);

  const [rangeSource, setRangeSource] = useState<RangeSource>("weeklySchedule");
  const [selectedWeekKey, setSelectedWeekKey] = useState("");
  const [selectedWeeklyScheduleId, setSelectedWeeklyScheduleId] = useState("");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [mode, setMode] = useState<GenerateMode>("regeneratePreserveManual");
  const [genMessage, setGenMessage] = useState<string | null>(null);

  const weekOptions = useMemo(() => {
    if (!courseRange) return [];
    const keys = enumerateDateKeys(parseDateKey(courseRange.startDate), parseDateKey(courseRange.endDate));
    const byWeek = new Map<string, string[]>();
    for (const dk of keys) {
      const wk = weekKey(parseDateKey(dk));
      if (!byWeek.has(wk)) byWeek.set(wk, []);
      byWeek.get(wk)!.push(dk);
    }
    return Array.from(byWeek.entries()).map(([wk, dks]) => ({
      weekKey: wk,
      startDate: dks[0],
      endDate: dks[dks.length - 1],
    }));
  }, [courseRange]);

  function resolveRange(): { startDate: Date; endDate: Date } | null {
    if (rangeSource === "course" && courseRange) {
      return { startDate: parseDateKey(courseRange.startDate), endDate: parseDateKey(courseRange.endDate) };
    }
    if (rangeSource === "week") {
      const week = weekOptions.find((w) => w.weekKey === selectedWeekKey);
      if (!week) return null;
      return { startDate: parseDateKey(week.startDate), endDate: parseDateKey(week.endDate) };
    }
    if (rangeSource === "weeklySchedule") {
      const ws = weeklySchedules.find((w) => w.id === selectedWeeklyScheduleId);
      if (!ws) return null;
      return { startDate: parseDateKey(ws.startDate), endDate: parseDateKey(ws.endDate) };
    }
    if (rangeSource === "custom") {
      if (!customStart || !customEnd) return null;
      return { startDate: parseDateKey(customStart), endDate: parseDateKey(customEnd) };
    }
    return null;
  }

  function buildExportHref(): string | null {
    if (rangeSource === "weeklySchedule") {
      if (!selectedWeeklyScheduleId) return null;
      return `/api/admin/schedule/export?weeklyScheduleId=${selectedWeeklyScheduleId}`;
    }
    const range = resolveRange();
    if (!range) return null;
    const title =
      rangeSource === "course"
        ? "כל טווח הקורס"
        : rangeSource === "week"
          ? "שבוע נבחר"
          : "טווח מותאם";
    return `/api/admin/schedule/export?startDate=${dateKey(range.startDate)}&endDate=${dateKey(
      range.endDate
    )}&title=${encodeURIComponent(title)}`;
  }

  function handleGenerate() {
    const range = resolveRange();
    if (!range) {
      setGenMessage("יש לבחור טווח תאריכים תקין");
      return;
    }
    setGenMessage(null);
    startTransition(async () => {
      const result = await runGenerateSchedule({ ...range, mode });
      if (!result.success) {
        setGenMessage(result.error ?? "אירעה שגיאה");
        return;
      }
      setGenMessage(`נוצרו ${result.assignedCount} שיבוצים (טיוטה) עבור ${result.daysProcessed} ימים`);
    });
  }

  function handlePublish(isPublished: boolean) {
    const range = resolveRange();
    if (!range) {
      setGenMessage("יש לבחור טווח תאריכים תקין");
      return;
    }
    setGenMessage(null);
    startTransition(async () => {
      await setPublishStatus(range.startDate, range.endDate, isPublished);
      setGenMessage(isPublished ? "הטווח פורסם" : "פרסום הטווח בוטל");
    });
  }

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  // Free-text search on top of the exact-match dropdown filters above -
  // matches student name, duty type name, group, or subgroup number. Applied
  // in both list and grid view; never replaces the dropdowns.
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  function matchesSearchQuery(a: { studentId: string; studentName: string; dutyTypeName: string }) {
    if (!normalizedSearchQuery) return true;
    if (a.studentName.toLowerCase().includes(normalizedSearchQuery)) return true;
    if (a.dutyTypeName.toLowerCase().includes(normalizedSearchQuery)) return true;
    const student = studentById.get(a.studentId);
    if (student?.groupName?.toLowerCase().includes(normalizedSearchQuery)) return true;
    if (student?.subgroupNumber != null && String(student.subgroupNumber).includes(normalizedSearchQuery)) {
      return true;
    }
    return false;
  }

  const filtered = useMemo(() => {
    return assignments.filter((a) => {
      if (filterDate && a.dateKey !== filterDate) return false;
      if (filterStudent && a.studentId !== filterStudent) return false;
      if (filterDuty && a.dutyTypeId !== filterDuty) return false;
      if (!matchesSearchQuery(a)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, filterDate, filterStudent, filterDuty, normalizedSearchQuery, studentById]);

  const availableDates = useMemo(
    () => Array.from(new Set(assignments.map((a) => a.dateKey))).sort(),
    [assignments]
  );

  const noDutyDateSet = useMemo(() => new Set(noDutyDateKeys), [noDutyDateKeys]);

  // Which duty types are constraint-blocked or already taken by another
  // student in the same subgroup, for whichever cell the editor is
  // currently open on - both are advisory here (the server action
  // re-validates authoritatively on save).
  const cellEditorContext = useMemo(() => {
    if (!selectedCell) return null;
    const student = studentById.get(selectedCell.studentId);
    if (!student) return null;

    const blockedDutyTypeIds = new Set<string>();
    if (student.groupName) {
      const blockedForDate = blockedGroupsByDate[selectedCell.dateKey] ?? {};
      for (const dutyType of dutyTypes) {
        const blockedGroups = blockedForDate[dutyType.id] ?? [];
        if (blockedGroups.includes(student.groupName)) blockedDutyTypeIds.add(dutyType.id);
      }
    }

    const subgroupConflictDutyTypeIds = new Set<string>();
    if (student.subgroupNumber != null) {
      const key = subgroupKey(student.groupName ?? null, student.subgroupNumber);
      for (const a of assignments) {
        if (a.dateKey !== selectedCell.dateKey) continue;
        if (a.studentId === selectedCell.studentId) continue;
        const dutyType = dutyTypes.find((d) => d.id === a.dutyTypeId);
        if (dutyType?.allocationMode !== "ONE_PER_SUBGROUP") continue;
        const otherStudent = studentById.get(a.studentId);
        if (!otherStudent || otherStudent.subgroupNumber == null) continue;
        const otherKey = subgroupKey(otherStudent.groupName ?? null, otherStudent.subgroupNumber);
        if (otherKey === key) subgroupConflictDutyTypeIds.add(a.dutyTypeId);
      }
    }

    return { student, blockedDutyTypeIds, subgroupConflictDutyTypeIds };
  }, [selectedCell, studentById, dutyTypes, assignments, blockedGroupsByDate]);

  function handleCellSaved() {
    setSelectedCell(null);
    setDiagnosticsRefreshKey((v) => v + 1);
  }

  function handleReassign(assignmentId: string, newStudentId: string) {
    setError(null);
    startTransition(async () => {
      const result = await reassignDuty(assignmentId, newStudentId);
      if (!result.success) setError(result.error ?? "אירעה שגיאה");
    });
  }

  function handleDelete(assignmentId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteAssignment(assignmentId);
      if (!result.success) setError(result.error ?? "אירעה שגיאה");
    });
  }

  function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const dk = String(formData.get("date"));
    const dutyTypeId = String(formData.get("dutyTypeId"));
    const studentId = String(formData.get("studentId"));
    startTransition(async () => {
      const result = await createManualAssignment(dk, dutyTypeId, studentId);
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      setShowAddForm(false);
    });
  }

  const exportHref = buildExportHref();
  const gridRange = resolveRange();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setView("list")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            view === "list" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          תצוגת רשימה
        </button>
        <button
          type="button"
          onClick={() => setView("grid")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            view === "grid" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          תצוגת רשת
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-medium text-card-foreground">ייצור ופרסום שיבוצים</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            טווח
            <select
              value={rangeSource}
              onChange={(e) => setRangeSource(e.target.value as RangeSource)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            >
              <option value="weeklySchedule">לפי לו&quot;ז שבועי שהועלה</option>
              <option value="week">שבוע ספציפי</option>
              <option value="course">כל טווח הקורס</option>
              <option value="custom">טווח תאריכים מותאם</option>
            </select>
          </label>

          {rangeSource === "weeklySchedule" && (
            <label className="flex flex-col gap-1 text-sm">
              שבוע
              <select
                value={selectedWeeklyScheduleId}
                onChange={(e) => setSelectedWeeklyScheduleId(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              >
                <option value="">בחרו שבוע</option>
                {weeklySchedules.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {rangeSource === "week" && (
            <label className="flex flex-col gap-1 text-sm">
              שבוע
              <select
                value={selectedWeekKey}
                onChange={(e) => setSelectedWeekKey(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              >
                <option value="">בחרו שבוע</option>
                {weekOptions.map((w) => (
                  <option key={w.weekKey} value={w.weekKey}>
                    {formatHebrewDate(parseDateKey(w.startDate))} -{" "}
                    {formatHebrewDate(parseDateKey(w.endDate))}
                  </option>
                ))}
              </select>
            </label>
          )}

          {rangeSource === "custom" && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                מתאריך
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                עד תאריך
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                />
              </label>
            </>
          )}

          <label className="flex flex-col gap-1 text-sm">
            אופן ייצור
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as GenerateMode)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            >
              {Object.entries(MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <Button disabled={isPending} onClick={handleGenerate}>
            ייצור שיבוץ
          </Button>
          <Button variant="secondary" disabled={isPending} onClick={() => handlePublish(true)}>
            פרסום טווח זה
          </Button>
          <Button variant="ghost" disabled={isPending} onClick={() => handlePublish(false)}>
            ביטול פרסום
          </Button>
          {exportHref ? (
            <a
              href={exportHref}
              className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:opacity-80"
            >
              ייצוא לאקסל
            </a>
          ) : (
            <span className="text-sm text-muted-foreground">בחרו טווח כדי לייצא</span>
          )}
        </div>
        {genMessage && <p className="text-sm text-muted-foreground">{genMessage}</p>}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <label className="flex flex-col gap-1 text-sm">
          חיפוש חופשי
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="שם תלמיד/ה, סוג תורנות, קבוצה..."
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          תאריך
          <select
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">הכל</option>
            {availableDates.map((dk) => (
              <option key={dk} value={dk}>
                {formatHebrewDate(parseDateKey(dk))}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          תלמיד/ה
          <select
            value={filterStudent}
            onChange={(e) => setFilterStudent(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">הכל</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          סוג תורנות
          <select
            value={filterDuty}
            onChange={(e) => setFilterDuty(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">הכל</option>
            {dutyTypes.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="secondary" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "סגירה" : "+ שיבוץ ידני"}
        </Button>
        {filterDate && (
          <a
            href={`/api/admin/schedule/export?scope=day&date=${filterDate}`}
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:opacity-80"
          >
            ייצוא היום הנבחר
          </a>
        )}
      </div>

      {showAddForm && (
        <form
          onSubmit={handleAdd}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4"
        >
          <label className="flex flex-col gap-1 text-sm">
            תאריך
            <input
              type="date"
              name="date"
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            סוג תורנות
            <select
              name="dutyTypeId"
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            >
              {dutyTypes.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            תלמיד/ה
            <select
              name="studentId"
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            >
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={isPending}>
            הוספה
          </Button>
        </form>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      {view === "grid" ? (
        <>
        <ScheduleDiagnosticsPanel
          startDate={gridRange?.startDate ?? null}
          endDate={gridRange?.endDate ?? null}
          refreshKey={diagnosticsRefreshKey}
        />
        <ScheduleFairnessPanel
          startDate={gridRange?.startDate ?? null}
          endDate={gridRange?.endDate ?? null}
          refreshKey={diagnosticsRefreshKey}
        />
        <ScheduleGrid
          students={students.map((s) => ({
            id: s.id,
            fullName: s.fullName ?? "",
            lastName: s.lastName,
            groupName: s.groupName ?? null,
            subgroupNumber: s.subgroupNumber ?? null,
          }))}
          assignments={assignments}
          dutyTypeIds={dutyTypes.map((d) => d.id)}
          startDate={gridRange?.startDate ?? null}
          endDate={gridRange?.endDate ?? null}
          noDutyDateKeys={noDutyDateSet}
          filterStudentId={filterStudent}
          filterDutyTypeId={filterDuty}
          searchQuery={searchQuery}
          onCellClick={(args) => setSelectedCell(args)}
        />
        {selectedCell && cellEditorContext && (
          <ScheduleCellEditor
            key={`${selectedCell.studentId}-${selectedCell.dateKey}`}
            studentId={selectedCell.studentId}
            studentName={cellEditorContext.student.fullName ?? ""}
            groupName={cellEditorContext.student.groupName ?? null}
            subgroupNumber={cellEditorContext.student.subgroupNumber ?? null}
            dateKey={selectedCell.dateKey}
            existingAssignment={
              selectedCell.assignment
                ? {
                    id: selectedCell.assignment.id,
                    dutyTypeId: selectedCell.assignment.dutyTypeId,
                    dutyTypeName: selectedCell.assignment.dutyTypeName,
                    isManual: selectedCell.assignment.isManual,
                    isPublished: selectedCell.assignment.isPublished,
                    isCompleted: selectedCell.assignment.isCompleted,
                  }
                : null
            }
            dutyTypes={dutyTypes.map((d) => ({
              id: d.id,
              name: d.name ?? "",
              allocationMode: d.allocationMode ?? "FIXED_COUNT",
            }))}
            blockedDutyTypeIds={cellEditorContext.blockedDutyTypeIds}
            subgroupConflictDutyTypeIds={cellEditorContext.subgroupConflictDutyTypeIds}
            isNoDutyDate={noDutyDateSet.has(selectedCell.dateKey)}
            onClose={() => setSelectedCell(null)}
            onSaved={handleCellSaved}
          />
        )}
        </>
      ) : (
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b border-border bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-right font-medium">יום</th>
              <th className="px-4 py-3 text-right font-medium">סוג תורנות</th>
              <th className="px-4 py-3 text-right font-medium">תלמיד/ה</th>
              <th className="px-4 py-3 text-right font-medium">מקור</th>
              <th className="px-4 py-3 text-right font-medium">פרסום</th>
              <th className="px-4 py-3 text-right font-medium">ביצוע</th>
              <th className="px-4 py-3 text-right font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a, i) => {
              const isNewDay = i === 0 || filtered[i - 1].dateKey !== a.dateKey;
              return (
                <Fragment key={a.id}>
                  {isNewDay && (
                    <tr key={`${a.dateKey}-header`} className="bg-secondary">
                      <td
                        colSpan={7}
                        className="px-4 py-2 text-sm font-bold text-secondary-foreground"
                      >
                        {formatHebrewWeekday(parseDateKey(a.dateKey))} ·{" "}
                        {formatHebrewDate(parseDateKey(a.dateKey))}
                      </td>
                    </tr>
                  )}
                  <tr key={a.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-card-foreground">
                      {formatHebrewWeekday(parseDateKey(a.dateKey))}
                    </td>
                    <td className="px-4 py-3 font-medium text-card-foreground">
                      {a.dutyTypeName}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        defaultValue={a.studentId}
                        disabled={isPending}
                        onChange={(e) => handleReassign(a.id, e.target.value)}
                        className="rounded-lg border border-border px-2 py-1.5 text-base"
                      >
                        {students.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.fullName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          a.isManual
                            ? "bg-warning-muted text-warning"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {a.isManual ? "ידני" : "אוטומטי"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          a.isPublished
                            ? "bg-success-muted text-success"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {a.isPublished ? "פורסם" : "טיוטה"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          a.isCompleted
                            ? "bg-success-muted text-success"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {a.isCompleted ? "בוצע" : "טרם בוצע"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="danger"
                        className="!px-2 !py-1"
                        disabled={isPending}
                        onClick={() => handleDelete(a.id)}
                      >
                        מחיקה
                      </Button>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  אין שיבוצים התואמים את הסינון
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
