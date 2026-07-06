"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { getScheduleGroupColorClass } from "@/lib/schedule-group-colors";
import { STATUS_BADGE_CLASS } from "@/lib/attendance-ui";
import { formatHebrewDateTime } from "@/lib/dates";
import {
  getKnownHayTypes,
  getKnownConcentrateTypes,
  getKnownConcentrateAmounts,
  type HorseFeedingOverviewRow,
  type HorseFeedingUpsertInput,
} from "@/lib/actions/horse-feeding";
import type { ActionResult } from "@/lib/actions/students";

interface MealFormState {
  hayType: string;
  concentrateType: string;
  concentrateAmount: string;
  notes: string;
}

const EMPTY_MEAL: MealFormState = { hayType: "", concentrateType: "", concentrateAmount: "", notes: "" };

function mealToForm(
  meal: { hayType: string | null; concentrateType: string | null; concentrateAmount: string | null; notes: string | null } | null
): MealFormState {
  if (!meal) return EMPTY_MEAL;
  return {
    hayType: meal.hayType ?? "",
    concentrateType: meal.concentrateType ?? "",
    concentrateAmount: meal.concentrateAmount ?? "",
    notes: meal.notes ?? "",
  };
}

// One meal's compact display line - omits fields that are empty rather than
// showing "-", and only renders at all when at least one field is set. The
// concentrate fields are always labeled "...מזון מרוכז" so they can never be
// mistaken for a hay amount (hay itself has no separate quantity field).
function MealSummaryLine({ label, meal }: { label: string; meal: { hayType: string | null; concentrateType: string | null; concentrateAmount: string | null; notes: string | null } | null }) {
  if (!meal) return null;
  const parts: string[] = [];
  if (meal.hayType) parts.push(`חציר: ${meal.hayType}`);
  if (meal.concentrateType) parts.push(`סוג מזון מרוכז: ${meal.concentrateType}`);
  if (meal.concentrateAmount) parts.push(`כמות מזון מרוכז: ${meal.concentrateAmount}`);
  return (
    <div className="text-sm">
      <span className="font-semibold text-card-foreground">{label}: </span>
      <span className="text-muted-foreground">{parts.length > 0 ? parts.join(" · ") : "אין פרטים"}</span>
      {meal.notes && <p className="mt-0.5 text-xs text-muted-foreground">הערות: {meal.notes}</p>}
    </div>
  );
}

