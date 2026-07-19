// Pure, dependency-free visibility gate for a single Teaching Practice
// participant's feedback view. Deliberately has NO imports at all - no React,
// Next, Prisma, auth, env, clock, random, cookies, or server actions - so it
// can be unit-tested in isolation and reused by the server mapper in
// lib/actions/teaching-practice.ts without dragging any of that in.
//
// Product boundary (see the caller): the free-text feedback, ratingHalfPoints,
// updatedByName and updatedAt are shown TOGETHER or not at all. A caller that
// is not authorized must receive `null` - never a partially-stripped object,
// and never a hint that a hidden feedback row exists.
//
// Fail closed by construction: only the exact boolean `true` reveals the
// feedback view. Every other runtime value (false, undefined, null, 0, "",
// "true", objects, NaN, ...) returns null. The generic keeps this helper
// agnostic to the feedback view's exact shape - the actions module owns that
// shape (TeachingPracticeParticipantFeedbackData) and simply passes its
// already-built view (or null) through here.

export function applyTeachingPracticeFeedbackVisibility<TFeedbackView>(
  feedbackView: TFeedbackView | null,
  canViewFeedback: boolean
): TFeedbackView | null {
  // Strict identity check, not a truthy check: default-deny for any
  // unexpected runtime value. Returns the supplied view by reference,
  // unchanged and unmutated, only when explicitly authorized.
  if (canViewFeedback === true) {
    return feedbackView;
  }
  return null;
}
