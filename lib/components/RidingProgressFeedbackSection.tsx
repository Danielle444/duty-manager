"use client";

import { useState, useTransition } from "react";
import { formatHebrewDate, formatHebrewDateTime, parseDateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";
import type {
  StudentRidingProgressFeedbackInput,
  StudentRidingProgressFeedbackRow,
} from "@/lib/actions/student-riding-progress-feedback";

// Stage I2 - extracted from app/admin/trainee-progress/TraineeProgressClient.tsx
// (originally RidingProgressEntryForm/RidingProgressFeedbackList, Stage R2)
// so the instructor "מעקב חניכים" screen
// (app/instructor/InstructorTraineeProgressSection.tsx) can reuse the exact
// same form/list UI as the admin page, rather than duplicating it. The only
// change from the original admin-only version: the three write calls
// (create/update/delete) are no longer hardcoded to the *Admin server
// actions - they're passed in via the `actions` prop, so this component has
// no idea whether it's running inside the admin page or the instructor app.
// Admin's caller passes the createStudentRidingProgressFeedbackAsAdmin/
// update.../delete... functions directly (their signatures already match
// RidingProgressFeedbackActions exactly); the instructor caller passes thin
// wrappers around the ...AsInstructor actions that also thread instructorId
// through. Never touches RidingLessonNote/RidingSlot/ScheduleItem - see
// StudentRidingProgressFeedback's own schema comment.

const RATING_HALF_POINT_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

function todayDateInputValue(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

interface RidingProgressFormValues {
  date: string;
  ratingHalfPoints: string;
  feedback: string;
  horseName: string;
  topic: string;
}

function emptyRidingProgressForm(): RidingProgressFormValues {
  return { date: todayDateInputValue(), ratingHalfPoints: "", feedback: "", horseName: "", topic: "" };
}

function ridingProgressFormToInput(values: RidingProgressFormValues): StudentRidingProgressFeedbackInput {
  return {
    date: values.date,
    ratingHalfPoints: values.ratingHalfPoints ? Number(values.ratingHalfPoints) : null,
    feedback: values.feedback.trim() || null,
    horseName: values.horseName.trim() || null,
    topic: values.topic.trim() || null,
  };
}

// Mirrors the server's own "meaningful content" guard (see
// hasMeaningfulContent in lib/actions/student-riding-progress-feedback.ts) -
// checked here too so the caller gets an immediate, specific Hebrew error
// instead of a round-trip just to learn the same thing. Same rule for both
// admin and instructor callers - the server-side guard is identical too.
function hasRidingProgressFormContent(values: RidingProgressFormValues): boolean {
  return values.ratingHalfPoints !== "" || values.feedback.trim() !== "";
}

// Shared by both "add new entry" and "edit existing entry" - initialValues
// seeds the form (empty defaults for add, the row's own current values for
// edit); onCancel is only provided when there's something to cancel back to
// (always, in practice, but kept optional for flexibility).
function RidingProgressEntryForm({
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
  initialValues: RidingProgressFormValues;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: (values: RidingProgressFormValues) => void;
  onCancel: () => void;
  // Only provided when editing an existing entry (never for "add new") -
  // lets the caller decide to delete instead of saving, without first
  // having to cancel back to the display card.
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
          נושא
          <input
            type="text"
            value={values.topic}
            onChange={(e) => setValues((v) => ({ ...v, topic: e.target.value }))}
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

// The three write calls this component needs - admin's caller passes the
// *AsAdmin actions directly (matching signatures); the instructor caller
// passes wrappers that also thread instructorId through to the
// *AsInstructor actions.
export interface RidingProgressFeedbackActions {
  create: (studentId: string, input: StudentRidingProgressFeedbackInput) => Promise<ActionResult>;
  update: (id: string, input: StudentRidingProgressFeedbackInput) => Promise<ActionResult>;
  delete: (id: string) => Promise<ActionResult>;
}

// List + add-form + inline edit - only one add-form and one edit-form can be
// open at a time (isAdding / editingId), so there's never ambiguity about
// which save button applies to which entry. onChanged is called after any
// successful create/update/delete so the parent can refetch the now-stale
// list - this component never touches that state directly.
//
// canAdd/isRowEditable - added for the instructor trainee-progress detail
// view, which reuses this exact component to show EVERY row for a trainee
// (admin- and every instructor-created alike, see
// listStudentRidingProgressFeedbackForInstructorView) while only allowing
// the acting instructor to add/edit/delete their OWN rows (existing
// ownership rule, preserved server-side regardless of these props - see
// updateStudentRidingProgressFeedbackAsInstructor). Both default to the
// unrestricted admin behavior (add always available, every row editable) so
// the existing admin call site is unaffected by adding these props.
export function RidingProgressFeedbackList({
  studentId,
  rows,
  onChanged,
  actions,
  canAdd = true,
  isRowEditable = () => true,
  isRowDeletable = () => true,
}: {
  studentId: string;
  rows: StudentRidingProgressFeedbackRow[];
  onChanged: () => void;
  actions: RidingProgressFeedbackActions;
  canAdd?: boolean;
  isRowEditable?: (row: StudentRidingProgressFeedbackRow) => boolean;
  // Gates delete exposure (display-card button + edit-form onDelete)
  // independently of isRowEditable. Defaults to the unrestricted admin
  // behavior (every row deletable) so the existing admin call site is
  // unaffected. The instructor call site passes () => capabilities.isAdmin,
  // which is false in the instructor context, so instructor delete controls
  // stay hidden while admin behavior is preserved; deletion stays
  // manager-only and server actions no longer expose an instructor delete.
  isRowDeletable?: (row: StudentRidingProgressFeedbackRow) => boolean;
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

  // Reachable from either the display card's own "מחיקה" button or the
  // edit form's "מחיקה" button (when deleting the entry currently being
  // edited) - both funnel through here, so the "close edit state safely"
  // requirement is handled in exactly one place.
  function handleDelete(id: string) {
    if (!window.confirm("למחוק את משוב הרכיבה הזה? לא ניתן לשחזר את הפעולה.")) return;
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

  function handleAdd(values: RidingProgressFormValues) {
    if (!hasRidingProgressFormContent(values)) {
      setAddError("יש להזין דירוג או משוב");
      return;
    }
    setAddError(null);
    startAddTransition(async () => {
      const result = await actions.create(studentId, ridingProgressFormToInput(values));
      if (!result.success) {
        setAddError(result.error ?? "אירעה שגיאה");
        return;
      }
      setIsAdding(false);
      onChanged();
    });
  }

  function handleEdit(id: string, values: RidingProgressFormValues) {
    if (!hasRidingProgressFormContent(values)) {
      setEditError("יש להזין דירוג או משוב");
      return;
    }
    setEditError(null);
    startEditTransition(async () => {
      const result = await actions.update(id, ridingProgressFormToInput(values));
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
          <RidingProgressEntryForm
            initialValues={emptyRidingProgressForm()}
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
            הוספת משוב רכיבה
          </button>
        ))}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          עדיין לא הוזן משוב רכיבה לחניך/ה זה/זו.
        </p>
      ) : (
        rows.map((row) =>
          editingId === row.id ? (
            <RidingProgressEntryForm
              key={row.id}
              initialValues={{
                date: row.date,
                ratingHalfPoints: row.ratingHalfPoints != null ? String(row.ratingHalfPoints) : "",
                feedback: row.feedback ?? "",
                horseName: row.horseName ?? "",
                topic: row.topic ?? "",
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
              {(row.horseName || row.topic) && (
                <p className="mb-1 text-xs text-muted-foreground">
                  {row.horseName ? `סוס: ${row.horseName}` : ""}
                  {row.horseName && row.topic ? " · " : ""}
                  {row.topic ? `נושא: ${row.topic}` : ""}
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
