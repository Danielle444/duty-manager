import { test } from "node:test";
import assert from "node:assert/strict";

import { applyTeachingPracticeFeedbackVisibility } from "./teaching-practice-feedback-visibility-core";

// A representative feedback view - free text, rating, updater name and
// timestamp - so a denied result can be proven to leak none of them. Nested
// object included so a shallow/partial exposure would be caught too.
function sampleFeedbackView() {
  return {
    feedback: "SECRET_FREE_TEXT",
    ratingHalfPoints: 7,
    updatedByName: "SECRET_UPDATER",
    updatedAt: "2026-07-19T00:00:00.000Z",
    nested: { hidden: "SECRET_NESTED" },
  };
}

test("authorized true returns the exact same reference, unchanged", () => {
  const view = sampleFeedbackView();
  const result = applyTeachingPracticeFeedbackVisibility(view, true);
  // Exact reference identity - not a copy, not a mutation.
  assert.equal(result, view);
  assert.deepEqual(result, sampleFeedbackView());
});

test("false returns null", () => {
  const view = sampleFeedbackView();
  const result = applyTeachingPracticeFeedbackVisibility(view, false);
  assert.equal(result, null);
});

test("null feedback returns null when authorized", () => {
  assert.equal(applyTeachingPracticeFeedbackVisibility(null, true), null);
});

test("null feedback returns null when denied", () => {
  assert.equal(applyTeachingPracticeFeedbackVisibility(null, false), null);
});

test("undefined / unknown runtime capability returns null (default deny)", () => {
  const view = sampleFeedbackView();
  // These are not reachable through the typed signature, but the helper must
  // fail closed against any runtime value the compiler didn't catch.
  const denials: unknown[] = [undefined, null, 0, 1, "", "true", "false", NaN, {}, []];
  for (const cap of denials) {
    const result = applyTeachingPracticeFeedbackVisibility(
      view,
      cap as unknown as boolean
    );
    assert.equal(result, null, `capability ${String(cap)} must be denied`);
  }
});

test("input object is not mutated on a denied result", () => {
  const view = sampleFeedbackView();
  applyTeachingPracticeFeedbackVisibility(view, false);
  assert.deepEqual(view, sampleFeedbackView());
});

test("input object is not mutated on an authorized result", () => {
  const view = sampleFeedbackView();
  applyTeachingPracticeFeedbackVisibility(view, true);
  assert.deepEqual(view, sampleFeedbackView());
});

test("no rating / free text / updater / timestamp survives a denied result", () => {
  const view = sampleFeedbackView();
  const result = applyTeachingPracticeFeedbackVisibility(view, false);
  // A null result carries no fields at all - nothing to leak.
  assert.equal(result, null);
  // Serialized form of the denied result contains none of the secret values.
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("SECRET_FREE_TEXT"), false);
  assert.equal(serialized.includes("SECRET_UPDATER"), false);
  assert.equal(serialized.includes("SECRET_NESTED"), false);
  assert.equal(serialized.includes("7"), false);
});
