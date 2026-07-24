"use client";

/**
 * MULTI-COURSE Schedule Slice W-S2B - the NARROW client surface of the
 * offering-scoped weekly-schedule admin route.
 *
 * Deliberately NOT a copy of the Level 1 WeeklyScheduleClient: this component
 * implements ONLY upload -> parse -> preview -> save. It imports no publication,
 * delete, day-plan-suggestion, day-plan-confirmation, duty-generation or riding
 * action, and no Level 1 client - those features are not merely hidden here, they
 * are not importable from this module at all.
 *
 * The offering is never named by this component. It receives ONE already-bound
 * server action (the page binds the validated context id) and calls it with the
 * week payload only; there is no offering field, no offering selector, and no way
 * to change a week's course.
 *
 * The re-import target can only ever be one of the `weeks` the scoped page
 * supplied - `openUpload` is called exclusively with a row from that prop or with
 * null (a create). There is no free-text week-id input anywhere, and the server
 * re-proves ownership regardless of what the client sends.
 *
 * The preview is READ-ONLY. Rows without a valid YYYY-MM-DD date are not written;
 * the server reports exactly how many were saved and how many skipped, and those
 * counts are shown verbatim.
 */
import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import {
  parseWeeklyScheduleExcel,
  type ScheduleImportItem,
} from "@/lib/actions/weekly-schedule";
import {
  hasUnresolvedMalformedCombinedParticipation,
  isCombinedParticipationMalformed,
} from "@/lib/course/combined-participation-import-validation";
import { formatHebrewDate, parseDateKey } from "@/lib/dates";
import type { OfferingWeekClientInput } from "./actions";

/** One week of THIS offering, as supplied by the scoped server page. */
export interface OfferingWeekView {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  uploadedFileName: string;
  isPublished: boolean;
  itemCount: number;
}

/**
 * The bound server action's client-visible shape. `courseOfferingId` is already
 * bound server-side and is absent from this signature by construction.
 */
type SaveAction = (input: OfferingWeekClientInput) => Promise<
  | { success: true; weeklyScheduleId: string; savedCount: number; skippedCount: number }
  | { success: false; error: string }
>;

/**
 * Stable writer error code -> Hebrew message. Only a stable code is ever
 * rendered; an unknown code falls back to the generic message. No raw id, no
 * server detail and no interpolation of client input appears here.
 */
const SAVE_ERROR_MESSAGES: Record<string, string> = {
  name_required: "יש להזין שם לשבוע.",
  dates_required: "יש להזין תאריך התחלה ותאריך סיום.",
  invalid_date: "אחד התאריכים אינו תקין.",
  invalid_items: "נתוני הלוז אינם תקינים. יש לפענח את הקובץ מחדש.",
  invalid_combined: "יש להזין בעמודת משולב רק כן, לא, או להשאיר ריק.",
  offering_not_found: "הקורס אינו זמין. יש לרענן את הדף.",
  operation_not_allowed: "לא ניתן לערוך לוז בקורס במצב זה.",
  week_not_found: "השבוע המבוקש אינו שייך לקורס זה. יש לרענן את הדף.",
  unexpected: "אירעה שגיאה. נסו שוב.",
};

