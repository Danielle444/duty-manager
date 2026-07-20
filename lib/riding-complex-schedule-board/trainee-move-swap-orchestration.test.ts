// Pure unit tests for the trainee Move/Swap UI orchestration (Stage 3C.2). Run:
//   npx tsx --test lib/riding-complex-schedule-board/trainee-move-swap-orchestration.test.ts
//
// Pure and DB-free: no Prisma, server actions, React, network, clock, or random.
// Proves the orchestration composes the committed cores correctly, that the
// full-list selector NEVER guesses a destination seat against a full pair, and
// that the confirmation labels it produces never carry an id.

import test from "node:test";
import assert from "node:assert/strict";

import { buildTraineePlacementIndex, type PlacementPlanInput } from "./placement-index";
import { decideTraineeSelection } from "./trainee-selection-decision";
import { buildProposalViewModel } from "./proposal-view-model";
import {
  buildMoveSwapProposalLabels,
  decideFullListTraineeClick,
  decisionToProposalInput,
  resolveFullListDestinationSlot,
} from "./trainee-move-swap-orchestration";

// b1/s1: p1 (occ1 seat1, occ2 seat2 - a FULL pair), p2 (occ3 seat1, empty seat2),
//        p3 (empty).  b2/s2: p4 (occ1 seat1) - same occ1 in another block.
function basePlan(): PlacementPlanInput {
  return {
    blocks: [
      {
        id: "b1",
        stations: [
          {
            id: "s1",
            pairs: [
              { id: "p1", trainee1Id: "occ1", trainee2Id: "occ2" },
              { id: "p2", trainee1Id: "occ3", trainee2Id: null },
              { id: "p3", trainee1Id: null, trainee2Id: null },
            ],
          },
        ],
      },
      {
        id: "b2",
        stations: [{ id: "s2", pairs: [{ id: "p4", trainee1Id: "occ1", trainee2Id: null }] }],
      },
    ],
  };
}

// A block holding a MALFORMED pair (seat 1 empty while seat 2 is held) alongside
// an occupied candidate to click.
function malformedPlan(): PlacementPlanInput {
  return {
    blocks: [
      {
        id: "mb",
        stations: [
          {
            id: "ms",
            pairs: [
              { id: "pm", trainee1Id: null, trainee2Id: "m2" }, // malformed shape
              { id: "pk", trainee1Id: "m1", trainee2Id: null }, // m1 sits here
            ],
          },
        ],
      },
    ],
  };
}

const VERSION = 7;

// ---------------------------------------------------------------------------
// resolveFullListDestinationSlot - fills the unique valid EMPTY seat; it is
// never consulted to pick between two occupied seats (refused upstream).
// ---------------------------------------------------------------------------

test("resolveFullListDestinationSlot: both seats empty -> 1 (unique first position)", () => {
  assert.equal(resolveFullListDestinationSlot({ trainee1Id: null, trainee2Id: null }), 1);
});

test("resolveFullListDestinationSlot: seat1 held, seat2 empty -> 2 (a MOVE target)", () => {
  assert.equal(resolveFullListDestinationSlot({ trainee1Id: "x", trainee2Id: null }), 2);
});

test("resolveFullListDestinationSlot: malformed (seat1 empty, seat2 held) -> 2 (fail-closed seat)", () => {
  assert.equal(resolveFullListDestinationSlot({ trainee1Id: null, trainee2Id: "y" }), 2);
});

// ---------------------------------------------------------------------------
// Searchable dropdown decisions (decideTraineeSelection with an EXPLICIT slot) -
// unchanged: seat 1 targets seat 1, seat 2 targets seat 2.
// ---------------------------------------------------------------------------

test("dropdown: FREE candidate -> LOCAL_SELECTION, no command produced", () => {
  const index = buildTraineePlacementIndex(basePlan());
  const decision = decideTraineeSelection({
    index,
    blockId: "b1",
    candidateTraineeId: "free1",
    destinationPairId: "p2",
    destinationSlot: 2,
    expectedVersion: VERSION,
  });
  assert.equal(decision.kind, "LOCAL_SELECTION");
  assert.equal(decisionToProposalInput(decision), null);
});

