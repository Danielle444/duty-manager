/**
 * Combined Participation Slice 1 - PURE unit tests for parseHebrewYesNo.
 *
 * Run with: npx tsx --test lib/course/parse-hebrew-yes-no.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseHebrewYesNo } from "./parse-hebrew-yes-no";

test('"כן" -> true, not malformed', () => {
  assert.deepEqual(parseHebrewYesNo("כן"), { value: true, malformed: false });
  // Surrounding whitespace is trimmed.
  assert.deepEqual(parseHebrewYesNo("  כן  "), { value: true, malformed: false });
});

test('"לא" -> false, not malformed', () => {
  assert.deepEqual(parseHebrewYesNo("לא"), { value: false, malformed: false });
  assert.deepEqual(parseHebrewYesNo("\tלא\n"), { value: false, malformed: false });
});

test("blank / whitespace / null / undefined / non-string -> null, not malformed", () => {
  for (const blank of ["", "   ", "\t\n", null, undefined, 0, false, {}]) {
    assert.deepEqual(
      parseHebrewYesNo(blank),
      { value: null, malformed: false },
      `expected ${JSON.stringify(blank)} to be a non-malformed null`,
    );
  }
});

test("any other non-empty string -> null, malformed (no prefix acceptance)", () => {
  for (const bad of ["כן משהו", "לא אולי", "x", "yes", "no", "כ", "ל", "כןכן"]) {
    assert.deepEqual(
      parseHebrewYesNo(bad),
      { value: null, malformed: true },
      `expected ${JSON.stringify(bad)} to be malformed`,
    );
  }
});
