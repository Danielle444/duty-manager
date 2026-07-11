"use client";

import { useRef, useState, useTransition } from "react";
import { Modal } from "@/lib/components/Modal";
import { Button } from "@/lib/components/Button";
import { SignatureCanvas, type SignatureCanvasHandle } from "@/lib/components/SignatureCanvas";
import { getFormContent, CURRENT_FORM_VERSION, FORM_TYPE_SHORT_LABEL } from "@/lib/parent-signatures/form-definitions";
import type { ParentSignatureFormTypeValue } from "@/lib/parent-signatures/types";
import type {
  ParentSignatureSubmitInput,
  ParentSignatureSubmitResult,
} from "@/lib/actions/parent-signatures";

interface ChildPrefill {
  childId: string;
  childName: string;
  childAge: number | null;
  parentName: string | null;
  parentPhone: string | null;
}

// Shared by both the instructor/tablet and admin entry points - each passes
// its own `submit` (bound to submitTeachingPracticeSignedFormAsInstructor or
// ...AsAdmin), same DI pattern as ParentSignatureStatusList's `fetchStatus`/
// `submit` props. Renders the full form content from form-definitions.ts (no
// paragraph omitted), a signature canvas, and calls `submit` on save.
export function ParentSignatureSignModal({
  open,
  onClose,
  onSigned,
  child,
  formType,
  submit,
}: {
  open: boolean;
  onClose: () => void;
  onSigned: () => void;
  child: ChildPrefill;
  formType: ParentSignatureFormTypeValue;
  submit: (input: ParentSignatureSubmitInput) => Promise<ParentSignatureSubmitResult>;
}) {
  const isSafety = formType === "SAFETY_INSTRUCTIONS";
  const content = getFormContent(formType, CURRENT_FORM_VERSION[formType]);

  const [address, setAddress] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [medicalNotes, setMedicalNotes] = useState("");
  const [photoConsent, setPhotoConsent] = useState<boolean | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signerRole, setSignerRole] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const signatureRef = useRef<SignatureCanvasHandle>(null);

  function resetAndClose() {
    setAddress("");
    setParentEmail("");
    setMedicalNotes("");
    setPhotoConsent(null);
    setSignerName("");
    setSignerRole("");
    setAcknowledged(false);
    setHasSignature(false);
    setError(null);
    signatureRef.current?.clear();
    onClose();
  }

  if (!content) return null;

  const canSubmit =
    signerName.trim().length > 0 &&
    (!isSafety || signerRole.length > 0) &&
    (isSafety || address.trim().length > 0) &&
    (isSafety || photoConsent !== null) &&
    acknowledged &&
    hasSignature &&
    !isPending;

  function handleSubmit() {
    setError(null);
    const dataUrl = signatureRef.current?.toDataUrl();
    if (!dataUrl) {
      setError("יש לחתום לפני השמירה");
      return;
    }
    startTransition(async () => {
      const result = await submit({
        childId: child.childId,
        formType,
        address: isSafety ? null : address,
        parentEmail: isSafety ? null : parentEmail,
        medicalNotes: isSafety ? medicalNotes : null,
        photoConsent: isSafety ? null : photoConsent,
        signerName,
        signerRole: signerRole || null,
        signatureDataUrl: dataUrl,
      });
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה בשמירת החתימה");
        return;
      }
      resetAndClose();
      onSigned();
    });
  }

  return (
    <Modal open={open} title={FORM_TYPE_SHORT_LABEL[formType]} onClose={resetAndClose} size="wide">
      <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto pr-1 text-sm">
        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <p className="font-bold text-card-foreground">
            {child.childName}
            {child.childAge != null && <span className="font-normal text-muted-foreground"> · גיל {child.childAge}</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            {child.parentName ?? "אין שם הורה במערכת"}
            {child.parentPhone ? ` · ${child.parentPhone}` : ""}
          </p>
        </div>

        <div className="flex flex-col gap-2 whitespace-pre-line text-card-foreground">
          <h3 className="text-base font-bold">{content.title}</h3>
          {content.introSections.map((section, idx) => (
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

        <div className="flex flex-col gap-3 rounded-xl border border-border p-3">
          {!isSafety && (
            <>
              <label className="flex flex-col gap-1">
                כתובת
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="rounded-lg border border-border px-3 py-2"
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                כתובת מייל (אופציונלי)
                <input
                  type="email"
                  value={parentEmail}
                  onChange={(e) => setParentEmail(e.target.value)}
                  className="rounded-lg border border-border px-3 py-2"
                />
              </label>
            </>
          )}

          {isSafety && (
            <label className="flex flex-col gap-1">
              {content.fields.find((f) => f.key === "medicalNotes")?.label ?? "הערות רפואיות (אופציונלי)"}
              <textarea
                value={medicalNotes}
                onChange={(e) => setMedicalNotes(e.target.value)}
                rows={2}
                className="rounded-lg border border-border px-3 py-2"
              />
            </label>
          )}

          <label className="flex flex-col gap-1">
            שם החותם/ת
            <input
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              className="rounded-lg border border-border px-3 py-2"
              required
            />
          </label>

          <label className="flex flex-col gap-1">
            {isSafety ? "מי חותם/ת" : "תפקיד החותם/ת (אופציונלי)"}
            <select
              value={signerRole}
              onChange={(e) => setSignerRole(e.target.value)}
              className="rounded-lg border border-border px-3 py-2"
              required={isSafety}
            >
              <option value="" disabled>
                בחרו...
              </option>
              <option value="הורה/אפוטרופוס">הורה/אפוטרופוס</option>
              <option value="הרוכב/ת עצמו/ה (מעל גיל 18)">הרוכב/ת עצמו/ה (מעל גיל 18)</option>
            </select>
          </label>
        </div>

        {content.consentStatements.map((statement) =>
          statement.responseType === "YES_NO" ? (
            <div key={statement.key} className="rounded-xl border border-border p-3">
              <p className="mb-2 text-card-foreground">{statement.text}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPhotoConsent(true)}
                  className={`flex-1 rounded-lg border px-3 py-2 font-semibold ${
                    photoConsent === true
                      ? "border-success bg-success-muted text-success"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  מסכים/ה
                </button>
                <button
                  type="button"
                  onClick={() => setPhotoConsent(false)}
                  className={`flex-1 rounded-lg border px-3 py-2 font-semibold ${
                    photoConsent === false
                      ? "border-danger bg-danger-muted text-danger"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  לא מסכים/ה
                </button>
              </div>
            </div>
          ) : (
            <p key={statement.key} className="text-card-foreground">
              {statement.text}
            </p>
          )
        )}

        <label className="flex items-start gap-2 rounded-xl border border-border p-3">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          <span className="font-semibold text-card-foreground">קראתי והבנתי ואני מאשר/ת</span>
        </label>

        <div className="flex flex-col gap-2">
          <p className="font-semibold text-card-foreground">חתימה</p>
          <SignatureCanvas ref={signatureRef} onChange={setHasSignature} />
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              signatureRef.current?.clear();
              setHasSignature(false);
            }}
            className="self-start"
          >
            ניקוי חתימה
          </Button>
        </div>

        {error && <p className="text-danger">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="secondary" onClick={resetAndClose}>
            ביטול
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {isPending ? "שומר..." : "שמירת חתימה"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
