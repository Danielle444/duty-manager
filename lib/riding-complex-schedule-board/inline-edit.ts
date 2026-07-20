// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 2B - inline editing) - pure, DB-free
// decision + projection logic for editing a complex riding plan directly from
// the schedule board: inline block-time editing, inline station-metadata
// (instructor + arena) editing, and a focused pair sub-dialog.
//
// This module adds NO database query, NO server action, NO React, and NO save
// side effect. The editor component owns every draft, every server-action call,
// and all view state; this file only computes:
//   1. whether an inline edit target may be opened (one active target at a time);
//   2. whether a block/station/pair target still exists (fail-closed staleness);
//   3. whether block times are valid to save;
//   4. how to project a pair row -> editable dialog fields, and editable fields
//      -> the EXACT existing saveComplexStation payload (full-station snapshot).
//
// Inputs are duck-typed structural shapes (never imported from the "use server"
// actions module) so this file and its tests stay fully decoupled from server
// code; the produced payload types structurally match RidingSlotComplexPair-
// Input / RidingSlotComplexStationSaveInput, checked by TypeScript at the call
// site in the editor.

// The identity of the single inline edit target (never carries a draft - the
// component owns the draft). Block-time edits a block's time range; stationMeta
// edits a station's instructor + arena; pair edits one pair in a focused dialog.
export type InlineTarget =
  | { kind: "blockTime"; blockId: string }
  | { kind: "stationMeta"; blockId: string; stationId: string }
  // pairId is null for a not-yet-created (CREATE-mode) pair, a string for an
  // existing pair being edited/removed. canOpenInlineTarget only checks
  // presence, so this widening does not affect the one-active-target rule.
  | { kind: "pair"; blockId: string; stationId: string; pairId: string | null };

// Only one inline target may be active at a time. Opening another while one is
// already active is rejected so the caller must explicitly Cancel first - an
// in-progress draft is therefore never silently discarded by switching targets.
// `current` is the component's active target (or null when nothing is open).
export function canOpenInlineTarget(current: InlineTarget | null): boolean {
  return current === null;
}

// The schedule board is the default working view once inline editing exists
// (Stage 2B). Centralized so the initial mount and every open / ridingSlot reset
// agree on "start on the board" for admin, editable, and read-only actors alike.
export function initialBoardView(): boolean {
  return true;
}

// A board view switch (board <-> legacy editor) and any publish/unpublish action
// are blocked while an inline draft is active or saving (inlineActive - which
// also covers the trainee selector being open, since that only exists while a
// pair draft is active) or a publication action is already pending. This is what
// guarantees a draft is never silently discarded to change views or to publish.
export function isEditorActionBlocked(inlineActive: boolean, publicationPending: boolean): boolean {
  return inlineActive || publicationPending;
}

// RIDING-COMPLEX-PUBLICATION - who may see and use the Unpublish control.
// Exactly the instructor publish/republish trust tier: an admin always may; an
// instructor may only when the server-returned canEdit is true. canEdit itself
// is a fresh server read of Instructor.isActive && canEditRidingNotes (see
// getRidingSlotComplexPlanForInstructor) - never a client-authored flag. This
// gate is presentation-only: it decides whether to render the control, while
// unpublishComplexRidingPlanAs{Admin,Instructor} independently re-check the
// same requirements server-side and remain the sole authority. A read-only
// instructor (canEdit === false, isAdmin === false) and an unknown/no actor
// alike resolve to false, so neither ever reaches an actionable control.
export function canUnpublishComplexPlan(isAdmin: boolean, canEdit: boolean): boolean {
  return isAdmin || canEdit;
}

// Duck-typed plan shapes for the staleness guards below.
export interface InlinePairIdShape {
  id: string;
}
export interface InlineStationShape {
  id: string;
  pairs: readonly InlinePairIdShape[];
}
export interface InlineBlockShape {
  id: string;
  stations: readonly InlineStationShape[];
}

// True only if the station's pair still exists in the current plan. Used before
// opening the pair dialog and before committing a pair save, so a pair that
// vanished from a background refresh fails closed rather than editing/saving
// onto a missing target. (Block/station existence is guarded by
// boardEditTargetExists in edit-navigation.ts, reused for the other kinds.)
export function stationPairExists(
  blocks: readonly InlineBlockShape[],
  blockId: string,
  stationId: string,
  pairId: string
): boolean {
  const block = blocks.find((b) => b.id === blockId);
  if (!block) return false;
  const station = block.stations.find((s) => s.id === stationId);
  if (!station) return false;
  return station.pairs.some((p) => p.id === pairId);
}

