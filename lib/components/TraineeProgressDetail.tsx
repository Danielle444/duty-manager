"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions/students";
import type { RidingHistoryRow } from "@/lib/actions/riding-slots";
import type {
  TeachingPracticeFeedbackHistoryRow,
  TeachingPracticeUnfilledParticipationRow,
} from "@/lib/actions/teaching-practice-feedback-history";
import type { TeachingPracticeFeedbackInput } from "@/lib/actions/teaching-practice";
import type {
  StudentRidingProgressFeedbackInput,
  StudentRidingProgressFeedbackRow,
} from "@/lib/actions/student-riding-progress-feedback";
import type {
  StudentLungeProgressFeedbackInput,
  StudentLungeProgressFeedbackRow,
} from "@/lib/actions/student-lunge-progress-feedback";
import type {
  StudentPresentationProgressFeedbackInput,
  StudentPresentationProgressFeedbackRow,
} from "@/lib/actions/student-presentation-progress-feedback";
import type { StudentGeneralNoteRow } from "@/lib/actions/student-general-notes";
import { RidingProgressFeedbackList } from "@/lib/components/RidingProgressFeedbackSection";
import { LungeProgressFeedbackList } from "@/lib/components/LungeProgressFeedbackSection";
import {
  PresentationProgressFeedbackList,
  PresentationScoreAverageBadge,
  averagePresentationFinalScore,
  formatCategoryScoresSummary,
  presentationScoreBadgeClasses,
} from "@/lib/components/PresentationProgressFeedbackSection";
import { StudentGeneralNotesSection } from "@/lib/components/StudentGeneralNotesSection";
import { RidingHistoryList } from "@/lib/components/RidingHistoryList";
import { getHorseDisplayInfo } from "@/lib/horse-info";
import { formatHebrewDate, formatHebrewDateTime, parseDateKey } from "@/lib/dates";
import type { TeachingPracticeRoleValue, TeachingPracticeTypeValue } from "@/lib/teaching-practice-rotation";

// Shared "selected trainee" detail presentation for the trainee-progress
// feature - the exact same component now backs both the manager's
// /admin/trainee-progress page (TraineeProgressClient.tsx) and the
// instructor app's "מעקב חניכים" tab (InstructorTraineeProgressSection.tsx),
// per the product requirement that an authorized instructor sees the same
// detail layout/section content/records/timelines/averages the manager
// sees - never a reduced or instructor-only summary. What differs between
// the two callers is entirely captured by the `capabilities` prop (which
// edit controls render) and the `dataSource` prop (which server actions
// back each section - admin's *AsAdmin actions vs. the instructor-scoped
// actions, each with their own fresh-from-DB permission check). This
// component itself never imports requireAdmin or any *AsAdmin action
// directly - it only ever calls whatever function the caller passed in.

// ---------------------------------------------------------------------------
// Shared small display primitives
// ---------------------------------------------------------------------------

function formatTopicAverageLabel(average: number | null): string {
  if (average == null) return "אין דירוגים";
  return `ממוצע ${average.toFixed(1)}`;
}

function averageRatingFromHalfPoints(ratingsHalfPoints: (number | null)[]): number | null {
  const rated = ratingsHalfPoints.filter((v): v is number => v != null);
  if (rated.length === 0) return null;
  return rated.reduce((sum, v) => sum + v, 0) / rated.length / 2;
}

function topicAverageBadgeClasses(average: number | null): string {
  if (average == null) return "bg-muted text-muted-foreground";
  if (average >= 4.5) return "bg-success-muted text-success";
  if (average >= 3.5) return "bg-sky-100 text-sky-800";
  if (average >= 2.5) return "bg-warning-muted text-warning";
  return "bg-danger-muted text-danger";
}

