// Pure mapping from a Teaching Practice practice type to the parent-signature
// forms it requires - no DB access, no "use server". Not wired into any
// UI/action yet (Stage 1 scope) - a later stage uses this to compute each
// child's missing/cleared signature status.

import type { TeachingPracticeTypeValue } from "@/lib/teaching-practice-rotation";
import type { ParentSignatureFormTypeValue } from "@/lib/parent-signatures/types";

// Every Teaching Practice child needs SAFETY_INSTRUCTIONS regardless of
// practiceType; LUNGE/BEGINNER_PRIVATE/BEGINNER_GROUP each additionally
// require the one consent form matching that source document.
export function requiredParentSignatureFormTypes(
  practiceType: TeachingPracticeTypeValue
): ParentSignatureFormTypeValue[] {
  switch (practiceType) {
    case "LUNGE":
      return ["SAFETY_INSTRUCTIONS", "LUNGE_CONSENT"];
    case "BEGINNER_PRIVATE":
    case "BEGINNER_GROUP":
      return ["SAFETY_INSTRUCTIONS", "BEGINNER_LESSON_CONSENT"];
  }
}

// SAFETY_INSTRUCTIONS applies to every active Teaching Practice child even
// before they have any TeachingPracticeChildAssignment row - it's the one
// form that doesn't depend on knowing a practiceType yet.
const BASELINE_PARENT_SIGNATURE_FORM_TYPES: ParentSignatureFormTypeValue[] = ["SAFETY_INSTRUCTIONS"];

// The single shared rule for "which forms does this child need right now" -
// used by both the status list (lib/parent-signatures/status.ts) and the
// submit guard (lib/actions/parent-signatures.ts) so the two can never drift
// apart. Always includes the baseline above, even when practiceTypes is
// empty (an active child with zero assignments) - practice-type-specific
// consent forms are only ever added once the child actually has an
// assignment of that type.
export function requiredParentSignatureFormTypesForChild(
  practiceTypes: TeachingPracticeTypeValue[]
): ParentSignatureFormTypeValue[] {
  const fromPracticeTypes = practiceTypes.flatMap(requiredParentSignatureFormTypes);
  return Array.from(new Set([...BASELINE_PARENT_SIGNATURE_FORM_TYPES, ...fromPracticeTypes]));
}
