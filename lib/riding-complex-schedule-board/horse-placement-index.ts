// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.3a - horse placement index) - pure,
// DB-free.
//
// A deterministic, BLOCK-SCOPED index of which HORSE currently occupies which
// pair inside one already-loaded complex riding plan, plus a resolver for the
// horse currently stored on one pair. It exists so the horse selector (a future
// stage) can tell a FREE horse (safe to set locally as a normal draft edit) from
// one already OCCUPIED by another pair (which must instead become an explicit
// Move/Swap proposal) without re-deriving that logic in the UI.
//
// This module performs NO Prisma/DB/action/auth/React/env/cookie/clock/random/
// revalidation work and imports nothing. It is DORMANT: no runtime code imports
// it in this stage. It reads only its narrow, structural input descriptor.
//
// SCOPE / SEMANTICS (mirrors the committed Stage 3A Move/Swap core):
//  - Uniqueness is BLOCK-scoped. The SAME horse name appearing in a DIFFERENT
//    block does NOT count as occupied in the block being queried (a horse legit-
//    imately reappears across blocks/time slots). Only the queried block's rows
//    are consulted.
//  - A horse whose normalized key appears MORE THAN ONCE inside the SAME block
//    resolves to AMBIGUOUS - never to an arbitrarily-chosen occurrence. The caller
//    must fail closed rather than guess which pair to move from.
//  - This index concerns HORSE PLACEMENT ONLY. No trainees, instructors, names,
//    notes, feedback, publication, audit fields, Prisma types, or UI types.
//
// HORSE IDENTITY (matches the committed Stage 3A / saveComplexStationInternal
// contract): there is no stable Horse id and none is invented. The STORED /
// DISPLAY value of a horse is the trimmed string, whitespace-only -> null, case
// PRESERVED. The UNIQUENESS key is that stored value lower-cased
// (trim().toLowerCase()). Occupancy is keyed by the uniqueness key; the OCCUPIED
// result carries back the exact stored (case-preserved) value.
//
// FAIL-CLOSED / PURITY: malformed, null, or sparse rows are skipped and NEVER
// throw - a pair with a malformed id or a non-string/non-null horseName registers
// NOTHING (neither horse occupancy nor a pair-horse entry), so it can never
// masquerade as a resolvable placement or an empty destination. Caller-owned
// inputs are only READ - never mutated or frozen. The returned index and the
// small result objects it hands back ARE frozen (the committed core's defence-in-
// depth convention).

// ---------------------------------------------------------------------------
// Narrow, readonly input descriptor (the smallest slice of a loaded plan needed
// to place horses). Stations appear ONLY as structural containers of pairs.
// Deliberately excludes every field unrelated to horse placement.
// ---------------------------------------------------------------------------

/** One pair: its stable id and the stored horse name (nullable plain string). */
export interface HorsePlacementPairInput {
  readonly id: string;
  readonly horseName: string | null;
}

/** One station: a structural container of ordered pairs (no id needed here). */
export interface HorsePlacementStationInput {
  readonly pairs: readonly HorsePlacementPairInput[];
}

/** One time block: its stable id and ordered stations. */
export interface HorsePlacementBlockInput {
  readonly id: string;
  readonly stations: readonly HorsePlacementStationInput[];
}

/** The loaded plan reduced to its blocks (no version/id needed for placement). */
export interface HorsePlacementPlanInput {
  readonly blocks: readonly HorsePlacementBlockInput[];
}

// ---------------------------------------------------------------------------
// Result shapes.
// ---------------------------------------------------------------------------

/**
 * The placement of one candidate horse within ONE block:
 *  - FREE ...... no pair in this block holds that horse (it may still be held in
 *      another block - that does not count here; a blank/absent candidate is FREE).
 *  - OCCUPIED .. exactly one pair in this block holds that horse, at `pairId`,
 *      whose exact stored (case-preserved) value is `horseName`.
 *  - AMBIGUOUS . more than one pair in this block holds that normalized horse; the
 *      caller must fail closed rather than pick an occurrence.
 */
