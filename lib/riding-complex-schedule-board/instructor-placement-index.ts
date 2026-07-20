// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.3b - instructor placement index) -
// pure, DB-free.
//
// A deterministic, BLOCK-SCOPED index of which INSTRUCTOR currently staffs which
// station inside one already-loaded complex riding plan, plus a resolver for the
// instructor currently stored on one station. It exists so the instructor selector
// (a future stage) can tell a FREE instructor (safe to set locally as a normal
// draft edit) from one already OCCUPIED by another station in this block (which
// must instead become an explicit Move/Swap proposal) without re-deriving that
// logic in the UI. It mirrors the sibling horse-placement-index.ts, adapted to
// instructor identity and station-level placement.
//
// This module performs NO Prisma/DB/action/auth/React/env/cookie/clock/random/
// revalidation work and imports nothing. It is DORMANT: no runtime code imports
// it in this stage. It reads only its narrow, structural input descriptor.
//
// SCOPE / SEMANTICS (mirrors the committed Stage 3A Move/Swap core):
//  - Uniqueness is BLOCK-scoped. The SAME instructor staffing a station in a
//    DIFFERENT block does NOT count as occupied in the block being queried (an
//    instructor legitimately reappears across blocks/time slots). Only the queried
//    block's stations are consulted.
//  - An instructor whose id appears MORE THAN ONCE inside the SAME block resolves
//    to AMBIGUOUS - never to an arbitrarily-chosen occurrence. The caller must fail
//    closed rather than guess which station to move from.
//  - This index concerns INSTRUCTOR PLACEMENT ONLY. No trainees, horses, arena,
//    pairs, names, notes, feedback, publication, audit fields, Prisma types, or UI
//    types.
//
// INSTRUCTOR IDENTITY (matches the committed Stage 3A / saveComplexStationInternal
// contract): the instructor is the existing STABLE instructorId. There is no other
// identity and none is invented. Unlike a horse name, an instructor id is an opaque
// stable id: it is NEVER trimmed or case-folded. The only normalization applied is
// treating a blank (null/undefined/whitespace-only) value as a valid UNASSIGNED
// station. A valid id is used VERBATIM as the uniqueness key and carried back
// unchanged on OCCUPIED.
//
// FAIL-CLOSED / PURITY: malformed, null, or sparse rows are skipped and NEVER
// throw - a station with a malformed id or a non-string/non-null instructorId
// registers NOTHING (neither instructor occupancy nor a station entry), so it can
// never masquerade as a resolvable placement or an empty destination. Caller-owned
// inputs are only READ - never mutated or frozen. The returned index and the small
// result objects it hands back ARE frozen (the committed core's defence-in-depth
// convention).

// ---------------------------------------------------------------------------
// Narrow, readonly input descriptor (the smallest slice of a loaded plan needed
// to place instructors). Deliberately excludes every field unrelated to
// instructor placement (no arena, pairs, trainees, horses, or notes).
// ---------------------------------------------------------------------------

/** One station: its stable id and the stored instructor id (nullable). */
export interface InstructorPlacementStationInput {
  readonly id: string;
  readonly instructorId: string | null;
}

/** One time block: its stable id and ordered stations. */
export interface InstructorPlacementBlockInput {
  readonly id: string;
  readonly stations: readonly InstructorPlacementStationInput[];
}

/** The loaded plan reduced to its blocks (no version/id needed for placement). */
export interface InstructorPlacementPlanInput {
  readonly blocks: readonly InstructorPlacementBlockInput[];
}

// ---------------------------------------------------------------------------
// Result shapes.
// ---------------------------------------------------------------------------

/**
 * The placement of one candidate instructor within ONE block:
 *  - FREE ...... no station in this block is staffed by that instructor (it may
 *      still staff a station in another block - that does not count here; a
 *      blank/absent candidate is FREE).
 *  - OCCUPIED .. exactly one station in this block is staffed by that instructor,
 *      at `stationId`, whose exact stored id is `instructorId`.
 *  - AMBIGUOUS . more than one station in this block is staffed by that instructor;
 *      the caller must fail closed rather than pick an occurrence.
 */
