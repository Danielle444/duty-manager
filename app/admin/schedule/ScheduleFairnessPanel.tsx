"use client";

import { useEffect, useState } from "react";
import { dateKey } from "@/lib/dates";
import { getFairnessWarnings } from "@/lib/actions/schedule-fairness";
import type { FairnessWarning } from "@/lib/schedule-fairness";

export function ScheduleFairnessPanel({
  startDate,
  endDate,
  refreshKey,
}: {
  startDate: Date | null;
  endDate: Date | null;
  refreshKey?: number;
}) {
  const [warnings, setWarnings] = useState<FairnessWarning[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
    if (!startDate || !endDate) {
      setWarnings(null);
      return;
    }
    let cancelled = false;
    getFairnessWarnings(dateKey(startDate), dateKey(endDate))
      .then((result) => {
        if (!cancelled) setWarnings(result);
      })
      .catch(() => {
        if (!cancelled) setWarnings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, refreshKey]);

  if (!startDate || !endDate || warnings === null) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-sm font-semibold text-card-foreground"
      >
        <span>סיכום תורנויות לפי חניך {warnings.length > 0 && `(${warnings.length} חריגות)`}</span>
        <span className="text-muted-foreground">{open ? "הסתר ▲" : "הצג ▼"}</span>
      </button>
      {open && (
        <div className="mt-3">
          {warnings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              לא נמצאו חריגות הוגנות בטווח הנבחר (לא זוהתה חזרתיות גבוהה או חלוקה לא אחידה)
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {warnings.map((w, i) => (
                <li key={i}>• {w.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
