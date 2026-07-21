/**
 * W0-CAP-3 — executable tests for PURE CourseOffering capability initialization
 * planning, saved-state validation, and dependency validation.
 *
 * Run with: npx tsx --test lib/course/capabilities/offering-init-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env.
 *
 * The central invariant proven here: ROW ABSENCE MEANS DISABLED, fail-closed,
 * and `defaultEnabled` is never consulted to infer saved state.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { CAPABILITY_KEYS, type CapabilityKey } from "./capability-keys";
import { CAPABILITY_CATALOG } from "./capability-catalog";
import {
  INITIAL_CAPABILITY_LABELS,
  LEGACY_OFFERING_CAPABILITY_PRESET,
  type CourseCapabilityStatus,
} from "./capability-labels";
import { type CatalogRowInput } from "./catalog-sync-core";
import {
  checkPresetAgainstCatalog,
  disabledCapabilityKeys,
  normalizeOfferingRows,
  planLegacyOfferingInit,
  validateCapabilityDependencies,
  validateDependencyGraph,
  validateLegacyPreset,
  validateOfferingCapabilityState,
  type OfferingCapabilityRowInput,
} from "./offering-init-core";

/** The exact ten rows the approved legacy preset describes (State B fixture). */
function presetRows(): OfferingCapabilityRowInput[] {
  return LEGACY_OFFERING_CAPABILITY_PRESET.map((e) => ({
    capabilityKey: e.key,
    status: e.status,
  }));
}

function activeCatalog(): CatalogRowInput[] {
  return CAPABILITY_KEYS.map((key) => ({
    key,
    label: INITIAL_CAPABILITY_LABELS[key],
    isActive: true,
  }));
}

function stateMap(
  entries: readonly (readonly [string, CourseCapabilityStatus])[],
): ReadonlyMap<string, CourseCapabilityStatus> {
  return new Map(entries);
}

// ===========================================================================
// State A–E initialization
// ===========================================================================

test("State A — zero rows plans exactly the ten preset inserts", () => {
  const plan = planLegacyOfferingInit([]);
  assert.equal(plan.state, "A");
  assert.equal(plan.blocked, false);
  assert.equal(plan.writes.length, 10);
  assert.deepEqual(
    plan.writes.map((w) => w.capabilityKey),
    [...CAPABILITY_KEYS],
  );
  for (const w of plan.writes) {
    assert.equal(w.kind, "insert");
    assert.equal(w.status, "ENABLED");
  }
});

test("State B — the exact expected set and statuses is a successful no-op", () => {
  const plan = planLegacyOfferingInit(presetRows());
  assert.equal(plan.state, "B");
  assert.equal(plan.blocked, false);
  assert.equal(plan.isNoOp, true);
  assert.equal(plan.writes.length, 0);
  assert.deepEqual([...plan.findings], []);
  assert.equal(plan.detected.existing.length, 10);
  assert.equal(plan.detected.missing.length, 0);
});

test("rerun after applying State A logically becomes State B", () => {
  const applied: OfferingCapabilityRowInput[] = planLegacyOfferingInit([]).writes.map(
    (w) => ({ capabilityKey: w.capabilityKey, status: w.status }),
  );
  const rerun = planLegacyOfferingInit(applied);
  assert.equal(rerun.state, "B");
  assert.equal(rerun.writes.length, 0);
  assert.equal(rerun.isNoOp, true);
});

test("State C — partial expected set blocks and plans zero writes", () => {
  const rows = presetRows().filter(
    (r) => r.capabilityKey !== "RIDING" && r.capabilityKey !== "DUTIES",
  );
  const plan = planLegacyOfferingInit(rows);

  assert.equal(plan.state, "BLOCKED");
  assert.equal(plan.writes.length, 0);
  assert.deepEqual([...plan.detected.missing].sort(), ["DUTIES", "RIDING"]);
  assert.equal(plan.detected.existing.length, 8);
  const missingCodes = plan.blockers
    .filter((b) => b.code === "MISSING_PRESET_ROW")
    .map((b) => b.key)
    .sort();
  assert.deepEqual(missingCodes, ["DUTIES", "RIDING"]);
});

test("State D — status mismatch reports the exact difference and plans zero writes", () => {
  const rows = presetRows().map((r) =>
    r.capabilityKey === "ATTENDANCE" ? { ...r, status: "READ_ONLY" } : r,
  );
  const plan = planLegacyOfferingInit(rows);

  assert.equal(plan.state, "BLOCKED");
  assert.equal(plan.writes.length, 0);
  assert.deepEqual([...plan.detected.mismatched], [
    { key: "ATTENDANCE", expected: "ENABLED", actual: "READ_ONLY" },
  ]);
  const b = plan.blockers.find((x) => x.code === "STATUS_MISMATCH");
  assert.equal(b?.key, "ATTENDANCE");
  assert.ok(b?.detail.includes("never overwrites"));
});

