// Pure unit tests for the horse-selection decision core (Stage 3C.3a). Run:
//   npx tsx --test lib/riding-complex-schedule-board/horse-selection-decision.test.ts
//
// Pure and DB-free: no Prisma, server actions, React, network, clock, or random.

import test from "node:test";
import assert from "node:assert/strict";

import { buildHorsePlacementIndex, type HorsePlacementPlanInput } from "./horse-placement-index";
import { decideHorseSelection, type HorseSelectionQuery } from "./horse-selection-decision";

// b1/s1: p1 ("Thunder"), p2 ("Comet"), p3 (empty horse). b2/s2: p4 ("Thunder") -
// same name in another block (must read as free in b1).
function basePlan(): HorsePlacementPlanInput {
  return {
    blocks: [
      {
        id: "b1",
        stations: [
          {
            pairs: [
              { id: "p1", horseName: "Thunder" },
              { id: "p2", horseName: "Comet" },
              { id: "p3", horseName: null },
            ],
          },
        ],
      },
      {
        id: "b2",
        stations: [{ pairs: [{ id: "p4", horseName: "Thunder" }] }],
      },
    ],
  };
}

function query(overrides: Partial<HorseSelectionQuery>): HorseSelectionQuery {
  return {
    index: buildHorsePlacementIndex(basePlan()),
    blockId: "b1",
    destinationPairId: "p3",
    selectedHorseName: "Blaze",
    expectedVersion: 7,
    ...overrides,
  };
}

const snapshot = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test("free horse -> LOCAL_SELECTION with trimmed, case-preserved value", () => {
  const decision = decideHorseSelection(query({ selectedHorseName: "  Blaze  " }));
  assert.deepEqual(decision, { kind: "LOCAL_SELECTION", horseName: "Blaze" });
});

test("blank horse on an occupied destination -> LOCAL_SELECTION(null) (clear)", () => {
  // p1 currently has Thunder; selecting blank clears it locally.
  const decision = decideHorseSelection(query({ destinationPairId: "p1", selectedHorseName: "   " }));
  assert.deepEqual(decision, { kind: "LOCAL_SELECTION", horseName: null });
});

test("selecting the destination pair's current horse -> NO_CHANGE", () => {
  const decision = decideHorseSelection(query({ destinationPairId: "p1", selectedHorseName: "Thunder" }));
  assert.deepEqual(decision, { kind: "NO_CHANGE" });
});

test("case/whitespace-equivalent of the current horse -> NO_CHANGE", () => {
  const decision = decideHorseSelection(query({ destinationPairId: "p2", selectedHorseName: "  cOMet " }));
  assert.deepEqual(decision, { kind: "NO_CHANGE" });
});

test("blank on an already-empty destination -> NO_CHANGE", () => {
  const decision = decideHorseSelection(query({ destinationPairId: "p3", selectedHorseName: "  " }));
  assert.deepEqual(decision, { kind: "NO_CHANGE" });
});

test("occupied elsewhere + empty destination -> exact MOVE_HORSE command", () => {
  // Thunder sits on p1; destination p3 has no horse -> MOVE.
  const decision = decideHorseSelection(query({ destinationPairId: "p3", selectedHorseName: "Thunder" }));
  assert.deepEqual(decision, {
    kind: "MOVE_PROPOSAL",
    command: {
      op: "MOVE_HORSE",
      expectedVersion: 7,
      sourcePairId: "p1",
      destinationPairId: "p3",
    },
  });
});

test("occupied elsewhere + occupied destination -> exact SWAP_HORSES command", () => {
  // Thunder sits on p1; destination p2 holds Comet -> SWAP.
  const decision = decideHorseSelection(query({ destinationPairId: "p2", selectedHorseName: "Thunder" }));
  assert.deepEqual(decision, {
    kind: "SWAP_PROPOSAL",
    command: {
      op: "SWAP_HORSES",
      expectedVersion: 7,
      aPairId: "p1",
      bPairId: "p2",
    },
  });
});

