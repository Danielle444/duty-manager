// RIDING-COMPLEX-SCHEDULE-BOARD - pure, DB-free projection that flattens the
// complex riding-plan tree (blocks -> coach stations -> pairs) into a
// deterministic, read-only schedule-board view model.
//
// This core adds NO database query, NO server action, and NO save/business
// logic. It only reshapes data the editor already loaded (the plan tree plus
// the trainee candidate list) into rows that are easy to render as a
// schedule-style overview. Every value is derived deterministically from its
// input; the projection never reads a clock, randomness, or global state.
//
// Inputs are declared here as minimal structural interfaces (duck-typed)
// rather than imported from the "use server" actions module, so this file and
// its tests stay completely decoupled from server code. RidingSlotComplexPlanRow
// and RidingSlotComplexTraineeCandidate structurally satisfy these inputs, so
// callers pass the already-loaded objects unchanged.
//
// Deliberately NOT exposed in the output view model: database ids, sortOrder,
// audit fields (updatedAt/updatedByName), publication state, feedback, or any
// other internal metadata. React keys in the output are index-derived strings,
// never database ids.

export interface ScheduleBoardPairInput {
  // Source pair id, carried only for internal edit-routing (see the VM's pairId
  // below). Optional so read-only/test callers may omit it; the real
  // RidingSlotComplexPairRow supplies it. NEVER rendered.
  id?: string;
  trainee1Id: string | null;
  trainee1Name: string | null;
  trainee2Id: string | null;
  trainee2Name: string | null;
  horseName: string | null;
  note: string | null;
  sortOrder: number;
}

export interface ScheduleBoardStationInput {
  // Source station id, carried only for internal edit-routing (see the VM's
  // stationId below). Optional so read-only/test callers may omit it; the real
  // RidingSlotComplexStationRow supplies it. NEVER rendered.
  id?: string;
  instructor: { fullName: string } | null;
  arena: string | null;
  sortOrder: number;
  pairs: ScheduleBoardPairInput[];
}

export interface ScheduleBoardBlockInput {
  // Source block id, carried only for internal edit-routing (see the VM's
  // blockId below). Optional; the real RidingSlotComplexBlockRow supplies it.
  // NEVER rendered.
  id?: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  stations: ScheduleBoardStationInput[];
}

export interface ScheduleBoardPlanInput {
  blocks: ScheduleBoardBlockInput[];
}

export interface ScheduleBoardCandidateInput {
  studentId: string;
  studentName: string;
}

// One trainee pair inside a station. traineeNames holds the resolved,
// display-ready names actually present (0, 1, or 2 entries) - "who rides with
// whom". horseName/note are trimmed to null when blank so the renderer can
// apply a single "missing value" fallback rather than showing empty strings.
//
// pairId is the source pair's database id, carried ONLY so the board's
// (optional) "עריכת זוג" control can route to the parent's pair sub-dialog. It
// is used exclusively in React click handlers and MUST NEVER be rendered into
// text, attributes, accessible labels, or keys - the rendering `key` stays the
// index-derived value. null when the source row omitted an id.
export interface ScheduleBoardPairVM {
  key: string;
  pairId: string | null;
  traineeNames: string[];
  horseName: string | null;
  note: string | null;
}

// One coach station within a time block. instructorName/arena are passed
// through as null when missing (renderer supplies the Hebrew fallback label),
// so an incomplete plan still renders safely and clearly.
//
// stationId is the source station's database id, carried ONLY so the board's
// (optional) edit control can route back to the existing station editor. It is
// used exclusively in React state/click handlers and MUST NEVER be rendered
// into text, attributes, accessible labels, or keys - the rendering `key`
// above stays the index-derived value. null when the source row omitted an id.
export interface ScheduleBoardStationVM {
  key: string;
  stationId: string | null;
  instructorName: string | null;
  arena: string | null;
  pairs: ScheduleBoardPairVM[];
}

