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
  suggestWeeklyFeedbackQuestionsFromSchedule,
  updateWeeklyFeedbackQuestion,
  updateWeeklyFeedbackSchedule,
  type EditableFeedbackQuestionTypeValue,
  type FeedbackQuestionTypeValue,
  type WeeklyFeedbackDraft,
  type WeeklyFeedbackDraftQuestion,
  type WeeklyFeedbackFormListItem,
  type WeeklyFeedbackFreeTextAnswer,
  type WeeklyFeedbackNotSubmittedTrainee,
  type WeeklyFeedbackQuestionResult,
  type WeeklyFeedbackRatingDistributionEntry,
  type WeeklyFeedbackResults,
  type WeeklyFeedbackStatusValue,
  type WeeklyFeedbackSubmittedTrainee,
  type WeeklyFeedbackSuggestedQuestion,
  type WeeklyFeedbackTraineeResponse,
} from "@/lib/actions/weekly-feedback";
import type { WeeklyScheduleOption } from "@/lib/actions/weekly-schedule";
import { formatHebrewDate, formatHebrewDateTime, parseDateKey } from "@/lib/dates";
import { downloadCsv } from "@/lib/csv";
import {
  buildWeeklyFeedbackExportFilename,
  buildWeeklyFeedbackNotSubmittedCsv,
  buildWeeklyFeedbackQuestionSummaryCsv,
  buildWeeklyFeedbackResponsesCsv,
} from "@/lib/exports/weekly-feedback-csv";

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
  COMPARISON_3: "השוואה לשבוע קודם 1–3",
  FREE_TEXT: "טקסט חופשי",
};

// All three types may be assigned via the draft-editing UI - COMPARISON_3 is
// never part of FIXED_QUESTION_TEMPLATE itself (see its doc comment in
// weekly-feedback.ts), but admins can add/edit it manually per week here.
const EDITABLE_TYPE_OPTIONS: EditableFeedbackQuestionTypeValue[] = ["RATING_5", "COMPARISON_3", "FREE_TEXT"];

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

function matchesGroupSubgroupFilter(
  groupName: string | null,
  subgroupNumber: number | null,
  groupFilter: string,
  subgroupFilter: string
): boolean {
  if (groupFilter && groupName !== groupFilter) return false;
  if (subgroupFilter && String(subgroupNumber ?? "") !== subgroupFilter) return false;
  return true;
}

