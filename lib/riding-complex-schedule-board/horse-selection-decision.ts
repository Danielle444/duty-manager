// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.3a - horse-selection decision) - pure,
// DB-free.
//
// The single deciding function behind choosing a horse for a pair in the
// schedule-board pair editor. Given the block-scoped horse placement index
// (horse-placement-index.ts), a destination pair, the horse the user typed/picked,
// and the loaded plan version, it returns a CLOSED decision telling the future UI
// exactly what to do - WITHOUT the UI re-implementing any business rule:
//
//   - LOCAL_SELECTION . the horse is free here (or blank) -> a normal local draft
//       edit of this pair's horseName. Carries the normalized value to store.
//   - MOVE_PROPOSAL ... the horse sits on another pair in this block and the
//       destination pair currently has NO horse -> an atomic MOVE_HORSE command
//       (the exact committed Stage 3A shape) is prepared for one-tap confirmation.
//   - SWAP_PROPOSAL ... the horse sits on another pair and the destination pair
//       already HAS a horse -> an atomic SWAP_HORSES command is prepared.
//   - NO_CHANGE ....... selecting the destination pair's current horse (case/
//       whitespace-insensitive), or its own horse -> nothing to do.
//   - AMBIGUOUS ....... the horse appears on more than one pair in this block ->
//       fail closed (never guess which pair to move it from).
//   - UNAVAILABLE ..... the choice cannot be honoured (CREATE_MODE - an occupied
//       horse while the pair is not yet saved; UNRESOLVED - malformed input).
//   - STALE_TARGET .... the destination pair vanished from the loaded plan.
//
// FIELD SCOPE: a horse Move/Swap changes horseName ONLY. Trainees and the note
// stay with their pairs (the committed Stage 3A core enforces this; this decision
// never carries trainee/note data). No command is produced from a malformed,
// ambiguous, stale, local, unavailable, or no-change decision.
//
// PURITY / DORMANCY: no import of Prisma, actions, React, auth, cookies, env, or
// any server module. It imports the committed pure Move/Swap COMMAND TYPES only
// (`import type`, zero runtime dependency) and the pure horse-placement-index
// resolvers (a sibling dormant module). No runtime code imports this file in this
// stage. Deterministic and non-mutating; every returned decision (and any command
// it carries) is frozen.

import type { ComplexPlanMoveSwapCommand } from "./move-swap";
import {
  horseKey,
  horseStore,
  resolveHorsePlacement,
  resolvePairHorse,
  type HorsePlacementIndex,
} from "./horse-placement-index";

/** The exact committed MOVE_HORSE command shape (Stage 3A core). */
export type MoveHorseCommand = Extract<ComplexPlanMoveSwapCommand, { op: "MOVE_HORSE" }>;
/** The exact committed SWAP_HORSES command shape (Stage 3A core). */
export type SwapHorsesCommand = Extract<ComplexPlanMoveSwapCommand, { op: "SWAP_HORSES" }>;

/** Why a choice could not be honoured (stable, non-PII reason). */
export type HorseSelectionUnavailableReason =
  // The destination pair is not yet saved (pairId === null): an occupied horse has
  // no persisted destination to move into. Do NOT auto-save then propose.
  | "CREATE_MODE"
  // Malformed / missing decision input. Fail closed rather than guess.
  | "UNRESOLVED";

/** The closed decision union. */
export type HorseSelectionDecision =
  | { readonly kind: "LOCAL_SELECTION"; readonly horseName: string | null }
  | { readonly kind: "MOVE_PROPOSAL"; readonly command: MoveHorseCommand }
  | { readonly kind: "SWAP_PROPOSAL"; readonly command: SwapHorsesCommand }
  | { readonly kind: "NO_CHANGE" }
  | { readonly kind: "AMBIGUOUS" }
  | { readonly kind: "UNAVAILABLE"; readonly reason: HorseSelectionUnavailableReason }
  | { readonly kind: "STALE_TARGET" };

/** The inputs of one horse choice. */
export interface HorseSelectionQuery {
  /** Block-scoped horse placement index built from the SAME loaded plan snapshot. */
  readonly index: HorsePlacementIndex;
  /** The block the destination pair lives in. */
  readonly blockId: string;
  /** The destination pair id, or null in CREATE mode (pair not yet saved). */
  readonly destinationPairId: string | null;
  /** The horse the user typed/picked (raw; normalized here). */
  readonly selectedHorseName: string | null;
  /** The loaded plan's version, threaded verbatim into any proposed command. */
  readonly expectedVersion: number;
}

// ---------------------------------------------------------------------------
// Frozen singletons / builders.
// ---------------------------------------------------------------------------

