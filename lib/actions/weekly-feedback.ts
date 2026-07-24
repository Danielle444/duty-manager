"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey, formatHebrewDate, formatHebrewWeekday } from "@/lib/dates";
import { cleanScheduleTitle } from "@/lib/schedule-title";
import { loadHistoricalTraineeState } from "@/lib/course/historical-trainee-state";
import type { ActionResult } from "@/lib/actions/students";
// SECURITY / LEVEL 2 SLICE L2-F1A - server-derived trainee identity + course
// context for the two trainee-facing actions at the bottom of this file.
// SECURITY / LEVEL 2 SLICE L2-F1B - course-scoped denominators for the two
// admin readers (listWeeklyFeedbackForms, getWeeklyFeedbackResults). Every
// other action in this module is untouched by both slices.
import { requireCurrentTrainee } from "@/lib/auth/actor";
import { resolveTraineeCourseOffering } from "@/lib/course/actor-course-offering";
import {
  acceptWeeklyFeedbackFormOfferingId,
  authorizeTraineeWeeklyFeedbackSubmissionWithDeps,
  buildWeeklyFeedbackRosterCountQuery,
  buildWeeklyFeedbackRosterQuery,
  classifyWeeklyFeedbackSubmissionWindow,
  collectWeeklyFeedbackOfferingIds,
  countWeeklyFeedbackRosterByOffering,
  loadTraineeWeeklyFeedbackWithDeps,
  selectNotSubmittedRosterMembers,
  summarizeWeeklyFeedbackDenominator,
  toWeeklyFeedbackRosterMembers,
  weeklyFeedbackDenominatorForForm,
  type TraineeWeeklyFeedbackFormRow,
  type WeeklyFeedbackSubmissionWindowState,
} from "@/lib/course/weekly-feedback-course-scope-core";

export type WeeklyFeedbackStatusValue = "DRAFT" | "PUBLISHED" | "CLOSED";
export type FeedbackQuestionTypeValue = "RATING_5" | "COMPARISON_3" | "FREE_TEXT";
export type FeedbackQuestionSourceValue = "FIXED" | "DYNAMIC";

// Question types the admin UI may set when adding/editing a question.
// COMPARISON_3 (week-over-week comparison, 1-3) is manually added per week
// once week-2-onward comparisons are meaningful - it's never part of
// FIXED_QUESTION_TEMPLATE itself, only addable/editable one question at a
// time via addWeeklyFeedbackQuestion/updateWeeklyFeedbackQuestion.
export type EditableFeedbackQuestionTypeValue = "RATING_5" | "COMPARISON_3" | "FREE_TEXT";

interface FixedQuestionTemplateItem {
  section: string;
  prompt: string;
  type: FeedbackQuestionTypeValue;
  // Defaults to true for RATING_5/COMPARISON_3 and false for FREE_TEXT
  // (see fixedQuestionIsRequired) unless explicitly set here.
  isRequired?: boolean;
}

function fixedQuestionIsRequired(item: FixedQuestionTemplateItem): boolean {
  if (item.isRequired !== undefined) return item.isRequired;
  return item.type !== "FREE_TEXT";
}

// The recurring weekly feedback question set for חניכים, copied into
// WeeklyFeedbackQuestion rows (source=FIXED) whenever a draft is created -
// not DB-backed for v1. Editing wording/sections here only affects drafts
// created after the change; already-drafted forms keep their own
// materialized rows, same principle as MessageTaskRecipient fanout. No
// COMPARISON_3 questions yet - those are added later, per week, through
// manual question creation once week-2-onward comparisons are meaningful.
const FIXED_QUESTION_TEMPLATE: FixedQuestionTemplateItem[] = [
  { section: "אוכל", prompt: "ארוחות בוקר", type: "RATING_5" },
  { section: "אוכל", prompt: "ארוחות צהריים", type: "RATING_5" },
  { section: "אוכל", prompt: "ארוחות ערב", type: "RATING_5" },
  { section: "אוכל", prompt: "הערות על הארוחות", type: "FREE_TEXT" },

  { section: "מגורים ותנאי פנסיון", prompt: "מגורים", type: "RATING_5" },
  { section: "מגורים ותנאי פנסיון", prompt: "הערות על המגורים", type: "FREE_TEXT" },

  { section: "תנאי חווה ופנסיון סוסים", prompt: "כיתת לימוד", type: "RATING_5" },
  { section: "תנאי חווה ופנסיון סוסים", prompt: "מתחם תאים וממשק", type: "RATING_5" },
  { section: "תנאי חווה ופנסיון סוסים", prompt: "מגרשים ועזרים", type: "RATING_5" },
  { section: "תנאי חווה ופנסיון סוסים", prompt: "הערות בנושא תנאי החווה והפנסיון", type: "FREE_TEXT" },

  { section: "מבנה הקורס", prompt: "תוכן כללי ומבנה הקורס", type: "RATING_5" },
  { section: "מבנה הקורס", prompt: "כמות ומגוון מרצים ומאמנים", type: "RATING_5" },
  { section: "מבנה הקורס", prompt: "יחס בין שיעורים עיוניים למעשיים", type: "RATING_5" },
  { section: "מבנה הקורס", prompt: 'לו"ז קורס', type: "RATING_5" },
  { section: "מבנה הקורס", prompt: 'הערות על מבנה הקורס והלו"ז', type: "FREE_TEXT" },

  { section: "שיעורי רכיבה", prompt: "אורך השיעורים", type: "RATING_5" },
  { section: "שיעורי רכיבה", prompt: "רמת הקושי", type: "RATING_5" },
  { section: "שיעורי רכיבה", prompt: "התאמה לצרכי החניך ורמתו", type: "RATING_5" },
  { section: "שיעורי רכיבה", prompt: "אווירה כללית בשיעורים", type: "RATING_5" },

  { section: "שיעורי מתודיקה", prompt: "אורך השיעורים", type: "RATING_5" },
  { section: "שיעורי מתודיקה", prompt: "רמת הקושי", type: "RATING_5" },
  { section: "שיעורי מתודיקה", prompt: "התייחסות אישית לצרכי החניך ורמתו", type: "RATING_5" },
  { section: "שיעורי מתודיקה", prompt: "אווירה כללית בשיעורים", type: "RATING_5" },
  { section: "שיעורי מתודיקה", prompt: "הערות על השיעורים וההרצאות", type: "FREE_TEXT" },

  { section: "סיכום שבועי", prompt: "מה הדבר הכי משמעותי שלמדת השבוע?", type: "FREE_TEXT" },
  { section: "סיכום שבועי", prompt: "במה את/ה מרגיש/ה שהכי התקדמת מבחינה מקצועית?", type: "FREE_TEXT" },
  { section: "סיכום שבועי", prompt: "מה היה לך הכי כיף השבוע?", type: "FREE_TEXT" },
  {
    section: "סיכום שבועי",
    prompt: "מה היה לך הכי קשה השבוע ובמה היית רוצה יותר דגשים וחיזוק?",
    type: "FREE_TEXT",
  },
  { section: "סיכום שבועי", prompt: "הערות כלליות על השבוע", type: "FREE_TEXT" },
];

