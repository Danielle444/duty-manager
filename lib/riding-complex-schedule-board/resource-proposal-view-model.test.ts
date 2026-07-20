// Pure unit tests for the resource (horse) proposal view model (Stage 3C.3a). Run:
//   npx tsx --test lib/riding-complex-schedule-board/resource-proposal-view-model.test.ts
//
// Pure and DB-free: no Prisma, server actions, React, network, clock, or random.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHorseProposalViewModel,
  buildInstructorProposalViewModel,
  type HorseProposalInput,
  type InstructorProposalInput,
} from "./resource-proposal-view-model";

// Distinctive internal ids/version so a leak into display copy is unmistakable.
const MOVE_COMMAND = {
  op: "MOVE_HORSE",
  expectedVersion: 4242,
  sourcePairId: "PAIR_SRC_ZZZ",
  destinationPairId: "PAIR_DST_QQQ",
} as const;

const SWAP_COMMAND = {
  op: "SWAP_HORSES",
  expectedVersion: 9191,
  aPairId: "PAIR_A_XXX",
  bPairId: "PAIR_B_YYY",
} as const;

const MOVE: HorseProposalInput = { kind: "horse-move", command: MOVE_COMMAND };
const SWAP: HorseProposalInput = { kind: "horse-swap", command: SWAP_COMMAND };

// A malformed/wrong-resource value the strict normalizer must reject. Typed via a
// cast so the tests can exercise the runtime failure channel.
const bad = (value: unknown): HorseProposalInput => value as HorseProposalInput;

// ---------------------------------------------------------------------------
// Valid input -> unchanged Hebrew copy.
// ---------------------------------------------------------------------------

test("move: safe Hebrew before/after copy from supplied labels", () => {
  const vm = buildHorseProposalViewModel(MOVE, {
    selectedHorseName: "רעם",
    sourcePairLabel: "זוג רוני",
    destinationPairLabel: "זוג יוסי",
  });
  assert.ok(vm);
  assert.equal(vm.kind, "horse-move");
  assert.equal(vm.title, "העברת סוס");
  assert.ok(vm.before.includes("רעם") && vm.before.includes("זוג רוני"));
  assert.ok(vm.after.includes("רעם") && vm.after.includes("זוג יוסי"));
  assert.equal(vm.confirmLabel, "אישור העברה");
  assert.equal(vm.cancelLabel, "ביטול");
});

test("move: mandatory 'trainees and note remain in place' copy is present", () => {
  const vm = buildHorseProposalViewModel(MOVE, { selectedHorseName: "רעם" });
  assert.ok(vm);
  assert.ok(vm.after.includes("החניכים וההערה נשארים במקומם."));
});

test("swap: safe Hebrew before/after copy showing both horses exchanging", () => {
  const vm = buildHorseProposalViewModel(SWAP, {
    selectedHorseName: "רעם",
    destinationHorseName: "כוכב",
    sourcePairLabel: "זוג רוני",
    destinationPairLabel: "זוג יוסי",
  });
  assert.ok(vm);
  assert.equal(vm.kind, "horse-swap");
  assert.equal(vm.title, "החלפת סוסים");
  // Before: רעם at source, כוכב at destination. After: they exchange.
  assert.ok(vm.before.includes("רעם") && vm.before.includes("כוכב"));
  assert.ok(vm.after.includes("רעם") && vm.after.includes("כוכב"));
  assert.ok(vm.before.includes("זוג רוני") && vm.before.includes("זוג יוסי"));
  assert.ok(vm.after.includes("זוג רוני") && vm.after.includes("זוג יוסי"));
  assert.equal(vm.confirmLabel, "אישור החלפה");
  assert.equal(vm.cancelLabel, "ביטול");
});

test("swap: mandatory 'trainees and notes remain in place' copy is present", () => {
  const vm = buildHorseProposalViewModel(SWAP, { selectedHorseName: "רעם" });
  assert.ok(vm);
  assert.ok(vm.after.includes("החניכים וההערות נשארים במקומם."));
});

