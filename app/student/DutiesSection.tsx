"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import {
  getStudentDutiesForRange,
  type StudentDutyDayInfo,
} from "@/lib/actions/student-schedule";
import { markDutyCompleted } from "@/lib/actions/completion";
import { formatHebrewDateTime } from "@/lib/dates";

export function DutiesSection({
  studentId,
  startDateKey,
  endDateKey,
}: {
  studentId: string;
  startDateKey: string | null;
  endDateKey: string | null;
}) {
  const [days, setDays] = useState<StudentDutyDayInfo[] | null>(null);
  const [isPending, startTransition] = useTransition();
  // Collapsed by default - keyed by dateKey (a student has at most one duty
  // per day, so that's a stable, unique key per card).
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  function toggleExpanded(dateKey: string) {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  }

  function reload() {
    if (!startDateKey || !endDateKey) return;
    startTransition(async () => {
      const result = await getStudentDutiesForRange(studentId, startDateKey, endDateKey);
      setDays(result);
    });
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, startDateKey, endDateKey]);

  function handleMarkCompleted(assignmentId: string) {
    startTransition(async () => {
      const result = await markDutyCompleted(assignmentId, studentId);
      if (result.success) reload();
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-4 text-xl font-bold text-card-foreground">התורנויות שלי</h2>

      {!startDateKey || !endDateKey ? (
        <p className="text-base text-muted-foreground">בחרו שבוע כדי לצפות בתורנויות</p>
      ) : !days ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : days.length === 0 ? (
        <p className="text-base text-muted-foreground">אין נתונים להצגה</p>
      ) : (
        <div className="flex flex-col gap-3">
          {days.map((day) => (
            <div key={day.dateKey} className="rounded-xl border-2 border-border p-4">
              <p className="mb-2 text-base font-semibold text-card-foreground">
                {day.dayLabel} · {day.dateLabel}
              </p>

              {day.status === "no-duty-day" ? (
                <p className="text-base text-muted-foreground">אין תורנויות ביום זה</p>
              ) : day.status === "not-published" ? (
                <p className="text-base text-muted-foreground">
                  שיבוץ התורנויות לשבוע זה עדיין לא פורסם
                </p>
              ) : day.status === "no-duty" ? (
                <p className="text-base text-muted-foreground">אין לך תורנות משובצת ביום זה</p>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-lg font-bold text-card-foreground">{day.dutyTypeName}</p>

                  <p className="text-sm text-muted-foreground">
                    {day.teammateNames.length > 0
                      ? `איתך בתורנות: ${day.teammateNames.join(", ")}`
                      : "אין חניכים נוספים בתורנות זו"}
                  </p>

                  {day.dutyTypeDescription && (
                    <div className="border-t border-border pt-2">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(day.dateKey)}
                        className="text-sm font-medium text-primary underline"
                      >
                        {expandedDates.has(day.dateKey) ? "הסתר הסבר" : "הצג הסבר"}
                      </button>
                      {expandedDates.has(day.dateKey) && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {day.dutyTypeDescription}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="border-t border-border pt-2">
                    {day.isCompleted ? (
                      <div className="rounded-lg bg-success-muted p-3 text-sm text-success">
                        בוצע{" "}
                        {day.completedAt
                          ? formatHebrewDateTime(new Date(day.completedAt))
                          : ""}
                      </div>
                    ) : (
                      <Button
                        disabled={isPending}
                        onClick={() => handleMarkCompleted(day.assignmentId!)}
                      >
                        {isPending ? "מעדכן/ת..." : "סימון כבוצע"}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
