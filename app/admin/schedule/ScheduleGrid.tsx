"use client";

import { useMemo } from "react";
import { enumerateDateKeys, formatHebrewDate, formatHebrewWeekday, parseDateKey } from "@/lib/dates";
import { buildDutyColorMap, getNoDutyColor } from "@/lib/duty-colors";
import { computeCoverageByDate } from "@/lib/schedule-coverage";

export interface GridStudent {
  id: string;
  fullName: string;
  lastName?: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

export interface GridAssignment {
  id: string;
  dateKey: string;
  studentId: string;
  dutyTypeId: string;
  dutyTypeName: string;
  isManual: boolean;
  isPublished: boolean;
  isCompleted: boolean;
}

export function ScheduleGrid({
  students,
  assignments,
  dutyTypeIds,
  startDate,
  endDate,
  noDutyDateKeys,
  filterStudentId,
  filterDutyTypeId,
  searchQuery,
  onCellClick,
}: {
  students: GridStudent[];
  assignments: GridAssignment[];
  dutyTypeIds: string[];
  startDate: Date | null;
  endDate: Date | null;
  noDutyDateKeys: Set<string>;
  filterStudentId: string;
  filterDutyTypeId: string;
  searchQuery?: string;
  onCellClick?: (args: { studentId: string; dateKey: string; assignment: GridAssignment | null }) => void;
}) {
  const dateKeys = useMemo(
    () => (startDate && endDate ? enumerateDateKeys(startDate, endDate) : []),
    [startDate, endDate]
  );

  const colorMap = useMemo(() => buildDutyColorMap(dutyTypeIds), [dutyTypeIds]);

  const cellMap = useMemo(() => {
    const map = new Map<string, Map<string, GridAssignment>>();
    for (const a of assignments) {
      if (!map.has(a.studentId)) map.set(a.studentId, new Map());
      map.get(a.studentId)!.set(a.dateKey, a);
    }
    return map;
  }, [assignments]);

  // Coverage always reflects the full active roster, independent of the
  // student filter below - "is everyone covered" shouldn't change just
  // because the manager is looking at one student's row.
  const coverageByDate = useMemo(
    () => computeCoverageByDate(dateKeys, students.length, cellMap, noDutyDateKeys),
    [dateKeys, students.length, cellMap, noDutyDateKeys]
  );

  // Same order as the Excel export: group -> subgroup -> last name (falls
  // back to full name if last name isn't available on this prop shape).
  const sortedStudents = useMemo(() => {
    return [...students].sort((a, b) => {
      const groupCompare = (a.groupName ?? "").localeCompare(b.groupName ?? "");
      if (groupCompare !== 0) return groupCompare;
      const subgroupCompare = (a.subgroupNumber ?? 0) - (b.subgroupNumber ?? 0);
      if (subgroupCompare !== 0) return subgroupCompare;
      return (a.lastName ?? a.fullName).localeCompare(b.lastName ?? b.fullName);
    });
  }, [students]);

  const normalizedSearchQuery = (searchQuery ?? "").trim().toLowerCase();

  const rows = useMemo(() => {
    let base = filterStudentId
      ? sortedStudents.filter((s) => s.id === filterStudentId)
      : sortedStudents;

    if (normalizedSearchQuery) {
      base = base.filter((s) => {
        if (s.fullName.toLowerCase().includes(normalizedSearchQuery)) return true;
        if (s.groupName?.toLowerCase().includes(normalizedSearchQuery)) return true;
        if (s.subgroupNumber != null && String(s.subgroupNumber).includes(normalizedSearchQuery)) {
          return true;
        }
        // Also keep the row if any of this student's visible assignments'
        // duty type matches - a text search should find "who has X duty"
        // just as well as "who is student X".
        const studentAssignments = cellMap.get(s.id);
        if (studentAssignments) {
          for (const a of studentAssignments.values()) {
            if (a.dutyTypeName.toLowerCase().includes(normalizedSearchQuery)) return true;
          }
        }
        return false;
      });
    }

    return base;
  }, [sortedStudents, filterStudentId, normalizedSearchQuery, cellMap]);

  if (dateKeys.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        בחרו טווח תאריכים תקין (בפאנל &quot;ייצור ופרסום שיבוצים&quot; למעלה) כדי להציג את הרשת
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky right-0 z-10 min-w-[170px] border-b border-border bg-muted px-3 py-2 text-right font-medium text-muted-foreground">
              שם מלא
            </th>
            <th className="min-w-[64px] border-b border-border bg-muted px-2 py-2 text-center font-medium text-muted-foreground">
              קבוצה
            </th>
            <th className="min-w-[80px] border-b border-border bg-muted px-2 py-2 text-center font-medium text-muted-foreground">
              תת-קבוצה
            </th>
            {dateKeys.map((dk) => (
              <th
                key={dk}
                className="min-w-[140px] border-b border-border bg-muted px-2 py-2 text-center font-medium text-muted-foreground"
              >
                {formatHebrewWeekday(parseDateKey(dk))}
                <br />
                {formatHebrewDate(parseDateKey(dk))}
              </th>
            ))}
          </tr>
          <tr>
            <th className="sticky right-0 z-10 border-b-2 border-border bg-muted px-3 py-1.5 text-right text-xs font-semibold text-muted-foreground">
              כיסוי (משובצים / פעילים)
            </th>
            <th className="border-b-2 border-border bg-muted" colSpan={2} />
            {dateKeys.map((dk) => {
              const coverage = coverageByDate.get(dk);
              if (!coverage) return <th key={dk} className="border-b-2 border-border bg-muted" />;
              return (
                <th
                  key={dk}
                  className={`border-b-2 border-border px-2 py-1.5 text-center text-xs font-semibold ${
                    coverage.isShort ? "bg-warning-muted text-warning" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {coverage.isNoDuty
                    ? "אין תורנויות"
                    : `${coverage.assignedCount}/${coverage.activeStudentCount}`}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((student) => (
            <tr key={student.id}>
              <td className="sticky right-0 z-10 border-b border-border bg-card px-3 py-2 font-medium text-card-foreground">
                {student.fullName}
              </td>
              <td className="border-b border-border px-2 py-2 text-center text-card-foreground">
                {student.groupName ?? "–"}
              </td>
              <td className="border-b border-border px-2 py-2 text-center text-card-foreground">
                {student.subgroupNumber ?? "–"}
              </td>
              {dateKeys.map((dk) => {
                const assignment = cellMap.get(student.id)?.get(dk);
                const isNoDuty = noDutyDateKeys.has(dk);
                const matchesDutyFilter =
                  !filterDutyTypeId || assignment?.dutyTypeId === filterDutyTypeId;

                const handleClick = onCellClick
                  ? () => onCellClick({ studentId: student.id, dateKey: dk, assignment: assignment ?? null })
                  : undefined;

                if (!assignment || !matchesDutyFilter) {
                  // A genuine coverage gap: an active (non-no-duty) day with
                  // no assignment for this student, and no duty-type filter
                  // narrowing the view (with a filter active, "blank" just
                  // means "not this duty type", not a real gap).
                  const isGenuineGap = !assignment && !isNoDuty && !filterDutyTypeId;
                  return (
                    <td
                      key={dk}
                      onClick={handleClick}
                      className={`border-b border-border px-2 py-2 text-center text-xs text-muted-foreground ${
                        isGenuineGap ? "bg-warning-muted" : ""
                      } ${onCellClick ? "cursor-pointer hover:ring-1 hover:ring-inset hover:ring-primary" : ""}`}
                      style={isNoDuty ? { backgroundColor: getNoDutyColor().background } : undefined}
                    >
                      {isNoDuty ? "אין תורנויות" : ""}
                    </td>
                  );
                }

                const color = colorMap.get(assignment.dutyTypeId);
                return (
                  <td
                    key={dk}
                    onClick={handleClick}
                    className={`border-b px-2 py-2 text-center align-top text-xs ${
                      onCellClick ? "cursor-pointer hover:ring-1 hover:ring-inset hover:ring-primary" : ""
                    }`}
                    style={
                      color
                        ? { backgroundColor: color.background, borderColor: color.border }
                        : undefined
                    }
                  >
                    <div className="font-medium text-card-foreground">{assignment.dutyTypeName}</div>
                    {(!assignment.isPublished || assignment.isCompleted) && (
                      <div className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                        {!assignment.isPublished && <span>טיוטה</span>}
                        {assignment.isCompleted && <span>✓ בוצע</span>}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
