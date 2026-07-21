/**
 * Stage 1 — executable invariant tests for the PURE effective-capability
 * resolver (resolveEffectiveCapabilitiesFromRows).
 *
 * Run with: npx tsx --test lib/course/capabilities/effective-capability-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env.
 *
 * SCOPE OF PROOF: fail-closed effective-status resolution — ENABLED, READ_ONLY,
 * absence⇒DISABLED (no drift), inactive/missing catalog⇒DISABLED, unknown key,
 * malformed status (⇒DISABLED + drift), prototype safety, and the full 3×3
 * dependency-clamp lattice for each RIDING dependent. Neither axis of the
 * dependency matrix ever supplies a raw saved "DISABLED": effective DISABLED is
 * produced only by legitimate row absence.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { CAPABILITY_KEYS, type CapabilityKey } from "./capability-keys";
import {
  resolveEffectiveCapabilitiesFromRows,
  type CapabilityCatalogRow,
  type CapabilityDiagnosticKind,
  type EffectiveCapabilityStatus,
  type OfferingCapabilityRow,
} from "./effective-capability-core";

/** A full ACTIVE catalog: one active row per canonical key. */
function fullActiveCatalog(): CapabilityCatalogRow[] {
  return CAPABILITY_KEYS.map((key) => ({ key, isActive: true }));
}

/** Convenience: does the drift list contain an entry of (kind, key)? */
function hasDrift(
  drift: readonly { kind: CapabilityDiagnosticKind; key: string }[],
  kind: CapabilityDiagnosticKind,
  key: string,
): boolean {
  return drift.some((d) => d.kind === kind && d.key === key);
}

// ---------------------------------------------------------------------------
// 1. ENABLED — saved ENABLED + active catalog + no deps ⇒ ENABLED
// ---------------------------------------------------------------------------
test("saved ENABLED with active catalog resolves ENABLED", () => {
  const rows: OfferingCapabilityRow[] = [{ capabilityKey: "CONTACTS", status: "ENABLED" }];
  const { effective, drift } = resolveEffectiveCapabilitiesFromRows(rows, fullActiveCatalog());
  assert.equal(effective.CONTACTS, "ENABLED");
  assert.equal(drift.length, 0);
});

// ---------------------------------------------------------------------------
// 2. READ_ONLY — saved READ_ONLY ⇒ READ_ONLY, distinct from the other two
// ---------------------------------------------------------------------------
test("saved READ_ONLY resolves READ_ONLY and is distinct", () => {
  const rows: OfferingCapabilityRow[] = [{ capabilityKey: "CONTACTS", status: "READ_ONLY" }];
  const { effective } = resolveEffectiveCapabilitiesFromRows(rows, fullActiveCatalog());
  assert.equal(effective.CONTACTS, "READ_ONLY");
  assert.notEqual(effective.CONTACTS, "ENABLED");
  assert.notEqual(effective.CONTACTS, "DISABLED");
});

// ---------------------------------------------------------------------------
// 3. Absence ⇒ DISABLED, with NO malformed/unknown-status drift
//    (includes ATTENDANCE — the defaultEnabled:true optional — as the COALESCE
//    regression guard)
// ---------------------------------------------------------------------------
test("absent offering row ⇒ DISABLED and records no malformed/unknown drift", () => {
  // Only CONTACTS has a row; every other canonical key is absent.
  const rows: OfferingCapabilityRow[] = [{ capabilityKey: "CONTACTS", status: "ENABLED" }];
  const { effective, drift } = resolveEffectiveCapabilitiesFromRows(rows, fullActiveCatalog());

  assert.equal(effective.ATTENDANCE, "DISABLED"); // defaultEnabled:true must NOT rescue it
  assert.equal(effective.DUTIES, "DISABLED");
  assert.equal(effective.TEACHING_PRACTICE, "DISABLED");

  // Absence is legitimate: no malformed-status and no unknown-key drift anywhere.
  assert.equal(drift.some((d) => d.kind === "malformedStatus"), false);
  assert.equal(drift.some((d) => d.kind === "unknownOfferingKey"), false);
  // And specifically none recorded for the absent keys.
  assert.equal(hasDrift(drift, "malformedStatus", "ATTENDANCE"), false);
});