test("generic safe fallback labels when a display name is absent or blank", () => {
  const move = buildHorseProposalViewModel(MOVE, {});
  assert.ok(move);
  assert.ok(move.before.includes("הסוס"));
  assert.ok(move.before.includes("הזוג הנוכחי"));
  assert.ok(move.after.includes("הזוג הנבחר"));

  const swap = buildHorseProposalViewModel(SWAP, {
    selectedHorseName: "   ", // whitespace-only -> fallback
    destinationHorseName: null,
  });
  assert.ok(swap);
  assert.ok(swap.before.includes("הסוס"));
  assert.ok(swap.before.includes("הסוס האחר"));
});

// ---------------------------------------------------------------------------
// Accepted-input matrix (the four valid shapes).
// ---------------------------------------------------------------------------

test("bare MOVE_HORSE command -> valid move view", () => {
  const vm = buildHorseProposalViewModel(MOVE_COMMAND, { selectedHorseName: "רעם" });
  assert.ok(vm);
  assert.equal(vm.kind, "horse-move");
  assert.equal(vm.title, "העברת סוס");
  assert.deepEqual(vm.command, MOVE_COMMAND);
});

test("bare SWAP_HORSES command -> valid swap view", () => {
  const vm = buildHorseProposalViewModel(SWAP_COMMAND, { selectedHorseName: "רעם" });
  assert.ok(vm);
  assert.equal(vm.kind, "horse-swap");
  assert.equal(vm.title, "החלפת סוסים");
  assert.deepEqual(vm.command, SWAP_COMMAND);
});

test("wrapped horse-move + MOVE command -> valid", () => {
  const vm = buildHorseProposalViewModel(MOVE, { selectedHorseName: "רעם" });
  assert.ok(vm);
  assert.equal(vm.kind, "horse-move");
});

test("wrapped horse-swap + SWAP command -> valid", () => {
  const vm = buildHorseProposalViewModel(SWAP, { selectedHorseName: "רעם" });
  assert.ok(vm);
  assert.equal(vm.kind, "horse-swap");
});

// ---------------------------------------------------------------------------
// Rejected-input matrix (-> null, never misleading copy, never throws).
// ---------------------------------------------------------------------------

test("wrapped horse-move + SWAP command -> null (kind/command mismatch)", () => {
  const vm = buildHorseProposalViewModel(bad({ kind: "horse-move", command: SWAP_COMMAND }), {});
  assert.equal(vm, null);
});

test("wrapped horse-swap + MOVE command -> null (kind/command mismatch)", () => {
  const vm = buildHorseProposalViewModel(bad({ kind: "horse-swap", command: MOVE_COMMAND }), {});
  assert.equal(vm, null);
});

test("trainee commands (bare and wrapped) -> null", () => {
  const moveTrainee = {
    op: "MOVE_TRAINEE",
    expectedVersion: 1,
    source: { pairId: "p1", slot: "trainee1" },
    destination: { pairId: "p2", slot: "trainee1" },
  };
  const swapTrainees = {
    op: "SWAP_TRAINEES",
    expectedVersion: 1,
    a: { pairId: "p1", slot: "trainee1" },
    b: { pairId: "p2", slot: "trainee1" },
  };
  assert.equal(buildHorseProposalViewModel(bad(moveTrainee), {}), null);
  assert.equal(buildHorseProposalViewModel(bad(swapTrainees), {}), null);
  assert.equal(buildHorseProposalViewModel(bad({ kind: "horse-move", command: moveTrainee }), {}), null);
  assert.equal(buildHorseProposalViewModel(bad({ kind: "horse-swap", command: swapTrainees }), {}), null);
});

test("instructor commands (bare and wrapped) -> null", () => {
  const moveInstructor = {
    op: "MOVE_INSTRUCTOR",
    expectedVersion: 1,
    sourceStationId: "s1",
    destinationStationId: "s2",
  };
  const swapInstructors = {
    op: "SWAP_INSTRUCTORS",
    expectedVersion: 1,
    aStationId: "s1",
    bStationId: "s2",
  };
  assert.equal(buildHorseProposalViewModel(bad(moveInstructor), {}), null);
  assert.equal(buildHorseProposalViewModel(bad(swapInstructors), {}), null);
  assert.equal(buildHorseProposalViewModel(bad({ kind: "horse-swap", command: moveInstructor }), {}), null);
});

