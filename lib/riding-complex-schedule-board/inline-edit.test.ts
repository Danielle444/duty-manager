// Pure unit tests for the Stage 2B inline-edit decision/projection logic. Run:
//   npx tsx --test lib/riding-complex-schedule-board/inline-edit.test.ts
//
// Pure and DB-free: no Prisma, no server actions, no React, no clock, no
// randomness. Every input is a fixed literal.

import test from "node:test";
import assert from "node:assert/strict";

import {
  canOpenInlineTarget,
  initialBoardView,
  isEditorActionBlocked,
  stationPairExists,
  canSaveBlockTimes,
  pairRowToFields,
  pairFieldsToInput,
  buildStationSavePayload,
  buildPairSaveSnapshotPairs,
  appendPairToStationSnapshot,
  removePairFromStationSnapshot,
  toggleTraineeSelection,
  initialTraineeSelection,
  applyTraineeSelectionToDraft,
  type InlineTarget,
  type InlineBlockShape,
  type InlinePairRowWithId,
  type InlinePairFields,
} from "./inline-edit";

test("only one active target: opening is allowed only when nothing is active", () => {
  assert.equal(canOpenInlineTarget(null), true);
  const active: InlineTarget = { kind: "stationMeta", blockId: "b1", stationId: "s1" };
  // A target is already active -> opening another is rejected (must Cancel first,
  // so an in-progress draft is never silently discarded).
  assert.equal(canOpenInlineTarget(active), false);
  assert.equal(canOpenInlineTarget({ kind: "blockTime", blockId: "b1" }), false);
  assert.equal(canOpenInlineTarget({ kind: "pair", blockId: "b1", stationId: "s1", pairId: "p1" }), false);
});

const blocks: InlineBlockShape[] = [
  { id: "b1", stations: [{ id: "s1", pairs: [{ id: "p1" }, { id: "p2" }] }, { id: "s2", pairs: [] }] },
  { id: "b2", stations: [] },
];

test("stale pair reference fails closed", () => {
  assert.equal(stationPairExists(blocks, "b1", "s1", "p2"), true);
  // pair gone
  assert.equal(stationPairExists(blocks, "b1", "s1", "pX"), false);
  // station has no pairs
  assert.equal(stationPairExists(blocks, "b1", "s2", "p1"), false);
  // station gone
  assert.equal(stationPairExists(blocks, "b1", "sX", "p1"), false);
  // block gone
  assert.equal(stationPairExists(blocks, "bX", "s1", "p1"), false);
});

test("block times save only when both present and end after start", () => {
  assert.equal(canSaveBlockTimes("09:00", "10:00"), true);
  assert.equal(canSaveBlockTimes("09:00", "09:00"), false); // equal
  assert.equal(canSaveBlockTimes("10:00", "09:00"), false); // end before start
  assert.equal(canSaveBlockTimes("", "10:00"), false); // missing start
  assert.equal(canSaveBlockTimes("09:00", ""), false); // missing end
});

test("pair dialog initialization maps a row to editable fields (null -> empty string)", () => {
  assert.deepEqual(pairRowToFields({ trainee1Id: "t1", trainee2Id: "t2", horseName: "כוכב", note: "הערה" }), {
    trainee1Id: "t1",
    trainee2Id: "t2",
    horseName: "כוכב",
    note: "הערה",
  });
  assert.deepEqual(pairRowToFields({ trainee1Id: "t1", trainee2Id: null, horseName: null, note: null }), {
    trainee1Id: "t1",
    trainee2Id: "",
    horseName: "",
    note: "",
  });
});

test("pair payload projection collapses blank optional fields to null", () => {
  assert.deepEqual(pairFieldsToInput({ trainee1Id: "t1", trainee2Id: "t2", horseName: "כוכב", note: "n" }), {
    trainee1Id: "t1",
    trainee2Id: "t2",
    horseName: "כוכב",
    note: "n",
  });
  assert.deepEqual(pairFieldsToInput({ trainee1Id: "t1", trainee2Id: "", horseName: "", note: "" }), {
    trainee1Id: "t1",
    trainee2Id: null,
    horseName: null,
    note: null,
  });
});

