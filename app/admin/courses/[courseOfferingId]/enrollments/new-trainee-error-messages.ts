/**
 * MULTI-COURSE (new-trainee slice N2A) - PURE stable-code -> Hebrew message map for
 * the enrollments page's ?newError= state (the FUTURE new-trainee form; N2A adds
 * NO UI, only the action + this map + a contract test).
 *
 * PURE data module: it imports ONLY the N1 error-code type (a type-only import,
 * erased at runtime) and exports a total Record keyed by every stable N1 error
 * code. It mirrors the committed enroll-error-messages.ts convention so the action's
 * redirect codes can never drift out of sync with the N1 error surface. No message
 * ever reflects raw input or PII - each is a fixed, manager-readable Hebrew string.
 *
 * offering_not_found is included for totality but is NOT reached through this page's
 * rendered ?newError= state: the action routes an invalid offering scope to the safe
 * courses list rather than reflecting an unvalidated id in an enrollments URL.
 *
 * The message set is deliberately SEPARATE from enroll-error-messages.ts: the two
 * flows use distinct query keys (newError vs error) and distinct N1/E1 error unions,
 * so keeping the maps apart prevents accidental cross-wiring.
 */
import type { CreateTraineeIntoOfferingErrorCode } from "@/lib/course/create-trainee-into-offering";

/** Total map: every stable N1 error code -> a fixed Hebrew message. */
export const NEW_TRAINEE_ERROR_MESSAGES: Record<CreateTraineeIntoOfferingErrorCode, string> = {
  invalid_input: "אירעה שגיאה. נסו שוב.",
  offering_not_found: "הקורס לא נמצא.",
  operation_not_allowed: "לא ניתן ליצור חניך חדש בקורס במצב זה.",
  offering_start_date_missing: "לא ניתן ליצור חניך: לקורס אין תאריך התחלה.",
  invalid_group: "תת־הקבוצה שנבחרה אינה תקינה עבור קורס זה.",
  duplicate_identity:
    "כבר קיים חניך עם תעודת זהות זו. אם החניך כבר קיים במערכת, יש להשתמש ברישום חניך קיים לקורס.",
  unexpected: "אירעה שגיאה. נסו שוב.",
};

/** Resolve a stable code to a message; an unknown code falls back to generic. */
export function newTraineeErrorMessage(code: string): string {
  return (
    NEW_TRAINEE_ERROR_MESSAGES[code as CreateTraineeIntoOfferingErrorCode] ??
    NEW_TRAINEE_ERROR_MESSAGES.unexpected
  );
}