test("dropdown seat 1: occupied onto an empty seat 1 produces exactly one MOVE to seat 1", () => {
  const index = buildTraineePlacementIndex(basePlan());
  // occ1 (in p1) chosen explicitly for p3 seat 1 (both seats empty).
  const decision = decideTraineeSelection({
    index,
    blockId: "b1",
    candidateTraineeId: "occ1",
    destinationPairId: "p3",
    destinationSlot: 1,
    expectedVersion: VERSION,
  });
  assert.equal(decision.kind, "MOVE_PROPOSAL");
  const proposal = decisionToProposalInput(decision);
  assert.ok(proposal && proposal.kind === "move");
  assert.deepEqual(proposal.command.destination, { pairId: "p3", slot: "trainee1" });
});

test("dropdown seat 2: occupied onto an empty seat 2 produces exactly one MOVE to seat 2", () => {
  const index = buildTraineePlacementIndex(basePlan());
  const decision = decideTraineeSelection({
    index,
    blockId: "b1",
    candidateTraineeId: "occ1",
    destinationPairId: "p2",
    destinationSlot: 2,
    expectedVersion: VERSION,
  });
  assert.equal(decision.kind, "MOVE_PROPOSAL");
  const proposal = decisionToProposalInput(decision);
  assert.ok(proposal && proposal.kind === "move");
  assert.deepEqual(proposal.command.source, { pairId: "p1", slot: "trainee1" });
  assert.deepEqual(proposal.command.destination, { pairId: "p2", slot: "trainee2" });
});

test("dropdown seat 2: occupied onto an OCCUPIED seat 2 produces exactly one SWAP", () => {
  const index = buildTraineePlacementIndex(basePlan());
  // occ3 (p2 seat1) chosen for p1 seat 2 (held by occ2) -> explicit swap.
  const decision = decideTraineeSelection({
    index,
    blockId: "b1",
    candidateTraineeId: "occ3",
    destinationPairId: "p1",
    destinationSlot: 2,
    expectedVersion: VERSION,
  });
  assert.equal(decision.kind, "SWAP_PROPOSAL");
  const proposal = decisionToProposalInput(decision);
  assert.ok(proposal && proposal.kind === "swap");
  assert.deepEqual(proposal.command.a, { pairId: "p2", slot: "trainee1" });
  assert.deepEqual(proposal.command.b, { pairId: "p1", slot: "trainee2" });
});

test("dropdown: seat 2 while seat 1 empty is UNAVAILABLE (INVALID_PAIR_POSITION)", () => {
  const index = buildTraineePlacementIndex(basePlan());
  const decision = decideTraineeSelection({
    index,
    blockId: "b1",
    candidateTraineeId: "occ1",
    destinationPairId: "p3", // both seats empty
    destinationSlot: 2,
    expectedVersion: VERSION,
  });
  assert.equal(decision.kind, "UNAVAILABLE");
  assert.equal(decision.kind === "UNAVAILABLE" && decision.reason, "INVALID_PAIR_POSITION");
  assert.equal(decisionToProposalInput(decision), null);
});

// ---------------------------------------------------------------------------
// Full-list decisions (decideFullListTraineeClick - the seat is resolved, and a
// full pair is REFUSED rather than defaulting to a seat).
// ---------------------------------------------------------------------------

test("full-list: FREE candidate -> LOCAL_SELECTION (checkbox toggle), no proposal", () => {
  const index = buildTraineePlacementIndex(basePlan());
  const decision = decideFullListTraineeClick({
    index,
    blockId: "b1",
    candidateTraineeId: "free1",
    destinationPairId: "p2",
    expectedVersion: VERSION,
  });
  assert.equal(decision.kind, "LOCAL_SELECTION");
  assert.equal(decisionToProposalInput(decision), null);
});

test("full-list: occupied -> exactly one empty valid seat -> MOVE targeting THAT seat", () => {
  const index = buildTraineePlacementIndex(basePlan());
  // occ1 (in p1) clicked while editing p2 (seat1 held, seat2 empty) -> MOVE seat2.
  const decision = decideFullListTraineeClick({
    index,
    blockId: "b1",
    candidateTraineeId: "occ1",
    destinationPairId: "p2",
    expectedVersion: VERSION,
  });
  assert.equal(decision.kind, "MOVE_PROPOSAL");
  assert.notEqual(decision.kind, "LOCAL_SELECTION");
  const proposal = decisionToProposalInput(decision);
  assert.ok(proposal && proposal.kind === "move");
  assert.deepEqual(proposal.command.destination, { pairId: "p2", slot: "trainee2" });
});

