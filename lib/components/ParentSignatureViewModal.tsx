"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/lib/components/Modal";
import { Button } from "@/lib/components/Button";
import { formatHebrewDateTime } from "@/lib/dates";
import { FORM_TYPE_SHORT_LABEL } from "@/lib/parent-signatures/form-definitions";
import type { ParentSignatureViewerData } from "@/lib/actions/parent-signatures";

// Structurally a superset of ParentSignatureViewerData - the live ACTIVE-only
// viewer's fetchData (getTeachingPracticeSignedFormForAdmin/Instructor)
// never sets the revocation fields (they stay undefined, and the row is by
// construction always ACTIVE), while the admin-only history drill-down's
// fetchData (getTeachingPracticeSignedFormHistoryForAdmin) sets all of them.
// One component renders both cases - see the `status === "REVOKED"` banner
// and `onRevoke` gating below.
export type ParentSignatureViewModalData = ParentSignatureViewerData & {
  status?: "ACTIVE" | "REVOKED";
  revokedAt?: string | null;
  revokedByAdminEmail?: string | null;
  revokedByAdminName?: string | null;
  revokedReason?: string | null;
};

interface RevokeActionResult {
  success: boolean;
  error?: string;
}

// Stage 4 alternative: reconstructs the signed form on screen from its
// stored field snapshots + the same versioned content used at signing time
// (lib/parent-signatures/form-definitions.ts) - no PDF anywhere. Shared by
// both the instructor/tablet and admin entry points via the `fetchData`
// prop, same DI pattern as ParentSignatureSignModal's `submit` prop.
//
// size="xl": a document-viewer-sized modal (see Modal.tsx), not the small
// "wide" popup this used before - readable at a glance on a ranch tablet
// without pinch-zooming. Modal hands us the full remaining height as a
// flex-1 wrapper for this size, which is why the JSX below is its own
// fixed-header/scrollable-middle/fixed-footer column rather than relying on
// Modal's own body scroll.
export function ParentSignatureViewModal({
  open,
  onClose,
  signedFormId,
  fetchData,
  onRevoke,
  onRevoked,
}: {
  open: boolean;
  onClose: () => void;
  signedFormId: string;
  fetchData: (signedFormId: string) => Promise<ParentSignatureViewModalData | null>;
  // Admin-only wrong-child correction - omitted entirely by the instructor
  // entry point (InstructorChildSignaturesSection), so the revoke button
  // below never renders there. Never reassigns the form to another child;
  // only ever flips this one row to REVOKED.
  onRevoke?: (signedFormId: string, reason: string) => Promise<RevokeActionResult>;
  // Fired after a successful revoke, before this modal closes itself - the
  // caller uses this to refetch the status list/history so the now-revoked
  // form disappears from "signed" and the child/form becomes collectable
  // again.
  onRevoked?: () => void;
}) {
  const [data, setData] = useState<ParentSignatureViewModalData | null | undefined>(undefined);
  const [revokePanelOpen, setRevokePanelOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeSubmitting, setRevokeSubmitting] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

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

  // Client-side mirror of the server's trim+required check - purely to avoid
  // a round trip for the common "typed nothing" case; the server action
  // re-validates independently and is the actual source of truth.
  function handleConfirmRevoke() {
    if (!onRevoke) return;
    const trimmed = revokeReason.trim();
    if (!trimmed) {
      setRevokeError("יש להזין סיבת ביטול");
      return;
    }
    setRevokeSubmitting(true);
    setRevokeError(null);
    onRevoke(signedFormId, trimmed).then((result) => {
      setRevokeSubmitting(false);
      if (!result.success) {
        setRevokeError(result.error ?? "אירעה שגיאה בביטול החתימה");
        return;
      }
      onRevoked?.();
      onClose();
    });
  }

  // Only offered when the caller wired onRevoke (admin entry point) and the
  // form being viewed isn't already REVOKED - the live ACTIVE-only viewer's
  // data never sets `status`, so it reads as revocable by default; the
  // history drill-down's data always sets it explicitly.
  const isRevocable = Boolean(onRevoke) && data != null && data.status !== "REVOKED";

  return (
    <Modal
      open={open}
      title={data ? FORM_TYPE_SHORT_LABEL[data.formType] : "טופס חתום"}
      onClose={onClose}
      size="xl"
      titleClassName="text-xl md:text-2xl"
    >
      {data === undefined ? (
        <p className="text-lg text-muted-foreground">טוען...</p>
      ) : data === null ? (
        <p className="text-base text-danger">הטופס אינו זמין לצפייה (ייתכן שבוטל).</p>
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-4">
          {/* Print isolation: hides everything else in the page (the status
              list/cards behind this modal, the app's bottom nav, etc.) and
              re-shows only this element's subtree - a `visibility` toggle,
              not `display`, so a `visibility: visible` on a descendant can
              override a `visibility: hidden` ancestor. Relying on Modal's
              own print-safe classes alone was not enough (see history):
              those only style the modal's chrome, they don't hide the rest
              of the page, which stayed fully visible/printable behind it.
              Also forces black-on-white regardless of the site's (possibly
              dark) theme, since the individual text/background utility
              classes below (text-muted-foreground, bg-card, etc.) are
              per-element and wouldn't otherwise be overridden by a color set
              on an ancestor. The signature <img> is unaffected by either
              rule - `color`/`background` don't touch image pixels. */}
          <style>{`
            @media print {
              body * {
                visibility: hidden !important;
              }
              #parent-signature-print-area,
              #parent-signature-print-area * {
                visibility: visible !important;
                color: #000 !important;
                background: transparent !important;
                border-color: #999 !important;
              }
              #parent-signature-print-area {
                position: absolute;
                inset: 0;
                width: 100%;
                max-width: none;
                background: #fff !important;
                padding: 24px;
                direction: rtl;
              }
              #parent-signature-print-area .print-avoid-break {
                break-inside: avoid;
              }
            }
          `}</style>
          <div
            id="parent-signature-print-area"
            className="min-h-0 flex-1 overflow-y-auto pr-1 text-base leading-relaxed md:text-lg"
          >
            <div className="print-avoid-break rounded-xl border border-border bg-muted/40 p-4">
              <p className="text-lg font-bold text-card-foreground md:text-xl">
                {data.childNameSnapshot}
                {data.childAgeSnapshot != null && (
                  <span className="font-normal text-muted-foreground"> · גיל {data.childAgeSnapshot}</span>
                )}
              </p>
              <p className="text-sm text-muted-foreground md:text-base">
                {data.parentNameSnapshot ?? "אין שם הורה"}
                {data.parentPhoneSnapshot ? ` · ${data.parentPhoneSnapshot}` : ""}
              </p>
            </div>

            {data.status === "REVOKED" &&
              (data.revokedReason ? (
                <div className="print-avoid-break mt-4 rounded-xl border border-danger/40 bg-danger-muted/30 p-4 text-sm">
                  <p className="font-semibold text-danger">חתימה זו בוטלה</p>
                  <p className="mt-1 text-card-foreground">
                    בוטלה ע״י {data.revokedByAdminName ?? data.revokedByAdminEmail ?? "מנהל/ת"}
                    {data.revokedAt ? ` · ${formatHebrewDateTime(new Date(data.revokedAt))}` : ""}
                  </p>
                  <p className="mt-1 text-card-foreground">סיבה: {data.revokedReason}</p>
                </div>
              ) : (
                <div className="print-avoid-break mt-4 rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                  הוחלפה בחתימה חדשה
                </div>
              ))}

            <div className="mt-4 flex flex-col gap-3 text-card-foreground">
              <h3 className="text-xl font-extrabold md:text-2xl">{data.content.title}</h3>
              {data.content.introSections.map((section, idx) => (
                <div key={idx} className="flex flex-col gap-2">
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

            <div className="print-avoid-break mt-4 flex flex-col gap-2 rounded-xl border border-border p-4">
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

            <div className="mt-4 flex flex-col gap-2">
              {data.content.consentStatements.map((statement) => (
                <p key={statement.key} className="text-card-foreground">
                  {statement.text}
                </p>
              ))}
            </div>

            <div className="print-avoid-break mt-4 rounded-xl border border-border p-4">
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

            <div className="print-avoid-break mt-4 flex flex-col gap-2">
              <p className="text-lg font-semibold text-card-foreground">חתימה</p>
              {data.signatureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL from Supabase Storage, not a local/optimizable asset
                <img
                  src={data.signatureUrl}
                  alt={`חתימת ${data.signerName}`}
                  className="h-56 w-full max-w-xl rounded-xl border border-border bg-white object-contain md:h-64"
                />
              ) : (
                <p className="text-sm text-muted-foreground">תמונת החתימה אינה זמינה כרגע.</p>
              )}
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              גרסת טופס: {data.formVersion} · מחזור: {data.courseCycle}
            </p>
          </div>

          <div className="flex shrink-0 flex-col gap-3 border-t border-border pt-4 print:hidden">
            {revokePanelOpen && (
              <div className="flex flex-col gap-2 rounded-xl border border-danger/40 bg-danger-muted/20 p-3">
                <label className="text-sm font-semibold text-card-foreground">
                  סיבת ביטול (חובה):
                </label>
                <textarea
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  rows={2}
                  className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground"
                  placeholder='לדוגמה: החתימה נאספה בטעות עבור ילד/ה אחר/ת'
                  disabled={revokeSubmitting}
                />
                {revokeError && <p className="text-sm text-danger">{revokeError}</p>}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setRevokePanelOpen(false);
                      setRevokeReason("");
                      setRevokeError(null);
                    }}
                    disabled={revokeSubmitting}
                  >
                    ביטול
                  </Button>
                  <Button type="button" variant="danger" onClick={handleConfirmRevoke} disabled={revokeSubmitting}>
                    {revokeSubmitting ? "מבטל..." : "אישור ביטול חתימה"}
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              {isRevocable && !revokePanelOpen && (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => setRevokePanelOpen(true)}
                  className="!px-5 !py-3 !text-base"
                >
                  ביטול חתימה (נחתמה עבור ילד/ה שגוי/ה)
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                className="!px-5 !py-3 !text-base"
              >
                סגירה
              </Button>
              <Button type="button" onClick={() => window.print()} className="!px-5 !py-3 !text-base">
                הדפסת הטופס / שמירה כ-PDF
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
