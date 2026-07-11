"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ParentSignatureStatusResult,
  ParentSignatureSubmitInput,
  ParentSignatureSubmitResult,
} from "@/lib/actions/parent-signatures";
import { ParentSignatureSignModal } from "@/lib/components/ParentSignatureSignModal";
import type { ParentSignatureFormTypeValue } from "@/lib/parent-signatures/types";

interface SigningTarget {
  childId: string;
  childName: string;
  childAge: number | null;
  parentName: string | null;
  parentPhone: string | null;
  formType: ParentSignatureFormTypeValue;
}

// Shared, read+sign presentation for the parent-signature status view - used
// by both the admin page and the instructor/tablet section, each of which
// only differs in which server actions fetch/submit (admin vs.
// instructor-permission-gated - see fetchStatus/submit props). Owns its own
// fetch lifecycle (including refetch-after-signing) so both callers stay
// thin wrappers that just bind their respective server actions.
export function ParentSignatureStatusList({
  fetchStatus,
  submit,
}: {
  fetchStatus: () => Promise<ParentSignatureStatusResult>;
  submit: (input: ParentSignatureSubmitInput) => Promise<ParentSignatureSubmitResult>;
}) {
  const [data, setData] = useState<ParentSignatureStatusResult | null>(null);
  const [search, setSearch] = useState("");
  const [signingTarget, setSigningTarget] = useState<SigningTarget | null>(null);

  const reload = useCallback(() => {
    fetchStatus().then(setData);
  }, [fetchStatus]);

  useEffect(() => {
    reload();
  }, [reload]);

  const filteredChildren = useMemo(() => {
    if (!data) return [];
    const trimmed = search.trim();
    if (!trimmed) return data.children;
    return data.children.filter(
      (child) =>
        child.childName.includes(trimmed) || (child.parentName?.includes(trimmed) ?? false)
    );
  }, [data, search]);

  if (data === null) {
    return <p className="text-base text-muted-foreground">טוען...</p>;
  }

  if (data.children.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
        אין כרגע ילדים משובצים להתנסויות מתחילים.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold text-muted-foreground">מחזור: {data.courseCycle}</p>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="חיפוש לפי שם ילד/ה או הורה..."
        className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-card-foreground placeholder:text-muted-foreground"
      />

      {filteredChildren.length === 0 ? (
        <p className="text-sm text-muted-foreground">לא נמצאו ילדים תואמים לחיפוש.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredChildren.map((child) => (
            <div key={child.childId} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-base font-bold text-card-foreground">
                    {child.childName}
                    {child.childAge != null && (
                      <span className="font-normal text-muted-foreground"> · גיל {child.childAge}</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {child.parentName ?? "אין שם הורה"}
                    {child.parentPhone ? ` · ${child.parentPhone}` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                    child.isCleared
                      ? "bg-success-muted text-success"
                      : "bg-warning-muted text-warning"
                  }`}
                >
                  {child.isCleared ? "חתום" : `חסרים ${child.missingCount}`}
                </span>
              </div>

              <div className="mt-3 flex flex-col gap-2">
                {child.requiredForms.map((form) => (
                  <div
                    key={form.formType}
                    className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-3 py-2"
                  >
                    <span
                      className={`text-xs font-semibold ${
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
                        className="shrink-0 rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90"
                      >
                        חתימה
                      </button>
                    ) : (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {form.signedAt ? new Date(form.signedAt).toLocaleDateString("he-IL") : ""}
                      </span>
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
    </div>
  );
}