function saveErrorMessage(code: string): string {
  return SAVE_ERROR_MESSAGES[code] ?? SAVE_ERROR_MESSAGES.unexpected;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Mirrors the server's importability rule so the preview counts match reality. */
function isImportableRow(item: ScheduleImportItem): boolean {
  return typeof item.dateKey === "string" && DATE_KEY_PATTERN.test(item.dateKey);
}

export function OfferingScheduleClient({
  weeks,
  canDraft,
  scheduleBasePath,
  action,
}: {
  weeks: OfferingWeekView[];
  canDraft: boolean;
  scheduleBasePath: string;
  action: SaveAction;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [uploadOpen, setUploadOpen] = useState(false);
  // Either null (create a new week) or one of the `weeks` rows above - never a
  // free-typed id, and never a week from another offering.
  const [uploadTarget, setUploadTarget] = useState<OfferingWeekView | null>(null);
  const [parsedItems, setParsedItems] = useState<ScheduleImportItem[] | null>(null);
  const [weekName, setWeekName] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [parseWarning, setParseWarning] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  function openUpload(target: OfferingWeekView | null) {
    setUploadTarget(target);
    setWeekName(target?.name ?? "");
    setWeekStart(target?.startDate ?? "");
    setWeekEnd(target?.endDate ?? "");
    setUploadedFileName("");
    setParsedItems(null);
    setError(null);
    setParseWarning(null);
    setSummary(null);
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
        setError(result.error ?? "אירעה שגיאה בפענוח הקובץ");
        return;
      }
      setParsedItems(result.items);
      setParseWarning(result.warning ?? null);
    });
  }

  const importableCount = useMemo(
    () => (parsedItems ? parsedItems.filter(isImportableRow).length : 0),
    [parsedItems],
  );

  // Any row whose "משולב" cell held a non-empty value that is neither כן nor לא.
  // Blocks saving here (the server re-validates and rejects authoritatively too).
  const hasMalformedCombined = useMemo(
    () => (parsedItems ? hasUnresolvedMalformedCombinedParticipation(parsedItems) : false),
    [parsedItems],
  );

  const groupedParsedItems = useMemo(() => {
    if (!parsedItems) return [];
    const map = new Map<string, ScheduleImportItem[]>();
    for (const item of parsedItems) {
      const key = isImportableRow(item) ? (item.dateKey as string) : "__no_date__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "__no_date__") return 1;
      if (b === "__no_date__") return -1;
      return a.localeCompare(b);
    });
  }, [parsedItems]);

  function handleSave() {
    if (!parsedItems) return;
    setError(null);
    setSummary(null);
    startTransition(async () => {
      const result = await action({
        // Either undefined (create) or the id of a week this page supplied.
        weeklyScheduleId: uploadTarget?.id,
        name: weekName,
        startDate: weekStart,
        endDate: weekEnd,
        uploadedFileName: uploadedFileName || uploadTarget?.uploadedFileName || "",
        items: parsedItems,
      });
      if (!result.success) {
        setError(saveErrorMessage(result.error));
        return;
      }
      setSummary(
        `נשמרו ${result.savedCount} פריטים` +
          (result.skippedCount > 0
            ? `, דולגו ${result.skippedCount} שורות ללא תאריך תקין`
            : ""),
      );
      setParsedItems(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {canDraft && (
        <div>
          <Button onClick={() => openUpload(null)} disabled={isPending}>
            + העלאת לוז לשבוע חדש בקורס זה
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {weeks.map((week) => (
          <div key={week.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="flex flex-wrap items-center gap-2 font-bold text-card-foreground">
                  {week.name}
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      week.isPublished
                        ? "bg-success-muted text-success"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {week.isPublished ? "מפורסם" : "טיוטה"}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatHebrewDate(parseDateKey(week.startDate))} -{" "}
                  {formatHebrewDate(parseDateKey(week.endDate))} · {week.itemCount} פריטים
                  {week.uploadedFileName ? ` · ${week.uploadedFileName}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`${scheduleBasePath}/${week.id}`}
                  className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
                >
                  צפייה ועריכה
                </Link>
                {canDraft && (
                  <Button
                    variant="secondary"
                    className="!px-2 !py-1"
                    disabled={isPending}
                    onClick={() => openUpload(week)}
                  >
                    ייבוא מחדש
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
        {weeks.length === 0 && (
          <p className="text-sm text-muted-foreground">טרם הועלה לוז לאף שבוע בקורס זה.</p>
        )}
      </div>

      <Modal
        open={uploadOpen}
        title={uploadTarget ? `ייבוא מחדש - ${uploadTarget.name}` : "העלאת לוז לשבוע חדש"}
        onClose={() => setUploadOpen(false)}
        size="large"
      >
        <div className="flex h-full flex-col gap-4">
          <p className="shrink-0 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            {uploadTarget
              ? "ייבוא מחדש מחליף את פריטי הלוז של שבוע זה בלבד. שיוך השבוע לקורס אינו משתנה."
              : "השבוע ייווצר תחת קורס זה בלבד, כטיוטה שאינה מפורסמת לחניכים."}
          </p>

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
              <Button type="submit" disabled={isPending}>
                {isPending ? "מפענח..." : "פענוח קובץ"}
              </Button>
            </form>
          )}

          {parsedItems && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <p className="shrink-0 text-sm text-muted-foreground">
                נמצאו {parsedItems.length} שורות, מתוכן {importableCount} עם תאריך תקין
                שיישמרו. שורות ללא תאריך תקין ידולגו.
              </p>
              {parseWarning && (
                <div className="shrink-0 rounded-lg bg-warning-muted p-3 text-sm text-warning">
                  {parseWarning}
                </div>
              )}
              {hasMalformedCombined && (
                <div className="shrink-0 rounded-lg border border-danger bg-danger-muted p-3 text-sm text-danger">
                  יש להזין בעמודת משולב רק כן, לא, או להשאיר ריק.
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
                {groupedParsedItems.map(([groupKey, rowsForDate]) => (
                  <div key={groupKey} className="border-b border-border last:border-0">
                    <div className="sticky top-0 z-10 bg-secondary px-4 py-2.5 text-sm font-bold text-secondary-foreground">
                      {groupKey === "__no_date__"
                        ? "שורות ללא תאריך תקין (ידולגו)"
                        : formatHebrewDate(parseDateKey(groupKey))}
                    </div>
                    <ul className="flex flex-col gap-1 p-3">
                      {rowsForDate.map((item) => {
                        const malformed = isCombinedParticipationMalformed(item);
                        return (
                          <li
                            key={item.key}
                            className={`rounded border px-2 py-1.5 text-xs text-card-foreground ${
                              malformed ? "border-danger bg-danger-muted" : "border-border"
                            }`}
                          >
                            <span className="font-medium">
                              {item.startTime || "--:--"}-{item.endTime || "--:--"}
                            </span>{" "}
                            · {item.groupName.trim() ? `קבוצה ${item.groupName}` : "כל הקבוצות"} ·{" "}
                            {item.title || "ללא כותרת"}
                            {item.instructorName ? ` · ${item.instructorName}` : ""}
                            {item.location ? ` · ${item.location}` : ""}
                            {malformed && (
                              <span className="mt-1 block text-danger">
                                יש להזין בעמודת משולב רק כן, לא, או להשאיר ריק.
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p className="shrink-0 text-sm text-danger">{error}</p>}
          {summary && <p className="shrink-0 text-sm text-success">{summary}</p>}

          {parsedItems && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={isPending}
                onClick={() => setParsedItems(null)}
              >
                ביטול
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={isPending || hasMalformedCombined}
              >
                {isPending ? "שומר..." : uploadTarget ? "שמירת הייבוא מחדש" : "יצירת השבוע"}
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
