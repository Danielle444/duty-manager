// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.2 - trainee Move/Swap UI orchestration)
// - pure, DB-free.
//
// The smallest extractable orchestration glue between the schedule-board pair
// editor's two trainee-selection surfaces (the searchable TraineePicker
// dropdowns and the full-list ContextualPairPicker) and the committed Stage 3C.1
// decision core. It exists so the React component never re-implements a business
// rule: it hands raw click inputs here and receives a closed decision / a ready
// proposal input / safe display labels back.
//
// It composes ONLY the already-committed pure cores:
//   - decideTraineeSelection (trainee-selection-decision.ts) - the single deciding
//     function; this module never re-derives free/occupied/move/swap logic;
//   - resolvePairOccupants (placement-index.ts) - to pick a destination seat for
//     the slot-less full-list gesture, and to resolve a swap's occupant name;
//   - buildProposalViewModel's ProposalInput / ProposalDisplayLabels shapes
//     (proposal-view-model.ts, type-only) - so the component builds the exact
//     confirmation view model with no duplicated copy.
//
// PURITY / DORMANCY: no import of Prisma, actions, React, auth, cookies, env, or
// any server module. Imports the committed pure cores' runtime resolvers and
// their types only. Deterministic and non-mutating; every returned object is
// plain data. NO id ever appears in the display labels it produces (only
// caller-supplied, already-visible names / station labels), matching the Stage
// 3C.1 proposal-view-model privacy contract.

import {
  resolvePairOccupants,
  resolveTraineePlacement,
  type PairOccupants,
  type TraineePlacementIndex,
  type TraineeSlot,
} from "./placement-index";
import {
  decideTraineeSelection,
  type TraineeSelectionDecision,
} from "./trainee-selection-decision";
import type { ProposalDisplayLabels, ProposalInput } from "./proposal-view-model";

// ---------------------------------------------------------------------------
// (1) Empty-seat resolution for the SLOT-LESS full-list selector.
// ---------------------------------------------------------------------------

/**
 * Which EMPTY destination seat a full-list "bring this trainee into the pair"
 * gesture should fill when the click resolves to a MOVE:
 *   - both seats empty  -> seat 1 (the unique valid first position);
 *   - otherwise         -> seat 2.
 * It is NEVER used to pick between two OCCUPIED seats: a destination pair whose
 * BOTH seats are held is refused UPSTREAM (EXPLICIT_SLOT_REQUIRED) before this is
 * consulted, so it never silently targets an occupant. A malformed pair (seat 1
 * empty while seat 2 is held) resolves to seat 2 so the decision core fails
 * closed (INVALID_PAIR_POSITION) rather than canonicalizing into the empty seat
 * 1. Pure and deterministic.
 */
export function resolveFullListDestinationSlot(occupants: PairOccupants): TraineeSlot {
  return occupants.trainee1Id === null && occupants.trainee2Id === null ? 1 : 2;
}

// ---------------------------------------------------------------------------
// (2) Full-list click -> decision. Free / own-pair / ambiguous candidates and
// every MOVE into an EMPTY seat delegate to the ONE committed decision core; the
// component maps LOCAL_SELECTION / NO_CHANGE to a checkbox toggle and the MOVE
// proposal to a confirmation, so occupied candidates never enter the checkbox
// selection. The single new orchestration outcome is EXPLICIT_SLOT_REQUIRED:
// clicking an occupied trainee onto a pair whose BOTH seats are held would need a
// swap, and the full-list gesture carries no seat - so no command is produced and
// the user is asked to pick via the explicit חניך 1 / חניך 2 dropdowns.
// ---------------------------------------------------------------------------

export interface FullListClickInput {
  readonly index: TraineePlacementIndex;
  readonly blockId: string;
  readonly candidateTraineeId: string;
  /** The destination pair id, or null in CREATE mode (pair not yet saved). */
  readonly destinationPairId: string | null;
  readonly expectedVersion: number;
}

/**
 * The full-list click decision: the committed Stage 3C.1 decision, plus one
 * orchestration-only refusal, EXPLICIT_SLOT_REQUIRED, raised when an occupied
 * trainee is clicked onto a destination pair whose BOTH seats are held. This adds
 * NO variant to the Stage 3C.1 / Stage 3A types and produces NO command; it is a
 * non-action decision meaning "an explicit destination seat is required".
 */
export type FullListTraineeDecision =
  | TraineeSelectionDecision
  | { readonly kind: "EXPLICIT_SLOT_REQUIRED" };

const EXPLICIT_SLOT_REQUIRED: FullListTraineeDecision = Object.freeze({ kind: "EXPLICIT_SLOT_REQUIRED" });

/**
 * Decide what a full-list trainee-row click means. NEVER chooses a destination
 * seat arbitrarily: a click that would require a swap against a fully occupied
 * pair returns EXPLICIT_SLOT_REQUIRED (no command); every other case resolves the
 * unique valid empty seat (or a fail-closed seat) and defers to the committed
 * decision core. Pure and deterministic.
 */
