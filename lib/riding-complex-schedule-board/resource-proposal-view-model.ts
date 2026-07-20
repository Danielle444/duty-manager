// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.3a - resource proposal view model) -
// pure, DB-free.
//
// A small pure mapper for the future horse Move/Swap confirmation UI. It turns a
// prepared MOVE_HORSE / SWAP_HORSES proposal (a decision from the horse-selection
// core, or the exact committed horse command) plus the CALLER-SUPPLIED, already-
// visible display labels (horse names, pair labels) into safe Hebrew confirmation
// copy: a title, "before"/"after" descriptions, and confirm/cancel labels.
//
// It invents no data and reads no names off the command. The internal command
// survives ONLY in a separate, non-display `command` field so the future caller
// can still execute the confirmed proposal.
//
// STRICT INPUT CONTRACT / FAILURE CHANNEL: the builder returns
// `ResourceProposalViewModel | null`. It renders copy ONLY for a structurally
// valid horse proposal - a bare `MOVE_HORSE`/`SWAP_HORSES` command, or a wrapped
// `{kind:"horse-move", command.op:"MOVE_HORSE"}` / `{kind:"horse-swap",
// command.op:"SWAP_HORSES"}` whose kind and op AGREE. Every other runtime value
// (unknown op; a trainee/instructor/pair command; an unknown wrapped kind; a
// kind/command mismatch; null/undefined/array/primitive/shapeless object; a
// missing/non-integer expectedVersion; a missing/blank required pair id) yields
// `null` - NEVER misleading copy, and NEVER a silent Move->Swap reinterpretation.
// This is the minimum structural validation needed to render the correct proposal
// safely; it does NOT re-run Stage 3A business validation (block scope, occupancy,
// duplicates) - the pure core already owns that.
//
// FUTURE EXTENSION POINT: this module is deliberately named for RESOURCES (horse,
// and later instructor). Only the horse builder exists in this stage. When
// instructor Move/Swap reaches its UI stage, add its builder + `"instructor-move"
// / "instructor-swap"` kinds alongside the horse builder here - NO instructor
// logic is added now (it would be dead code).
//
// PRIVACY (enforced by tests): NO blockId, pairId, plan id, or version - and no
// internal command field - ever appears in a rendered string. The command is
// NEVER stringified or interpolated. Caller labels are treated purely as display
// labels; generic Hebrew fallbacks are used when a label is absent. No trainee
// ids, note content, feedback, audit, or publication data is touched.
//
// PURITY / DORMANCY: imports the committed pure command TYPES only (`import type`,
// zero runtime dependency); no Prisma/actions/React/auth/cookies/env/server
// import; no runtime code imports this file in this stage. Deterministic, non-
// mutating, and returns frozen results.

import type { ComplexPlanMoveSwapCommand } from "./move-swap";

type MoveHorseCommand = Extract<ComplexPlanMoveSwapCommand, { op: "MOVE_HORSE" }>;
type SwapHorsesCommand = Extract<ComplexPlanMoveSwapCommand, { op: "SWAP_HORSES" }>;

// ---------------------------------------------------------------------------
// Input: a prepared horse proposal (wrapped decision) OR the bare committed
// command. `command` is the ONLY carrier of internal ids and is never reflected
// into display copy.
// ---------------------------------------------------------------------------

/** A prepared horse Move/Swap proposal, either wrapped or as the bare command. */
export type HorseProposalInput =
  | { readonly kind: "horse-move"; readonly command: MoveHorseCommand }
  | { readonly kind: "horse-swap"; readonly command: SwapHorsesCommand }
  | MoveHorseCommand
  | SwapHorsesCommand;

/**
 * Safe, already-visible display labels supplied by the caller. Every field is
 * optional/nullable; a missing (or whitespace-only) value falls back to a generic
 * Hebrew label. These are the ONLY sources of names in the output.
 */
export interface HorseProposalDisplayLabels {
  /** The horse being moved/swapped (the selected horse). */
  readonly selectedHorseName?: string | null;
  /** The horse currently on the destination pair (swap only). */
  readonly destinationHorseName?: string | null;
  /** A label for the pair the horse currently sits on. */
  readonly sourcePairLabel?: string | null;
  /** A label for the destination pair. */
  readonly destinationPairLabel?: string | null;
}

/** The safe confirmation view model. `command` is a NON-DISPLAY field. */
export interface ResourceProposalViewModel {
  readonly kind: "horse-move" | "horse-swap";
  readonly title: string;
  readonly before: string;
  readonly after: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /** Non-display: retained solely so the future caller can execute the confirmed
   *  proposal. May contain internal ids; never rendered. */
  readonly command: MoveHorseCommand | SwapHorsesCommand;
}

const HORSE_FALLBACK = "הסוס";
const DEST_HORSE_FALLBACK = "הסוס האחר";
const SOURCE_PAIR_FALLBACK = "הזוג הנוכחי";
const DEST_PAIR_FALLBACK = "הזוג הנבחר";
const CANCEL_LABEL = "ביטול";
const MOVE_STABLE = "החניכים וההערה נשארים במקומם.";
const SWAP_STABLE = "החניכים וההערות נשארים במקומם.";