test("State E — unexpected rows are reported, never deleted, and block writes", () => {
  const rows = [
    ...presetRows(),
    { capabilityKey: "LEGACY_EXAMS", status: "ENABLED" },
  ];
  const plan = planLegacyOfferingInit(rows);

  assert.equal(plan.state, "BLOCKED");
  assert.equal(plan.writes.length, 0);
  assert.deepEqual([...plan.detected.unexpected], [
    { key: "LEGACY_EXAMS", status: "ENABLED" },
  ]);
  const b = plan.blockers.find((x) => x.code === "UNEXPECTED_ROW");
  assert.ok(b?.detail.includes("NEVER deleted"));
  // The plan type has no delete member at all.
  for (const w of plan.writes) assert.equal(w.kind, "insert");
});

test("combined C + D + E reports every difference in one pass with zero writes", () => {
  const rows: OfferingCapabilityRowInput[] = [
    ...presetRows()
      .filter((r) => r.capabilityKey !== "TEACHING_PRACTICE")
      .map((r) =>
        r.capabilityKey === "PROGRESS_RIDING" ? { ...r, status: "READ_ONLY" } : r,
      ),
    { capabilityKey: "LEGACY_EXAMS", status: "READ_ONLY" },
  ];
  const plan = planLegacyOfferingInit(rows);

  assert.equal(plan.state, "BLOCKED");
  assert.equal(plan.writes.length, 0);
  assert.deepEqual([...plan.detected.missing], ["TEACHING_PRACTICE"]);
  assert.deepEqual([...plan.detected.mismatched], [
    { key: "PROGRESS_RIDING", expected: "ENABLED", actual: "READ_ONLY" },
  ]);
  assert.deepEqual([...plan.detected.unexpected], [
    { key: "LEGACY_EXAMS", status: "READ_ONLY" },
  ]);

  const codes = new Set(plan.blockers.map((b) => b.code));
  assert.ok(codes.has("MISSING_PRESET_ROW"));
  assert.ok(codes.has("STATUS_MISMATCH"));
  assert.ok(codes.has("UNEXPECTED_ROW"));
});

test("duplicate and malformed offering rows are fatal with zero writes", () => {
  const dup = planLegacyOfferingInit([...presetRows(), { capabilityKey: "RIDING", status: "ENABLED" }]);
  assert.equal(dup.state, "BLOCKED");
  assert.equal(dup.writes.length, 0);
  assert.ok(dup.blockers.some((b) => b.code === "DUPLICATE_OFFERING_ROW"));

  for (const bad of [
    { capabilityKey: "", status: "ENABLED" },
    { capabilityKey: " RIDING ", status: "ENABLED" },
    { capabilityKey: "RIDING", status: "DISABLED" },
    { capabilityKey: "RIDING", status: "" },
  ] satisfies OfferingCapabilityRowInput[]) {
    const plan = planLegacyOfferingInit([bad]);
    assert.equal(plan.state, "BLOCKED", `expected BLOCKED for ${JSON.stringify(bad)}`);
    assert.equal(plan.writes.length, 0);
    assert.ok(plan.blockers.some((b) => b.code === "MALFORMED_OFFERING_ROW"));
  }
});

test("a saved DISABLED status is rejected — DISABLED is row absence only", () => {
  const plan = planLegacyOfferingInit([{ capabilityKey: "DUTIES", status: "DISABLED" }]);
  assert.equal(plan.state, "BLOCKED");
  assert.ok(plan.blockers.some((b) => b.code === "MALFORMED_OFFERING_ROW"));
});

// ===========================================================================
// Absence = DISABLED, never defaultEnabled
// ===========================================================================

test("missing rows are DISABLED and never receive a defaultEnabled fallback", () => {
  const rows: OfferingCapabilityRowInput[] = [
    { capabilityKey: "SCHEDULE", status: "ENABLED" },
  ];
  const { statusByKey } = normalizeOfferingRows(rows);

  // ATTENDANCE is defaultEnabled=true in the code catalog...
  assert.equal(CAPABILITY_CATALOG.ATTENDANCE.defaultEnabled, true);
  // ...yet with no row it is simply absent: DISABLED.
  assert.equal(statusByKey.get("ATTENDANCE"), undefined);
  assert.equal(statusByKey.size, 1);

  const disabled = disabledCapabilityKeys(statusByKey);
  assert.ok(disabled.includes("ATTENDANCE"));
  assert.ok(!disabled.includes("SCHEDULE"));
  assert.equal(disabled.length, CAPABILITY_KEYS.length - 1);
});

