/**
 * MULTI-COURSE W6B - tiny PURE client-side guard for the trainee CREATE form.
 *
 * W6B makes group + subgroup REQUIRED when creating a new trainee (the server
 * fails before any write otherwise). This helper lets StudentsClient block a
 * create submission early with the SAME Hebrew wording the server would return,
 * so the form and the server contract agree. It operates on the raw form
 * strings and is deliberately independent of the transaction/orchestration.
 *
 * PURE: no Prisma, no clock, no DOM. The message constants are reused from the
 * server core so there is a single source of truth; only the two field-presence
 * checks live here. EDIT mode must NEVER call this - a legacy trainee may have a
 * blank group/subgroup and their profile must stay editable.
 */
import {
  MISSING_GROUP_MESSAGE,
  MISSING_SUBGROUP_MESSAGE,
} from "./create-trainee-enrollment-core";

/**
 * Validate the create-mode group/subgroup fields. Returns the first missing-
 * field Hebrew message, or null when both are present. Whitespace-only counts
 * as missing, matching the server's trim-based validation.
 */
export function validateCreateTraineeForm(input: {
  groupName: string;
  subgroupNumber: string;
}): string | null {
  if (input.groupName.trim().length === 0) {
    return MISSING_GROUP_MESSAGE;
  }
  if (input.subgroupNumber.trim().length === 0) {
    return MISSING_SUBGROUP_MESSAGE;
  }
  return null;
}