// One time block - the primary vertical unit of the board. blockId is the
// source block's database id, carried for the same internal edit-routing
// purpose (and under the same never-rendered rule) as stationId above.
export interface ScheduleBoardBlockVM {
  key: string;
  blockId: string | null;
  startTime: string;
  endTime: string;
  stations: ScheduleBoardStationVM[];
}

export interface ScheduleBoardVM {
  blocks: ScheduleBoardBlockVM[];
}

// Minutes-since-midnight for a "HH:MM" start time. Unparseable/blank times
// sort last (a large finite sentinel, never Infinity) so ordering stays fully
// deterministic and total even for malformed input.
function timeToMinutes(t: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return 24 * 60 + 1;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Resolve a trainee slot to a display name: prefer a live candidate lookup by
// id (trimmed - a blank/whitespace-only candidate name falls through), fall
// back to the row's denormalized name, else null (slot is empty /
// unresolvable and is dropped from traineeNames).
function resolveTraineeName(
  id: string | null,
  fallbackName: string | null,
  candidatesById: Map<string, string>
): string | null {
  if (id) {
    const name = candidatesById.get(id)?.trim();
    if (name) return name;
  }
  const trimmedFallback = fallbackName?.trim();
  if (trimmedFallback) return trimmedFallback;
  return null;
}

function projectPair(
  pair: ScheduleBoardPairInput,
  key: string,
  candidatesById: Map<string, string>
): ScheduleBoardPairVM {
  const traineeNames = [
    resolveTraineeName(pair.trainee1Id, pair.trainee1Name, candidatesById),
    resolveTraineeName(pair.trainee2Id, pair.trainee2Name, candidatesById),
  ].filter((n): n is string => Boolean(n));

  const horseName = pair.horseName?.trim() || null;
  const note = pair.note?.trim() || null;

  return { key, pairId: pair.id ?? null, traineeNames, horseName, note };
}

function projectStation(
  station: ScheduleBoardStationInput,
  key: string,
  candidatesById: Map<string, string>
): ScheduleBoardStationVM {
  const pairs = (station.pairs ?? [])
    .filter((p): p is ScheduleBoardPairInput => Boolean(p))
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((pair, index) => projectPair(pair, `${key}-p${index}`, candidatesById));

  const instructorName = station.instructor?.fullName?.trim() || null;
  const arena = station.arena?.trim() || null;

  return { key, stationId: station.id ?? null, instructorName, arena, pairs };
}

function projectBlock(
  block: ScheduleBoardBlockInput,
  key: string,
  candidatesById: Map<string, string>
): ScheduleBoardBlockVM {
  const stations = (block.stations ?? [])
    .filter((s): s is ScheduleBoardStationInput => Boolean(s))
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((station, index) => projectStation(station, `${key}-s${index}`, candidatesById));

  return { key, blockId: block.id ?? null, startTime: block.startTime, endTime: block.endTime, stations };
}

// Flatten the plan tree into a deterministic schedule-board view model.
// Blocks are ordered chronologically (by start time, then sortOrder, then
// original position as a stable tie-break); stations and pairs are ordered by
// their sortOrder. Every array is defensively guarded against null/missing.
export function projectScheduleBoard(
  plan: ScheduleBoardPlanInput | null | undefined,
  candidates: readonly ScheduleBoardCandidateInput[] | null | undefined
): ScheduleBoardVM {
  const candidatesById = new Map<string, string>();
  for (const c of candidates ?? []) {
    if (c && c.studentId) candidatesById.set(c.studentId, c.studentName);
  }

  const orderedBlocks = (plan?.blocks ?? [])
    .filter((b): b is ScheduleBoardBlockInput => Boolean(b))
    .map((block, originalIndex) => ({ block, originalIndex }))
    .sort((a, b) => {
      const byTime = timeToMinutes(a.block.startTime) - timeToMinutes(b.block.startTime);
      if (byTime !== 0) return byTime;
      const bySortOrder = a.block.sortOrder - b.block.sortOrder;
      if (bySortOrder !== 0) return bySortOrder;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ block }, index) => projectBlock(block, `b${index}`, candidatesById));

  return { blocks: orderedBlocks };
}
