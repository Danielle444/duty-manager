// Pure unit tests for the instructor-selection decision core (Stage 3C.3b). Run:
//   npx tsx --test lib/riding-complex-schedule-board/instructor-selection-decision.test.ts
//
// Pure and DB-free: no Prisma, server actions, React, network, clock, or random.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInstructorPlacementIndex,
  type InstructorPlacementPlanInput,
} from "./instructor-placement-index";
import {
  decideInstructorSelection,
  type InstructorSelectionQuery,
} from "./instructor-selection-decision";

// b1: s1 (inst-thunder), s2 (inst-comet), s3 (empty). b2: s4 (inst-thunder) -
// same instructor in another block (must read as free in b1).
function basePlan(): InstructorPlacementPlanInput {
  return {
    blocks: [
      {
        id: "b1",
        stations: [
          { id: "s1", instructorId: "inst-thunder" },
          { id: "s2", instructorId: "inst-comet" },
          { id: "s3", instructorId: null },
        ],
      },
      {
        id: "b2",
        stations: [{ id: "s4", instructorId: "inst-thunder" }],
      },
    ],
  };
}

function query(overrides: Partial<InstructorSelectionQuery>): InstructorSelectionQuery {
  return {
    index: buildInstructorPlacementIndex(basePlan()),
    blockId: "b1",
    destinationStationId: "s3",
    selectedInstructorId: "inst-blaze",
    expectedVersion: 7,
    ...overrides,
  };
}

const snapshot = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test("free instructor -> LOCAL_SELECTION with the verbatim id", () => {
  const decision = decideInstructorSelection(query({ selectedInstructorId: "inst-blaze" }));
  assert.deepEqual(decision, { kind: "LOCAL_SELECTION", instructorId: "inst-blaze" });
});

test("blank instructor on an occupied destination -> LOCAL_SELECTION(null) (clear)", () => {
  // s1 currently has inst-thunder; selecting blank clears it locally.
  const decision = decideInstructorSelection(
    query({ destinationStationId: "s1", selectedInstructorId: "   " })
  );
  assert.deepEqual(decision, { kind: "LOCAL_SELECTION", instructorId: null });
});

test("null instructor on an occupied destination -> LOCAL_SELECTION(null) (clear)", () => {
  const decision = decideInstructorSelection(
    query({ destinationStationId: "s1", selectedInstructorId: null })
  );
  assert.deepEqual(decision, { kind: "LOCAL_SELECTION", instructorId: null });
});

test("selecting the destination station's current instructor -> NO_CHANGE", () => {
  const decision = decideInstructorSelection(
    query({ destinationStationId: "s1", selectedInstructorId: "inst-thunder" })
  );
  assert.deepEqual(decision, { kind: "NO_CHANGE" });
});

test("blank on an already-empty destination -> NO_CHANGE", () => {
  const decision = decideInstructorSelection(
    query({ destinationStationId: "s3", selectedInstructorId: "  " })
  );
  assert.deepEqual(decision, { kind: "NO_CHANGE" });
});

test("occupied elsewhere + empty destination -> exact MOVE_INSTRUCTOR command", () => {
  // inst-thunder staffs s1; destination s3 has no instructor -> MOVE.
  const decision = decideInstructorSelection(
    query({ destinationStationId: "s3", selectedInstructorId: "inst-thunder" })
  );
  assert.deepEqual(decision, {
    kind: "MOVE_PROPOSAL",
    command: {
      op: "MOVE_INSTRUCTOR",
      expectedVersion: 7,
      sourceStationId: "s1",
      destinationStationId: "s3",
    },
  });
});

test("occupied elsewhere + occupied destination -> exact SWAP_INSTRUCTORS command", () => {
  // inst-thunder staffs s1; destination s2 holds inst-comet -> SWAP.
  const decision = decideInstructorSelection(
    query({ destinationStationId: "s2", selectedInstructorId: "inst-thunder" })
  );
  assert.deepEqual(decision, {
    kind: "SWAP_PROPOSAL",
    command: {
      op: "SWAP_INSTRUCTORS",
      expectedVersion: 7,
      aStationId: "s1",
      bStationId: "s2",
    },
  });
});