export type HorsePlacement =
  | { readonly status: "FREE" }
  | { readonly status: "OCCUPIED"; readonly pairId: string; readonly horseName: string }
  | { readonly status: "AMBIGUOUS" };

/** The horse currently stored on one pair (stored/display value, or null). */
export interface PairHorse {
  readonly horseName: string | null;
}

// ---------------------------------------------------------------------------
// Opaque index handle. Treat as opaque - resolve only through the exported
// functions below. (Its internal maps are never exposed for mutation and are
// never mutated after `buildHorsePlacementIndex` returns.)
// ---------------------------------------------------------------------------

/** The stored occupancy of a horse within a block (pairId + case-preserved name). */
interface HorseOccupancy {
  readonly pairId: string;
  readonly horseName: string;
}

/** Marks a within-block duplicate (horse key or pair id) as unresolvable. */
const AMBIGUOUS: unique symbol = Symbol("ambiguous");
type Ambiguous = typeof AMBIGUOUS;

interface BlockIndex {
  /** horseKey -> its single occupancy, or AMBIGUOUS when duplicated in-block. */
  readonly horses: Map<string, HorseOccupancy | Ambiguous>;
  /** pairId -> its stored horse, or AMBIGUOUS when the pair id repeats in-block. */
  readonly pairs: Map<string, PairHorse | Ambiguous>;
}

export interface HorsePlacementIndex {
  readonly blocks: Map<string, BlockIndex>;
}

// ---------------------------------------------------------------------------
// Small defensive readers / normalizers (a malformed value fails closed; nothing
// throws). horseStore / horseKey reproduce the committed Stage 3A contract.
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** A required, non-empty string id (rejects "" and non-strings). */
function readId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The STORED form of a horse name: trimmed, whitespace-only -> null, case
 *  preserved. A non-string (except null/undefined) is not a valid horse value. */
