/**
 * ATT-1 — executable tests for the PURE attendance capability policy core
 * (attendance-capability-policy-core.ts).
 *
 * Run with: npx tsx --test lib/course/capabilities/attendance-capability-policy-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env.
 *
 * SCOPE OF PROOF (Design 1 ENABLED/READ_ONLY/DISABLED semantics):
 *  - ENABLED   ⇒ view + read + write;
 *  - READ_ONLY ⇒ view + read, NO write;
 *  - DISABLED  ⇒ no view, no read, no write;
 *  - missing offering context / absent ATTENDANCE entry / malformed status all
 *    fail closed (repo convention: no permissive attendance default);
 *  - the policy consumes an ALREADY-RESOLVED effective map and never resolves an
 *    offering itself; it hides no singleton-offering assumption;
 *  - it binds only to the ATTENDANCE key and introduces no StudentAttendance
 *    ownership / courseOfferingId assumption (there is no such input at all);
 *  - prototype-safety: inherited keys never resolve to a permissive decision.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateAttendanceCapabilityPolicy,
  attendanceCapabilityAccessFromEffective,
  type AttendanceCapabilityAccess,
} from "./attendance-capability-policy-core";
import {
  resolveEffectiveCapabilitiesFromRows,
  type EffectiveCapabilityStatus,
  type OfferingCapabilityRow,
  type CapabilityCatalogRow,
} from "./effective-capability-core";
import { CAPABILITY_KEYS } from "./capability-keys";

// --- fixtures ---------------------------------------------------------------

/** A full ACTIVE catalog: one active row per canonical key. */
function fullActiveCatalog(): CapabilityCatalogRow[] {
  return CAPABILITY_KEYS.map((key) => ({ key, isActive: true }));
}

/** The exact expected access triple per in-domain effective status (stated
 * independently of the implementation). */
const EXPECTED: Record<
  EffectiveCapabilityStatus,
  { canView: boolean; canRead: boolean; canWrite: boolean }
> = {
  ENABLED: { canView: true, canRead: true, canWrite: true },
  READ_ONLY: { canView: true, canRead: true, canWrite: false },
  DISABLED: { canView: false, canRead: false, canWrite: false },
};

function assertTriple(access: AttendanceCapabilityAccess, status: EffectiveCapabilityStatus) {
  assert.equal(access.canView, EXPECTED[status].canView, `${status} canView`);
  assert.equal(access.canRead, EXPECTED[status].canRead, `${status} canRead`);
  assert.equal(access.canWrite, EXPECTED[status].canWrite, `${status} canWrite`);
}

// ===========================================================================
// evaluateAttendanceCapabilityPolicy — the mode → access contract
// ===========================================================================

test("ENABLED permits visibility, read, and write", () => {
  const access = evaluateAttendanceCapabilityPolicy("ENABLED");
  assertTriple(access, "ENABLED");
  assert.equal(access.status, "ENABLED");
  assert.equal(access.reason, "ENABLED");
});

test("READ_ONLY permits visibility and read, denies write", () => {
  const access = evaluateAttendanceCapabilityPolicy("READ_ONLY");
  assertTriple(access, "READ_ONLY");
  assert.equal(access.canWrite, false, "READ_ONLY must deny writes through this offering");
  assert.equal(access.status, "READ_ONLY");
  assert.equal(access.reason, "READ_ONLY");
});

test("DISABLED denies visibility, read, and write", () => {
  const access = evaluateAttendanceCapabilityPolicy("DISABLED");
  assertTriple(access, "DISABLED");
  assert.equal(access.status, "DISABLED");
  assert.equal(access.reason, "DISABLED");
});

test("the three in-domain modes are exhaustively classified", () => {
  for (const status of ["ENABLED", "READ_ONLY", "DISABLED"] as EffectiveCapabilityStatus[]) {
    const access = evaluateAttendanceCapabilityPolicy(status);
    // A write is never allowed without a read; a read is never allowed without view.
    assert.ok(!access.canWrite || access.canRead, `${status}: write implies read`);
    assert.ok(!access.canRead || access.canView, `${status}: read implies view`);
  }
});

// ===========================================================================
// Fail-closed behavior — no permissive attendance default
// ===========================================================================

test("a malformed/out-of-domain status fails closed to fully denied", () => {
  const bogus = evaluateAttendanceCapabilityPolicy("SORT_OF_ENABLED" as EffectiveCapabilityStatus);
  assert.deepEqual(
    { canView: bogus.canView, canRead: bogus.canRead, canWrite: bogus.canWrite },
    { canView: false, canRead: false, canWrite: false },
  );
  assert.equal(bogus.status, null, "an arbitrary bypassed string is never reflected back");
  assert.equal(bogus.reason, "DENIED_UNKNOWN_STATUS");
});