test("pair commands (bare and wrapped) -> null", () => {
  const movePair = { op: "MOVE_PAIR", expectedVersion: 1, sourcePairId: "p1", destinationStationId: "s2" };
  const swapPairs = { op: "SWAP_PAIRS", expectedVersion: 1, aPairId: "p1", bPairId: "p2" };
  assert.equal(buildHorseProposalViewModel(bad(movePair), {}), null);
  assert.equal(buildHorseProposalViewModel(bad(swapPairs), {}), null);
  assert.equal(buildHorseProposalViewModel(bad({ kind: "horse-move", command: movePair }), {}), null);
});

test("unknown op (bare and wrapped) -> null", () => {
  assert.equal(buildHorseProposalViewModel(bad({ op: "NOPE", expectedVersion: 1 }), {}), null);
  assert.equal(buildHorseProposalViewModel(bad({ kind: "horse-move", command: { op: "NOPE" } }), {}), null);
});

test("unknown wrapped kind -> null", () => {
  assert.equal(buildHorseProposalViewModel(bad({ kind: "instructor-move", command: MOVE_COMMAND }), {}), null);
  assert.equal(buildHorseProposalViewModel(bad({ kind: "horse-frobnicate", command: SWAP_COMMAND }), {}), null);
});

test("null / undefined / array / primitive / empty object -> null without throwing", () => {
  const inputs: unknown[] = [null, undefined, [], [MOVE_COMMAND], 42, "MOVE_HORSE", true, {}, { kind: "horse-move" }];
  for (const input of inputs) {
    assert.doesNotThrow(() => {
      assert.equal(buildHorseProposalViewModel(bad(input), {}), null);
    });
  }
});

test("missing / blank required pair ids -> null", () => {
  const missingMove = { op: "MOVE_HORSE", expectedVersion: 1, sourcePairId: "p1" }; // no destinationPairId
  const blankMove = { op: "MOVE_HORSE", expectedVersion: 1, sourcePairId: "", destinationPairId: "p2" };
  const missingSwap = { op: "SWAP_HORSES", expectedVersion: 1, aPairId: "p1" }; // no bPairId
  const blankSwap = { op: "SWAP_HORSES", expectedVersion: 1, aPairId: "p1", bPairId: "" };
  assert.equal(buildHorseProposalViewModel(bad(missingMove), {}), null);
  assert.equal(buildHorseProposalViewModel(bad(blankMove), {}), null);
  assert.equal(buildHorseProposalViewModel(bad(missingSwap), {}), null);
  assert.equal(buildHorseProposalViewModel(bad(blankSwap), {}), null);
});

test("missing / non-integer expectedVersion -> null", () => {
  assert.equal(buildHorseProposalViewModel(bad({ op: "MOVE_HORSE", sourcePairId: "p1", destinationPairId: "p2" }), {}), null);
  assert.equal(
    buildHorseProposalViewModel(bad({ op: "MOVE_HORSE", expectedVersion: 1.5, sourcePairId: "p1", destinationPairId: "p2" }), {}),
    null
  );
  assert.equal(
    buildHorseProposalViewModel(bad({ op: "SWAP_HORSES", expectedVersion: NaN, aPairId: "p1", bPairId: "p2" }), {}),
    null
  );
  assert.equal(
    buildHorseProposalViewModel(bad({ op: "SWAP_HORSES", expectedVersion: "1", aPairId: "p1", bPairId: "p2" }), {}),
    null
  );
});