export function horseStore(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** The case-insensitive uniqueness key for a horse name (trim + lower). Matches
 *  saveComplexStationInternal's pair.horseName.trim().toLowerCase(). */
export function horseKey(value: string | null): string | null {
  const stored = horseStore(value);
  return stored === null ? null : stored.toLowerCase();
}

/**
 * STRICT horse read, matching the committed Stage 3A core's readNullableString
 * contract (a non-null, non-string horseName is MALFORMED, never silently
 * normalized to an empty horse):
 *  - null / undefined -> a valid EMPTY horse (stored: null);
 *  - a string -> stored form (trim; whitespace-only -> null; case preserved);
 *  - any non-null, non-string runtime value -> malformed (ok: false).
 */
type HorseRead = { ok: true; stored: string | null } | { ok: false };

function readHorse(value: unknown): HorseRead {
  if (value === null || value === undefined) return { ok: true, stored: null };
  if (typeof value === "string") return { ok: true, stored: horseStore(value) };
  return { ok: false };
}

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------

/** Record one horse occurrence into a block, escalating to AMBIGUOUS on any
 *  second occurrence of the same normalized key within that block. */
function addOccurrence(block: BlockIndex, key: string, occ: HorseOccupancy): void {
  if (block.horses.get(key) === undefined) {
    block.horses.set(key, occ);
  } else {
    block.horses.set(key, AMBIGUOUS);
  }
}

/**
 * Build a block-scoped horse placement index from a loaded plan descriptor.
 * Pure, deterministic, non-mutating, and NEVER throws: malformed / null / sparse
 * blocks, stations, or pairs are skipped and contribute nothing. The returned
 * index (and every object it later hands back) is frozen.
 */
export function buildHorsePlacementIndex(plan: HorsePlacementPlanInput): HorsePlacementIndex {
  const blocks = new Map<string, BlockIndex>();
  const planRecord = asRecord(plan);
  const rawBlocks = planRecord && Array.isArray(planRecord.blocks) ? planRecord.blocks : [];

  for (const rawBlock of rawBlocks) {
    const blockRecord = asRecord(rawBlock);
    if (!blockRecord) continue;
    const blockId = readId(blockRecord.id);
    if (blockId === null) continue;
    // A repeated block id is itself ambiguous; merge into the first block index
    // so every seen occurrence still counts toward in-block duplicate detection.
    let block = blocks.get(blockId);
    if (block === undefined) {
      block = { horses: new Map(), pairs: new Map() };
      blocks.set(blockId, block);
    }
    const rawStations = Array.isArray(blockRecord.stations) ? blockRecord.stations : [];

    for (const rawStation of rawStations) {
      const stationRecord = asRecord(rawStation);
      if (!stationRecord) continue;
      const rawPairs = Array.isArray(stationRecord.pairs) ? stationRecord.pairs : [];

      for (const rawPair of rawPairs) {
        const pairRecord = asRecord(rawPair);
        if (!pairRecord) continue;
        const pairId = readId(pairRecord.id);
        if (pairId === null) continue;

        const horse = readHorse(pairRecord.horseName);
        // A malformed horse value corrupts the whole pair: register NOTHING - no
        // empty destination and no horse occupancy - so the pair fails closed on
        // resolution (resolvePairHorse -> null -> STALE_TARGET) and can never be
        // silently normalized into an actionable move/swap target.
        if (!horse.ok) continue;
        const stored = horse.stored;

        // Pair-horse entry (for destination resolution). A repeated pair id in one
        // block is unresolvable -> AMBIGUOUS (resolves to null later).
        if (block.pairs.has(pairId)) {
          block.pairs.set(pairId, AMBIGUOUS);
        } else {
          block.pairs.set(pairId, Object.freeze({ horseName: stored }));
        }

        // Occupancy is keyed by the case-insensitive uniqueness key; a blank horse
        // occupies nothing.
        if (stored !== null) {
          addOccurrence(block, stored.toLowerCase(), Object.freeze({ pairId, horseName: stored }));
        }
      }
    }
  }

  return Object.freeze({ blocks });
}

// ---------------------------------------------------------------------------
// Resolve.
// ---------------------------------------------------------------------------

const FREE: HorsePlacement = Object.freeze({ status: "FREE" });
const AMBIGUOUS_PLACEMENT: HorsePlacement = Object.freeze({ status: "AMBIGUOUS" });

/**
 * Resolve where `candidateHorseName` sits within `blockId`:
 *  - FREE when no pair in that block holds it (or the block is unknown, or the
 *    candidate is blank/absent/malformed);
 *  - OCCUPIED with the single holding pair and the exact stored (case-preserved)
 *    value; or
 *  - AMBIGUOUS when more than one pair in that block holds that normalized horse.
 * Block-scoped: a placement in any OTHER block never influences this answer. The
 * candidate is normalized with the same trim + lower-case uniqueness key used at
 * build time.
 */
export function resolveHorsePlacement(
  index: HorsePlacementIndex,
  blockId: string,
  candidateHorseName: string | null
): HorsePlacement {
  const key = horseKey(candidateHorseName);
  if (key === null) return FREE;
  const block = index.blocks.get(blockId);
  if (block === undefined) return FREE;
  const entry = block.horses.get(key);
  if (entry === undefined) return FREE;
  if (entry === AMBIGUOUS) return AMBIGUOUS_PLACEMENT;
  return Object.freeze({ status: "OCCUPIED", pairId: entry.pairId, horseName: entry.horseName });
}

/**
 * Resolve the horse currently stored on `pairId` within `blockId`, or null when
 * the pair is not found in that block or its id is ambiguously duplicated there.
 * A null answer means "no confident destination pair" - the caller treats it as a
 * stale/vanished target.
 */
export function resolvePairHorse(
  index: HorsePlacementIndex,
  blockId: string,
  pairId: string
): PairHorse | null {
  const block = index.blocks.get(blockId);
  if (block === undefined) return null;
  const entry = block.pairs.get(pairId);
  if (entry === undefined || entry === AMBIGUOUS) return null;
  return entry;
}
