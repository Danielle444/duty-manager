"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import {
  getOpenWeeklyFeedbackForStudent,
  submitWeeklyFeedback,
  type FeedbackQuestionTypeValue,
  type WeeklyFeedbackAnswerInput,
  type WeeklyFeedbackForStudent,
  type WeeklyFeedbackQuestionForStudent,
} from "@/lib/actions/weekly-feedback";

interface AnswerDraft {
  ratingValue: number | null;
  textValue: string;
}

function ratingRange(type: FeedbackQuestionTypeValue): number[] {
  return type === "COMPARISON_3" ? [1, 2, 3] : [1, 2, 3, 4, 5];
}

export function StudentWeeklyFeedbackSection({
  studentId,
  onOpenChange,
}: {
  studentId: string;
  // Reports whether there's currently an open, unanswered form, so a parent
  // component can keep its own "עוד"/menu-row dot in sync immediately after
  // this loads or after a submit, without a second fetch - same pattern as
  // NotificationsList's onUnreadChange.
  onOpenChange?: (isOpen: boolean) => void;
}) {
  const [data, setData] = useState<WeeklyFeedbackForStudent | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerDraft>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, startSubmitTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getOpenWeeklyFeedbackForStudent(studentId).then((result) => {
      if (cancelled) return;
      setData(result);
      if (result.status === "open") {
        const initial: Record<string, AnswerDraft> = {};
        for (const q of result.questions) {
          initial[q.id] = { ratingValue: null, textValue: "" };
        }
        setAnswers(initial);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  useEffect(() => {
    if (data) onOpenChange?.(data.status === "open");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  function handleSetRating(questionId: string, value: number) {
    setSubmitError(null);
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], ratingValue: value } }));
  }

  function handleSetText(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], textValue: value } }));
  }

  function handleSubmit() {
    if (!data || data.status !== "open") return;
    const { formId, formTitle, questions } = data;

    const hasMissingRequired = questions.some((q) => {
      if (!q.isRequired) return false;
      if (q.type === "FREE_TEXT") return !answers[q.id]?.textValue?.trim();
      return answers[q.id]?.ratingValue == null;
    });
    if (hasMissingRequired) {
      setSubmitError("יש למלא את כל שאלות החובה");
      return;
    }

    setSubmitError(null);
    startSubmitTransition(async () => {
      const answerInputs: WeeklyFeedbackAnswerInput[] = questions.map((q) => ({
        questionId: q.id,
        ratingValue: answers[q.id]?.ratingValue ?? null,
        textValue: answers[q.id]?.textValue || null,
      }));
      const result = await submitWeeklyFeedback(studentId, formId, answerInputs);
      if (!result.success) {
        setSubmitError(result.error ?? "אירעה שגיאה");
        return;
      }
      setData({ status: "submitted", formTitle, submittedAt: new Date().toISOString() });
    });
  }

  if (data === null) {
    return <p className="text-base text-muted-foreground">טוען...</p>;
  }

  if (data.status === "none") {
    return (
      <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
        אין כרגע משוב פתוח
      </p>
    );
  }

  if (data.status === "submitted") {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <p className="text-lg font-bold text-card-foreground">תודה, המשוב הוגש</p>
        <p className="mt-1 text-sm text-muted-foreground">{data.formTitle}</p>
      </div>
    );
  }

  const grouped = data.questions.reduce<Record<string, WeeklyFeedbackQuestionForStudent[]>>((acc, q) => {
    (acc[q.section] ??= []).push(q);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="text-lg font-bold text-card-foreground">{data.formTitle}</p>
      </div>

      {Object.entries(grouped).map(([section, questions]) => (
        <div key={section} className="rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-3 text-base font-bold text-card-foreground">{section}</h3>
          <div className="flex flex-col gap-4">
            {questions.map((q) => (
              <div key={q.id} className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-card-foreground">
                  {q.prompt}
                  {!q.isRequired && <span className="mr-1.5 text-xs font-normal text-muted-foreground">רשות</span>}
                </p>
                {q.type === "FREE_TEXT" ? (
                  <textarea
                    value={answers[q.id]?.textValue ?? ""}
                    onChange={(e) => handleSetText(q.id, e.target.value)}
                    rows={3}
                    className="w-full rounded-xl border border-border px-3 py-2 text-sm"
                  />
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex gap-2">
                      {ratingRange(q.type).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => handleSetRating(q.id, value)}
                          className={`flex h-11 w-11 items-center justify-center rounded-full border text-base font-bold transition-colors ${
                            answers[q.id]?.ratingValue === value
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-card text-card-foreground active:bg-muted"
                          }`}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                    {q.type === "COMPARISON_3" && (
                      <p className="text-xs text-muted-foreground">
                        1 = פחות טוב · 2 = ללא שינוי · 3 = השתפר
                      </p>
                    )}
                    {q.type === "RATING_5" && (
                      <p className="text-xs text-muted-foreground">
                        1 = לא טוב / במידה נמוכה · 5 = טוב מאוד / במידה גבוהה
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {submitError && <p className="text-sm text-danger">{submitError}</p>}

      <Button disabled={isSubmitting} onClick={handleSubmit} className="!py-3 !text-base">
        {isSubmitting ? "שולח/ת..." : "שליחת המשוב"}
      </Button>
    </div>
  );
}