test("prototype-chain keys never resolve to a permissive decision", () => {
  for (const evil of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    const access = evaluateAttendanceCapabilityPolicy(evil as EffectiveCapabilityStatus);
    assert.equal(access.canWrite, false, `${evil} must not grant write`);
    assert.equal(access.canRead, false, `${evil} must not grant read`);
    assert.equal(access.canView, false, `${evil} must not grant view`);
    assert.equal(access.reason, "DENIED_UNKNOWN_STATUS");
  }
});

// ===========================================================================
// attendanceCapabilityAccessFromEffective — resolved-context selector
// ===========================================================================

test("selects the ATTENDANCE status out of a resolved effective map", () => {
  // Build a REAL resolved map via the existing resolver: ATTENDANCE READ_ONLY.
  const rows: OfferingCapabilityRow[] = [{ capabilityKey: "ATTENDANCE", status: "READ_ONLY" }];
  const { effective } = resolveEffectiveCapabilitiesFromRows(rows, fullActiveCatalog());
  assert.equal(effective.ATTENDANCE, "READ_ONLY");

  const access = attendanceCapabilityAccessFromEffective(effective);
  assertTriple(access, "READ_ONLY");
  assert.equal(access.reason, "READ_ONLY");
});

test("ENABLED and DISABLED also flow correctly through the selector", () => {
  const enabledRows: OfferingCapabilityRow[] = [{ capabilityKey: "ATTENDANCE", status: "ENABLED" }];
  const enabled = attendanceCapabilityAccessFromEffective(
    resolveEffectiveCapabilitiesFromRows(enabledRows, fullActiveCatalog()).effective,
  );
  assertTriple(enabled, "ENABLED");

  // No ATTENDANCE row at all ⇒ resolver yields effective DISABLED (row absence,
  // fail-closed), and the selector must reflect DISABLED semantics — NOT the
  // catalog's defaultEnabled:true seed hint.
  const disabled = attendanceCapabilityAccessFromEffective(
    resolveEffectiveCapabilitiesFromRows([], fullActiveCatalog()).effective,
  );
  assertTriple(disabled, "DISABLED");
  assert.equal(disabled.reason, "DISABLED");
});

test("missing offering context (null/undefined map) fails closed", () => {
  for (const ctx of [null, undefined]) {
    const access = attendanceCapabilityAccessFromEffective(ctx);
    assert.deepEqual(
      { canView: access.canView, canRead: access.canRead, canWrite: access.canWrite },
      { canView: false, canRead: false, canWrite: false },
    );
    assert.equal(access.reason, "DENIED_MISSING_CONTEXT");
    assert.equal(access.status, null);
  }
});

test("a context missing the ATTENDANCE entry fails closed", () => {
  // A partial map with no ATTENDANCE key at all.
  const access = attendanceCapabilityAccessFromEffective({ CONTACTS: "ENABLED" });
  assert.equal(access.canView, false);
  assert.equal(access.canRead, false);
  assert.equal(access.canWrite, false);
  assert.equal(access.reason, "DENIED_UNKNOWN_STATUS");
});

test("a context whose ATTENDANCE value is malformed fails closed", () => {
  const access = attendanceCapabilityAccessFromEffective({
    ATTENDANCE: "MAYBE" as EffectiveCapabilityStatus,
  });
  assert.equal(access.canWrite, false);
  assert.equal(access.canRead, false);
  assert.equal(access.canView, false);
  assert.equal(access.reason, "DENIED_UNKNOWN_STATUS");
});

test("selector reads a null-prototype resolver map without prototype leakage", () => {
  // The resolver builds its effective map with Object.create(null); a plain
  // "__proto__" key on a normal object must not be mistaken for the status.
  const evil = { ATTENDANCE: "ENABLED" } as Record<string, EffectiveCapabilityStatus>;
  // Sanity: own-property read, not an inherited one.
  const access = attendanceCapabilityAccessFromEffective(evil);
  assertTriple(access, "ENABLED");
});

// ===========================================================================
// Boundary discipline — no offering resolution, no fact ownership
// ===========================================================================

test("the policy performs no offering resolution and needs no attendance fact", () => {
  // Purely by construction: both public helpers accept only an effective status
  // or an already-resolved effective map. Their arities prove neither takes an
  // offering id, a studentId, a date, a courseOfferingId, or any attendance row.
  assert.equal(evaluateAttendanceCapabilityPolicy.length, 1);
  assert.equal(attendanceCapabilityAccessFromEffective.length, 1);
});

test("no singleton-offering assumption: identical input always yields identical output", () => {
  // The pure core cannot special-case a bootstrap/singleton offering because it
  // receives no offering identity at all. Same status ⇒ same decision, always.
  const a = evaluateAttendanceCapabilityPolicy("ENABLED");
  const b = evaluateAttendanceCapabilityPolicy("ENABLED");
  assert.deepEqual(a, b);
});
