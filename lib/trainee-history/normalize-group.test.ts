/**
 * Executable tests for pure group normalization (Stage GH2A1).
 *
 * Run with: npx tsx --test lib/trainee-history/normalize-group.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGroup, type NormalizeGroupResult } from "./normalize-group";

function codeOf(result: NormalizeGroupResult): string {
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("unreachable");
  }
  return result.code;
}

test("valid groups normalize", () => {
  assert.deepEqual(normalizeGroup({ groupName: "א", subgroupNumber: 1 }), {
    ok: true,
    value: { groupName: "א", subgroupNumber: 1 },
  });
  assert.deepEqual(normalizeGroup({ groupName: "ב", subgroupNumber: null }), {
    ok: true,
    value: { groupName: "ב", subgroupNumber: null },
  });
  assert.deepEqual(normalizeGroup({ groupName: null, subgroupNumber: null }), {
    ok: true,
    value: { groupName: null, subgroupNumber: null },
  });
});

test("invalid groupName → INVALID_GROUP", () => {
  assert.equal(codeOf(normalizeGroup({ groupName: "ג", subgroupNumber: null })), "INVALID_GROUP");
  assert.equal(codeOf(normalizeGroup({ groupName: "", subgroupNumber: null })), "INVALID_GROUP");
  assert.equal(codeOf(normalizeGroup({ groupName: 5, subgroupNumber: null })), "INVALID_GROUP");
  assert.equal(
    codeOf(normalizeGroup({ groupName: undefined, subgroupNumber: null })),
    "INVALID_GROUP",
  );
});

test("invalid subgroupNumber → INVALID_SUBGROUP", () => {
  for (const bad of [0, -1, 1.5, Number.NaN, "1", true]) {
    assert.equal(
      codeOf(normalizeGroup({ groupName: "א", subgroupNumber: bad })),
      "INVALID_SUBGROUP",
      `expected INVALID_SUBGROUP for ${String(bad)}`,
    );
  }
});
