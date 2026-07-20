// Pure unit tests for the Stage-3B Move/Swap write-plan adapter. Run:
//   npx tsx --test lib/riding-complex-schedule-board/move-swap-write-plan.test.ts
//
// Pure and DB-free: no Prisma, no server actions, no React, no clock, no random.
// Each test drives the committed Stage-3A core to produce a real success, then
// asserts the adapter emits EXACTLY the targeted rows that success implies -
// nothing unaffected, nothing duplicated, ids preserved, deterministic,
// non-mutating, and fail-closed on a malformed success shape.

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyComplexPlanMoveSwap,
  type ComplexPlanInput,
  type ComplexPlanMoveSwapCommand,
  type ComplexPlanMoveSwapSuccess,
} from "./move-swap";
import { buildComplexPlanWritePlan } from "./move-swap-write-plan";

// A small fixed plan: one block, two stations, each with pairs. Built fresh per
// test so mutation/determinism can be asserted precisely.
function plan(): ComplexPlanInput {
  return {
    id: "plan-1",
    version: 4,
    blocks: [
      {
        id: "block-1",
        stations: [
          {
            id: "st-A",
            instructorId: "instr-A",
            arena: "arena-1",
            sortOrder: 0,
            pairs: [
              { id: "p1", trainee1Id: "t1", trainee2Id: "t2", horseName: "Bella", note: "n1", sortOrder: 0 },
              { id: "p2", trainee1Id: "t3", trainee2Id: null, horseName: null, note: null, sortOrder: 1 },
            ],
          },
          {
            id: "st-B",
            instructorId: "instr-B",
            arena: "arena-2",
            sortOrder: 1,
            pairs: [
              { id: "p3", trainee1Id: "t4", trainee2Id: null, horseName: "Star", note: null, sortOrder: 0 },
            ],
          },
        ],
      },
    ],
  };
}

function expectSuccess(command: ComplexPlanMoveSwapCommand): ComplexPlanMoveSwapSuccess {
  const result = applyComplexPlanMoveSwap(plan(), command);
  assert.equal(result.ok, true, `expected core success, got ${result.ok ? "ok" : (result as { reason: string }).reason}`);
  return result as ComplexPlanMoveSwapSuccess;
}

test("trainee move updates ONLY the affected pairs' trainee slots, nothing else", () => {
  // Move t2 (p1.trainee2) into p2.trainee2. p1 auto-promotes nothing (t1 stays).
  const success = expectSuccess({
    op: "MOVE_TRAINEE",
    expectedVersion: 4,
    source: { pairId: "p1", slot: "trainee2" },
    destination: { pairId: "p2", slot: "trainee2" },
  });
  const built = buildComplexPlanWritePlan(success.operation, success.nextPlan, success.affected);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const wp = built.writePlan;
  // Only trainee updates; no horse/placement/instructor writes.
  assert.equal(wp.pairHorseUpdates.length, 0);
  assert.equal(wp.pairPlacementUpdates.length, 0);
  assert.equal(wp.stationInstructorUpdates.length, 0);
  // Exactly the two affected pairs, ids preserved, final trainee values.
  const byId = new Map(wp.pairTraineeUpdates.map((u) => [u.pairId, u]));
  assert.deepEqual([...byId.keys()].sort(), ["p1", "p2"]);
  assert.deepEqual(byId.get("p1"), { pairId: "p1", trainee1Id: "t1", trainee2Id: null });
  assert.deepEqual(byId.get("p2"), { pairId: "p2", trainee1Id: "t3", trainee2Id: "t2" });
  // Version contract carried through unchanged (pre-write value).
  assert.equal(wp.expectedVersion, 4);
  assert.equal(wp.requiresVersionIncrement, true);
  assert.equal(wp.planId, "plan-1");
});

