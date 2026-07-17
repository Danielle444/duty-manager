"use client";

import { useState, useTransition } from "react";
import { formatHebrewDate, formatHebrewDateTime, parseDateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";
import type {
  StudentLungeProgressFeedbackInput,
  StudentLungeProgressFeedbackRow,
} from "@/lib/actions/student-lunge-progress-feedback";

// Stage I2 - extracted from app/admin/trainee-progress/TraineeProgressClient.tsx
// (originally LungeProgressEntryForm/LungeProgressFeedbackList, Stage P4b)
// so the instructor "מעקב חניכים" screen
// (app/instructor/InstructorTraineeProgressSection.tsx) can reuse the exact
// same form/list UI as the admin page - see
// lib/components/RidingProgressFeedbackSection.tsx's own comment for the
// full rationale (same pattern, same actions-prop parameterization).
// Deliberately NOT the same "לונג׳ עם רוכב" Teaching Practice concept
// rendered inside "התנסויות מתחילים" on both the admin page and the
// instructor app's own dedicated screen - see StudentLungeProgressFeedback's
// own schema comment.

const RATING_HALF_POINT_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

function todayDateInputValue(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

interface LungeProgressFormValues {
  date: string;
  ratingHalfPoints: string;
  feedback: string;
  horseName: string;
  topic: string;
  instructorName: string;
}

function emptyLungeProgressForm(): LungeProgressFormValues {
  return {
    date: todayDateInputValue(),
    ratingHalfPoints: "",
    feedback: "",
    horseName: "",
    topic: "",
    instructorName: "",
  };
}

function lungeProgressFormToInput(values: LungeProgressFormValues): StudentLungeProgressFeedbackInput {
  return {
    date: values.date,
    ratingHalfPoints: values.ratingHalfPoints ? Number(values.ratingHalfPoints) : null,
    feedback: values.feedback.trim() || null,
    horseName: values.horseName.trim() || null,
    topic: values.topic.trim() || null,
    instructorName: values.instructorName.trim() || null,
  };
}

// Mirrors the server's own broader "meaningful content" guard (see
// hasMeaningfulContent in lib/actions/student-lunge-progress-feedback.ts) -
// checked here too so the caller gets an immediate, specific Hebrew error
// instead of a round-trip just to learn the same thing. Broader than
// riding's own guard: horseName/topic/instructorName also count, since a
// לונג׳-בלי-רוכב entry may meaningfully record only "who worked the horse
// and on what," with no rating or free-text feedback at all.
function hasLungeProgressFormContent(values: LungeProgressFormValues): boolean {
  return (
    values.ratingHalfPoints !== "" ||
    values.feedback.trim() !== "" ||
    values.horseName.trim() !== "" ||
    values.topic.trim() !== "" ||
    values.instructorName.trim() !== ""
  );
}

// Same shape/behavior as RidingProgressEntryForm, plus an
// instructorName/coachName field - deliberately duplicated rather than
// generalized into one shared form component (the two topics' server
// actions, input types, and meaningful-content rules are already
// independent; a shared component would need to branch on all three anyway).
function LungeProgressEntryForm({
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
  initialValues: LungeProgressFormValues;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: (values: LungeProgressFormValues) => void;
  onCancel: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
  deleteError?: string | null;
}) {
  const [values, setValues] = useState(initialValues);

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
          דירוג
          <select
            value={values.ratingHalfPoints}
            onChange={(e) => setValues((v) => ({ ...v, ratingHalfPoints: e.target.value }))}
            className="rounded-lg border border-border px-2 py-1.5 text-sm"
          >
            <option value="">ללא דירוג</option>
            {RATING_HALF_POINT_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {(v / 2).toFixed(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          סוס
          <input
            type="text"
            value={values.horseName}
            onChange={(e) => setValues((v) => ({ ...v, horseName: e.target.value }))}
            className="rounded-lg border border-border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          נושא / מיקוד
          <input
            type="text"
            value={values.topic}
            onChange={(e) => setValues((v) => ({ ...v, topic: e.target.value }))}
            className="rounded-lg border border-border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          מדריך/ה
          <input
            type="text"
            value={values.instructorName}
            onChange={(e) => setValues((v) => ({ ...v, instructorName: e.target.value }))}
            className="rounded-lg border border-border px-2 py-1.5 text-sm"
          />
        </label>
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

// The three write calls this component needs - same actions-prop
// parameterization convention as RidingProgressFeedbackActions.
export interface LungeProgressFeedbackActions {
  create: (studentId: string, input: StudentLungeProgressFeedbackInput) => Promise<ActionResult>;
  update: (id: string, input: StudentLungeProgressFeedbackInput) => Promise<ActionResult>;
  delete: (id: string) => Promise<ActionResult>;
}

// Same shape/behavior as RidingProgressFeedbackList - see that component's
// own comments for the isAdding/editingId/onChanged conventions, unchanged
// here. canAdd/isRowEditable also mirror RidingProgressFeedbackList's own -
// see its own comment on why they exist and their admin-unaffecting
// defaults.
export function LungeProgressFeedbackList({
  studentId,
  rows,
  onChanged,
  actions,
  canAdd = true,
  isRowEditable = () => true,
  isRowDeletable = () => true,
}: {
  studentId: string;
  rows: StudentLungeProgressFeedbackRow[];
  onChanged: () => void;
  actions: LungeProgressFeedbackActions;
  canAdd?: boolean;
  isRowEditable?: (row: StudentLungeProgressFeedbackRow) => boolean;
  // Gates delete exposure (display-card button + edit-form onDelete)
  // independently of isRowEditable - see RidingProgressFeedbackList's own
  // comment. Defaults to the unrestricted admin behavior; the instructor
  // call site passes () => capabilities.isAdmin, which is false in the
  // instructor context, so instructor delete controls stay hidden while
  // admin behavior is preserved.
  isRowDeletable?: (row: StudentLungeProgressFeedbackRow) => boolean;
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
    if (!window.confirm("למחוק את משוב הלונג׳ הזה? לא ניתן לשחזר את הפעולה.")) return;
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

  function handleAdd(values: LungeProgressFormValues) {
    if (!hasLungeProgressFormContent(values)) {
      setAddError("יש להזין דירוג, משוב, סוס, נושא או שם מדריך/ה");
      return;
    }
    setAddError(null);
    startAddTransition(async () => {
      const result = await actions.create(studentId, lungeProgressFormToInput(values));
      if (!result.success) {
        setAddError(result.error ?? "אירעה שגיאה");
        return;
      }
      setIsAdding(false);
      onChanged();
    });
  }

  function handleEdit(id: string, values: LungeProgressFormValues) {
    if (!hasLungeProgressFormContent(values)) {
      setEditError("יש להזין דירוג, משוב, סוס, נושא או שם מדריך/ה");
      return;
    }
    setEditError(null);
    startEditTransition(async () => {
      const result = await actions.update(id, lungeProgressFormToInput(values));
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
          <LungeProgressEntryForm
            initialValues={emptyLungeProgressForm()}
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
            הוספת משוב לונג׳
          </button>
        ))}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          עדיין לא הוזן משוב לונג׳ לחניך/ה זה/זו.
        </p>
      ) : (
        rows.map((row) =>
          editingId === row.id ? (
            <LungeProgressEntryForm
              key={row.id}
              initialValues={{
                date: row.date,
                ratingHalfPoints: row.ratingHalfPoints != null ? String(row.ratingHalfPoints) : "",
                feedback: row.feedback ?? "",
                horseName: row.horseName ?? "",
                topic: row.topic ?? "",
                instructorName: row.instructorName ?? "",
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
              {row.feedback && <p className="mb-1 text-sm text-card-foreground">{row.feedback}</p>}
              {(row.horseName || row.topic || row.instructorName) && (
                <p className="mb-1 text-xs text-muted-foreground">
                  {row.horseName ? `סוס: ${row.horseName}` : ""}
                  {row.horseName && row.topic ? " · " : ""}
                  {row.topic ? `נושא: ${row.topic}` : ""}
                  {(row.horseName || row.topic) && row.instructorName ? " · " : ""}
                  {row.instructorName ? `מדריך/ה: ${row.instructorName}` : ""}
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
