"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ParentSignatureStatusResult,
  ParentSignatureSubmitInput,
  ParentSignatureSubmitResult,
  ParentSignatureViewerData,
} from "@/lib/actions/parent-signatures";
import { ParentSignatureSignModal } from "@/lib/components/ParentSignatureSignModal";
import { ParentSignatureViewModal } from "@/lib/components/ParentSignatureViewModal";
import type { ParentSignatureFormTypeValue } from "@/lib/parent-signatures/types";
import type { ParentSignatureTeachingPracticeContext } from "@/lib/parent-signatures/status";

interface SigningTarget {
  childId: string;
  childName: string;
  childAge: number | null;
  parentName: string | null;
  parentPhone: string | null;
  formType: ParentSignatureFormTypeValue;
}

// Compact "label · d.m · HH:MM · חניכים: ..." navigation hint - status-list
// display only, entirely separate from the signed form/printed form (which
// never read this). Any piece missing (no lesson time yet, no participants
// assigned yet) is just dropped from the line rather than shown as blank.
function formatTeachingPracticeContext(ctx: ParentSignatureTeachingPracticeContext): string {
  const parts = [ctx.label];
  if (ctx.firstLessonDate) {
    const [, month, day] = ctx.firstLessonDate.split("-");
    parts.push(`${Number(day)}.${Number(month)}`);
  }
  if (ctx.firstLessonStartTime) {
    parts.push(ctx.firstLessonStartTime);
  }
  if (ctx.traineeNames.length > 0) {
    parts.push(`חניכים: ${ctx.traineeNames.join(", ")}`);
  }
  return parts.join(" · ");
}

// Shared, read+sign+view presentation for the parent-signature status view -
// used by both the admin page and the instructor/tablet section, each of
// which only differs in which server actions fetch/submit/view (admin vs.
// instructor-permission-gated - see fetchStatus/submit/viewSignedForm
// props). Owns its own fetch lifecycle (including refetch-after-signing) so
// both callers stay thin wrappers that just bind their respective server
// actions.
export function ParentSignatureStatusList({
  fetchStatus,
  submit,
  viewSignedForm,
}: {
  fetchStatus: () => Promise<ParentSignatureStatusResult>;
  submit: (input: ParentSignatureSubmitInput) => Promise<ParentSignatureSubmitResult>;
  viewSignedForm: (signedFormId: string) => Promise<ParentSignatureViewerData | null>;
}) {
  const [data, setData] = useState<ParentSignatureStatusResult | null>(null);
  const [search, setSearch] = useState("");
  const [scheduleFilter, setScheduleFilter] = useState<"ALL" | "UNSCHEDULED">("ALL");
  const [signingTarget, setSigningTarget] = useState<SigningTarget | null>(null);
  const [viewingFormId, setViewingFormId] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchStatus().then(setData);
  }, [fetchStatus]);

  useEffect(() => {
    reload();
  }, [reload]);

  const filteredChildren = useMemo(() => {
    if (!data) return [];
    const trimmed = search.trim();
    return data.children.filter((child) => {
      if (scheduleFilter === "UNSCHEDULED" && !child.isUnscheduled) return false;
      if (!trimmed) return true;
      return child.childName.includes(trimmed) || (child.parentName?.includes(trimmed) ?? false);
    });
  }, [data, search, scheduleFilter]);

  if (data === null) {
    return <p className="text-base text-muted-foreground">טוען...</p>;
  }

  if (data.children.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
        אין כרגע ילדי התנסות פעילים במערכת.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-semibold text-muted-foreground">מחזור: {data.courseCycle}</p>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="חיפוש לפי שם ילד/ה או הורה..."
        className="rounded-xl border border-border bg-card px-4 py-3 text-base text-card-foreground placeholder:text-muted-foreground"
      />

      <div className="flex gap-2">
        {(
          [
            { value: "ALL", label: "הכל" },
            { value: "UNSCHEDULED", label: "ללא שיבוץ" },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setScheduleFilter(option.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              scheduleFilter === option.value
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {filteredChildren.length === 0 ? (
        <p className="text-base text-muted-foreground">לא נמצאו ילדים תואמים לחיפוש.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {filteredChildren.map((child) => (
            <div key={child.childId} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold text-card-foreground md:text-xl">
                    {child.childName}
                    {child.childAge != null && (
                      <span className="font-normal text-muted-foreground"> · גיל {child.childAge}</span>
                    )}
                    {child.isUnscheduled && (
                      <span className="mr-2 rounded-full bg-muted px-2.5 py-0.5 align-middle text-xs font-semibold text-muted-foreground">
                        ללא שיבוץ
                      </span>
                    )}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {child.parentName ?? "אין שם הורה"}
                    {child.parentPhone ? ` · ${child.parentPhone}` : ""}
                  </p>
                  {child.teachingPracticeContexts.length > 0 && (
                    <div className="mt-1 flex flex-col gap-0.5">
                      {child.teachingPracticeContexts.map((ctx) => (
                        <p key={ctx.practiceType} className="truncate text-xs text-muted-foreground">
                          {formatTeachingPracticeContext(ctx)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-bold ${
                    child.isCleared
                      ? "bg-success-muted text-success"
                      : "bg-warning-muted text-warning"
                  }`}
                >
                  {child.isCleared ? "חתום" : `חסרים ${child.missingCount}`}
                </span>
              </div>

              <div className="mt-4 flex flex-col gap-3">
                {child.requiredForms.map((form) => (
                  <div
                    key={form.formType}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 px-4 py-3"
                  >
                    <span
                      className={`text-sm font-semibold md:text-base ${
                        form.status === "SIGNED" ? "text-success" : "text-warning"
                      }`}
                    >
                      {form.title} · {form.status === "SIGNED" ? "חתום" : "חסר"}
                    </span>
                    {form.status === "MISSING" ? (
                      <button
                        type="button"
                        onClick={() =>
                          setSigningTarget({
                            childId: child.childId,
                            childName: child.childName,
                            childAge: child.childAge,
                            parentName: child.parentName,
                            parentPhone: child.parentPhone,
                            formType: form.formType,
                          })
                        }
                        className="shrink-0 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 md:text-base"
                      >
                        חתימה
                      </button>
                    ) : (
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {form.signedAt ? new Date(form.signedAt).toLocaleDateString("he-IL") : ""}
                        </span>
                        {form.signedFormId && (
                          <button
                            type="button"
                            onClick={() => setViewingFormId(form.signedFormId)}
                            className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-card-foreground hover:bg-muted md:text-base"
                          >
                            צפייה בטופס חתום
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {signingTarget && (
        <ParentSignatureSignModal
          open
          onClose={() => setSigningTarget(null)}
          onSigned={reload}
          child={{
            childId: signingTarget.childId,
            childName: signingTarget.childName,
            childAge: signingTarget.childAge,
            parentName: signingTarget.parentName,
            parentPhone: signingTarget.parentPhone,
          }}
          formType={signingTarget.formType}
          submit={submit}
        />
      )}

      {viewingFormId && (
        <ParentSignatureViewModal
          open
          onClose={() => setViewingFormId(null)}
          signedFormId={viewingFormId}
          fetchData={viewSignedForm}
        />
      )}
    </div>
  );
}