test("selecting a station's own instructor (source === destination) -> NO_CHANGE", () => {
  // Choosing inst-thunder again for s1, which already holds it.
  const decision = decideInstructorSelection(
    query({ destinationStationId: "s1", selectedInstructorId: "inst-thunder" })
  );
  assert.deepEqual(decision, { kind: "NO_CHANGE" });
});

test("an instructor duplicated in the block -> AMBIGUOUS", () => {
  const plan: InstructorPlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          { id: "s1", instructorId: "inst-dusty" },
          { id: "s2", instructorId: "inst-dusty" },
          { id: "s3", instructorId: null },
        ],
      },
    ],
  };
  const decision = decideInstructorSelection({
    index: buildInstructorPlacementIndex(plan),
    blockId: "b1",
    destinationStationId: "s3",
    selectedInstructorId: "inst-dusty",
    expectedVersion: 1,
  });
  assert.deepEqual(decision, { kind: "AMBIGUOUS" });
});

test("missing / corrupt destination station -> STALE_TARGET", () => {
  const gone = decideInstructorSelection(
    query({ destinationStationId: "ghost", selectedInstructorId: "inst-blaze" })
  );
  assert.deepEqual(gone, { kind: "STALE_TARGET" });
  // A station that exists only in another block is stale here too.
  const otherBlock = decideInstructorSelection(
    query({ destinationStationId: "s4", selectedInstructorId: "inst-blaze" })
  );
  assert.deepEqual(otherBlock, { kind: "STALE_TARGET" });
  assert.ok(!("command" in gone) && !("command" in otherBlock));
});

test("a corrupt destination station (malformed instructor) cannot become an actionable target", () => {
  const plan: InstructorPlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          { id: "s1", instructorId: "inst-thunder" },
          { id: "corrupt", instructorId: 5 as unknown as string },
        ],
      },
    ],
  };
  const decision = decideInstructorSelection({
    index: buildInstructorPlacementIndex(plan),
    blockId: "b1",
    destinationStationId: "corrupt",
    selectedInstructorId: "inst-thunder",
    expectedVersion: 3,
  });
  assert.deepEqual(decision, { kind: "STALE_TARGET" });
});

test("create mode with an occupied instructor -> UNAVAILABLE / CREATE_MODE", () => {
  const decision = decideInstructorSelection(
    query({ destinationStationId: null, selectedInstructorId: "inst-thunder" })
  );
  assert.deepEqual(decision, { kind: "UNAVAILABLE", reason: "CREATE_MODE" });
});

test("create mode with a free instructor -> LOCAL_SELECTION", () => {
  const decision = decideInstructorSelection(
    query({ destinationStationId: null, selectedInstructorId: "inst-blaze" })
  );
  assert.deepEqual(decision, { kind: "LOCAL_SELECTION", instructorId: "inst-blaze" });
});

test("create mode with a blank instructor -> LOCAL_SELECTION(null)", () => {
  const decision = decideInstructorSelection(
    query({ destinationStationId: null, selectedInstructorId: "   " })
  );
  assert.deepEqual(decision, { kind: "LOCAL_SELECTION", instructorId: null });
});

test("an instructor used only in another block is free here -> LOCAL_SELECTION", () => {
  const plan: InstructorPlacementPlanInput = {
    blocks: [
      { id: "b1", stations: [{ id: "s1", instructorId: null }] },
      { id: "b2", stations: [{ id: "s9", instructorId: "inst-rocket" }] },
    ],
  };
  const decision = decideInstructorSelection({
    index: buildInstructorPlacementIndex(plan),
    blockId: "b1",
    destinationStationId: "s1",
    selectedInstructorId: "inst-rocket", // occupied in b2, free in b1
    expectedVersion: 2,
  });
  assert.deepEqual(decision, { kind: "LOCAL_SELECTION", instructorId: "inst-rocket" });
});

test("expectedVersion is threaded verbatim into the command", () => {
  const decision = decideInstructorSelection(
    query({ destinationStationId: "s3", selectedInstructorId: "inst-thunder", expectedVersion: 512 })
  );
  assert.equal(decision.kind, "MOVE_PROPOSAL");
  if (decision.kind === "MOVE_PROPOSAL") {
    assert.equal(decision.command.expectedVersion, 512);
  }
});