test("invalid input is neither mutated nor frozen", () => {
  const mismatched = { kind: "horse-move", command: { ...SWAP_COMMAND } };
  const before = JSON.parse(JSON.stringify(mismatched));
  const vm = buildHorseProposalViewModel(bad(mismatched), { selectedHorseName: "רעם" });
  assert.equal(vm, null);
  assert.deepEqual(mismatched, before, "invalid input must not be mutated");
  assert.equal(Object.isFrozen(mismatched), false, "invalid input must not be frozen");
  assert.equal(Object.isFrozen(mismatched.command), false, "invalid input's command must not be frozen");
});

// ---------------------------------------------------------------------------
// Privacy / command retention / determinism / freeze (valid input).
// ---------------------------------------------------------------------------

test("no raw ids (pair ids / version) are reflected into any display string", () => {
  const displayStrings = (input: HorseProposalInput): string[] => {
    const vm = buildHorseProposalViewModel(input, {
      selectedHorseName: "רעם",
      destinationHorseName: "כוכב",
      sourcePairLabel: "זוג רוני",
      destinationPairLabel: "זוג יוסי",
    });
    assert.ok(vm);
    return [vm.title, vm.before, vm.after, vm.confirmLabel, vm.cancelLabel];
  };
  const forbidden = [
    "PAIR_SRC_ZZZ",
    "PAIR_DST_QQQ",
    "PAIR_A_XXX",
    "PAIR_B_YYY",
    "4242",
    "9191",
    "MOVE_HORSE",
    "SWAP_HORSES",
  ];
  for (const input of [MOVE, SWAP]) {
    for (const s of displayStrings(input)) {
      for (const token of forbidden) {
        assert.ok(!s.includes(token), `display string leaked "${token}": ${s}`);
      }
    }
  }
});

test("the command is retained verbatim & unchanged in the non-display field", () => {
  const vm = buildHorseProposalViewModel(MOVE, { selectedHorseName: "רעם" });
  assert.ok(vm);
  assert.deepEqual(vm.command, MOVE_COMMAND);
  // The command object is the caller's own reference, not cloned/mutated.
  assert.equal(vm.command, MOVE.command as unknown);
});

test("deterministic: same input yields deep-equal output", () => {
  const labels = { selectedHorseName: "רעם", destinationHorseName: "כוכב" };
  assert.deepEqual(
    buildHorseProposalViewModel(SWAP, labels),
    buildHorseProposalViewModel(SWAP, labels)
  );
});

test("view model is frozen (module convention)", () => {
  assert.equal(Object.isFrozen(buildHorseProposalViewModel(MOVE, {})), true);
  assert.equal(Object.isFrozen(buildHorseProposalViewModel(SWAP, {})), true);
});

test("building a view model does not mutate the supplied labels object", () => {
  const labels = { selectedHorseName: "רעם", destinationHorseName: "כוכב" };
  const before = JSON.parse(JSON.stringify(labels));
  buildHorseProposalViewModel(SWAP, labels);
  assert.deepEqual(labels, before);
});

test("valid input does not freeze the caller-owned command", () => {
  const command = { ...MOVE_COMMAND };
  const vm = buildHorseProposalViewModel(bad({ kind: "horse-move", command }), {});
  assert.ok(vm);
  assert.equal(Object.isFrozen(command), false, "caller-owned command must not be frozen");
});

// ===========================================================================
// INSTRUCTOR proposal (Stage 3C.3b). A wholly separate builder; the horse tests
// above remain unchanged and green.
// ===========================================================================

// Distinctive internal ids/version so a leak into display copy is unmistakable.
const MOVE_INSTRUCTOR_COMMAND = {
  op: "MOVE_INSTRUCTOR",
  expectedVersion: 4242,
  sourceStationId: "STATION_SRC_ZZZ",
  destinationStationId: "STATION_DST_QQQ",
} as const;

const SWAP_INSTRUCTORS_COMMAND = {
  op: "SWAP_INSTRUCTORS",
  expectedVersion: 9191,
  aStationId: "STATION_A_XXX",
  bStationId: "STATION_B_YYY",
} as const;

