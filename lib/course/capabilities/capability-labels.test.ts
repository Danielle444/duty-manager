/**
 * W0-CAP-3 — executable invariant tests for the explicit capability business
 * configuration (initial Hebrew labels + the legacy initialization preset).
 *
 * Run with: npx tsx --test lib/course/capabilities/capability-labels.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { CAPABILITY_KEYS, isCapabilityKey } from "./capability-keys";
import { CAPABILITY_CATALOG } from "./capability-catalog";
import {
  COURSE_CAPABILITY_STATUSES,
  INITIAL_CAPABILITY_LABELS,
  isCourseCapabilityStatus,
  LEGACY_OFFERING_CAPABILITY_PRESET,
  LEGACY_OFFERING_PRESET_STATUS_BY_KEY,
  initialLabelFor,
} from "./capability-labels";

// --- persisted status vocabulary -------------------------------------------

test("persisted statuses are exactly ENABLED and READ_ONLY (no DISABLED member)", () => {
  assert.deepEqual([...COURSE_CAPABILITY_STATUSES], ["ENABLED", "READ_ONLY"]);
  assert.ok(!(COURSE_CAPABILITY_STATUSES as readonly string[]).includes("DISABLED"));
  assert.ok(isCourseCapabilityStatus("ENABLED"));
  assert.ok(isCourseCapabilityStatus("READ_ONLY"));
  assert.ok(!isCourseCapabilityStatus("DISABLED"));
  assert.ok(!isCourseCapabilityStatus(""));
});

// --- labels ------------------------------------------------------------------

test("exactly one initial label for every canonical key, and no unknown key", () => {
  const labelKeys = Object.keys(INITIAL_CAPABILITY_LABELS);
  assert.equal(labelKeys.length, CAPABILITY_KEYS.length);
  for (const key of CAPABILITY_KEYS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(INITIAL_CAPABILITY_LABELS, key),
      `missing initial label for ${key}`,
    );
  }
  for (const key of labelKeys) {
    assert.ok(isCapabilityKey(key), `unknown label key: ${key}`);
  }
  assert.deepEqual([...labelKeys].sort(), [...CAPABILITY_KEYS].sort());
});

test("every initial label is a non-empty, trimmed string", () => {
  for (const key of CAPABILITY_KEYS) {
    const label = INITIAL_CAPABILITY_LABELS[key];
    assert.equal(typeof label, "string");
    assert.ok(label.length > 0, `empty label for ${key}`);
    assert.equal(label, label.trim(), `untrimmed label for ${key}`);
    assert.equal(initialLabelFor(key), label);
  }
});

test("initial labels are distinct (no two capabilities share a label)", () => {
  const labels = CAPABILITY_KEYS.map((k) => INITIAL_CAPABILITY_LABELS[k]);
  assert.equal(new Set(labels).size, labels.length);
});

test("the locked initial Hebrew labels are exactly as approved", () => {
  assert.equal(INITIAL_CAPABILITY_LABELS.SCHEDULE, "לו״ז שבועי");
  assert.equal(INITIAL_CAPABILITY_LABELS.CONTACTS, "אנשי קשר");
  assert.equal(INITIAL_CAPABILITY_LABELS.MESSAGES, "הודעות ומשימות");
  assert.equal(INITIAL_CAPABILITY_LABELS.ATTENDANCE, "נוכחות");
  assert.equal(INITIAL_CAPABILITY_LABELS.DUTIES, "תורנויות");
  assert.equal(INITIAL_CAPABILITY_LABELS.RIDING, "רכיבות");
  assert.equal(INITIAL_CAPABILITY_LABELS.PROGRESS_RIDING, "מעקב התקדמות חניכים");
  assert.equal(
    INITIAL_CAPABILITY_LABELS.RIDING_HORSE_ASSIGNMENTS,
    "שיבוץ סוסים לרכיבות",
  );
  assert.equal(INITIAL_CAPABILITY_LABELS.ADVANCED_INSTRUCTION, "הדרכת מתקדמים");
  assert.equal(INITIAL_CAPABILITY_LABELS.TEACHING_PRACTICE, "התנסויות מתחילים");
});

// --- the explicit legacy preset ---------------------------------------------

test("legacy preset contains all ten canonical keys exactly once", () => {
  assert.equal(LEGACY_OFFERING_CAPABILITY_PRESET.length, 10);
  assert.equal(CAPABILITY_KEYS.length, 10);

  const keys = LEGACY_OFFERING_CAPABILITY_PRESET.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate key in preset");
  assert.deepEqual([...keys].sort(), [...CAPABILITY_KEYS].sort());
  for (const key of keys) assert.ok(isCapabilityKey(key), `unknown preset key: ${key}`);
});

test("every legacy preset status is ENABLED — no READ_ONLY is invented", () => {
  for (const entry of LEGACY_OFFERING_CAPABILITY_PRESET) {
    assert.equal(entry.status, "ENABLED", `${entry.key} must be ENABLED`);
    assert.ok(isCourseCapabilityStatus(entry.status));
  }
  const statuses = new Set(LEGACY_OFFERING_CAPABILITY_PRESET.map((e) => e.status));
  assert.deepEqual([...statuses], ["ENABLED"]);
});

test("preset never encodes DISABLED — DISABLED is row absence only", () => {
  for (const entry of LEGACY_OFFERING_CAPABILITY_PRESET) {
    assert.notEqual(String(entry.status), "DISABLED");
  }
  // No canonical capability is absent from THIS preset.
  const presetKeys = new Set(LEGACY_OFFERING_CAPABILITY_PRESET.map((e) => e.key));
  for (const key of CAPABILITY_KEYS) assert.ok(presetKeys.has(key));
});

test("preset is NOT derived from defaultEnabled", () => {
  // Proof by contradiction: a defaultEnabled-derived preset would differ, so a
  // future refactor that starts reading defaultEnabled fails this test.
  const defaultEnabledKeys = CAPABILITY_KEYS.filter(
    (k) => CAPABILITY_CATALOG[k].defaultEnabled,
  );
  assert.ok(
    defaultEnabledKeys.length < CAPABILITY_KEYS.length,
    "fixture assumption: some capability is defaultEnabled=false",
  );
  // Specifically, these are default-OFF yet ENABLED in the legacy preset.
  for (const key of ["DUTIES", "RIDING", "TEACHING_PRACTICE"] as const) {
    assert.equal(CAPABILITY_CATALOG[key].defaultEnabled, false);
    assert.equal(LEGACY_OFFERING_PRESET_STATUS_BY_KEY[key], "ENABLED");
  }
});

test("preset order is deterministic canonical key order", () => {
  assert.deepEqual(
    LEGACY_OFFERING_CAPABILITY_PRESET.map((e) => e.key),
    [...CAPABILITY_KEYS],
  );
});

test("preset entries and the explicit status record agree", () => {
  for (const entry of LEGACY_OFFERING_CAPABILITY_PRESET) {
    assert.equal(LEGACY_OFFERING_PRESET_STATUS_BY_KEY[entry.key], entry.status);
  }
  assert.deepEqual(
    Object.keys(LEGACY_OFFERING_PRESET_STATUS_BY_KEY).sort(),
    [...CAPABILITY_KEYS].sort(),
  );
});

test("configuration objects are frozen against runtime mutation", () => {
  assert.ok(Object.isFrozen(LEGACY_OFFERING_CAPABILITY_PRESET));
  for (const entry of LEGACY_OFFERING_CAPABILITY_PRESET) {
    assert.ok(Object.isFrozen(entry));
  }
});
