"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getStudentRidingHistoryForAdmin, type RidingHistoryRow } from "@/lib/actions/riding-slots";
import {
  getStudentTeachingPracticeFeedbackForAdmin,
  type TeachingPracticeFeedbackHistoryRow,
} from "@/lib/actions/teaching-practice-feedback-history";
import {
  createStudentRidingProgressFeedbackAsAdmin,
  deleteStudentRidingProgressFeedbackAsAdmin,
  listStudentRidingProgressFeedbackForAdmin,
  updateStudentRidingProgressFeedbackAsAdmin,
  type StudentRidingProgressFeedbackInput,
  type StudentRidingProgressFeedbackRow,
} from "@/lib/actions/student-riding-progress-feedback";
import {
  createStudentLungeProgressFeedbackAsAdmin,
  deleteStudentLungeProgressFeedbackAsAdmin,
  listStudentLungeProgressFeedbackForAdmin,
  updateStudentLungeProgressFeedbackAsAdmin,
  type StudentLungeProgressFeedbackInput,
  type StudentLungeProgressFeedbackRow,
} from "@/lib/actions/student-lunge-progress-feedback";
import { RidingHistoryList } from "@/lib/components/RidingHistoryList";
import { getHorseDisplayInfo } from "@/lib/horse-info";
import { formatHebrewDate, formatHebrewDateTime, parseDateKey } from "@/lib/dates";
import type { TeachingPracticeRoleValue, TeachingPracticeTypeValue } from "@/lib/teaching-practice-rotation";

// Pure, reusable across future topics (Teaching Practice, combined timeline)
// - takes an average already converted to the 1.0-5.0 scale (half-points
// divided by 2) and produces the same "ממוצע X.X" / "אין דירוגים" label
// convention everywhere this pattern gets repeated, so P2/P3 only need to
// compute their own average and call this, never re-invent the wording.
function formatTopicAverageLabel(average: number | null): string {
  if (average == null) return "אין דירוגים";
  return `ממוצע ${average.toFixed(1)}`;
}

// Average of ratingHalfPoints (2-10, i.e. 1.0-5.0 in 0.5 steps) across every
// row that has one - rows without a rating are ignored entirely rather than
// counted as 0, same "missing = not yet rated, not a zero" convention
// RidingLessonNote/TeachingPracticeFeedback both already use. null means "no
// rated rows at all" (including "still loading"), which
// formatTopicAverageLabel renders as "אין דירוגים" - callers should only
// invoke this once rows have loaded.
function averageRatingFromHalfPoints(ratingsHalfPoints: (number | null)[]): number | null {
  const rated = ratingsHalfPoints.filter((v): v is number => v != null);
  if (rated.length === 0) return null;
  return rated.reduce((sum, v) => sum + v, 0) / rated.length / 2;
}

// Reusable across future topics, same as formatTopicAverageLabel -
// no-ratings is always the neutral/gray tier, regardless of threshold.
// The two "good" tiers (4.5+ and 3.5-4.49) are deliberately two different
// hues (this app's own success green vs. plain sky blue, since there's no
// dedicated "info" semantic color token in globals.css) rather than two
// shades of the same color, so they stay visually distinguishable from each
// other, not just from the warning/danger tiers.
function topicAverageBadgeClasses(average: number | null): string {
  if (average == null) return "bg-muted text-muted-foreground";
  if (average >= 4.5) return "bg-success-muted text-success";
  if (average >= 3.5) return "bg-sky-100 text-sky-800";
  if (average >= 2.5) return "bg-warning-muted text-warning";
  return "bg-danger-muted text-danger";
}

function TopicAverageBadge({ average }: { average: number | null }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${topicAverageBadgeClasses(average)}`}
    >
      {formatTopicAverageLabel(average)}
    </span>
  );
}

// Collapsible topic card - the single title lives in this clickable header
// row alongside the average badge and a chevron, never duplicated below it.
// Reused for every topic (הדרכת מתקדמים now, התנסויות מתחילים below,
// future topics later) so title+badge+collapse behavior can never drift apart
// between them. Plain-text chevron (no icon library) rotated via a CSS
// transform - no new dependency.
function TopicSection({
  title,
  subtitle,
  average,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  // Stage P4b - optional, small muted line under the title (e.g. לונג׳'s own
  // "משובי לונג׳ ללא רוכב..." disambiguation text) - never shown for topics
  // that don't pass one, so every other existing TopicSection is unaffected.
  subtitle?: string;
  average: number | null;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-right"
      >
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-card-foreground">{title}</h3>
            <TopicAverageBadge average={average} />
          </div>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <span
          className={`text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>
      {isOpen && <div className="flex flex-col gap-3 border-t border-border p-4">{children}</div>}
    </div>
  );
}

// Local Hebrew labels - deliberately duplicated rather than imported from
// lib/components/TeachingPracticeManager.tsx or
// app/student/StudentTeachingPracticeSection.tsx, same reason both of those
// already duplicate these instead of sharing them: this admin-only,
// read-only history view has no reason to depend on either the
// admin/instructor CRUD component or the trainee-facing one.
const PRACTICE_TYPE_LABELS: Record<TeachingPracticeTypeValue, string> = {
  LUNGE: "לונג׳",
  BEGINNER_PRIVATE: "שיעור פרטני",
  BEGINNER_GROUP: "שיעור קבוצתי",
};

