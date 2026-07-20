// Pure unit tests for the block-scoped horse placement index (Stage 3C.3a). Run:
//   npx tsx --test lib/riding-complex-schedule-board/horse-placement-index.test.ts
//
// Pure and DB-free: no Prisma, server actions, React, network, clock, or random.
// Every input is a fixed literal built fresh per test so mutation, determinism,
// block-scoping, and fail-closed behaviour can be asserted precisely.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHorsePlacementIndex,
  resolveHorsePlacement,
  resolvePairHorse,
  type HorsePlacementPlanInput,
} from "./horse-placement-index";

// Two blocks. In b1: s1 has p1 ("Thunder") and p2 (blank horse). s2 has p3
// ("Comet"). In b2: s3 has p4 ("Thunder") - the SAME name, in another block,
// which must NOT count as occupied in b1.
function basePlan(): HorsePlacementPlanInput {
  return {
    blocks: [
      {
        id: "b1",
        stations: [
          {
            pairs: [
              { id: "p1", horseName: "Thunder" },
              { id: "p2", horseName: "  " },
            ],
          },
          { pairs: [{ id: "p3", horseName: "Comet" }] },
        ],
      },
      {
        id: "b2",
        stations: [{ pairs: [{ id: "p4", horseName: "Thunder" }] }],
      },
    ],
  };
}

const snapshot = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test("resolves a free horse as FREE", () => {
  const index = buildHorsePlacementIndex(basePlan());
  assert.deepEqual(resolveHorsePlacement(index, "b1", "Nobody"), { status: "FREE" });
});

test("resolves an occupied horse to its pair, preserving stored casing", () => {
  const index = buildHorsePlacementIndex(basePlan());
  assert.deepEqual(resolveHorsePlacement(index, "b1", "Thunder"), {
    status: "OCCUPIED",
    pairId: "p1",
    horseName: "Thunder",
  });
});

test("occupancy is trim + case-insensitive on the candidate", () => {
  const index = buildHorsePlacementIndex(basePlan());
  // Different casing/whitespace still resolves to the same occupied pair, and the
  // OCCUPIED result carries the STORED (case-preserved) value, not the query.
  assert.deepEqual(resolveHorsePlacement(index, "b1", "  thUNDer "), {
    status: "OCCUPIED",
    pairId: "p1",
    horseName: "Thunder",
  });
});

test("a stored horse preserves its exact casing/whitespace-trim as the value", () => {
  const plan: HorsePlacementPlanInput = {
    blocks: [{ id: "b1", stations: [{ pairs: [{ id: "p1", horseName: "  Star Light  " }] }] }],
  };
  const index = buildHorsePlacementIndex(plan);
  assert.deepEqual(resolveHorsePlacement(index, "b1", "star light"), {
    status: "OCCUPIED",
    pairId: "p1",
    horseName: "Star Light",
  });
  assert.deepEqual(resolvePairHorse(index, "b1", "p1"), { horseName: "Star Light" });
});

test("a blank horse occupies nothing and is absent from occupancy", () => {
  const index = buildHorsePlacementIndex(basePlan());
  // p2's horse is whitespace-only -> stored null; querying blank -> FREE; the pair
  // still resolves as an empty destination.
  assert.deepEqual(resolveHorsePlacement(index, "b1", "   "), { status: "FREE" });
  assert.deepEqual(resolveHorsePlacement(index, "b1", null), { status: "FREE" });
  assert.deepEqual(resolvePairHorse(index, "b1", "p2"), { horseName: null });
});

test("the same horse in another block remains free here (block-scoped)", () => {
  const index = buildHorsePlacementIndex(basePlan());
  // Thunder is in b1/p1 and (separately) in b2/p4. Each block sees its own.
  assert.deepEqual(resolveHorsePlacement(index, "b2", "Thunder"), {
    status: "OCCUPIED",
    pairId: "p4",
    horseName: "Thunder",
  });
  // Comet lives only in b1 -> FREE in b2.
  assert.deepEqual(resolveHorsePlacement(index, "b2", "Comet"), { status: "FREE" });
});

test("a duplicate normalized horse key inside one block resolves AMBIGUOUS", () => {
  const plan: HorsePlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          {
            pairs: [
              { id: "p1", horseName: "Dusty" },
              { id: "p2", horseName: " dusty " }, // same normalized key
            ],
          },
        ],
      },
    ],
  };
  const index = buildHorsePlacementIndex(plan);
  assert.deepEqual(resolveHorsePlacement(index, "b1", "Dusty"), { status: "AMBIGUOUS" });
});

test("resolves the horse on a pair, and null for a missing/other-block pair", () => {
  const index = buildHorsePlacementIndex(basePlan());
  assert.deepEqual(resolvePairHorse(index, "b1", "p1"), { horseName: "Thunder" });
  assert.deepEqual(resolvePairHorse(index, "b1", "p2"), { horseName: null });
  assert.deepEqual(resolvePairHorse(index, "b1", "p3"), { horseName: "Comet" });
  // p4 lives in b2, so it is not resolvable within b1.
  assert.equal(resolvePairHorse(index, "b1", "p4"), null);
  assert.equal(resolvePairHorse(index, "b1", "missing"), null);
  assert.equal(resolvePairHorse(index, "missingBlock", "p1"), null);
});

