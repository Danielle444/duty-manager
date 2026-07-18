/**
 * Pure group-value normalization for dated trainee history (Stage GH2A1).
 *
 * PURE by construction: no Prisma, no DB, no clock, no environment access. Only
 * validates/normalizes a `{ groupName, subgroupNumber }` payload into the
 * canonical group cache value or a public error code. See GH2A1 GROUP
 * NORMALIZATION.
 */

import type { PublicErrorCode } from "./apply-plan";

/** The canonical, validated group value stored in history + the Student cache. */
export interface NormalizedGroup {
  groupName: "א" | "ב" | null;
  subgroupNumber: number | null;
}

export type NormalizeGroupResult =
  | { ok: true; value: NormalizedGroup }
  | { ok: false; code: Extract<PublicErrorCode, "INVALID_GROUP" | "INVALID_SUBGROUP"> };

/**
 * Normalize a group payload.
 *
 *  - `groupName` must be exactly `"א"`, `"ב"`, or `null`; anything else →
 *    `INVALID_GROUP`.
 *  - `subgroupNumber` must be a positive integer or `null`; `0`, negatives,
 *    floats, `NaN`, and non-numbers → `INVALID_SUBGROUP`.
 */
export function normalizeGroup(input: {
  groupName: unknown;
  subgroupNumber: unknown;
}): NormalizeGroupResult {
  const { groupName, subgroupNumber } = input;

  if (groupName !== "א" && groupName !== "ב" && groupName !== null) {
    return { ok: false, code: "INVALID_GROUP" };
  }

  if (subgroupNumber !== null) {
    if (
      typeof subgroupNumber !== "number" ||
      !Number.isInteger(subgroupNumber) ||
      subgroupNumber <= 0
    ) {
      return { ok: false, code: "INVALID_SUBGROUP" };
    }
  }

  return { ok: true, value: { groupName, subgroupNumber } };
}
