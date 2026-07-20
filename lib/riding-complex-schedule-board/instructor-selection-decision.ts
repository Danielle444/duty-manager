// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.3b - instructor-selection decision) -
// pure, DB-free.
//
// The single deciding function behind choosing an instructor for a station in the
// schedule-board station editor. Given the block-scoped instructor placement index
// (instructor-placement-index.ts), a destination station, the instructor the user
// picked, and the loaded plan version, it returns a CLOSED decision telling the
// future UI exactly what to do - WITHOUT the UI re-implementing any business rule.
// It mirrors the sibling horse-selection-decision.ts, adapted to instructor
// identity and station-level placement:
//
//   - LOCAL_SELECTION . the instructor is free here (or blank) -> a normal local
//       draft edit of this station's instructorId. Carries the value to store.
//   - MOVE_PROPOSAL ... the instructor staffs another station in this block and the
//       destination station currently has NO instructor -> an atomic
//       MOVE_INSTRUCTOR command (the exact committed Stage 3A shape) is prepared for
//       one-tap confirmation.
//   - SWAP_PROPOSAL ... the instructor staffs another station and the destination
//       station already HAS an instructor -> an atomic SWAP_INSTRUCTORS command is
//       prepared.
//   - NO_CHANGE ....... selecting the destination station's current instructor, or
//       its own instructor -> nothing to do.
//   - AMBIGUOUS ....... the instructor staffs more than one station in this block ->
//       fail closed (never guess which station to move it from).
//   - UNAVAILABLE ..... the choice cannot be honoured (CREATE_MODE - an occupied
//       instructor while the station is not yet saved; UNRESOLVED - malformed input).
//   - STALE_TARGET .... the destination station vanished from the loaded plan.
//
// FIELD SCOPE: an instructor Move/Swap changes station.instructorId ONLY. The arena
// and every pair stay attached to their existing stations (the committed Stage 3A
// core enforces this; this decision never carries arena/pair/trainee data). No
// command is produced from a malformed, ambiguous, stale, local, unavailable, or
// no-change decision.
//
// INSTRUCTOR IDENTITY: the existing stable instructorId, used verbatim (never
// trimmed/case-folded; a blank value is a valid unassigned station). No other
// identity is invented.
//
// PURITY / DORMANCY: no import of Prisma, actions, React, auth, cookies, env, or
// any server module. It imports the committed pure Move/Swap COMMAND TYPES only
// (`import type`, zero runtime dependency) and the pure instructor-placement-index
// resolvers (a sibling dormant module). No runtime code imports this file in this
// stage. Deterministic and non-mutating; every returned decision (and any command
// it carries) is frozen.

import type { ComplexPlanMoveSwapCommand } from "./move-swap";
import {
  normalizeInstructorId,
  resolveInstructorPlacement,
  resolveStationInstructor,
  type InstructorPlacementIndex,
} from "./instructor-placement-index";

/** The exact committed MOVE_INSTRUCTOR command shape (Stage 3A core). */
export type MoveInstructorCommand = Extract<ComplexPlanMoveSwapCommand, { op: "MOVE_INSTRUCTOR" }>;
/** The exact committed SWAP_INSTRUCTORS command shape (Stage 3A core). */
export type SwapInstructorsCommand = Extract<ComplexPlanMoveSwapCommand, { op: "SWAP_INSTRUCTORS" }>;

/** Why a choice could not be honoured (stable, non-PII reason). */
export type InstructorSelectionUnavailableReason =
  // The destination station is not yet saved (stationId === null): an occupied
  // instructor has no persisted destination to move into. Do NOT auto-save then
  // propose.
  | "CREATE_MODE"
  // Malformed / missing decision input. Fail closed rather than guess.
  | "UNRESOLVED";

/** The closed decision union. */
export type InstructorSelectionDecision =
  | { readonly kind: "LOCAL_SELECTION"; readonly instructorId: string | null }
  | { readonly kind: "MOVE_PROPOSAL"; readonly command: MoveInstructorCommand }
  | { readonly kind: "SWAP_PROPOSAL"; readonly command: SwapInstructorsCommand }
  | { readonly kind: "NO_CHANGE" }
  | { readonly kind: "AMBIGUOUS" }
  | { readonly kind: "UNAVAILABLE"; readonly reason: InstructorSelectionUnavailableReason }
  | { readonly kind: "STALE_TARGET" };

/** The inputs of one instructor choice. */
export interface InstructorSelectionQuery {
  /** Block-scoped instructor placement index built from the SAME loaded snapshot. */
  readonly index: InstructorPlacementIndex;
  /** The block the destination station lives in. */
  readonly blockId: string;
  /** The destination station id, or null in CREATE mode (station not yet saved). */
  readonly destinationStationId: string | null;
  /** The instructor the user picked (raw; blank-normalized here). */
  readonly selectedInstructorId: string | null;
  /** The loaded plan's version, threaded verbatim into any proposed command. */
  readonly expectedVersion: number;
}