const MOVE_INSTRUCTOR: InstructorProposalInput = {
  kind: "instructor-move",
  command: MOVE_INSTRUCTOR_COMMAND,
};
const SWAP_INSTRUCTORS: InstructorProposalInput = {
  kind: "instructor-swap",
  command: SWAP_INSTRUCTORS_COMMAND,
};

const badInstructor = (value: unknown): InstructorProposalInput => value as InstructorProposalInput;

// ---------------------------------------------------------------------------
// Valid input -> unchanged Hebrew copy.
// ---------------------------------------------------------------------------

test("instructor move: safe Hebrew before/after copy from supplied labels", () => {
  const vm = buildInstructorProposalViewModel(MOVE_INSTRUCTOR, {
    selectedInstructorName: "רוני",
    sourceStationLabel: "תחנה 1",
    destinationStationLabel: "תחנה 2",
  });
  assert.ok(vm);
  assert.equal(vm.kind, "instructor-move");
  assert.equal(vm.title, "העברת מאמן/ת");
  assert.ok(vm.before.includes("רוני") && vm.before.includes("תחנה 1"));
  assert.ok(vm.after.includes("רוני") && vm.after.includes("תחנה 2"));
  assert.equal(vm.confirmLabel, "אישור העברה");
  assert.equal(vm.cancelLabel, "ביטול");
});

test("instructor move: mandatory 'arena and all pairs remain at the station' copy is present", () => {
  const vm = buildInstructorProposalViewModel(MOVE_INSTRUCTOR, { selectedInstructorName: "רוני" });
  assert.ok(vm);
  assert.ok(vm.after.includes("המגרש וכל הזוגות נשארים בתחנה."));
});

test("instructor swap: safe Hebrew before/after copy showing both instructors exchanging", () => {
  const vm = buildInstructorProposalViewModel(SWAP_INSTRUCTORS, {
    selectedInstructorName: "רוני",
    destinationInstructorName: "יוסי",
    sourceStationLabel: "תחנה 1",
    destinationStationLabel: "תחנה 2",
  });
  assert.ok(vm);
  assert.equal(vm.kind, "instructor-swap");
  assert.equal(vm.title, "החלפת מאמנים");
  // Before: רוני at source, יוסי at destination. After: they exchange.
  assert.ok(vm.before.includes("רוני") && vm.before.includes("יוסי"));
  assert.ok(vm.after.includes("רוני") && vm.after.includes("יוסי"));
  assert.ok(vm.before.includes("תחנה 1") && vm.before.includes("תחנה 2"));
  assert.ok(vm.after.includes("תחנה 1") && vm.after.includes("תחנה 2"));
  assert.equal(vm.confirmLabel, "אישור החלפה");
  assert.equal(vm.cancelLabel, "ביטול");
});

test("instructor swap: mandatory 'arenas and pairs remain in place' copy is present", () => {
  const vm = buildInstructorProposalViewModel(SWAP_INSTRUCTORS, { selectedInstructorName: "רוני" });
  assert.ok(vm);
  assert.ok(vm.after.includes("המגרשים והזוגות נשארים במקומם."));
});

test("instructor: generic safe fallback labels when a display name is absent or blank", () => {
  const move = buildInstructorProposalViewModel(MOVE_INSTRUCTOR, {});
  assert.ok(move);
  assert.ok(move.before.includes("המאמן/ת"));
  assert.ok(move.before.includes("התחנה הנוכחית"));
  assert.ok(move.after.includes("התחנה הנבחרת"));

  const swap = buildInstructorProposalViewModel(SWAP_INSTRUCTORS, {
    selectedInstructorName: "   ", // whitespace-only -> fallback
    destinationInstructorName: null,
  });
  assert.ok(swap);
  assert.ok(swap.before.includes("המאמן/ת"));
  assert.ok(swap.before.includes("המאמן/ת האחר/ת"));
});

// ---------------------------------------------------------------------------
// Accepted-input matrix (the four valid instructor shapes).
// ---------------------------------------------------------------------------

