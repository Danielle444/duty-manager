// Pure unit tests for the block-scoped instructor placement index (Stage 3C.3b).
// Run:
//   npx tsx --test lib/riding-complex-schedule-board/instructor-placement-index.test.ts
//
// Pure and DB-free: no Prisma, server actions, React, network, clock, or random.
// Every input is a fixed literal built fresh per test so mutation, determinism,
// block-scoping, and fail-closed behaviour can be asserted precisely.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInstructorPlacementIndex,
  resolveInstructorPlacement,
  resolveStationInstructor,
  type InstructorPlacementPlanInput,
} from "./instructor-placement-index";

// Two blocks. In b1: s1 staffed by "inst-thunder", s2 unassigned (blank), s3
// staffed by "inst-comet". In b2: s4 staffed by "inst-thunder" - the SAME
// instructor, in another block, which must NOT count as occupied in b1.
function basePlan(): InstructorPlacementPlanInput {
  return {
    blocks: [
      {
        id: "b1",
        stations: [
          { id: "s1", instructorId: "inst-thunder" },
          { id: "s2", instructorId: "  " },
          { id: "s3", instructorId: "inst-comet" },
        ],
      },
      {
        id: "b2",
        stations: [{ id: "s4", instructorId: "inst-thunder" }],
      },
    ],
  };
}

const snapshot = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test("resolves a free instructor as FREE", () => {
  const index = buildInstructorPlacementIndex(basePlan());
  assert.deepEqual(resolveInstructorPlacement(index, "b1", "inst-nobody"), { status: "FREE" });
});

test("resolves an occupied instructor to its station, preserving the exact id", () => {
  const index = buildInstructorPlacementIndex(basePlan());
  assert.deepEqual(resolveInstructorPlacement(index, "b1", "inst-thunder"), {
    status: "OCCUPIED",
    stationId: "s1",
    instructorId: "inst-thunder",
  });
});

test("an instructor id is NOT trimmed or case-folded (exact-match only)", () => {
  const index = buildInstructorPlacementIndex(basePlan());
  // Unlike a horse name, the id is opaque: different casing/whitespace does NOT
  // resolve to the stored instructor. It stays FREE.
  assert.deepEqual(resolveInstructorPlacement(index, "b1", "INST-THUNDER"), { status: "FREE" });
  assert.deepEqual(resolveInstructorPlacement(index, "b1", "  inst-thunder "), { status: "FREE" });
});

test("a blank instructor is a valid unassigned station and occupies nothing", () => {
  const index = buildInstructorPlacementIndex(basePlan());
  // s2's instructor is whitespace-only -> stored null; querying blank/null -> FREE;
  // the station still resolves as an empty destination.
  assert.deepEqual(resolveInstructorPlacement(index, "b1", "   "), { status: "FREE" });
  assert.deepEqual(resolveInstructorPlacement(index, "b1", null), { status: "FREE" });
  assert.deepEqual(resolveStationInstructor(index, "b1", "s2"), { instructorId: null });
});

test("a null instructorId station is a valid empty destination", () => {
  const plan: InstructorPlacementPlanInput = {
    blocks: [{ id: "b1", stations: [{ id: "s1", instructorId: null }] }],
  };
  const index = buildInstructorPlacementIndex(plan);
  assert.deepEqual(resolveStationInstructor(index, "b1", "s1"), { instructorId: null });
});

test("the same instructor in another block remains free here (block-scoped)", () => {
  const index = buildInstructorPlacementIndex(basePlan());
  // inst-thunder is in b1/s1 and (separately) in b2/s4. Each block sees its own.
  assert.deepEqual(resolveInstructorPlacement(index, "b2", "inst-thunder"), {
    status: "OCCUPIED",
    stationId: "s4",
    instructorId: "inst-thunder",
  });
  // inst-comet lives only in b1 -> FREE in b2.
  assert.deepEqual(resolveInstructorPlacement(index, "b2", "inst-comet"), { status: "FREE" });
});

test("a duplicate instructor id inside one block resolves AMBIGUOUS", () => {
  const plan: InstructorPlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          { id: "s1", instructorId: "inst-dusty" },
          { id: "s2", instructorId: "inst-dusty" }, // same id, two stations
        ],
      },
    ],
  };
  const index = buildInstructorPlacementIndex(plan);
  assert.deepEqual(resolveInstructorPlacement(index, "b1", "inst-dusty"), { status: "AMBIGUOUS" });
});

test("resolves the instructor on a station, and null for a missing/other-block station", () => {
  const index = buildInstructorPlacementIndex(basePlan());
  assert.deepEqual(resolveStationInstructor(index, "b1", "s1"), { instructorId: "inst-thunder" });
  assert.deepEqual(resolveStationInstructor(index, "b1", "s2"), { instructorId: null });
  assert.deepEqual(resolveStationInstructor(index, "b1", "s3"), { instructorId: "inst-comet" });
  // s4 lives in b2, so it is not resolvable within b1.
  assert.equal(resolveStationInstructor(index, "b1", "s4"), null);
  assert.equal(resolveStationInstructor(index, "b1", "missing"), null);
  assert.equal(resolveStationInstructor(index, "missingBlock", "s1"), null);
});

test("a duplicated station id inside one block fails closed to null (no arbitrary pick)", () => {
  const plan: InstructorPlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          { id: "dupStation", instructorId: "inst-a" },
          { id: "dupStation", instructorId: "inst-b" },
        ],
      },
    ],
  };
  const index = buildInstructorPlacementIndex(plan);
  assert.equal(resolveStationInstructor(index, "b1", "dupStation"), null);
});