test("full station payload carries the complete snapshot (instructor, arena, all pairs) in order", () => {
  const pairs = [
    pairFieldsToInput({ trainee1Id: "t1", trainee2Id: "t2", horseName: "כוכב", note: "" }),
    pairFieldsToInput({ trainee1Id: "t3", trainee2Id: "", horseName: "", note: "" }),
  ];
  const payload = buildStationSavePayload({
    ridingSlotId: "rs1",
    blockId: "b1",
    stationId: "s1",
    instructorId: "i1",
    arena: "מגרש 1",
    pairs,
  });
  assert.deepEqual(payload, {
    ridingSlotId: "rs1",
    blockId: "b1",
    stationId: "s1",
    instructorId: "i1",
    arena: "מגרש 1",
    pairs,
  });
  // order preserved (array index is the server's canonical sortOrder)
  assert.equal(payload.pairs[0].trainee1Id, "t1");
  assert.equal(payload.pairs[1].trainee1Id, "t3");
});

test("payload never carries a raw pair id or sortOrder (ids stay internal to routing)", () => {
  const payload = buildStationSavePayload({
    ridingSlotId: "rs1",
    blockId: "b1",
    stationId: "s1",
    instructorId: null,
    arena: null,
    pairs: [pairFieldsToInput(pairRowToFields({ trainee1Id: "t1", trainee2Id: null, horseName: null, note: null }))],
  });
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /pairId|sortOrder|"id"/);
});

// --- buildPairSaveSnapshotPairs (single-pair full-station-snapshot builder) ---

function rows(): InlinePairRowWithId[] {
  return [
    { id: "p1", trainee1Id: "t1", trainee2Id: "t2", horseName: "כוכב", note: "n1" },
    { id: "p2", trainee1Id: "t3", trainee2Id: null, horseName: "ברק", note: null },
    { id: "p3", trainee1Id: "t4", trainee2Id: "t5", horseName: null, note: "n3" },
  ];
}

const edited: InlinePairFields = { trainee1Id: "t9", trainee2Id: "", horseName: "רוח", note: "" };

test("replaces exactly the target among three pairs, once, preserving order", () => {
  const result = buildPairSaveSnapshotPairs(rows(), "p2", edited);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pairs.length, 3);
  // order preserved; only index 1 (p2) changed to the edited/normalized pair
  assert.deepEqual(result.pairs[1], { trainee1Id: "t9", trainee2Id: null, horseName: "רוח", note: null });
  // exactly one pair equals the edited projection
  const editedInput = pairFieldsToInput(edited);
  assert.equal(result.pairs.filter((p) => JSON.stringify(p) === JSON.stringify(editedInput)).length, 1);
});

test("unchanged pairs remain semantically identical and in the same order", () => {
  const result = buildPairSaveSnapshotPairs(rows(), "p2", edited);
  assert.ok(result.ok);
  if (!result.ok) return;
  // p1 and p3 pass through the shared normalization unchanged in place.
  assert.deepEqual(result.pairs[0], { trainee1Id: "t1", trainee2Id: "t2", horseName: "כוכב", note: "n1" });
  assert.deepEqual(result.pairs[2], { trainee1Id: "t4", trainee2Id: "t5", horseName: null, note: "n3" });
});

