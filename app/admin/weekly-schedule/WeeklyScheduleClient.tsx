"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import {
  commitWeeklySchedule,
  confirmDayPlanSuggestions,
  deleteWeeklySchedule,
  parseWeeklyScheduleExcel,
  setWeeklySchedulePublished,
  suggestDayPlanFromSchedule,
  type DayPlanSuggestion,
  type ScheduleImportItem,
} from "@/lib/actions/weekly-schedule";
import { runGenerateSchedule, setPublishStatus } from "@/lib/actions/schedule";
import { formatHebrewDate, parseDateKey } from "@/lib/dates";
import type { GenerateMode } from "@/lib/scheduler";

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

interface DutyStatus {
  total: number;
  published: number;
}

interface WeeklyScheduleView {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  uploadedFileName: string;
  isPublished: boolean;
  dutyStatus: DutyStatus;
  items: ScheduleItemView[];
}

const MODE_LABELS: Record<GenerateMode, string> = {
  fillMissing: "השלמת חוסרים בלבד",
  regeneratePreserveManual: "ייצור מחדש, שמירה על שיבוצים ידניים",
  clearAndRegenerate: "מחיקה וייצור מחדש מלא",
};

// Which input a given issue should visually highlight - lets the preview UI
// point at the specific field, not just the whole row.
type IssueField = "date" | "startTime" | "endTime" | "group" | "title" | "combined";

interface RowIssue {
  key: string;
  field: IssueField;
  message: string;
}

const DUPLICATE_ROW_FIELDS: IssueField[] = ["date", "startTime", "endTime", "group", "title"];