const NO_CHANGE: HorseSelectionDecision = Object.freeze({ kind: "NO_CHANGE" });
const AMBIGUOUS: HorseSelectionDecision = Object.freeze({ kind: "AMBIGUOUS" });
const STALE_TARGET: HorseSelectionDecision = Object.freeze({ kind: "STALE_TARGET" });

function unavailable(reason: HorseSelectionUnavailableReason): HorseSelectionDecision {
  return Object.freeze({ kind: "UNAVAILABLE", reason });
}

function localSelection(horseName: string | null): HorseSelectionDecision {
  return Object.freeze({ kind: "LOCAL_SELECTION", horseName });
}

function isPresent(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}

// ---------------------------------------------------------------------------
// Decision.
// ---------------------------------------------------------------------------

/**
 * Decide what a single horse choice means. Pure, deterministic, and non-mutating:
 * the query and index are only read; the returned decision (and any command it
 * carries) is frozen. Never throws - malformed input fails closed as UNAVAILABLE
 * / UNRESOLVED. No command is produced on any failure, no-op, or local-selection
 * result. Decision order fails closed (see the numbered steps below).
 */
export function decideHorseSelection(query: HorseSelectionQuery): HorseSelectionDecision {
  // (0) Fail-closed input validation. A malformed shape never guesses a result.
  if (query === null || typeof query !== "object") return unavailable("UNRESOLVED");
  const { index, blockId, destinationPairId, selectedHorseName, expectedVersion } = query;
  if (index === null || typeof index !== "object" || !(index.blocks instanceof Map)) {
    return unavailable("UNRESOLVED");
  }
  if (!isPresent(blockId)) return unavailable("UNRESOLVED");
  if (!Number.isInteger(expectedVersion)) return unavailable("UNRESOLVED");
  if (destinationPairId !== null && !isPresent(destinationPairId)) return unavailable("UNRESOLVED");
  // The selected horse must be a string or null; any other runtime value is
  // malformed and never silently normalized to a blank horse.
  if (selectedHorseName !== null && typeof selectedHorseName !== "string") {
    return unavailable("UNRESOLVED");
  }

  // (1) Resolve candidate placement ambiguity: where does the SELECTED horse
  // currently sit IN THIS BLOCK?
  const placement = resolveHorsePlacement(index, blockId, selectedHorseName);
  if (placement.status === "AMBIGUOUS") return AMBIGUOUS;

  // (2) CREATE mode: no persisted destination pair. A free/blank horse may still
  // be a local draft edit; an occupied one is UNAVAILABLE (never auto-save then
  // propose).
  if (destinationPairId === null) {
    return placement.status === "OCCUPIED"
      ? unavailable("CREATE_MODE")
      : localSelection(horseStore(selectedHorseName));
  }

  // (3) Existing destination pair - it must still be resolvable in the loaded
  // plan, else the target vanished under a background refresh.
  const dest = resolvePairHorse(index, blockId, destinationPairId);
  if (dest === null) return STALE_TARGET;

  // (4/5) Normalize the destination's current horse and the selected horse.
  const destStored = horseStore(dest.horseName);
  const selStored = horseStore(selectedHorseName);
  const destKey = horseKey(destStored);
  const selKey = horseKey(selStored);

  // (6) Identical normalized key/value -> nothing to do (covers "picked the seat's
  // current horse, case/whitespace-equivalent" and "blank on an already-empty
  // pair"). Checked before local/proposal branches so it never becomes a self-move.
  if (selKey === destKey) return NO_CHANGE;

  // (7) Blank selected horse -> a normal local clear of this pair's horse.
  if (selStored === null) return localSelection(null);

  // (8) A free horse -> a normal local draft selection (trimmed, case preserved).
  if (placement.status === "FREE") return localSelection(selStored);

  // (9/10/11) Occupied elsewhere in this block -> an explicit atomic proposal
  // carrying the exact committed Stage 3A command (no extra fields, exact
  // expectedVersion). The source pair === destination pair guard is defensive:
  // that case already resolved to NO_CHANGE at step (6).
  const sourcePairId = placement.pairId;
  if (sourcePairId === destinationPairId) return NO_CHANGE;

  if (destStored === null) {
    const command: MoveHorseCommand = Object.freeze({
      op: "MOVE_HORSE",
      expectedVersion,
      sourcePairId,
      destinationPairId,
    });
    return Object.freeze({ kind: "MOVE_PROPOSAL", command });
  }

  const command: SwapHorsesCommand = Object.freeze({
    op: "SWAP_HORSES",
    expectedVersion,
    aPairId: sourcePairId,
    bPairId: destinationPairId,
  });
  return Object.freeze({ kind: "SWAP_PROPOSAL", command });
}
