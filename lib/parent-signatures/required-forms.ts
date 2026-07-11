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