// ---------------------------------------------------------------------------
// Frozen singletons / builders.
// ---------------------------------------------------------------------------

const NO_CHANGE: InstructorSelectionDecision = Object.freeze({ kind: "NO_CHANGE" });
const AMBIGUOUS: InstructorSelectionDecision = Object.freeze({ kind: "AMBIGUOUS" });
const STALE_TARGET: InstructorSelectionDecision = Object.freeze({ kind: "STALE_TARGET" });

function unavailable(reason: InstructorSelectionUnavailableReason): InstructorSelectionDecision {
  return Object.freeze({ kind: "UNAVAILABLE", reason });
}

function localSelection(instructorId: string | null): InstructorSelectionDecision {
  return Object.freeze({ kind: "LOCAL_SELECTION", instructorId });
}

function isPresent(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}

// ---------------------------------------------------------------------------
// Decision.
// ---------------------------------------------------------------------------

/**
 * Decide what a single instructor choice means. Pure, deterministic, and non-
 * mutating: the query and index are only read; the returned decision (and any
 * command it carries) is frozen. Never throws - malformed input fails closed as
 * UNAVAILABLE / UNRESOLVED. No command is produced on any failure, no-op, or
 * local-selection result. Decision order fails closed (see the numbered steps).
 */
export function decideInstructorSelection(
  query: InstructorSelectionQuery
): InstructorSelectionDecision {
  // (0/1) Fail-closed input validation. A malformed shape never guesses a result.
  if (query === null || typeof query !== "object") return unavailable("UNRESOLVED");
  const { index, blockId, destinationStationId, selectedInstructorId, expectedVersion } = query;
  if (index === null || typeof index !== "object" || !(index.blocks instanceof Map)) {
    return unavailable("UNRESOLVED");
  }
  if (!isPresent(blockId)) return unavailable("UNRESOLVED");
  if (!Number.isInteger(expectedVersion)) return unavailable("UNRESOLVED");
  if (destinationStationId !== null && !isPresent(destinationStationId)) {
    return unavailable("UNRESOLVED");
  }
  // The selected instructor must be a string or null; any other runtime value is
  // malformed and never silently normalized to a blank instructor.
  if (selectedInstructorId !== null && typeof selectedInstructorId !== "string") {
    return unavailable("UNRESOLVED");
  }

  // (2) Resolve candidate placement ambiguity: where does the SELECTED instructor
  // currently sit IN THIS BLOCK?
  const placement = resolveInstructorPlacement(index, blockId, selectedInstructorId);
  if (placement.status === "AMBIGUOUS") return AMBIGUOUS;

  // (3) CREATE mode: no persisted destination station. A free/blank instructor may
  // still be a local draft edit; an occupied one is UNAVAILABLE (never auto-save
  // then propose).
  if (destinationStationId === null) {
    return placement.status === "OCCUPIED"
      ? unavailable("CREATE_MODE")
      : localSelection(normalizeInstructorId(selectedInstructorId));
  }

  // (4) Existing destination station - it must still be resolvable in the loaded
  // plan, else the target vanished under a background refresh.
  const dest = resolveStationInstructor(index, blockId, destinationStationId);
  if (dest === null) return STALE_TARGET;

  // (5) Normalize the destination's current instructor and the selected instructor.
  // The destination id is already normalized at build time; the selected id is
  // normalized here (blank -> null; else verbatim).
  const destStored = dest.instructorId;
  const selKey = normalizeInstructorId(selectedInstructorId);
  const destKey = normalizeInstructorId(destStored);

  // Identical id -> nothing to do (covers "picked the station's current instructor"
  // and "blank on an already-empty station"). Checked before local/proposal
  // branches so it never becomes a self-move.
  if (selKey === destKey) return NO_CHANGE;

  // (6) Blank selected instructor -> a normal local clear of this station's
  // instructor.
  if (selKey === null) return localSelection(null);

  // (7) A free instructor -> a normal local draft selection (verbatim id).
  if (placement.status === "FREE") return localSelection(selKey);

  // (8/9/10) Occupied elsewhere in this block -> an explicit atomic proposal
  // carrying the exact committed Stage 3A command (no extra fields, exact
  // expectedVersion). The source station === destination station guard is
  // defensive: that case already resolved to NO_CHANGE at step (5).
  const sourceStationId = placement.stationId;
  if (sourceStationId === destinationStationId) return NO_CHANGE;

  if (destStored === null) {
    const command: MoveInstructorCommand = Object.freeze({
      op: "MOVE_INSTRUCTOR",
      expectedVersion,
      sourceStationId,
      destinationStationId,
    });
    return Object.freeze({ kind: "MOVE_PROPOSAL", command });
  }

  const command: SwapInstructorsCommand = Object.freeze({
    op: "SWAP_INSTRUCTORS",
    expectedVersion,
    aStationId: sourceStationId,
    bStationId: destinationStationId,
  });
  return Object.freeze({ kind: "SWAP_PROPOSAL", command });
}
