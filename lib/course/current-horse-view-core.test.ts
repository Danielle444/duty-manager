/**
 * MULTI-COURSE W8A-4 - pure unit tests for the enrollment-scoped current-horse
 * VIEW core. No DB, no framework: node:test + node:assert/strict, run with
 *
 *   npx tsx --test lib/course/current-horse-view-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { getHorseDisplayInfo } from "../horse-info";
import {
  resolveCurrentHorseView,
  NoCurrentHorseEnrollmentError,
  AmbiguousCurrentHorseEnrollmentError,
  InactiveCurrentHorseEnrollmentError,
  type CurrentHorseEnrollmentCandidate,
} from "./current-horse-view-core";

function candidate(
  over: Partial<CurrentHorseEnrollmentCandidate> & { id: string },
): CurrentHorseEnrollmentCandidate {
  return {
    status: "ACTIVE",
    hasPrivateHorse: false,
    privateHorseName: null,
    assignedHorseName: null,
    ...over,
  };
}

test("zero enrollment candidates -> fails closed", () => {
  assert.throws(() => resolveCurrentHorseView([]), NoCurrentHorseEnrollmentError);
});

test("exactly one ACTIVE enrollment -> returns its cache verbatim (ranch horse)", () => {
  const view = resolveCurrentHorseView([
    candidate({ id: "enr_1", assignedHorseName: "Bella" }),
  ]);
  assert.deepEqual(view, {
    hasPrivateHorse: false,
    privateHorseName: null,
    assignedHorseName: "Bella",
  });
});

test("exactly one ACTIVE enrollment -> returns its cache verbatim (private horse)", () => {
  const view = resolveCurrentHorseView([
    candidate({ id: "enr_1", hasPrivateHorse: true, privateHorseName: "Shadow" }),
  ]);
  assert.deepEqual(view, {
    hasPrivateHorse: true,
    privateHorseName: "Shadow",
    assignedHorseName: null,
  });
});

test("multiple enrollment candidates -> fails closed with sorted safe ids", () => {
  try {
    resolveCurrentHorseView([candidate({ id: "enr_b" }), candidate({ id: "enr_a" })]);
    assert.fail("expected AmbiguousCurrentHorseEnrollmentError");
  } catch (err) {
    assert.ok(err instanceof AmbiguousCurrentHorseEnrollmentError);
    assert.deepEqual(err.enrollmentIds, ["enr_a", "enr_b"]);
    // No PII (horse names) in the message - only ids.
    assert.ok(!err.message.includes("Bella"));
  }
});

test("single INACTIVE enrollment -> fails closed (no Student fallback)", () => {
  try {
    resolveCurrentHorseView([candidate({ id: "enr_1", status: "INACTIVE" })]);
    assert.fail("expected InactiveCurrentHorseEnrollmentError");
  } catch (err) {
    assert.ok(err instanceof InactiveCurrentHorseEnrollmentError);
    assert.equal(err.enrollmentId, "enr_1");
    assert.equal(err.status, "INACTIVE");
  }
});

test("output shape is directly compatible with getHorseDisplayInfo input", () => {
  const view = resolveCurrentHorseView([
    candidate({ id: "enr_1", hasPrivateHorse: true, privateHorseName: "Nimbus" }),
  ]);
  // Piping the view straight into the shared badge logic must type-check and
  // produce the private-horse badge - proving the exact-shape contract.
  const display = getHorseDisplayInfo(view);
  assert.equal(display.badgeType, "private");
  assert.equal(display.horseName, "Nimbus");
});

test("deterministic: exact keys only, no extra fields leak through", () => {
  const view = resolveCurrentHorseView([candidate({ id: "enr_1", assignedHorseName: "X" })]);
  assert.deepEqual(Object.keys(view).sort(), [
    "assignedHorseName",
    "hasPrivateHorse",
    "privateHorseName",
  ]);
});
