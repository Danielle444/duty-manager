// Pure, DB-free helper for Teaching Practice ("התנסויות מתחילים") feedback
// content - no "use server", no Prisma import, same convention as
// lib/teaching-practice-rotation.ts / lib/teaching-practice-schedule-check.ts.
//
// Business rule: only MEANINGFUL feedback should protect a generated lesson
// from being overwritten by a sync/participant-edit action. Opening the
// feedback modal (TeachingPracticeFeedbackModal in TeachingPracticeManager.tsx)
// and closing it - or switching to another trainee - without entering
// anything still triggers an unconditional save (see its
// requestClose/handleSwitchTo), which persists an empty TeachingPracticeFeedback
// row (feedback: null, ratingHalfPoints: null). Treating mere row existence
// as "this lesson has feedback" (the previous behavior everywhere this was
// checked) would let that empty row permanently block sync for a lesson
// nobody ever actually gave feedback on.

export interface TeachingPracticeFeedbackContentInput {
  feedback: string | null;
  ratingHalfPoints: number | null;
}

// True only when the row carries real content: a non-null rating, or
// non-blank (post-trim) feedback text. A row that exists but has both
// fields empty/null returns false - it must never count as blocking
// feedback.
export function hasMeaningfulTeachingPracticeFeedback(
  feedback: TeachingPracticeFeedbackContentInput | null | undefined
): boolean {
  if (!feedback) return false;
  if (feedback.ratingHalfPoints !== null && feedback.ratingHalfPoints !== undefined) return true;
  return (feedback.feedback?.trim() ?? "") !== "";
}
