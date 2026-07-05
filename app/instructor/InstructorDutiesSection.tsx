"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getDutyAssignmentsForInstructor,
  type InstructorDutyRow,
} from "@/lib/actions/instructor-schedule";
import { getNoDutyStatusForRange } from "@/lib/actions/no-duty-dates";

interface StudentOption {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

interface DutyTypeOption {
  id: string;
  name: string;
}

export function InstructorDutiesSection({
  weeklyScheduleId,
  dayFilter,
  students,
  dutyTypes,
}: {
  weeklyScheduleId: string | null;
  dayFilter: string | "all";
  students: StudentOption[];
  dutyTypes: DutyTypeOption[];
}) {
  const [studentFilter, setStudentFilter] = useState("");
  const [dutyTypeFilter, setDutyTypeFilter] = useState("");
  const [rows, setRows] = useState<InstructorDutyRow[] | null>(null);
  // Only meaningful for a specific selected day (dayFilter !== "all") - the
  // whole-week view keeps its existing behavior for Stage A (see
  // InstructorDutiesSection's known limitation, documented where it's used).
  const [isNoDutyDay, setIsNoDutyDay] = useState(false);

  useEffect(() => {
    // A specific day is self-sufficient (start/end date is all the query
    // needs); only "the whole week" requires a resolved weeklyScheduleId.
    if (!weeklyScheduleId && dayFilter === "all") return;
    let cancelled = false;
    // Reset to the loading state on every filter change so a slow or failed
    // request never leaves the previous (unfiltered) rows frozen on screen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(null);
    setIsNoDutyDay(false);
    const filters =
      dayFilter === "all"
        ? { weeklyScheduleId: weeklyScheduleId! }
        : { startDateKey: dayFilter, endDateKey: dayFilter };
    Promise.all([
      getDutyAssignmentsForInstructor({
        ...filters,
        studentId: studentFilter || undefined,
        dutyTypeId: dutyTypeFilter || undefined,
      }),
      dayFilter === "all" ? Promise.resolve(null) : getNoDutyStatusForRange(dayFilter, dayFilter),
    ])
      .then(([r, noDutyStatus]) => {
        if (cancelled) return;
        setRows(r);
        setIsNoDutyDay(noDutyStatus?.[0]?.isNoDuty ?? false);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [weeklyScheduleId, dayFilter, studentFilter, dutyTypeFilter]);

  const groupedByDay = useMemo(() => {
    if (!rows) return [];
    const map = new Map<string, InstructorDutyRow[]>();
    for (const row of rows) {
      if (!map.has(row.dateKey)) map.set(row.dateKey, []);
      map.get(row.dateKey)!.push(row);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-4 text-xl font-bold text-card-foreground">תורנויות</h2>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          תלמיד/ה
          <select
            value={studentFilter}
            onChange={(e) => setStudentFilter(e.target.value)}
            className="rounded-xl border border-border px-3 py-2.5 text-base"
          >
            <option value="">כל התלמידים</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          סוג תורנות
          <select
            value={dutyTypeFilter}
            onChange={(e) => setDutyTypeFilter(e.target.value)}
            className="rounded-xl border border-border px-3 py-2.5 text-base"
          >
            <option value="">כל הסוגים</option>
            {dutyTypes.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!weeklyScheduleId && dayFilter === "all" ? (
        <p className="text-base text-muted-foreground">בחרו שבוע כדי לצפות בתורנויות</p>
      ) : !rows ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : dayFilter !== "all" && isNoDutyDay ? (
        // Overrides even if rows exist for this specific day - the day is
        // marked no-duty, so nothing is shown as "the day's duty" regardless
        // (assignments, if any, are preserved in the DB, just not displayed
        // here). Stage A scope: only applies when a single day is selected,
        // not the whole-week ("all") view.
        <p className="text-base text-muted-foreground">אין תורנויות ביום זה</p>
      ) : groupedByDay.length === 0 ? (
        <p className="text-base text-muted-foreground">אין תורנויות התואמות את הסינון</p>
      ) : (
        <div className="flex flex-col gap-5">
          {groupedByDay.map(([dk, dayRows]) => (
            <div key={dk} className="flex flex-col gap-2">
              <div className="rounded-lg bg-secondary px-3 py-2 text-base font-bold text-secondary-foreground">
                {dayRows[0].dayLabel} · {dayRows[0].dateLabel}
              </div>
              <div className="flex flex-col gap-3">
                {dayRows.map((row) => (
                  <div key={row.id} className="rounded-xl border-2 border-border p-4">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-lg font-bold text-card-foreground">{row.studentName}</p>
                      {!row.isPublished && (
                        <span className="rounded-full bg-warning-muted px-3 py-1 text-sm font-medium text-warning">
                          טיוטה
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {[
                        row.studentGroupName ? `קבוצה ${row.studentGroupName}` : null,
                        row.studentSubgroupNumber ? `תת-קבוצה ${row.studentSubgroupNumber}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="mt-2 text-base font-semibold text-card-foreground">
                      {row.dutyTypeName}
                    </p>
                    <span
                      className={`mt-2 inline-block rounded-full px-3 py-1 text-sm font-medium ${
                        row.isCompleted
                          ? "bg-success-muted text-success"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {row.isCompleted ? "בוצע" : "טרם בוצע"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