// A free-text input with a lightweight, self-contained suggestions dropdown -
// used instead of the native <input list> + <datalist> combo, which has
// spotty/inconsistent support (notably on mobile Safari) and doesn't
// reliably show Hebrew suggestions everywhere. Typing a value not in
// `suggestions` is always allowed and never blocked; clicking a suggestion
// just fills the input, it doesn't "select" anything exclusive.
function SuggestInput({
  value,
  onChange,
  suggestions,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = q
      ? suggestions.filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
      : suggestions;
    return list.slice(0, 8);
  }, [value, suggestions]);

  return (
    <div ref={containerRef} className="relative min-w-0 w-full">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-lg border border-border px-3 py-2 text-sm"
      />
      {isOpen && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(s);
                setIsOpen(false);
              }}
              className="block w-full px-3 py-2 text-right text-sm hover:bg-muted"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HorseFeedingSection({
  canEdit,
  fetchOverview,
  onSave,
}: {
  canEdit: boolean;
  fetchOverview: () => Promise<HorseFeedingOverviewRow[]>;
  onSave: (input: HorseFeedingUpsertInput) => Promise<ActionResult>;
}) {
  const [rows, setRows] = useState<HorseFeedingOverviewRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [knownHayTypes, setKnownHayTypes] = useState<string[]>([]);
  const [knownConcentrateTypes, setKnownConcentrateTypes] = useState<string[]>([]);
  const [knownConcentrateAmounts, setKnownConcentrateAmounts] = useState<string[]>([]);

  const [modalRow, setModalRow] = useState<HorseFeedingOverviewRow | "new" | null>(null);
  const [horseName, setHorseName] = useState("");
  const [morning, setMorning] = useState<MealFormState>(EMPTY_MEAL);
  const [evening, setEvening] = useState<MealFormState>(EMPTY_MEAL);
  const [hasLunch, setHasLunch] = useState(false);
  const [lunch, setLunch] = useState<MealFormState>(EMPTY_MEAL);
  // "shared": morning/evening use one combined concentrateType+concentrateAmount
  // section (the common case). "separate": each keeps its own, used
  // automatically when existing saved values differ so nothing is silently
  // merged/lost, or manually via the toggle link below. Lunch never
  // participates in this - it always keeps its own independent concentrate
  // fields, since it's an optional extra meal that may differ on purpose.
  const [concentrateMode, setConcentrateMode] = useState<"shared" | "separate">("shared");
  const [sharedConcentrateType, setSharedConcentrateType] = useState("");
  const [sharedConcentrateAmount, setSharedConcentrateAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function load() {
    setLoadError(null);
    fetchOverview()
      .then(setRows)
      .catch(() => {
        setRows([]);
        setLoadError("שגיאה בטעינת רשימת ההאכלות. נסו לרענן.");
      });
  }

  function loadKnownValues() {
    if (!canEdit) return;
    getKnownHayTypes().then(setKnownHayTypes);
    getKnownConcentrateTypes().then(setKnownConcentrateTypes);
    getKnownConcentrateAmounts().then(setKnownConcentrateAmounts);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadKnownValues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.horseName.toLowerCase().includes(q));
  }, [rows, search]);

  function openEdit(row: HorseFeedingOverviewRow) {
    setError(null);
    setModalRow(row);
    setHorseName(row.horseName);
    setMorning(mealToForm(row.morning));
    setEvening(mealToForm(row.evening));
    setHasLunch(row.lunch !== null);
    setLunch(mealToForm(row.lunch));

    const morningType = row.morning?.concentrateType ?? "";
    const eveningType = row.evening?.concentrateType ?? "";
    const morningAmount = row.morning?.concentrateAmount ?? "";
    const eveningAmount = row.evening?.concentrateAmount ?? "";
    if (morningType === eveningType && morningAmount === eveningAmount) {
      setConcentrateMode("shared");
      setSharedConcentrateType(morningType);
      setSharedConcentrateAmount(morningAmount);
    } else {
      // Existing morning/evening concentrate type/amount differ - never
      // silently merge them, show both separately until someone explicitly
      // chooses to share.
      setConcentrateMode("separate");
      setSharedConcentrateType("");
      setSharedConcentrateAmount("");
    }
  }

  function openNew() {
    setError(null);
    setModalRow("new");
    setHorseName("");
    setMorning(EMPTY_MEAL);
    setEvening(EMPTY_MEAL);
    setHasLunch(false);
    setLunch(EMPTY_MEAL);
    setConcentrateMode("shared");
    setSharedConcentrateType("");
    setSharedConcentrateAmount("");
  }

  function toggleConcentrateMode() {
    if (concentrateMode === "shared") {
      setMorning((v) => ({ ...v, concentrateType: sharedConcentrateType, concentrateAmount: sharedConcentrateAmount }));
      setEvening((v) => ({ ...v, concentrateType: sharedConcentrateType, concentrateAmount: sharedConcentrateAmount }));
      setConcentrateMode("separate");
    } else {
      setSharedConcentrateType(morning.concentrateType);
      setSharedConcentrateAmount(morning.concentrateAmount);
      setConcentrateMode("shared");
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const morningToSave =
      concentrateMode === "shared"
        ? { ...morning, concentrateType: sharedConcentrateType, concentrateAmount: sharedConcentrateAmount }
        : morning;
    const eveningToSave =
      concentrateMode === "shared"
        ? { ...evening, concentrateType: sharedConcentrateType, concentrateAmount: sharedConcentrateAmount }
        : evening;
    startTransition(async () => {
      const result = await onSave({
        horseName,
        morning: morningToSave,
        evening: eveningToSave,
        hasLunch,
        lunch,
      });
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      setModalRow(null);
      load();
      // A newly-typed hay/concentrate type only becomes a suggestion for the
      // *next* horse once this refetches - without it, knownHayTypes stayed
      // frozen at whatever existed when the section first mounted.
      loadKnownValues();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {!canEdit && (
        <p className="text-xs text-muted-foreground">תצוגה בלבד - אין הרשאת עריכת האכלות</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש לפי שם סוס..."
          className="flex-1 rounded-lg border border-border px-3 py-2 text-sm"
        />
        {canEdit && (
          <Button onClick={openNew} className="!px-3 !py-2 !text-sm">
            + הוספת סוס
          </Button>
        )}
      </div>

      {loadError && <p className="rounded-lg bg-danger-muted p-3 text-sm text-danger">{loadError}</p>}

      {rows === null ? (
        <p className="text-sm text-muted-foreground">טוען...</p>
      ) : filteredRows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          {rows.length === 0 ? "עדיין לא הוזנו הוראות האכלה" : "אין סוסים התואמים את החיפוש"}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredRows.map((row) => (
            <div
              key={row.horseName}
              className={`rounded-xl border-2 p-3 ${getScheduleGroupColorClass(row.responsibleStudent?.groupName ?? null)}`}
            >
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <p className="text-base font-bold text-card-foreground">{row.horseName}</p>
                {canEdit && (
                  <Button
                    variant="ghost"
                    className="!px-2 !py-1 !text-xs"
                    onClick={() => openEdit(row)}
                  >
                    עריכה
                  </Button>
                )}
              </div>

              {row.responsibleStudent && (
                <p className="mb-1 text-xs text-muted-foreground">
                  חניך/ה אחראי/ת: {row.responsibleStudent.fullName}
                  {row.responsibleStudent.groupName ? ` · קבוצה ${row.responsibleStudent.groupName}` : ""}
                  {row.responsibleStudent.subgroupNumber != null
                    ? ` / תת-קבוצה ${row.responsibleStudent.subgroupNumber}`
                    : ""}
                </p>
              )}

              {row.attendanceStatus === "ABSENT" && (
                <span
                  className={`mb-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS.ABSENT}`}
                >
                  נעדר/ת היום
                </span>
              )}
              {row.attendanceStatus === "PARTIAL" && (
                <span
                  className={`mb-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS.PARTIAL}`}
                >
                  נוכחות חלקית
                  {(row.attendanceArrivalTime || row.attendanceDepartureTime) && (
                    <>
                      {" "}
                      · {row.attendanceArrivalTime && `הגעה: ${row.attendanceArrivalTime}`}
                      {row.attendanceArrivalTime && row.attendanceDepartureTime && " · "}
                      {row.attendanceDepartureTime && `יציאה: ${row.attendanceDepartureTime}`}
                    </>
                  )}
                </span>
              )}
              {row.attendanceNotes && (
                <p className="mb-1 text-xs text-card-foreground">הערת נוכחות: {row.attendanceNotes}</p>
              )}

              <div className="flex flex-col gap-1 rounded-lg bg-card p-2">
                <MealSummaryLine label="בוקר" meal={row.morning} />
                {row.lunch && <MealSummaryLine label="צהריים" meal={row.lunch} />}
                <MealSummaryLine label="ערב" meal={row.evening} />
              </div>

              {(row.updatedByName || row.updatedAt) && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {row.updatedByName && `עודכן על ידי: ${row.updatedByName}`}
                  {row.updatedByName && row.updatedAt && " · "}
                  {row.updatedAt && `עודכן בתאריך: ${formatHebrewDateTime(new Date(row.updatedAt))}`}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <Modal
          size="wide"
          open={modalRow !== null}
          title={modalRow === "new" ? "הוספת סוס - האכלה" : `עריכת האכלה - ${horseName}`}
          onClose={() => setModalRow(null)}
        >
          <form
            onSubmit={handleSubmit}
            className="flex max-h-[70vh] max-w-full min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden ps-1"
          >
            <label className="flex min-w-0 flex-col gap-1 text-sm">
              שם הסוס
              <input
                value={horseName}
                onChange={(e) => setHorseName(e.target.value)}
                disabled={modalRow !== "new"}
                required
                className="w-full rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-60"
              />
            </label>

            <HayFields
              title="חציר - בוקר"
              hayType={morning.hayType}
              notes={morning.notes}
              onHayTypeChange={(v) => setMorning((m) => ({ ...m, hayType: v }))}
              onNotesChange={(v) => setMorning((m) => ({ ...m, notes: v }))}
              knownHayTypes={knownHayTypes}
            />
            <HayFields
              title="חציר - ערב"
              hayType={evening.hayType}
              notes={evening.notes}
              onHayTypeChange={(v) => setEvening((m) => ({ ...m, hayType: v }))}
              onNotesChange={(v) => setEvening((m) => ({ ...m, notes: v }))}
              knownHayTypes={knownHayTypes}
            />

            <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-sm font-semibold text-card-foreground">מזון מרוכז - בוקר וערב</p>
                <button
                  type="button"
                  onClick={toggleConcentrateMode}
                  className="shrink-0 text-xs text-muted-foreground underline decoration-dotted"
                >
                  {concentrateMode === "shared" ? "הגדרת ערכים נפרדים לבוקר ולערב" : "מיזוג לערך משותף"}
                </button>
              </div>
              {concentrateMode === "shared" ? (
                <ConcentrateFields
                  concentrateType={sharedConcentrateType}
                  concentrateAmount={sharedConcentrateAmount}
                  onTypeChange={setSharedConcentrateType}
                  onAmountChange={setSharedConcentrateAmount}
                  knownConcentrateTypes={knownConcentrateTypes}
                  knownConcentrateAmounts={knownConcentrateAmounts}
                />
              ) : (
                <>
                  <p className="text-[11px] text-muted-foreground">
                    הערכים לבוקר ולערב שונים כרגע - ניתן לערוך כל אחד בנפרד.
                  </p>
                  <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
                    <ConcentrateFields
                      title="בוקר"
                      concentrateType={morning.concentrateType}
                      concentrateAmount={morning.concentrateAmount}
                      onTypeChange={(v) => setMorning((m) => ({ ...m, concentrateType: v }))}
                      onAmountChange={(v) => setMorning((m) => ({ ...m, concentrateAmount: v }))}
                      knownConcentrateTypes={knownConcentrateTypes}
                      knownConcentrateAmounts={knownConcentrateAmounts}
                    />
                    <ConcentrateFields
                      title="ערב"
                      concentrateType={evening.concentrateType}
                      concentrateAmount={evening.concentrateAmount}
                      onTypeChange={(v) => setEvening((m) => ({ ...m, concentrateType: v }))}
                      onAmountChange={(v) => setEvening((m) => ({ ...m, concentrateAmount: v }))}
                      knownConcentrateTypes={knownConcentrateTypes}
                      knownConcentrateAmounts={knownConcentrateAmounts}
                    />
                  </div>
                </>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
              <input
                type="checkbox"
                checked={hasLunch}
                onChange={(e) => setHasLunch(e.target.checked)}
              />
              יש ארוחת צהריים
            </label>
            {hasLunch && (
              <MealFormFields
                title="צהריים"
                value={lunch}
                onChange={setLunch}
                knownHayTypes={knownHayTypes}
                knownConcentrateTypes={knownConcentrateTypes}
                knownConcentrateAmounts={knownConcentrateAmounts}
              />
            )}

            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setModalRow(null)}>
                ביטול
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "שומר..." : "שמירה"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// Hay + general notes for one main meal (morning/evening). Concentrate feed
// lives in its own shared/separate section below, not inside this block.
function HayFields({
  title,
  hayType,
  notes,
  onHayTypeChange,
  onNotesChange,
  knownHayTypes,
}: {
  title: string;
  hayType: string;
  notes: string;
  onHayTypeChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  knownHayTypes: string[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-2.5">
      <p className="text-sm font-semibold text-card-foreground">{title}</p>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        חציר
        <SuggestInput
          value={hayType}
          onChange={onHayTypeChange}
          suggestions={knownHayTypes}
          placeholder="לדוגמה: ערב-דגן"
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        הערות (אופציונלי)
        <input
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
      </label>
    </div>
  );
}

// Concentrate feed type + amount, used either once (shared mode) or twice
// (separate mode, with a title per meal). Both fields stay optional free
// text - concentrateType never a closed list, concentrateAmount never numeric.
function ConcentrateFields({
  title,
  concentrateType,
  concentrateAmount,
  onTypeChange,
  onAmountChange,
  knownConcentrateTypes,
  knownConcentrateAmounts,
}: {
  title?: string;
  concentrateType: string;
  concentrateAmount: string;
  onTypeChange: (value: string) => void;
  onAmountChange: (value: string) => void;
  knownConcentrateTypes: string[];
  knownConcentrateAmounts: string[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {title && <p className="text-xs font-semibold text-card-foreground">{title}</p>}
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        סוג/הערות מזון מרוכז (אופציונלי)
        <SuggestInput value={concentrateType} onChange={onTypeChange} suggestions={knownConcentrateTypes} />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        כמות מזון מרוכז (אופציונלי, טקסט חופשי)
        <SuggestInput
          value={concentrateAmount}
          onChange={onAmountChange}
          suggestions={knownConcentrateAmounts}
          placeholder="לדוגמה: 1/4, חופן"
        />
      </label>
    </div>
  );
}

// Only used for lunch now - the one optional extra meal that always keeps
// its own independent hay + concentrate fields together, since it may
// differ from the main meals on purpose.
function MealFormFields({
  title,
  value,
  onChange,
  knownHayTypes,
  knownConcentrateTypes,
  knownConcentrateAmounts,
}: {
  title: string;
  value: MealFormState;
  onChange: (value: MealFormState) => void;
  knownHayTypes: string[];
  knownConcentrateTypes: string[];
  knownConcentrateAmounts: string[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-2.5">
      <p className="text-sm font-semibold text-card-foreground">{title}</p>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        חציר
        <SuggestInput
          value={value.hayType}
          onChange={(v) => onChange({ ...value, hayType: v })}
          suggestions={knownHayTypes}
          placeholder="לדוגמה: ערב-דגן"
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        סוג/הערות מזון מרוכז (אופציונלי)
        <SuggestInput
          value={value.concentrateType}
          onChange={(v) => onChange({ ...value, concentrateType: v })}
          suggestions={knownConcentrateTypes}
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        כמות מזון מרוכז (אופציונלי, טקסט חופשי)
        <SuggestInput
          value={value.concentrateAmount}
          onChange={(v) => onChange({ ...value, concentrateAmount: v })}
          suggestions={knownConcentrateAmounts}
          placeholder="לדוגמה: 1/4, חופן"
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        הערות (אופציונלי)
        <input
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
      </label>
    </div>
  );
}