const ROLE_LABELS: Record<TeachingPracticeRoleValue, string> = {
  LEAD_INSTRUCTOR: "מדריך ראשון",
  SECOND_INSTRUCTOR: "מדריך שני",
  ASSISTANT_INSTRUCTOR: "עוזר מדריך",
  EVALUATOR: "ממשב",
};

// Compact, read-only, no filters (unlike RidingHistoryList) - Stage P2 only
// asks for a simple list, and there's no established date/topic filter
// convention to reuse here yet. Rows already arrive newest-first from the
// action.
//
// Stage P4a - reused for both internal subsections of the "התנסויות
// מתחילים" TopicSection (see TeachingPracticeFeedbackSection below: "לונג׳
// עם רוכב" and "שיעורי מתחילים - פרטני/קבוצתי" both render one of these,
// filtered to their own practiceType rows), so the empty-state wording is a
// prop rather than hardcoded to one subsection's phrasing.
function TeachingPracticeFeedbackHistoryList({
  rows,
  emptyMessage = "עדיין לא הוזן משוב התנסויות מתחילים לחניך/ה זה/זו.",
}: {
  rows: TeachingPracticeFeedbackHistoryRow[];
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.feedbackId} className="rounded-xl border border-border bg-card p-4">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-card-foreground">
              {formatHebrewDate(parseDateKey(row.date))} · {row.startTime}-{row.endTime}
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
            {PRACTICE_TYPE_LABELS[row.practiceType]}
            {row.groupName ? ` · קבוצה ${row.groupName}` : ""}
          </p>
          <p className="mb-1 text-xs text-muted-foreground">
            תפקיד: {ROLE_LABELS[row.role]}
            {row.location ? ` · מיקום: ${row.location}` : ""}
          </p>
          {row.feedback && <p className="mb-1 text-sm text-card-foreground">משוב: {row.feedback}</p>}
          {(row.childFullName || row.horseName || row.equipmentNotes) && (
            <p className="mb-1 text-xs text-muted-foreground">
              {row.childFullName ? `ילד/ה: ${row.childFullName}` : ""}
              {row.childFullName && row.horseName ? " · " : ""}
              {row.horseName ? `סוס: ${row.horseName}` : ""}
              {(row.childFullName || row.horseName) && row.equipmentNotes ? " · " : ""}
              {row.equipmentNotes ? `ציוד: ${row.equipmentNotes}` : ""}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {row.updatedByName && `עודכן על ידי: ${row.updatedByName}`}
            {row.updatedByName && " · "}
            עודכן בתאריך: {formatHebrewDateTime(new Date(row.updatedAt))}
          </p>
        </div>
      ))}
    </div>
  );
}

// Stage P4a - product clarification: Teaching Practice LUNGE ("לונג׳ עם
// רוכב/ילד") is part of the Teaching Practice / "התנסויות מתחילים" family,
// NOT the future standalone manager-entered "לונג׳ בלי רוכב" progress
// category - so it stays inside one top-level TopicSection, split only as
// two internal, non-collapsible subsections. Each subsection gets its own
// small average badge (cheap and useful - see the "very clean way" product
// note); the section's own TopicSection average (passed by the caller in
// TraineeProgressClient) still reflects every Teaching Practice row
// together, unaffected by this internal split.
function TeachingPracticeFeedbackSection({
  lungeRows,
  beginnerRows,
}: {
  lungeRows: TeachingPracticeFeedbackHistoryRow[];
  beginnerRows: TeachingPracticeFeedbackHistoryRow[];
}) {
  const lungeAverage = averageRatingFromHalfPoints(lungeRows.map((r) => r.ratingHalfPoints));
  const beginnerAverage = averageRatingFromHalfPoints(beginnerRows.map((r) => r.ratingHalfPoints));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-bold text-card-foreground">לונג׳ עם רוכב</h4>
          <TopicAverageBadge average={lungeAverage} />
        </div>
        <TeachingPracticeFeedbackHistoryList
          rows={lungeRows}
          emptyMessage="עדיין לא הוזן משוב לונג׳ עם רוכב לחניך/ה זה/זו."
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-bold text-card-foreground">שיעורי מתחילים - פרטני/קבוצתי</h4>
          <TopicAverageBadge average={beginnerAverage} />
        </div>
        <TeachingPracticeFeedbackHistoryList
          rows={beginnerRows}
          emptyMessage="עדיין לא הוזן משוב שיעורי מתחילים לחניך/ה זה/זו."
        />
      </div>
    </div>
  );
}

// Stage R2 - manager-entered riding PROGRESS feedback (StudentRidingProgressFeedback)
// - a standalone journal per trainee, unrelated to RidingLessonNote/RidingSlot/
// ScheduleItem (see that model's own schema comment). Same rating half-point
// convention as every other feedback model in this app (2-10 -> 1.0-5.0 in
// 0.5 steps).
const RATING_HALF_POINT_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

interface RidingProgressFormValues {
  date: string;
  ratingHalfPoints: string;
  feedback: string;
  horseName: string;
  topic: string;
}

