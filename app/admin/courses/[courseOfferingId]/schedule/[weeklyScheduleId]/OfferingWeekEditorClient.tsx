"use client";

/**
 * MULTI-COURSE Schedule Slice W-S3B - the NARROW client surface of the
 * offering-scoped weekly-schedule VIEW/EDIT route.
 *
 * Deliberately NOT the Level 1 WeeklyScheduleDetailClient: this component
 * implements ONLY view + metadata edit + per-item add/edit/delete. It imports no
 * riding management, no duty generation, no no-duty marking, no Excel export, no
 * publication toggle, and no legacy ScheduleTimeGrid merged-row behaviour - those
 * are not merely hidden, they are not importable from this module.
 *
 * The offering is never named by this component. Every mutation is an
 * already-bound server action (the page binds the validated offering id, and the
 * week id where relevant); there is no offering field and no offering selector.
 *
 * Publication is DISPLAYED ONLY - a read-only chip. There is no toggle: a Level 2
 * PLANNED offering cannot be published (SCHEDULE_PUBLICATION is denied for
 * PLANNED), and publication is a separate offering-scoped action for a later
 * slice. The legacy unscoped setWeeklySchedulePublished is never referenced.
 *
 * Instructor/coach names are the free-text ScheduleItem.instructorName exactly as
 * stored (and as imported from the Excel instructor column) - shown on every item
 * and editable in the item form. Blank stays blank; no free-text name is ever
 * resolved to an Instructor id (no such relation exists on ScheduleItem).
 */
import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { formatHebrewDate, formatHebrewWeekday, parseDateKey } from "@/lib/dates";
import type { ScheduleItemInput, ScheduleItemRow } from "@/lib/actions/schedule-items";

export interface OfferingWeekEditorView {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  uploadedFileName: string;
  isPublished: boolean;
  items: ScheduleItemRow[];
}

type MetadataAction = (input: {
  name: string;
  startDate: string;
  endDate: string;
}) => Promise<
  { success: true; weeklyScheduleId: string } | { success: false; error: string }
>;

type CreateItemAction = (
  input: ScheduleItemInput,
) => Promise<{ success: boolean; error?: string; item?: ScheduleItemRow }>;

type UpdateItemAction = (
  itemId: string,
  input: ScheduleItemInput,
) => Promise<{ success: boolean; error?: string; item?: ScheduleItemRow }>;

type DeleteItemAction = (
  itemId: string,
) => Promise<{ success: boolean; error?: string }>;

/**
 * Stable ownership/metadata code -> Hebrew message. An unmapped value is a
 * delegated schedule-item validation message (already user-safe Hebrew), so it is
 * shown verbatim; a missing value falls back to the generic message.
 */
const ERROR_MESSAGES: Record<string, string> = {
  offering_not_found: "הקורס אינו זמין. יש לרענן את הדף.",
  operation_not_allowed: "לא ניתן לערוך לוז בקורס במצב זה.",
  week_not_found: "הפריט המבוקש אינו שייך לקורס זה. יש לרענן את הדף.",
  name_required: "יש להזין שם לשבוע.",
  dates_required: "יש להזין תאריך התחלה ותאריך סיום.",
  invalid_date: "אחד התאריכים אינו תקין.",
  end_before_start: "תאריך הסיום חייב להיות אחרי תאריך ההתחלה.",
};

function errorMessage(code: string | undefined): string {
  if (!code) return "אירעה שגיאה. נסו שוב.";
  return ERROR_MESSAGES[code] ?? code;
}

const EMPTY_ITEM_FORM: ScheduleItemInput = {
  dateKey: "",
  startTime: "",
  endTime: "",
  title: "",
  groupName: "",
  instructorName: "",
  location: "",
  description: "",
  combinedParticipation: null,
};

// Tri-state "משולב" <-> <select> string value. null = default/no restriction.
const COMBINED_DEFAULT = "default";
const COMBINED_YES = "yes";
const COMBINED_NO = "no";