export type InstructorPlacement =
  | { readonly status: "FREE" }
  | { readonly status: "OCCUPIED"; readonly stationId: string; readonly instructorId: string }
  | { readonly status: "AMBIGUOUS" };

/** The instructor currently stored on one station (stored id, or null). */
export interface StationInstructor {
  readonly instructorId: string | null;
}

// ---------------------------------------------------------------------------
// Opaque index handle. Treat as opaque - resolve only through the exported
// functions below. (Its internal maps are never exposed for mutation and are
// never mutated after `buildInstructorPlacementIndex` returns.)
// ---------------------------------------------------------------------------

/** The stored occupancy of an instructor within a block (stationId + id). */
interface InstructorOccupancy {
  readonly stationId: string;
  readonly instructorId: string;
}

/** Marks a within-block duplicate (instructor id or station id) as unresolvable. */
const AMBIGUOUS: unique symbol = Symbol("ambiguous");
type Ambiguous = typeof AMBIGUOUS;

interface BlockIndex {
  /** instructorId -> its single occupancy, or AMBIGUOUS when duplicated in-block. */
  readonly instructors: Map<string, InstructorOccupancy | Ambiguous>;
  /** stationId -> its stored instructor, or AMBIGUOUS when the id repeats in-block. */
  readonly stations: Map<string, StationInstructor | Ambiguous>;
}

export interface InstructorPlacementIndex {
  readonly blocks: Map<string, BlockIndex>;
}

// ---------------------------------------------------------------------------
// Small defensive readers / normalizers (a malformed value fails closed; nothing
// throws).
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

/**
 * The normalized form of an instructor id: a blank (null/undefined/whitespace-
 * only) value is a valid UNASSIGNED station (null); any other string is the id
 * VERBATIM (never trimmed or case-folded - an instructor id is an opaque stable
 * id, not a display string). This is BOTH the stored form and the uniqueness key.
 */
export function normalizeInstructorId(value: string | null): string | null {
  if (typeof value !== "string") return null;
  return value.trim() === "" ? null : value;
}

/**
 * STRICT instructor read, matching the committed Stage 3A core's
 * readNullableString contract (a non-null, non-string instructorId is MALFORMED,
 * never silently normalized to an empty station):
 *  - null / undefined -> a valid UNASSIGNED station (stored: null);
 *  - a string -> normalized form (blank/whitespace-only -> null; else verbatim);
 *  - any non-null, non-string runtime value -> malformed (ok: false).
 */
type InstructorRead = { ok: true; stored: string | null } | { ok: false };

function readInstructor(value: unknown): InstructorRead {
  if (value === null || value === undefined) return { ok: true, stored: null };
  if (typeof value === "string") return { ok: true, stored: normalizeInstructorId(value) };
  return { ok: false };
}

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------

/** Record one instructor occurrence into a block, escalating to AMBIGUOUS on any
 *  second occurrence of the same id within that block. */
function addOccurrence(block: BlockIndex, key: string, occ: InstructorOccupancy): void {
  if (block.instructors.get(key) === undefined) {
    block.instructors.set(key, occ);
  } else {
    block.instructors.set(key, AMBIGUOUS);
  }
}

/**
 * Build a block-scoped instructor placement index from a loaded plan descriptor.
 * Pure, deterministic, non-mutating, and NEVER throws: malformed / null / sparse
 * blocks or stations are skipped and contribute nothing. The returned index (and
 * every object it later hands back) is frozen.
 */
