"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/lib/components/Modal";
import { Button } from "@/lib/components/Button";
import { formatHebrewDateTime } from "@/lib/dates";
import { FORM_TYPE_SHORT_LABEL } from "@/lib/parent-signatures/form-definitions";
import type { ParentSignatureViewerData } from "@/lib/actions/parent-signatures";

// Stage 4 alternative: reconstructs the signed form on screen from its
// stored field snapshots + the same versioned content used at signing time
// (lib/parent-signatures/form-definitions.ts) - no PDF anywhere. Shared by
// both the instructor/tablet and admin entry points via the `fetchData`
// prop, same DI pattern as ParentSignatureSignModal's `submit` prop.
export function ParentSignatureViewModal({
  open,
  onClose,
  signedFormId,
  fetchData,
}: {
  open: boolean;
  onClose: () => void;
  signedFormId: string;
  fetchData: (signedFormId: string) => Promise<ParentSignatureViewerData | null>;
}) {
  const [data, setData] = useState<ParentSignatureViewerData | null | undefined>(undefined);

  // The parent only ever mounts this component while a form is being
  // viewed (`{viewingFormId && <ParentSignatureViewModal ... />}`) and
  // unmounts it entirely on close, so every open is a fresh mount - no need
  // to reset `data` back to `undefined` here, it already starts that way.
  useEffect(() => {
    let cancelled = false;
    fetchData(signedFormId).then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [signedFormId, fetchData]);

  return (
    <Modal
      open={open}
      title={data ? FORM_TYPE_SHORT_LABEL[data.formType] : "טופס חתום"}
      onClose={onClose}
      size="wide"
    >
      {data === undefined ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : data === null ? (
        <p className="text-sm text-danger">הטופס אינו זמין לצפייה (ייתכן שבוטל).</p>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          {/* Print-only override, scoped to this one element's subtree:
              forces black-on-white regardless of the site's (possibly dark)
              theme, since the individual text/background utility classes
              below (text-muted-foreground, bg-card, etc.) are per-element
              and wouldn't otherwise be overridden by a color set on an
              ancestor. The signature <img> itself is unaffected - `color`
              doesn't touch image pixels, and `background: transparent` only
              strips a plain background box, not the image content. */}
          <style>{`
            @media print {
              #parent-signature-print-area,
              #parent-signature-print-area * {
                color: #000 !important;
                background: transparent !important;
                border-color: #999 !important;
              }
              #parent-signature-print-area {
                background: #fff !important;
              }
            }
          `}</style>
          <div
            id="parent-signature-print-area"
            className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1 print:max-h-none print:w-full print:max-w-none print:overflow-visible print:bg-white print:p-8"
          >
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <p className="font-bold text-card-foreground">
                {data.childNameSnapshot}
                {data.childAgeSnapshot != null && (
                  <span className="font-normal text-muted-foreground"> · גיל {data.childAgeSnapshot}</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {data.parentNameSnapshot ?? "אין שם הורה"}
                {data.parentPhoneSnapshot ? ` · ${data.parentPhoneSnapshot}` : ""}
              </p>
            </div>

            <div className="flex flex-col gap-2 text-card-foreground">
              <h3 className="text-base font-bold">{data.content.title}</h3>
              {data.content.introSections.map((section, idx) => (
                <div key={idx} className="flex flex-col gap-1">
                  {section.paragraphs?.map((p, pIdx) => (
                    <p key={pIdx} className="leading-relaxed text-muted-foreground">
                      {p}
                    </p>
                  ))}
                  {section.bullets && (
                    <ul className="list-inside list-disc leading-relaxed text-muted-foreground">
                      {section.bullets.map((b, bIdx) => (
                        <li key={bIdx}>{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
              {data.address && (
                <p>
                  <span className="font-semibold text-card-foreground">כתובת: </span>
                  {data.address}
                </p>
              )}
              {data.parentEmail && (
                <p>
                  <span className="font-semibold text-card-foreground">כתובת מייל: </span>
                  {data.parentEmail}
                </p>
              )}
              {data.medicalNotes && (
                <p>
                  <span className="font-semibold text-card-foreground">הערות רפואיות: </span>
                  {data.medicalNotes}
                </p>
              )}
              {data.photoConsent !== null && (
                <p>
                  <span className="font-semibold text-card-foreground">הסכמה לצילום: </span>
                  {data.photoConsent ? "מסכים/ה" : "לא מסכים/ה"}
                </p>
              )}
            </div>

            {data.content.consentStatements.map((statement) => (
              <p key={statement.key} className="text-card-foreground">
                {statement.text}
              </p>
            ))}

            <div className="rounded-xl border border-border p-3">
              <p>
                <span className="font-semibold text-card-foreground">שם החותם/ת: </span>
                {data.signerName}
              </p>
              {data.signerRole && (
                <p>
                  <span className="font-semibold text-card-foreground">תפקיד החותם/ת: </span>
                  {data.signerRole}
                </p>
              )}
              <p>
                <span className="font-semibold text-card-foreground">תאריך חתימה: </span>
                {formatHebrewDateTime(new Date(data.signedAt))}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <p className="font-semibold text-card-foreground">חתימה</p>
              {data.signatureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL from Supabase Storage, not a local/optimizable asset
                <img
                  src={data.signatureUrl}
                  alt={`חתימת ${data.signerName}`}
                  className="h-40 w-full max-w-md rounded-xl border border-border bg-white object-contain"
                />
              ) : (
                <p className="text-xs text-muted-foreground">תמונת החתימה אינה זמינה כרגע.</p>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground">
              גרסת טופס: {data.formVersion} · מחזור: {data.courseCycle}
            </p>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3 print:hidden">
            <Button type="button" variant="secondary" onClick={onClose}>
              סגירה
            </Button>
            <Button type="button" onClick={() => window.print()}>
              הדפסה / שמירה כ-PDF
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
