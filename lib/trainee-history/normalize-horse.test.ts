/**
 * Executable tests for pure horse normalization (Stage GH2A1).
 *
 * Run with: npx tsx --test lib/trainee-history/normalize-horse.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHorse, type NormalizeHorseResult } from "./normalize-horse";

function valueOf(result: NormalizeHorseResult) {
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("unreachable");
  }
  return result.value;
}

function isInvalid(result: NormalizeHorseResult): boolean {
  return !result.ok && result.code === "INVALID_HORSE_STATE";
}

test("state 1: ranch horse", () => {
  assert.deepEqual(
    valueOf(
      normalizeHorse({ assignedHorseName: "Bella", hasPrivateHorse: false, privateHorseName: null }),
    ),
    { assignedHorseName: "Bella", hasPrivateHorse: false, privateHorseName: null },
  );
});

test("state 2: private horse with name", () => {
  assert.deepEqual(
    valueOf(
      normalizeHorse({ assignedHorseName: null, hasPrivateHorse: true, privateHorseName: "Star" }),
    ),
    { assignedHorseName: null, hasPrivateHorse: true, privateHorseName: "Star" },
  );
});

test("state 3: private horse without name", () => {
  assert.deepEqual(
    valueOf(
      normalizeHorse({ assignedHorseName: null, hasPrivateHorse: true, privateHorseName: null }),
    ),
    { assignedHorseName: null, hasPrivateHorse: true, privateHorseName: null },
  );
});

test("state 4: no horse", () => {
  assert.deepEqual(
    valueOf(
      normalizeHorse({ assignedHorseName: null, hasPrivateHorse: false, privateHorseName: null }),
    ),
    { assignedHorseName: null, hasPrivateHorse: false, privateHorseName: null },
  );
});

test("names are trimmed; whitespace-only collapses to null", () => {
  assert.deepEqual(
    valueOf(
      normalizeHorse({ assignedHorseName: "  Bella ", hasPrivateHorse: false, privateHorseName: null }),
    ),
    { assignedHorseName: "Bella", hasPrivateHorse: false, privateHorseName: null },
  );
  // whitespace-only assigned name with no private horse → canonical "no horse".
  assert.deepEqual(
    valueOf(
      normalizeHorse({ assignedHorseName: "   ", hasPrivateHorse: false, privateHorseName: null }),
    ),
    { assignedHorseName: null, hasPrivateHorse: false, privateHorseName: null },
  );
});

test("contradictory / noncanonical payloads → INVALID_HORSE_STATE", () => {
  // ranch name AND private horse
  assert.ok(
    isInvalid(
      normalizeHorse({ assignedHorseName: "Bella", hasPrivateHorse: true, privateHorseName: null }),
    ),
  );
  // ranch name AND private name
  assert.ok(
    isInvalid(
      normalizeHorse({ assignedHorseName: "Bella", hasPrivateHorse: false, privateHorseName: "Star" }),
    ),
  );
  // private name without private horse
  assert.ok(
    isInvalid(
      normalizeHorse({ assignedHorseName: null, hasPrivateHorse: false, privateHorseName: "Star" }),
    ),
  );
  // non-boolean hasPrivateHorse
  assert.ok(
    isInvalid(
      normalizeHorse({ assignedHorseName: null, hasPrivateHorse: "yes", privateHorseName: null }),
    ),
  );
  // wrong-typed name
  assert.ok(
    isInvalid(
      normalizeHorse({ assignedHorseName: 42, hasPrivateHorse: false, privateHorseName: null }),
    ),
  );
});
