/**
 * Combined Participation Slice 1 - PURE unit tests for the shared preview
 * malformed-detection helpers.
 *
 * Run with: npx tsx --test lib/course/combined-participation-import-validation.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  hasUnresolvedMalformedCombinedParticipation,
  isCombinedParticipationMalformed,
  malformedCombinedParticipationKeys,
} from "./combined-participation-import-validation";

test("malformed detection is true ONLY for the malformed marker", () => {
  assert.equal(isCombinedParticipationMalformed({ combinedParticipationMalformed: true }), true);
  // Anything other than a strict `true` does not gate.
  for (const marker of [false, undefined, null, "true", 1, 0]) {
    assert.equal(
      isCombinedParticipationMalformed({ combinedParticipationMalformed: marker }),
      false,
      `marker ${JSON.stringify(marker)} must not gate`,
    );
  }
});

test("blank / כן / לא rows (malformed false) never gate", () => {
  const items = [
    { key: "a", combinedParticipationMalformed: false }, // כן/לא/blank all land here
    { key: "b", combinedParticipationMalformed: false },
  ];
  assert.equal(hasUnresolvedMalformedCombinedParticipation(items), false);
  assert.deepEqual(malformedCombinedParticipationKeys(items), []);
});

test("a single malformed row gates and is reported by key", () => {
  const items = [
    { key: "a", combinedParticipationMalformed: false },
    { key: "b", combinedParticipationMalformed: true },
    { key: "c", combinedParticipationMalformed: false },
  ];
  assert.equal(hasUnresolvedMalformedCombinedParticipation(items), true);
  assert.deepEqual(malformedCombinedParticipationKeys(items), ["b"]);
});

test("empty list does not gate", () => {
  assert.equal(hasUnresolvedMalformedCombinedParticipation([]), false);
  assert.deepEqual(malformedCombinedParticipationKeys([]), []);
});
