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
  type StudentRidingProgressFeedbackRow,
} from "@/lib/actions/student-riding-progress-feedback";
import {
  createStudentLungeProgressFeedbackAsAdmin,
  deleteStudentLungeProgressFeedbackAsAdmin,
  listStudentLungeProgressFeedbackForAdmin,
  updateStudentLungeProgressFeedbackAsAdmin,
  type StudentLungeProgressFeedbackRow,
} from "@/lib/actions/student-lunge-progress-feedback";
import { RidingProgressFeedbackList } from "@/lib/components/RidingProgressFeedbackSection";
import { LungeProgressFeedbackList } from "@/lib/components/LungeProgressFeedbackSection";
import {
  createStudentPresentationProgressFeedbackAsAdmin,
  deleteStudentPresentationProgressFeedbackAsAdmin,
  listStudentPresentationProgressFeedbackForAdmin,
  updateStudentPresentationProgressFeedbackAsAdmin,
  type StudentPresentationProgressFeedbackInput,
  type StudentPresentationProgressFeedbackRow,
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
  badge,
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
  // Stage P4c (revised) - overrides the default TopicAverageBadge (built
  // around the 1.0-5.0 half-point rating scale every other section here
  // uses) for a section whose "average" is on a different scale entirely -
  // e.g. פרזנטציה's 0-100 finalScore, where TopicAverageBadge's color
  // thresholds and "ממוצע X.X" wording would be meaningless/misleading.
  // When omitted, every existing section's behavior (including `average`
  // itself) is completely unchanged.
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

// Stage I2 - the רכיבה and לונג׳ form/list components that used to live
// here (RidingProgressEntryForm/RidingProgressFeedbackList,
// LungeProgressEntryForm/LungeProgressFeedbackList) were extracted to
// lib/components/RidingProgressFeedbackSection.tsx and
// lib/components/LungeProgressFeedbackSection.tsx, parameterized with an
// `actions` prop, so the instructor "מעקב חניכים" screen
// (app/instructor/InstructorTraineeProgressSection.tsx) can reuse the exact
// same UI instead of duplicating it. This admin page now imports
// RidingProgressFeedbackList/LungeProgressFeedbackList from there (see the
// imports at the top of this file) and passes the existing *AsAdmin actions
// through the `actions` prop at each call site below - the rendered UI and
// admin behavior are unchanged.

// Stage I2 - kept here (also duplicated into
// lib/components/RidingProgressFeedbackSection.tsx and
// lib/components/LungeProgressFeedbackSection.tsx) since the presentation
// form below still needs it and presentation wasn't part of this stage's
// extraction.
function todayDateInputValue(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Stage P4c (revised again) - manager-entered פרזנטציה progress feedback
// (StudentPresentationProgressFeedback) - a standalone journal per trainee,
// same non-per-session pattern as the לונג׳ section above, but scored
// against the FIXED rubric from the actual uploaded presentation exam form
// (see lib/presentation-rubric.ts, shared by both this file and the server
// actions) - exactly 10 fixed categories, each one of -1/-0.5/0/+0.5/+1,
// never a free-form category name or an arbitrary point value. Never the
// generic 1.0-5.0 ratingHalfPoints scale every other progress section here
// uses.
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
// hasMeaningfulContent in lib/actions/student-presentation-progress-feedback.ts)
// - checked here too so the admin gets an immediate, specific Hebrew error
// instead of a round-trip just to learn the same thing. An all-zero rubric
// (every category left at its 0 default) with no text counts as "nothing
// entered yet," same as the server-side rule.
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
// PRESENTATION_CATEGORY_SCORE_OPTIONS (never an arbitrary number). Compact
// list layout (label + select per row) rather than a literal <table> -
// consistent with every other compact field-list in this file (e.g.
// PresentationCategoryScoresEditor's predecessor, TaughtStudentsChecklist).
// Inline chip buttons, not a <select> - deliberately laid out to read like
// the uploaded exam sheet: one row per fixed category, five tappable score
// options side by side with the current selection visually filled-in.
// flex-wrap + flex-1 (rather than a fixed width) lets the 5 buttons shrink
// to fit a narrow phone screen without needing a horizontal scroll, while
// still growing to fill the row on a wider tablet/desktop layout.
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

// Same overall shape as LungeProgressEntryForm above (see that component's
// own comment on why this is duplicated rather than generalized), but the
// rating <select> is replaced with PresentationRubricEditor (the fixed
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

// Same 4-tier convention as topicAverageBadgeClasses, but recalibrated to
// this rubric's actual possible range - baseScore 70 +/- up to 10 (10
// categories x max 1 point each) means finalScore can only ever land in
// [60, 80], with 66 as the passing line (PRESENTATION_PASSING_SCORE). The
// old generic 0-100 thresholds (>=90/>=75/>=60) would never even reach the
// top tier and would call a failing 61 "warning" alongside a passing 66 -
// these bands are deliberately built around the passing score instead.
// Deliberately NOT reusing topicAverageBadgeClasses/formatTopicAverageLabel/
// averageRatingFromHalfPoints, which are built around the unrelated 1.0-5.0
// half-point scale.
function presentationScoreBadgeClasses(score: number): string {
  if (score >= 76) return "bg-success-muted text-success";
  if (score >= PRESENTATION_PASSING_SCORE) return "bg-sky-100 text-sky-800";
  if (score >= PRESENTATION_PASSING_SCORE - 5) return "bg-warning-muted text-warning";
  return "bg-danger-muted text-danger";
}

// Small "עובר"/"לא עובר" badge against PRESENTATION_PASSING_SCORE (66) -
// shown alongside (never instead of) the numeric score badge everywhere a
// finalScore is displayed, so the pass/fail line is always explicit, not
// left for the admin to infer from the score's color alone.
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

// Only the non-zero categories are listed (an admin who left most rows at
// their 0 default doesn't need all 10 spelled out) - fixed category labels
// via PRESENTATION_CATEGORY_LABELS, never a free-form name.
function formatCategoryScoresSummary(categoryScores: PresentationCategoryScores): string | null {
  const parts = PRESENTATION_CATEGORY_KEYS.filter((key) => categoryScores[key] !== 0).map(
    (key) => `${PRESENTATION_CATEGORY_LABELS[key]}: ${formatCategoryScoreValue(categoryScores[key])}`
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

// Simple arithmetic mean of finalScore - unlike averageRatingFromHalfPoints,
// every row always has a finalScore (never null by construction - see
// StudentPresentationProgressFeedback's own schema comment), so there's no
// "some rows unrated" filtering to do here.
function averageFinalScore(scores: number[]): number | null {
  if (scores.length === 0) return null;
  return scores.reduce((sum, v) => sum + v, 0) / scores.length;
}

// .toFixed(1) (not (0)) - finalScore itself can land on a half-point
// boundary (e.g. 70.5), so an average across several such rows can too.
function formatScoreAverageLabel(average: number | null): string {
  if (average == null) return "אין ציונים";
  return `ציון ממוצע: ${average.toFixed(1)}`;
}

// The TopicSection `badge` override for "פרזנטציה" (see TopicSection's own
// comment on why this can't reuse TopicAverageBadge).
function ScoreAverageBadge({ average }: { average: number | null }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
        average == null ? "bg-muted text-muted-foreground" : presentationScoreBadgeClasses(average)
      }`}
    >
      {formatScoreAverageLabel(average)}
    </span>
  );
}

// Same shape/behavior as LungeProgressFeedbackList above.
function PresentationProgressFeedbackList({
  studentId,
  rows,
  onChanged,
}: {
  studentId: string;
  rows: StudentPresentationProgressFeedbackRow[];
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
    if (!window.confirm("למחוק את משוב הפרזנטציה הזה? לא ניתן לשחזר את הפעולה.")) return;
    setDeleteError(null);
    setDeletingId(id);
    startDeleteTransition(async () => {
      const result = await deleteStudentPresentationProgressFeedbackAsAdmin(id);
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
      const result = await createStudentPresentationProgressFeedbackAsAdmin(
        studentId,
        presentationProgressFormToInput(values)
      );
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
      const result = await updateStudentPresentationProgressFeedbackAsAdmin(
        id,
        presentationProgressFormToInput(values)
      );
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
      )}

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
  //
  // Stage P4c - "presentationProgress" is the same standalone,
  // manager-entered journal shape (StudentPresentationProgressFeedback), for
  // the unrelated פרזנטציה topic.
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
  // The 2-10 half-point rating every source EXCEPT presentationProgress
  // uses - always null for a presentationProgress item (see presentationScore
  // below instead).
  ratingHalfPoints: number | null;
  // Stage P4c (revised) - presentationProgress's own 0-100 finalScore,
  // fundamentally a different scale from ratingHalfPoints above, so it's a
  // separate field rather than overloading ratingHalfPoints with a second
  // meaning. Optional (not just nullable) so every OTHER builder function
  // (buildRidingTimelineItems, buildTeachingPracticeTimelineItems,
  // buildRidingProgressTimelineItems, buildLungeProgressTimelineItems) can
  // stay completely untouched - they simply never set it, which
  // CombinedTimelineList's badge logic treats identically to an explicit
  // null (fall back to the ratingHalfPoints badge).
  presentationScore?: number | null;
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

// Stage P4c (revised) - same "no time-of-day field" shape as
// buildRidingProgressTimelineItems/buildLungeProgressTimelineItems above (a
// פרזנטציה entry isn't tied to any scheduled slot either). ratingHalfPoints
// is always null here (this source was never on that scale); presentationScore
// carries the 0-100 finalScore instead - see CombinedTimelineItem's own
// comment. contextParts include the category breakdown when present, same
// wording as formatCategoryScoresSummary in the section's own display card.
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
//
// Stage P4c - presentationProgress gets its own "פרזנטציה" badge - no other
// source uses that word, so no disambiguation suffix is needed here.
const TIMELINE_SOURCE_LABELS: Record<CombinedTimelineItem["source"], string> = {
  riding: "הדרכת מתקדמים",
  teachingPracticeLunge: "התנסות מתחילים · לונג׳ עם רוכב",
  teachingPracticeBeginner: "התנסות מתחילים · פרטני/קבוצתי",
  ridingProgress: "רכיבה",
  lungeProgress: "לונג׳ בלי רוכב",
  presentationProgress: "פרזנטציה",
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
            {/* Stage P4c (revised) - presentationScore (0-100) is checked
                first and uses its own score-scale color classes; every
                other source never sets it, so this falls through to the
                original ratingHalfPoints (2-10 half-point) badge unchanged. */}
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
  const [isPresentationProgressOpen, setIsPresentationProgressOpen] = useState(true);
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
  const [presentationProgressRows, setPresentationProgressRows] = useState<
    StudentPresentationProgressFeedbackRow[] | null
  >(null);
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

  // Stage P4c - same fetch/cancellation-guard shape as lungeProgressRows
  // above, against the new StudentPresentationProgressFeedback action.
  useEffect(() => {
    if (!selectedStudentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPresentationProgressRows(null);
      return;
    }
    let cancelled = false;
    setPresentationProgressRows(null);
    startTransition(async () => {
      const result = await listStudentPresentationProgressFeedbackForAdmin(selectedStudentId);
      if (!cancelled) {
        setPresentationProgressRows(result ?? []);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedStudentId]);

  // Manual refresh after a successful create/update from
  // PresentationProgressFeedbackList - same reasoning as refreshRidingProgress above.
  function refreshPresentationProgress() {
    if (!selectedStudentId) return;
    startTransition(async () => {
      const result = await listStudentPresentationProgressFeedbackForAdmin(selectedStudentId);
      setPresentationProgressRows(result ?? []);
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

  // Stage P4c (revised) - the standalone "פרזנטציה" TopicSection's own
  // average, from StudentPresentationProgressFeedback rows only - the mean
  // of finalScore (0-100), via averageFinalScore, never
  // averageRatingFromHalfPoints (built around the unrelated 1.0-5.0
  // half-point scale - see ScoreAverageBadge's own comment).
  const presentationScoreAverageRating = useMemo(
    () => (presentationProgressRows ? averageFinalScore(presentationProgressRows.map((r) => r.finalScore)) : null),
    [presentationProgressRows]
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

  // Stage P4b - lungeProgressRows added alongside the pre-existing sources;
  // teachingPracticeRows here still contributes its own LUNGE rows exactly
  // once (via the raw, unsplit array, same as before Stage P4b), so
  // standalone לונג׳-בלי-רוכב rows and Teaching Practice לונג׳-עם-רוכב rows
  // are both counted, each exactly once, never double-counted against each
  // other.
  //
  // Stage P4c (revised) - presentationProgressRows is intentionally
  // EXCLUDED from the numeric average below (unlike every other source
  // added so far): finalScore is a 0-100 grading score, not a 1.0-5.0
  // half-point rating, and averaging it together with the half-point
  // sources here would produce a meaningless combined number (e.g. a
  // finalScore of 82 would swamp a true half-point average of ~4). Still
  // included in the null-guard (so "כל המשובים" doesn't render before this
  // source has finished loading) and still fully present in
  // combinedTimelineItems above - just not folded into this one shared
  // average. פרזנטציה's own score average has its own badge
  // (presentationScoreAverageRating / ScoreAverageBadge) instead.
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
                actions={{
                  create: createStudentRidingProgressFeedbackAsAdmin,
                  update: updateStudentRidingProgressFeedbackAsAdmin,
                  delete: deleteStudentRidingProgressFeedbackAsAdmin,
                }}
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
                actions={{
                  create: createStudentLungeProgressFeedbackAsAdmin,
                  update: updateStudentLungeProgressFeedbackAsAdmin,
                  delete: deleteStudentLungeProgressFeedbackAsAdmin,
                }}
              />
            )}
          </TopicSection>

          {/* Stage P4c - standalone, manager-entered פרזנטציה progress
              journal (StudentPresentationProgressFeedback) - same pattern as
              "לונג׳" above, own subtitle for consistency even though
              (unlike לונג׳) there's no similarly-named Teaching Practice
              concept to disambiguate from. */}
          <TopicSection
            title="פרזנטציה"
            subtitle="משובי פרזנטציה להזנה ידנית על ידי המנהלת. ציון בסיס 70 + קטגוריות ניקוד."
            average={null}
            badge={<ScoreAverageBadge average={presentationScoreAverageRating} />}
            isOpen={isPresentationProgressOpen}
            onToggle={() => setIsPresentationProgressOpen((v) => !v)}
          >
            {presentationProgressRows === null ? (
              <p className="text-sm text-muted-foreground">טוען...</p>
            ) : (
              <PresentationProgressFeedbackList
                studentId={selectedStudent.id}
                rows={presentationProgressRows}
                onChanged={refreshPresentationProgress}
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