test("bare MOVE_INSTRUCTOR command -> valid move view", () => {
  const vm = buildInstructorProposalViewModel(MOVE_INSTRUCTOR_COMMAND, { selectedInstructorName: "רוני" });
  assert.ok(vm);
  assert.equal(vm.kind, "instructor-move");
  assert.equal(vm.title, "העברת מאמן/ת");
  assert.deepEqual(vm.command, MOVE_INSTRUCTOR_COMMAND);
});

test("bare SWAP_INSTRUCTORS command -> valid swap view", () => {
  const vm = buildInstructorProposalViewModel(SWAP_INSTRUCTORS_COMMAND, { selectedInstructorName: "רוני" });
  assert.ok(vm);
  assert.equal(vm.kind, "instructor-swap");
  assert.equal(vm.title, "החלפת מאמנים");
  assert.deepEqual(vm.command, SWAP_INSTRUCTORS_COMMAND);
});

test("wrapped instructor-move + MOVE command -> valid", () => {
  const vm = buildInstructorProposalViewModel(MOVE_INSTRUCTOR, { selectedInstructorName: "רוני" });
  assert.ok(vm);
  assert.equal(vm.kind, "instructor-move");
});

test("wrapped instructor-swap + SWAP command -> valid", () => {
  const vm = buildInstructorProposalViewModel(SWAP_INSTRUCTORS, { selectedInstructorName: "רוני" });
  assert.ok(vm);
  assert.equal(vm.kind, "instructor-swap");
});

// ---------------------------------------------------------------------------
// Rejected-input matrix (-> null, never misleading copy, never throws).
// ---------------------------------------------------------------------------

test("wrapped instructor-move + SWAP command -> null (kind/command mismatch)", () => {
  const vm = buildInstructorProposalViewModel(
    badInstructor({ kind: "instructor-move", command: SWAP_INSTRUCTORS_COMMAND }),
    {}
  );
  assert.equal(vm, null);
});

test("wrapped instructor-swap + MOVE command -> null (kind/command mismatch)", () => {
  const vm = buildInstructorProposalViewModel(
    badInstructor({ kind: "instructor-swap", command: MOVE_INSTRUCTOR_COMMAND }),
    {}
  );
  assert.equal(vm, null);
});

test("instructor builder rejects horse commands (bare and wrapped) -> null", () => {
  assert.equal(buildInstructorProposalViewModel(badInstructor(MOVE_COMMAND), {}), null);
  assert.equal(buildInstructorProposalViewModel(badInstructor(SWAP_COMMAND), {}), null);
  assert.equal(
    buildInstructorProposalViewModel(badInstructor({ kind: "instructor-move", command: MOVE_COMMAND }), {}),
    null
  );
  assert.equal(
    buildInstructorProposalViewModel(badInstructor({ kind: "instructor-swap", command: SWAP_COMMAND }), {}),
    null
  );
});

test("instructor builder rejects trainee commands (bare and wrapped) -> null", () => {
  const moveTrainee = {
    op: "MOVE_TRAINEE",
    expectedVersion: 1,
    source: { pairId: "p1", slot: "trainee1" },
    destination: { pairId: "p2", slot: "trainee1" },
  };
  const swapTrainees = {
    op: "SWAP_TRAINEES",
    expectedVersion: 1,
    a: { pairId: "p1", slot: "trainee1" },
    b: { pairId: "p2", slot: "trainee1" },
  };
  assert.equal(buildInstructorProposalViewModel(badInstructor(moveTrainee), {}), null);
  assert.equal(buildInstructorProposalViewModel(badInstructor(swapTrainees), {}), null);
  assert.equal(
    buildInstructorProposalViewModel(badInstructor({ kind: "instructor-move", command: moveTrainee }), {}),
    null
  );
});

test("instructor builder rejects pair commands (bare and wrapped) -> null", () => {
  const movePair = { op: "MOVE_PAIR", expectedVersion: 1, sourcePairId: "p1", destinationStationId: "s2" };
  const swapPairs = { op: "SWAP_PAIRS", expectedVersion: 1, aPairId: "p1", bPairId: "p2" };
  assert.equal(buildInstructorProposalViewModel(badInstructor(movePair), {}), null);
  assert.equal(buildInstructorProposalViewModel(badInstructor(swapPairs), {}), null);
  assert.equal(
    buildInstructorProposalViewModel(badInstructor({ kind: "instructor-move", command: movePair }), {}),
    null
  );
});

