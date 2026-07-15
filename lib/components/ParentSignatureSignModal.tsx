"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Modal } from "@/lib/components/Modal";
import { Button } from "@/lib/components/Button";
import { SignatureCanvas, type SignatureCanvasHandle } from "@/lib/components/SignatureCanvas";
import { getFormContent, CURRENT_FORM_VERSION, FORM_TYPE_SHORT_LABEL } from "@/lib/parent-signatures/form-definitions";
import { CURRENT_TEACHING_PRACTICE_COURSE_CYCLE } from "@/lib/parent-signatures/course-cycle";
import type { ParentSignatureFormTypeValue } from "@/lib/parent-signatures/types";
import {
  buildDraftKey,
  clearDraft,
  loadDraft,
  saveDraft,
  type ParentSignatureDraftFields,
} from "@/lib/parent-signatures/draft-storage";
import type {
  ParentSignatureSubmitInput,
  ParentSignatureSubmitResult,
} from "@/lib/actions/parent-signatures";

const DRAFT_SAVE_DEBOUNCE_MS = 1000;

function isEmptyDraft(fields: ParentSignatureDraftFields): boolean {
  return (
    !fields.address &&
    !fields.parentEmail &&
    !fields.medicalNotes &&
    fields.photoConsent === null &&
    !fields.signerName &&
    !fields.signerRole
  );
}

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

  // Draft key is scoped to courseCycle+childId+formType+formVersion so a
  // draft is never offered for the wrong child/form/cycle - see
  // draft-storage.ts. formVersion comes from CURRENT_FORM_VERSION (not
  // content.formVersion) so the key is still well-defined even before the
  // `!content` guard below.
  const draftKey = buildDraftKey({
    courseCycle: CURRENT_TEACHING_PRACTICE_COURSE_CYCLE,
    childId: child.childId,
    formType,
    formVersion: CURRENT_FORM_VERSION[formType],
  });

  const [pendingDraft, setPendingDraft] = useState<ParentSignatureDraftFields | null>(null);
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const previousDraftKeyRef = useRef<string | null>(null);
  // Consumed by the very next autosave-effect run after a target
  // change/restore/discard so that programmatic field resets never
  // themselves trigger a save (only actual user edits do).
  const skipNextAutosaveRef = useRef(true);

  // Fires on first open and whenever the signing target (child/form/version/
  // cycle) changes while the modal stays mounted - clears in-memory fields
  // first (never carrying a previous target's values into the new one),
  // then checks only the new target's own draft key and offers it via the
  // recovery banner rather than silently restoring it.
  useEffect(() => {
    if (!open) return;
    if (previousDraftKeyRef.current === draftKey) return;
    previousDraftKeyRef.current = draftKey;
    skipNextAutosaveRef.current = true;
    setAddress("");
    setParentEmail("");
    setMedicalNotes("");
    setPhotoConsent(null);
    setSignerName("");
    setSignerRole("");
    setAcknowledged(false);
    setHasSignature(false);
    signatureRef.current?.clear();
    setError(null);
    setDraftStatus("idle");
    setPendingDraft(loadDraft(draftKey));
  }, [open, draftKey]);

  // Debounced autosave of the non-signature fields only. Paused while a
  // recovery banner is showing (pendingDraft !== null) so an empty/partial
  // in-memory state can never overwrite an unresolved saved draft.
  useEffect(() => {
    if (!open || pendingDraft !== null) return;
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }
    setDraftStatus("saving");
    const timer = setTimeout(() => {
      const ok = saveDraft(draftKey, { address, parentEmail, medicalNotes, photoConsent, signerName, signerRole });
      setDraftStatus(ok ? "saved" : "error");
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [address, parentEmail, medicalNotes, photoConsent, signerName, signerRole, open, pendingDraft, draftKey]);

  function handleRestoreDraft() {
    if (!pendingDraft) return;
    setAddress(pendingDraft.address);
    setParentEmail(pendingDraft.parentEmail);
    setMedicalNotes(pendingDraft.medicalNotes);
    setPhotoConsent(pendingDraft.photoConsent);
    setSignerName(pendingDraft.signerName);
    setSignerRole(pendingDraft.signerRole);
    // Signature and acknowledgment are never restored - the parent must
    // draw the signature and re-check the box again before this can submit.
    setPendingDraft(null);
  }

  function handleDiscardDraft() {
    clearDraft(draftKey);
    setPendingDraft(null);
  }

  function resetFieldState() {
    setAddress("");
    setParentEmail("");
    setMedicalNotes("");
    setPhotoConsent(null);
    setSignerName("");
    setSignerRole("");
    setAcknowledged(false);
    setHasSignature(false);
    setError(null);
    setPendingDraft(null);
    setDraftStatus("idle");
    signatureRef.current?.clear();
  }

  // Cancel / backdrop / X close - never clears the saved draft. Flushes the
  // latest safe (non-signature) field values first so a debounce timer that
  // hasn't fired yet isn't simply lost when its effect is torn down. Never
  // overwrites a draft the parent hasn't yet chosen to restore or discard.
  function closeWithoutSubmitting() {
    if (pendingDraft === null) {
      const fields: ParentSignatureDraftFields = {
        address,
        parentEmail,
        medicalNotes,
        photoConsent,
        signerName,
        signerRole,
      };
      if (!isEmptyDraft(fields)) {
        saveDraft(draftKey, fields);
      }
    }
    resetFieldState();
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
      clearDraft(draftKey);
      resetFieldState();
      onClose();
      onSigned();
    });
  }

  return (
    <Modal open={open} title={FORM_TYPE_SHORT_LABEL[formType]} onClose={closeWithoutSubmitting} size="wide">
      <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto pr-1 text-sm">
        {pendingDraft && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning bg-warning-muted p-3">
            <span className="font-semibold text-warning">נמצאה טיוטה שלא הושלמה</span>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={handleDiscardDraft}>
                מחיקת הטיוטה / התחלה מחדש
              </Button>
              <Button type="button" onClick={handleRestoreDraft}>
                שחזור הטיוטה
              </Button>
            </div>
          </div>
        )}

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

        {draftStatus !== "idle" && (
          <p
            className={`text-xs ${draftStatus === "error" ? "text-danger" : "text-muted-foreground"}`}
            aria-live="polite"
          >
            {draftStatus === "saving" && "שומר..."}
            {draftStatus === "saved" && "נשמר אוטומטית"}
            {draftStatus === "error" && "לא ניתן לשמור טיוטה"}
          </p>
        )}

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
          <Button type="button" variant="secondary" onClick={closeWithoutSubmitting}>
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
