// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3B - Move/Swap write-plan adapter) -
// pure, DB-free, deterministic, NON-MUTATING.
//
// The bridge between the Stage-3A pure core's proposed final plan state and the
// Stage-3B transaction's TARGETED persistence. It takes a Stage-3A SUCCESS
// (operation + nextPlan + affected) and produces a closed WRITE PLAN: the exact,
// minimal set of row updates a persisting caller must apply - never a full
// deep-copied plan, never a delete/recreate, never an unaffected row.
//
// It performs NO Prisma/DB/action/auth/React/env/clock/random work; its only
// dependency is the Stage-3A core's structural types. It NEVER trusts the client
// command: every final value is derived from `nextPlan` (which the core built by
// deep copy of the freshly-read tree), located by the STABLE ids the core listed
// in `affected`. It is exhaustively unit-tested against the same operation matrix
// as the core, so the transaction's persistence stays observable and correct
// without a database.
//
// WRITE-SCOPE CONTRACT (mirrors the core's `affected` semantics exactly):
//  - MOVE_TRAINEE / SWAP_TRAINEES  -> for each affected PAIR id, rewrite ONLY
//      trainee1Id + trainee2Id (both, because a move auto-promotes trainee2 into
//      trainee1). horseName / note are never touched.
//  - MOVE_HORSE / SWAP_HORSES  -> for each affected PAIR id, rewrite ONLY
//      horseName. trainee slots / note are never touched.
//  - MOVE_INSTRUCTOR / SWAP_INSTRUCTORS  -> for each affected STATION id, rewrite
//      ONLY instructorId. arena is never touched.
//  - MOVE_PAIR / SWAP_PAIRS  -> `affected.stationIds` is AUTHORITATIVE: for EVERY
//      pair that ends up in one of those stations in `nextPlan`, rewrite its
//      stationId + sortOrder (the moved pair AND every reindexed sibling).
//      Stable pair ids are preserved - never delete/recreate to reorder.
//
// FAIL-CLOSED: if an affected id is not present in `nextPlan`, if a pair would be
// emitted twice, or if the operation tag is unrecognized, the adapter returns
// `{ ok: false }` (a malformed-success guard) - it never emits a partial or
// guessed write, and it never throws for such input. Reason strings never carry
// ids/names/PII (there is exactly one opaque failure shape).

import type {
  ComplexPlanInput,
  ComplexPlanMoveSwapAffected,
  ComplexPlanMoveSwapOperation,
} from "./move-swap";

// ---------------------------------------------------------------------------
// Closed write-plan shapes. Each array lists TARGETED row updates only; an empty
// array means "this operation class touches no rows of this kind".
// ---------------------------------------------------------------------------

/** Rewrite exactly a pair's two trainee slots (trainee/pair-content operations). */
export interface ComplexPairTraineeUpdate {
  readonly pairId: string;
  readonly trainee1Id: string | null;
  readonly trainee2Id: string | null;
}

/** Rewrite exactly a pair's horseName (horse operations). */
export interface ComplexPairHorseUpdate {
  readonly pairId: string;
  readonly horseName: string | null;
}

/** Reproduce a pair's final station placement + order (pair move/swap). Preserves
 *  the stable pair id - never a delete/recreate. */
export interface ComplexPairPlacementUpdate {
  readonly pairId: string;
  readonly stationId: string;
  readonly sortOrder: number;
}

/** Rewrite exactly a station's instructorId (instructor operations). */
export interface ComplexStationInstructorUpdate {
  readonly stationId: string;
  readonly instructorId: string | null;
}

export interface ComplexPlanWritePlan {
  readonly planId: string;
  /** The pre-write version the core validated against (== nextPlan.version). The
   *  caller re-checks it in-transaction and increments the persisted version
   *  exactly once; the adapter never fabricates a post-increment value. */
  readonly expectedVersion: number;
  readonly requiresVersionIncrement: true;
  readonly pairTraineeUpdates: readonly ComplexPairTraineeUpdate[];
  readonly pairHorseUpdates: readonly ComplexPairHorseUpdate[];
  readonly pairPlacementUpdates: readonly ComplexPairPlacementUpdate[];
  readonly stationInstructorUpdates: readonly ComplexStationInstructorUpdate[];
}

export type ComplexPlanWritePlanResult =
  | { readonly ok: true; readonly writePlan: ComplexPlanWritePlan }
  | { readonly ok: false };

const MALFORMED: ComplexPlanWritePlanResult = Object.freeze({ ok: false });

// ---------------------------------------------------------------------------
// Read-only indexes over nextPlan (built once per call; nextPlan is only read).
// ---------------------------------------------------------------------------

interface PairEntry {
  readonly pair: ComplexPlanInput["blocks"][number]["stations"][number]["pairs"][number];
  readonly stationId: string;
}

function indexPairs(plan: ComplexPlanInput): Map<string, PairEntry> {
  const map = new Map<string, PairEntry>();
  for (const block of plan.blocks) {
    for (const station of block.stations) {
      for (const pair of station.pairs) {
        // A duplicate pair id would make placement ambiguous; the core forbids
        // it, but index defensively so a duplicate collapses to one entry and is
        // caught as a mismatch below rather than silently double-emitted.
        map.set(pair.id, { pair, stationId: station.id });
      }
    }
  }
  return map;
}