test("a duplicated pair id inside one block fails closed to null (no arbitrary pick)", () => {
  const plan: HorsePlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          { pairs: [{ id: "dupPair", horseName: "A" }] },
          { pairs: [{ id: "dupPair", horseName: "B" }] },
        ],
      },
    ],
  };
  const index = buildHorsePlacementIndex(plan);
  assert.equal(resolvePairHorse(index, "b1", "dupPair"), null);
});

test("a duplicate block id does not select an arbitrary placement (AMBIGUOUS)", () => {
  // The same block id appears twice, each placing "Storm" on a different pair.
  // Merged in-block, "Storm" is duplicated -> AMBIGUOUS, never an arbitrary pick.
  const plan: HorsePlacementPlanInput = {
    blocks: [
      { id: "b1", stations: [{ pairs: [{ id: "p1", horseName: "Storm" }] }] },
      { id: "b1", stations: [{ pairs: [{ id: "p2", horseName: "storm" }] }] },
    ],
  };
  const index = buildHorsePlacementIndex(plan);
  assert.deepEqual(resolveHorsePlacement(index, "b1", "Storm"), { status: "AMBIGUOUS" });
});

test("a malformed horseName type skips the pair; it is not an empty destination", () => {
  const plan: HorsePlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          {
            pairs: [
              // Valid pair id, but a corrupt (non-string, non-null) horseName.
              { id: "corrupt", horseName: 5 as unknown as string },
              { id: "p2", horseName: "Blaze" },
            ],
          },
        ],
      },
    ],
  };
  const index = buildHorsePlacementIndex(plan);
  // The corrupt pair registers no destination and no occupancy.
  assert.equal(resolvePairHorse(index, "b1", "corrupt"), null);
  // A valid sibling still resolves normally.
  assert.deepEqual(resolveHorsePlacement(index, "b1", "Blaze"), {
    status: "OCCUPIED",
    pairId: "p2",
    horseName: "Blaze",
  });
});

test("a malformed pair id skips the pair entirely, valid siblings still resolve", () => {
  const plan: HorsePlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          {
            pairs: [
              { id: 0 as unknown as string, horseName: "Ghost" },
              { id: "p2", horseName: "Blaze" },
            ],
          },
        ],
      },
    ],
  };
  const index = buildHorsePlacementIndex(plan);
  // "Ghost" belonged only to the malformed pair -> not registered.
  assert.deepEqual(resolveHorsePlacement(index, "b1", "Ghost"), { status: "FREE" });
  assert.deepEqual(resolveHorsePlacement(index, "b1", "Blaze"), {
    status: "OCCUPIED",
    pairId: "p2",
    horseName: "Blaze",
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
    { blocks: [{ id: "b1", stations: [null, { pairs: null }] }] },
    { blocks: [{ id: "b1", stations: [{ pairs: [null, 7, { id: null }] }] }] },
    { blocks: [{ id: "b1", stations: [{ pairs: [{ id: "p", horseName: {} }] }] }] },
  ];
  for (const input of malformed) {
    assert.doesNotThrow(() => {
      const index = buildHorsePlacementIndex(input as HorsePlacementPlanInput);
      assert.deepEqual(resolveHorsePlacement(index, "b1", "Thunder"), { status: "FREE" });
      assert.equal(resolvePairHorse(index, "b1", "definitely-missing"), null);
    });
  }
});

test("a corrupt-horse pair build is non-mutating and never throws", () => {
  const plan: HorsePlacementPlanInput = {
    blocks: [
      { id: "b1", stations: [{ pairs: [{ id: "corrupt", horseName: 7 as unknown as string }] }] },
    ],
  };
  const before = snapshot(plan);
  assert.doesNotThrow(() => buildHorsePlacementIndex(plan));
  assert.deepEqual(snapshot(plan), before, "corrupt input must not be mutated");
});

test("deterministic and non-mutating: input is untouched, output is stable", () => {
  const plan = basePlan();
  const before = snapshot(plan);
  const a = buildHorsePlacementIndex(plan);
  const b = buildHorsePlacementIndex(plan);
  assert.deepEqual(snapshot(plan), before, "input must not be mutated");
  assert.deepEqual(resolveHorsePlacement(a, "b1", "Thunder"), resolveHorsePlacement(b, "b1", "Thunder"));
});

test("the input plan is not frozen (caller-owned), the results are frozen", () => {
  const plan = basePlan();
  const index = buildHorsePlacementIndex(plan);
  assert.equal(Object.isFrozen(plan), false, "caller input must not be frozen");
  assert.equal(Object.isFrozen(index), true);
  const placement = resolveHorsePlacement(index, "b1", "Thunder");
  assert.equal(Object.isFrozen(placement), true);
  const pairHorse = resolvePairHorse(index, "b1", "p1");
  assert.equal(Object.isFrozen(pairHorse), true);
});

test("carries no data beyond structural id + stored horse value", () => {
  // The OCCUPIED result exposes exactly pairId + horseName + status; the pair-horse
  // result exposes exactly horseName. Nothing trainee/note/instructor-like leaks.
  const index = buildHorsePlacementIndex(basePlan());
  const placement = resolveHorsePlacement(index, "b1", "Thunder");
  assert.equal(placement.status, "OCCUPIED");
  if (placement.status === "OCCUPIED") {
    assert.deepEqual(Object.keys(placement).sort(), ["horseName", "pairId", "status"]);
  }
  const pairHorse = resolvePairHorse(index, "b1", "p1");
  assert.deepEqual(Object.keys(pairHorse ?? {}), ["horseName"]);
});