export function decideFullListTraineeClick(input: FullListClickInput): FullListTraineeDecision {
  // CREATE mode (pair not yet saved): the seat is irrelevant - the decision core
  // short-circuits on a null destination pair (occupied -> CREATE_MODE, free ->
  // LOCAL_SELECTION). Delegate with a placeholder seat.
  if (input.destinationPairId === null) {
    return decideTraineeSelection({
      index: input.index,
      blockId: input.blockId,
      candidateTraineeId: input.candidateTraineeId,
      destinationPairId: null,
      destinationSlot: 1,
      expectedVersion: input.expectedVersion,
    });
  }

  const occupants = resolvePairOccupants(input.index, input.blockId, input.destinationPairId);
  // A vanished / ambiguously-duplicated destination pair: defer to the core,
  // which reports STALE_TARGET. Seat is irrelevant.
  if (occupants === null) {
    return decideTraineeSelection({
      index: input.index,
      blockId: input.blockId,
      candidateTraineeId: input.candidateTraineeId,
      destinationPairId: input.destinationPairId,
      destinationSlot: 1,
      expectedVersion: input.expectedVersion,
    });
  }

  // Only an occupied-ELSEWHERE candidate can become a MOVE/SWAP; a free / own-pair
  // / ambiguous candidate is a checkbox toggle / no-op the seat does not affect.
  // When such a candidate is clicked onto a pair whose BOTH seats are held, a swap
  // would be required - and the full-list gesture cannot say WHICH occupant. Do
  // not guess: refuse and ask for an explicit seat, producing no command.
  const placement = resolveTraineePlacement(input.index, input.blockId, input.candidateTraineeId);
  const occupiedElsewhere =
    placement.status === "OCCUPIED" && placement.at.pairId !== input.destinationPairId;
  const bothSeatsHeld = occupants.trainee1Id !== null && occupants.trainee2Id !== null;
  if (occupiedElsewhere && bothSeatsHeld) {
    return EXPLICIT_SLOT_REQUIRED;
  }

  // Resolve the unique valid EMPTY destination seat (never a choice between two
  // occupied seats - handled above) and delegate to the ONE decision core, which
  // validates, builds any command, and fails closed on a malformed shape.
  const destinationSlot = resolveFullListDestinationSlot(occupants);
  return decideTraineeSelection({
    index: input.index,
    blockId: input.blockId,
    candidateTraineeId: input.candidateTraineeId,
    destinationPairId: input.destinationPairId,
    destinationSlot,
    expectedVersion: input.expectedVersion,
  });
}

// ---------------------------------------------------------------------------
// (3) Decision -> proposal input. Maps a MOVE/SWAP decision to the exact
// ProposalInput buildProposalViewModel consumes, carrying the committed command
// UNCHANGED. Returns null for every non-proposal decision (including
// EXPLICIT_SLOT_REQUIRED) so the caller never fabricates a command of its own.
// ---------------------------------------------------------------------------

export function decisionToProposalInput(decision: FullListTraineeDecision): ProposalInput | null {
  if (decision.kind === "MOVE_PROPOSAL") return { kind: "move", command: decision.command };
  if (decision.kind === "SWAP_PROPOSAL") return { kind: "swap", command: decision.command };
  return null;
}

// ---------------------------------------------------------------------------
// (4) Safe display labels for the confirmation view model. Reads ONLY
// caller-supplied, already-visible names (a trainee-name map, a station-label
// map) and the clicked candidate's name - never an id. The swap occupant is
// resolved from the destination seat via the placement index (an id lookup used
// purely to find the OTHER trainee's NAME; the id itself is never emitted).
// ---------------------------------------------------------------------------

export interface MoveSwapLabelInputs {
  readonly index: TraineePlacementIndex;
  readonly blockId: string;
  /** The clicked trainee's already-visible display name. */
  readonly candidateTraineeName: string | null;
  /** studentId -> already-visible trainee name (never emitted as an id). */
  readonly traineeNames: ReadonlyMap<string, string>;
  /** pairId -> an already-visible station label (coach / arena / time range). */
  readonly stationLabels: ReadonlyMap<string, string>;
}

function seatOccupantId(occupants: PairOccupants | null, slot: "trainee1" | "trainee2"): string | null {
  if (!occupants) return null;
  return slot === "trainee1" ? occupants.trainee1Id : occupants.trainee2Id;
}

/**
 * Build the safe Hebrew ProposalDisplayLabels for a prepared Move/Swap proposal.
 * Pure and deterministic. Every value is a caller-supplied name / label or a
 * generic fallback resolved inside buildProposalViewModel - NO id, version, or
 * other internal reference is ever placed in the returned labels.
 */
export function buildMoveSwapProposalLabels(
  proposal: ProposalInput,
  inputs: MoveSwapLabelInputs
): ProposalDisplayLabels {
  if (proposal.kind === "move") {
    const { source, destination } = proposal.command;
    return {
      candidateTraineeName: inputs.candidateTraineeName ?? null,
      occupantTraineeName: null,
      sourceStationLabel: inputs.stationLabels.get(source.pairId) ?? null,
      destinationStationLabel: inputs.stationLabels.get(destination.pairId) ?? null,
    };
  }

  const { a, b } = proposal.command;
  const destOccupants = resolvePairOccupants(inputs.index, inputs.blockId, b.pairId);
  const occupantId = seatOccupantId(destOccupants, b.slot);
  return {
    candidateTraineeName: inputs.candidateTraineeName ?? null,
    occupantTraineeName: occupantId !== null ? (inputs.traineeNames.get(occupantId) ?? null) : null,
    sourceStationLabel: inputs.stationLabels.get(a.pairId) ?? null,
    destinationStationLabel: inputs.stationLabels.get(b.pairId) ?? null,
  };
}