test("trainee move that auto-promotes rewrites both slots of the source pair", () => {
  // Move t1 (p1.trainee1) into p2.trainee2 -> p1 promotes t2 into trainee1.
  const success = expectSuccess({
    op: "MOVE_TRAINEE",
    expectedVersion: 4,
    source: { pairId: "p1", slot: "trainee1" },
    destination: { pairId: "p2", slot: "trainee2" },
  });
  const built = buildComplexPlanWritePlan(success.operation, success.nextPlan, success.affected);
  assert.ok(built.ok);
  if (!built.ok) return;
  const byId = new Map(built.writePlan.pairTraineeUpdates.map((u) => [u.pairId, u]));
  // p1: t2 promoted to trainee1, trainee2 cleared.
  assert.deepEqual(byId.get("p1"), { pairId: "p1", trainee1Id: "t2", trainee2Id: null });
  assert.deepEqual(byId.get("p2"), { pairId: "p2", trainee1Id: "t3", trainee2Id: "t1" });
});

test("trainee swap updates exactly the two pairs' trainee slots", () => {
  const success = expectSuccess({
    op: "SWAP_TRAINEES",
    expectedVersion: 4,
    a: { pairId: "p1", slot: "trainee1" },
    b: { pairId: "p3", slot: "trainee1" },
  });
  const built = buildComplexPlanWritePlan(success.operation, success.nextPlan, success.affected);
  assert.ok(built.ok);
  if (!built.ok) return;
  const wp = built.writePlan;
  assert.equal(wp.pairHorseUpdates.length, 0);
  assert.equal(wp.pairPlacementUpdates.length, 0);
  const byId = new Map(wp.pairTraineeUpdates.map((u) => [u.pairId, u]));
  assert.deepEqual(byId.get("p1"), { pairId: "p1", trainee1Id: "t4", trainee2Id: "t2" });
  assert.deepEqual(byId.get("p3"), { pairId: "p3", trainee1Id: "t1", trainee2Id: null });
});

test("horse move updates ONLY horseName on the two affected pairs", () => {
  const success = expectSuccess({
    op: "MOVE_HORSE",
    expectedVersion: 4,
    sourcePairId: "p1",
    destinationPairId: "p2",
  });
  const built = buildComplexPlanWritePlan(success.operation, success.nextPlan, success.affected);
  assert.ok(built.ok);
  if (!built.ok) return;
  const wp = built.writePlan;
  assert.equal(wp.pairTraineeUpdates.length, 0);
  assert.equal(wp.pairPlacementUpdates.length, 0);
  assert.equal(wp.stationInstructorUpdates.length, 0);
  const byId = new Map(wp.pairHorseUpdates.map((u) => [u.pairId, u]));
  assert.deepEqual(byId.get("p1"), { pairId: "p1", horseName: null });
  assert.deepEqual(byId.get("p2"), { pairId: "p2", horseName: "Bella" });
});

test("horse swap updates exactly the two pairs' horseName", () => {
  const success = expectSuccess({
    op: "SWAP_HORSES",
    expectedVersion: 4,
    aPairId: "p1",
    bPairId: "p3",
  });
  const built = buildComplexPlanWritePlan(success.operation, success.nextPlan, success.affected);
  assert.ok(built.ok);
  if (!built.ok) return;
  const byId = new Map(built.writePlan.pairHorseUpdates.map((u) => [u.pairId, u]));
  assert.deepEqual(byId.get("p1"), { pairId: "p1", horseName: "Star" });
  assert.deepEqual(byId.get("p3"), { pairId: "p3", horseName: "Bella" });
});

