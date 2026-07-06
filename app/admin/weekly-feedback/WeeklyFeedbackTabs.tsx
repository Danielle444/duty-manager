"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import {
  addWeeklyFeedbackQuestion,
  closeWeeklyFeedbackForm,
  createWeeklyFeedbackDraft,
  deleteWeeklyFeedbackQuestion,
  getWeeklyFeedbackDraftForAdmin,
  getWeeklyFeedbackResults,
  listWeeklyFeedbackForms,
  publishWeeklyFeedbackForm,
  reorderWeeklyFeedbackQuestions,
  updateWeeklyFeedbackQuestion,
  updateWeeklyFeedbackSchedule,
  type EditableFeedbackQuestionTypeValue,
  type FeedbackQuestionTypeValue,
  type WeeklyFeedbackDraft,
  type WeeklyFeedbackDraftQuestion,
  type WeeklyFeedbackFormListItem,
  type WeeklyFeedbackQuestionResult,
  type WeeklyFeedbackResults,
  type WeeklyFeedbackStatusValue,
} from "@/lib/actions/weekly-feedback";
import type { WeeklyScheduleOption } from "@/lib/actions/weekly-schedule";
import { formatHebrewDate, formatHebrewDateTime, parseDateKey } from "@/lib/dates";

type Tab = "list" | "draft" | "schedule" | "results";

const TAB_LABELS: Record<Tab, string> = {
  list: "רשימת משובים",
  draft: "בניית טיוטה / צפייה בשאלות",
  schedule: "הגדרות פתיחה וסגירה",
  results: "תוצאות",
};

interface AvailabilityInput {
  status: WeeklyFeedbackStatusValue;
  opensAt: string | null;
  closesAt: string | null;
}

// Derives the trainee-facing availability from status + the schedule
// window, rather than status alone - a PUBLISHED form can still be
// scheduled-for-later, currently open, or past its closesAt without ever
// having been manually closed.
function getAvailabilityInfo(form: AvailabilityInput): { label: string; className: string } {
  if (form.status === "DRAFT") {
    return { label: "טיוטה", className: "bg-secondary text-secondary-foreground" };
  }
  if (form.status === "CLOSED") {
    return { label: "סגור", className: "bg-muted text-muted-foreground" };
  }
  const now = Date.now();
  if (form.opensAt && new Date(form.opensAt).getTime() > now) {
    return { label: "מתוזמן", className: "bg-warning-muted text-warning" };
  }
  if (form.closesAt && new Date(form.closesAt).getTime() < now) {
    return { label: "הסתיים", className: "bg-muted text-muted-foreground" };
  }
  return { label: "פתוח לחניכים", className: "bg-success-muted text-success" };
}

// Mirrors isFeedbackQuestionsEditable in lib/actions/weekly-feedback.ts - this
// is only used to decide what the UI shows/enables; the server actions
// re-check the same rule fresh from the DB and never trust this derived value.
function isQuestionsEditable(form: { status: WeeklyFeedbackStatusValue; opensAt: string | null }): boolean {
  if (form.status === "DRAFT") return true;
  if (form.status === "PUBLISHED" && form.opensAt && new Date(form.opensAt).getTime() > Date.now()) {
    return true;
  }
  return false;
}

const TYPE_LABELS: Record<FeedbackQuestionTypeValue, string> = {
  RATING_5: "דירוג 1–5",
  COMPARISON_3: "השוואה לשבוע שעבר (1–3)",
  FREE_TEXT: "טקסט חופשי",
};

// Only these two types may be assigned via the draft-editing UI - COMPARISON_3
// is deferred (see FIXED_QUESTION_TEMPLATE's doc comment in weekly-feedback.ts).
const EDITABLE_TYPE_OPTIONS: EditableFeedbackQuestionTypeValue[] = ["RATING_5", "FREE_TEXT"];

function weekRangeLabel(startDate: string, endDate: string): string {
  return `${formatHebrewDate(parseDateKey(startDate))} - ${formatHebrewDate(parseDateKey(endDate))}`;
}