// ---------------------------------------------------------------------------
// 4. Inactive catalog row (isActive:false) + saved ENABLED ⇒ DISABLED,
//    recorded as inactive — NOT malformed-status drift
// ---------------------------------------------------------------------------
test("inactive catalog row forces DISABLED regardless of a saved ENABLED row", () => {
  const catalog = fullActiveCatalog().map((c) =>
    c.key === "CONTACTS" ? { ...c, isActive: false } : c,
  );
  const rows: OfferingCapabilityRow[] = [{ capabilityKey: "CONTACTS", status: "ENABLED" }];
  const { effective, drift } = resolveEffectiveCapabilitiesFromRows(rows, catalog);

  assert.equal(effective.CONTACTS, "DISABLED");
  assert.equal(hasDrift(drift, "inactiveCatalog", "CONTACTS"), true);
  assert.equal(hasDrift(drift, "malformedStatus", "CONTACTS"), false);
});

// ---------------------------------------------------------------------------
// 5. Missing catalog row ⇒ DISABLED
// ---------------------------------------------------------------------------
test("missing catalog row ⇒ DISABLED", () => {
  const catalog = fullActiveCatalog().filter((c) => c.key !== "CONTACTS");
  const rows: OfferingCapabilityRow[] = [{ capabilityKey: "CONTACTS", status: "ENABLED" }];
  const { effective, drift } = resolveEffectiveCapabilitiesFromRows(rows, catalog);

  assert.equal(effective.CONTACTS, "DISABLED");
  assert.equal(hasDrift(drift, "missingCatalog", "CONTACTS"), true);
});

// ---------------------------------------------------------------------------
// 6. Unknown offering key (incl. prototype-pollution keys) ⇒ absent from
//    result, present in drift, grants nothing, valid keys unaffected, null-proto
// ---------------------------------------------------------------------------
test("unknown offering keys are quarantined to drift and never pollute the result", () => {
  const rows: OfferingCapabilityRow[] = [
    { capabilityKey: "CONTACTS", status: "ENABLED" },
    { capabilityKey: "NOT_A_KEY", status: "ENABLED" },
    { capabilityKey: "__proto__", status: "ENABLED" },
    { capabilityKey: "constructor", status: "ENABLED" },
  ];
  const { effective, drift } = resolveEffectiveCapabilitiesFromRows(rows, fullActiveCatalog());

  // Result is exactly the canonical key set — no unknown key present.
  assert.deepEqual(Object.keys(effective).sort(), [...CAPABILITY_KEYS].sort());
  assert.equal(hasDrift(drift, "unknownOfferingKey", "NOT_A_KEY"), true);
  assert.equal(hasDrift(drift, "unknownOfferingKey", "__proto__"), true);
  assert.equal(hasDrift(drift, "unknownOfferingKey", "constructor"), true);

  // No prototype pollution: the map has a null prototype and inherits nothing.
  assert.equal(Object.getPrototypeOf(effective), null);
  assert.equal(Object.prototype.hasOwnProperty.call(effective, "__proto__"), false);

  // The valid key sharing the fixture is unaffected.
  assert.equal(effective.CONTACTS, "ENABLED");
});

// ---------------------------------------------------------------------------
// 7. Malformed / out-of-domain saved status ("", "UNKNOWN_STATUS") ⇒ DISABLED
//    + malformed-status drift — a DIFFERENT drift outcome from case 3 (absence).
//    "DISABLED" is deliberately NOT used here (it is not a persistable value and
//    would collide with the effective-output vocabulary).
// ---------------------------------------------------------------------------
test("malformed saved status ⇒ DISABLED + malformed drift (distinct from absence)", () => {
  const rows: OfferingCapabilityRow[] = [
    { capabilityKey: "CONTACTS", status: "" },
    { capabilityKey: "MESSAGES", status: "UNKNOWN_STATUS" },
  ];
  const { effective, drift } = resolveEffectiveCapabilitiesFromRows(rows, fullActiveCatalog());

  assert.equal(effective.CONTACTS, "DISABLED");
  assert.equal(effective.MESSAGES, "DISABLED");
  assert.equal(hasDrift(drift, "malformedStatus", "CONTACTS"), true);
  assert.equal(hasDrift(drift, "malformedStatus", "MESSAGES"), true);

  // Contrast with absence: SCHEDULE has no row at all — same effective DISABLED,
  // but NO malformed-status drift for it.
  assert.equal(effective.SCHEDULE, "DISABLED");
  assert.equal(hasDrift(drift, "malformedStatus", "SCHEDULE"), false);
});

