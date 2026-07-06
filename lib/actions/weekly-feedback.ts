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

// Only DRAFT forms may have their questions edited - once PUBLISHED, חניכים
// may already be answering against the existing question set, and once
// CLOSED the form is final. Enforced fresh from the DB on every call since
// the admin client only holds a possibly-stale draft snapshot.
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
  if (form.status !== "DRAFT") return { success: false, error: "ניתן לערוך שאלות רק בטיוטה" };

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
    include: { form: { select: { status: true } } },
  });
  if (!question) return { success: false, error: "השאלה לא נמצאה" };
  if (question.form.status !== "DRAFT") return { success: false, error: "ניתן לערוך שאלות רק בטיוטה" };

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
    include: { form: { select: { status: true, _count: { select: { questions: true } } } } },
  });
  if (!question) return { success: false, error: "השאלה לא נמצאה" };
  if (question.form.status !== "DRAFT") return { success: false, error: "ניתן לערוך שאלות רק בטיוטה" };
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
  if (form.status !== "DRAFT") return { success: false, error: "ניתן לערוך שאלות רק בטיוטה" };

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
