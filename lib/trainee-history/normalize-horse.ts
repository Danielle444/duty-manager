/**
 * Pure horse-value normalization for dated trainee history (Stage GH2A1).
 *
 * PURE by construction: no Prisma, no DB, no clock, no environment access.
 * Collapses a raw horse payload into exactly ONE of four canonical states or a
 * single public error code. See GH2A1 HORSE NORMALIZATION.
 *
 * The four canonical states (the only ones accepted):
 *   1. Ranch horse:            assignedHorseName=<name>, hasPrivateHorse=false, privateHorseName=null
 *   2. Private horse w/ name:  assignedHorseName=null,   hasPrivateHorse=true,  privateHorseName=<name>
 *   3. Private horse w/o name: assignedHorseName=null,   hasPrivateHorse=true,  privateHorseName=null
 *   4. No horse:               assignedHorseName=null,   hasPrivateHorse=false, privateHorseName=null
 */

import type { PublicErrorCode } from "./apply-plan";

/** The canonical, validated horse value (exactly three cache fields). */
export interface NormalizedHorse {
  assignedHorseName: string | null;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
}

export type NormalizeHorseResult =
  | { ok: true; value: NormalizedHorse }
  | { ok: false; code: Extract<PublicErrorCode, "INVALID_HORSE_STATE"> };

/** Sentinel distinguishing "wrong type" from a legitimate `null`/empty name. */
const INVALID_NAME = Symbol("INVALID_NAME");

/** Trim a name; empty/whitespace collapses to `null`; wrong type → sentinel. */
function normalizeName(value: unknown): string | null | typeof INVALID_NAME {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return INVALID_NAME;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Normalize a horse payload into one of the four canonical states. Any
 * contradictory or noncanonical payload → `INVALID_HORSE_STATE` (the public set
 * exposes no `CONTRADICTORY_HORSE_STATE`).
 */
export function normalizeHorse(input: {
  assignedHorseName: unknown;
  hasPrivateHorse: unknown;
  privateHorseName: unknown;
}): NormalizeHorseResult {
  const fail = { ok: false as const, code: "INVALID_HORSE_STATE" as const };

  if (typeof input.hasPrivateHorse !== "boolean") {
    return fail;
  }

  const assigned = normalizeName(input.assignedHorseName);
  const privateName = normalizeName(input.privateHorseName);
  if (assigned === INVALID_NAME || privateName === INVALID_NAME) {
    return fail;
  }

  if (input.hasPrivateHorse) {
    // States 2 & 3: a private horse never carries a ranch (assigned) name.
    if (assigned !== null) {
      return fail;
    }
    return {
      ok: true,
      value: { assignedHorseName: null, hasPrivateHorse: true, privateHorseName: privateName },
    };
  }

  // States 1 & 4: without a private horse there can be no private-horse name.
  if (privateName !== null) {
    return fail;
  }
  return {
    ok: true,
    value: { assignedHorseName: assigned, hasPrivateHorse: false, privateHorseName: null },
  };
}