test("a duplicate block id does not select an arbitrary placement (AMBIGUOUS)", () => {
  // The same block id appears twice, each staffing "inst-storm" on a different
  // station. Merged in-block, inst-storm is duplicated -> AMBIGUOUS, never a pick.
  const plan: InstructorPlacementPlanInput = {
    blocks: [
      { id: "b1", stations: [{ id: "s1", instructorId: "inst-storm" }] },
      { id: "b1", stations: [{ id: "s2", instructorId: "inst-storm" }] },
    ],
  };
  const index = buildInstructorPlacementIndex(plan);
  assert.deepEqual(resolveInstructorPlacement(index, "b1", "inst-storm"), { status: "AMBIGUOUS" });
});

test("a malformed instructorId type skips the station; it is not an empty destination", () => {
  const plan: InstructorPlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          // Valid station id, but a corrupt (non-string, non-null) instructorId.
          { id: "corrupt", instructorId: 5 as unknown as string },
          { id: "s2", instructorId: "inst-blaze" },
        ],
      },
    ],
  };
  const index = buildInstructorPlacementIndex(plan);
  // The corrupt station registers no destination and no occupancy.
  assert.equal(resolveStationInstructor(index, "b1", "corrupt"), null);
  // A valid sibling still resolves normally.
  assert.deepEqual(resolveInstructorPlacement(index, "b1", "inst-blaze"), {
    status: "OCCUPIED",
    stationId: "s2",
    instructorId: "inst-blaze",
  });
});

test("a malformed station id skips the station entirely, valid siblings still resolve", () => {
  const plan: InstructorPlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          { id: 0 as unknown as string, instructorId: "inst-ghost" },
          { id: "s2", instructorId: "inst-blaze" },
        ],
      },
    ],
  };
  const index = buildInstructorPlacementIndex(plan);
  // inst-ghost belonged only to the malformed station -> not registered.
  assert.deepEqual(resolveInstructorPlacement(index, "b1", "inst-ghost"), { status: "FREE" });
  assert.deepEqual(resolveInstructorPlacement(index, "b1", "inst-blaze"), {
    status: "OCCUPIED",
    stationId: "s2",
    instructorId: "inst-blaze",
  });
});

test("malformed / null / sparse input fails closed without throwing", () => {
  const malformed: unknown[] = [
    null,
    undefined,
    {},
    { blocks: null },
    { blocks: "nope" },
    { blocks: [null, 42, "x"] },
    { blocks: [{ id: "b1", stations: null }] },
    { blocks: [{ id: null, stations: [] }] },
    { blocks: [{ id: "b1", stations: [null, 7, { id: null }] }] },
    { blocks: [{ id: "b1", stations: [{ id: "s", instructorId: {} }] }] },
  ];
  for (const input of malformed) {
    assert.doesNotThrow(() => {
      const index = buildInstructorPlacementIndex(input as InstructorPlacementPlanInput);
      assert.deepEqual(resolveInstructorPlacement(index, "b1", "inst-thunder"), { status: "FREE" });
      assert.equal(resolveStationInstructor(index, "b1", "definitely-missing"), null);
    });
  }
});

test("a corrupt-instructor station build is non-mutating and never throws", () => {
  const plan: InstructorPlacementPlanInput = {
    blocks: [{ id: "b1", stations: [{ id: "corrupt", instructorId: 7 as unknown as string }] }],
  };
  const before = snapshot(plan);
  assert.doesNotThrow(() => buildInstructorPlacementIndex(plan));
  assert.deepEqual(snapshot(plan), before, "corrupt input must not be mutated");
});

test("deterministic and non-mutating: input is untouched, output is stable", () => {
  const plan = basePlan();
  const before = snapshot(plan);
  const a = buildInstructorPlacementIndex(plan);
  const b = buildInstructorPlacementIndex(plan);
  assert.deepEqual(snapshot(plan), before, "input must not be mutated");
  assert.deepEqual(
    resolveInstructorPlacement(a, "b1", "inst-thunder"),
    resolveInstructorPlacement(b, "b1", "inst-thunder")
  );
});

test("the input plan is not frozen (caller-owned), the results are frozen", () => {
  const plan = basePlan();
  const index = buildInstructorPlacementIndex(plan);
  assert.equal(Object.isFrozen(plan), false, "caller input must not be frozen");
  assert.equal(Object.isFrozen(index), true);
  const placement = resolveInstructorPlacement(index, "b1", "inst-thunder");
  assert.equal(Object.isFrozen(placement), true);
  const stationInstructor = resolveStationInstructor(index, "b1", "s1");
  assert.equal(Object.isFrozen(stationInstructor), true);
});

test("carries no data beyond structural id + stored instructor id", () => {
  // The OCCUPIED result exposes exactly stationId + instructorId + status; the
  // station-instructor result exposes exactly instructorId. Nothing arena/pair/
  // trainee-like leaks.
  const index = buildInstructorPlacementIndex(basePlan());
  const placement = resolveInstructorPlacement(index, "b1", "inst-thunder");
  assert.equal(placement.status, "OCCUPIED");
  if (placement.status === "OCCUPIED") {
    assert.deepEqual(Object.keys(placement).sort(), ["instructorId", "stationId", "status"]);
  }
  const stationInstructor = resolveStationInstructor(index, "b1", "s1");
  assert.deepEqual(Object.keys(stationInstructor ?? {}), ["instructorId"]);
});