test("instructor builder: unknown op (bare and wrapped) -> null", () => {
  assert.equal(buildInstructorProposalViewModel(badInstructor({ op: "NOPE", expectedVersion: 1 }), {}), null);
  assert.equal(
    buildInstructorProposalViewModel(badInstructor({ kind: "instructor-move", command: { op: "NOPE" } }), {}),
    null
  );
});

test("instructor builder: unknown wrapped kind -> null", () => {
  assert.equal(
    buildInstructorProposalViewModel(badInstructor({ kind: "horse-move", command: MOVE_INSTRUCTOR_COMMAND }), {}),
    null
  );
  assert.equal(
    buildInstructorProposalViewModel(badInstructor({ kind: "instructor-frobnicate", command: SWAP_INSTRUCTORS_COMMAND }), {}),
    null
  );
});

test("instructor: null / undefined / array / primitive / empty object -> null without throwing", () => {
  const inputs: unknown[] = [
    null,
    undefined,
    [],
    [MOVE_INSTRUCTOR_COMMAND],
    42,
    "MOVE_INSTRUCTOR",
    true,
    {},
    { kind: "instructor-move" },
  ];
  for (const input of inputs) {
    assert.doesNotThrow(() => {
      assert.equal(buildInstructorProposalViewModel(badInstructor(input), {}), null);
    });
  }
});

test("instructor: missing / blank required station ids -> null", () => {
  const missingMove = { op: "MOVE_INSTRUCTOR", expectedVersion: 1, sourceStationId: "s1" }; // no dest
  const blankMove = { op: "MOVE_INSTRUCTOR", expectedVersion: 1, sourceStationId: "", destinationStationId: "s2" };
  const missingSwap = { op: "SWAP_INSTRUCTORS", expectedVersion: 1, aStationId: "s1" }; // no bStationId
  const blankSwap = { op: "SWAP_INSTRUCTORS", expectedVersion: 1, aStationId: "s1", bStationId: "" };
  assert.equal(buildInstructorProposalViewModel(badInstructor(missingMove), {}), null);
  assert.equal(buildInstructorProposalViewModel(badInstructor(blankMove), {}), null);
  assert.equal(buildInstructorProposalViewModel(badInstructor(missingSwap), {}), null);
  assert.equal(buildInstructorProposalViewModel(badInstructor(blankSwap), {}), null);
});

test("instructor: missing / non-integer expectedVersion -> null", () => {
  assert.equal(
    buildInstructorProposalViewModel(badInstructor({ op: "MOVE_INSTRUCTOR", sourceStationId: "s1", destinationStationId: "s2" }), {}),
    null
  );
  assert.equal(
    buildInstructorProposalViewModel(badInstructor({ op: "MOVE_INSTRUCTOR", expectedVersion: 1.5, sourceStationId: "s1", destinationStationId: "s2" }), {}),
    null
  );
  assert.equal(
    buildInstructorProposalViewModel(badInstructor({ op: "SWAP_INSTRUCTORS", expectedVersion: NaN, aStationId: "s1", bStationId: "s2" }), {}),
    null
  );
  assert.equal(
    buildInstructorProposalViewModel(badInstructor({ op: "SWAP_INSTRUCTORS", expectedVersion: "1", aStationId: "s1", bStationId: "s2" }), {}),
    null
  );
});

test("instructor: invalid input is neither mutated nor frozen", () => {
  const mismatched = { kind: "instructor-move", command: { ...SWAP_INSTRUCTORS_COMMAND } };
  const before = JSON.parse(JSON.stringify(mismatched));
  const vm = buildInstructorProposalViewModel(badInstructor(mismatched), { selectedInstructorName: "רוני" });
  assert.equal(vm, null);
  assert.deepEqual(mismatched, before, "invalid input must not be mutated");
  assert.equal(Object.isFrozen(mismatched), false, "invalid input must not be frozen");
  assert.equal(Object.isFrozen(mismatched.command), false, "invalid input's command must not be frozen");
});