function indexStations(
  plan: ComplexPlanInput
): Map<string, ComplexPlanInput["blocks"][number]["stations"][number]> {
  const map = new Map<string, ComplexPlanInput["blocks"][number]["stations"][number]>();
  for (const block of plan.blocks) {
    for (const station of block.stations) {
      map.set(station.id, station);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Convert one Stage-3A success into a closed, minimal write plan. Pure and
 * non-mutating: `nextPlan` and `affected` are only read; the returned plan and
 * its arrays are frozen. Returns `{ ok: false }` (never throws) when the success
 * shape is internally inconsistent (an affected id missing from `nextPlan`, a
 * duplicate pair emission, or an unknown operation) so the caller fails closed
 * and performs no write.
 */
export function buildComplexPlanWritePlan(
  operation: ComplexPlanMoveSwapOperation,
  nextPlan: ComplexPlanInput,
  affected: ComplexPlanMoveSwapAffected
): ComplexPlanWritePlanResult {
  if (
    typeof nextPlan?.id !== "string" ||
    nextPlan.id.length === 0 ||
    !Number.isInteger(nextPlan.version) ||
    !Array.isArray(nextPlan.blocks) ||
    !affected ||
    !Array.isArray(affected.pairIds) ||
    !Array.isArray(affected.stationIds)
  ) {
    return MALFORMED;
  }

  const base = {
    planId: nextPlan.id,
    expectedVersion: nextPlan.version,
    requiresVersionIncrement: true as const,
    pairTraineeUpdates: [] as ComplexPairTraineeUpdate[],
    pairHorseUpdates: [] as ComplexPairHorseUpdate[],
    pairPlacementUpdates: [] as ComplexPairPlacementUpdate[],
    stationInstructorUpdates: [] as ComplexStationInstructorUpdate[],
  };

  switch (operation) {
    case "MOVE_TRAINEE":
    case "SWAP_TRAINEES": {
      const pairs = indexPairs(nextPlan);
      const seen = new Set<string>();
      for (const pairId of affected.pairIds) {
        if (seen.has(pairId)) return MALFORMED;
        seen.add(pairId);
        const entry = pairs.get(pairId);
        if (!entry) return MALFORMED;
        base.pairTraineeUpdates.push({
          pairId,
          trainee1Id: entry.pair.trainee1Id,
          trainee2Id: entry.pair.trainee2Id,
        });
      }
      return done(base);
    }
    case "MOVE_HORSE":
    case "SWAP_HORSES": {
      const pairs = indexPairs(nextPlan);
      const seen = new Set<string>();
      for (const pairId of affected.pairIds) {
        if (seen.has(pairId)) return MALFORMED;
        seen.add(pairId);
        const entry = pairs.get(pairId);
        if (!entry) return MALFORMED;
        base.pairHorseUpdates.push({ pairId, horseName: entry.pair.horseName });
      }
      return done(base);
    }
    case "MOVE_INSTRUCTOR":
    case "SWAP_INSTRUCTORS": {
      const stations = indexStations(nextPlan);
      const seen = new Set<string>();
      for (const stationId of affected.stationIds) {
        if (seen.has(stationId)) return MALFORMED;
        seen.add(stationId);
        const station = stations.get(stationId);
        if (!station) return MALFORMED;
        base.stationInstructorUpdates.push({ stationId, instructorId: station.instructorId });
      }
      return done(base);
    }
    case "MOVE_PAIR":
    case "SWAP_PAIRS": {
      // affected.stationIds is authoritative: reproduce every pair placement +
      // order for those stations (moved pair AND reindexed siblings), preserving
      // stable ids. A pair emitted twice (only possible from a malformed tree)
      // fails closed.
      const stations = indexStations(nextPlan);
      const seenStations = new Set<string>();
      const seenPairs = new Set<string>();
      for (const stationId of affected.stationIds) {
        if (seenStations.has(stationId)) return MALFORMED;
        seenStations.add(stationId);
        const station = stations.get(stationId);
        if (!station) return MALFORMED;
        for (const pair of station.pairs) {
          if (seenPairs.has(pair.id)) return MALFORMED;
          seenPairs.add(pair.id);
          base.pairPlacementUpdates.push({
            pairId: pair.id,
            stationId,
            sortOrder: pair.sortOrder,
          });
        }
      }
      return done(base);
    }
    default:
      return MALFORMED;
  }
}

/** Freeze the arrays and wrapper so the returned write plan cannot be mutated. */
function done(base: {
  planId: string;
  expectedVersion: number;
  requiresVersionIncrement: true;
  pairTraineeUpdates: ComplexPairTraineeUpdate[];
  pairHorseUpdates: ComplexPairHorseUpdate[];
  pairPlacementUpdates: ComplexPairPlacementUpdate[];
  stationInstructorUpdates: ComplexStationInstructorUpdate[];
}): ComplexPlanWritePlanResult {
  const writePlan: ComplexPlanWritePlan = Object.freeze({
    planId: base.planId,
    expectedVersion: base.expectedVersion,
    requiresVersionIncrement: base.requiresVersionIncrement,
    pairTraineeUpdates: Object.freeze(base.pairTraineeUpdates.map((u) => Object.freeze(u))),
    pairHorseUpdates: Object.freeze(base.pairHorseUpdates.map((u) => Object.freeze(u))),
    pairPlacementUpdates: Object.freeze(base.pairPlacementUpdates.map((u) => Object.freeze(u))),
    stationInstructorUpdates: Object.freeze(base.stationInstructorUpdates.map((u) => Object.freeze(u))),
  });
  return Object.freeze({ ok: true, writePlan });
}