test("selecting a pair's own horse (source === destination) -> NO_CHANGE", () => {
  // Choosing Thunder again for p1, which already holds it.
  const decision = decideHorseSelection(query({ destinationPairId: "p1", selectedHorseName: "Thunder" }));
  assert.deepEqual(decision, { kind: "NO_CHANGE" });
});

test("a horse duplicated in the block -> AMBIGUOUS", () => {
  const plan: HorsePlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          {
            pairs: [
              { id: "p1", horseName: "Dusty" },
              { id: "p2", horseName: "dusty" },
              { id: "p3", horseName: null },
            ],
          },
        ],
      },
    ],
  };
  const decision = decideHorseSelection({
    index: buildHorsePlacementIndex(plan),
    blockId: "b1",
    destinationPairId: "p3",
    selectedHorseName: "Dusty",
    expectedVersion: 1,
  });
  assert.deepEqual(decision, { kind: "AMBIGUOUS" });
});

test("missing / corrupt destination pair -> STALE_TARGET", () => {
  const gone = decideHorseSelection(query({ destinationPairId: "ghost", selectedHorseName: "Blaze" }));
  assert.deepEqual(gone, { kind: "STALE_TARGET" });
  // A pair that exists only in another block is stale here too.
  const otherBlock = decideHorseSelection(query({ destinationPairId: "p4", selectedHorseName: "Blaze" }));
  assert.deepEqual(otherBlock, { kind: "STALE_TARGET" });
  assert.ok(!("command" in gone) && !("command" in otherBlock));
});

test("a corrupt destination pair (malformed horse) cannot become an actionable target", () => {
  const plan: HorsePlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          {
            pairs: [
              { id: "p1", horseName: "Thunder" },
              { id: "corrupt", horseName: 5 as unknown as string },
            ],
          },
        ],
      },
    ],
  };
  const decision = decideHorseSelection({
    index: buildHorsePlacementIndex(plan),
    blockId: "b1",
    destinationPairId: "corrupt",
    selectedHorseName: "Thunder",
    expectedVersion: 3,
  });
  assert.deepEqual(decision, { kind: "STALE_TARGET" });
});

test("create mode with an occupied horse -> UNAVAILABLE / CREATE_MODE", () => {
  const decision = decideHorseSelection(query({ destinationPairId: null, selectedHorseName: "Thunder" }));
  assert.deepEqual(decision, { kind: "UNAVAILABLE", reason: "CREATE_MODE" });
});

test("create mode with a free horse -> LOCAL_SELECTION", () => {
  const decision = decideHorseSelection(query({ destinationPairId: null, selectedHorseName: "  Blaze " }));
  assert.deepEqual(decision, { kind: "LOCAL_SELECTION", horseName: "Blaze" });
});

test("create mode with a blank horse -> LOCAL_SELECTION(null)", () => {
  const decision = decideHorseSelection(query({ destinationPairId: null, selectedHorseName: "   " }));
  assert.deepEqual(decision, { kind: "LOCAL_SELECTION", horseName: null });
});

test("a horse used only in another block is free here -> LOCAL_SELECTION", () => {
  // In b1 there is no "Comet"? there is; use a b2-only name instead. b2/p4 is
  // Thunder; querying b1 for a name that only exists in b2 stays local. Here we
  // move within b2: select Thunder onto b2's own p4 is NO_CHANGE, so instead pick
  // a fresh name in b1 that merely coincides with a b2 horse.
  const plan: HorsePlacementPlanInput = {
    blocks: [
      { id: "b1", stations: [{ pairs: [{ id: "p1", horseName: null }] }] },
      { id: "b2", stations: [{ pairs: [{ id: "p9", horseName: "Rocket" }] }] },
    ],
  };
  const decision = decideHorseSelection({
    index: buildHorsePlacementIndex(plan),
    blockId: "b1",
    destinationPairId: "p1",
    selectedHorseName: "Rocket", // occupied in b2, free in b1
    expectedVersion: 2,
  });
  assert.deepEqual(decision, { kind: "LOCAL_SELECTION", horseName: "Rocket" });
});

