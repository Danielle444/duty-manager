/**
 * MULTI-COURSE (enrollment slice E3) - PURE stable-code -> Hebrew message map for
 * the enrollment page's ?error= state.
 *
 * PURE data module: it imports ONLY the E1 error-code type (a type-only import,
 * erased at runtime) and exports a total Record keyed by every stable E1 error
 * code. It is shared by the enrollments page (which renders the message) and its
 * test (which proves totality), so the page and the action's redirect codes can
 * never drift out of sync with the E1 error surface. No message ever reflects raw
 * input or PII - each is a fixed, manager-readable Hebrew string.
 *
 * offering_not_found is included for totality but is NOT reached through this
 * page's rendered state: the action routes an invalid offering scope to the safe
 * courses list rather than reflecting an unvalidated id in an enrollments URL.
 */
import type { EnrollExistingTraineeErrorCode } from "@/lib/course/enroll-existing-trainee";

/** Total map: every stable E1 error code -> a fixed Hebrew message. */
export const ENROLL_ERROR_MESSAGES: Record<EnrollExistingTraineeErrorCode, string> = {
  invalid_input: "אירעה שגיאה. נסו שוב.",
  offering_not_found: "הקורס לא נמצא.",
  operation_not_allowed: "לא ניתן לרשום חניכים לקורס במצב זה.",
  offering_start_date_missing: "לא ניתן לרשום חניך: לקורס אין תאריך התחלה.",
  student_not_found: "החניך שנבחר לא נמצא.",
  inactive_student: "לא ניתן לרשום חניך שאינו פעיל.",
  invalid_group: "תת־הקבוצה שנבחרה אינה תקינה עבור קורס זה.",
  already_enrolled: "החניך כבר רשום לקורס זה.",
  unexpected: "אירעה שגיאה. נסו שוב.",
};

/** Resolve a stable code to a message; an unknown code falls back to generic. */
export function enrollErrorMessage(code: string): string {
  return ENROLL_ERROR_MESSAGES[code as EnrollExistingTraineeErrorCode] ?? ENROLL_ERROR_MESSAGES.unexpected;
}
