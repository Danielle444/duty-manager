"use client";

import { useCallback } from "react";
import {
  getParentSignatureStatusForInstructor,
  submitTeachingPracticeSignedFormAsInstructor,
  type ParentSignatureSubmitInput,
} from "@/lib/actions/parent-signatures";
import { ParentSignatureStatusList } from "@/lib/components/ParentSignatureStatusList";

// Stage 2 read + Stage 3 sign. The tab this renders under is only shown to
// instructors whose stored session has canManageChildSignatures=true (see
// InstructorClient), but that's a UX convenience only - the real gate is
// server-side in both getParentSignatureStatusForInstructor and
// submitTeachingPracticeSignedFormAsInstructor, which re-check the flag
// fresh from the DB regardless of how this screen was reached.
export function InstructorChildSignaturesSection({ instructorId }: { instructorId: string }) {
  const fetchStatus = useCallback(
    () => getParentSignatureStatusForInstructor(instructorId),
    [instructorId]
  );
  const submit = useCallback(
    (input: ParentSignatureSubmitInput) =>
      submitTeachingPracticeSignedFormAsInstructor(instructorId, input),
    [instructorId]
  );

  return <ParentSignatureStatusList fetchStatus={fetchStatus} submit={submit} />;
}
