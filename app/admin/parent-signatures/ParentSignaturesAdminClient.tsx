"use client";

import { useCallback, useState } from "react";
import {
  getParentSignatureStatusForAdmin,
  submitTeachingPracticeSignedFormAsAdmin,
  getTeachingPracticeSignedFormForAdmin,
  getAllActiveTeachingPracticeSignedFormsForAdmin,
  revokeTeachingPracticeSignedFormAsAdmin,
  getRevokedTeachingPracticeSignedFormsForAdmin,
  getTeachingPracticeSignedFormHistoryForAdmin,
  type ParentSignatureSubmitInput,
} from "@/lib/actions/parent-signatures";
import { ParentSignatureStatusList } from "@/lib/components/ParentSignatureStatusList";
import { ParentSignatureBulkPrintModal } from "@/lib/components/ParentSignatureBulkPrintModal";
import { ParentSignatureRevokedHistoryModal } from "@/lib/components/ParentSignatureRevokedHistoryModal";
import { Button } from "@/lib/components/Button";

// Stage 2 read + Stage 3 sign + Stage 4 view + bulk print/export + admin-only
// wrong-child correction (revoke + revoked-signature history). Admin entry
// point - page.tsx already calls requireAdmin() server-side before rendering
// this at all, and every server action below calls requireAdmin() again
// itself. revokeSignedForm/the history fetch below are only ever wired here,
// never in InstructorChildSignaturesSection - instructors get no revoke
// capability.
export function ParentSignaturesAdminClient() {
  const fetchStatus = useCallback(() => getParentSignatureStatusForAdmin(), []);
  const submit = useCallback(
    (input: ParentSignatureSubmitInput) => submitTeachingPracticeSignedFormAsAdmin(input),
    []
  );
  const viewSignedForm = useCallback(
    (signedFormId: string) => getTeachingPracticeSignedFormForAdmin(signedFormId),
    []
  );
  const revokeSignedForm = useCallback(
    (signedFormId: string, reason: string) => revokeTeachingPracticeSignedFormAsAdmin(signedFormId, reason),
    []
  );
  const fetchAllSignedForms = useCallback(() => getAllActiveTeachingPracticeSignedFormsForAdmin(), []);
  const fetchRevokedHistory = useCallback(() => getRevokedTeachingPracticeSignedFormsForAdmin(), []);
  const fetchSignedFormHistory = useCallback(
    (signedFormId: string) => getTeachingPracticeSignedFormHistoryForAdmin(signedFormId),
    []
  );

  const [bulkPrintOpen, setBulkPrintOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setHistoryOpen(true)}>
          היסטוריית חתימות שבוטלו
        </Button>
        <Button type="button" variant="secondary" onClick={() => setBulkPrintOpen(true)}>
          הדפסה / שמירה כ-PDF לכל הטפסים החתומים
        </Button>
      </div>
      <ParentSignatureStatusList
        fetchStatus={fetchStatus}
        submit={submit}
        viewSignedForm={viewSignedForm}
        revokeSignedForm={revokeSignedForm}
      />
      {bulkPrintOpen && (
        <ParentSignatureBulkPrintModal
          open={bulkPrintOpen}
          onClose={() => setBulkPrintOpen(false)}
          fetchData={fetchAllSignedForms}
        />
      )}
      {historyOpen && (
        <ParentSignatureRevokedHistoryModal
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          fetchHistory={fetchRevokedHistory}
          fetchSignedForm={fetchSignedFormHistory}
        />
      )}
    </div>
  );
}