/** A caller label if it is a non-blank string, else the generic fallback. */
function safeLabel(value: string | null | undefined, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

type NormalizedProposal =
  | { readonly kind: "horse-move"; readonly command: MoveHorseCommand }
  | { readonly kind: "horse-swap"; readonly command: SwapHorsesCommand };

/** A plain (non-array) object narrowed to a string-keyed record, else null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** A present, non-empty string id (rejects missing/blank/non-string). */
function isPresentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Exactly a structurally valid MOVE_HORSE command (op + integer version + both
 *  present pair ids). Nothing beyond what rendering the move copy requires. */
function isMoveHorseCommand(record: Record<string, unknown>): record is MoveHorseCommand {
  return (
    record.op === "MOVE_HORSE" &&
    Number.isInteger(record.expectedVersion) &&
    isPresentId(record.sourcePairId) &&
    isPresentId(record.destinationPairId)
  );
}

/** Exactly a structurally valid SWAP_HORSES command. */
function isSwapHorsesCommand(record: Record<string, unknown>): record is SwapHorsesCommand {
  return (
    record.op === "SWAP_HORSES" &&
    Number.isInteger(record.expectedVersion) &&
    isPresentId(record.aPairId) &&
    isPresentId(record.bPairId)
  );
}

/**
 * Strictly normalize the wrapped-or-bare input into a discriminated
 * { kind, command }, or null when it is not exactly one of the four accepted
 * horse shapes. Fail-closed and non-throwing: an unknown op, a wrong-resource
 * command, an unknown wrapped kind, a kind/command mismatch, or any malformed
 * shape returns null - never a guessed Move/Swap. Only READS the input (the
 * returned command is the caller's own object reference, unfrozen and unmutated).
 */
function normalize(input: unknown): NormalizedProposal | null {
  const record = asRecord(input);
  if (record === null) return null;

  // Bare command form: carries its own `op`. A trainee/instructor/pair/unknown op
  // simply fails both guards below and returns null.
  if ("op" in record) {
    if (isMoveHorseCommand(record)) return { kind: "horse-move", command: record };
    if (isSwapHorsesCommand(record)) return { kind: "horse-swap", command: record };
    return null;
  }

  // Wrapped form: { kind, command }. The kind and the command's op must AGREE.
  const command = asRecord(record.command);
  if (command === null) return null;
  if (record.kind === "horse-move" && isMoveHorseCommand(command)) {
    return { kind: "horse-move", command };
  }
  if (record.kind === "horse-swap" && isSwapHorsesCommand(command)) {
    return { kind: "horse-swap", command };
  }
  return null;
}

/**
 * Build safe Hebrew confirmation copy for a horse Move/Swap proposal. Pure,
 * deterministic, and non-throwing. Returns a frozen view model for a structurally
 * valid horse proposal, or `null` for any invalid/mismatched input (see the strict
 * input contract in the module header) - the explicit failure channel a caller
 * uses to refuse rendering misleading copy. Only the supplied display labels (or
 * their generic fallbacks) appear in the copy - never any id from `command`, which
 * is neither stringified nor interpolated. The mandatory "trainees/notes remain in
 * place" reassurance is always included.
 */
export function buildHorseProposalViewModel(
  proposal: HorseProposalInput,
  labels: HorseProposalDisplayLabels
): ResourceProposalViewModel | null {
  const normalized = normalize(proposal);
  if (normalized === null) return null;
  const { kind, command } = normalized;
  const horse = safeLabel(labels.selectedHorseName, HORSE_FALLBACK);
  const sourcePair = safeLabel(labels.sourcePairLabel, SOURCE_PAIR_FALLBACK);
  const destinationPair = safeLabel(labels.destinationPairLabel, DEST_PAIR_FALLBACK);

  if (kind === "horse-move") {
    return Object.freeze({
      kind: "horse-move",
      title: "העברת סוס",
      before: `כעת: ${horse} — ${sourcePair}`,
      after: `לאחר האישור: ${horse} — ${destinationPair}. ${MOVE_STABLE}`,
      confirmLabel: "אישור העברה",
      cancelLabel: CANCEL_LABEL,
      command,
    });
  }

  const destHorse = safeLabel(labels.destinationHorseName, DEST_HORSE_FALLBACK);
  return Object.freeze({
    kind: "horse-swap",
    title: "החלפת סוסים",
    before: `כעת: ${horse} — ${sourcePair} | ${destHorse} — ${destinationPair}`,
    after: `לאחר האישור: ${destHorse} — ${sourcePair} | ${horse} — ${destinationPair}. ${SWAP_STABLE}`,
    confirmLabel: "אישור החלפה",
    cancelLabel: CANCEL_LABEL,
    command,
  });
}