export interface WeeklyFeedbackFormListItem {
  id: string;
  title: string;
  status: WeeklyFeedbackStatusValue;
  opensAt: string | null;
  closesAt: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  weeklyScheduleId: string;
  weekName: string;
  weekStartDate: string;
  weekEndDate: string;
  questionCount: number;
  responseCount: number;
  // L2-F1B: the roster size of the offering that owns THIS form's week, not the
  // global active-student population. Two forms from two courses in the same
  // list therefore report two different denominators. Field name and type are
  // unchanged, so the admin list UI needs no edit.
  activeStudentCount: number;
}

// L2-F1B: the enrollment columns the batch roster count projects. Only the
// offering + student pair is read - no name, phone or identity field is
// fetched merely to produce a count.
const ROSTER_COUNT_SELECT = { courseOfferingId: true, studentId: true } as const;

export async function listWeeklyFeedbackForms(): Promise<WeeklyFeedbackFormListItem[]> {
  await requireAdmin();

  const forms = await prisma.weeklyFeedbackForm.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      // courseOfferingId is the AUTHORITATIVE ownership edge (the week owns the
      // form, and WeeklyFeedbackForm.weeklyScheduleId is @unique) - it is the
      // only thing the denominator is derived from.
      weeklySchedule: {
        select: { name: true, startDate: true, endDate: true, courseOfferingId: true },
      },
      _count: { select: { questions: true, responses: true } },
    },
  });

  // ONE roster query for the whole list: forms are grouped by their distinct
  // owning offerings first, so a 30-form list over 2 courses issues 1 roster
  // query, not 30. Unscoped (NULL) weeks contribute no id and resolve to 0
  // below - they never widen this query.
  const offeringIds = collectWeeklyFeedbackOfferingIds(
    forms.map((form) => form.weeklySchedule.courseOfferingId),
  );
  const rosterCountRows =
    offeringIds.length === 0
      ? []
      : await prisma.courseEnrollment.findMany({
          where: buildWeeklyFeedbackRosterCountQuery(offeringIds).where,
          select: ROSTER_COUNT_SELECT,
        });
  const rosterCountsByOffering = countWeeklyFeedbackRosterByOffering(rosterCountRows);

  return forms.map((form) => ({
    id: form.id,
    title: form.title,
    status: form.status,
    opensAt: form.opensAt ? form.opensAt.toISOString() : null,
    closesAt: form.closesAt ? form.closesAt.toISOString() : null,
    publishedAt: form.publishedAt ? form.publishedAt.toISOString() : null,
    closedAt: form.closedAt ? form.closedAt.toISOString() : null,
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
    weeklyScheduleId: form.weeklyScheduleId,
    weekName: form.weeklySchedule.name,
    weekStartDate: dateKey(form.weeklySchedule.startDate),
    weekEndDate: dateKey(form.weeklySchedule.endDate),
    questionCount: form._count.questions,
    responseCount: form._count.responses,
    // Fails closed to 0 for a NULL-scoped week and for an offering with no
    // active roster; never falls back to a global count.
    activeStudentCount: weeklyFeedbackDenominatorForForm(
      form.weeklySchedule.courseOfferingId,
      rosterCountsByOffering,
    ),
  }));
}

// Materializes the fixed template into real question rows at creation time -
// editing FIXED_QUESTION_TEMPLATE later never changes an already-created
// draft, same principle as MessageTaskRecipient fanout at send time.
// opensAt/closesAt are deliberately left unset here - scheduling the
// availability window is a separate, explicit step (updateWeeklyFeedbackSchedule).
export async function createWeeklyFeedbackDraft(weeklyScheduleId: string): Promise<ActionResult> {
  await requireAdmin();

  const weeklySchedule = await prisma.weeklySchedule.findUnique({ where: { id: weeklyScheduleId } });
  if (!weeklySchedule) {
    return { success: false, error: "לוח הזמנים השבועי לא נמצא" };
  }

  const existing = await prisma.weeklyFeedbackForm.findUnique({ where: { weeklyScheduleId } });
  if (existing) {
    return { success: false, error: "כבר קיימת טיוטת משוב לשבוע זה" };
  }

  await prisma.weeklyFeedbackForm.create({
    data: {
      weeklyScheduleId,
      title: `משוב סוף שבוע - ${weeklySchedule.name}`,
      questions: {
        create: FIXED_QUESTION_TEMPLATE.map((q, index) => ({
          section: q.section,
          prompt: q.prompt,
          type: q.type,
          source: "FIXED",
          sortOrder: index,
          isRequired: fixedQuestionIsRequired(q),
        })),
      },
    },
  });

  return { success: true };
}

export interface WeeklyFeedbackDraftQuestion {
  id: string;
  section: string;
  prompt: string;
  type: FeedbackQuestionTypeValue;
  source: FeedbackQuestionSourceValue;
  sortOrder: number;
  isRequired: boolean;
}

export interface WeeklyFeedbackDraft {
  id: string;
  title: string;
  status: WeeklyFeedbackStatusValue;
  opensAt: string | null;
  closesAt: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  weeklyScheduleId: string;
  weekName: string;
  weekStartDate: string;
  weekEndDate: string;
  questions: WeeklyFeedbackDraftQuestion[];
}

