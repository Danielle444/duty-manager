"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";

export type WeeklyFeedbackStatusValue = "DRAFT" | "PUBLISHED" | "CLOSED";
export type FeedbackQuestionTypeValue = "RATING_5" | "COMPARISON_3" | "FREE_TEXT";
export type FeedbackQuestionSourceValue = "FIXED" | "DYNAMIC";

// Question types the admin UI may set when adding/editing a question.
// COMPARISON_3 is intentionally excluded here - it's not offered yet, per
// the fixed-template comment above. Any pre-existing COMPARISON_3 rows
// (none as of this stage) are unaffected since these actions only ever
// write EditableFeedbackQuestionTypeValue values.
export type EditableFeedbackQuestionTypeValue = "RATING_5" | "FREE_TEXT";

interface FixedQuestionTemplateItem {
  section: string;
  prompt: string;
  type: FeedbackQuestionTypeValue;
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
  activeStudentCount: number;
}

export async function listWeeklyFeedbackForms(): Promise<WeeklyFeedbackFormListItem[]> {
  await requireAdmin();

  const [forms, activeStudentCount] = await Promise.all([
    prisma.weeklyFeedbackForm.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        weeklySchedule: { select: { name: true, startDate: true, endDate: true } },
        _count: { select: { questions: true, responses: true } },
      },
    }),
    prisma.student.count({ where: { isActive: true } }),
  ]);

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
    activeStudentCount,
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
  if (type !== "RATING_5" && type !== "FREE_TEXT") return { error: "סוג שאלה לא תקין" };
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
  type: EditableFeedbackQuestionTypeValue
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
    },
  });

  return { success: true };
}

export async function updateWeeklyFeedbackQuestion(
  questionId: string,
  section: string,
  prompt: string,
  type: EditableFeedbackQuestionTypeValue
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
    data: { section: validated.section, prompt: validated.prompt, type },
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
}

// A discriminated union rather than one flat shape - "submitted" intentionally
// omits the question list (no editable state to expose once answered), and
// "none" covers both "no published form right now" and "student inactive",
// so the trainee UI never learns which of those two it is.
export type WeeklyFeedbackForStudent =
  | { status: "none" }
  | { status: "submitted"; formTitle: string; submittedAt: string }
  | { status: "open"; formId: string; formTitle: string; questions: WeeklyFeedbackQuestionForStudent[] };

// Students have no NextAuth session, so studentId is re-verified against the
// DB on every call (same convention as getScheduleForStudent/verifyStudentLogin)
// rather than trusted from the client's cached localStorage session.
export async function getOpenWeeklyFeedbackForStudent(studentId: string): Promise<WeeklyFeedbackForStudent> {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student || !student.isActive) return { status: "none" };

  // The "relevant" form is the most recently published one, whether or not
  // it's still open (DRAFT forms are excluded - trainees never had access
  // to them). "Already submitted" is checked against this form before the
  // open-window gate below, so a trainee who submitted while it was open
  // keeps seeing "תודה, המשוב הוגש" even after the admin closes it or its
  // closesAt passes, instead of that confirmation silently disappearing.
  const form = await prisma.weeklyFeedbackForm.findFirst({
    where: { status: { in: ["PUBLISHED", "CLOSED"] } },
    orderBy: { publishedAt: "desc" },
    include: { questions: { orderBy: { sortOrder: "asc" } } },
  });
  if (!form) return { status: "none" };

  const response = await prisma.weeklyFeedbackResponse.findUnique({
    where: { formId_studentId: { formId: form.id, studentId } },
  });
  if (response) {
    return { status: "submitted", formTitle: form.title, submittedAt: response.submittedAt.toISOString() };
  }

  const now = new Date();
  const isCurrentlyOpen =
    form.status === "PUBLISHED" &&
    (!form.opensAt || form.opensAt <= now) &&
    (!form.closesAt || form.closesAt > now);
  if (!isCurrentlyOpen) return { status: "none" };

  return {
    status: "open",
    formId: form.id,
    formTitle: form.title,
    questions: form.questions.map((q) => ({
      id: q.id,
      section: q.section,
      prompt: q.prompt,
      type: q.type,
      sortOrder: q.sortOrder,
    })),
  };
}

export interface WeeklyFeedbackAnswerInput {
  questionId: string;
  ratingValue: number | null;
  textValue: string | null;
}