test("full-list: occupied -> both seats empty -> MOVE to seat 1 (unique first position)", () => {
  const index = buildTraineePlacementIndex(basePlan());
  const decision = decideFullListTraineeClick({
    index,
    blockId: "b1",
    candidateTraineeId: "occ1",
    destinationPairId: "p3", // both empty
    expectedVersion: VERSION,
  });
  assert.equal(decision.kind, "MOVE_PROPOSAL");
  const proposal = decisionToProposalInput(decision);
  assert.ok(proposal && proposal.kind === "move");
  assert.deepEqual(proposal.command.destination, { pairId: "p3", slot: "trainee1" });
});

test("full-list: occupied onto a FULL pair -> EXPLICIT_SLOT_REQUIRED, no command, never seat 1 or 2", () => {
  const index = buildTraineePlacementIndex(basePlan());
  // occ3 (in p2) clicked while editing p1 (both seats held). Must NOT default.
  const decision = decideFullListTraineeClick({
    index,
    blockId: "b1",
    candidateTraineeId: "occ3",
    destinationPairId: "p1",
    expectedVersion: VERSION,
  });
  assert.equal(decision.kind, "EXPLICIT_SLOT_REQUIRED");
  assert.notEqual(decision.kind, "MOVE_PROPOSAL");
  assert.notEqual(decision.kind, "SWAP_PROPOSAL");
  assert.notEqual(decision.kind, "LOCAL_SELECTION");
  // No command of any kind is produced (no seat was chosen).
  assert.equal(decisionToProposalInput(decision), null);
  // The refusal carries no id / seat / version - only its kind.
  assert.deepEqual(Object.keys(decision), ["kind"]);
});

test("full-list: the edited pair's own trainee -> NO_CHANGE (a deselect toggle, no proposal)", () => {
  const index = buildTraineePlacementIndex(basePlan());
  const decision = decideFullListTraineeClick({
    index,
    blockId: "b1",
    candidateTraineeId: "occ1",
    destinationPairId: "p1", // occ1 sits in p1
    expectedVersion: VERSION,
  });
  assert.equal(decision.kind, "NO_CHANGE");
  assert.equal(decisionToProposalInput(decision), null);
});

test("full-list: malformed pair (seat1 empty, seat2 held) -> UNAVAILABLE, no command", () => {
  const index = buildTraineePlacementIndex(malformedPlan());
  // m1 (in pk) clicked while editing pm (seat1 empty, seat2 held) -> fail closed.
  const decision = decideFullListTraineeClick({
    index,
    blockId: "mb",
    candidateTraineeId: "m1",
    destinationPairId: "pm",
    expectedVersion: VERSION,
  });
  assert.equal(decision.kind, "UNAVAILABLE");
  assert.equal(decision.kind === "UNAVAILABLE" && decision.reason, "INVALID_PAIR_POSITION");
  assert.equal(decisionToProposalInput(decision), null);
});

test("full-list: CREATE mode (pairId null) occupied -> UNAVAILABLE (CREATE_MODE), no proposal", () => {
  const index = buildTraineePlacementIndex(basePlan());
  const decision = decideFullListTraineeClick({
    index,
    blockId: "b1",
    candidateTraineeId: "occ1",
    destinationPairId: null,
    expectedVersion: VERSION,
  });
  assert.equal(decision.kind, "UNAVAILABLE");
  assert.equal(decision.kind === "UNAVAILABLE" && decision.reason, "CREATE_MODE");
  assert.equal(decisionToProposalInput(decision), null);
});

test("full-list: CREATE mode free candidate -> LOCAL_SELECTION", () => {
  const index = buildTraineePlacementIndex(basePlan());
  const decision = decideFullListTraineeClick({
    index,
    blockId: "b1",
    candidateTraineeId: "free9",
    destinationPairId: null,
    expectedVersion: VERSION,
  });
  assert.equal(decision.kind, "LOCAL_SELECTION");
});

