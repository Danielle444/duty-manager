"use client";

import { useCallback } from "react";
import {
  getParentSignatureStatusForAdmin,
  submitTeachingPracticeSignedFormAsAdmin,
  type ParentSignatureSubmitInput,
} from "@/lib/actions/parent-signatures";
import { ParentSignatureStatusList } from "@/lib/components/ParentSignatureStatusList";

// Stage 2 read + Stage 3 sign. Admin entry point - page.tsx already calls
// requireAdmin() server-side before rendering this at all, and both server
// actions below call requireAdmin() again themselves.
export function ParentSignaturesAdminClient() {
  const fetchStatus = useCallback(() => getParentSignatureStatusForAdmin(), []);
  const submit = useCallback(
    (input: ParentSignatureSubmitInput) => submitTeachingPracticeSignedFormAsAdmin(input),
    []
  );

  return <ParentSignatureStatusList fetchStatus={fetchStatus} submit={submit} />;
}