test("edited pair is normalized (blank optional fields collapse to null)", () => {
  const result = buildPairSaveSnapshotPairs(rows(), "p3", {
    trainee1Id: "tX",
    trainee2Id: "",
    horseName: "",
    note: "",
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.pairs[2], { trainee1Id: "tX", trainee2Id: null, horseName: null, note: null });
});

test("missing target pair id fails closed with a stable reason code and no payload", () => {
  const result = buildPairSaveSnapshotPairs(rows(), "pX", edited);
  assert.deepEqual(result, { ok: false, reason: "MISSING_TARGET" });
});

test("duplicate target pair id fails closed and produces no payload", () => {
  const dup: InlinePairRowWithId[] = [
    { id: "p1", trainee1Id: "t1", trainee2Id: null, horseName: null, note: null },
    { id: "p1", trainee1Id: "t2", trainee2Id: null, horseName: null, note: null },
  ];
  const result = buildPairSaveSnapshotPairs(dup, "p1", edited);
  assert.deepEqual(result, { ok: false, reason: "DUPLICATE_TARGET" });
  assert.ok(!("pairs" in result));
});

test("input rows and draft (and nested values) are not mutated", () => {
  const input = rows();
  const before = JSON.parse(JSON.stringify(input));
  const draft: InlinePairFields = { trainee1Id: "t9", trainee2Id: "t8", horseName: "רוח", note: "x" };
  const draftBefore = { ...draft };
  const result = buildPairSaveSnapshotPairs(input, "p1", draft);
  assert.ok(result.ok);
  // rows untouched (same references, same nested values)
  assert.deepEqual(input, before);
  assert.equal(input[0].id, "p1");
  // draft untouched
  assert.deepEqual(draft, draftBefore);
});

test("snapshot output contains no pair/database ids", () => {
  const result = buildPairSaveSnapshotPairs(rows(), "p1", edited);
  assert.ok(result.ok);
  if (!result.ok) return;
  const serialized = JSON.stringify(result.pairs);
  assert.doesNotMatch(serialized, /pairId|sortOrder|"id"|"p1"|"p2"|"p3"/);
});

test("deterministic: repeated calls with identical inputs yield identical payloads", () => {
  const a = buildPairSaveSnapshotPairs(rows(), "p2", edited);
  const b = buildPairSaveSnapshotPairs(rows(), "p2", edited);
  assert.deepEqual(a, b);
});

// --- appendPairToStationSnapshot ---

test("append adds exactly one pair at the end, existing pairs unchanged and in order", () => {
  const input = rows();
  const result = appendPairToStationSnapshot(input, { trainee1Id: "t9", trainee2Id: "", horseName: "רוח", note: "" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.pairs.length, 4);
  assert.deepEqual(result.pairs[0], { trainee1Id: "t1", trainee2Id: "t2", horseName: "כוכב", note: "n1" });
  assert.deepEqual(result.pairs[1], { trainee1Id: "t3", trainee2Id: null, horseName: "ברק", note: null });
  assert.deepEqual(result.pairs[2], { trainee1Id: "t4", trainee2Id: "t5", horseName: null, note: "n3" });
  // new pair appended last, normalized
  assert.deepEqual(result.pairs[3], { trainee1Id: "t9", trainee2Id: null, horseName: "רוח", note: null });
});

test("append fails closed when the new pair has no trainee", () => {
  const result = appendPairToStationSnapshot(rows(), { trainee1Id: "", trainee2Id: "t2", horseName: "כוכב", note: "x" });
  assert.deepEqual(result, { ok: false, reason: "NO_TRAINEE" });
  assert.ok(!("pairs" in result));
});

test("append into an empty station yields a single normalized pair", () => {
  const result = appendPairToStationSnapshot([], { trainee1Id: "t1", trainee2Id: "", horseName: "", note: "" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.pairs, [{ trainee1Id: "t1", trainee2Id: null, horseName: null, note: null }]);
});

// --- removePairFromStationSnapshot ---

test("remove omits exactly one pair among several, others unchanged and in order", () => {
  const result = removePairFromStationSnapshot(rows(), "p2");
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.pairs.length, 2);
  assert.deepEqual(result.pairs[0], { trainee1Id: "t1", trainee2Id: "t2", horseName: "כוכב", note: "n1" });
  assert.deepEqual(result.pairs[1], { trainee1Id: "t4", trainee2Id: "t5", horseName: null, note: "n3" });
});

test("remove the only pair yields an empty payload (empty station allowed)", () => {
  const result = removePairFromStationSnapshot([{ id: "p1", trainee1Id: "t1", trainee2Id: null, horseName: null, note: null }], "p1");
  assert.deepEqual(result, { ok: true, pairs: [] });
});

test("remove fails closed on a missing target id", () => {
  assert.deepEqual(removePairFromStationSnapshot(rows(), "pX"), { ok: false, reason: "MISSING_TARGET" });
});

test("remove fails closed on a duplicate target id, no payload", () => {
  const dup: InlinePairRowWithId[] = [
    { id: "p1", trainee1Id: "t1", trainee2Id: null, horseName: null, note: null },
    { id: "p1", trainee1Id: "t2", trainee2Id: null, horseName: null, note: null },
  ];
  const result = removePairFromStationSnapshot(dup, "p1");
  assert.deepEqual(result, { ok: false, reason: "DUPLICATE_TARGET" });
  assert.ok(!("pairs" in result));
});

test("append/remove do not mutate input rows and emit no ids", () => {
  const input = rows();
  const before = JSON.parse(JSON.stringify(input));
  const appended = appendPairToStationSnapshot(input, { trainee1Id: "t9", trainee2Id: "", horseName: "", note: "" });
  const removed = removePairFromStationSnapshot(input, "p1");
  assert.deepEqual(input, before); // untouched by both
  assert.ok(appended.ok && removed.ok);
  if (!appended.ok || !removed.ok) return;
  assert.doesNotMatch(JSON.stringify(appended.pairs), /pairId|sortOrder|"id"|"p1"|"p2"|"p3"/);
  assert.doesNotMatch(JSON.stringify(removed.pairs), /pairId|sortOrder|"id"|"p1"|"p2"|"p3"/);
});

// --- trainee selector decisions ---

test("selector toggle enforces at most two distinct trainees (third rejected)", () => {
  const s0: string[] = [];
  const s1 = toggleTraineeSelection(s0, "a");
  assert.deepEqual(s1, ["a"]);
  const s2 = toggleTraineeSelection(s1, "b");
  assert.deepEqual(s2, ["a", "b"]);
  // third tap rejected - selection unchanged
  assert.deepEqual(toggleTraineeSelection(s2, "c"), ["a", "b"]);
  // tapping a selected one removes it
  assert.deepEqual(toggleTraineeSelection(s2, "a"), ["b"]);
  // re-tapping the same never duplicates
  assert.deepEqual(toggleTraineeSelection(["a"], "a"), []);
  // non-mutating
  assert.deepEqual(s0, []);
});

test("selector initializes from an existing pair's trainees (blanks/dupes dropped)", () => {
  assert.deepEqual(initialTraineeSelection("t1", "t2"), ["t1", "t2"]);
  assert.deepEqual(initialTraineeSelection("t1", ""), ["t1"]);
  assert.deepEqual(initialTraineeSelection("", ""), []); // create mode -> empty
  assert.deepEqual(initialTraineeSelection("t1", "t1"), ["t1"]); // de-duplicated
});

test("selector confirm updates the pair draft trainees without altering the note", () => {
  const draft: InlinePairFields = { trainee1Id: "old1", trainee2Id: "old2", horseName: "כוכב", note: "שמור" };
  const next = applyTraineeSelectionToDraft(draft, "t1", "t2", "רוח");
  assert.equal(next.trainee1Id, "t1");
  assert.equal(next.trainee2Id, "t2");
  assert.equal(next.note, "שמור"); // note preserved
  assert.equal(next.horseName, "כוכב"); // existing horse NOT clobbered by prefill
  // input not mutated
  assert.equal(draft.trainee1Id, "old1");
});

test("selector confirm fills the horse only when the draft has none (contextual prefill preserved)", () => {
  const empty: InlinePairFields = { trainee1Id: "", trainee2Id: "", horseName: "  ", note: "" };
  const next = applyTraineeSelectionToDraft(empty, "t1", null, "רוח");
  assert.equal(next.trainee2Id, ""); // single trainee
  assert.equal(next.horseName, "רוח"); // blank draft horse -> contextual prefill applied
  assert.equal(next.note, "");
});

// --- board default view + view-switch / publish gating ---

test("the schedule board is the default working view", () => {
  assert.equal(initialBoardView(), true);
});

test("view switch and publish are blocked while an inline draft or publication is busy", () => {
  // clean, nothing pending -> allowed (switch/publish not blocked)
  assert.equal(isEditorActionBlocked(false, false), false);
  // an inline draft is active/saving (also covers the trainee selector being
  // open, which only exists while a pair draft is active) -> blocked
  assert.equal(isEditorActionBlocked(true, false), true);
  // a publish/unpublish is already pending -> blocked
  assert.equal(isEditorActionBlocked(false, true), true);
  assert.equal(isEditorActionBlocked(true, true), true);
});