test("expectedVersion is threaded verbatim into the command", () => {
  const decision = decideHorseSelection(
    query({ destinationPairId: "p3", selectedHorseName: "Thunder", expectedVersion: 512 })
  );
  assert.equal(decision.kind, "MOVE_PROPOSAL");
  if (decision.kind === "MOVE_PROPOSAL") {
    assert.equal(decision.command.expectedVersion, 512);
  }
});

test("commands carry exactly their keys - no horseName/note/trainees/display fields", () => {
  const move = decideHorseSelection(query({ destinationPairId: "p3", selectedHorseName: "Thunder" }));
  assert.equal(move.kind, "MOVE_PROPOSAL");
  if (move.kind === "MOVE_PROPOSAL") {
    assert.deepEqual(Object.keys(move.command).sort(), [
      "destinationPairId",
      "expectedVersion",
      "op",
      "sourcePairId",
    ]);
  }
  const swap = decideHorseSelection(query({ destinationPairId: "p2", selectedHorseName: "Thunder" }));
  assert.equal(swap.kind, "SWAP_PROPOSAL");
  if (swap.kind === "SWAP_PROPOSAL") {
    assert.deepEqual(Object.keys(swap.command).sort(), ["aPairId", "bPairId", "expectedVersion", "op"]);
  }
});

test("malformed input fails closed as UNAVAILABLE / UNRESOLVED (never throws)", () => {
  const bad: HorseSelectionQuery[] = [
    query({ blockId: "" }),
    query({ expectedVersion: 1.5 }),
    query({ expectedVersion: NaN }),
    query({ destinationPairId: "" }),
    query({ selectedHorseName: 5 as unknown as string }),
    query({ selectedHorseName: {} as unknown as string }),
    { ...query({}), index: null as unknown as HorseSelectionQuery["index"] },
    { ...query({}), index: {} as unknown as HorseSelectionQuery["index"] },
  ];
  for (const q of bad) {
    assert.doesNotThrow(() => {
      const decision = decideHorseSelection(q);
      assert.deepEqual(decision, { kind: "UNAVAILABLE", reason: "UNRESOLVED" });
    });
  }
  assert.deepEqual(
    decideHorseSelection(null as unknown as HorseSelectionQuery),
    { kind: "UNAVAILABLE", reason: "UNRESOLVED" }
  );
});

test("deterministic and non-mutating: input untouched, results stable", () => {
  const plan = basePlan();
  const before = snapshot(plan);
  const index = buildHorsePlacementIndex(plan);
  const q: HorseSelectionQuery = {
    index,
    blockId: "b1",
    destinationPairId: "p2",
    selectedHorseName: "Thunder",
    expectedVersion: 9,
  };
  const first = decideHorseSelection(q);
  const second = decideHorseSelection(q);
  assert.deepEqual(first, second);
  assert.deepEqual(snapshot(plan), before);
  // The caller's query object is not mutated.
  assert.deepEqual(Object.keys(q).sort(), [
    "blockId",
    "destinationPairId",
    "expectedVersion",
    "index",
    "selectedHorseName",
  ]);
});

test("all decisions (and their commands) are frozen", () => {
  const move = decideHorseSelection(query({ destinationPairId: "p3", selectedHorseName: "Thunder" }));
  const swap = decideHorseSelection(query({ destinationPairId: "p2", selectedHorseName: "Thunder" }));
  const local = decideHorseSelection(query({ selectedHorseName: "Blaze" }));
  const noChange = decideHorseSelection(query({ destinationPairId: "p1", selectedHorseName: "Thunder" }));
  const stale = decideHorseSelection(query({ destinationPairId: "ghost" }));
  const unavailable = decideHorseSelection(query({ destinationPairId: null, selectedHorseName: "Thunder" }));
  for (const decision of [move, swap, local, noChange, stale, unavailable]) {
    assert.equal(Object.isFrozen(decision), true);
  }
  if (move.kind === "MOVE_PROPOSAL") assert.equal(Object.isFrozen(move.command), true);
  if (swap.kind === "SWAP_PROPOSAL") assert.equal(Object.isFrozen(swap.command), true);
});