// ---------------------------------------------------------------------------
// Privacy / command retention / determinism / freeze (valid input).
// ---------------------------------------------------------------------------

test("instructor: no raw ids (station ids / version / op) are reflected into any display string", () => {
  const displayStrings = (input: InstructorProposalInput): string[] => {
    const vm = buildInstructorProposalViewModel(input, {
      selectedInstructorName: "רוני",
      destinationInstructorName: "יוסי",
      sourceStationLabel: "תחנה 1",
      destinationStationLabel: "תחנה 2",
    });
    assert.ok(vm);
    return [vm.title, vm.before, vm.after, vm.confirmLabel, vm.cancelLabel];
  };
  const forbidden = [
    "STATION_SRC_ZZZ",
    "STATION_DST_QQQ",
    "STATION_A_XXX",
    "STATION_B_YYY",
    "4242",
    "9191",
    "MOVE_INSTRUCTOR",
    "SWAP_INSTRUCTORS",
  ];
  for (const input of [MOVE_INSTRUCTOR, SWAP_INSTRUCTORS]) {
    for (const s of displayStrings(input)) {
      for (const token of forbidden) {
        assert.ok(!s.includes(token), `display string leaked "${token}": ${s}`);
      }
    }
  }
});

test("instructor: the command is retained verbatim & unchanged in the non-display field", () => {
  const vm = buildInstructorProposalViewModel(MOVE_INSTRUCTOR, { selectedInstructorName: "רוני" });
  assert.ok(vm);
  assert.deepEqual(vm.command, MOVE_INSTRUCTOR_COMMAND);
  // The command object is the caller's own reference, not cloned/mutated.
  assert.equal(vm.command, MOVE_INSTRUCTOR.command as unknown);
});

test("instructor: deterministic - same input yields deep-equal output", () => {
  const labels = { selectedInstructorName: "רוני", destinationInstructorName: "יוסי" };
  assert.deepEqual(
    buildInstructorProposalViewModel(SWAP_INSTRUCTORS, labels),
    buildInstructorProposalViewModel(SWAP_INSTRUCTORS, labels)
  );
});

test("instructor: view model is frozen (module convention)", () => {
  assert.equal(Object.isFrozen(buildInstructorProposalViewModel(MOVE_INSTRUCTOR, {})), true);
  assert.equal(Object.isFrozen(buildInstructorProposalViewModel(SWAP_INSTRUCTORS, {})), true);
});

test("instructor: building a view model does not mutate the supplied labels object", () => {
  const labels = { selectedInstructorName: "רוני", destinationInstructorName: "יוסי" };
  const before = JSON.parse(JSON.stringify(labels));
  buildInstructorProposalViewModel(SWAP_INSTRUCTORS, labels);
  assert.deepEqual(labels, before);
});

test("instructor: valid input does not freeze the caller-owned command", () => {
  const command = { ...MOVE_INSTRUCTOR_COMMAND };
  const vm = buildInstructorProposalViewModel(badInstructor({ kind: "instructor-move", command }), {});
  assert.ok(vm);
  assert.equal(Object.isFrozen(command), false, "caller-owned command must not be frozen");
});

test("horse builder still rejects instructor commands (cross-resource isolation)", () => {
  // Defence-in-depth: the horse builder must never render an instructor command.
  assert.equal(buildHorseProposalViewModel(bad(MOVE_INSTRUCTOR_COMMAND), {}), null);
  assert.equal(buildHorseProposalViewModel(bad(SWAP_INSTRUCTORS_COMMAND), {}), null);
  assert.equal(
    buildHorseProposalViewModel(bad({ kind: "instructor-move", command: MOVE_INSTRUCTOR_COMMAND }), {}),
    null
  );
});