// datetime-local inputs work in the browser's own local time - converting
// with plain Date getters (not the UTC variants) here is intentional, since
// this runs client-side only.
function toDateTimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function AvailabilityBadge({ form }: { form: AvailabilityInput }) {
  const info = getAvailabilityInfo(form);
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${info.className}`}>{info.label}</span>
  );
}

export function WeeklyFeedbackTabs({
  initialForms,
  weeks,
}: {
  initialForms: WeeklyFeedbackFormListItem[];
  weeks: WeeklyScheduleOption[];
}) {
  const [tab, setTab] = useState<Tab>("list");
  const [forms, setForms] = useState(initialForms);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);

  const [selectedWeekId, setSelectedWeekId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [isCreatePending, startCreateTransition] = useTransition();

  const weeksWithoutForm = useMemo(
    () => weeks.filter((w) => !forms.some((f) => f.weeklyScheduleId === w.id)),
    [weeks, forms]
  );

  // Derived at render time instead of corrected via an effect: falls back to
  // the first still-available week whenever the raw selection is empty or no
  // longer in weeksWithoutForm (e.g. right after a draft was just created for
  // it) - both the <select> and handleCreateDraft use this, never the raw
  // selectedWeekId directly.
  const effectiveSelectedWeekId =
    selectedWeekId && weeksWithoutForm.some((w) => w.id === selectedWeekId)
      ? selectedWeekId
      : (weeksWithoutForm[0]?.id ?? "");

  async function refreshForms() {
    const fresh = await listWeeklyFeedbackForms();
    setForms(fresh);
  }

  function handleCreateDraft() {
    if (!effectiveSelectedWeekId) return;
    setCreateError(null);
    setCreateSuccess(null);
    startCreateTransition(async () => {
      const result = await createWeeklyFeedbackDraft(effectiveSelectedWeekId);
      if (!result.success) {
        setCreateError(result.error ?? "אירעה שגיאה");
        return;
      }
      await refreshForms();
      setCreateSuccess("הטיוטה נוצרה בהצלחה");
    });
  }

  function openForm(formId: string, target: Tab) {
    setSelectedFormId(formId);
    setTab(target);
  }

  const [draft, setDraft] = useState<WeeklyFeedbackDraft | null>(null);
  const [isDraftLoading, setIsDraftLoading] = useState(false);

  useEffect(() => {
    // selectedFormId only ever becomes non-null via openForm below - it's
    // never reset back to null in this UI, so there's no "cleared
    // selection" case to handle here; this guard exists purely for
    // TypeScript's benefit (getWeeklyFeedbackDraftForAdmin expects a string).
    if (!selectedFormId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDraftLoading(true);
    getWeeklyFeedbackDraftForAdmin(selectedFormId).then((result) => {
      if (!cancelled) {
        setDraft(result);
        setIsDraftLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedFormId]);

  const [isQuestionMutating, startQuestionMutation] = useTransition();

  const [newSection, setNewSection] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newType, setNewType] = useState<EditableFeedbackQuestionTypeValue>("RATING_5");
  const [addQuestionError, setAddQuestionError] = useState<string | null>(null);

  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editSection, setEditSection] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editType, setEditType] = useState<EditableFeedbackQuestionTypeValue>("RATING_5");
  const [editQuestionError, setEditQuestionError] = useState<string | null>(null);

  const [questionActionError, setQuestionActionError] = useState<string | null>(null);

  async function refreshDraft() {
    if (!selectedFormId) return;
    const fresh = await getWeeklyFeedbackDraftForAdmin(selectedFormId);
    setDraft(fresh);
    await refreshForms();
  }

  function handleAddQuestion() {
    if (!draft) return;
    setAddQuestionError(null);
    startQuestionMutation(async () => {
      const result = await addWeeklyFeedbackQuestion(draft.id, newSection, newPrompt, newType);
      if (!result.success) {
        setAddQuestionError(result.error ?? "אירעה שגיאה");
        return;
      }
      setNewSection("");
      setNewPrompt("");
      setNewType("RATING_5");
      await refreshDraft();
    });
  }

  function startEditQuestion(question: WeeklyFeedbackDraftQuestion) {
    setEditingQuestionId(question.id);
    setEditSection(question.section);
    setEditPrompt(question.prompt);
    setEditType(question.type === "COMPARISON_3" ? "RATING_5" : question.type);
    setEditQuestionError(null);
  }

  function cancelEditQuestion() {
    setEditingQuestionId(null);
    setEditQuestionError(null);
  }

  function handleSaveEditQuestion() {
    if (!editingQuestionId) return;
    setEditQuestionError(null);
    startQuestionMutation(async () => {
      const result = await updateWeeklyFeedbackQuestion(editingQuestionId, editSection, editPrompt, editType);
      if (!result.success) {
        setEditQuestionError(result.error ?? "אירעה שגיאה");
        return;
      }
      setEditingQuestionId(null);
      await refreshDraft();
    });
  }

  function handleDeleteQuestion(questionId: string) {
    setQuestionActionError(null);
    startQuestionMutation(async () => {
      const result = await deleteWeeklyFeedbackQuestion(questionId);
      if (!result.success) {
        setQuestionActionError(result.error ?? "אירעה שגיאה");
        return;
      }
      await refreshDraft();
    });
  }

  function handleMoveQuestion(questionId: string, direction: "up" | "down") {
    if (!draft) return;
    const ids = draft.questions.map((q) => q.id);
    const index = ids.indexOf(questionId);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || swapWith < 0 || swapWith >= ids.length) return;
    const reordered = [...ids];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
    setQuestionActionError(null);
    startQuestionMutation(async () => {
      const result = await reorderWeeklyFeedbackQuestions(draft.id, reordered);
      if (!result.success) {
        setQuestionActionError(result.error ?? "אירעה שגיאה");
        return;
      }
      await refreshDraft();
    });
  }

  const [opensAtInput, setOpensAtInput] = useState("");
  const [closesAtInput, setClosesAtInput] = useState("");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleSuccess, setScheduleSuccess] = useState<string | null>(null);
  const [isSchedulePending, startScheduleTransition] = useTransition();

  // Syncs the editable datetime-local input state from the asynchronously
  // loaded draft (opensAt/closesAt arrive from getWeeklyFeedbackDraftForAdmin
  // after this component has already rendered) - genuinely needed here since
  // there's nothing to derive at render time, unlike effectiveSelectedWeekId
  // above.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpensAtInput(toDateTimeLocalValue(draft?.opensAt ?? null));
    setClosesAtInput(toDateTimeLocalValue(draft?.closesAt ?? null));
    setScheduleError(null);
    setScheduleSuccess(null);
  }, [draft?.id, draft?.opensAt, draft?.closesAt]);

  function handleSaveSchedule() {
    if (!draft) return;
    setScheduleError(null);
    setScheduleSuccess(null);

    // Converting through `new Date(...)` here (in the browser) captures the
    // admin's own local time correctly regardless of which timezone the
    // server process runs in - the resulting ISO string is an unambiguous
    // absolute instant by the time it reaches updateWeeklyFeedbackSchedule.
    const opensAtIso = opensAtInput ? new Date(opensAtInput).toISOString() : null;
    const closesAtIso = closesAtInput ? new Date(closesAtInput).toISOString() : null;
    if (opensAtIso && closesAtIso && closesAtIso <= opensAtIso) {
      setScheduleError("תאריך הסגירה חייב להיות אחרי תאריך הפתיחה");
      return;
    }

    startScheduleTransition(async () => {
      const result = await updateWeeklyFeedbackSchedule(draft.id, opensAtIso, closesAtIso);
      if (!result.success) {
        setScheduleError(result.error ?? "אירעה שגיאה");
        return;
      }
      const fresh = await getWeeklyFeedbackDraftForAdmin(draft.id);
      setDraft(fresh);
      await refreshForms();
      setScheduleSuccess("ההגדרות נשמרו בהצלחה");
    });
  }

  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null);
  const [isPublishPending, startPublishTransition] = useTransition();

  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeSuccess, setCloseSuccess] = useState<string | null>(null);
  const [isClosePending, startCloseTransition] = useTransition();

  function handlePublish() {
    if (!draft) return;
    setPublishError(null);
    setPublishSuccess(null);
    if (draft.questions.length === 0) {
      setPublishError("לא ניתן לפרסם משוב ללא שאלות");
      return;
    }

    const opensAtIso = opensAtInput ? new Date(opensAtInput).toISOString() : null;
    const closesAtIso = closesAtInput ? new Date(closesAtInput).toISOString() : null;
    if (opensAtIso && closesAtIso && closesAtIso <= opensAtIso) {
      setPublishError("תאריך הסגירה חייב להיות אחרי תאריך הפתיחה");
      return;
    }

    startPublishTransition(async () => {
      const result = await publishWeeklyFeedbackForm(draft.id, opensAtIso, closesAtIso);
      if (!result.success) {
        setPublishError(result.error ?? "אירעה שגיאה");
        return;
      }
      const fresh = await getWeeklyFeedbackDraftForAdmin(draft.id);
      setDraft(fresh);
      await refreshForms();
      setPublishSuccess("המשוב פורסם בהצלחה");
    });
  }

  function handleClose() {
    if (!draft) return;
    setCloseError(null);
    setCloseSuccess(null);
    startCloseTransition(async () => {
      const result = await closeWeeklyFeedbackForm(draft.id);
      if (!result.success) {
        setCloseError(result.error ?? "אירעה שגיאה");
        return;
      }
      const fresh = await getWeeklyFeedbackDraftForAdmin(draft.id);
      setDraft(fresh);
      await refreshForms();
      setCloseSuccess("המשוב נסגר");
    });
  }

  const [results, setResults] = useState<WeeklyFeedbackResults | null>(null);
  const [isResultsLoading, setIsResultsLoading] = useState(false);

  // Only fetched while the "תוצאות" tab is actually open - unlike the draft
  // loader above (shared by the draft/schedule tabs), this query pulls every
  // response+answer for the form, so it's not worth loading on every
  // selectedFormId change regardless of which tab is showing.
  useEffect(() => {
    if (!selectedFormId || tab !== "results") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsResultsLoading(true);
    getWeeklyFeedbackResults(selectedFormId).then((result) => {
      if (!cancelled) {
        setResults(result);
        setIsResultsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedFormId, tab]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "list" && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-3 text-base font-semibold text-card-foreground">יצירת טיוטה חדשה</h2>
            {weeks.length === 0 ? (
              <p className="text-sm text-muted-foreground">לא הועלה עדיין לו&quot;ז שבועי.</p>
            ) : weeksWithoutForm.length === 0 ? (
              <p className="text-sm text-muted-foreground">לכל השבועות הקיימים כבר נוצרה טיוטת משוב.</p>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  שבוע
                  <select
                    value={effectiveSelectedWeekId}
                    onChange={(e) => setSelectedWeekId(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    {weeksWithoutForm.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({weekRangeLabel(w.startDate, w.endDate)})
                      </option>
                    ))}
                  </select>
                </label>
                <Button disabled={isCreatePending} onClick={handleCreateDraft}>
                  {isCreatePending ? "יוצר..." : "יצירת טיוטה"}
                </Button>
              </div>
            )}
            {createError && <p className="mt-2 text-sm text-danger">{createError}</p>}
            {createSuccess && <p className="mt-2 text-sm text-success">{createSuccess}</p>}
          </div>

          <div className="flex flex-col gap-3">
            {forms.length === 0 ? (
              <p className="rounded-xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
                אין עדיין משובים שבועיים.
              </p>
            ) : (
              forms.map((form) => (
                <div key={form.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <AvailabilityBadge form={form} />
                    <p className="text-base font-bold text-card-foreground">{form.title}</p>
                  </div>
                  <p className="mb-2 text-xs text-muted-foreground">
                    {form.weekName} · {weekRangeLabel(form.weekStartDate, form.weekEndDate)}
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">
                      {form.questionCount} שאלות · הגישו {form.responseCount} מתוך{" "}
                      {form.activeStudentCount} חניכים
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="ghost"
                        className="!px-2 !py-1"
                        onClick={() => openForm(form.id, "draft")}
                      >
                        צפייה בשאלות
                      </Button>
                      <Button
                        variant="ghost"
                        className="!px-2 !py-1"
                        onClick={() => openForm(form.id, "schedule")}
                      >
                        הגדרות פתיחה/סגירה
                      </Button>
                      <Button
                        variant="ghost"
                        className="!px-2 !py-1"
                        onClick={() => openForm(form.id, "results")}
                      >
                        צפייה בתוצאות
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === "draft" && (
        <div className="flex flex-col gap-3">
          {!selectedFormId ? (
            <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              לא נבחר משוב. יש לבחור משוב מתוך &quot;רשימת משובים&quot;.
            </p>
          ) : isDraftLoading || !draft ? (
            <p className="text-sm text-muted-foreground">טוען...</p>
          ) : (
            <>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <AvailabilityBadge form={draft} />
                  <p className="text-base font-bold text-card-foreground">{draft.title}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {draft.weekName} · {weekRangeLabel(draft.weekStartDate, draft.weekEndDate)}
                </p>
                {!isQuestionsEditable(draft) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    ניתן לערוך שאלות רק בטיוטה או במשוב מתוזמן שעדיין לא נפתח לחניכים - השאלות כאן
                    לצפייה בלבד.
                  </p>
                )}
              </div>

              {questionActionError && <p className="text-sm text-danger">{questionActionError}</p>}

              <div className="flex flex-col gap-3">
                {Object.entries(
                  draft.questions.reduce<Record<string, typeof draft.questions>>((acc, q) => {
                    (acc[q.section] ??= []).push(q);
                    return acc;
                  }, {})
                ).map(([section, questions]) => (
                  <div key={section} className="rounded-xl border border-border bg-card p-4">
                    <h3 className="mb-2 text-sm font-bold text-card-foreground">{section}</h3>
                    <div className="flex flex-col gap-2">
                      {questions.map((q) => {
                        const globalIndex = draft.questions.findIndex((x) => x.id === q.id);
                        const isFirst = globalIndex === 0;
                        const isLast = globalIndex === draft.questions.length - 1;
                        const isEditingThis = editingQuestionId === q.id;

                        if (!isQuestionsEditable(draft)) {
                          return (
                            <div
                              key={q.id}
                              className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-1.5 text-sm last:border-0"
                            >
                              <span className="text-card-foreground">{q.prompt}</span>
                              <span className="text-xs text-muted-foreground">{TYPE_LABELS[q.type]}</span>
                            </div>
                          );
                        }

                        if (isEditingThis) {
                          return (
                            <div
                              key={q.id}
                              className="flex flex-col gap-2 border-b border-border py-2 last:border-0"
                            >
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <input
                                  value={editSection}
                                  onChange={(e) => setEditSection(e.target.value)}
                                  placeholder="מקטע"
                                  className="w-full rounded-lg border border-border px-3 py-2 text-sm sm:w-40"
                                />
                                <input
                                  value={editPrompt}
                                  onChange={(e) => setEditPrompt(e.target.value)}
                                  placeholder="נוסח השאלה"
                                  className="w-full flex-1 rounded-lg border border-border px-3 py-2 text-sm"
                                />
                                <select
                                  value={editType}
                                  onChange={(e) => setEditType(e.target.value as EditableFeedbackQuestionTypeValue)}
                                  className="w-full rounded-lg border border-border px-3 py-2 text-sm sm:w-40"
                                >
                                  {EDITABLE_TYPE_OPTIONS.map((t) => (
                                    <option key={t} value={t}>
                                      {TYPE_LABELS[t]}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              {editQuestionError && <p className="text-sm text-danger">{editQuestionError}</p>}
                              <div className="flex gap-2">
                                <Button
                                  className="!px-2 !py-1"
                                  disabled={isQuestionMutating}
                                  onClick={handleSaveEditQuestion}
                                >
                                  שמירה
                                </Button>
                                <Button
                                  variant="ghost"
                                  className="!px-2 !py-1"
                                  disabled={isQuestionMutating}
                                  onClick={cancelEditQuestion}
                                >
                                  ביטול
                                </Button>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={q.id}
                            className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-1.5 text-sm last:border-0"
                          >
                            <span className="text-card-foreground">{q.prompt}</span>
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-xs text-muted-foreground">{TYPE_LABELS[q.type]}</span>
                              <Button
                                variant="ghost"
                                className="!px-1.5 !py-0.5 !text-xs"
                                disabled={isQuestionMutating || isFirst}
                                onClick={() => handleMoveQuestion(q.id, "up")}
                              >
                                ⬆
                              </Button>
                              <Button
                                variant="ghost"
                                className="!px-1.5 !py-0.5 !text-xs"
                                disabled={isQuestionMutating || isLast}
                                onClick={() => handleMoveQuestion(q.id, "down")}
                              >
                                ⬇
                              </Button>
                              <Button
                                variant="ghost"
                                className="!px-2 !py-0.5 !text-xs"
                                disabled={isQuestionMutating || q.type === "COMPARISON_3"}
                                onClick={() => startEditQuestion(q)}
                              >
                                עריכה
                              </Button>
                              <Button
                                variant="danger"
                                className="!px-2 !py-0.5 !text-xs"
                                disabled={isQuestionMutating || draft.questions.length <= 1}
                                onClick={() => handleDeleteQuestion(q.id)}
                              >
                                מחיקה
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {isQuestionsEditable(draft) && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="mb-2 text-sm font-bold text-card-foreground">הוספת שאלה</h3>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={newSection}
                      onChange={(e) => setNewSection(e.target.value)}
                      placeholder="מקטע"
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm sm:w-40"
                    />
                    <input
                      value={newPrompt}
                      onChange={(e) => setNewPrompt(e.target.value)}
                      placeholder="נוסח השאלה"
                      className="w-full flex-1 rounded-lg border border-border px-3 py-2 text-sm"
                    />
                    <select
                      value={newType}
                      onChange={(e) => setNewType(e.target.value as EditableFeedbackQuestionTypeValue)}
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm sm:w-40"
                    >
                      {EDITABLE_TYPE_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                    <Button disabled={isQuestionMutating} onClick={handleAddQuestion}>
                      הוספה
                    </Button>
                  </div>
                  {addQuestionError && <p className="mt-2 text-sm text-danger">{addQuestionError}</p>}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "schedule" && (
        <div className="flex flex-col gap-3">
          {!selectedFormId ? (
            <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              לא נבחר משוב. יש לבחור משוב מתוך &quot;רשימת משובים&quot;.
            </p>
          ) : isDraftLoading || !draft ? (
            <p className="text-sm text-muted-foreground">טוען...</p>
          ) : (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <AvailabilityBadge form={draft} />
                <p className="text-base font-bold text-card-foreground">{draft.title}</p>
              </div>
              {draft.status === "CLOSED" ? (
                <p className="text-sm text-muted-foreground">
                  המשוב סגור - לא ניתן לעדכן את חלון הזמינות.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    פתיחה למילוי
                    <input
                      type="datetime-local"
                      value={opensAtInput}
                      onChange={(e) => setOpensAtInput(e.target.value)}
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    סגירה למילוי
                    <input
                      type="datetime-local"
                      value={closesAtInput}
                      onChange={(e) => setClosesAtInput(e.target.value)}
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                    />
                  </label>
                  {scheduleError && <p className="text-sm text-danger">{scheduleError}</p>}
                  {scheduleSuccess && <p className="text-sm text-success">{scheduleSuccess}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={isSchedulePending} onClick={handleSaveSchedule}>
                      {isSchedulePending ? "שומר..." : "שמירה"}
                    </Button>
                    {draft.status === "DRAFT" && (
                      <Button
                        disabled={isPublishPending || draft.questions.length === 0}
                        onClick={handlePublish}
                      >
                        {isPublishPending ? "מפרסם..." : "פרסום"}
                      </Button>
                    )}
                    {draft.status === "PUBLISHED" && (
                      <Button variant="danger" disabled={isClosePending} onClick={handleClose}>
                        {isClosePending ? "סוגר..." : "סגירה"}
                      </Button>
                    )}
                  </div>
                  {draft.status === "DRAFT" && draft.questions.length === 0 && (
                    <p className="text-sm text-warning">אין שאלות בטופס - לא ניתן לפרסם</p>
                  )}
                  {publishError && <p className="text-sm text-danger">{publishError}</p>}
                  {publishSuccess && <p className="text-sm text-success">{publishSuccess}</p>}
                  {closeError && <p className="text-sm text-danger">{closeError}</p>}
                  {closeSuccess && <p className="text-sm text-success">{closeSuccess}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "results" && (
        <div className="flex flex-col gap-4">
          {!selectedFormId ? (
            <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              לא נבחר משוב. יש לבחור משוב מתוך &quot;רשימת משובים&quot;.
            </p>
          ) : isResultsLoading || !results ? (
            <p className="text-sm text-muted-foreground">טוען...</p>
          ) : (
            <>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <AvailabilityBadge form={results.form} />
                  <p className="text-base font-bold text-card-foreground">{results.form.title}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {results.form.weekName} ·{" "}
                  {weekRangeLabel(results.form.weekStartDate, results.form.weekEndDate)}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border bg-card p-4 text-center">
                  <p className="text-2xl font-bold text-card-foreground">
                    {results.summary.submittedCount} מתוך {results.summary.activeTraineeCount}
                  </p>
                  <p className="text-xs text-muted-foreground">חניכים הגישו</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 text-center">
                  <p className="text-2xl font-bold text-card-foreground">
                    {results.summary.notSubmittedCount}
                  </p>
                  <p className="text-xs text-muted-foreground">לא הגישו</p>
                </div>
              </div>

              <details className="rounded-xl border border-border bg-card p-4">
                <summary className="cursor-pointer text-sm font-bold text-card-foreground">
                  מי הגיש / מי לא הגיש
                </summary>
                <div className="mt-3 flex flex-col gap-4">
                  <div>
                    <p className="mb-1 text-xs font-semibold text-muted-foreground">
                      הגישו ({results.submittedTrainees.length})
                    </p>
                    {results.submittedTrainees.length === 0 ? (
                      <p className="text-sm text-muted-foreground">אין עדיין הגשות</p>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {results.submittedTrainees.map((t) => (
                          <li
                            key={t.studentId}
                            className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-1 text-sm last:border-0"
                          >
                            <span className="text-card-foreground">
                              {t.fullName}
                              {t.groupName ? ` · ${t.groupName}` : ""}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatHebrewDateTime(new Date(t.submittedAt))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold text-muted-foreground">
                      לא הגישו ({results.notSubmittedTrainees.length})
                    </p>
                    {results.notSubmittedTrainees.length === 0 ? (
                      <p className="text-sm text-muted-foreground">כל החניכים הפעילים הגישו</p>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {results.notSubmittedTrainees.map((t) => (
                          <li
                            key={t.studentId}
                            className="border-b border-border py-1 text-sm text-card-foreground last:border-0"
                          >
                            {t.fullName}
                            {t.groupName ? ` · ${t.groupName}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </details>

              <div className="flex flex-col gap-3">
                {Object.entries(
                  results.questionResults.reduce<Record<string, WeeklyFeedbackQuestionResult[]>>(
                    (acc, q) => {
                      (acc[q.section] ??= []).push(q);
                      return acc;
                    },
                    {}
                  )
                ).map(([section, questions]) => (
                  <div key={section} className="rounded-xl border border-border bg-card p-4">
                    <h3 className="mb-2 text-sm font-bold text-card-foreground">{section}</h3>
                    <div className="flex flex-col gap-3">
                      {questions.map((q) => (
                        <div key={q.questionId} className="border-b border-border pb-3 last:border-0 last:pb-0">
                          <p className="mb-1.5 text-sm font-semibold text-card-foreground">{q.prompt}</p>
                          {q.type === "FREE_TEXT" ? (
                            q.freeTextAnswers && q.freeTextAnswers.length > 0 ? (
                              <ul className="flex flex-col gap-1.5">
                                {q.freeTextAnswers.map((a, i) => (
                                  <li key={i} className="rounded-lg bg-muted p-2 text-sm">
                                    <p className="text-card-foreground">{a.text}</p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                      {a.studentName} · {formatHebrewDateTime(new Date(a.submittedAt))}
                                    </p>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-xs text-muted-foreground">אין תשובות</p>
                            )
                          ) : (
                            <div className="flex flex-wrap items-center gap-3">
                              {q.averageRating != null ? (
                                <span
                                  className={`rounded-full px-2.5 py-1 text-sm font-bold ${
                                    q.averageRating < 3
                                      ? "bg-danger-muted text-danger"
                                      : "bg-success-muted text-success"
                                  }`}
                                >
                                  ממוצע {q.averageRating.toFixed(1)}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">אין תשובות</span>
                              )}
                              {q.ratingDistribution && (
                                <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                                  {q.ratingDistribution.map((d) => (
                                    <span key={d.value} className="rounded-md bg-muted px-1.5 py-0.5">
                                      {d.value}: {d.count}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <span className="text-xs text-muted-foreground">
                                ({q.answerCount} תשובות)
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {results.traineeResponses.length > 0 && (
                <details className="rounded-xl border border-border bg-card p-4">
                  <summary className="cursor-pointer text-sm font-bold text-card-foreground">
                    תשובות לפי חניך ({results.traineeResponses.length})
                  </summary>
                  <div className="mt-3 flex flex-col gap-2">
                    {results.traineeResponses.map((tr) => (
                      <details key={tr.studentId} className="rounded-lg border border-border p-3">
                        <summary className="cursor-pointer text-sm font-semibold text-card-foreground">
                          {tr.studentName} · {formatHebrewDateTime(new Date(tr.submittedAt))}
                        </summary>
                        <div className="mt-2 flex flex-col gap-2">
                          {tr.answers.map((a) => (
                            <div key={a.questionId} className="border-b border-border pb-2 text-sm last:border-0">
                              <p className="text-xs text-muted-foreground">{a.section}</p>
                              <p className="font-medium text-card-foreground">{a.prompt}</p>
                              <p className="text-card-foreground">
                                {a.type === "FREE_TEXT" ? a.textValue || "—" : (a.ratingValue ?? "—")}
                              </p>
                            </div>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