// ---------------------------------------------------------------------------
// 8. Dependency clamping — full 3×3 effective-status lattice per dependent.
//    Both axes are effective-status INPUTS; neither ever supplies raw saved
//    "DISABLED". Effective DISABLED on each axis is produced by legitimate row
//    absence (no malformed-status drift).
// ---------------------------------------------------------------------------
const DEPENDENTS: readonly CapabilityKey[] = [
  "PROGRESS_RIDING",
  "RIDING_HORSE_ASSIGNMENTS",
  "ADVANCED_INSTRUCTION",
];

/** The three effective states and how each is produced as a genuine input. */
type Axis = "ENABLED" | "READ_ONLY" | "ABSENT";
const AXES: readonly Axis[] = ["ENABLED", "READ_ONLY", "ABSENT"];

/** Effective status each axis value denotes (ABSENT ⇒ effective DISABLED). */
function axisEffective(axis: Axis): EffectiveCapabilityStatus {
  return axis === "ABSENT" ? "DISABLED" : axis;
}

/** min on DISABLED < READ_ONLY < ENABLED. */
function expectedMin(
  a: EffectiveCapabilityStatus,
  b: EffectiveCapabilityStatus,
): EffectiveCapabilityStatus {
  const rank: Record<EffectiveCapabilityStatus, number> = {
    DISABLED: 0,
    READ_ONLY: 1,
    ENABLED: 2,
  };
  return rank[a] <= rank[b] ? a : b;
}

for (const dependent of DEPENDENTS) {
  for (const parentAxis of AXES) {
    for (const childAxis of AXES) {
      test(`clamp: ${dependent} own=${childAxis} × RIDING=${parentAxis} ⇒ min`, () => {
        // Build the offering rows: a row for RIDING and the dependent ONLY when
        // the axis is a saved status. ABSENT means we emit NO row (legitimate
        // sparse-storage DISABLED) — never a saved "DISABLED".
        const rows: OfferingCapabilityRow[] = [];
        if (parentAxis !== "ABSENT") rows.push({ capabilityKey: "RIDING", status: parentAxis });
        if (childAxis !== "ABSENT") rows.push({ capabilityKey: dependent, status: childAxis });

        const { effective, drift } = resolveEffectiveCapabilitiesFromRows(
          rows,
          fullActiveCatalog(),
        );

        const expected = expectedMin(axisEffective(childAxis), axisEffective(parentAxis));
        assert.equal(effective[dependent], expected);

        // No cell records malformed-status drift (each axis is a valid saved
        // status or a legitimate absence).
        assert.equal(drift.some((d) => d.kind === "malformedStatus"), false);

        // When the dependent row is absent it stays DISABLED regardless of the
        // parent's effective status: min(DISABLED, anything) = DISABLED.
        if (childAxis === "ABSENT") {
          assert.equal(effective[dependent], "DISABLED");
        }
      });
    }
  }
}

// Independent keys are unaffected by RIDING's effective status, and the result
// is exhaustive over all ten canonical keys.
test("independent keys are unaffected by RIDING; result is exhaustive", () => {
  // RIDING absent ⇒ effective DISABLED; an independent ENABLED key stays ENABLED.
  const rows: OfferingCapabilityRow[] = [{ capabilityKey: "ATTENDANCE", status: "ENABLED" }];
  const { effective } = resolveEffectiveCapabilitiesFromRows(rows, fullActiveCatalog());

  assert.equal(effective.RIDING, "DISABLED");
  assert.equal(effective.ATTENDANCE, "ENABLED"); // independent of RIDING
  assert.deepEqual(Object.keys(effective).sort(), [...CAPABILITY_KEYS].sort());
});

// ---------------------------------------------------------------------------
// 9. Duplicate-row fail-closed merge (the DB unique index prevents these in
//    production, but the pure core must still resolve them deterministically,
//    order-independently, and never leave a capability ENABLED/READ_ONLY on
//    malformed input). Effective DISABLED here is produced by min-clamping, and
//    malformed statuses use genuinely out-of-domain values ("", "UNKNOWN_STATUS")
//    — never a raw saved "DISABLED", which is outside the persisted domain.
// ---------------------------------------------------------------------------