// Read-only, for the future admin draft-builder/results UI - no UI reads
// this yet.
export async function getWeeklyFeedbackDraftForAdmin(formId: string): Promise<WeeklyFeedbackDraft | null> {
  await requireAdmin();

  const form = await prisma.weeklyFeedbackForm.findUnique({
    where: { id: formId },
    include: {
      weeklySchedule: { select: { name: true, startDate: true, endDate: true } },
      questions: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!form) return null;

  return {
    id: form.id,
    title: form.title,
    status: form.status,
    opensAt: form.opensAt ? form.opensAt.toISOString() : null,
    closesAt: form.closesAt ? form.closesAt.toISOString() : null,
    publishedAt: form.publishedAt ? form.publishedAt.toISOString() : null,
    closedAt: form.closedAt ? form.closedAt.toISOString() : null,
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
    weeklyScheduleId: form.weeklyScheduleId,
    weekName: form.weeklySchedule.name,
    weekStartDate: dateKey(form.weeklySchedule.startDate),
    weekEndDate: dateKey(form.weeklySchedule.endDate),
    questions: form.questions.map((q) => ({
      id: q.id,
      section: q.section,
      prompt: q.prompt,
      type: q.type,
      source: q.source,
      sortOrder: q.sortOrder,
      isRequired: q.isRequired,
    })),
  };
}

// Saves the intended trainee-visible availability window only - never
// publishes/closes the form itself (see WeeklyFeedbackForm's own doc comment
// for how opensAt/closesAt combine with status). Blocked once CLOSED, since
// a manually-closed form's dates are no longer meant to matter.
export async function updateWeeklyFeedbackSchedule(
  formId: string,
  opensAt: string | null,
  closesAt: string | null
): Promise<ActionResult> {
  await requireAdmin();

  const form = await prisma.weeklyFeedbackForm.findUnique({ where: { id: formId } });
  if (!form) {
    return { success: false, error: "טופס המשוב לא נמצא" };
  }
  if (form.status === "CLOSED") {
    return { success: false, error: "לא ניתן לעדכן זמינות עבור משוב סגור" };
  }

  const opensAtDate = opensAt ? new Date(opensAt) : null;
  const closesAtDate = closesAt ? new Date(closesAt) : null;
  if (opensAtDate && Number.isNaN(opensAtDate.getTime())) {
    return { success: false, error: "תאריך פתיחה לא תקין" };
  }
  if (closesAtDate && Number.isNaN(closesAtDate.getTime())) {
    return { success: false, error: "תאריך סגירה לא תקין" };
  }
  if (opensAtDate && closesAtDate && closesAtDate <= opensAtDate) {
    return { success: false, error: "תאריך הסגירה חייב להיות אחרי תאריך הפתיחה" };
  }

  await prisma.weeklyFeedbackForm.update({
    where: { id: formId },
    data: { opensAt: opensAtDate, closesAt: closesAtDate },
  });

  return { success: true };
}

function validateQuestionInput(
  section: string,
  prompt: string,
  type: EditableFeedbackQuestionTypeValue
): { error: string } | { section: string; prompt: string } {
  const trimmedSection = section.trim();
  const trimmedPrompt = prompt.trim();
  if (!trimmedSection) return { error: "יש להזין שם מקטע" };
  if (!trimmedPrompt) return { error: "יש להזין את נוסח השאלה" };
  if (type !== "RATING_5" && type !== "COMPARISON_3" && type !== "FREE_TEXT") {
    return { error: "סוג שאלה לא תקין" };
  }
  return { section: trimmedSection, prompt: trimmedPrompt };
}

const QUESTIONS_NOT_EDITABLE_ERROR =
  "ניתן לערוך שאלות רק בטיוטה או במשוב מתוזמן שעדיין לא נפתח לחניכים";

// Questions stay editable a bit past DRAFT: a PUBLISHED form scheduled to
// open later (opensAt in the future) has no חניכים answering against it
// yet, so its question set is still safe to change. Once it's actually open
// (opensAt null - meaning immediate - or opensAt already in the past) or
// CLOSED, editing is blocked since responses may already exist against the
// current questions.
function isFeedbackQuestionsEditable(form: { status: WeeklyFeedbackStatusValue; opensAt: Date | null }): boolean {
  if (form.status === "DRAFT") return true;
  if (form.status === "PUBLISHED" && form.opensAt !== null && form.opensAt > new Date()) return true;
  return false;
}

// Enforced fresh from the DB on every call since the admin client only holds
// a possibly-stale draft snapshot, never trusting the client-derived
// availability badge.
export async function addWeeklyFeedbackQuestion(
  formId: string,
  section: string,
  prompt: string,
  type: EditableFeedbackQuestionTypeValue,
  isRequired: boolean
): Promise<ActionResult> {
  await requireAdmin();

  const form = await prisma.weeklyFeedbackForm.findUnique({
    where: { id: formId },
    include: { questions: { select: { sortOrder: true } } },
  });
  if (!form) return { success: false, error: "טופס המשוב לא נמצא" };
  if (!isFeedbackQuestionsEditable(form)) {
    return { success: false, error: QUESTIONS_NOT_EDITABLE_ERROR };
  }

  const validated = validateQuestionInput(section, prompt, type);
  if ("error" in validated) return { success: false, error: validated.error };

  const maxSortOrder = form.questions.reduce((max, q) => Math.max(max, q.sortOrder), -1);

  await prisma.weeklyFeedbackQuestion.create({
    data: {
      formId,
      section: validated.section,
      prompt: validated.prompt,
      type,
      source: "DYNAMIC",
      sortOrder: maxSortOrder + 1,
      isRequired,
    },
  });

  return { success: true };
}

export async function updateWeeklyFeedbackQuestion(
  questionId: string,
  section: string,
  prompt: string,
  type: EditableFeedbackQuestionTypeValue,
  isRequired: boolean
): Promise<ActionResult> {
  await requireAdmin();

  const question = await prisma.weeklyFeedbackQuestion.findUnique({
    where: { id: questionId },
    include: { form: { select: { status: true, opensAt: true } } },
  });
  if (!question) return { success: false, error: "השאלה לא נמצאה" };
  if (!isFeedbackQuestionsEditable(question.form)) {
    return { success: false, error: QUESTIONS_NOT_EDITABLE_ERROR };
  }

  const validated = validateQuestionInput(section, prompt, type);
  if ("error" in validated) return { success: false, error: validated.error };

  await prisma.weeklyFeedbackQuestion.update({
    where: { id: questionId },
    data: { section: validated.section, prompt: validated.prompt, type, isRequired },
  });

  return { success: true };
}

export async function deleteWeeklyFeedbackQuestion(questionId: string): Promise<ActionResult> {
  await requireAdmin();

  const question = await prisma.weeklyFeedbackQuestion.findUnique({
    where: { id: questionId },
    include: {
      form: { select: { status: true, opensAt: true, _count: { select: { questions: true } } } },
    },
  });
  if (!question) return { success: false, error: "השאלה לא נמצאה" };
  if (!isFeedbackQuestionsEditable(question.form)) {
    return { success: false, error: QUESTIONS_NOT_EDITABLE_ERROR };
  }
  if (question.form._count.questions <= 1) {
    return { success: false, error: "לא ניתן למחוק את השאלה האחרונה בטופס" };
  }

  await prisma.weeklyFeedbackQuestion.delete({ where: { id: questionId } });

  return { success: true };
}

export async function reorderWeeklyFeedbackQuestions(
  formId: string,
  orderedQuestionIds: string[]
): Promise<ActionResult> {
  await requireAdmin();

  const form = await prisma.weeklyFeedbackForm.findUnique({
    where: { id: formId },
    include: { questions: { select: { id: true } } },
  });
  if (!form) return { success: false, error: "טופס המשוב לא נמצא" };
  if (!isFeedbackQuestionsEditable(form)) {
    return { success: false, error: QUESTIONS_NOT_EDITABLE_ERROR };
  }

  const existingIds = new Set(form.questions.map((q) => q.id));
  const sameSet =
    orderedQuestionIds.length === existingIds.size &&
    new Set(orderedQuestionIds).size === existingIds.size &&
    orderedQuestionIds.every((id) => existingIds.has(id));
  if (!sameSet) {
    return { success: false, error: "רשימת השאלות לא תואמת את הטופס" };
  }

  await prisma.$transaction(
    orderedQuestionIds.map((id, index) =>
      prisma.weeklyFeedbackQuestion.update({ where: { id }, data: { sortOrder: index } })
    )
  );

  return { success: true };
}

export interface WeeklyFeedbackSuggestedQuestion {
  section: string;
  prompt: string;
  type: "RATING_5" | "FREE_TEXT";
  // Short human-readable explanation of which schedule item this came from
  // (title/date/instructor), shown to the admin so a low-confidence match
  // can still be judged before adding it - never shown to חניכים.
  sourceLabel: string;
}

// Deliberately a narrow allow-list rather than a broad exclusion list (no
// attempt to detect/skip meals, breaks, lodging, logistics, etc. by name) -
// ScheduleItem is mostly free text with no reliable "category" field, so a
// conservative "only suggest for things we're confident about" allow-list
// produces far fewer bad suggestions than trying to exclude everything we
// don't want. Riding lessons are identified structurally (ScheduleItem.
// ridingSlot presence, not text matching) since that relation already exists
// specifically to mark "this is a riding slot".
const LECTURE_KEYWORD_PATTERN = /(הרצאה|מתודיקה|תיאוריה|תאוריה|שיעור עיוני)/;

function scheduleItemSourceLabel(
  item: { title: string; date: Date; instructorName: string | null },
  cleanedTitle: string
): string {
  const dateLabel = `${formatHebrewWeekday(item.date)} · ${formatHebrewDate(item.date)}`;
  const instructorPart = item.instructorName ? ` · מדריך/ה: ${item.instructorName}` : "";
  return `${cleanedTitle} · ${dateLabel}${instructorPart}`;
}

function buildRidingSuggestion(item: {
  title: string;
  date: Date;
  instructorName: string | null;
}): WeeklyFeedbackSuggestedQuestion {
  const cleanedTitle = cleanScheduleTitle(item.title);
  return {
    section: "רכיבות",
    prompt: `כיצד היית מדרג/ת את שיעור הרכיבה: ${cleanedTitle} (${formatHebrewDate(item.date)})?`,
    type: "RATING_5",
    sourceLabel: scheduleItemSourceLabel(item, cleanedTitle),
  };
}

function buildLectureSuggestions(item: {
  title: string;
  date: Date;
  instructorName: string | null;
}): WeeklyFeedbackSuggestedQuestion[] {
  const cleanedTitle = cleanScheduleTitle(item.title);
  const sourceLabel = scheduleItemSourceLabel(item, cleanedTitle);
  const dateLabel = formatHebrewDate(item.date);
  return [
    {
      section: "הרצאות ושיעורים",
      prompt: `כיצד היית מדרג/ת את: ${cleanedTitle} (${dateLabel})?`,
      type: "RATING_5",
      sourceLabel,
    },
    {
      section: "הרצאות ושיעורים",
      prompt: `הערות על ${cleanedTitle} (${dateLabel})`,
      type: "FREE_TEXT",
      sourceLabel,
    },
  ];
}

export type WeeklyFeedbackSuggestionsResult =
  | { success: true; suggestions: WeeklyFeedbackSuggestedQuestion[] }
  | { success: false; error: string };

// Read-only - never writes a question to the DB. Only offered for forms
// whose questions are still editable (same rule as add/edit/delete/reorder
// above), re-checked fresh here rather than trusted from the client.
// Candidates already matching an existing question's prompt (exact text) are
// filtered out, so re-running this after adding some suggestions naturally
// shows only what's left, and an admin can't double-add the same one.
export async function suggestWeeklyFeedbackQuestionsFromSchedule(
  formId: string
): Promise<WeeklyFeedbackSuggestionsResult> {
  await requireAdmin();

  const form = await prisma.weeklyFeedbackForm.findUnique({
    where: { id: formId },
    include: {
      questions: { select: { prompt: true } },
      weeklySchedule: {
        include: {
          items: {
            orderBy: [{ date: "asc" }, { startTime: "asc" }],
            include: { ridingSlot: true },
          },
        },
      },
    },
  });
  if (!form) return { success: false, error: "טופס המשוב לא נמצא" };
  if (!isFeedbackQuestionsEditable(form)) {
    return { success: false, error: QUESTIONS_NOT_EDITABLE_ERROR };
  }

  const candidates: WeeklyFeedbackSuggestedQuestion[] = [];
  for (const item of form.weeklySchedule.items) {
    if (item.ridingSlot) {
      candidates.push(buildRidingSuggestion(item));
      continue;
    }
    if (LECTURE_KEYWORD_PATTERN.test(cleanScheduleTitle(item.title))) {
      candidates.push(...buildLectureSuggestions(item));
    }
  }

  const existingPrompts = new Set(form.questions.map((q) => q.prompt));
  const seenPrompts = new Set<string>();
  const suggestions = candidates.filter((s) => {
    if (existingPrompts.has(s.prompt) || seenPrompts.has(s.prompt)) return false;
    seenPrompts.add(s.prompt);
    return true;
  });

  return { success: true, suggestions };
}

// Publishing is one-way (DRAFT -> PUBLISHED); questions become read-only
// from this point on since חניכים may start answering against them.
// opensAt/closesAt are optional here - when omitted (undefined) the form's
// already-saved values (e.g. via updateWeeklyFeedbackSchedule while still a
// draft) are kept as-is; when passed (including explicit null) they
// overwrite the stored values, same validation as updateWeeklyFeedbackSchedule.
export async function publishWeeklyFeedbackForm(
  formId: string,
  opensAt?: string | null,
  closesAt?: string | null
): Promise<ActionResult> {
  await requireAdmin();

  const form = await prisma.weeklyFeedbackForm.findUnique({
    where: { id: formId },
    include: { _count: { select: { questions: true } } },
  });
  if (!form) return { success: false, error: "טופס המשוב לא נמצא" };
  if (form.status !== "DRAFT") return { success: false, error: "ניתן לפרסם רק טיוטה" };
  if (form._count.questions === 0) {
    return { success: false, error: "לא ניתן לפרסם משוב ללא שאלות" };
  }

  const opensAtDate = opensAt === undefined ? form.opensAt : opensAt ? new Date(opensAt) : null;
  const closesAtDate = closesAt === undefined ? form.closesAt : closesAt ? new Date(closesAt) : null;
  if (opensAtDate && Number.isNaN(opensAtDate.getTime())) {
    return { success: false, error: "תאריך פתיחה לא תקין" };
  }
  if (closesAtDate && Number.isNaN(closesAtDate.getTime())) {
    return { success: false, error: "תאריך סגירה לא תקין" };
  }
  if (opensAtDate && closesAtDate && closesAtDate <= opensAtDate) {
    return { success: false, error: "תאריך הסגירה חייב להיות אחרי תאריך הפתיחה" };
  }

  await prisma.weeklyFeedbackForm.update({
    where: { id: formId },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
      opensAt: opensAtDate,
      closesAt: closesAtDate,
    },
  });

  return { success: true };
}

// Closing is one-way (PUBLISHED -> CLOSED) and never deletes anything -
// existing responses/questions are kept, only the form's own status/closedAt
// change, so the data remains available for a future results dashboard.
export async function closeWeeklyFeedbackForm(formId: string): Promise<ActionResult> {
  await requireAdmin();

  const form = await prisma.weeklyFeedbackForm.findUnique({ where: { id: formId } });
  if (!form) return { success: false, error: "טופס המשוב לא נמצא" };
  if (form.status !== "PUBLISHED") return { success: false, error: "ניתן לסגור רק משוב שפורסם" };

  await prisma.weeklyFeedbackForm.update({
    where: { id: formId },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  return { success: true };
}

export interface WeeklyFeedbackQuestionForStudent {
  id: string;
  section: string;
  prompt: string;
  type: FeedbackQuestionTypeValue;
  sortOrder: number;
  isRequired: boolean;
}

// A discriminated union rather than one flat shape - "submitted" intentionally
// omits the question list (no editable state to expose once answered), and
// "none" covers both "no published form right now" and "student inactive",
// so the trainee UI never learns which of those two it is.
export type WeeklyFeedbackForStudent =
  | { status: "none" }
  | { status: "submitted"; formTitle: string; submittedAt: string }
  | { status: "open"; formId: string; formTitle: string; questions: WeeklyFeedbackQuestionForStudent[] };

// ---------------------------------------------------------------------------
// TRAINEE-FACING WEEKLY FEEDBACK SURFACE - SECURITY / LEVEL 2 SLICE L2-F1A
// ---------------------------------------------------------------------------
//
// Both actions below are CONTAINED: identity comes from the signed trainee
// session, the course context is server-resolved from that trainee's own
// enrollment, and the form is loaded ONLY through its own week's offering
// (WeeklyFeedbackForm -> WeeklySchedule.courseOfferingId), strictly equal to
// the resolved offering, with a NULL-scoped week failing closed.
//
// This closes an ANONYMOUS, CROSS-COURSE exposure. These actions previously
// "authenticated" a caller by re-reading the client-supplied studentId's
// Student row and checking only the global Student.isActive flag - which
// authorizes nothing, because searchStudents() is unauthenticated by design (it
// powers the login screen) and returns real student ids. The read then selected
// the newest published form IN THE ENTIRE DATABASE, and the submit accepted any
// formId with no ownership predicate at all. An activated Level 2 trainee would
// have been served the Level 1 form and been able to write a response into it,
// permanently contaminating Level 1 statistics and being counted as a Level 1
// respondent.
//
// The studentId parameters are RETAINED for caller compatibility in this slice
// and are deliberately discarded; they are NEVER identity. The session-derived
// trainee id is the only one that reaches a query filter, a response lookup or
// a response write.
//
// There is deliberately NO capability key here: weekly feedback has no
// canonical key, and none is reused (SCHEDULE is ENABLED for Level 2, so gating
// on it would grant exactly what must be denied). Ownership scoping is the
// boundary - see the core module's header.

/** The exact form columns the trainee read projects - plus its questions. */
const TRAINEE_FEEDBACK_FORM_SELECT = {
  id: true,
  title: true,
  status: true,
  opensAt: true,
  closesAt: true,
  weeklySchedule: { select: { courseOfferingId: true } },
  questions: {
    orderBy: { sortOrder: "asc" as const },
    select: {
      id: true,
      section: true,
      prompt: true,
      type: true,
      sortOrder: true,
      isRequired: true,
    },
  },
} as const;

interface TraineeFeedbackFormWithQuestions extends TraineeWeeklyFeedbackFormRow {
  questions: WeeklyFeedbackQuestionForStudent[];
}

// The single containment binding for the read. It supplies ONLY real,
// server-owned dependencies: the trainee id from the signed session via the
// canonical Actor DAL (requireCurrentTrainee rejects anonymous, expired,
// wrong-audience and INACTIVE sessions), and the offering from the committed
// no-argument resolveTraineeCourseOffering(). There is deliberately no
// courseOfferingId parameter anywhere in this file, no resolveCurrentCourse-
// Offering, no offering-id constant, no Level 1 fallback, no cookie, and no
// group/name/level/date inference. All ordering and every allow/deny decision
// live in the pure core, which is where the DB-free tests exercise them.
export async function getOpenWeeklyFeedbackForStudent(studentId: string): Promise<WeeklyFeedbackForStudent> {
  // L2-F1A: accepted for caller compatibility and deliberately DISCARDED. It is
  // a client-supplied value and therefore never identity; see the header above.
  void studentId;

  const outcome = await loadTraineeWeeklyFeedbackWithDeps<TraineeFeedbackFormWithQuestions>({
    requireTraineeId: async () => (await requireCurrentTrainee()).id,
    resolveTraineeCourseOffering,
    // Ownership lives INSIDE this where clause: a form belonging to another
    // course is never fetched, so it can never be fetched-then-filtered.
    fetchOwnedForm: (query) =>
      prisma.weeklyFeedbackForm.findFirst({
        where: query.where,
        orderBy: query.orderBy,
        select: TRAINEE_FEEDBACK_FORM_SELECT,
      }),
    // traineeId is supplied by the core from the signed session, never by this
    // action's caller.
    fetchResponse: ({ formId, traineeId }) =>
      prisma.weeklyFeedbackResponse.findUnique({
        where: { formId_studentId: { formId, studentId: traineeId } },
        select: { submittedAt: true },
      }),
    now: () => new Date(),
  });

  // "submitted" is decided before the open-window gate, so a trainee who
  // submitted while the form was open keeps seeing "תודה, המשוב הוגש" after the
  // admin closes it or its closesAt passes - unchanged behaviour.
  if (outcome.status === "submitted") {
    return {
      status: "submitted",
      formTitle: outcome.form.title,
      submittedAt: outcome.submittedAt.toISOString(),
    };
  }
  if (outcome.status === "open") {
    return {
      status: "open",
      formId: outcome.form.id,
      formTitle: outcome.form.title,
      questions: outcome.form.questions.map((q) => ({
        id: q.id,
        section: q.section,
        prompt: q.prompt,
        type: q.type,
        sortOrder: q.sortOrder,
        isRequired: q.isRequired,
      })),
    };
  }
  return { status: "none" };
}

export interface WeeklyFeedbackAnswerInput {
  questionId: string;
  ratingValue: number | null;
  textValue: string | null;
}

/** The exact form columns the submission projects - plus its questions. */
const TRAINEE_SUBMISSION_FORM_SELECT = {
  id: true,
  title: true,
  status: true,
  opensAt: true,
  closesAt: true,
  weeklySchedule: { select: { courseOfferingId: true } },
  questions: { select: { id: true, type: true, isRequired: true } },
} as const;

interface TraineeSubmissionForm extends TraineeWeeklyFeedbackFormRow {
  questions: { id: string; type: FeedbackQuestionTypeValue; isRequired: boolean }[];
}

/**
 * The SINGLE message every authorization/ownership denial returns, so
 * unauthenticated, no/ambiguous-course, unknown-form, NULL-scoped and
 * cross-course are indistinguishable and no form can be probed for existence.
 * It is the exact string the previous "form not found" branch used.
 */
const WEEKLY_FEEDBACK_NOT_FOUND_ERROR = "המשוב לא נמצא";

/**
 * The pre-existing window/status messages, keyed by the core's classification.
 * These apply only to a form the caller's OWN offering owns, so they disclose
 * nothing across courses.
 */
const SUBMISSION_WINDOW_ERROR: Record<
  Exclude<WeeklyFeedbackSubmissionWindowState, "OPEN">,
  string
> = {
  NOT_PUBLISHED: "המשוב אינו פתוח למילוי",
  NOT_YET_OPEN: "המשוב עדיין לא נפתח למילוי",
  CLOSED: "המשוב נסגר למילוי",
};

// Re-validates everything server-side rather than trusting the client's
// question list - opensAt/closesAt/status are re-read fresh, and every
// question with isRequired=true must have a valid answer (in-range rating,
// or non-empty text for FREE_TEXT); optional questions may be left
// unanswered. The @@unique on (formId, studentId) is the last line of
// defense against a duplicate submission race, on top of the findUnique
// check below.
export async function submitWeeklyFeedback(
  studentId: string,
  formId: string,
  answers: WeeklyFeedbackAnswerInput[]
): Promise<ActionResult> {
  // L2-F1A: accepted for caller compatibility and deliberately DISCARDED. It is
  // a client-supplied value and therefore never identity; see the header above
  // getOpenWeeklyFeedbackForStudent. Passing another trainee's id can no longer
  // submit as them.
  void studentId;

  const authorization = await authorizeTraineeWeeklyFeedbackSubmissionWithDeps<TraineeSubmissionForm>(
    formId,
    {
      requireTraineeId: async () => (await requireCurrentTrainee()).id,
      resolveTraineeCourseOffering,
      // The caller-supplied formId is ANDed with the mandatory ownership
      // predicate, so another course's form simply does not match - it is never
      // fetched. A raw formId is never authorization.
      fetchOwnedFormById: (query) =>
        prisma.weeklyFeedbackForm.findFirst({
          where: query.where,
          select: TRAINEE_SUBMISSION_FORM_SELECT,
        }),
    }
  );
  // One uniform denial for anonymous, expired, inactive, no/ambiguous offering,
  // unknown form, NULL-scoped week and another course's form - so a Level 2
  // caller cannot distinguish "wrong course" from "no such form", and nothing
  // is read or written before this returns.
  if (!authorization.authorized) {
    return { success: false, error: WEEKLY_FEEDBACK_NOT_FOUND_ERROR };
  }
  const { traineeId, form } = authorization;

  // Window/status gates on an ALREADY-OWNED form - same rules, same three
  // messages as before.
  const windowState = classifyWeeklyFeedbackSubmissionWindow(form, new Date());
  if (windowState !== "OPEN") {
    return { success: false, error: SUBMISSION_WINDOW_ERROR[windowState] };
  }

  const existing = await prisma.weeklyFeedbackResponse.findUnique({
    where: { formId_studentId: { formId: form.id, studentId: traineeId } },
  });
  if (existing) {
    return { success: false, error: "כבר הגשת את המשוב הזה" };
  }

  const answerByQuestionId = new Map(answers.map((a) => [a.questionId, a]));
  const answerRowsToCreate: { questionId: string; ratingValue?: number; textValue?: string }[] = [];

  for (const question of form.questions) {
    const answer = answerByQuestionId.get(question.id);
    if (question.type === "FREE_TEXT") {
      const text = answer?.textValue?.trim();
      if (text) {
        answerRowsToCreate.push({ questionId: question.id, textValue: text });
      } else if (question.isRequired) {
        return { success: false, error: "יש למלא את כל שאלות החובה" };
      }
      continue;
    }

    const max = question.type === "COMPARISON_3" ? 3 : 5;
    const rating = answer?.ratingValue;
    const hasValidRating = rating != null && Number.isInteger(rating) && rating >= 1 && rating <= max;
    if (!hasValidRating) {
      if (question.isRequired) {
        return { success: false, error: "יש למלא את כל שאלות החובה" };
      }
      continue;
    }
    answerRowsToCreate.push({ questionId: question.id, ratingValue: rating });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Both ids are server-derived: the form is the one ownership verified, and
      // the student is the signed session's trainee. Neither comes from a
      // client argument, so no cross-course response row can be created.
      const response = await tx.weeklyFeedbackResponse.create({
        data: { formId: form.id, studentId: traineeId },
      });
      if (answerRowsToCreate.length > 0) {
        await tx.weeklyFeedbackAnswer.createMany({
          data: answerRowsToCreate.map((a) => ({ ...a, responseId: response.id })),
        });
      }
    });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      return { success: false, error: "כבר הגשת את המשוב הזה" };
    }
    throw err;
  }

  return { success: true };
}