// Minutes-since-midnight for a "HH:MM" time; unparseable -> 0 (same lenient
// parse the overlap helper uses). Private - only canSaveBlockTimes needs it.
function timeToMinutes(t: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Both times present and end strictly after start - the exact rule the legacy
// block editor uses, centralized here so there is a single definition consumed
// by both the legacy form and the inline block-time editor.
export function canSaveBlockTimes(startTime: string, endTime: string): boolean {
  return Boolean(startTime) && Boolean(endTime) && timeToMinutes(endTime) > timeToMinutes(startTime);
}

// The four product-specified editable fields of one pair, as the sub-dialog
// initializes them from an existing pair row (null id/name/value -> ""). id and
// sortOrder are deliberately NOT draftable here.
export interface InlinePairFields {
  trainee1Id: string;
  trainee2Id: string;
  horseName: string;
  note: string;
}

export interface InlinePairRowShape {
  trainee1Id: string | null;
  trainee2Id: string | null;
  horseName: string | null;
  note: string | null;
}

// Pair dialog initialization: existing row -> editable draft fields.
export function pairRowToFields(row: InlinePairRowShape): InlinePairFields {
  return {
    trainee1Id: row.trainee1Id ?? "",
    trainee2Id: row.trainee2Id ?? "",
    horseName: row.horseName ?? "",
    note: row.note ?? "",
  };
}

// One pair as saveComplexStation expects it (structurally matches
// RidingSlotComplexPairInput). Blank optional fields collapse to null - the
// same normalization the legacy station save performs.
export interface StationSavePairInput {
  trainee1Id: string;
  trainee2Id: string | null;
  horseName: string | null;
  note: string | null;
}

// Per-pair payload projection (used for every pair of every station save, so
// the "|| null" normalization lives in exactly one place).
export function pairFieldsToInput(fields: InlinePairFields): StationSavePairInput {
  return {
    trainee1Id: fields.trainee1Id,
    trainee2Id: fields.trainee2Id || null,
    horseName: fields.horseName || null,
    note: fields.note || null,
  };
}

// The full saveComplexStation payload (structurally matches
// RidingSlotComplexStationSaveInput). ALWAYS a full-station snapshot: the
// station's instructor, arena, and the COMPLETE ordered pairs array. The
// station writer is full-replace, so every save - including a single-pair edit
// or a metadata-only edit - must resubmit the whole station, or unedited pairs
// would be deleted. This is the single payload builder consumed by the legacy
// station form, the inline station-meta editor, and the pair dialog.
//
// RIDING-COMPLEX-SCHEDULE-BOARD Stage 3B.1 - the payload now also carries the
// REQUIRED optimistic-concurrency guard `expectedVersion` (the plan.version of
// the loaded snapshot the caller derived this payload from), threaded through
// unchanged so the server can reject a lost update.
export interface StationSavePayload {
  ridingSlotId: string;
  expectedVersion: number;
  blockId: string;
  stationId?: string;
  instructorId: string | null;
  arena: string | null;
  pairs: StationSavePairInput[];
}

export function buildStationSavePayload(args: StationSavePayload): StationSavePayload {
  return {
    ridingSlotId: args.ridingSlotId,
    expectedVersion: args.expectedVersion,
    blockId: args.blockId,
    stationId: args.stationId,
    instructorId: args.instructorId,
    arena: args.arena,
    pairs: args.pairs,
  };
}

// A station pair row as it exists in the loaded plan: identity + editable
// fields. The id is used ONLY to locate the pair to replace and is NEVER copied
// into the produced payload.
export interface InlinePairRowWithId extends InlinePairRowShape {
  id: string;
}

// Stable, non-PII reason codes for a failed pair-snapshot build. Deliberately
// carry no id, name, or index - the caller maps them to a generic message.
// MISSING_TARGET / DUPLICATE_TARGET: the edited/removed pair id matched 0 / >1
// rows. NO_TRAINEE: an appended pair had no first trainee.
export type PairSnapshotResult =
  | { ok: true; pairs: StationSavePairInput[] }
  | { ok: false; reason: "MISSING_TARGET" | "DUPLICATE_TARGET" | "NO_TRAINEE" };

// Build the COMPLETE, ordered pairs payload for a single-pair save. Every
// existing pair is forwarded unchanged EXCEPT the one whose id equals
// targetPairId, which is replaced by the edited draft fields. This is the one
// authoritative full-station-snapshot construction: the station writer is
// full-replace, so a pair edit must resubmit every pair or unedited pairs would
// be deleted.
//
// Fails closed (no payload) unless EXACTLY one row matches targetPairId - a
// missing target (0 matches) or an ambiguous/corrupt target (>1 match) returns
// a reason code instead of a payload, so a stale or malformed reference can
// never silently drop or mis-target a pair. Pure and non-mutating: the input
// rows, the draft, and their nested values are only read; a fresh array of
// fresh pair-input objects is returned (normalized via the shared
// pairRowToFields / pairFieldsToInput logic), and it carries no pair/database
// ids. Deterministic - identical inputs always yield an identical payload.
export function buildPairSaveSnapshotPairs(
  stationPairs: readonly InlinePairRowWithId[],
  targetPairId: string,
  editedFields: InlinePairFields
): PairSnapshotResult {
  let matchCount = 0;
  for (const row of stationPairs) {
    if (row.id === targetPairId) matchCount += 1;
  }
  if (matchCount === 0) return { ok: false, reason: "MISSING_TARGET" };
  if (matchCount > 1) return { ok: false, reason: "DUPLICATE_TARGET" };

  const pairs = stationPairs.map((row) =>
    row.id === targetPairId ? pairFieldsToInput(editedFields) : pairFieldsToInput(pairRowToFields(row))
  );
  return { ok: true, pairs };
}

// Build the COMPLETE, ordered pairs payload for ADDING one pair: every existing
// pair is forwarded unchanged and in order, and the new pair is appended
// deterministically at the end. Fails closed (NO_TRAINEE, no payload) when the
// new pair has no first trainee - an empty pair can never be persisted. Pure,
// non-mutating, and carries no pair/database ids.
export function appendPairToStationSnapshot(
  stationPairs: readonly InlinePairRowWithId[],
  newPair: InlinePairFields
): PairSnapshotResult {
  if (!newPair.trainee1Id) return { ok: false, reason: "NO_TRAINEE" };
  const existing = stationPairs.map((row) => pairFieldsToInput(pairRowToFields(row)));
  return { ok: true, pairs: [...existing, pairFieldsToInput(newPair)] };
}

// Build the COMPLETE, ordered pairs payload for REMOVING one pair: exactly the
// pair whose id equals targetPairId is omitted; every other pair is forwarded
// unchanged and in the same order. Fails closed (no payload) unless EXACTLY one
// row matches - a missing (0) or ambiguous/corrupt (>1) target returns a reason
// code, so a stale or malformed reference can never drop the wrong pair. An
// empty result (removing the station's only pair) is allowed - the station
// writer accepts zero pairs, and this helper invents no minimum-pair rule.
// Pure, non-mutating, and carries no pair/database ids.
export function removePairFromStationSnapshot(
  stationPairs: readonly InlinePairRowWithId[],
  targetPairId: string
): PairSnapshotResult {
  let matchCount = 0;
  for (const row of stationPairs) {
    if (row.id === targetPairId) matchCount += 1;
  }
  if (matchCount === 0) return { ok: false, reason: "MISSING_TARGET" };
  if (matchCount > 1) return { ok: false, reason: "DUPLICATE_TARGET" };

  const pairs = stationPairs
    .filter((row) => row.id !== targetPairId)
    .map((row) => pairFieldsToInput(pairRowToFields(row)));
  return { ok: true, pairs };
}

// --- Trainee selector decisions (shared by the legacy ContextualPairPicker and
// the schedule-board pair dialog) --------------------------------------------

// Toggle one trainee in the selector's working selection, enforcing "at most
// two DISTINCT trainees": tapping a selected trainee removes it; tapping a new
// one adds it only while fewer than two are selected (a third tap is rejected -
// the selection is returned unchanged). Pure and non-mutating (fresh array).
export function toggleTraineeSelection(current: readonly string[], studentId: string): string[] {
  if (current.includes(studentId)) return current.filter((id) => id !== studentId);
  if (current.length >= 2) return [...current];
  return [...current, studentId];
}

// The selector's initial working selection when opened to EDIT an existing
// pair: the pair's present trainees, in order, blanks dropped and de-duplicated,
// capped at two. Empty for a brand-new pair. Pure.
export function initialTraineeSelection(trainee1Id: string, trainee2Id: string): string[] {
  const ids: string[] = [];
  for (const id of [trainee1Id, trainee2Id]) {
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, 2);
}

// Apply a confirmed selector choice onto the pair draft: set the two trainee
// slots; leave the note untouched; and fill the horse ONLY when the draft has
// no horse yet (preserving both any horse the user already entered AND the
// legacy contextual-horse prefill when the field is still blank). Never writes
// to the server. Pure and non-mutating - returns fresh fields.
export function applyTraineeSelectionToDraft(
  draft: InlinePairFields,
  trainee1Id: string,
  trainee2Id: string | null,
  prefillHorse: string
): InlinePairFields {
  return {
    trainee1Id,
    trainee2Id: trainee2Id ?? "",
    horseName: draft.horseName.trim() ? draft.horseName : prefillHorse,
    note: draft.note,
  };
}
