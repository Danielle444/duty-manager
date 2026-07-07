"use client";

import { useState } from "react";
import { formatHebrewDate, formatHebrewDateTime, getDayPartLabel, parseDateKey } from "@/lib/dates";
import { getRidingHistoryTitle } from "@/lib/schedule-title";
import type { RidingHistoryRow } from "@/lib/actions/riding-slots";

// Shared read-only riding-history row list + client-side date/topic filters,
// reused by the admin student history page and the instructor "לפי חניך"
// history modal so both stay in sync.
export function RidingHistoryList({ rows }: { rows: RidingHistoryRow[] }) {
  const [dateFilter, setDateFilter] = useState("");
  const [topicSearch, setTopicSearch] = useState("");

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        עדיין לא הוזנו הערות רכיבה לחניך/ה זה/זו.
      </p>
    );
  }

  const normalizedSearch = topicSearch.trim().toLowerCase();
  const filteredRows = rows.filter((row) => {
    if (dateFilter && row.dateKey !== dateFilter) return false;
    if (normalizedSearch) {
      const topic = getRidingHistoryTitle(row.title).trim().toLowerCase();
      if (!topic.includes(normalizedSearch)) return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-w-full flex-col gap-2 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
            סינון לפי תאריך
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-full min-w-0 rounded-lg border border-border px-2 py-1.5 text-sm"
            />
          </label>
          {dateFilter && (
            <button
              type="button"
              onClick={() => setDateFilter("")}
              className="shrink-0 text-xs text-muted-foreground underline"
            >
              ניקוי סינון
            </button>
          )}
        </div>
        <label className="flex flex-col gap-1 text-xs">
          חיפוש לפי נושא רכיבה
          <input
            type="text"
            value={topicSearch}
            onChange={(e) => setTopicSearch(e.target.value)}
            placeholder="לדוגמה: מעברים"
            className="w-full min-w-0 rounded-lg border border-border px-2 py-1.5 text-sm"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          מציג {filteredRows.length} מתוך {rows.length} רשומות
        </p>
      </div>

      {filteredRows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          לא נמצאו רשומות רכיבה לפי הסינון שנבחר.
        </p>
      ) : (
        filteredRows.map((row) => (
          <div key={row.ridingSlotId} className="rounded-xl border border-border bg-card p-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-card-foreground">
                {formatHebrewDate(parseDateKey(row.dateKey))}
                {getDayPartLabel(row.startTime) && ` · ${getDayPartLabel(row.startTime)}`}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  row.ratingHalfPoints != null
                    ? "bg-success-muted text-success"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {row.ratingHalfPoints != null ? `דירוג: ${row.ratingHalfPoints / 2}` : "אין דירוג"}
              </span>
            </div>
            <p className="mb-1 text-base font-bold text-card-foreground">
              {getRidingHistoryTitle(row.title)}
            </p>
            <p className="mb-1 text-xs text-muted-foreground">
              מאמן/ת: {row.instructorName ?? "לא הוגדר"} · מגרש: {row.arena ?? "לא הוגדר"}
            </p>
            <p className="mb-1 text-xs text-muted-foreground">{row.horseDisplay}</p>
            {row.note && <p className="mb-1 text-sm text-card-foreground">הערה: {row.note}</p>}
            {row.lessonTopic && (
              <p className="mb-1 text-xs text-muted-foreground">נושא השיעור: {row.lessonTopic}</p>
            )}
            {row.taughtStudents.length > 0 && (
              <p className="mb-1 text-xs text-muted-foreground">
                הדריך/ה: {row.taughtStudents.map((s) => s.fullName).join(", ")}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {row.updatedByName && `עודכן על ידי: ${row.updatedByName}`}
              {row.updatedByName && " · "}
              עודכן בתאריך: {formatHebrewDateTime(new Date(row.updatedAt))}
            </p>
          </div>
        ))
      )}
    </div>
  );
}