// Re-validates everything server-side rather than trusting the client's
// question list - opensAt/closesAt/status are re-read fresh, and every
// RATING_5 (or, if one ever exists, COMPARISON_3) question in the form must
// have a valid in-range answer, FREE_TEXT stays optional. The @@unique on
// (formId, studentId) is the last line of defense against a duplicate
// submission race, on top of the findUnique check below.
export async function submitWeeklyFeedback(
  studentId: string,
  formId: string,
  answers: WeeklyFeedbackAnswerInput[]
): Promise<ActionResult> {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student || !student.isActive) {
    return { success: false, error: "חניך/ה לא נמצא/ה" };
  }

  const form = await prisma.weeklyFeedbackForm.findUnique({
    where: { id: formId },
    include: { questions: true },
  });
  if (!form) return { success: false, error: "המשוב לא נמצא" };

  const now = new Date();
  if (form.status !== "PUBLISHED") {
    return { success: false, error: "המשוב אינו פתוח למילוי" };
  }
  if (form.opensAt && form.opensAt > now) {
    return { success: false, error: "המשוב עדיין לא נפתח למילוי" };
  }
  if (form.closesAt && form.closesAt <= now) {
    return { success: false, error: "המשוב נסגר למילוי" };
  }

  const existing = await prisma.weeklyFeedbackResponse.findUnique({
    where: { formId_studentId: { formId, studentId } },
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
      }
      continue;
    }

    const max = question.type === "COMPARISON_3" ? 3 : 5;
    const rating = answer?.ratingValue;
    if (rating == null || !Number.isInteger(rating) || rating < 1 || rating > max) {
      return { success: false, error: "יש למלא את כל שאלות הדירוג" };
    }
    answerRowsToCreate.push({ questionId: question.id, ratingValue: rating });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const response = await tx.weeklyFeedbackResponse.create({ data: { formId, studentId } });
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

export interface WeeklyFeedbackSubmittedTrainee {
  studentId: string;
  fullName: string;
  groupName: string | null;
  submittedAt: string;
}

export interface WeeklyFeedbackNotSubmittedTrainee {
  studentId: string;
  fullName: string;
  groupName: string | null;
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

// Active trainees are the denominator for the summary/not-submitted list -
// a trainee who submitted and was later deactivated still shows up in
// submittedTrainees/traineeResponses (their answer is real historical data),
// but doesn't count toward activeTraineeCount/submittedCount so the "X מתוך
// Y" figure always reflects the currently-active roster.
export async function getWeeklyFeedbackResults(formId: string): Promise<WeeklyFeedbackResults | null> {
  await requireAdmin();

  const form = await prisma.weeklyFeedbackForm.findUnique({
    where: { id: formId },
    include: {
      weeklySchedule: { select: { name: true, startDate: true, endDate: true } },
      questions: { orderBy: { sortOrder: "asc" } },
      responses: {
        orderBy: { submittedAt: "asc" },
        include: {
          student: { select: { id: true, fullName: true, groupName: true } },
          answers: true,
        },
      },
    },
  });
  if (!form) return null;

  const activeStudents = await prisma.student.findMany({
    where: { isActive: true },
    select: { id: true, fullName: true, groupName: true },
    orderBy: { fullName: "asc" },
  });

  const submittedStudentIds = new Set(form.responses.map((r) => r.studentId));
  const activeSubmittedCount = activeStudents.filter((s) => submittedStudentIds.has(s.id)).length;

  const summary: WeeklyFeedbackResultsSummary = {
    activeTraineeCount: activeStudents.length,
    submittedCount: activeSubmittedCount,
    notSubmittedCount: activeStudents.length - activeSubmittedCount,
  };

  const submittedTrainees: WeeklyFeedbackSubmittedTrainee[] = form.responses
    .map((r) => ({
      studentId: r.studentId,
      fullName: r.student.fullName,
      groupName: r.student.groupName,
      submittedAt: r.submittedAt.toISOString(),
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "he"));

  const notSubmittedTrainees: WeeklyFeedbackNotSubmittedTrainee[] = activeStudents
    .filter((s) => !submittedStudentIds.has(s.id))
    .map((s) => ({ studentId: s.id, fullName: s.fullName, groupName: s.groupName }));

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
