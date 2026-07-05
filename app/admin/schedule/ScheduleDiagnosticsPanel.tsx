"use client";

import { useEffect, useState } from "react";
import { dateKey, parseDateKey } from "@/lib/dates";
import { getScheduleDiagnostics } from "@/lib/actions/schedule-diagnostics";
import type { ScheduleDiagnostics } from "@/lib/schedule-diagnostics";

const COLLAPSED_LIMIT = 10;

function formatShortDate(dk: string): string {
  const date = parseDateKey(dk);
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const y = date.getUTCFullYear();
  return `${d}.${m}.${y}`;
}

function buildWarnings(diagnostics: ScheduleDiagnostics): string[] {
  const warnings: string[] = [];

  for (const c of diagnostics.dateCoverage) {
    if (!c.isNoDuty && c.isShort) {
      warnings.push(
        `${formatShortDate(c.dateKey)}: חסרים ${c.activeStudentCount - c.assignedCount} שיבוצים`
      );
    }
  }

  for (const d of diagnostics.dutyTypeCoverage) {
    if (d.status === "חסר") {
      warnings.push(
        `${d.dutyTypeName} ${formatShortDate(d.dateKey)}: חסר (${d.assignedCount}/${d.expectedCount})`
      );
    } else if (d.status === "עודף") {
      warnings.push(
        `${d.dutyTypeName} ${formatShortDate(d.dateKey)}: עודף (${d.assignedCount}/${d.expectedCount})`
      );
    }
  }

  for (const s of diagnostics.subgroupCoverage) {
    if (s.status === "חסר") {
      warnings.push(`${s.dutyTypeName} ${formatShortDate(s.dateKey)}: תת־קבוצה ${s.label} חסרה`);
    } else if (s.status === "עודף") {
      warnings.push(
        `${s.dutyTypeName} ${formatShortDate(s.dateKey)}: תת־קבוצה ${s.label} שובצה יותר מפעם אחת`
      );
    }
  }

  return warnings;
}

export function ScheduleDiagnosticsPanel({
  startDate,
  endDate,
  refreshKey,
}: {
  startDate: Date | null;
  endDate: Date | null;
  refreshKey?: number;
}) {
  const [diagnostics, setDiagnostics] = useState<ScheduleDiagnostics | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded(false);
    if (!startDate || !endDate) {
      setDiagnostics(null);
      return;
    }
    let cancelled = false;
    getScheduleDiagnostics(dateKey(startDate), dateKey(endDate))
      .then((result) => {
        if (!cancelled) setDiagnostics(result);
      })
      .catch(() => {
        if (!cancelled) setDiagnostics(null);
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, refreshKey]);

  if (!startDate || !endDate || !diagnostics) return null;

  const warnings = buildWarnings(diagnostics);

  if (warnings.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-success-muted p-4 text-sm text-success">
        לא נמצאו חריגות בשיבוץ בטווח הנבחר
      </div>
    );
  }

  const visibleWarnings = expanded ? warnings : warnings.slice(0, COLLAPSED_LIMIT);

  return (
    <div className="rounded-xl border border-warning bg-warning-muted p-4">
      <p className="mb-2 text-sm font-semibold text-warning">
        נמצאו {warnings.length} חריגות בשיבוץ בטווח הנבחר
      </p>
      <ul className="flex flex-col gap-1 text-sm text-warning">
        {visibleWarnings.map((w, i) => (
          <li key={i}>• {w}</li>
        ))}
      </ul>
      {warnings.length > COLLAPSED_LIMIT && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-sm font-medium text-warning underline"
        >
          {expanded ? "הצג פחות" : `הצג הכל (${warnings.length})`}
        </button>
      )}
    </div>
  );
}