test("instructor move onto an empty station updates exactly those two stations", () => {
  const p: ComplexPlanInput = {
    id: "plan-1",
    version: 1,
    blocks: [
      {
        id: "block-1",
        stations: [
          { id: "st-A", instructorId: "instr-A", arena: null, sortOrder: 0, pairs: [] },
          { id: "st-B", instructorId: null, arena: null, sortOrder: 1, pairs: [] },
        ],
      },
    ],
  };
  const result = applyComplexPlanMoveSwap(p, {
    op: "MOVE_INSTRUCTOR",
    expectedVersion: 1,
    sourceStationId: "st-A",
    destinationStationId: "st-B",
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  const built = buildComplexPlanWritePlan(result.operation, result.nextPlan, result.affected);
  assert.ok(built.ok);
  if (!built.ok) return;
  const wp = built.writePlan;
  assert.equal(wp.pairTraineeUpdates.length, 0);
  assert.equal(wp.pairHorseUpdates.length, 0);
  assert.equal(wp.pairPlacementUpdates.length, 0);
  const byId = new Map(wp.stationInstructorUpdates.map((u) => [u.stationId, u]));
  assert.deepEqual(byId.get("st-A"), { stationId: "st-A", instructorId: null });
  assert.deepEqual(byId.get("st-B"), { stationId: "st-B", instructorId: "instr-A" });
});

test("instructor swap updates exactly the two stations", () => {
  const success = expectSuccess({
    op: "SWAP_INSTRUCTORS",
    expectedVersion: 4,
    aStationId: "st-A",
    bStationId: "st-B",
  });
  const built = buildComplexPlanWritePlan(success.operation, success.nextPlan, success.affected);
  assert.ok(built.ok);
  if (!built.ok) return;
  const wp = built.writePlan;
  assert.equal(wp.pairTraineeUpdates.length, 0);
  assert.equal(wp.pairPlacementUpdates.length, 0);
  const byId = new Map(wp.stationInstructorUpdates.map((u) => [u.stationId, u]));
  assert.deepEqual(byId.get("st-A"), { stationId: "st-A", instructorId: "instr-B" });
  assert.deepEqual(byId.get("st-B"), { stationId: "st-B", instructorId: "instr-A" });
});

test("pair move includes the moved pair AND every reindexed sibling in both affected stations", () => {
  // Move p1 (st-A) into st-B. st-A loses p1 -> p2 reindexes to 0; st-B gains p1
  // at the end. Both stations are authoritative.
  const success = expectSuccess({
    op: "MOVE_PAIR",
    expectedVersion: 4,
    sourcePairId: "p1",
    destinationStationId: "st-B",
  });
  const built = buildComplexPlanWritePlan(success.operation, success.nextPlan, success.affected);
  assert.ok(built.ok);
  if (!built.ok) return;
  const wp = built.writePlan;
  assert.equal(wp.pairTraineeUpdates.length, 0);
  assert.equal(wp.pairHorseUpdates.length, 0);
  assert.equal(wp.stationInstructorUpdates.length, 0);
  const byId = new Map(wp.pairPlacementUpdates.map((u) => [u.pairId, u]));
  // Every pair in st-A and st-B, ids preserved, final placement + contiguous order.
  assert.deepEqual([...byId.keys()].sort(), ["p1", "p2", "p3"]);
  assert.deepEqual(byId.get("p2"), { pairId: "p2", stationId: "st-A", sortOrder: 0 });
  assert.deepEqual(byId.get("p3"), { pairId: "p3", stationId: "st-B", sortOrder: 0 });
  assert.deepEqual(byId.get("p1"), { pairId: "p1", stationId: "st-B", sortOrder: 1 });
});

test("pair swap across stations reproduces both stations' placement, no dupes", () => {
  const success = expectSuccess({
    op: "SWAP_PAIRS",
    expectedVersion: 4,
    aPairId: "p2",
    bPairId: "p3",
  });
  const built = buildComplexPlanWritePlan(success.operation, success.nextPlan, success.affected);
  assert.ok(built.ok);
  if (!built.ok) return;
  const wp = built.writePlan;
  const ids = wp.pairPlacementUpdates.map((u) => u.pairId).sort();
  // p1+p2 in st-A, p3 in st-B all reproduced; each pair exactly once.
  assert.deepEqual(ids, ["p1", "p2", "p3"]);
  const byId = new Map(wp.pairPlacementUpdates.map((u) => [u.pairId, u]));
  assert.equal(byId.get("p3")!.stationId, "st-A"); // p3 moved into st-A
  assert.equal(byId.get("p2")!.stationId, "st-B"); // p2 moved into st-B
});

test("pair swap within one station reproduces that station once, no duplicate pair", () => {
  const success = expectSuccess({
    op: "SWAP_PAIRS",
    expectedVersion: 4,
    aPairId: "p1",
    bPairId: "p2",
  });
  const built = buildComplexPlanWritePlan(success.operation, success.nextPlan, success.affected);
  assert.ok(built.ok);
  if (!built.ok) return;
  const updates = built.writePlan.pairPlacementUpdates;
  const ids = updates.map((u) => u.pairId);
  // st-A has p1 and p2; the station is listed once so each pair appears once.
  assert.deepEqual(ids.slice().sort(), ["p1", "p2"]);
  assert.equal(new Set(ids).size, ids.length, "no duplicate pair update");
  for (const u of updates) assert.equal(u.stationId, "st-A");
});

test("the write plan never includes an unaffected row", () => {
  // A trainee swap between p1 and p3 must not touch p2 at all.
  const success = expectSuccess({
    op: "SWAP_TRAINEES",
    expectedVersion: 4,
    a: { pairId: "p1", slot: "trainee1" },
    b: { pairId: "p3", slot: "trainee1" },
  });
  const built = buildComplexPlanWritePlan(success.operation, success.nextPlan, success.affected);
  assert.ok(built.ok);
  if (!built.ok) return;
  const touched = built.writePlan.pairTraineeUpdates.map((u) => u.pairId);
  assert.ok(!touched.includes("p2"), "p2 is unaffected and must not be written");
});

test("adapter is deterministic and non-mutating", () => {
  const success = expectSuccess({
    op: "MOVE_PAIR",
    expectedVersion: 4,
    sourcePairId: "p1",
    destinationStationId: "st-B",
  });
  const before = JSON.stringify(success.nextPlan);
  const a = buildComplexPlanWritePlan(success.operation, success.nextPlan, success.affected);
  const b = buildComplexPlanWritePlan(success.operation, success.nextPlan, success.affected);
  assert.deepEqual(a, b, "same input -> deep-equal output");
  assert.equal(JSON.stringify(success.nextPlan), before, "nextPlan must not be mutated");
});

test("the returned write plan is frozen (immutable)", () => {
  const success = expectSuccess({
    op: "MOVE_HORSE",
    expectedVersion: 4,
    sourcePairId: "p1",
    destinationPairId: "p2",
  });
  const built = buildComplexPlanWritePlan(success.operation, success.nextPlan, success.affected);
  assert.ok(built.ok);
  if (!built.ok) return;
  assert.ok(Object.isFrozen(built.writePlan));
  assert.ok(Object.isFrozen(built.writePlan.pairHorseUpdates));
  assert.throws(() => {
    (built.writePlan.pairHorseUpdates as ComplexPairHorseUpdateMutable[]).push({ pairId: "x", horseName: null });
  });
});
type ComplexPairHorseUpdateMutable = { pairId: string; horseName: string | null };

test("a malformed success shape (affected id missing from nextPlan) fails closed", () => {
  const success = expectSuccess({
    op: "MOVE_HORSE",
    expectedVersion: 4,
    sourcePairId: "p1",
    destinationPairId: "p2",
  });
  // Tamper: claim a pair id that is not in nextPlan. Adapter must return ok:false.
  const tampered = { ...success.affected, pairIds: [...success.affected.pairIds, "ghost-pair"] };
  const built = buildComplexPlanWritePlan(success.operation, success.nextPlan, tampered);
  assert.equal(built.ok, false);
});

test("a malformed success shape (affected station missing) fails closed for pair ops", () => {
  const success = expectSuccess({
    op: "MOVE_PAIR",
    expectedVersion: 4,
    sourcePairId: "p1",
    destinationStationId: "st-B",
  });
  const tampered = { ...success.affected, stationIds: [...success.affected.stationIds, "ghost-station"] };
  const built = buildComplexPlanWritePlan(success.operation, success.nextPlan, tampered);
  assert.equal(built.ok, false);
});

test("an unknown operation tag fails closed", () => {
  const p = plan();
  const built = buildComplexPlanWritePlan(
    "NOT_A_REAL_OP" as never,
    p,
    { blockIds: ["block-1"], stationIds: ["st-A"], pairIds: ["p1"] }
  );
  assert.equal(built.ok, false);
});

test("failure results carry no ids/names/PII", () => {
  const p = plan();
  const built = buildComplexPlanWritePlan(
    "MOVE_HORSE",
    p,
    { blockIds: [], stationIds: [], pairIds: ["ghost"] }
  );
  // The only failure shape is `{ ok: false }` - nothing else to leak.
  assert.deepEqual(built, { ok: false });
});