test("an offering with no rows at all has every capability DISABLED", () => {
  const { statusByKey } = normalizeOfferingRows([]);
  assert.equal(statusByKey.size, 0);
  assert.deepEqual([...disabledCapabilityKeys(statusByKey)], [...CAPABILITY_KEYS]);
  // Fail-closed: no dependency requirement is manufactured either.
  assert.deepEqual([...validateCapabilityDependencies(statusByKey)], []);
});

// ===========================================================================
// Dependencies
// ===========================================================================

test("the committed dependency graph is valid and acyclic", () => {
  assert.deepEqual([...validateDependencyGraph()], []);
});

test("the committed graph is exactly the three RIDING edges", () => {
  const edges = CAPABILITY_KEYS.flatMap((k) =>
    CAPABILITY_CATALOG[k].dependsOn.map((p) => `${k}->${p}`),
  ).sort();
  assert.deepEqual(edges, [
    "ADVANCED_INSTRUCTION->RIDING",
    "PROGRESS_RIDING->RIDING",
    "RIDING_HORSE_ASSIGNMENTS->RIDING",
  ]);
});

test("the approved legacy preset satisfies every dependency", () => {
  assert.deepEqual([...validateLegacyPreset()], []);
  const plan = planLegacyOfferingInit([]);
  const resulting = stateMap(plan.writes.map((w) => [w.capabilityKey, w.status] as const));
  assert.deepEqual([...validateCapabilityDependencies(resulting)], []);
});

test("ENABLED dependent with an absent parent is FATAL", () => {
  const findings = validateCapabilityDependencies(
    stateMap([["PROGRESS_RIDING", "ENABLED"]]),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "DEPENDENCY_PARENT_DISABLED");
  assert.equal(findings[0].severity, "FATAL");
});

test("ENABLED dependent with a READ_ONLY parent is FATAL", () => {
  const findings = validateCapabilityDependencies(
    stateMap([
      ["RIDING", "READ_ONLY"],
      ["ADVANCED_INSTRUCTION", "ENABLED"],
    ]),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "DEPENDENCY_PARENT_READ_ONLY");
  assert.equal(findings[0].severity, "FATAL");
});

test("READ_ONLY dependent with an ENABLED parent is valid", () => {
  assert.deepEqual(
    [
      ...validateCapabilityDependencies(
        stateMap([
          ["RIDING", "ENABLED"],
          ["PROGRESS_RIDING", "READ_ONLY"],
        ]),
      ),
    ],
    [],
  );
});

test("READ_ONLY dependent with a READ_ONLY parent is valid (history preserved)", () => {
  assert.deepEqual(
    [
      ...validateCapabilityDependencies(
        stateMap([
          ["RIDING", "READ_ONLY"],
          ["PROGRESS_RIDING", "READ_ONLY"],
        ]),
      ),
    ],
    [],
  );
});

test("READ_ONLY dependent with an absent parent is a decision, not a failure", () => {
  const findings = validateCapabilityDependencies(
    stateMap([["RIDING_HORSE_ASSIGNMENTS", "READ_ONLY"]]),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "DEPENDENCY_PARENT_DISABLED_FOR_READ_ONLY");
  assert.equal(findings[0].severity, "DECISION_REQUIRED");
  assert.notEqual(findings[0].severity, "FATAL");
});

test("an absent dependent with an absent parent is valid", () => {
  assert.deepEqual(
    [...validateCapabilityDependencies(stateMap([["SCHEDULE", "ENABLED"]]))],
    [],
  );
});

test("every dependency violation is reported, not just the first", () => {
  const findings = validateCapabilityDependencies(
    stateMap([
      ["PROGRESS_RIDING", "ENABLED"],
      ["ADVANCED_INSTRUCTION", "ENABLED"],
      ["RIDING_HORSE_ASSIGNMENTS", "READ_ONLY"],
    ]),
  );
  assert.equal(findings.length, 3);
  assert.deepEqual(
    findings.map((f) => f.key),
    ["ADVANCED_INSTRUCTION", "PROGRESS_RIDING", "RIDING_HORSE_ASSIGNMENTS"],
  );
});

// ===========================================================================
// Saved-state validation against the catalog
// ===========================================================================