function todayDateInputValue(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
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
// checked here too so the admin gets an immediate, specific Hebrew error
// instead of a round-trip just to learn the same thing.
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
  // lets an admin who opened the edit form decide to delete instead of
  // saving, without first having to cancel back to the display card.
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

// List + add-form + inline edit - only one add-form and one edit-form can be
// open at a time (isAdding / editingId), so there's never ambiguity about
// which save button applies to which entry. onChanged is called after any
// successful create/update so the parent can refetch the now-stale list
// (and, transitively, recompute the average badge and combined timeline
// from the fresh data) - this component never touches that state directly.
function RidingProgressFeedbackList({
  studentId,
  rows,
  onChanged,
}: {
  studentId: string;
  rows: StudentRidingProgressFeedbackRow[];
  onChanged: () => void;
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
      const result = await deleteStudentRidingProgressFeedbackAsAdmin(id);
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
      const result = await createStudentRidingProgressFeedbackAsAdmin(
        studentId,
        ridingProgressFormToInput(values)
      );
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
      const result = await updateStudentRidingProgressFeedbackAsAdmin(id, ridingProgressFormToInput(values));
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
      {isAdding ? (
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
      )}

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
              onDelete={() => handleDelete(row.id)}
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
              <div className="mt-1 flex flex-wrap items-center gap-3">
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
                <button
                  type="button"
                  disabled={deletingId === row.id}
                  onClick={() => handleDelete(row.id)}
                  className="text-xs font-medium text-danger underline hover:opacity-80 disabled:opacity-50"
                >
                  {deletingId === row.id ? "מוחק..." : "מחיקה"}
                </button>
              </div>
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

// Stage P4b - manager-entered "לונג׳ בלי רוכב" progress feedback
// (StudentLungeProgressFeedback) - a standalone journal per trainee,
// structurally cloned from the Stage R2 רכיבה pattern above (same form/list
// shape, same rating half-point convention), plus one extra field
// (instructorName) per product spec. Deliberately NOT the same "לונג׳ עם
// רוכב" Teaching Practice concept rendered inside "התנסויות מתחילים" above -
// see this section's own TopicSection subtitle in the render tree below.
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
// checked here too so the admin gets an immediate, specific Hebrew error
// instead of a round-trip just to learn the same thing. Broader than
// hasRidingProgressFormContent: horseName/topic/instructorName also count,
// since a לונג׳-בלי-רוכב entry may meaningfully record only "who worked the
// horse and on what," with no rating or free-text feedback at all.
function hasLungeProgressFormContent(values: LungeProgressFormValues): boolean {
  return (
    values.ratingHalfPoints !== "" ||
    values.feedback.trim() !== "" ||
    values.horseName.trim() !== "" ||
    values.topic.trim() !== "" ||
    values.instructorName.trim() !== ""
  );
}

// Same shape/behavior as RidingProgressEntryForm above, plus an
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

// Same shape/behavior as RidingProgressFeedbackList above - see that
// component's own comments for the isAdding/editingId/onChanged
// conventions, unchanged here.
function LungeProgressFeedbackList({
  studentId,
  rows,
  onChanged,
}: {
  studentId: string;
  rows: StudentLungeProgressFeedbackRow[];
  onChanged: () => void;
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
      const result = await deleteStudentLungeProgressFeedbackAsAdmin(id);
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
      const result = await createStudentLungeProgressFeedbackAsAdmin(
        studentId,
        lungeProgressFormToInput(values)
      );
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
      const result = await updateStudentLungeProgressFeedbackAsAdmin(id, lungeProgressFormToInput(values));
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
      {isAdding ? (
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
      )}

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
              onDelete={() => handleDelete(row.id)}
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
              <div className="mt-1 flex flex-wrap items-center gap-3">
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
                <button
                  type="button"
                  disabled={deletingId === row.id}
                  onClick={() => handleDelete(row.id)}
                  className="text-xs font-medium text-danger underline hover:opacity-80 disabled:opacity-50"
                >
                  {deletingId === row.id ? "מוחק..." : "מחיקה"}
                </button>
              </div>
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

// Stage P3 - a client-side-only merge of the two already-loaded row arrays
// above (no new server action, no new query) into one chronological
// timeline. source drives both the badge label below and which of each row
// shape's own fields get pulled into the shared display fields - riding and
// Teaching Practice rows have different field names for the same concept
// (e.g. RidingHistoryRow.note vs. TeachingPracticeFeedbackHistoryRow.feedback),
// so this is where they're normalized into one shape, once.
interface CombinedTimelineItem {
  key: string;
  // Stage P4a - "teachingPractice" split into "teachingPracticeLunge" /
  // "teachingPracticeBeginner" purely so the timeline badge
  // (TIMELINE_SOURCE_LABELS below) can distinguish "לונג׳ עם רוכב" from
  // "פרטני/קבוצתי" text - both still resolve to a "התנסות מתחילים · ..."
  // label, never a standalone "לונג׳" one; there is no separate top-level
  // TopicSection behind this split (see TeachingPracticeFeedbackSection,
  // which renders both as subsections of the one "התנסויות מתחילים" section).
  //
  // Stage P4b - "lungeProgress" is the unrelated, always-manager-entered
  // "לונג׳ בלי רוכב" journal (StudentLungeProgressFeedback) - a distinct
  // source from teachingPracticeLunge on purpose, so the two can never be
  // merged or double-counted, and so its own badge text
  // (TIMELINE_SOURCE_LABELS.lungeProgress) reads unambiguously as the
  // standalone category, never the Teaching Practice one.
  source: "riding" | "teachingPracticeLunge" | "teachingPracticeBeginner" | "ridingProgress" | "lungeProgress";
  date: string;
  time: string;
  title: string;
  ratingHalfPoints: number | null;
  text: string | null;
  updatedByName: string | null;
  updatedAt: string;
  // Pre-built "label: value" strings (only for whichever fields this
  // particular row actually has a value for) - built once here rather than
  // re-derived in the list component, since the two source shapes' context
  // fields differ entirely and don't need to be re-inspected at render time.
  contextParts: string[];
}

function buildRidingTimelineItems(rows: RidingHistoryRow[]): CombinedTimelineItem[] {
  return rows.map((row) => {
    const contextParts: string[] = [row.horseDisplay];
    if (row.arena) contextParts.push(`מגרש: ${row.arena}`);
    if (row.lessonTopic) contextParts.push(`נושא השיעור: ${row.lessonTopic}`);
    if (row.taughtStudents.length > 0) {
      contextParts.push(`הדריך/ה: ${row.taughtStudents.map((s) => s.fullName).join(", ")}`);
    }
    return {
      key: `riding-${row.ridingSlotId}`,
      source: "riding",
      date: row.dateKey,
      time: row.startTime,
      title: "הדרכת מתקדמים",
      ratingHalfPoints: row.ratingHalfPoints,
      text: row.note,
      updatedByName: row.updatedByName,
      updatedAt: row.updatedAt,
      contextParts,
    };
  });
}

// Stage P4a - source is now passed in by the caller (one call for
// lungeTeachingPracticeFeedback, one for beginnerTeachingPracticeFeedback)
// rather than hardcoded, so the same builder produces correctly-badged items
// for both practiceType groups without duplicating this mapping logic. Both
// still belong to one Teaching Practice "family" in the UI - see
// TIMELINE_SOURCE_LABELS.
function buildTeachingPracticeTimelineItems(
  rows: TeachingPracticeFeedbackHistoryRow[],
  source: "teachingPracticeLunge" | "teachingPracticeBeginner"
): CombinedTimelineItem[] {
  return rows.map((row) => {
    const contextParts: string[] = [];
    if (row.groupName) contextParts.push(`קבוצה ${row.groupName}`);
    contextParts.push(`תפקיד: ${ROLE_LABELS[row.role]}`);
    if (row.childFullName) contextParts.push(`ילד/ה: ${row.childFullName}`);
    if (row.horseName) contextParts.push(`סוס: ${row.horseName}`);
    if (row.equipmentNotes) contextParts.push(`ציוד: ${row.equipmentNotes}`);
    if (row.location) contextParts.push(`מיקום: ${row.location}`);
    return {
      key: `teaching-practice-${row.feedbackId}`,
      source,
      date: row.date,
      time: row.startTime,
      title: PRACTICE_TYPE_LABELS[row.practiceType],
      ratingHalfPoints: row.ratingHalfPoints,
      text: row.feedback,
      updatedByName: row.updatedByName,
      updatedAt: row.updatedAt,
      contextParts,
    };
  });
}

// Stage R2 - manager-entered riding progress feedback has no time-of-day
// field at all (it's not tied to any scheduled slot), so time is always ""
// here. compareTimelineItemsNewestFirst's own date-desc/time-desc/
// updatedAt-desc tie-break still handles this safely: "" sorts after any
// real "HH:MM" value in descending order, so a same-day timed item (riding/
// Teaching Practice) simply ranks above a same-day untimed one, never the
// reverse.
function buildRidingProgressTimelineItems(rows: StudentRidingProgressFeedbackRow[]): CombinedTimelineItem[] {
  return rows.map((row) => {
    const contextParts: string[] = [];
    if (row.horseName) contextParts.push(`סוס: ${row.horseName}`);
    if (row.topic) contextParts.push(`נושא: ${row.topic}`);
    return {
      key: `riding-progress-${row.id}`,
      source: "ridingProgress",
      date: row.date,
      time: "",
      title: "רכיבה",
      ratingHalfPoints: row.ratingHalfPoints,
      text: row.feedback,
      updatedByName: row.updatedByName,
      updatedAt: row.updatedAt,
      contextParts,
    };
  });
}

// Stage P4b - same "no time-of-day field" shape as buildRidingProgressTimelineItems
// above (a לונג׳-בלי-רוכב entry isn't tied to any scheduled slot either), plus
// instructorName in contextParts.
function buildLungeProgressTimelineItems(rows: StudentLungeProgressFeedbackRow[]): CombinedTimelineItem[] {
  return rows.map((row) => {
    const contextParts: string[] = [];
    if (row.horseName) contextParts.push(`סוס: ${row.horseName}`);
    if (row.topic) contextParts.push(`נושא: ${row.topic}`);
    if (row.instructorName) contextParts.push(`מדריך/ה: ${row.instructorName}`);
    return {
      key: `lunge-progress-${row.id}`,
      source: "lungeProgress",
      date: row.date,
      time: "",
      title: "לונג׳ בלי רוכב",
      ratingHalfPoints: row.ratingHalfPoints,
      text: row.feedback,
      updatedByName: row.updatedByName,
      updatedAt: row.updatedAt,
      contextParts,
    };
  });
}

// Newest first: date desc, then time desc, then updatedAt desc as a final
// tie-break - plain string comparison only (dateKey is "YYYY-MM-DD",
// startTime is "HH:MM", updatedAt is an ISO string - all sort correctly
// lexicographically), so this can never throw on a missing/malformed value
// the way Date parsing could.
function compareTimelineItemsNewestFirst(a: CombinedTimelineItem, b: CombinedTimelineItem): number {
  return (
    b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.updatedAt.localeCompare(a.updatedAt)
  );
}

// Stage P4a - both Teaching Practice labels below stay explicitly branded
// "התנסות מתחילים · ..." (never a bare "לונג׳") per product clarification:
// LUNGE-with-rider is a Teaching Practice subtype, not the future
// standalone manager-entered לונג׳ progress category, and the combined
// timeline badge must not blur that distinction.
//
// Stage P4b - lungeProgress gets its own unambiguous "לונג׳ בלי רוכב" badge,
// deliberately never sharing wording with either teachingPracticeLunge label
// above, so the two לונג׳ concepts are never confused in the combined view.
const TIMELINE_SOURCE_LABELS: Record<CombinedTimelineItem["source"], string> = {
  riding: "הדרכת מתקדמים",
  teachingPracticeLunge: "התנסות מתחילים · לונג׳ עם רוכב",
  teachingPracticeBeginner: "התנסות מתחילים · פרטני/קבוצתי",
  ridingProgress: "רכיבה",
  lungeProgress: "לונג׳ בלי רוכב",
};

// Compact, read-only, no filters - same convention as
// TeachingPracticeFeedbackHistoryList above. Items already arrive sorted.
function CombinedTimelineList({ items }: { items: CombinedTimelineItem[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        עדיין לא הוזנו משובים לחניך/ה זה/זו.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <div key={item.key} className="rounded-xl border border-border bg-card p-4">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {TIMELINE_SOURCE_LABELS[item.source]}
              </span>
              <span className="font-semibold text-card-foreground">
                {formatHebrewDate(parseDateKey(item.date))} · {item.time}
              </span>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                item.ratingHalfPoints != null
                  ? "bg-success-muted text-success"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {item.ratingHalfPoints != null ? `דירוג: ${item.ratingHalfPoints / 2}` : "אין דירוג"}
            </span>
          </div>
          <p className="mb-1 text-base font-bold text-card-foreground">{item.title}</p>
          {item.text && <p className="mb-1 text-sm text-card-foreground">{item.text}</p>}
          {item.contextParts.length > 0 && (
            <p className="mb-1 text-xs text-muted-foreground">{item.contextParts.join(" · ")}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {item.updatedByName && `עודכן על ידי: ${item.updatedByName}`}
            {item.updatedByName && " · "}
            עודכן בתאריך: {formatHebrewDateTime(new Date(item.updatedAt))}
          </p>
        </div>
      ))}
    </div>
  );
}

export interface TraineeProgressStudentListItem {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  isActive: boolean;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

export function TraineeProgressClient({
  students,
  initialStudentId = null,
}: {
  students: TraineeProgressStudentListItem[];
  // Already validated server-side (page.tsx checks it against the loaded
  // roster before passing it down) - trusted as-is here, same as any other
  // server-provided initial prop in this app.
  initialStudentId?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [search, setSearch] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(initialStudentId);

  // Each topic section collapses/expands independently. הדרכת מתקדמים/
  // התנסויות מתחילים default expanded (unchanged from before); כל המשובים defaults
  // collapsed since it's purely a re-display of the same two sources
  // already expanded above it - keeping it collapsed by default avoids
  // tripling the page's effective length for a trainee with a lot of
  // history, while still being one click away.
  const [isRidingProgressOpen, setIsRidingProgressOpen] = useState(true);
  const [isLungeProgressOpen, setIsLungeProgressOpen] = useState(true);
  const [isRidingOpen, setIsRidingOpen] = useState(true);
  const [isTeachingPracticeOpen, setIsTeachingPracticeOpen] = useState(true);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);

  // Keeps the URL's studentId in sync with the in-page selection (deep-
  // linkable/shareable/refresh-safe), without forcing a full page reload -
  // router.replace navigates client-side, and since TraineeProgressClient
  // stays mounted at the same position across that navigation, this
  // component's own state (search text, selectedStudentId, loaded rows) is
  // preserved rather than reset; only the URL bar changes.
  useEffect(() => {
    if (!selectedStudentId) return;
    router.replace(`${pathname}?studentId=${selectedStudentId}`, { scroll: false });
  }, [selectedStudentId, pathname, router]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.fullName.toLowerCase().includes(q));
  }, [search, students]);

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) ?? null,
    [students, selectedStudentId]
  );

  const [ridingProgressRows, setRidingProgressRows] = useState<StudentRidingProgressFeedbackRow[] | null>(
    null
  );
  const [lungeProgressRows, setLungeProgressRows] = useState<StudentLungeProgressFeedbackRow[] | null>(
    null
  );
  const [ridingRows, setRidingRows] = useState<RidingHistoryRow[] | null>(null);
  const [teachingPracticeRows, setTeachingPracticeRows] = useState<TeachingPracticeFeedbackHistoryRow[] | null>(
    null
  );
  const [, startTransition] = useTransition();

  // Read-only fetch, re-run whenever a different trainee is selected - same
  // cancellation-guard shape as the riding/Teaching Practice effects below.
  // Never touches RidingLessonNote/RidingSlot/ScheduleItem or any write/
  // sync/publish action.
  useEffect(() => {
    if (!selectedStudentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRidingProgressRows(null);
      return;
    }
    let cancelled = false;
    setRidingProgressRows(null);
    startTransition(async () => {
      const result = await listStudentRidingProgressFeedbackForAdmin(selectedStudentId);
      if (!cancelled) {
        setRidingProgressRows(result ?? []);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedStudentId]);

  // Manual refresh after a successful create/update from
  // RidingProgressFeedbackList - not part of the effect above (this isn't
  // triggered by selectedStudentId changing), so it re-fetches directly
  // rather than needing its own cancellation guard.
  function refreshRidingProgress() {
    if (!selectedStudentId) return;
    startTransition(async () => {
      const result = await listStudentRidingProgressFeedbackForAdmin(selectedStudentId);
      setRidingProgressRows(result ?? []);
    });
  }

  // Stage P4b - same fetch/cancellation-guard shape as ridingProgressRows
  // above, against the new StudentLungeProgressFeedback action - never
  // touches StudentRidingProgressFeedback, RidingLessonNote, or
  // TeachingPracticeFeedback.
  useEffect(() => {
    if (!selectedStudentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLungeProgressRows(null);
      return;
    }
    let cancelled = false;
    setLungeProgressRows(null);
    startTransition(async () => {
      const result = await listStudentLungeProgressFeedbackForAdmin(selectedStudentId);
      if (!cancelled) {
        setLungeProgressRows(result ?? []);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedStudentId]);

  // Manual refresh after a successful create/update from
  // LungeProgressFeedbackList - same reasoning as refreshRidingProgress above.
  function refreshLungeProgress() {
    if (!selectedStudentId) return;
    startTransition(async () => {
      const result = await listStudentLungeProgressFeedbackForAdmin(selectedStudentId);
      setLungeProgressRows(result ?? []);
    });
  }

  // Read-only fetch, re-run whenever a different trainee is selected - same
  // getStudentRidingHistoryForAdmin call the existing riding-history page
  // uses, no new server action.
  useEffect(() => {
    if (!selectedStudentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRidingRows(null);
      return;
    }
    let cancelled = false;
    setRidingRows(null);
    startTransition(async () => {
      const result = await getStudentRidingHistoryForAdmin(selectedStudentId);
      if (!cancelled) {
        setRidingRows(result?.rows ?? []);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedStudentId]);

  // Same fetch/cancellation-guard shape as the riding effect above, against
  // the new Stage P2 read-only action - never touches the riding fetch or
  // any write/sync/publish action.
  useEffect(() => {
    if (!selectedStudentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTeachingPracticeRows(null);
      return;
    }
    let cancelled = false;
    setTeachingPracticeRows(null);
    startTransition(async () => {
      const result = await getStudentTeachingPracticeFeedbackForAdmin(selectedStudentId);
      if (!cancelled) {
        setTeachingPracticeRows(result ?? []);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedStudentId]);

  // Based on ALL loaded rows (not whatever RidingHistoryList's own internal
  // date/topic filters currently show) - per product direction, the topic-
  // level average reflects the trainee's whole riding history, not the
  // admin's momentary filter selection. RidingHistoryList's internals are
  // untouched; this reads the same rows array already passed to it.
  const ridingProgressAverageRating = useMemo(
    () =>
      ridingProgressRows
        ? averageRatingFromHalfPoints(ridingProgressRows.map((r) => r.ratingHalfPoints))
        : null,
    [ridingProgressRows]
  );

  const ridingAverageRating = useMemo(
    () => (ridingRows ? averageRatingFromHalfPoints(ridingRows.map((r) => r.ratingHalfPoints)) : null),
    [ridingRows]
  );

  // Stage P4b - the standalone "לונג׳" TopicSection's own average, from
  // StudentLungeProgressFeedback rows only - entirely unrelated to
  // teachingPracticeAverageRating below (Teaching Practice LUNGE rows never
  // contribute here, and vice versa).
  const lungeProgressAverageRating = useMemo(
    () =>
      lungeProgressRows ? averageRatingFromHalfPoints(lungeProgressRows.map((r) => r.ratingHalfPoints)) : null,
    [lungeProgressRows]
  );

  // Stage P4a - teachingPracticeRows (from getStudentTeachingPracticeFeedbackForAdmin,
  // unchanged) already contains every practice type, including LUNGE. Split
  // here, client-side only, purely so TeachingPracticeFeedbackSection can
  // render "לונג׳ עם רוכב" and "שיעורי מתחילים - פרטני/קבוצתי" as two
  // internal subsections of the one "התנסויות מתחילים" TopicSection (and so
  // the combined timeline below can badge them distinctly) - no new fetch,
  // no row duplicated or dropped, since every row has exactly one
  // practiceType and therefore lands in exactly one of the two arrays below.
  const lungeTeachingPracticeFeedback = useMemo(
    () => (teachingPracticeRows ? teachingPracticeRows.filter((r) => r.practiceType === "LUNGE") : null),
    [teachingPracticeRows]
  );

  const beginnerTeachingPracticeFeedback = useMemo(
    () =>
      teachingPracticeRows
        ? teachingPracticeRows.filter(
            (r) => r.practiceType === "BEGINNER_PRIVATE" || r.practiceType === "BEGINNER_GROUP"
          )
        : null,
    [teachingPracticeRows]
  );

  // Per product direction, the top-level "התנסויות מתחילים" TopicSection's
  // own average badge covers every Teaching Practice row together
  // (LUNGE + beginner), not just one subsection - each subsection's own
  // narrower average is computed separately, inline, inside
  // TeachingPracticeFeedbackSection.
  const teachingPracticeAverageRating = useMemo(
    () =>
      teachingPracticeRows
        ? averageRatingFromHalfPoints(teachingPracticeRows.map((r) => r.ratingHalfPoints))
        : null,
    [teachingPracticeRows]
  );

  // Stage P3/R2/P4a - combined timeline, purely a client-side merge/sort of
  // the already-loaded arrays above (no new fetch). null (still loading)
  // only while ANY source hasn't finished loading yet - waiting for all of
  // them avoids briefly showing an incomplete timeline that would look like
  // "no feedback exists" for a source that's really just still in flight.
  // lungeTeachingPracticeFeedback/beginnerTeachingPracticeFeedback are both
  // derived from teachingPracticeRows (never independently null once it
  // isn't), so gating on teachingPracticeRows alone is equivalent to gating
  // on both splits and avoids a redundant null check.
  const combinedTimelineItems = useMemo(() => {
    if (
      ridingProgressRows === null ||
      lungeProgressRows === null ||
      ridingRows === null ||
      lungeTeachingPracticeFeedback === null ||
      beginnerTeachingPracticeFeedback === null
    )
      return null;
    return [
      ...buildRidingProgressTimelineItems(ridingProgressRows),
      ...buildLungeProgressTimelineItems(lungeProgressRows),
      ...buildRidingTimelineItems(ridingRows),
      ...buildTeachingPracticeTimelineItems(lungeTeachingPracticeFeedback, "teachingPracticeLunge"),
      ...buildTeachingPracticeTimelineItems(beginnerTeachingPracticeFeedback, "teachingPracticeBeginner"),
    ].sort(compareTimelineItemsNewestFirst);
  }, [
    ridingProgressRows,
    lungeProgressRows,
    ridingRows,
    lungeTeachingPracticeFeedback,
    beginnerTeachingPracticeFeedback,
  ]);

  // Stage P4b - lungeProgressRows added alongside the pre-existing sources;
  // teachingPracticeRows here still contributes its own LUNGE rows exactly
  // once (via the raw, unsplit array, same as before Stage P4b), so
  // standalone לונג׳-בלי-רוכב rows and Teaching Practice לונג׳-עם-רוכב rows
  // are both counted, each exactly once, never double-counted against each
  // other.
  const combinedAverageRating = useMemo(() => {
    if (
      ridingProgressRows === null ||
      lungeProgressRows === null ||
      ridingRows === null ||
      teachingPracticeRows === null
    )
      return null;
    return averageRatingFromHalfPoints([
      ...ridingProgressRows.map((r) => r.ratingHalfPoints),
      ...lungeProgressRows.map((r) => r.ratingHalfPoints),
      ...ridingRows.map((r) => r.ratingHalfPoints),
      ...teachingPracticeRows.map((r) => r.ratingHalfPoints),
    ]);
  }, [ridingProgressRows, lungeProgressRows, ridingRows, teachingPracticeRows]);

  function handleSelectStudent(studentId: string) {
    setSelectedStudentId(studentId);
    setIsSearchOpen(false);
    setSearch("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-4">
        {selectedStudent && !isSearchOpen && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-card-foreground">
              חניך/ה נבחר/ת: <span className="font-semibold">{selectedStudent.fullName}</span>
            </p>
            <button
              type="button"
              onClick={() => {
                setIsSearchOpen(true);
                searchInputRef.current?.focus();
              }}
              className="text-xs font-medium text-secondary-foreground underline hover:opacity-80"
            >
              החלפת חניך/ה
            </button>
          </div>
        )}

        {/* Compact combobox - the results list is a popup that only opens
            while the input is focused/being typed into, rather than an
            always-open list permanently taking up page space. Closing on
            blur uses a short delay (rather than closing immediately) so a
            mouse click on a result still registers - onMouseDown on each
            result additionally prevents the input from blurring before that
            click's onClick fires, so mouse selection never races the close. */}
        <div className="relative">
          <label className="flex flex-col gap-1 text-sm">
            {selectedStudent ? "חיפוש/החלפת חניך/ה" : "חיפוש חניך/ה לפי שם"}
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setIsSearchOpen(true);
              }}
              onFocus={() => setIsSearchOpen(true)}
              onBlur={() => {
                setTimeout(() => setIsSearchOpen(false), 150);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setIsSearchOpen(false);
                  e.currentTarget.blur();
                }
              }}
              placeholder="הקלד/י שם..."
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>

          {isSearchOpen && (
            <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lg">
              {filteredStudents.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">לא נמצאו חניכים לפי החיפוש</p>
              ) : (
                filteredStudents.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectStudent(s.id)}
                    className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-right text-sm transition-colors ${
                      selectedStudentId === s.id
                        ? "bg-primary text-primary-foreground"
                        : "text-card-foreground hover:bg-muted"
                    }`}
                  >
                    <span>
                      {s.fullName}
                      {s.groupName ? ` · קבוצה ${s.groupName}` : ""}
                      {s.subgroupNumber != null ? ` · תת-קבוצה ${s.subgroupNumber}` : ""}
                    </span>
                    {!s.isActive && (
                      <span className="rounded-full bg-muted-foreground/20 px-2 py-0.5 text-xs">
                        לא פעיל/ה
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {selectedStudent && (
        <>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <p className="text-lg font-bold text-card-foreground">{selectedStudent.fullName}</p>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  selectedStudent.isActive
                    ? "bg-success-muted text-success"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {selectedStudent.isActive ? "פעיל/ה" : "לא פעיל/ה"}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {selectedStudent.groupName ? `קבוצה ${selectedStudent.groupName}` : "ללא קבוצה"}
              {selectedStudent.subgroupNumber != null
                ? ` · תת-קבוצה ${selectedStudent.subgroupNumber}`
                : ""}
              {" · "}
              {getHorseDisplayInfo(selectedStudent).horseNameDisplay}
            </p>
          </div>

          <TopicSection
            title="רכיבה"
            average={ridingProgressAverageRating}
            isOpen={isRidingProgressOpen}
            onToggle={() => setIsRidingProgressOpen((v) => !v)}
          >
            {ridingProgressRows === null ? (
              <p className="text-sm text-muted-foreground">טוען...</p>
            ) : (
              <RidingProgressFeedbackList
                studentId={selectedStudent.id}
                rows={ridingProgressRows}
                onChanged={refreshRidingProgress}
              />
            )}
          </TopicSection>

          {/* Stage P4b - standalone, manager-entered "לונג׳ בלי רוכב"
              progress journal (StudentLungeProgressFeedback). Deliberately
              NOT the Teaching Practice "לונג׳ עם רוכב" concept rendered as a
              subsection inside "התנסויות מתחילים" below - the subtitle here
              exists specifically to keep the two from being confused. */}
          <TopicSection
            title="לונג׳"
            subtitle="משובי לונג׳ ללא רוכב, להזנה ידנית על ידי המנהלת."
            average={lungeProgressAverageRating}
            isOpen={isLungeProgressOpen}
            onToggle={() => setIsLungeProgressOpen((v) => !v)}
          >
            {lungeProgressRows === null ? (
              <p className="text-sm text-muted-foreground">טוען...</p>
            ) : (
              <LungeProgressFeedbackList
                studentId={selectedStudent.id}
                rows={lungeProgressRows}
                onChanged={refreshLungeProgress}
              />
            )}
          </TopicSection>

          <TopicSection
            title="הדרכת מתקדמים"
            average={ridingAverageRating}
            isOpen={isRidingOpen}
            onToggle={() => setIsRidingOpen((v) => !v)}
          >
            {ridingRows === null ? (
              <p className="text-sm text-muted-foreground">טוען...</p>
            ) : (
              <RidingHistoryList rows={ridingRows} />
            )}
          </TopicSection>

          {/* Stage P4a - one top-level section for the whole Teaching
              Practice family; LUNGE ("לונג׳ עם רוכב") and beginner
              ("שיעורי מתחילים - פרטני/קבוצתי") rows render as two internal
              subsections inside TeachingPracticeFeedbackSection, never as
              separate top-level TopicSections - per product clarification,
              LUNGE-with-rider is a Teaching Practice subtype, not the future
              standalone manager-entered לונג׳ progress category. */}
          <TopicSection
            title="התנסויות מתחילים"
            average={teachingPracticeAverageRating}
            isOpen={isTeachingPracticeOpen}
            onToggle={() => setIsTeachingPracticeOpen((v) => !v)}
          >
            {lungeTeachingPracticeFeedback === null || beginnerTeachingPracticeFeedback === null ? (
              <p className="text-sm text-muted-foreground">טוען...</p>
            ) : (
              <TeachingPracticeFeedbackSection
                lungeRows={lungeTeachingPracticeFeedback}
                beginnerRows={beginnerTeachingPracticeFeedback}
              />
            )}
          </TopicSection>

          <TopicSection
            title="כל המשובים"
            average={combinedAverageRating}
            isOpen={isTimelineOpen}
            onToggle={() => setIsTimelineOpen((v) => !v)}
          >
            {combinedTimelineItems === null ? (
              <p className="text-sm text-muted-foreground">טוען...</p>
            ) : (
              <CombinedTimelineList items={combinedTimelineItems} />
            )}
          </TopicSection>
        </>
      )}
    </div>
  );
}
