"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { adminSetCompletion } from "@/lib/actions/completion";
import { formatHebrewDate, formatHebrewDateTime, parseDateKey } from "@/lib/dates";

interface CompletionRow {
  id: string;
  dateKey: string;
  studentName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  dutyTypeName: string;
  isPublished: boolean;
  isCompleted: boolean;
  completedAt: string | null;
}

type SortBy = "name" | "group" | "status";

const SORT_LABELS: Record<SortBy, string> = {
  name: "שם",
  group: "קבוצה",
  status: "סטטוס",
};

export function CompletionClient({
  assignments,
  defaultDateKey,
}: {
  assignments: CompletionRow[];
  defaultDateKey: string;
}) {
  const [isPending, startTransition] = useTransition();
  const availableDates = useMemo(
    () => Array.from(new Set(assignments.map((a) => a.dateKey))).sort(),
    [assignments]
  );
  const [selectedDate, setSelectedDate] = useState(
    availableDates.includes(defaultDateKey) ? defaultDateKey : availableDates[0] ?? ""
  );
  const [nameQuery, setNameQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("name");

  const groups = useMemo(
    () =>
      Array.from(new Set(assignments.map((a) => a.groupName).filter((g): g is string => Boolean(g)))).sort(),
    [assignments]
  );

  const dayAssignments = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    const rows = assignments.filter((a) => {
      if (a.dateKey !== selectedDate) return false;
      if (groupFilter && a.groupName !== groupFilter) return false;
      if (q && !a.studentName.toLowerCase().includes(q)) return false;
      return true;
    });

    const sorted = [...rows];
    if (sortBy === "name") {
      sorted.sort((a, b) => a.studentName.localeCompare(b.studentName));
    } else if (sortBy === "group") {
      sorted.sort((a, b) => {
        const groupCompare = (a.groupName ?? "").localeCompare(b.groupName ?? "");
        if (groupCompare !== 0) return groupCompare;
        return (a.subgroupNumber ?? 0) - (b.subgroupNumber ?? 0);
      });
    } else {
      // status: incomplete first, then completed
      sorted.sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted));
    }
    return sorted;
  }, [assignments, selectedDate, nameQuery, groupFilter, sortBy]);

  const completedCount = dayAssignments.filter((a) => a.isCompleted).length;

  function handleToggle(id: string, current: boolean) {
    startTransition(async () => {
      await adminSetCompletion(id, !current);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <label className="flex flex-col gap-1 text-sm">
          תאריך
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            {availableDates.length === 0 && <option value="">אין שיבוצים</option>}
            {availableDates.map((dk) => (
              <option key={dk} value={dk}>
                {formatHebrewDate(parseDateKey(dk))}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          חיפוש לפי שם
          <input
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="שם תלמיד/ה..."
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          קבוצה
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">הכל</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                קבוצה {g}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          מיון לפי
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            {(Object.keys(SORT_LABELS) as SortBy[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        {dayAssignments.length > 0 && (
          <p className="text-sm text-muted-foreground">
            בוצעו {completedCount} מתוך {dayAssignments.length}
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-right font-medium">תלמיד/ה</th>
              <th className="px-4 py-3 text-right font-medium">קבוצה</th>
              <th className="px-4 py-3 text-right font-medium">תת-קבוצה</th>
              <th className="px-4 py-3 text-right font-medium">סוג תורנות</th>
              <th className="px-4 py-3 text-right font-medium">פרסום</th>
              <th className="px-4 py-3 text-right font-medium">סטטוס</th>
              <th className="px-4 py-3 text-right font-medium">שעת ביצוע</th>
              <th className="px-4 py-3 text-right font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {dayAssignments.map((a) => (
              <tr key={a.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2 font-medium text-card-foreground">{a.studentName}</td>
                <td className="px-4 py-2 text-muted-foreground">{a.groupName ?? "-"}</td>
                <td className="px-4 py-2 text-muted-foreground">{a.subgroupNumber ?? "-"}</td>
                <td className="px-4 py-2 text-card-foreground">{a.dutyTypeName}</td>
                <td className="px-4 py-2">
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
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      a.isCompleted
                        ? "bg-success-muted text-success"
                        : "bg-danger-muted text-danger"
                    }`}
                  >
                    {a.isCompleted ? "בוצע" : "לא בוצע"}
                  </span>
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {a.completedAt ? formatHebrewDateTime(new Date(a.completedAt)) : "-"}
                </td>
                <td className="px-4 py-2">
                  <Button
                    variant="secondary"
                    className="!px-2 !py-1"
                    disabled={isPending}
                    onClick={() => handleToggle(a.id, a.isCompleted)}
                  >
                    {a.isCompleted ? "סימון כלא בוצע" : "סימון כבוצע"}
                  </Button>
                </td>
              </tr>
            ))}
            {dayAssignments.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  {assignments.some((a) => a.dateKey === selectedDate)
                    ? "אין שיבוצים התואמים את הסינון"
                    : "אין שיבוצים לתאריך זה"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