// Recomputes per-question aggregates from a (possibly filtered) set of
// traineeResponses, rather than trusting getWeeklyFeedbackResults'
// questionResults (which always reflects every response, unfiltered) - the
// math mirrors the server's own averageRating/ratingDistribution/
// freeTextAnswers logic exactly, since traineeResponses already carries
// every answer needed and no new query is required. Question metadata
// (section/prompt/type/sortOrder) is reused as-is from questionResults.
function computeQuestionResults(
  questionMetas: WeeklyFeedbackQuestionResult[],
  traineeResponses: WeeklyFeedbackTraineeResponse[]
): WeeklyFeedbackQuestionResult[] {
  return questionMetas.map((meta) => {
    const answers = traineeResponses
      .map((tr) => tr.answers.find((a) => a.questionId === meta.questionId))
      .filter((a): a is NonNullable<typeof a> => a != null);

    if (meta.type === "FREE_TEXT") {
      const freeTextAnswers: WeeklyFeedbackFreeTextAnswer[] = traineeResponses.flatMap((tr) => {
        const answer = tr.answers.find((a) => a.questionId === meta.questionId);
        if (!answer?.textValue || answer.textValue.trim() === "") return [];
        return [
          {
            studentId: tr.studentId,
            studentName: tr.studentName,
            submittedAt: tr.submittedAt,
            text: answer.textValue,
          },
        ];
      });
      return {
        ...meta,
        answerCount: freeTextAnswers.length,
        averageRating: null,
        ratingDistribution: null,
        freeTextAnswers,
      };
    }

    const ratings = answers.map((a) => a.ratingValue).filter((v): v is number => v != null);
    const maxValue = meta.type === "COMPARISON_3" ? 3 : 5;
    const ratingDistribution: WeeklyFeedbackRatingDistributionEntry[] = Array.from(
      { length: maxValue },
      (_, i) => ({ value: i + 1, count: ratings.filter((r) => r === i + 1).length })
    );

    return {
      ...meta,
      answerCount: ratings.length,
      averageRating: ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : null,
      ratingDistribution,
      freeTextAnswers: null,
    };
  });
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

  // null = not loaded yet (button not clicked), [] = loaded and empty.
  const [suggestions, setSuggestions] = useState<WeeklyFeedbackSuggestedQuestion[] | null>(null);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [selectedSuggestionIndexes, setSelectedSuggestionIndexes] = useState<Set<number>>(new Set());
  const [isAddingSuggestions, startAddSuggestionsTransition] = useTransition();

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

  function handleLoadSuggestions() {
    if (!draft) return;
    setSuggestionsError(null);
    setIsSuggestionsLoading(true);
    suggestWeeklyFeedbackQuestionsFromSchedule(draft.id).then((result) => {
      setIsSuggestionsLoading(false);
      if (!result.success) {
        setSuggestionsError(result.error);
        setSuggestions(null);
        return;
      }
      setSuggestions(result.suggestions);
      setSelectedSuggestionIndexes(new Set());
    });
  }

  function toggleSuggestionSelected(index: number) {
    setSelectedSuggestionIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  // Adds the selected suggestions one at a time (not in parallel) by
  // reusing addWeeklyFeedbackQuestion as-is - sequential calls keep its own
  // maxSortOrder-from-current-questions logic correct, which a parallel
  // Promise.all could race.
  function handleAddSelectedSuggestions() {
    if (!draft || !suggestions) return;
    const toAdd = suggestions.filter((_, i) => selectedSuggestionIndexes.has(i));
    if (toAdd.length === 0) return;
    setSuggestionsError(null);
    startAddSuggestionsTransition(async () => {
      for (const suggestion of toAdd) {
        const result = await addWeeklyFeedbackQuestion(
          draft.id,
          suggestion.section,
          suggestion.prompt,
          suggestion.type
        );
        if (!result.success) {
          setSuggestionsError(result.error ?? "אירעה שגיאה בהוספת אחת ההצעות");
          break;
        }
      }
      await refreshDraft();
      setSuggestions(null);
      setSelectedSuggestionIndexes(new Set());
    });
  }

  function startEditQuestion(question: WeeklyFeedbackDraftQuestion) {
    setEditingQuestionId(question.id);
    setEditSection(question.section);
    setEditPrompt(question.prompt);
    setEditType(question.type);
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
  const [resultsGroupFilter, setResultsGroupFilter] = useState("");
  const [resultsSubgroupFilter, setResultsSubgroupFilter] = useState("");

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

  // Resets the group/subgroup filters whenever a different form is selected
  // (not on every tab toggle) - otherwise a filter chosen for one form could
  // silently carry over to another form that has no such group at all,
  // looking like "no data" rather than a stale filter.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResultsGroupFilter("");
    setResultsSubgroupFilter("");
  }, [selectedFormId]);

  const groupOptions = useMemo(() => {
    if (!results) return [];
    const names = new Set<string>();
    for (const t of results.submittedTrainees) if (t.groupName) names.add(t.groupName);
    for (const t of results.notSubmittedTrainees) if (t.groupName) names.add(t.groupName);
    return Array.from(names).sort((a, b) => a.localeCompare(b, "he"));
  }, [results]);

  const subgroupOptions = useMemo(() => {
    if (!results) return [];
    const numbers = new Set<number>();
    const consider = (t: { groupName: string | null; subgroupNumber: number | null }) => {
      if (resultsGroupFilter && t.groupName !== resultsGroupFilter) return;
      if (t.subgroupNumber != null) numbers.add(t.subgroupNumber);
    };
    results.submittedTrainees.forEach(consider);
    results.notSubmittedTrainees.forEach(consider);
    return Array.from(numbers).sort((a, b) => a - b);
  }, [results, resultsGroupFilter]);

  const filteredSubmittedTrainees: WeeklyFeedbackSubmittedTrainee[] = useMemo(() => {
    if (!results) return [];
    return results.submittedTrainees.filter((t) =>
      matchesGroupSubgroupFilter(t.groupName, t.subgroupNumber, resultsGroupFilter, resultsSubgroupFilter)
    );
  }, [results, resultsGroupFilter, resultsSubgroupFilter]);

  const filteredNotSubmittedTrainees: WeeklyFeedbackNotSubmittedTrainee[] = useMemo(() => {
    if (!results) return [];
    return results.notSubmittedTrainees.filter((t) =>
      matchesGroupSubgroupFilter(t.groupName, t.subgroupNumber, resultsGroupFilter, resultsSubgroupFilter)
    );
  }, [results, resultsGroupFilter, resultsSubgroupFilter]);

  // Active trainees remain the denominator, same as the unfiltered summary -
  // just recomputed from the already-filtered lists: filteredNotSubmittedTrainees
  // is active-only by construction (from activeStudents), and filteredSubmittedTrainees
  // is narrowed to isActive here for the same reason.
  const filteredSummary = useMemo(() => {
    const activeSubmittedCount = filteredSubmittedTrainees.filter((t) => t.isActive).length;
    return {
      activeTraineeCount: activeSubmittedCount + filteredNotSubmittedTrainees.length,
      submittedCount: activeSubmittedCount,
      notSubmittedCount: filteredNotSubmittedTrainees.length,
    };
  }, [filteredSubmittedTrainees, filteredNotSubmittedTrainees]);

  // traineeResponses has no group/subgroup of its own - every studentId in it
  // also appears in submittedTrainees (both derived from the same
  // form.responses), so that list doubles as the lookup for filtering here.
  const filteredTraineeResponses: WeeklyFeedbackTraineeResponse[] = useMemo(() => {
    if (!results) return [];
    const infoById = new Map(results.submittedTrainees.map((t) => [t.studentId, t]));
    return results.traineeResponses.filter((tr) => {
      const info = infoById.get(tr.studentId);
      if (!info) return true;
      return matchesGroupSubgroupFilter(
        info.groupName,
        info.subgroupNumber,
        resultsGroupFilter,
        resultsSubgroupFilter
      );
    });
  }, [results, resultsGroupFilter, resultsSubgroupFilter]);

  const filteredQuestionResults: WeeklyFeedbackQuestionResult[] = useMemo(() => {
    if (!results) return [];
    return computeQuestionResults(results.questionResults, filteredTraineeResponses);
  }, [results, filteredTraineeResponses]);

  const resultsFilterSummaryLabel = !resultsGroupFilter
    ? "כל החניכים"
    : resultsSubgroupFilter
      ? `קבוצה ${resultsGroupFilter} · תת-קבוצה ${resultsSubgroupFilter}`
      : `קבוצה ${resultsGroupFilter}`;

  // Exports run entirely client-side from the already-loaded/filtered
  // results state - no server round-trip, nothing uploaded or stored. Each
  // respects whatever group/subgroup filter is currently selected, exactly
  // like the on-screen lists/aggregates above.
  function handleExportResponses() {
    if (!results) return;
    const csv = buildWeeklyFeedbackResponsesCsv(results, filteredTraineeResponses, filteredSubmittedTrainees);
    const filename = buildWeeklyFeedbackExportFilename(
      "תשובות",
      results.form.title,
      resultsGroupFilter,
      resultsSubgroupFilter
    );
    downloadCsv(filename, csv);
  }

  function handleExportQuestionSummary() {
    if (!results) return;
    const csv = buildWeeklyFeedbackQuestionSummaryCsv(filteredQuestionResults);
    const filename = buildWeeklyFeedbackExportFilename(
      "סיכום-שאלות",
      results.form.title,
      resultsGroupFilter,
      resultsSubgroupFilter
    );
    downloadCsv(filename, csv);
  }

  function handleExportNotSubmitted() {
    if (!results) return;
    const csv = buildWeeklyFeedbackNotSubmittedCsv(filteredNotSubmittedTrainees);
    const filename = buildWeeklyFeedbackExportFilename(
      "לא-הגישו",
      results.form.title,
      resultsGroupFilter,
      resultsSubgroupFilter
    );
    downloadCsv(filename, csv);
  }

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
                                disabled={isQuestionMutating}
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

              {isQuestionsEditable(draft) && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-card-foreground">הצעת שאלות מהלו&quot;ז</h3>
                    <Button
                      variant="secondary"
                      className="!px-3 !py-1.5 !text-sm"
                      disabled={isSuggestionsLoading}
                      onClick={handleLoadSuggestions}
                    >
                      {isSuggestionsLoading ? "טוען הצעות..." : "הצעת שאלות מהלו״ז"}
                    </Button>
                  </div>

                  {suggestionsError && <p className="mb-2 text-sm text-danger">{suggestionsError}</p>}

                  {suggestions !== null &&
                    (suggestions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        לא נמצאו הצעות שאלות מהלו&quot;ז לשבוע זה
                      </p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {suggestions.map((s, i) => (
                          <label
                            key={i}
                            className="flex items-start gap-2 rounded-lg border border-border p-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={selectedSuggestionIndexes.has(i)}
                              onChange={() => toggleSuggestionSelected(i)}
                              className="mt-1"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold text-card-foreground">{s.prompt}</span>
                              <span className="block text-xs text-muted-foreground">
                                {s.section} · {TYPE_LABELS[s.type]}
                              </span>
                              <span className="block text-xs text-muted-foreground">מקור: {s.sourceLabel}</span>
                            </span>
                          </label>
                        ))}
                        <Button
                          className="self-start"
                          disabled={isAddingSuggestions || selectedSuggestionIndexes.size === 0}
                          onClick={handleAddSelectedSuggestions}
                        >
                          {isAddingSuggestions
                            ? "מוסיף..."
                            : `הוספת הנבחרות (${selectedSuggestionIndexes.size})`}
                        </Button>
                      </div>
                    ))}
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

              <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
                <label className="flex flex-col gap-1 text-sm">
                  קבוצה
                  <select
                    value={resultsGroupFilter}
                    onChange={(e) => {
                      setResultsGroupFilter(e.target.value);
                      setResultsSubgroupFilter("");
                    }}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <option value="">כל הקבוצות</option>
                    {groupOptions.map((g) => (
                      <option key={g} value={g}>
                        קבוצה {g}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  תת-קבוצה
                  <select
                    value={resultsSubgroupFilter}
                    onChange={(e) => setResultsSubgroupFilter(e.target.value)}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <option value="">כל תתי-הקבוצות</option>
                    {subgroupOptions.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-xs text-muted-foreground">מציג נתונים עבור: {resultsFilterSummaryLabel}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" className="!text-sm" onClick={handleExportResponses}>
                  ייצוא תשובות
                </Button>
                <Button variant="secondary" className="!text-sm" onClick={handleExportQuestionSummary}>
                  ייצוא סיכום שאלות
                </Button>
                <Button variant="secondary" className="!text-sm" onClick={handleExportNotSubmitted}>
                  ייצוא לא הגישו
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border bg-card p-4 text-center">
                  <p className="text-2xl font-bold text-card-foreground">
                    {filteredSummary.submittedCount} מתוך {filteredSummary.activeTraineeCount}
                  </p>
                  <p className="text-xs text-muted-foreground">חניכים הגישו</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 text-center">
                  <p className="text-2xl font-bold text-card-foreground">
                    {filteredSummary.notSubmittedCount}
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
                      הגישו ({filteredSubmittedTrainees.length})
                    </p>
                    {filteredSubmittedTrainees.length === 0 ? (
                      <p className="text-sm text-muted-foreground">אין עדיין הגשות</p>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {filteredSubmittedTrainees.map((t) => (
                          <li
                            key={t.studentId}
                            className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-1 text-sm last:border-0"
                          >
                            <span className="text-card-foreground">
                              {t.fullName}
                              {t.groupName ? ` · ${t.groupName}` : ""}
                              {t.subgroupNumber != null ? ` · תת-קבוצה ${t.subgroupNumber}` : ""}
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
                      לא הגישו ({filteredNotSubmittedTrainees.length})
                    </p>
                    {filteredNotSubmittedTrainees.length === 0 ? (
                      <p className="text-sm text-muted-foreground">כל החניכים הפעילים הגישו</p>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {filteredNotSubmittedTrainees.map((t) => (
                          <li
                            key={t.studentId}
                            className="border-b border-border py-1 text-sm text-card-foreground last:border-0"
                          >
                            {t.fullName}
                            {t.groupName ? ` · ${t.groupName}` : ""}
                            {t.subgroupNumber != null ? ` · תת-קבוצה ${t.subgroupNumber}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </details>

              <div className="flex flex-col gap-3">
                {Object.entries(
                  filteredQuestionResults.reduce<Record<string, WeeklyFeedbackQuestionResult[]>>(
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
                                    // COMPARISON_3's midpoint (2 = "ללא שינוי") is the neutral
                                    // value, unlike RATING_5's midpoint - a plain "< 3" threshold
                                    // would wrongly flag a neutral 2.0 average as low/bad.
                                    q.averageRating < (q.type === "COMPARISON_3" ? 2 : 3)
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

              {filteredTraineeResponses.length > 0 && (
                <details className="rounded-xl border border-border bg-card p-4">
                  <summary className="cursor-pointer text-sm font-bold text-card-foreground">
                    תשובות לפי חניך ({filteredTraineeResponses.length})
                  </summary>
                  <div className="mt-3 flex flex-col gap-2">
                    {filteredTraineeResponses.map((tr) => (
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
