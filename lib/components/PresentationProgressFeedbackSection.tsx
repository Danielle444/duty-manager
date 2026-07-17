"use client";

import { useState, useTransition } from "react";
import { formatHebrewDate, formatHebrewDateTime, parseDateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";
import type {
  StudentPresentationProgressFeedbackInput,
  StudentPresentationProgressFeedbackRow,
} from "@/lib/actions/student-presentation-progress-feedback";
import {
  PRESENTATION_BASE_SCORE,
  PRESENTATION_CATEGORY_KEYS,
  PRESENTATION_CATEGORY_LABELS,
  PRESENTATION_CATEGORY_SCORE_OPTIONS,
  PRESENTATION_PASSING_SCORE,
  defaultPresentationCategoryScores,
  sumPresentationCategoryScores,
  type PresentationCategoryScoreValue,
  type PresentationCategoryScores,
} from "@/lib/presentation-rubric";

// Extracted from app/admin/trainee-progress/TraineeProgressClient.tsx, same
// Stage I2 extraction precedent as RidingProgressFeedbackSection.tsx/
// LungeProgressFeedbackSection.tsx (see those files' own comments) - this
// was the one topic left inline "next stage" when that extraction happened,
// since the instructor screen didn't wire it in yet even though
// lib/actions/student-presentation-progress-feedback-instructor.ts's CRUD
// actions already existed. This is that stage: the instructor trainee-
// progress detail view now reuses this exact component (with the
// *AsInstructor actions passed through the `actions` prop, gated to
// canEditRidingNotes) so presentation editing is never a second,
// independently-implemented form.

function todayDateInputValue(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

interface PresentationProgressFormValues {
  date: string;
  feedback: string;
  topic: string;
  presentationType: string;
  categoryScores: PresentationCategoryScores;
}

function emptyPresentationProgressForm(): PresentationProgressFormValues {
  return {
    date: todayDateInputValue(),
    feedback: "",
    topic: "",
    presentationType: "",
    categoryScores: defaultPresentationCategoryScores(),
  };
}

function presentationProgressFormToInput(
  values: PresentationProgressFormValues
): StudentPresentationProgressFeedbackInput {
  return {
    date: values.date,
    feedback: values.feedback.trim() || null,
    topic: values.topic.trim() || null,
    presentationType: values.presentationType.trim() || null,
    categoryScores: values.categoryScores,
  };
}

// Mirrors the server's own "meaningful content" guard (see
// hasMeaningfulContent in lib/actions/student-presentation-progress-feedback.ts
// and its *-instructor.ts sibling) - checked here too so the caller gets an
// immediate, specific Hebrew error instead of a round-trip just to learn the
// same thing. Same rule for both admin and instructor callers.
function hasPresentationProgressFormContent(values: PresentationProgressFormValues): boolean {
  return (
    values.feedback.trim() !== "" ||
    values.topic.trim() !== "" ||
    values.presentationType.trim() !== "" ||
    PRESENTATION_CATEGORY_KEYS.some((key) => values.categoryScores[key] !== 0)
  );
}

// Live, client-side-only preview of PRESENTATION_BASE_SCORE + sum(category
// values) - purely informational (the authoritative finalScore is always
// recomputed server-side, never trusted from here).
function computeFormFinalScorePreview(values: PresentationProgressFormValues): number {
  return PRESENTATION_BASE_SCORE + sumPresentationCategoryScores(values.categoryScores);
}

// Formats a per-category value with an explicit sign, e.g. "+1"/"-0.5"/"0" -
// shared by the rubric editor's <option> labels and every read-only display
// of a category value (list card breakdown, live preview) so the sign
// convention never drifts between them.
function formatCategoryScoreValue(value: PresentationCategoryScoreValue): string {
  return value > 0 ? `+${value}` : String(value);
}

// The fixed 10-row rubric table - each row is one of the 10 PRESENTATION_CATEGORY_KEYS
// (never a free-text category name) with a <select> constrained to exactly
// PRESENTATION_CATEGORY_SCORE_OPTIONS (never an arbitrary number). Inline
// chip buttons, not a <select> - deliberately laid out to read like the
// uploaded exam sheet: one row per fixed category, five tappable score
// options side by side with the current selection visually filled-in.
function PresentationRubricEditor({
  scores,
  onChange,
}: {
  scores: PresentationCategoryScores;
  onChange: (scores: PresentationCategoryScores) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {PRESENTATION_CATEGORY_KEYS.map((key) => (
        <div key={key} className="flex flex-col gap-1">
          <span className="text-sm font-medium text-card-foreground">{PRESENTATION_CATEGORY_LABELS[key]}</span>
          <div
            role="radiogroup"
            aria-label={PRESENTATION_CATEGORY_LABELS[key]}
            className="flex flex-wrap gap-1.5"
          >
            {PRESENTATION_CATEGORY_SCORE_OPTIONS.map((v) => {
              const isSelected = scores[key] === v;
              return (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => onChange({ ...scores, [key]: v })}
                  className={`min-w-[3rem] flex-1 rounded-lg border px-2 py-2 text-center text-sm font-semibold transition-colors ${
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-card-foreground hover:bg-muted"
                  }`}
                >
                  {formatCategoryScoreValue(v)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Same overall shape as RidingProgressEntryForm/LungeProgressEntryForm, but
// the rating <select> is replaced with PresentationRubricEditor (the fixed
// 10-category rubric) plus a live finalScore preview line - swapping
// horseName/instructorName for topic/presentationType, same as before.
function PresentationProgressEntryForm({
  initialValues,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
  onDelete,
  isDeleting,
  deleteError,
}: {
  initialValues: PresentationProgressFormValues;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: (values: PresentationProgressFormValues) => void;
  onCancel: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
  deleteError?: string | null;
}) {
  const [values, setValues] = useState(initialValues);
  const categoryTotal = sumPresentationCategoryScores(values.categoryScores);
  const finalScorePreview = computeFormFinalScorePreview(values);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          תאריך
          <input
            type="date"
            value={values.date}
            onChange={(e) => setValues((v) => ({ ...v, date: e.target.value }))}
            className="rounded-lg border border-border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          נושא / כותרת
          <input
            type="text"
            value={values.topic}
            onChange={(e) => setValues((v) => ({ ...v, topic: e.target.value }))}
            className="rounded-lg border border-border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          סוג / שלב
          <input
            type="text"
            value={values.presentationType}
            onChange={(e) => setValues((v) => ({ ...v, presentationType: e.target.value }))}
            className="rounded-lg border border-border px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      <div className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
        <p className="text-xs font-medium text-muted-foreground">קטגוריות ניקוד</p>
        <PresentationRubricEditor
          scores={values.categoryScores}
          onChange={(categoryScores) => setValues((v) => ({ ...v, categoryScores }))}
        />
        <p className="text-xs text-muted-foreground">
          ציון סופי: {PRESENTATION_BASE_SCORE} {categoryTotal >= 0 ? "+" : "-"} {Math.abs(categoryTotal)} ={" "}
          <span className="font-semibold text-card-foreground">{finalScorePreview}</span>
          {" · "}ציון עובר: {PRESENTATION_PASSING_SCORE}
        </p>
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        משוב
        <textarea
          value={values.feedback}
          onChange={(e) => setValues((v) => ({ ...v, feedback: e.target.value }))}
          rows={2}
          className="rounded-lg border border-border px-2 py-1.5 text-sm"
        />
      </label>
      {error && <p className="text-xs text-danger">{error}</p>}
      {deleteError && <p className="text-xs text-danger">{deleteError}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => onSubmit(values)}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/70"
        >
          ביטול
        </button>
        {onDelete && (
          <button
            type="button"
            disabled={isDeleting}
            onClick={onDelete}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-danger underline hover:opacity-80 disabled:opacity-50"
          >
            {isDeleting ? "מוחק..." : "מחיקה"}
          </button>
        )}
      </div>
    </div>
  );
}

// Same 4-tier convention as the riding/lunge topic-average badge, but
// recalibrated to this rubric's actual possible range - baseScore 70 +/- up
// to 10 (10 categories x max 1 point each) means finalScore can only ever
// land in [60, 80], with 66 as the passing line (PRESENTATION_PASSING_SCORE).
export function presentationScoreBadgeClasses(score: number): string {
  if (score >= 76) return "bg-success-muted text-success";
  if (score >= PRESENTATION_PASSING_SCORE) return "bg-sky-100 text-sky-800";
  if (score >= PRESENTATION_PASSING_SCORE - 5) return "bg-warning-muted text-warning";
  return "bg-danger-muted text-danger";
}

// Small "עובר"/"לא עובר" badge against PRESENTATION_PASSING_SCORE (66) -
// shown alongside (never instead of) the numeric score badge everywhere a
// finalScore is displayed.
function PresentationPassFailBadge({ finalScore }: { finalScore: number }) {
  const passed = finalScore >= PRESENTATION_PASSING_SCORE;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        passed ? "bg-success-muted text-success" : "bg-danger-muted text-danger"
      }`}
    >
      {passed ? "עובר" : "לא עובר"}
    </span>
  );
}

// Only the non-zero categories are listed - fixed category labels via
// PRESENTATION_CATEGORY_LABELS, never a free-form name. Exported for reuse
// by TraineeProgressDetail.tsx's combined-timeline context line, so the
// "כל המשובים" entry for a presentation row shows the identical category
// breakdown text as this section's own display card, never a re-derived
// second version.
export function formatCategoryScoresSummary(categoryScores: PresentationCategoryScores): string | null {
  const parts = PRESENTATION_CATEGORY_KEYS.filter((key) => categoryScores[key] !== 0).map(
    (key) => `${PRESENTATION_CATEGORY_LABELS[key]}: ${formatCategoryScoreValue(categoryScores[key])}`
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

// Simple arithmetic mean of finalScore - every row always has a finalScore
// (never null by construction), so there's no "some rows unrated" filtering
// to do here. .toFixed(1) (not (0)) - finalScore can land on a half-point
// boundary (e.g. 70.5).
export function averagePresentationFinalScore(scores: number[]): number | null {
  if (scores.length === 0) return null;
  return scores.reduce((sum, v) => sum + v, 0) / scores.length;
}

export function formatPresentationScoreAverageLabel(average: number | null): string {
  if (average == null) return "אין ציונים";
  return `ציון ממוצע: ${average.toFixed(1)}`;
}

// The TopicSection `badge` override for "פרזנטציה".
export function PresentationScoreAverageBadge({ average }: { average: number | null }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
        average == null ? "bg-muted text-muted-foreground" : presentationScoreBadgeClasses(average)
      }`}
    >
      {formatPresentationScoreAverageLabel(average)}
    </span>
  );
}

// The three write calls this component needs - same actions-prop
// parameterization convention as RidingProgressFeedbackActions/
// LungeProgressFeedbackActions.
export interface PresentationProgressFeedbackActions {
  create: (studentId: string, input: StudentPresentationProgressFeedbackInput) => Promise<ActionResult>;
  update: (id: string, input: StudentPresentationProgressFeedbackInput) => Promise<ActionResult>;
  delete: (id: string) => Promise<ActionResult>;
}

// canAdd/isRowEditable mirror RidingProgressFeedbackList's own (see that
// component's comment) - default to the unrestricted admin behavior so the
// existing admin call site (once rewired through TraineeProgressDetail)
// keeps its exact current behavior; the instructor call site passes
// isRowEditable={(row) => row.createdByInstructorId === instructorId} and
// canAdd={canEditRidingFeedback}.
export function PresentationProgressFeedbackList({
  studentId,
  rows,
  onChanged,
  actions,
  canAdd = true,
  isRowEditable = () => true,
  isRowDeletable = () => true,
}: {
  studentId: string;
  rows: StudentPresentationProgressFeedbackRow[];
  onChanged: () => void;
  actions: PresentationProgressFeedbackActions;
  canAdd?: boolean;
  isRowEditable?: (row: StudentPresentationProgressFeedbackRow) => boolean;
  // Gates delete exposure (display-card button + edit-form onDelete)
  // independently of isRowEditable - see RidingProgressFeedbackList's own
  // comment. Defaults to the unrestricted admin behavior; the instructor
  // call site passes () => capabilities.isAdmin, which is false in the
  // instructor context, so instructor delete controls stay hidden while
  // admin behavior is preserved.
  isRowDeletable?: (row: StudentPresentationProgressFeedbackRow) => boolean;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [isAddPending, startAddTransition] = useTransition();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditPending, startEditTransition] = useTransition();

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  const [, startDeleteTransition] = useTransition();

  function handleDelete(id: string) {
    if (!window.confirm("למחוק את משוב הפרזנטציה הזה? לא ניתן לשחזר את הפעולה.")) return;
    setDeleteError(null);
    setDeletingId(id);
    startDeleteTransition(async () => {
      const result = await actions.delete(id);
      if (!result.success) {
        setDeleteError({ id, message: result.error ?? "אירעה שגיאה" });
        setDeletingId(null);
        return;
      }
      if (editingId === id) {
        setEditingId(null);
        setEditError(null);
      }
      setDeletingId(null);
      onChanged();
    });
  }

  function handleAdd(values: PresentationProgressFormValues) {
    if (!hasPresentationProgressFormContent(values)) {
      setAddError("יש להזין משוב, נושא, סוג פרזנטציה או ניקוד בקטגוריה כלשהי");
      return;
    }
    setAddError(null);
    startAddTransition(async () => {
      const result = await actions.create(studentId, presentationProgressFormToInput(values));
      if (!result.success) {
        setAddError(result.error ?? "אירעה שגיאה");
        return;
      }
      setIsAdding(false);
      onChanged();
    });
  }

  function handleEdit(id: string, values: PresentationProgressFormValues) {
    if (!hasPresentationProgressFormContent(values)) {
      setEditError("יש להזין משוב, נושא, סוג פרזנטציה או ניקוד בקטגוריה כלשהי");
      return;
    }
    setEditError(null);
    startEditTransition(async () => {
      const result = await actions.update(id, presentationProgressFormToInput(values));
      if (!result.success) {
        setEditError(result.error ?? "אירעה שגיאה");
        return;
      }
      setEditingId(null);
      onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {canAdd &&
        (isAdding ? (
          <PresentationProgressEntryForm
            initialValues={emptyPresentationProgressForm()}
            submitLabel="שמירה"
            pending={isAddPending}
            error={addError}
            onSubmit={handleAdd}
            onCancel={() => {
              setIsAdding(false);
              setAddError(null);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="self-start rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            הוספת משוב פרזנטציה
          </button>
        ))}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          עדיין לא הוזן משוב פרזנטציה לחניך/ה זה/זו.
        </p>
      ) : (
        rows.map((row) =>
          editingId === row.id ? (
            <PresentationProgressEntryForm
              key={row.id}
              initialValues={{
                date: row.date,
                feedback: row.feedback ?? "",
                topic: row.topic ?? "",
                presentationType: row.presentationType ?? "",
                categoryScores: row.categoryScores,
              }}
              submitLabel="עדכון"
              pending={isEditPending}
              error={editError}
              onSubmit={(values) => handleEdit(row.id, values)}
              onCancel={() => {
                setEditingId(null);
                setEditError(null);
              }}
              onDelete={isRowDeletable(row) ? () => handleDelete(row.id) : undefined}
              isDeleting={deletingId === row.id}
              deleteError={deleteError?.id === row.id ? deleteError.message : null}
            />
          ) : (
            <div key={row.id} className="rounded-xl border border-border bg-card p-4">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-card-foreground">
                  {formatHebrewDate(parseDateKey(row.date))}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${presentationScoreBadgeClasses(
                      row.finalScore
                    )}`}
                  >
                    ציון: {row.finalScore}
                  </span>
                  <PresentationPassFailBadge finalScore={row.finalScore} />
                </div>
              </div>
              {row.feedback && <p className="mb-1 text-sm text-card-foreground">{row.feedback}</p>}
              {(row.topic || row.presentationType) && (
                <p className="mb-1 text-xs text-muted-foreground">
                  {row.topic ? `נושא: ${row.topic}` : ""}
                  {row.topic && row.presentationType ? " · " : ""}
                  {row.presentationType ? `סוג: ${row.presentationType}` : ""}
                </p>
              )}
              {formatCategoryScoresSummary(row.categoryScores) && (
                <p className="mb-1 text-xs text-muted-foreground">
                  ציון בסיס: {row.baseScore} · {formatCategoryScoresSummary(row.categoryScores)}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {row.createdByName && `נוצר על ידי: ${row.createdByName}`}
                {row.createdByName && " · "}
                {row.updatedByName && `עודכן על ידי: ${row.updatedByName} · `}
                עודכן בתאריך: {formatHebrewDateTime(new Date(row.updatedAt))}
              </p>
              {(isRowEditable(row) || isRowDeletable(row)) && (
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  {isRowEditable(row) && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(row.id);
                        setEditError(null);
                      }}
                      className="text-xs font-medium text-secondary-foreground underline hover:opacity-80"
                    >
                      עריכה
                    </button>
                  )}
                  {isRowDeletable(row) && (
                    <button
                      type="button"
                      disabled={deletingId === row.id}
                      onClick={() => handleDelete(row.id)}
                      className="text-xs font-medium text-danger underline hover:opacity-80 disabled:opacity-50"
                    >
                      {deletingId === row.id ? "מוחק..." : "מחיקה"}
                    </button>
                  )}
                </div>
              )}
              {deleteError?.id === row.id && (
                <p className="mt-1 text-xs text-danger">{deleteError.message}</p>
              )}
            </div>
          )
        )
      )}
    </div>
  );
}