export interface WeeklyFeedbackResultsFormInfo {
  id: string;
  title: string;
  status: WeeklyFeedbackStatusValue;
  opensAt: string | null;
  closesAt: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  weekName: string;
  weekStartDate: string;
  weekEndDate: string;
}

export interface WeeklyFeedbackResultsSummary {
  activeTraineeCount: number;
  submittedCount: number;
  notSubmittedCount: number;
}

// L2-F1B: the enrollment columns the results roster projects. groupName /
// subgroupNumber are deliberately NOT read here - the group shown for a past
// feedback week is resolved effective-dated via loadHistoricalTraineeState
// below, and the current Student mirror must not creep back in as a fallback.
const ROSTER_MEMBER_SELECT = {
  studentId: true,
  student: { select: { fullName: true } },
} as const;

export interface WeeklyFeedbackSubmittedTrainee {
  studentId: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  submittedAt: string;
  // Whether this trainee is still active today (not at submission time) -
  // lets the admin UI filter the "X מתוך Y" denominator to active trainees
  // only, while still listing a since-deactivated trainee's historical
  // submission in submittedTrainees/traineeResponses.
  isActive: boolean;
}

export interface WeeklyFeedbackNotSubmittedTrainee {
  studentId: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

export interface WeeklyFeedbackRatingDistributionEntry {
  value: number;
  count: number;
}

export interface WeeklyFeedbackFreeTextAnswer {
  studentId: string;
  studentName: string;
  submittedAt: string;
  text: string;
}

export interface WeeklyFeedbackQuestionResult {
  questionId: string;
  section: string;
  prompt: string;
  type: FeedbackQuestionTypeValue;
  sortOrder: number;
  answerCount: number;
  averageRating: number | null;
  ratingDistribution: WeeklyFeedbackRatingDistributionEntry[] | null;
  freeTextAnswers: WeeklyFeedbackFreeTextAnswer[] | null;
}

export interface WeeklyFeedbackTraineeResponseAnswer {
  questionId: string;
  section: string;
  prompt: string;
  type: FeedbackQuestionTypeValue;
  ratingValue: number | null;
  textValue: string | null;
}

export interface WeeklyFeedbackTraineeResponse {
  studentId: string;
  studentName: string;
  submittedAt: string;
  answers: WeeklyFeedbackTraineeResponseAnswer[];
}

export interface WeeklyFeedbackResults {
  form: WeeklyFeedbackResultsFormInfo;
  summary: WeeklyFeedbackResultsSummary;
  submittedTrainees: WeeklyFeedbackSubmittedTrainee[];
  notSubmittedTrainees: WeeklyFeedbackNotSubmittedTrainee[];
  questionResults: WeeklyFeedbackQuestionResult[];
  traineeResponses: WeeklyFeedbackTraineeResponse[];
}

// The denominator and the missing-response list are the form's OWN COURSE
// roster - L2-F1B. Ownership comes only from the form's week
// (weeklySchedule.courseOfferingId), the roster is enrollment-backed (ACTIVE
// enrollment into that exact offering AND a globally active Student), and a
// NULL-scoped week fails closed to an empty roster. A trainee enrolled in a
// DIFFERENT offering therefore cannot inflate this form's denominator or be
// listed as owing it a response.
//
// Responses are untouched by the roster: a trainee who submitted and was later
// deactivated (or whose enrollment ended) still appears in
// submittedTrainees/traineeResponses and in every question's answers, because
// that is real historical data. They simply do not count toward
// activeTraineeCount/submittedCount, and - since notSubmitted is derived FROM
// the roster rather than as (denominator - responses) - they cannot decrement
// the missing count either.
export async function getWeeklyFeedbackResults(formId: string): Promise<WeeklyFeedbackResults | null> {
  await requireAdmin();

  const form = await prisma.weeklyFeedbackForm.findUnique({
    where: { id: formId },
    include: {
      // courseOfferingId is the AUTHORITATIVE ownership edge for this form.
      weeklySchedule: {
        select: { name: true, startDate: true, endDate: true, courseOfferingId: true },
      },
      questions: { orderBy: { sortOrder: "asc" } },
      responses: {
        orderBy: { submittedAt: "asc" },
        include: {
          student: {
            select: { id: true, fullName: true, groupName: true, subgroupNumber: true, isActive: true },
          },
          answers: true,
        },
      },
    },
  });
  if (!form) return null;

  // Fail closed BEFORE the roster query: an unscoped week yields no query at
  // all, and therefore an empty roster - never a global read.
  const ownerOfferingId = acceptWeeklyFeedbackFormOfferingId(form.weeklySchedule.courseOfferingId);
  const rosterQuery = ownerOfferingId === null ? null : buildWeeklyFeedbackRosterQuery(ownerOfferingId);
  const rosterEnrollments =
    rosterQuery === null
      ? []
      : await prisma.courseEnrollment.findMany({
          // Offering, enrollment status and student activity are all predicates
          // INSIDE the where clause, so another course's trainees are never
          // fetched and then filtered out.
          where: rosterQuery.where,
          select: ROSTER_MEMBER_SELECT,
          orderBy: rosterQuery.orderBy,
        });
  // Defensive dedupe: one row per trainee even if a future query change joins
  // more than one enrollment row per student.
  const roster = toWeeklyFeedbackRosterMembers(rosterEnrollments);

  const submittedStudentIds = new Set(form.responses.map((r) => r.studentId));
  const summary: WeeklyFeedbackResultsSummary = summarizeWeeklyFeedbackDenominator(
    roster,
    submittedStudentIds,
  );

  // W6D3-HOTFIX: group/subgroup for this past week must reflect the group each
  // trainee was in DURING THE FEEDBACK WEEK, not the current Student mirror. The
  // representative date is the form's weeklySchedule.startDate (the week the
  // feedback covers). Fail closed to null (no current-mirror fallback). The
  // active-roster COUNT (denominator) still uses the currently-active roster.
  const weekStart = form.weeklySchedule.startDate;
  const historical = await loadHistoricalTraineeState([
    ...form.responses.map((r) => r.studentId),
    ...roster.map((member) => member.id),
  ]);

  const submittedTrainees: WeeklyFeedbackSubmittedTrainee[] = form.responses
    .map((r) => {
      const group = historical.groupAt(r.studentId, weekStart);
      return {
        studentId: r.studentId,
        fullName: r.student.fullName,
        groupName: group.ok ? group.value.groupName : null,
        subgroupNumber: group.ok ? group.value.subgroupNumber : null,
        submittedAt: r.submittedAt.toISOString(),
        isActive: r.student.isActive,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "he"));

  // Drawn ONLY from the form's own scoped roster, so no trainee from another
  // offering can ever be listed here, and an off-roster response cannot remove
  // anyone from it.
  const notSubmittedTrainees: WeeklyFeedbackNotSubmittedTrainee[] = selectNotSubmittedRosterMembers(
    roster,
    submittedStudentIds,
  ).map((member) => {
    const group = historical.groupAt(member.id, weekStart);
    return {
      studentId: member.id,
      fullName: member.fullName,
      groupName: group.ok ? group.value.groupName : null,
      subgroupNumber: group.ok ? group.value.subgroupNumber : null,
    };
  });

  const answersByQuestionId = new Map<string, { response: (typeof form.responses)[number]; answer: (typeof form.responses)[number]["answers"][number] }[]>();
  for (const response of form.responses) {
    for (const answer of response.answers) {
      const list = answersByQuestionId.get(answer.questionId) ?? [];
      list.push({ response, answer });
      answersByQuestionId.set(answer.questionId, list);
    }
  }

  const questionResults: WeeklyFeedbackQuestionResult[] = form.questions.map((question) => {
    const entries = answersByQuestionId.get(question.id) ?? [];

    if (question.type === "FREE_TEXT") {
      const freeTextAnswers: WeeklyFeedbackFreeTextAnswer[] = entries
        .filter((e) => e.answer.textValue && e.answer.textValue.trim() !== "")
        .map((e) => ({
          studentId: e.response.studentId,
          studentName: e.response.student.fullName,
          submittedAt: e.response.submittedAt.toISOString(),
          text: e.answer.textValue as string,
        }));
      return {
        questionId: question.id,
        section: question.section,
        prompt: question.prompt,
        type: question.type,
        sortOrder: question.sortOrder,
        answerCount: freeTextAnswers.length,
        averageRating: null,
        ratingDistribution: null,
        freeTextAnswers,
      };
    }

    const ratings = entries
      .map((e) => e.answer.ratingValue)
      .filter((v): v is number => v != null);
    const maxValue = question.type === "COMPARISON_3" ? 3 : 5;
    const ratingDistribution: WeeklyFeedbackRatingDistributionEntry[] = Array.from(
      { length: maxValue },
      (_, i) => ({ value: i + 1, count: ratings.filter((r) => r === i + 1).length })
    );

    return {
      questionId: question.id,
      section: question.section,
      prompt: question.prompt,
      type: question.type,
      sortOrder: question.sortOrder,
      answerCount: ratings.length,
      averageRating: ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : null,
      ratingDistribution,
      freeTextAnswers: null,
    };
  });

  const traineeResponses: WeeklyFeedbackTraineeResponse[] = form.responses.map((response) => ({
    studentId: response.studentId,
    studentName: response.student.fullName,
    submittedAt: response.submittedAt.toISOString(),
    answers: form.questions.map((question) => {
      const answer = response.answers.find((a) => a.questionId === question.id);
      return {
        questionId: question.id,
        section: question.section,
        prompt: question.prompt,
        type: question.type,
        ratingValue: answer?.ratingValue ?? null,
        textValue: answer?.textValue ?? null,
      };
    }),
  }));

  return {
    form: {
      id: form.id,
      title: form.title,
      status: form.status,
      opensAt: form.opensAt ? form.opensAt.toISOString() : null,
      closesAt: form.closesAt ? form.closesAt.toISOString() : null,
      publishedAt: form.publishedAt ? form.publishedAt.toISOString() : null,
      closedAt: form.closedAt ? form.closedAt.toISOString() : null,
      weekName: form.weeklySchedule.name,
      weekStartDate: dateKey(form.weeklySchedule.startDate),
      weekEndDate: dateKey(form.weeklySchedule.endDate),
    },
    summary,
    submittedTrainees,
    notSubmittedTrainees,
    questionResults,
    traineeResponses,
  };
}