function timeToMinutes(t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// 1-based row number = position in the original parse order - shown to the
// admin as a stable "שורה N" label so warnings/errors can reference each
// other precisely, and so the same number always means the same row.
function rowNumbersByKey(items: ScheduleImportItem[]): Map<string, number> {
  return new Map(items.map((item, i) => [item.key, i + 1]));
}

// Short, human-readable description of a single row's key fields - used to
// make a cross-referenced row ("חופפת לשורה 13") identifiable without having
// to scroll to find it.
function shortRowDescription(item: ScheduleImportItem): string {
  const time =
    item.startTime && item.endTime
      ? `${item.startTime}-${item.endTime}`
      : item.startTime || item.endTime || "ללא שעה";
  const group = item.groupName.trim() ? `קבוצה ${item.groupName.trim()}` : "שתי הקבוצות";
  const title = item.title.trim() || "ללא כותרת";
  return `${time}, ${group}, ${title}`;
}

// Full context label for a row, used to prefix every summary-panel line so
// each line is understandable on its own without looking at the row card.
function rowContextLabel(item: ScheduleImportItem, rowNumber: number): string {
  const dateLabel = item.dateKey ? formatHebrewDate(parseDateKey(item.dateKey)) : "ללא תאריך";
  return `שורה ${rowNumber} · ${dateLabel} · ${shortRowDescription(item)}`;
}

// Blocking: a row with any of these can't be saved as-is - the admin must
// fix or delete it. Deliberately does NOT flag an empty groupName - that's
// valid and means "both groups" (שתי הקבוצות), not an error.
function computeBlockingErrors(items: ScheduleImportItem[]): RowIssue[] {
  const errors: RowIssue[] = [];
  for (const item of items) {
    if (!item.dateKey) errors.push({ key: item.key, field: "date", message: "שורה ללא תאריך" });
    if (!item.startTime) {
      errors.push({ key: item.key, field: "startTime", message: "שורה ללא שעת התחלה" });
    }
    if (!item.endTime) {
      errors.push({ key: item.key, field: "endTime", message: "שורה ללא שעת סיום" });
    }
    if (item.startTime && item.endTime) {
      const start = timeToMinutes(item.startTime);
      const end = timeToMinutes(item.endTime);
      if (start !== null && end !== null && end <= start) {
        const message = "שעת הסיום קודמת או שווה לשעת ההתחלה";
        errors.push({ key: item.key, field: "startTime", message });
        errors.push({ key: item.key, field: "endTime", message });
      }
    }
    if (!item.title.trim()) {
      errors.push({ key: item.key, field: "title", message: "שורה ללא כותרת פעילות" });
    }
    // A non-empty "משולב" value that was neither כן nor לא blocks saving, using
    // the SAME row-validation UI + commit gate as the other blocking errors.
    if (item.combinedParticipationMalformed) {
      errors.push({
        key: item.key,
        field: "combined",
        message: "יש להזין בעמודת משולב רק כן, לא, או להשאיר ריק.",
      });
    }
  }
  return errors;
}

// Non-blocking: worth flagging, but shouldn't stop the admin from saving.
function computeWarnings(
  items: ScheduleImportItem[],
  weekStart: string,
  weekEnd: string
): RowIssue[] {
  const warnings: RowIssue[] = [];
  const rowNumbers = rowNumbersByKey(items);

  const byGroupDate = new Map<string, ScheduleImportItem[]>();
  for (const item of items) {
    if (!item.dateKey || !item.startTime || !item.endTime) continue;
    const key = `${item.dateKey}|${item.groupName}`;
    if (!byGroupDate.has(key)) byGroupDate.set(key, []);
    byGroupDate.get(key)!.push(item);
  }
  for (const group of byGroupDate.values()) {
    const sorted = [...group].sort(
      (a, b) => (timeToMinutes(a.startTime) ?? 0) - (timeToMinutes(b.startTime) ?? 0)
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const end = timeToMinutes(a.endTime);
      const nextStart = timeToMinutes(b.startTime);
      if (end !== null && nextStart !== null && end > nextStart) {
        const messageForA = `חופפת לשורה ${rowNumbers.get(b.key)} (${shortRowDescription(b)})`;
        const messageForB = `חופפת לשורה ${rowNumbers.get(a.key)} (${shortRowDescription(a)})`;
        warnings.push({ key: a.key, field: "startTime", message: messageForA });
        warnings.push({ key: a.key, field: "endTime", message: messageForA });
        warnings.push({ key: b.key, field: "startTime", message: messageForB });
        warnings.push({ key: b.key, field: "endTime", message: messageForB });
      }
    }
  }

  const firstBySig = new Map<string, ScheduleImportItem>();
  for (const item of items) {
    const sig = `${item.dateKey}|${item.startTime}|${item.endTime}|${item.groupName}|${item.title.trim()}`;
    const original = firstBySig.get(sig);
    if (original) {
      const message = `כפולה לשורה ${rowNumbers.get(original.key)} (${shortRowDescription(original)})`;
      for (const field of DUPLICATE_ROW_FIELDS) {
        warnings.push({ key: item.key, field, message });
      }
    } else {
      firstBySig.set(sig, item);
    }
  }

  if (weekStart && weekEnd) {
    for (const item of items) {
      if (item.dateKey && (item.dateKey < weekStart || item.dateKey > weekEnd)) {
        warnings.push({ key: item.key, field: "date", message: "תאריך מחוץ לטווח השבוע שנבחר" });
      }
    }
  }

  return warnings;
}

function messagesByKey(issues: RowIssue[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const issue of issues) {
    if (!map.has(issue.key)) map.set(issue.key, []);
    const messages = map.get(issue.key)!;
    if (!messages.includes(issue.message)) messages.push(issue.message);
  }
  return map;
}

function fieldsByKey(issues: RowIssue[]): Map<string, Set<IssueField>> {
  const map = new Map<string, Set<IssueField>>();
  for (const issue of issues) {
    if (!map.has(issue.key)) map.set(issue.key, new Set());
    map.get(issue.key)!.add(issue.field);
  }
  return map;
}

interface SummaryLine {
  rowNumber: number;
  text: string;
}

// One self-contained line per unique (row, message) pair, prefixed with that
// row's full context - used by the summary panel so each line is
// understandable without cross-referencing the row cards below it.
function buildSummaryLines(
  byKey: Map<string, string[]>,
  items: ScheduleImportItem[]
): SummaryLine[] {
  const itemByKey = new Map(items.map((item) => [item.key, item]));
  const rowNumbers = rowNumbersByKey(items);
  const lines: SummaryLine[] = [];
  for (const [key, messages] of byKey) {
    const item = itemByKey.get(key);
    const rowNumber = rowNumbers.get(key);
    if (!item || !rowNumber) continue;
    const context = rowContextLabel(item, rowNumber);
    for (const message of messages) {
      lines.push({ rowNumber, text: `${context}: ${message}` });
    }
  }
  return lines.sort((a, b) => a.rowNumber - b.rowNumber);
}

export function WeeklyScheduleClient({
  weeklySchedules,
}: {
  weeklySchedules: WeeklyScheduleView[];
}) {
  const [isPending, startTransition] = useTransition();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<WeeklyScheduleView | null>(null);
  const [parsedItems, setParsedItems] = useState<ScheduleImportItem[] | null>(null);
  const [weekName, setWeekName] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [parseWarning, setParseWarning] = useState<string | null>(null);

  const [suggestWeekId, setSuggestWeekId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<DayPlanSuggestion[] | null>(null);

  function openUpload(target: WeeklyScheduleView | null) {
    setUploadTarget(target);
    setWeekName(target?.name ?? "");
    setWeekStart(target?.startDate ?? "");
    setWeekEnd(target?.endDate ?? "");
    setUploadedFileName("");
    setParsedItems(null);
    setError(null);
    setSummary(null);
    setParseWarning(null);
    setUploadOpen(true);
  }

  function handleParse(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setParseWarning(null);
    const formData = new FormData(e.currentTarget);
    const file = formData.get("file");
    if (file instanceof File) setUploadedFileName(file.name);
    startTransition(async () => {
      const result = await parseWeeklyScheduleExcel(formData);
      if (!result.success || !result.items) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      setParsedItems(result.items);
      setParseWarning(result.warning ?? null);
    });
  }

  function updateItem(key: string, patch: Partial<ScheduleImportItem>) {
    setParsedItems((prev) =>
      prev ? prev.map((i) => (i.key === key ? { ...i, ...patch } : i)) : prev
    );
  }

  function handleRemoveRow(key: string) {
    setParsedItems((prev) => (prev ? prev.filter((i) => i.key !== key) : prev));
  }

  function handleAddRow() {
    setParsedItems((prev) => [
      ...(prev ?? []),
      {
        key: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        dateKey: null,
        startTime: "",
        endTime: "",
        title: "",
        description: "",
        groupName: "",
        instructorName: "",
        location: "",
        rawText: "",
        needsReview: true,
        combinedParticipation: null,
        combinedParticipationMalformed: false,
      },
    ]);
  }

  const blockingErrors = useMemo(
    () => (parsedItems ? computeBlockingErrors(parsedItems) : []),
    [parsedItems]
  );
  const warnings = useMemo(
    () => (parsedItems ? computeWarnings(parsedItems, weekStart, weekEnd) : []),
    [parsedItems, weekStart, weekEnd]
  );
  const errorsByKey = useMemo(() => messagesByKey(blockingErrors), [blockingErrors]);
  const warningsByKey = useMemo(() => messagesByKey(warnings), [warnings]);
  const errorFieldsByKey = useMemo(() => fieldsByKey(blockingErrors), [blockingErrors]);
  const warningFieldsByKey = useMemo(() => fieldsByKey(warnings), [warnings]);
  const rowNumberByKey = useMemo(
    () => (parsedItems ? rowNumbersByKey(parsedItems) : new Map<string, number>()),
    [parsedItems]
  );
  const errorSummaryLines = useMemo(
    () => (parsedItems ? buildSummaryLines(errorsByKey, parsedItems) : []),
    [errorsByKey, parsedItems]
  );
  const warningSummaryLines = useMemo(
    () => (parsedItems ? buildSummaryLines(warningsByKey, parsedItems) : []),
    [warningsByKey, parsedItems]
  );

  function fieldIssueClass(key: string, field: IssueField): string {
    if (errorFieldsByKey.get(key)?.has(field)) return "border-danger";
    if (warningFieldsByKey.get(key)?.has(field)) return "border-warning";
    return "border-border";
  }

  const groupedParsedItems = useMemo(() => {
    if (!parsedItems) return [];
    const map = new Map<string, ScheduleImportItem[]>();
    for (const item of parsedItems) {
      const key = item.dateKey ?? "__no_date__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "__no_date__") return 1;
      if (b === "__no_date__") return -1;
      return a.localeCompare(b);
    });
  }, [parsedItems]);

  function handleCommit() {
    if (!parsedItems) return;
    if (!weekName.trim() || !weekStart || !weekEnd) {
      setError("יש למלא שם וטווח תאריכים לשבוע");
      return;
    }
    if (blockingErrors.length > 0) {
      setError("יש לתקן או להסיר את השורות עם השגיאות המסומנות לפני השמירה");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await commitWeeklySchedule({
        weeklyScheduleId: uploadTarget?.id,
        name: weekName,
        startDate: weekStart,
        endDate: weekEnd,
        uploadedFileName: uploadedFileName || uploadTarget?.uploadedFileName || "",
        items: parsedItems,
      });
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה בשמירה");
        return;
      }
      setSummary(
        `נשמרו ${result.savedCount} פריטים` +
          (result.skippedCount > 0 ? `, דולגו ${result.skippedCount} שורות ללא תאריך תקין` : "")
      );
      setParsedItems(null);
      if (result.weeklyScheduleId) {
        openSuggestions(result.weeklyScheduleId);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteWeeklySchedule(id);
    });
  }

  function openSuggestions(weekId: string) {
    setError(null);
    setSuggestWeekId(weekId);
    startTransition(async () => {
      try {
        const result = await suggestDayPlanFromSchedule(weekId);
        if (!result.success || !result.suggestions) {
          // Keep suggestions at null (not []) so the modal shows the error
          // message alone, rather than also showing "no suggestions found".
          setError(result.error ?? "לא ניתן היה להציע ערכים");
          return;
        }
        setSuggestions(result.suggestions);
      } catch {
        // Without this, an unexpected error would leave suggestions === null
        // forever, and the modal would stay stuck showing "טוען..." with no
        // indication anything went wrong.
        setError("אירעה שגיאה בטעינת הצעות תכנון הקבוצות");
      }
    });
  }

  function updateSuggestion(dk: string, patch: Partial<DayPlanSuggestion>) {
    setSuggestions((prev) =>
      prev ? prev.map((s) => (s.dateKey === dk ? { ...s, ...patch } : s)) : prev
    );
  }

  function handleConfirmSuggestions() {
    if (!suggestions) return;
    startTransition(async () => {
      await confirmDayPlanSuggestions(suggestions);
      setSuggestWeekId(null);
      setSuggestions(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={() => openUpload(null)}>+ העלאת לו&quot;ז לשבוע חדש</Button>
      </div>

      <div className="flex flex-col gap-3">
        {weeklySchedules.map((week) => (
          <WeekCard
            key={week.id}
            week={week}
            onReplace={() => openUpload(week)}
            onDelete={() => handleDelete(week.id)}
            onSuggest={() => openSuggestions(week.id)}
          />
        ))}
        {weeklySchedules.length === 0 && (
          <p className="text-sm text-muted-foreground">טרם הועלה לו&quot;ז לאף שבוע.</p>
        )}
      </div>

      <Modal
        open={uploadOpen}
        title={uploadTarget ? `החלפת לו"ז - ${uploadTarget.name}` : 'העלאת לו"ז חדש'}
        onClose={() => setUploadOpen(false)}
        size="large"
      >
        <div className="flex h-full flex-col gap-4">
          {uploadTarget && (
            <p className="shrink-0 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              החלפת הלו&quot;ז מעדכנת את פריטי הלו&quot;ז בלבד - שיבוצי תורנות קיימים, סטטוס
              הפרסום שלהם, וסימוני ביצוע אינם נמחקים או משתנים.
            </p>
          )}
          <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              שם השבוע
              <input
                value={weekName}
                onChange={(e) => setWeekName(e.target.value)}
                className="rounded-lg border border-border px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              מתאריך
              <input
                type="date"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
                className="rounded-lg border border-border px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              עד תאריך
              <input
                type="date"
                value={weekEnd}
                onChange={(e) => setWeekEnd(e.target.value)}
                className="rounded-lg border border-border px-2 py-1 text-sm"
              />
            </label>
          </div>

          {!parsedItems && (
            <form onSubmit={handleParse} className="flex shrink-0 flex-col gap-3">
              <input
                type="file"
                name="file"
                accept=".xlsx"
                required
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" disabled={isPending}>
                {isPending ? "מפענח..." : "פענוח קובץ"}
              </Button>
            </form>
          )}

          {parsedItems && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <p className="shrink-0 text-sm text-muted-foreground">
                נמצאו {parsedItems.length} פריטים. שורות עם שגיאה (מסומנות באדום) חוסמות שמירה
                עד לתיקון או הסרה. אזהרות (מסומנות בכתום) אינן חוסמות שמירה.
              </p>
              {parseWarning && (
                <div className="shrink-0 rounded-lg bg-warning-muted p-3 text-sm text-warning">
                  {parseWarning}
                </div>
              )}
              {errorSummaryLines.length > 0 && (
                <div className="shrink-0 rounded-lg border border-danger bg-danger-muted p-3 text-sm text-danger">
                  <p className="font-semibold">
                    נמצאו {errorSummaryLines.length} שגיאות החוסמות שמירה - יש לתקן או להסיר את
                    השורות המסומנות:
                  </p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {errorSummaryLines.slice(0, 12).map((line, i) => (
                      <li key={i}>• {line.text}</li>
                    ))}
                    {errorSummaryLines.length > 12 && (
                      <li>ועוד {errorSummaryLines.length - 12}...</li>
                    )}
                  </ul>
                </div>
              )}
              {warningSummaryLines.length > 0 && (
                <div className="shrink-0 rounded-lg border border-warning bg-warning-muted p-3 text-sm text-warning">
                  <p className="font-semibold">
                    נמצאו {warningSummaryLines.length} אזהרות (לא חוסמות שמירה):
                  </p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {warningSummaryLines.slice(0, 12).map((line, i) => (
                      <li key={i}>• {line.text}</li>
                    ))}
                    {warningSummaryLines.length > 12 && (
                      <li>ועוד {warningSummaryLines.length - 12}...</li>
                    )}
                  </ul>
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
                {groupedParsedItems.map(([groupKey, rowsForDate]) => (
                  <div key={groupKey} className="border-b border-border last:border-0">
                    <div className="sticky top-0 z-10 bg-secondary px-4 py-2.5 text-base font-bold text-secondary-foreground">
                      {groupKey === "__no_date__"
                        ? "שורות ללא תאריך"
                        : formatHebrewDate(parseDateKey(groupKey))}
                    </div>
                    <div className="flex flex-col gap-4 p-4">
                      {rowsForDate.map((item) => {
                        const rowErrors = errorsByKey.get(item.key) ?? [];
                        const rowWarnings = warningsByKey.get(item.key) ?? [];
                        const hasError = rowErrors.length > 0;
                        const hasWarning = rowWarnings.length > 0;
                        return (
                          <div
                            key={item.key}
                            className={`rounded-lg border-2 p-4 ${
                              hasError
                                ? "border-danger"
                                : hasWarning
                                  ? "border-warning"
                                  : "border-border"
                            }`}
                          >
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
                                  שורה {rowNumberByKey.get(item.key) ?? "?"}
                                </span>
                                {item.needsReview && (
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                    דורש בדיקה
                                  </span>
                                )}
                                {hasError && (
                                  <span className="rounded-full bg-danger-muted px-2 py-0.5 text-xs font-medium text-danger">
                                    שגיאה
                                  </span>
                                )}
                                {hasWarning && (
                                  <span className="rounded-full bg-warning-muted px-2 py-0.5 text-xs font-medium text-warning">
                                    אזהרה
                                  </span>
                                )}
                              </div>
                              <Button
                                type="button"
                                variant="danger"
                                className="!px-2 !py-1 text-xs"
                                onClick={() => handleRemoveRow(item.key)}
                              >
                                הסרת שורה
                              </Button>
                            </div>

                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                              <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                                תאריך
                                <input
                                  type="date"
                                  value={item.dateKey ?? ""}
                                  onChange={(e) =>
                                    updateItem(item.key, { dateKey: e.target.value || null })
                                  }
                                  className={`rounded border-2 px-2 py-1.5 text-sm ${fieldIssueClass(item.key, "date")}`}
                                />
                              </label>
                              <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                                שעת התחלה
                                <input
                                  value={item.startTime}
                                  onChange={(e) =>
                                    updateItem(item.key, { startTime: e.target.value })
                                  }
                                  placeholder="HH:MM"
                                  className={`rounded border-2 px-2 py-1.5 text-sm ${fieldIssueClass(item.key, "startTime")}`}
                                />
                              </label>
                              <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                                שעת סיום
                                <input
                                  value={item.endTime}
                                  onChange={(e) =>
                                    updateItem(item.key, { endTime: e.target.value })
                                  }
                                  placeholder="HH:MM"
                                  className={`rounded border-2 px-2 py-1.5 text-sm ${fieldIssueClass(item.key, "endTime")}`}
                                />
                              </label>
                              <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                                קבוצה
                                <input
                                  value={item.groupName}
                                  onChange={(e) =>
                                    updateItem(item.key, { groupName: e.target.value })
                                  }
                                  placeholder="ריק = שתי הקבוצות"
                                  className={`rounded border-2 px-2 py-1.5 text-sm ${fieldIssueClass(item.key, "group")}`}
                                />
                              </label>
                            </div>

                            <label className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
                              כותרת פעילות
                              <input
                                value={item.title}
                                onChange={(e) => updateItem(item.key, { title: e.target.value })}
                                className={`w-full rounded border-2 px-2 py-1.5 text-sm font-medium ${fieldIssueClass(item.key, "title")}`}
                              />
                            </label>

                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                                מדריך/ה
                                <input
                                  value={item.instructorName}
                                  onChange={(e) =>
                                    updateItem(item.key, { instructorName: e.target.value })
                                  }
                                  className="rounded border border-border px-2 py-1.5 text-sm"
                                />
                              </label>
                              <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                                מיקום
                                <input
                                  value={item.location}
                                  onChange={(e) =>
                                    updateItem(item.key, { location: e.target.value })
                                  }
                                  className="rounded border border-border px-2 py-1.5 text-sm"
                                />
                              </label>
                            </div>

                            <label className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
                              שורה מקורית
                              <textarea
                                value={item.rawText}
                                onChange={(e) =>
                                  updateItem(item.key, { rawText: e.target.value })
                                }
                                rows={1}
                                className="w-full rounded border border-border px-2 py-1.5 text-xs text-muted-foreground"
                              />
                            </label>

                            {(rowErrors.length > 0 || rowWarnings.length > 0) && (
                              <ul className="mt-2 flex flex-col gap-0.5 text-xs">
                                {rowErrors.map((msg, i) => (
                                  <li key={`e${i}`} className="text-danger">
                                    • {msg}
                                  </li>
                                ))}
                                {rowWarnings.map((msg, i) => (
                                  <li key={`w${i}`} className="text-warning">
                                    • {msg}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="secondary" onClick={handleAddRow}>
                  + הוספת שורה
                </Button>
                <div className="flex flex-wrap items-center gap-2">
                  {error && <p className="text-sm text-danger">{error}</p>}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setParsedItems(null)}
                  >
                    ביטול
                  </Button>
                  <Button
                    type="button"
                    onClick={handleCommit}
                    disabled={isPending || blockingErrors.length > 0}
                  >
                    {isPending ? "שומר..." : "שמירת הלו\"ז"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {summary && <p className="shrink-0 text-sm text-success">{summary}</p>}
        </div>
      </Modal>

      <Modal
        open={suggestWeekId !== null}
        title='הצעת ערכי תכנון קבוצות יומי'
        onClose={() => {
          setSuggestWeekId(null);
          setSuggestions(null);
        }}
        size="large"
      >
        <div className="flex h-full flex-col gap-3">
          <p className="shrink-0 text-sm text-muted-foreground">
            הצעה בלבד, על בסיס פענוח מיטבי של הלו&quot;ז. בדקו ותקנו לפני האישור - שום דבר
            לא נשמר לפני לחיצה על &quot;אישור וכתיבה&quot;.
          </p>
          {error && <p className="shrink-0 text-sm text-danger">{error}</p>}
          {suggestions === null && !error && (
            <p className="shrink-0 text-sm text-muted-foreground">טוען...</p>
          )}
          {suggestions && suggestions.length === 0 && (
            <p className="shrink-0 text-sm text-muted-foreground">אין הצעות לשבוע זה.</p>
          )}
          {suggestions && suggestions.length > 0 && (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
              {suggestions.map((s) => (
                <div key={s.dateKey} className="border-b border-border p-4 last:border-0">
                  <p className="mb-3 text-base font-bold text-card-foreground">
                    {formatHebrewDate(parseDateKey(s.dateKey))}
                  </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      בוקר - קבוצה ראשונה
                      <input
                        value={s.firstMorningGroup ?? ""}
                        onChange={(e) =>
                          updateSuggestion(s.dateKey, {
                            firstMorningGroup: e.target.value || null,
                          })
                        }
                        className="rounded border border-border px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      בוקר - קבוצה שנייה
                      <input
                        value={s.secondMorningGroup ?? ""}
                        onChange={(e) =>
                          updateSuggestion(s.dateKey, {
                            secondMorningGroup: e.target.value || null,
                          })
                        }
                        className="rounded border border-border px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      אחה&quot;צ - קבוצה ראשונה
                      <input
                        value={s.firstAfterLunchGroup ?? ""}
                        onChange={(e) =>
                          updateSuggestion(s.dateKey, {
                            firstAfterLunchGroup: e.target.value || null,
                          })
                        }
                        className="rounded border border-border px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      אחה&quot;צ - קבוצה שנייה
                      <input
                        value={s.secondAfterLunchGroup ?? ""}
                        onChange={(e) =>
                          updateSuggestion(s.dateKey, {
                            secondAfterLunchGroup: e.target.value || null,
                          })
                        }
                        className="rounded border border-border px-2 py-1.5 text-sm"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex shrink-0 justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSuggestWeekId(null);
                setSuggestions(null);
              }}
            >
              סגירה
            </Button>
            {suggestions && suggestions.length > 0 && (
              <Button type="button" onClick={handleConfirmSuggestions} disabled={isPending}>
                אישור וכתיבה לתכנון הקבוצות
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

// Purely a display summary of DutyAssignment.isPublished for this week's
// date range - does not change publish logic, just makes the current state
// visible at a glance instead of only learning it after clicking a button.
function dutyStatusBadge(status: DutyStatus): { label: string; className: string } {
  if (status.total === 0) {
    return {
      label: "טרם נוצרו שיבוצי תורנות",
      className: "bg-muted text-muted-foreground",
    };
  }
  if (status.published === status.total) {
    return {
      label: "תורנויות פורסמו לחניכים",
      className: "bg-success-muted text-success",
    };
  }
  if (status.published === 0) {
    return {
      label: "טיוטה - תורנויות לא פורסמו",
      className: "bg-muted text-muted-foreground",
    };
  }
  return {
    label: `פרסום חלקי (${status.published} מתוך ${status.total})`,
    className: "bg-warning-muted text-warning",
  };
}

function WeekCard({
  week,
  onReplace,
  onDelete,
  onSuggest,
}: {
  week: WeeklyScheduleView;
  onReplace: () => void;
  onDelete: () => void;
  onSuggest: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<GenerateMode>("regeneratePreserveManual");
  const [message, setMessage] = useState<string | null>(null);
  const [isPublished, setIsPublished] = useState(week.isPublished);
  const [publishPending, startPublishTransition] = useTransition();

  function handleTogglePublished() {
    const next = !isPublished;
    startPublishTransition(async () => {
      await setWeeklySchedulePublished(week.id, next);
      setIsPublished(next);
    });
  }

  function handleGenerate() {
    setMessage(null);
    startTransition(async () => {
      const result = await runGenerateSchedule({
        startDate: parseDateKey(week.startDate),
        endDate: parseDateKey(week.endDate),
        mode,
      });
      if (!result.success) {
        setMessage(result.error ?? "אירעה שגיאה");
        return;
      }
      setMessage(`נוצרו ${result.assignedCount} שיבוצים (טיוטה)`);
    });
  }

  function handlePublish(isPublished: boolean) {
    setMessage(null);
    startTransition(async () => {
      await setPublishStatus(parseDateKey(week.startDate), parseDateKey(week.endDate), isPublished);
      setMessage(isPublished ? "השבוע פורסם" : "פרסום השבוע בוטל");
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-card-foreground">{week.name}</p>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                isPublished ? "bg-success-muted text-success" : "bg-muted text-muted-foreground"
              }`}
            >
              {isPublished ? "לו״ז פורסם" : "טיוטת לו״ז"}
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${dutyStatusBadge(week.dutyStatus).className}`}
            >
              {dutyStatusBadge(week.dutyStatus).label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {formatHebrewDate(parseDateKey(week.startDate))} -{" "}
            {formatHebrewDate(parseDateKey(week.endDate))} · {week.items.length} פריטי לו&quot;ז ·{" "}
            {week.uploadedFileName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/weekly-schedule/${week.id}`}
            className="rounded-lg bg-transparent px-2 py-1 text-sm font-medium text-card-foreground transition-colors hover:bg-muted"
          >
            צפייה בלו&quot;ז
          </Link>
          <Button variant="ghost" className="!px-2 !py-1" onClick={onSuggest}>
            הצעת תכנון קבוצות
          </Button>
          <Button
            variant="secondary"
            className="!px-2 !py-1"
            disabled={publishPending}
            onClick={handleTogglePublished}
          >
            {isPublished ? "הסתרת לו״ז מחניכים" : "פרסום לו״ז לחניכים"}
          </Button>
          <Button variant="secondary" className="!px-2 !py-1" onClick={onReplace}>
            החלפת קובץ
          </Button>
          <Button variant="danger" className="!px-2 !py-1" onClick={onDelete}>
            מחיקה
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as GenerateMode)}
          className="rounded-lg border border-border px-2 py-1 text-xs"
        >
          {Object.entries(MODE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button className="!px-2 !py-1" disabled={isPending} onClick={handleGenerate}>
          יצירת שיבוץ תורנויות לשבוע זה
        </Button>
        <Button
          variant="secondary"
          className="!px-2 !py-1"
          disabled={isPending}
          onClick={() => handlePublish(true)}
        >
          פרסום השבוע
        </Button>
        <Button
          variant="ghost"
          className="!px-2 !py-1"
          disabled={isPending}
          onClick={() => handlePublish(false)}
        >
          ביטול פרסום
        </Button>
        {message && <span className="text-xs text-muted-foreground">{message}</span>}
      </div>
    </div>
  );
}