test("full-list: an occupied click never yields LOCAL_SELECTION (never enters selectedIds)", () => {
  const index = buildTraineePlacementIndex(basePlan());
  // Every occupied-elsewhere destination: empty-seat MOVE, full-pair refusal, and
  // create-mode - none is a LOCAL_SELECTION (which is the only checkbox toggle).
  for (const destinationPairId of ["p2", "p3", "p1", null] as const) {
    const decision = decideFullListTraineeClick({
      index,
      blockId: "b1",
      candidateTraineeId: "occ1",
      destinationPairId,
      expectedVersion: VERSION,
    });
    assert.notEqual(decision.kind, "LOCAL_SELECTION");
  }
});

// ---------------------------------------------------------------------------
// Labels + confirmation copy carry NO id (privacy) and no horse/note.
// ---------------------------------------------------------------------------

const TRAINEE_NAMES = new Map<string, string>([
  ["occ1", "דנה"],
  ["occ2", "רותם"],
  ["occ3", "יעל"],
]);
const STATION_LABELS = new Map<string, string>([
  ["p1", "מאמן א׳"],
  ["p2", "מאמן ב׳"],
  ["p3", "מאמן ג׳"],
  ["p4", "מאמן ד׳"],
]);

// Every internal id that must never surface in a rendered string.
const FORBIDDEN_IDS = ["occ1", "occ2", "occ3", "p1", "p2", "p3", "p4", "b1", "b2", "s1", "s2"];

function assertNoIds(...strings: string[]): void {
  for (const s of strings) {
    for (const id of FORBIDDEN_IDS) {
      assert.equal(s.includes(id), false, `"${s}" must not contain id "${id}"`);
    }
  }
}

test("MOVE proposal labels + view model: names only, no id, no horse/note in command", () => {
  const index = buildTraineePlacementIndex(basePlan());
  const decision = decideFullListTraineeClick({
    index,
    blockId: "b1",
    candidateTraineeId: "occ1",
    destinationPairId: "p2",
    expectedVersion: VERSION,
  });
  const proposal = decisionToProposalInput(decision);
  assert.ok(proposal);
  const labels = buildMoveSwapProposalLabels(proposal, {
    index,
    blockId: "b1",
    candidateTraineeName: TRAINEE_NAMES.get("occ1") ?? null,
    traineeNames: TRAINEE_NAMES,
    stationLabels: STATION_LABELS,
  });
  assert.equal(labels.candidateTraineeName, "דנה");
  assert.equal(labels.occupantTraineeName, null);
  assert.equal(labels.sourceStationLabel, "מאמן א׳");
  assert.equal(labels.destinationStationLabel, "מאמן ב׳");

  const vm = buildProposalViewModel(proposal, labels);
  assertNoIds(vm.title, vm.before, vm.after, vm.confirmLabel, vm.cancelLabel);
  assert.ok(vm.before.includes("דנה"));
  assert.ok(vm.after.includes("מאמן ב׳"));
  // The command carries only trainee seats - never horse or note.
  assert.deepEqual(Object.keys(vm.command).sort(), ["destination", "expectedVersion", "op", "source"].sort());
});

test("SWAP proposal labels (from an explicit-seat dropdown swap) resolve the occupant; view model has no id", () => {
  const index = buildTraineePlacementIndex(basePlan());
  // A SWAP comes from the EXPLICIT dropdown seat (the full list refuses a full pair).
  const decision = decideTraineeSelection({
    index,
    blockId: "b1",
    candidateTraineeId: "occ3",
    destinationPairId: "p1",
    destinationSlot: 2,
    expectedVersion: VERSION,
  });
  const proposal = decisionToProposalInput(decision);
  assert.ok(proposal && proposal.kind === "swap");
  const labels = buildMoveSwapProposalLabels(proposal, {
    index,
    blockId: "b1",
    candidateTraineeName: TRAINEE_NAMES.get("occ3") ?? null,
    traineeNames: TRAINEE_NAMES,
    stationLabels: STATION_LABELS,
  });
  assert.equal(labels.candidateTraineeName, "יעל");
  // occupant is occ2 (p1 seat 2).
  assert.equal(labels.occupantTraineeName, "רותם");

  const vm = buildProposalViewModel(proposal, labels);
  assertNoIds(vm.title, vm.before, vm.after);
  assert.ok(vm.before.includes("יעל") && vm.before.includes("רותם"));
  assert.deepEqual(Object.keys(vm.command).sort(), ["a", "b", "expectedVersion", "op"].sort());
});
