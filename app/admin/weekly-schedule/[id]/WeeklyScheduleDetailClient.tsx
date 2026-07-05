"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { formatHebrewDate, formatHebrewWeekday, parseDateKey } from "@/lib/dates";
import { cleanScheduleTitle } from "@/lib/schedule-title";
import { ScheduleTimeGrid } from "@/lib/components/ScheduleTimeGrid";
import { getScheduleGroupColorClass } from "@/lib/schedule-group-colors";
import {
  getNoDutyStatusForRange,
  markNoDutyDate,
  unmarkNoDutyDate,
  type NoDutyDayStatus,
} from "@/lib/actions/no-duty-dates";

interface ScheduleItemView {
  id: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  title: string;
  description: string | null;
  groupName: string | null;
  instructorName: string | null;
  location: string | null;
}

interface WeeklyScheduleView {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  uploadedFileName: string;
  items: ScheduleItemView[];
}

// Admin always sees the full (time-cleaned) title and instructorName - no
// student-facing shortening or hiding here.
function renderScheduleCard(item: ScheduleItemView, compact = false) {
  return (
    <div
      key={item.id}
      className={`rounded-xl border-2 border-border ${getScheduleGroupColorClass(item.groupName)} ${
        compact ? "p-2.5" : "p-4"
      }`}
    >
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
        <span
          className={`font-semibold text-card-foreground ${compact ? "text-sm" : "text-base"}`}
        >
          {item.startTime}-{item.endTime}
        </span>
        <span
          className={`rounded-full bg-muted text-muted-foreground ${
            compact ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
          }`}
        >
          {item.groupName ? `קבוצה ${item.groupName}` : "שתי הקבוצות"}
        </span>
      </div>
      <p className={`font-bold text-card-foreground ${compact ? "text-base" : "text-lg"}`}>
        {cleanScheduleTitle(item.title)}
      </p>
      {item.instructorName && (
        <p className={`mt-1 text-muted-foreground ${compact ? "text-xs" : "text-sm"}`}>
          מדריך/ה: {item.instructorName}
        </p>
      )}
      {item.location && (
        <p className={`text-muted-foreground ${compact ? "text-xs" : "text-sm"}`}>
          מיקום: {item.location}
        </p>
      )}
    </div>
  );
}

export function WeeklyScheduleDetailClient({ week }: { week: WeeklyScheduleView }) {
  const [groupFilter, setGroupFilter] = useState<"all" | string>("all");
  const [dayFilter, setDayFilter] = useState<"all" | string>("all");
  const [noDutyStatus, setNoDutyStatus] = useState<Map<string, NoDutyDayStatus> | null>(null);
  const [isPending, startTransition] = useTransition();

  function loadNoDutyStatus() {
    getNoDutyStatusForRange(week.startDate, week.endDate).then((rows) => {
      setNoDutyStatus(new Map(rows.map((r) => [r.dateKey, r])));
    });
  }

  useEffect(() => {
    loadNoDutyStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week.startDate, week.endDate]);

  function handleToggleNoDuty(dk: string, currentlyMarked: boolean) {
    startTransition(async () => {
      if (currentlyMarked) {
        await unmarkNoDutyDate(dk);
      } else {
        await markNoDutyDate(dk);
      }
      loadNoDutyStatus();
    });
  }

  const groups = useMemo(
    () =>
      Array.from(
        new Set(week.items.map((i) => i.groupName).filter((g): g is string => Boolean(g)))
      ).sort(),
    [week.items]
  );

  const dayOptions = useMemo(
    () => Array.from(new Set(week.items.map((i) => i.dateKey))).sort(),
    [week.items]
  );

  const filteredItems = useMemo(() => {
    return week.items
      .filter((i) => groupFilter === "all" || !i.groupName || i.groupName === groupFilter)
      .filter((i) => dayFilter === "all" || i.dateKey === dayFilter)
      .sort((a, b) => (a.dateKey + a.startTime).localeCompare(b.dateKey + b.startTime));
  }, [week.items, groupFilter, dayFilter]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, ScheduleItemView[]>();
    for (const item of filteredItems) {
      if (!map.has(item.dateKey)) map.set(item.dateKey, []);
      map.get(item.dateKey)!.push(item);
    }
    return Array.from(map.entries());
  }, [filteredItems]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/admin/weekly-schedule"
            className="text-sm text-muted-foreground underline hover:text-card-foreground"
          >
            &larr; חזרה ללו&quot;ז שבועי
          </Link>
          <h1 className="mt-1 text-xl font-bold text-card-foreground">{week.name}</h1>
          <p className="text-sm text-muted-foreground">
            {formatHebrewDate(parseDateKey(week.startDate))} -{" "}
            {formatHebrewDate(parseDateKey(week.endDate))} · {week.items.length} פריטי לו&quot;ז ·{" "}
            {week.uploadedFileName}
          </p>
        </div>
        <a
          href={`/api/admin/schedule/export?weeklyScheduleId=${week.id}`}
          className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:opacity-80"
        >
          ייצוא לאקסל
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setGroupFilter("all")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            groupFilter === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          שתי הקבוצות
        </button>
        {groups.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGroupFilter(g)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              groupFilter === g
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            קבוצה {g}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDayFilter("all")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            dayFilter === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          כל הימים
        </button>
        {dayOptions.map((dk) => (
          <button
            key={dk}
            type="button"
            onClick={() => setDayFilter(dk)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              dayFilter === dk
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {formatHebrewWeekday(parseDateKey(dk))} · {formatHebrewDate(parseDateKey(dk))}
          </button>
        ))}
      </div>

      {itemsByDay.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          אין פריטים להצגה
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {itemsByDay.map(([dk, items]) => {
            const status = noDutyStatus?.get(dk);
            const isNoDuty = status?.isNoDuty ?? false;
            return (
            <div key={dk} className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-bold text-secondary-foreground">
                    {formatHebrewWeekday(parseDateKey(dk))} · {formatHebrewDate(parseDateKey(dk))}
                  </span>
                  {isNoDuty && (
                    <span className="rounded-full bg-warning-muted px-3 py-1 text-xs font-medium text-warning">
                      אין תורנויות ביום זה
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={isPending || !noDutyStatus}
                  onClick={() => handleToggleNoDuty(dk, isNoDuty)}
                  className="rounded-full bg-card px-3 py-1 text-xs font-medium text-card-foreground underline decoration-dotted hover:bg-muted disabled:opacity-50"
                >
                  {isNoDuty ? "בטל סימון ללא תורנויות" : "סמן כיום ללא תורנויות"}
                </button>
              </div>

              {isNoDuty && status && status.assignmentCount > 0 && (
                <div className="mb-3 rounded-lg bg-danger-muted p-3 text-sm text-danger">
                  קיימים {status.assignmentCount} שיבוצי תורנות ליום זה שלא נמחקו אוטומטית. ניתן
                  לטפל בהם ידנית בעמוד שיבוץ.
                </div>
              )}

              {groupFilter === "all" ? (
                <ScheduleTimeGrid items={items} renderCard={(item) => renderScheduleCard(item, true)} />
              ) : (
                <div className="flex flex-col gap-3">
                  {items.map((item) => renderScheduleCard(item))}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