export function buildInstructorPlacementIndex(
  plan: InstructorPlacementPlanInput
): InstructorPlacementIndex {
  const blocks = new Map<string, BlockIndex>();
  const planRecord = asRecord(plan);
  const rawBlocks = planRecord && Array.isArray(planRecord.blocks) ? planRecord.blocks : [];

  for (const rawBlock of rawBlocks) {
    const blockRecord = asRecord(rawBlock);
    if (!blockRecord) continue;
    const blockId = readId(blockRecord.id);
    if (blockId === null) continue;
    // A repeated block id is itself ambiguous; merge into the first block index so
    // every seen occurrence still counts toward in-block duplicate detection.
    let block = blocks.get(blockId);
    if (block === undefined) {
      block = { instructors: new Map(), stations: new Map() };
      blocks.set(blockId, block);
    }
    const rawStations = Array.isArray(blockRecord.stations) ? blockRecord.stations : [];

    for (const rawStation of rawStations) {
      const stationRecord = asRecord(rawStation);
      if (!stationRecord) continue;
      const stationId = readId(stationRecord.id);
      if (stationId === null) continue;

      const instructor = readInstructor(stationRecord.instructorId);
      // A malformed instructor value corrupts the whole station: register NOTHING -
      // no empty destination and no instructor occupancy - so the station fails
      // closed on resolution (resolveStationInstructor -> null -> STALE_TARGET) and
      // can never be silently normalized into an actionable move/swap target.
      if (!instructor.ok) continue;
      const stored = instructor.stored;

      // Station entry (for destination resolution). A repeated station id in one
      // block is unresolvable -> AMBIGUOUS (resolves to null later).
      if (block.stations.has(stationId)) {
        block.stations.set(stationId, AMBIGUOUS);
      } else {
        block.stations.set(stationId, Object.freeze({ instructorId: stored }));
      }

      // Occupancy is keyed by the verbatim id; a blank instructor staffs nothing.
      if (stored !== null) {
        addOccurrence(block, stored, Object.freeze({ stationId, instructorId: stored }));
      }
    }
  }

  return Object.freeze({ blocks });
}

// ---------------------------------------------------------------------------
// Resolve.
// ---------------------------------------------------------------------------

const FREE: InstructorPlacement = Object.freeze({ status: "FREE" });
const AMBIGUOUS_PLACEMENT: InstructorPlacement = Object.freeze({ status: "AMBIGUOUS" });

/**
 * Resolve where `candidateInstructorId` sits within `blockId`:
 *  - FREE when no station in that block is staffed by it (or the block is unknown,
 *    or the candidate is blank/absent);
 *  - OCCUPIED with the single staffing station and the exact stored id; or
 *  - AMBIGUOUS when more than one station in that block is staffed by it.
 * Block-scoped: a placement in any OTHER block never influences this answer. The
 * candidate is normalized with the same blank-rejecting (never trimming/case-
 * folding) rule used at build time.
 */
export function resolveInstructorPlacement(
  index: InstructorPlacementIndex,
  blockId: string,
  candidateInstructorId: string | null
): InstructorPlacement {
  const key = normalizeInstructorId(candidateInstructorId);
  if (key === null) return FREE;
  const block = index.blocks.get(blockId);
  if (block === undefined) return FREE;
  const entry = block.instructors.get(key);
  if (entry === undefined) return FREE;
  if (entry === AMBIGUOUS) return AMBIGUOUS_PLACEMENT;
  return Object.freeze({ status: "OCCUPIED", stationId: entry.stationId, instructorId: entry.instructorId });
}

/**
 * Resolve the instructor currently stored on `stationId` within `blockId`, or null
 * when the station is not found in that block or its id is ambiguously duplicated
 * there. A null answer means "no confident destination station" - the caller treats
 * it as a stale/vanished target.
 */
export function resolveStationInstructor(
  index: InstructorPlacementIndex,
  blockId: string,
  stationId: string
): StationInstructor | null {
  const block = index.blocks.get(blockId);
  if (block === undefined) return null;
  const entry = block.stations.get(stationId);
  if (entry === undefined || entry === AMBIGUOUS) return null;
  return entry;
}
