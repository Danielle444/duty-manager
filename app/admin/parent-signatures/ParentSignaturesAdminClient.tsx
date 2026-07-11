"use client";

import { useCallback } from "react";
import {
  getParentSignatureStatusForAdmin,
  submitTeachingPracticeSignedFormAsAdmin,
  getTeachingPracticeSignedFormForAdmin,
  type ParentSignatureSubmitInput,
} from "@/lib/actions/parent-signatures";
import { ParentSignatureStatusList } from "@/lib/components/ParentSignatureStatusList";

// Stage 2 read + Stage 3 sign + Stage 4 view. Admin entry point - page.tsx
// already calls requireAdmin() server-side before rendering this at all,
// and every server action below calls requireAdmin() again itself.
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

  return (
    <ParentSignatureStatusList fetchStatus={fetchStatus} submit={submit} viewSignedForm={viewSignedForm} />
  );
}