function combinedToSelectValue(value: boolean | null | undefined): string {
  if (value === true) return COMBINED_YES;
  if (value === false) return COMBINED_NO;
  return COMBINED_DEFAULT;
}

function selectValueToCombined(value: string): boolean | null {
  if (value === COMBINED_YES) return true;
  if (value === COMBINED_NO) return false;
  return null;
}

export function OfferingWeekEditorClient({
  week,
  canEdit,
  backHref,
  updateMetadataAction,
  createItemAction,
  updateItemAction,
  deleteItemAction,
}: {
  week: OfferingWeekEditorView;
  canEdit: boolean;
  backHref: string;
  updateMetadataAction: MetadataAction;
  createItemAction: CreateItemAction;
  updateItemAction: UpdateItemAction;
  deleteItemAction: DeleteItemAction;
}) {
  const router = useRouter();

  const [items, setItems] = useState<ScheduleItemRow[]>(week.items);
  const [meta, setMeta] = useState({
    name: week.name,
    startDate: week.startDate,
    endDate: week.endDate,
  });

  // Resync when the server-provided week prop changes (e.g. a revalidated
  // refetch). Local handlers patch state directly for immediate feedback; this
  // only covers the external-update case.
  // Deliberate resync of local editable state when the server re-provides the week
  // prop (after a router.refresh()); local handlers already patch state directly for
  // immediate feedback, so this only reconciles an external/concurrent update.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(week.items);
    setMeta({ name: week.name, startDate: week.startDate, endDate: week.endDate });
  }, [week]);

  // ---- metadata modal ----
  const [metaOpen, setMetaOpen] = useState(false);
  const [metaForm, setMetaForm] = useState(meta);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [isSavingMeta, startMetaTransition] = useTransition();

  function openMeta() {
    setMetaForm(meta);
    setMetaError(null);
    setMetaOpen(true);
  }

  function handleMetaSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMetaError(null);
    startMetaTransition(async () => {
      const result = await updateMetadataAction({
        name: metaForm.name,
        startDate: metaForm.startDate,
        endDate: metaForm.endDate,
      });
      if (!result.success) {
        setMetaError(errorMessage(result.error));
        return;
      }
      setMeta({ ...metaForm });
      setMetaOpen(false);
      router.refresh();
    });
  }

  // ---- item modal ----
  const [itemModal, setItemModal] = useState<ScheduleItemRow | "new" | null>(null);
  const [itemForm, setItemForm] = useState<ScheduleItemInput>(EMPTY_ITEM_FORM);
  const [itemError, setItemError] = useState<string | null>(null);
  const [isSavingItem, startItemTransition] = useTransition();

  function openCreateItem() {
    setItemModal("new");
    setItemForm({ ...EMPTY_ITEM_FORM });
    setItemError(null);
  }

  function openEditItem(item: ScheduleItemRow) {
    setItemModal(item);
    setItemForm({
      dateKey: item.dateKey,
      startTime: item.startTime,
      endTime: item.endTime,
      title: item.title,
      groupName: item.groupName ?? "",
      instructorName: item.instructorName ?? "",
      location: item.location ?? "",
      description: item.description ?? "",
      combinedParticipation: item.combinedParticipation ?? null,
    });
    setItemError(null);
  }

  function handleItemSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setItemError(null);
    startItemTransition(async () => {
      const result =
        itemModal && itemModal !== "new"
          ? await updateItemAction(itemModal.id, itemForm)
          : await createItemAction(itemForm);
      if (!result.success || !result.item) {
        setItemError(errorMessage(result.error));
        return;
      }
      const saved = result.item;
      setItems((prev) => {
        if (itemModal && itemModal !== "new") {
          return prev.map((i) => (i.id === saved.id ? saved : i));
        }
        return [...prev, saved];
      });
      setItemModal(null);
      router.refresh();
    });
  }

  // ---- delete modal ----
  const [deleteTarget, setDeleteTarget] = useState<ScheduleItemRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    const id = deleteTarget.id;
    startDeleteTransition(async () => {
      const result = await deleteItemAction(id);
      if (!result.success) {
        setDeleteError(errorMessage(result.error));
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
      setDeleteTarget(null);
      router.refresh();
    });
  }

  const itemsByDay = useMemo(() => {
    const sorted = [...items].sort((a, b) =>
      (a.dateKey + a.startTime).localeCompare(b.dateKey + b.startTime),
    );
    const map = new Map<string, ScheduleItemRow[]>();
    for (const item of sorted) {
      if (!map.has(item.dateKey)) map.set(item.dateKey, []);
      map.get(item.dateKey)!.push(item);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={backHref}
            className="text-sm text-muted-foreground underline hover:text-card-foreground"
          >
            &larr; חזרה ללוז הקורס
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-bold text-card-foreground">
            {meta.name}
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                week.isPublished
                  ? "bg-success-muted text-success"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {week.isPublished ? "מפורסם לחניכים" : "טיוטה — לא מפורסם"}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatHebrewDate(parseDateKey(meta.startDate))} -{" "}
            {formatHebrewDate(parseDateKey(meta.endDate))} · {items.length} פריטי לו&quot;ז
            {week.uploadedFileName ? ` · ${week.uploadedFileName}` : ""}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={openMeta}>
              עריכת פרטי השבוע
            </Button>
            <Button onClick={openCreateItem}>+ הוספת פריט</Button>
          </div>
        )}
      </div>

      {!canEdit && (
        <div className="rounded-xl border border-dashed border-border bg-muted p-4">
          <p className="text-sm text-muted-foreground">
            לא ניתן לערוך לוז בקורס במצב זה. הלו&quot;ז מוצג לקריאה בלבד.
          </p>
        </div>
      )}

      {itemsByDay.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          אין פריטים להצגה בשבוע זה.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {itemsByDay.map(([dk, dayItems]) => (
            <div key={dk} className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-3 rounded-lg bg-secondary px-3 py-2 text-base font-bold text-secondary-foreground">
                {formatHebrewWeekday(parseDateKey(dk))} · {formatHebrewDate(parseDateKey(dk))}
              </div>
              <div className="flex flex-col gap-3">
                {dayItems.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border p-4">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-card-foreground">
                        {item.startTime}-{item.endTime}
                      </span>
                      <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                        {item.groupName ? `קבוצה ${item.groupName}` : "כל הקבוצות"}
                      </span>
                    </div>
                    <p className="text-lg font-bold text-card-foreground">
                      {item.title || "ללא כותרת"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      מדריך/ה: {item.instructorName ? item.instructorName : "—"}
                    </p>
                    {item.location && (
                      <p className="text-sm text-muted-foreground">מיקום: {item.location}</p>
                    )}
                    {item.description && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                        {item.description}
                      </p>
                    )}
                    {canEdit && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          variant="ghost"
                          className="!px-2 !py-1 !text-xs"
                          onClick={() => openEditItem(item)}
                        >
                          עריכה
                        </Button>
                        <Button
                          variant="danger"
                          className="!px-2 !py-1 !text-xs"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget(item);
                          }}
                        >
                          מחיקה
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---- metadata modal ---- */}
      <Modal open={metaOpen} title="עריכת פרטי השבוע" onClose={() => setMetaOpen(false)}>
        <form onSubmit={handleMetaSubmit} className="flex flex-col gap-3">
          <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            עדכון שם השבוע וטווח התאריכים בלבד. פריטי הלו&quot;ז ומצב הפרסום אינם משתנים.
          </p>
          <label className="flex flex-col gap-1 text-sm">
            שם השבוע
            <input
              value={metaForm.name}
              onChange={(e) => setMetaForm((f) => ({ ...f, name: e.target.value }))}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              מתאריך
              <input
                type="date"
                value={metaForm.startDate}
                onChange={(e) => setMetaForm((f) => ({ ...f, startDate: e.target.value }))}
                className="rounded-lg border border-border px-3 py-2 text-sm"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              עד תאריך
              <input
                type="date"
                value={metaForm.endDate}
                onChange={(e) => setMetaForm((f) => ({ ...f, endDate: e.target.value }))}
                className="rounded-lg border border-border px-3 py-2 text-sm"
                required
              />
            </label>
          </div>
          {metaError && <p className="text-sm text-danger">{metaError}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setMetaOpen(false)}>
              ביטול
            </Button>
            <Button type="submit" disabled={isSavingMeta}>
              {isSavingMeta ? "שומר..." : "שמירה"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ---- item modal ---- */}
      <Modal
        open={itemModal !== null}
        title={itemModal === "new" ? 'הוספת פריט לו"ז' : 'עריכת פריט לו"ז'}
        onClose={() => setItemModal(null)}
      >
        <form onSubmit={handleItemSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              תאריך
              <input
                type="date"
                value={itemForm.dateKey}
                onChange={(e) => setItemForm((f) => ({ ...f, dateKey: e.target.value }))}
                className="rounded-lg border border-border px-3 py-2 text-sm"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              שעת התחלה
              <input
                value={itemForm.startTime}
                onChange={(e) => setItemForm((f) => ({ ...f, startTime: e.target.value }))}
                placeholder="HH:MM"
                className="rounded-lg border border-border px-3 py-2 text-sm"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              שעת סיום
              <input
                value={itemForm.endTime}
                onChange={(e) => setItemForm((f) => ({ ...f, endTime: e.target.value }))}
                placeholder="HH:MM"
                className="rounded-lg border border-border px-3 py-2 text-sm"
                required
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            קבוצה (ריק = כל הקבוצות)
            <input
              value={itemForm.groupName}
              onChange={(e) => setItemForm((f) => ({ ...f, groupName: e.target.value }))}
              placeholder="א / ב"
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            משולב
            <select
              value={combinedToSelectValue(itemForm.combinedParticipation)}
              onChange={(e) =>
                setItemForm((f) => ({
                  ...f,
                  combinedParticipation: selectValueToCombined(e.target.value),
                }))
              }
              className="rounded-lg border border-border px-3 py-2 text-sm"
            >
              <option value={COMBINED_DEFAULT}>ברירת מחדל (ללא הגבלה)</option>
              <option value={COMBINED_YES}>כן</option>
              <option value={COMBINED_NO}>לא</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            כותרת פעילות
            <input
              value={itemForm.title}
              onChange={(e) => setItemForm((f) => ({ ...f, title: e.target.value }))}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              מדריך/ה
              <input
                value={itemForm.instructorName}
                onChange={(e) => setItemForm((f) => ({ ...f, instructorName: e.target.value }))}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              מיקום
              <input
                value={itemForm.location}
                onChange={(e) => setItemForm((f) => ({ ...f, location: e.target.value }))}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            הערות (אופציונלי)
            <textarea
              value={itemForm.description}
              onChange={(e) => setItemForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>

          {itemError && <p className="text-sm text-danger">{itemError}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setItemModal(null)}>
              ביטול
            </Button>
            <Button type="submit" disabled={isSavingItem}>
              {isSavingItem ? "שומר..." : "שמירה"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ---- delete confirm ---- */}
      <Modal
        open={deleteTarget !== null}
        title='מחיקת פריט לו"ז'
        onClose={() => setDeleteTarget(null)}
      >
        <p className="text-sm text-card-foreground">
          האם למחוק את הפריט &quot;{deleteTarget?.title || "ללא כותרת"}&quot; (
          {deleteTarget?.startTime}-{deleteTarget?.endTime})? הפעולה אינה הפיכה.
        </p>
        {deleteError && <p className="mt-2 text-sm text-danger">{deleteError}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setDeleteTarget(null)}>
            ביטול
          </Button>
          <Button type="button" variant="danger" disabled={isDeleting} onClick={handleConfirmDelete}>
            {isDeleting ? "מוחק..." : "מחיקה"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