function TopicAverageBadge({ average }: { average: number | null }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${topicAverageBadgeClasses(average)}`}>
      {formatTopicAverageLabel(average)}
    </span>
  );
}

function TopicSection({
  title,
  subtitle,
  average,
  badge,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  average: number | null;
  badge?: React.ReactNode;
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
            {badge ?? <TopicAverageBadge average={average} />}
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

// ---------------------------------------------------------------------------
// התנסויות מתחילים - read-only history, plus an optional inline edit
// affordance per row for instructors with canEditTeachingPracticeFeedback
// ---------------------------------------------------------------------------

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

const TP_RATING_HALF_POINT_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

// Small dedicated rating+feedback entry form, same shape/scope as
// RidingProgressEntryForm/LungeProgressEntryForm (this app's established
// per-topic entry-form convention inside the trainee-progress screen -
// every journal here gets its own small form calling its own action, rather
// than reusing a different screen's editor). Deliberately NOT
// TeachingPracticeFeedbackModal (TeachingPracticeManager.tsx's own lesson-
// scheduling feedback editor, with its date/trainee switcher chrome that
// has no meaning in this per-trainee history context) - this calls the
// exact same underlying action (upsertTeachingPracticeFeedbackAsInstructor)
// and is gated by the exact same canEditTeachingPracticeFeedback permission
// check that action already re-verifies server-side, so there is no second
// persistence implementation here, only a second, narrower entry point into
// the same one.
function TeachingPracticeFeedbackEntryForm({
  initialRatingHalfPoints,
  initialFeedback,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initialRatingHalfPoints: number | null;
  initialFeedback: string | null;
  pending: boolean;
  error: string | null;
  onSubmit: (input: TeachingPracticeFeedbackInput) => void;
  onCancel: () => void;
}) {
  const [ratingHalfPoints, setRatingHalfPoints] = useState(
    initialRatingHalfPoints != null ? String(initialRatingHalfPoints) : ""
  );
  const [feedback, setFeedback] = useState(initialFeedback ?? "");

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        דירוג
        <select
          value={ratingHalfPoints}
          onChange={(e) => setRatingHalfPoints(e.target.value)}
          className="rounded-lg border border-border px-2 py-1.5 text-sm"
        >
          <option value="">ללא דירוג</option>
          {TP_RATING_HALF_POINT_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {(v / 2).toFixed(1)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        משוב
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={2}
          className="rounded-lg border border-border px-2 py-1.5 text-sm"
        />
      </label>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            onSubmit({
              ratingHalfPoints: ratingHalfPoints ? Number(ratingHalfPoints) : null,
              feedback: feedback.trim() || null,
            })
          }
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          שמירה
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/70"
        >
          ביטול
        </button>
      </div>
    </div>
  );
}

// Meaningful-feedback rows only, always - this list never renders a
// not-yet-filled-in participation (see TeachingPracticeUnfilledParticipationRow's
// own comment on why that's a hard, separate-DTO requirement). "existing
// feedback → editable" is still supported: canEdit/onSaveFeedback still let
// an authorized instructor open the same TeachingPracticeFeedbackEntryForm
// on an existing row - only the "create the first entry" path moved out to
// AddTeachingPracticeFeedbackPicker below.
function TeachingPracticeFeedbackHistoryList({
  rows,
  emptyMessage = "עדיין לא הוזן משוב התנסויות מתחילים לחניך/ה זה/זו.",
  canEdit,
  onSaveFeedback,
  onSaved,
}: {
  rows: TeachingPracticeFeedbackHistoryRow[];
  emptyMessage?: string;
  canEdit: boolean;
  onSaveFeedback?: (participantId: string, input: TeachingPracticeFeedbackInput) => Promise<ActionResult>;
  onSaved: () => void;
}) {
  const [editingParticipantId, setEditingParticipantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave(participantId: string, input: TeachingPracticeFeedbackInput) {
    if (!onSaveFeedback) return;
    setError(null);
    startTransition(async () => {
      const result = await onSaveFeedback(participantId, input);
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      setEditingParticipantId(null);
      onSaved();
    });
  }

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
          {canEdit && onSaveFeedback && (
            <div className="mt-1">
              {editingParticipantId === row.participantId ? (
                <TeachingPracticeFeedbackEntryForm
                  initialRatingHalfPoints={row.ratingHalfPoints}
                  initialFeedback={row.feedback}
                  pending={isPending}
                  error={error}
                  onSubmit={(input) => handleSave(row.participantId, input)}
                  onCancel={() => {
                    setEditingParticipantId(null);
                    setError(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditingParticipantId(row.participantId);
                    setError(null);
                  }}
                  className="text-xs font-medium text-secondary-foreground underline hover:opacity-80"
                >
                  עריכה
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// The "הוספת משוב להתנסות" action - a compact, collapsed-by-default picker
// over real not-yet-filled-in participations (TeachingPracticeUnfilledParticipationRow,
// from getUnfilledTeachingPracticeParticipationsForInstructor - never
// synthesized). Selecting one opens the exact same TeachingPracticeFeedbackEntryForm
// used to edit an existing row, seeded empty, saving through the same
// onSaveFeedback (upsertTeachingPracticeFeedbackAsInstructor). Only ever
// rendered when the caller has both canEdit and a non-empty/loaded
// unfilledRows array to show - see TeachingPracticeFeedbackSection below.
function AddTeachingPracticeFeedbackPicker({
  unfilledRows,
  onSaveFeedback,
  onSaved,
}: {
  unfilledRows: TeachingPracticeUnfilledParticipationRow[];
  onSaveFeedback: (participantId: string, input: TeachingPracticeFeedbackInput) => Promise<ActionResult>;
  onSaved: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave(participantId: string, input: TeachingPracticeFeedbackInput) {
    setError(null);
    startTransition(async () => {
      const result = await onSaveFeedback(participantId, input);
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      setSelectedParticipantId(null);
      setIsOpen(false);
      onSaved();
    });
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="self-start rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
      >
        הוספת משוב להתנסות
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
      {selectedParticipantId ? (
        <TeachingPracticeFeedbackEntryForm
          initialRatingHalfPoints={null}
          initialFeedback={null}
          pending={isPending}
          error={error}
          onSubmit={(input) => handleSave(selectedParticipantId, input)}
          onCancel={() => {
            setSelectedParticipantId(null);
            setError(null);
          }}
        />
      ) : (
        <>
          {unfilledRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">אין התנסויות ללא משוב.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {unfilledRows.map((row) => (
                <button
                  key={row.participantId}
                  type="button"
                  onClick={() => setSelectedParticipantId(row.participantId)}
                  className="flex flex-col items-start gap-0.5 rounded-lg border border-border bg-card px-3 py-2 text-right text-xs hover:bg-muted"
                >
                  <span className="font-semibold text-card-foreground">
                    {formatHebrewDate(parseDateKey(row.date))} · {row.startTime}-{row.endTime} ·{" "}
                    {PRACTICE_TYPE_LABELS[row.practiceType]}
                  </span>
                  <span className="text-muted-foreground">
                    תפקיד: {ROLE_LABELS[row.role]}
                    {row.groupName ? ` · קבוצה ${row.groupName}` : ""}
                    {row.childFullName ? ` · ילד/ה: ${row.childFullName}` : ""}
                    {row.horseName ? ` · סוס: ${row.horseName}` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="self-start rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/70"
          >
            ביטול
          </button>
        </>
      )}
    </div>
  );
}

function TeachingPracticeFeedbackSection({
  lungeRows,
  beginnerRows,
  canEdit,
  unfilledRows,
  onSaveFeedback,
  onSaved,
}: {
  lungeRows: TeachingPracticeFeedbackHistoryRow[];
  beginnerRows: TeachingPracticeFeedbackHistoryRow[];
  canEdit: boolean;
  // null while still loading, or simply never provided for a caller without
  // canEdit (admin, or an instructor without canEditTeachingPracticeFeedback)
  // - the add-action only ever renders when both canEdit and a loaded array
  // are present.
  unfilledRows: TeachingPracticeUnfilledParticipationRow[] | null;
  onSaveFeedback?: (participantId: string, input: TeachingPracticeFeedbackInput) => Promise<ActionResult>;
  onSaved: () => void;
}) {
  const lungeAverage = averageRatingFromHalfPoints(lungeRows.map((r) => r.ratingHalfPoints));
  const beginnerAverage = averageRatingFromHalfPoints(beginnerRows.map((r) => r.ratingHalfPoints));
  // A single, friendlier neutral message when there is truly nothing to
  // show yet across both subsections, instead of two separate near-
  // identical empty-state blocks - purely presentational, applies the same
  // way for admin and instructor alike (never changes which rows are
  // included, only what's shown when there are zero of them).
  const isEntirelyEmpty = lungeRows.length === 0 && beginnerRows.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {isEntirelyEmpty ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          אין עדיין משובים על התנסויות מתחילים
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-bold text-card-foreground">לונג׳ עם רוכב</h4>
              <TopicAverageBadge average={lungeAverage} />
            </div>
            <TeachingPracticeFeedbackHistoryList
              rows={lungeRows}
              emptyMessage="עדיין לא הוזן משוב לונג׳ עם רוכב לחניך/ה זה/זו."
              canEdit={canEdit}
              onSaveFeedback={onSaveFeedback}
              onSaved={onSaved}
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
              canEdit={canEdit}
              onSaveFeedback={onSaveFeedback}
              onSaved={onSaved}
            />
          </div>
        </>
      )}

      {canEdit && onSaveFeedback && unfilledRows !== null && (
        <div className="border-t border-border pt-4">
          <AddTeachingPracticeFeedbackPicker
            unfilledRows={unfilledRows}
            onSaveFeedback={onSaveFeedback}
            onSaved={onSaved}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// כל המשובים - combined, read-only timeline. Logic is byte-for-byte
// unchanged from the pre-extraction version in both directions:
// presentation rows were ALREADY included in the timeline before this task
// (buildPresentationProgressTimelineItems was already called here) and were
// ALREADY excluded from combinedAverageRating before this task (presentation
// scores a 0-100 finalScore, a different scale from the 1.0-5.0
// ratingHalfPoints every other source here averages - see
// buildPresentationProgressTimelineItems/combinedAverageRating below, both
// unmodified). The only thing that changed this stage is WHO this code now
// runs for: an instructor with canEditRidingNotes now legitimately loads
// real presentationProgressRows (previously always inaccessible to
// instructors), so their own timeline now naturally includes presentation
// entries via this exact same, never-touched code path - not a new
// inclusion rule, just new data reaching pre-existing logic.
// ---------------------------------------------------------------------------

interface CombinedTimelineItem {
  key: string;
  source:
    | "riding"
    | "teachingPracticeLunge"
    | "teachingPracticeBeginner"
    | "ridingProgress"
    | "lungeProgress"
    | "presentationProgress";
  date: string;
  time: string;
  title: string;
  ratingHalfPoints: number | null;
  presentationScore?: number | null;
  text: string | null;
  updatedByName: string | null;
  updatedAt: string;
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

// rows here are always meaningful-only (TeachingPracticeFeedbackHistoryRow
// no longer has an empty/"טרם מולא" variant at all - see that type's own
// comment), so every row becomes a timeline entry, same as before this
// whole feature ever existed.
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

function buildPresentationProgressTimelineItems(
  rows: StudentPresentationProgressFeedbackRow[]
): CombinedTimelineItem[] {
  return rows.map((row) => {
    const contextParts: string[] = [];
    if (row.topic) contextParts.push(`נושא: ${row.topic}`);
    if (row.presentationType) contextParts.push(`סוג: ${row.presentationType}`);
    const categorySummary = formatCategoryScoresSummary(row.categoryScores);
    if (categorySummary) contextParts.push(`ציון בסיס: ${row.baseScore} · ${categorySummary}`);
    return {
      key: `presentation-progress-${row.id}`,
      source: "presentationProgress",
      date: row.date,
      time: "",
      title: "פרזנטציה",
      ratingHalfPoints: null,
      presentationScore: row.finalScore,
      text: row.feedback,
      updatedByName: row.updatedByName,
      updatedAt: row.updatedAt,
      contextParts,
    };
  });
}

function compareTimelineItemsNewestFirst(a: CombinedTimelineItem, b: CombinedTimelineItem): number {
  return (
    b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.updatedAt.localeCompare(a.updatedAt)
  );
}

const TIMELINE_SOURCE_LABELS: Record<CombinedTimelineItem["source"], string> = {
  riding: "הדרכת מתקדמים",
  teachingPracticeLunge: "התנסות מתחילים · לונג׳ עם רוכב",
  teachingPracticeBeginner: "התנסות מתחילים · פרטני/קבוצתי",
  ridingProgress: "רכיבה",
  lungeProgress: "לונג׳ בלי רוכב",
  presentationProgress: "פרזנטציה",
};

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
                item.presentationScore != null
                  ? presentationScoreBadgeClasses(item.presentationScore)
                  : item.ratingHalfPoints != null
                  ? "bg-success-muted text-success"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {item.presentationScore != null
                ? `ציון: ${item.presentationScore}`
                : item.ratingHalfPoints != null
                ? `דירוג: ${item.ratingHalfPoints / 2}`
                : "אין דירוג"}
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

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------

export interface TraineeProgressDetailStudent {
  id: string;
  fullName: string;
  isActive: boolean;
  groupName: string | null;
  subgroupNumber: number | null;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

// Which edit controls render - never trusted as the real authorization
// boundary (that's always the fresh-from-DB check inside whichever
// dataSource action actually gets called), purely a presentation switch.
export interface TraineeProgressCapabilities {
  isAdmin: boolean;
  canEditRidingFeedback: boolean;
  canEditTeachingPracticeFeedback: boolean;
  canDeleteGeneralNotes: boolean;
}

// Every read/write this component needs, supplied by the caller. Admin's
// caller (TraineeProgressClient.tsx) passes the existing *AsAdmin actions
// directly; the instructor's caller (InstructorTraineeProgressSection.tsx)
// passes thin wrappers around the instructor-scoped actions that also
// thread instructorId through (same actions-prop parameterization
// convention as RidingProgressFeedbackList/LungeProgressFeedbackList
// already established). Optional write fields are omitted by whichever
// caller doesn't have a corresponding permission - their absence is what
// actually hides the control, not a client-side flag alone.
export interface TraineeProgressDataSource {
  listGeneralNotes: (studentId: string) => Promise<StudentGeneralNoteRow[] | null>;
  createGeneralNote: (studentId: string, content: string) => Promise<ActionResult>;
  updateGeneralNote: (noteId: string, content: string) => Promise<ActionResult>;
  deleteGeneralNote?: (noteId: string) => Promise<ActionResult>;

  listRidingProgress: (studentId: string) => Promise<StudentRidingProgressFeedbackRow[] | null>;
  createRidingProgress?: (studentId: string, input: StudentRidingProgressFeedbackInput) => Promise<ActionResult>;
  updateRidingProgress?: (id: string, input: StudentRidingProgressFeedbackInput) => Promise<ActionResult>;
  deleteRidingProgress?: (id: string) => Promise<ActionResult>;

  getRidingHistory: (studentId: string) => Promise<RidingHistoryRow[] | null>;

  getTeachingPracticeHistory: (studentId: string) => Promise<TeachingPracticeFeedbackHistoryRow[] | null>;
  upsertTeachingPracticeFeedback?: (
    participantId: string,
    input: TeachingPracticeFeedbackInput
  ) => Promise<ActionResult>;
  // Feeds the "הוספת משוב להתנסות" picker only - present only for the
  // instructor caller (and only meaningful when canEditTeachingPracticeFeedback
  // is true; see getUnfilledTeachingPracticeParticipationsForInstructor's own
  // authorization comment). Never provided by the admin caller - admin gets
  // no add-action, per the approved scope for this stage.
  listUnfilledTeachingPracticeParticipations?: (
    studentId: string
  ) => Promise<TeachingPracticeUnfilledParticipationRow[] | null>;

  listLungeProgress: (studentId: string) => Promise<StudentLungeProgressFeedbackRow[] | null>;
  createLungeProgress?: (studentId: string, input: StudentLungeProgressFeedbackInput) => Promise<ActionResult>;
  updateLungeProgress?: (id: string, input: StudentLungeProgressFeedbackInput) => Promise<ActionResult>;
  deleteLungeProgress?: (id: string) => Promise<ActionResult>;

  listPresentationProgress: (studentId: string) => Promise<StudentPresentationProgressFeedbackRow[] | null>;
  createPresentationProgress?: (
    studentId: string,
    input: StudentPresentationProgressFeedbackInput
  ) => Promise<ActionResult>;
  updatePresentationProgress?: (
    id: string,
    input: StudentPresentationProgressFeedbackInput
  ) => Promise<ActionResult>;
  deletePresentationProgress?: (id: string) => Promise<ActionResult>;
}

export function TraineeProgressDetail({
  student,
  capabilities,
  actorInstructorId,
  dataSource,
}: {
  student: TraineeProgressDetailStudent;
  capabilities: TraineeProgressCapabilities;
  // The acting instructor's own id - used only to decide, per row, whether
  // an edit/delete control renders for the riding/lunge/presentation
  // progress-journal sections (the "view all, edit own" rule). Unused (and
  // unnecessary) for admin, who may edit any row.
  actorInstructorId?: string;
  dataSource: TraineeProgressDataSource;
}) {
  const studentId = student.id;

  const [isGeneralNotesOpen, setIsGeneralNotesOpen] = useState(true);
  const [isRidingProgressOpen, setIsRidingProgressOpen] = useState(true);
  const [isRidingOpen, setIsRidingOpen] = useState(true);
  const [isTeachingPracticeOpen, setIsTeachingPracticeOpen] = useState(true);
  const [isLungeProgressOpen, setIsLungeProgressOpen] = useState(true);
  const [isPresentationProgressOpen, setIsPresentationProgressOpen] = useState(true);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);

  const [generalNoteRows, setGeneralNoteRows] = useState<StudentGeneralNoteRow[] | null>(null);
  const [ridingProgressRows, setRidingProgressRows] = useState<StudentRidingProgressFeedbackRow[] | null>(null);
  const [ridingRows, setRidingRows] = useState<RidingHistoryRow[] | null>(null);
  const [teachingPracticeRows, setTeachingPracticeRows] = useState<TeachingPracticeFeedbackHistoryRow[] | null>(
    null
  );
  const [lungeProgressRows, setLungeProgressRows] = useState<StudentLungeProgressFeedbackRow[] | null>(null);
  const [presentationProgressRows, setPresentationProgressRows] = useState<
    StudentPresentationProgressFeedbackRow[] | null
  >(null);
  const [unfilledTeachingPracticeRows, setUnfilledTeachingPracticeRows] = useState<
    TeachingPracticeUnfilledParticipationRow[] | null
  >(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGeneralNoteRows(null);
    startTransition(async () => {
      const result = await dataSource.listGeneralNotes(studentId);
      if (!cancelled) setGeneralNoteRows(result ?? []);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  function refreshGeneralNotes() {
    startTransition(async () => {
      const result = await dataSource.listGeneralNotes(studentId);
      setGeneralNoteRows(result ?? []);
    });
  }

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRidingProgressRows(null);
    startTransition(async () => {
      const result = await dataSource.listRidingProgress(studentId);
      if (!cancelled) setRidingProgressRows(result ?? []);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  function refreshRidingProgress() {
    startTransition(async () => {
      const result = await dataSource.listRidingProgress(studentId);
      setRidingProgressRows(result ?? []);
    });
  }

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRidingRows(null);
    startTransition(async () => {
      const result = await dataSource.getRidingHistory(studentId);
      if (!cancelled) setRidingRows(result ?? []);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTeachingPracticeRows(null);
    startTransition(async () => {
      const result = await dataSource.getTeachingPracticeHistory(studentId);
      if (!cancelled) setTeachingPracticeRows(result ?? []);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  // Only fetched when the caller actually provided the loader (the
  // instructor caller, when canEditTeachingPracticeFeedback) - null stays
  // null for admin/view-only-instructor, which is exactly what tells
  // TeachingPracticeFeedbackSection not to render the add-action at all.
  useEffect(() => {
    if (!dataSource.listUnfilledTeachingPracticeParticipations) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUnfilledTeachingPracticeRows(null);
      return;
    }
    let cancelled = false;
    setUnfilledTeachingPracticeRows(null);
    startTransition(async () => {
      const result = await dataSource.listUnfilledTeachingPracticeParticipations!(studentId);
      if (!cancelled) setUnfilledTeachingPracticeRows(result ?? []);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  // Refreshes both the visible history AND the unfilled-participations
  // picker after any Teaching Practice save - a first-time save must move
  // the occurrence out of the "הוספת משוב להתנסות" list and into the normal
  // history list in the same refresh, never leaving it in both or neither.
  function refreshTeachingPractice() {
    startTransition(async () => {
      const result = await dataSource.getTeachingPracticeHistory(studentId);
      setTeachingPracticeRows(result ?? []);
    });
    if (dataSource.listUnfilledTeachingPracticeParticipations) {
      startTransition(async () => {
        const result = await dataSource.listUnfilledTeachingPracticeParticipations!(studentId);
        setUnfilledTeachingPracticeRows(result ?? []);
      });
    }
  }

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLungeProgressRows(null);
    startTransition(async () => {
      const result = await dataSource.listLungeProgress(studentId);
      if (!cancelled) setLungeProgressRows(result ?? []);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  function refreshLungeProgress() {
    startTransition(async () => {
      const result = await dataSource.listLungeProgress(studentId);
      setLungeProgressRows(result ?? []);
    });
  }

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresentationProgressRows(null);
    startTransition(async () => {
      const result = await dataSource.listPresentationProgress(studentId);
      if (!cancelled) setPresentationProgressRows(result ?? []);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  function refreshPresentationProgress() {
    startTransition(async () => {
      const result = await dataSource.listPresentationProgress(studentId);
      setPresentationProgressRows(result ?? []);
    });
  }

  const ridingProgressAverageRating = useMemo(
    () =>
      ridingProgressRows ? averageRatingFromHalfPoints(ridingProgressRows.map((r) => r.ratingHalfPoints)) : null,
    [ridingProgressRows]
  );

  const ridingAverageRating = useMemo(
    () => (ridingRows ? averageRatingFromHalfPoints(ridingRows.map((r) => r.ratingHalfPoints)) : null),
    [ridingRows]
  );

  const lungeProgressAverageRating = useMemo(
    () =>
      lungeProgressRows ? averageRatingFromHalfPoints(lungeProgressRows.map((r) => r.ratingHalfPoints)) : null,
    [lungeProgressRows]
  );

  const presentationScoreAverageRating = useMemo(
    () => (presentationProgressRows ? averagePresentationFinalScore(presentationProgressRows.map((r) => r.finalScore)) : null),
    [presentationProgressRows]
  );

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

  const teachingPracticeAverageRating = useMemo(
    () =>
      teachingPracticeRows
        ? averageRatingFromHalfPoints(teachingPracticeRows.map((r) => r.ratingHalfPoints))
        : null,
    [teachingPracticeRows]
  );

  const combinedTimelineItems = useMemo(() => {
    if (
      ridingProgressRows === null ||
      lungeProgressRows === null ||
      presentationProgressRows === null ||
      ridingRows === null ||
      lungeTeachingPracticeFeedback === null ||
      beginnerTeachingPracticeFeedback === null
    )
      return null;
    return [
      ...buildRidingProgressTimelineItems(ridingProgressRows),
      ...buildLungeProgressTimelineItems(lungeProgressRows),
      ...buildPresentationProgressTimelineItems(presentationProgressRows),
      ...buildRidingTimelineItems(ridingRows),
      ...buildTeachingPracticeTimelineItems(lungeTeachingPracticeFeedback, "teachingPracticeLunge"),
      ...buildTeachingPracticeTimelineItems(beginnerTeachingPracticeFeedback, "teachingPracticeBeginner"),
    ].sort(compareTimelineItemsNewestFirst);
  }, [
    ridingProgressRows,
    lungeProgressRows,
    presentationProgressRows,
    ridingRows,
    lungeTeachingPracticeFeedback,
    beginnerTeachingPracticeFeedback,
  ]);

  const combinedAverageRating = useMemo(() => {
    if (
      ridingProgressRows === null ||
      lungeProgressRows === null ||
      presentationProgressRows === null ||
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
  }, [ridingProgressRows, lungeProgressRows, presentationProgressRows, ridingRows, teachingPracticeRows]);

  // "View all, edit own" for the three journals below - admin may always
  // edit/delete any row (unchanged manager behavior); an instructor may
  // only edit/delete rows they themselves created, regardless of whose
  // rows they can SEE (every row for the trainee, same as the manager).
  function isOwnRow(row: { createdByInstructorId: string | null }): boolean {
    if (capabilities.isAdmin) return true;
    return actorInstructorId != null && row.createdByInstructorId === actorInstructorId;
  }

  const canAddRidingFeedback = capabilities.isAdmin || capabilities.canEditRidingFeedback;
  const canEditTeachingPracticeFeedbackHere = !capabilities.isAdmin && capabilities.canEditTeachingPracticeFeedback;

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <p className="text-lg font-bold text-card-foreground">{student.fullName}</p>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              student.isActive ? "bg-success-muted text-success" : "bg-muted text-muted-foreground"
            }`}
          >
            {student.isActive ? "פעיל/ה" : "לא פעיל/ה"}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {student.groupName ? `קבוצה ${student.groupName}` : "ללא קבוצה"}
          {student.subgroupNumber != null ? ` · תת-קבוצה ${student.subgroupNumber}` : ""}
          {" · "}
          {getHorseDisplayInfo(student).horseNameDisplay}
        </p>
      </div>

      <TopicSection
        title="הערות כלליות"
        average={null}
        badge={
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            {generalNoteRows === null ? "…" : `${generalNoteRows.length} הערות`}
          </span>
        }
        isOpen={isGeneralNotesOpen}
        onToggle={() => setIsGeneralNotesOpen((v) => !v)}
      >
        {generalNoteRows === null ? (
          <p className="text-sm text-muted-foreground">טוען...</p>
        ) : (
          <StudentGeneralNotesSection
            key={studentId}
            studentId={studentId}
            rows={generalNoteRows}
            onChanged={refreshGeneralNotes}
            actions={{
              create: dataSource.createGeneralNote,
              update: dataSource.updateGeneralNote,
              delete: capabilities.canDeleteGeneralNotes ? dataSource.deleteGeneralNote : undefined,
            }}
          />
        )}
      </TopicSection>

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
            studentId={studentId}
            rows={ridingProgressRows}
            onChanged={refreshRidingProgress}
            canAdd={canAddRidingFeedback}
            isRowEditable={isOwnRow}
            isRowDeletable={() => capabilities.isAdmin}
            actions={{
              create: dataSource.createRidingProgress ?? (async () => ({ success: false, error: "אין הרשאה" })),
              update: dataSource.updateRidingProgress ?? (async () => ({ success: false, error: "אין הרשאה" })),
              delete: dataSource.deleteRidingProgress ?? (async () => ({ success: false, error: "אין הרשאה" })),
            }}
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
            canEdit={canEditTeachingPracticeFeedbackHere}
            unfilledRows={unfilledTeachingPracticeRows}
            onSaveFeedback={dataSource.upsertTeachingPracticeFeedback}
            onSaved={refreshTeachingPractice}
          />
        )}
      </TopicSection>

      {/* לונג׳ בלי רוכב - kept immediately before פרזנטציה/כל המשובים per the
          required final section order; a pure presentation-order change,
          same data/queries/averages as every other section here. */}
      <TopicSection
        title="לונג׳"
        subtitle="משובי לונג׳ ללא רוכב, להזנה ידנית."
        average={lungeProgressAverageRating}
        isOpen={isLungeProgressOpen}
        onToggle={() => setIsLungeProgressOpen((v) => !v)}
      >
        {lungeProgressRows === null ? (
          <p className="text-sm text-muted-foreground">טוען...</p>
        ) : (
          <LungeProgressFeedbackList
            studentId={studentId}
            rows={lungeProgressRows}
            onChanged={refreshLungeProgress}
            canAdd={canAddRidingFeedback}
            isRowEditable={isOwnRow}
            isRowDeletable={() => capabilities.isAdmin}
            actions={{
              create: dataSource.createLungeProgress ?? (async () => ({ success: false, error: "אין הרשאה" })),
              update: dataSource.updateLungeProgress ?? (async () => ({ success: false, error: "אין הרשאה" })),
              delete: dataSource.deleteLungeProgress ?? (async () => ({ success: false, error: "אין הרשאה" })),
            }}
          />
        )}
      </TopicSection>

      <TopicSection
        title="פרזנטציה"
        subtitle="משובי פרזנטציה. ציון בסיס 70 + קטגוריות ניקוד."
        average={null}
        badge={<PresentationScoreAverageBadge average={presentationScoreAverageRating} />}
        isOpen={isPresentationProgressOpen}
        onToggle={() => setIsPresentationProgressOpen((v) => !v)}
      >
        {presentationProgressRows === null ? (
          <p className="text-sm text-muted-foreground">טוען...</p>
        ) : (
          <PresentationProgressFeedbackList
            studentId={studentId}
            rows={presentationProgressRows}
            onChanged={refreshPresentationProgress}
            canAdd={canAddRidingFeedback}
            isRowEditable={isOwnRow}
            isRowDeletable={() => capabilities.isAdmin}
            actions={{
              create:
                dataSource.createPresentationProgress ?? (async () => ({ success: false, error: "אין הרשאה" })),
              update:
                dataSource.updatePresentationProgress ?? (async () => ({ success: false, error: "אין הרשאה" })),
              delete:
                dataSource.deletePresentationProgress ?? (async () => ({ success: false, error: "אין הרשאה" })),
            }}
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
  );
}