test("commands carry exactly their keys - no instructor name/arena/pairs/display fields", () => {
  const move = decideInstructorSelection(
    query({ destinationStationId: "s3", selectedInstructorId: "inst-thunder" })
  );
  assert.equal(move.kind, "MOVE_PROPOSAL");
  if (move.kind === "MOVE_PROPOSAL") {
    assert.deepEqual(Object.keys(move.command).sort(), [
      "destinationStationId",
      "expectedVersion",
      "op",
      "sourceStationId",
    ]);
  }
  const swap = decideInstructorSelection(
    query({ destinationStationId: "s2", selectedInstructorId: "inst-thunder" })
  );
  assert.equal(swap.kind, "SWAP_PROPOSAL");
  if (swap.kind === "SWAP_PROPOSAL") {
    assert.deepEqual(Object.keys(swap.command).sort(), [
      "aStationId",
      "bStationId",
      "expectedVersion",
      "op",
    ]);
  }
});

test("malformed input fails closed as UNAVAILABLE / UNRESOLVED (never throws)", () => {
  const bad: InstructorSelectionQuery[] = [
    query({ blockId: "" }),
    query({ expectedVersion: 1.5 }),
    query({ expectedVersion: NaN }),
    query({ destinationStationId: "" }),
    query({ selectedInstructorId: 5 as unknown as string }),
    query({ selectedInstructorId: {} as unknown as string }),
    { ...query({}), index: null as unknown as InstructorSelectionQuery["index"] },
    { ...query({}), index: {} as unknown as InstructorSelectionQuery["index"] },
  ];
  for (const q of bad) {
    assert.doesNotThrow(() => {
      const decision = decideInstructorSelection(q);
      assert.deepEqual(decision, { kind: "UNAVAILABLE", reason: "UNRESOLVED" });
    });
  }
  assert.deepEqual(decideInstructorSelection(null as unknown as InstructorSelectionQuery), {
    kind: "UNAVAILABLE",
    reason: "UNRESOLVED",
  });
});

test("deterministic and non-mutating: input untouched, results stable", () => {
  const plan = basePlan();
  const before = snapshot(plan);
  const index = buildInstructorPlacementIndex(plan);
  const q: InstructorSelectionQuery = {
    index,
    blockId: "b1",
    destinationStationId: "s2",
    selectedInstructorId: "inst-thunder",
    expectedVersion: 9,
  };
  const first = decideInstructorSelection(q);
  const second = decideInstructorSelection(q);
  assert.deepEqual(first, second);
  assert.deepEqual(snapshot(plan), before);
  // The caller's query object is not mutated.
  assert.deepEqual(Object.keys(q).sort(), [
    "blockId",
    "destinationStationId",
    "expectedVersion",
    "index",
    "selectedInstructorId",
  ]);
});

test("all decisions (and their commands) are frozen", () => {
  const move = decideInstructorSelection(
    query({ destinationStationId: "s3", selectedInstructorId: "inst-thunder" })
  );
  const swap = decideInstructorSelection(
    query({ destinationStationId: "s2", selectedInstructorId: "inst-thunder" })
  );
  const local = decideInstructorSelection(query({ selectedInstructorId: "inst-blaze" }));
  const noChange = decideInstructorSelection(
    query({ destinationStationId: "s1", selectedInstructorId: "inst-thunder" })
  );
  const stale = decideInstructorSelection(query({ destinationStationId: "ghost" }));
  const unavailable = decideInstructorSelection(
    query({ destinationStationId: null, selectedInstructorId: "inst-thunder" })
  );
  for (const decision of [move, swap, local, noChange, stale, unavailable]) {
    assert.equal(Object.isFrozen(decision), true);
  }
  if (move.kind === "MOVE_PROPOSAL") assert.equal(Object.isFrozen(move.command), true);
  if (swap.kind === "SWAP_PROPOSAL") assert.equal(Object.isFrozen(swap.command), true);
});