test("the exact initialized state validates cleanly", () => {
  const result = validateOfferingCapabilityState(presetRows(), activeCatalog());
  assert.equal(result.ok, true);
  assert.deepEqual([...result.findings], []);
  assert.equal(result.effective.length, 10);
});

test("an offering row referencing an INACTIVE catalog capability is FATAL", () => {
  const catalog = activeCatalog().map((r) =>
    r.key === "DUTIES" ? { ...r, isActive: false } : r,
  );
  const result = validateOfferingCapabilityState(presetRows(), catalog);
  assert.equal(result.ok, false);
  const b = result.blockers.find((x) => x.key === "DUTIES");
  assert.equal(b?.code, "CATALOG_KEY_INACTIVE");
  assert.equal(b?.severity, "FATAL");
});

test("an offering row referencing a MISSING catalog key is FATAL", () => {
  const catalog = activeCatalog().filter((r) => r.key !== "MESSAGES");
  const result = validateOfferingCapabilityState(presetRows(), catalog);
  assert.equal(result.ok, false);
  assert.ok(
    result.blockers.some((b) => b.code === "CATALOG_KEY_MISSING" && b.key === "MESSAGES"),
  );
});

test("a catalog label difference is non-fatal for offering validation", () => {
  const catalog = activeCatalog().map((r) =>
    r.key === "RIDING" ? { ...r, label: "רכיבות (שם ערוך)" } : r,
  );
  assert.equal(validateOfferingCapabilityState(presetRows(), catalog).ok, true);
});

test("partial saved state fails initialization but can still validate structurally", () => {
  const partial = presetRows().filter((r) => r.capabilityKey !== "TEACHING_PRACTICE");
  // TEACHING_PRACTICE has no dependents, so the remaining state is consistent...
  assert.equal(validateOfferingCapabilityState(partial, activeCatalog()).ok, true);
  // ...yet it is NOT the approved legacy preset, so initialization is blocked.
  assert.equal(planLegacyOfferingInit(partial).state, "BLOCKED");
});

test("partial saved state that breaks a dependency fails validation", () => {
  const broken = presetRows().filter((r) => r.capabilityKey !== "RIDING");
  const result = validateOfferingCapabilityState(broken, activeCatalog());
  assert.equal(result.ok, false);
  assert.equal(
    result.blockers.filter((b) => b.code === "DEPENDENCY_PARENT_DISABLED").length,
    3,
  );
});

// ===========================================================================
// Preset vs catalog gate (run before any offering write)
// ===========================================================================

test("preset/catalog gate passes against a fully active catalog", () => {
  assert.deepEqual([...checkPresetAgainstCatalog(activeCatalog())], []);
});

test("preset/catalog gate refuses a missing or retired catalog row", () => {
  const missing = checkPresetAgainstCatalog(
    activeCatalog().filter((r) => r.key !== "RIDING"),
  );
  assert.equal(missing.length, 1);
  assert.equal(missing[0].code, "CATALOG_KEY_MISSING");

  const retired = checkPresetAgainstCatalog(
    activeCatalog().map((r) => (r.key === "RIDING" ? { ...r, isActive: false } : r)),
  );
  assert.equal(retired.length, 1);
  assert.equal(retired[0].code, "CATALOG_KEY_INACTIVE");
});

test("preset/catalog gate refuses an empty catalog for every preset key", () => {
  const findings = checkPresetAgainstCatalog([]);
  assert.equal(findings.length, 10);
  assert.ok(findings.every((f) => f.code === "CATALOG_KEY_MISSING"));
});

// ===========================================================================
// Determinism
// ===========================================================================

test("shuffled offering rows produce identical output", () => {
  const rows: OfferingCapabilityRowInput[] = [
    ...presetRows().filter((r) => r.capabilityKey !== "DUTIES"),
    { capabilityKey: "LEGACY_EXAMS", status: "ENABLED" },
  ];
  const a = planLegacyOfferingInit(rows);
  const b = planLegacyOfferingInit([...rows].reverse());
  assert.deepEqual(a.findings, b.findings);
  assert.deepEqual(a.state, b.state);
  assert.deepEqual(a.writes, b.writes);
  const keys: string[] = a.findings.map((f) => f.key);
  assert.deepEqual(keys, [...keys].sort());
});

test("canonical keys type-check as offering keys (no key drift)", () => {
  const keys: readonly CapabilityKey[] = LEGACY_OFFERING_CAPABILITY_PRESET.map(
    (e) => e.key,
  );
  assert.equal(keys.length, CAPABILITY_KEYS.length);
});
