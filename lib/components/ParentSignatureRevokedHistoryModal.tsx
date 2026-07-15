"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/lib/components/Modal";
import { Button } from "@/lib/components/Button";
import { ParentSignatureViewModal, type ParentSignatureViewModalData } from "@/lib/components/ParentSignatureViewModal";
import { formatHebrewDateTime } from "@/lib/dates";
import { FORM_TYPE_SHORT_LABEL } from "@/lib/parent-signatures/form-definitions";
import type { ParentSignatureRevokedHistoryRow } from "@/lib/actions/parent-signatures";

// Admin-only audit trail for every REVOKED TeachingPracticeSignedForm in the
// current course cycle - the wrong-child correction workflow's "history"
// requirement. Two distinct REVOKED meanings are rendered differently (never
// as a blank/broken row):
// - Manual correction (revokeTeachingPracticeSignedFormAsAdmin): reason +
//   revoking admin + revoked timestamp are all present.
// - Automatic supersession (the same-child re-sign flow in
//   submitParentSignatureInternal): none of those fields are set, shown as
//   the neutral "הוחלפה בחתימה חדשה" instead.
// Drill-down into a row's full form content reuses ParentSignatureViewModal
// via the status-agnostic fetchSignedForm prop - onRevoke is deliberately
// never passed here, since every row in this list is already REVOKED (no
// "un-revoke"/re-activate action exists, by design - see requirement 7 of
// the correction workflow: a corrected child always gets a fresh signature
// through the normal flow instead).
export function ParentSignatureRevokedHistoryModal({
  open,
  onClose,
  fetchHistory,
  fetchSignedForm,
}: {
  open: boolean;
  onClose: () => void;
  fetchHistory: () => Promise<ParentSignatureRevokedHistoryRow[]>;
  fetchSignedForm: (signedFormId: string) => Promise<ParentSignatureViewModalData | null>;
}) {
  const [rows, setRows] = useState<ParentSignatureRevokedHistoryRow[] | null | undefined>(undefined);
  const [viewingFormId, setViewingFormId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchHistory()
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch(() => {
        if (!cancelled) setRows(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, fetchHistory]);

  return (
    <>
      <Modal open={open} title="היסטוריית חתימות שבוטלו" onClose={onClose} size="large">
        <div className="flex h-full min-h-0 flex-col gap-4">
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {rows === undefined ? (
              <p className="text-lg text-muted-foreground">טוען...</p>
            ) : rows === null ? (
              <p className="text-base text-danger">שגיאה בטעינת ההיסטוריה. יש לנסות שוב.</p>
            ) : rows.length === 0 ? (
              <p className="text-base text-muted-foreground">אין חתימות שבוטלו במחזור הנוכחי.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {rows.map((row) => (
                  <div
                    key={row.signedFormId}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border/60 p-4"
                  >
                    <div className="min-w-0">
                      <p className="text-base font-bold text-card-foreground">
                        {row.childNameSnapshot} — {FORM_TYPE_SHORT_LABEL[row.formType]}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        נחתם: {formatHebrewDateTime(new Date(row.signedAt))}
                      </p>
                      {row.isManualRevoke ? (
                        <div className="mt-1 rounded-lg bg-danger-muted/30 px-2.5 py-1.5 text-xs text-card-foreground">
                          <p className="font-semibold text-danger">בוטל ידנית</p>
                          <p>
                            בוטלה ע״י {row.revokedByAdminName ?? row.revokedByAdminEmail ?? "מנהל/ת"}
                            {row.revokedAt ? ` · ${formatHebrewDateTime(new Date(row.revokedAt))}` : ""}
                          </p>
                          <p>סיבה: {row.revokedReason}</p>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">הוחלפה בחתימה חדשה</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setViewingFormId(row.signedFormId)}
                      className="shrink-0"
                    >
                      צפייה בטופס
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 justify-end border-t border-border pt-4">
            <Button type="button" variant="secondary" onClick={onClose} className="!px-5 !py-3 !text-base">
              סגירה
            </Button>
          </div>
        </div>
      </Modal>

      {viewingFormId && (
        <ParentSignatureViewModal
          open
          onClose={() => setViewingFormId(null)}
          signedFormId={viewingFormId}
          fetchData={fetchSignedForm}
        />
      )}
    </>
  );
}