/** Count drift entries of a given kind for a given key. */
function countDrift(
  drift: readonly { kind: CapabilityDiagnosticKind; key: string }[],
  kind: CapabilityDiagnosticKind,
  key: string,
): number {
  return drift.filter((d) => d.kind === kind && d.key === key).length;
}

// 9.1 — ENABLED + READ_ONLY duplicates ⇒ READ_ONLY (more restrictive wins) +
//       duplicateOfferingRow drift.
test("duplicate ENABLED + READ_ONLY rows ⇒ READ_ONLY with duplicate drift", () => {
  const rows: OfferingCapabilityRow[] = [
    { capabilityKey: "CONTACTS", status: "ENABLED" },
    { capabilityKey: "CONTACTS", status: "READ_ONLY" },
  ];
  const { effective, drift } = resolveEffectiveCapabilitiesFromRows(rows, fullActiveCatalog());

  assert.equal(effective.CONTACTS, "READ_ONLY");
  assert.equal(countDrift(drift, "duplicateOfferingRow", "CONTACTS"), 1);
  // No malformed input in this case.
  assert.equal(countDrift(drift, "malformedStatus", "CONTACTS"), 0);
});

// 9.1b — order-independence of the valid/valid merge: READ_ONLY + ENABLED is
//        also READ_ONLY.
test("duplicate READ_ONLY + ENABLED rows ⇒ READ_ONLY (order-independent)", () => {
  const rows: OfferingCapabilityRow[] = [
    { capabilityKey: "CONTACTS", status: "READ_ONLY" },
    { capabilityKey: "CONTACTS", status: "ENABLED" },
  ];
  const { effective, drift } = resolveEffectiveCapabilitiesFromRows(rows, fullActiveCatalog());

  assert.equal(effective.CONTACTS, "READ_ONLY");
  assert.equal(countDrift(drift, "duplicateOfferingRow", "CONTACTS"), 1);
});

// 9.2 — valid + malformed duplicates ⇒ DISABLED in BOTH input orders, with both
//       malformedStatus and duplicateOfferingRow drift. Proves malformed input
//       can never leave the capability ENABLED/READ_ONLY.
for (const order of ["valid-first", "malformed-first"] as const) {
  test(`duplicate valid + malformed (${order}) ⇒ DISABLED + malformed + duplicate drift`, () => {
    const validRow: OfferingCapabilityRow = { capabilityKey: "CONTACTS", status: "ENABLED" };
    const malformedRow: OfferingCapabilityRow = { capabilityKey: "CONTACTS", status: "" };
    const rows: OfferingCapabilityRow[] =
      order === "valid-first" ? [validRow, malformedRow] : [malformedRow, validRow];

    const { effective, drift } = resolveEffectiveCapabilitiesFromRows(rows, fullActiveCatalog());

    assert.equal(effective.CONTACTS, "DISABLED");
    assert.notEqual(effective.CONTACTS, "ENABLED");
    assert.notEqual(effective.CONTACTS, "READ_ONLY");
    assert.equal(countDrift(drift, "malformedStatus", "CONTACTS"), 1);
    assert.equal(countDrift(drift, "duplicateOfferingRow", "CONTACTS"), 1);
  });
}

// 9.3 — multiple malformed duplicates ⇒ DISABLED; one malformedStatus per
//       malformed row; one duplicateOfferingRow per repeat after the first.
test("multiple malformed duplicate rows ⇒ DISABLED with per-row malformed drift", () => {
  const rows: OfferingCapabilityRow[] = [
    { capabilityKey: "CONTACTS", status: "" },
    { capabilityKey: "CONTACTS", status: "UNKNOWN_STATUS" },
    { capabilityKey: "CONTACTS", status: "" },
  ];
  const { effective, drift } = resolveEffectiveCapabilitiesFromRows(rows, fullActiveCatalog());

  assert.equal(effective.CONTACTS, "DISABLED");
  // One malformedStatus per malformed input row (3 rows -> 3 entries).
  assert.equal(countDrift(drift, "malformedStatus", "CONTACTS"), 3);
  // One duplicateOfferingRow per repeated row after the first (3 rows -> 2).
  assert.equal(countDrift(drift, "duplicateOfferingRow", "CONTACTS"), 2);
});
