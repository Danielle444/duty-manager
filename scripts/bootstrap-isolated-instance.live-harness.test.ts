/**
 * MC-BOOTSTRAP-S2B2C-A — executable DB-FREE tests for the live-integration harness
 * foundation (bootstrap-isolated-instance.live-harness.ts).
 *
 * Run with:
 *   npx tsx --test scripts/bootstrap-isolated-instance.live-harness.test.ts
 *
 * DB-FREE + NETWORK-FREE: no real database, no Prisma, no PrismaPg, no env access,
 * no network, no filesystem write, no subprocess, no clock. Every input is an
 * explicit synthetic value. These tests prove the gate's DISABLED/REJECTED/READY
 * separation, secret-free diagnostics, run-ID format/uniqueness, deterministic and
 * disjoint fixtures, exact-identity cleanup planning, and redaction — never any
 * live behavior.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluateIsolationGate,
  ACCEPTED_LIVE_OPT_IN,
  generateRunId,
  RUN_ID_PATTERN,
  buildFixtureConfig,
  fixtureGlobalIdentifiers,
  FIXTURE_MARKER,
  buildCleanupPlan,
  redactLiveFailure,
  type IsolationGateInput,
  type RecordedRunIdentities,
  type CleanupStep,
  type LiveOperation,
} from "./bootstrap-isolated-instance.live-harness";
import {
  parseBootstrapConfig,
  PRODUCTION_PROJECT_REF_DENY,
} from "./bootstrap-isolated-instance.plan";

// --- shared synthetic fixtures (no real refs; the production ref is imported) ---

const VALID_REF = "abcdefghij0123456789";
const VALID_CONN = `postgresql://postgres:pw@db.${VALID_REF}.supabase.co:5432/postgres`;
const OTHER_REF = "bbbbbbbbbbbbbbbbbbbb";
const PROD_CONN = `postgresql://postgres:pw@db.${PRODUCTION_PROJECT_REF_DENY}.supabase.co:5432/postgres`;
const UNPARSEABLE_CONN = "not-a-postgres-url";

/** A fixed 32-hex run ID for deterministic, DB-free assertions. */
const FIXED_RUN_ID = "0123456789abcdef0123456789abcdef";
const FIXED_RUN_ID_B = "fedcba9876543210fedcba9876543210";

function gate(partial: Partial<IsolationGateInput>): IsolationGateInput {
  return {
    liveOptIn: partial.liveOptIn,
    dedicatedConnectionString: partial.dedicatedConnectionString,
    expectedTargetRef: partial.expectedTargetRef,
  };
}

// ===========================================================================
// Import safety
// ===========================================================================

test("importing the harness runs nothing and sets no exit code", async () => {
  const before = process.exitCode;
  const mod1 = await import("./bootstrap-isolated-instance.live-harness");
  const mod2 = await import("./bootstrap-isolated-instance.live-harness");
  assert.equal(mod1, mod2); // cached; import has no re-runnable side effect
  assert.equal(typeof mod1.evaluateIsolationGate, "function");
  assert.equal(typeof mod1.generateRunId, "function");
  assert.equal(typeof mod1.buildFixtureConfig, "function");
  assert.equal(typeof mod1.buildCleanupPlan, "function");
  assert.equal(typeof mod1.redactLiveFailure, "function");
  assert.equal(process.exitCode, before);
});

test("harness source references no env/DATABASE_URL/Prisma/subprocess/dotenv (source boundary)", () => {
  const src = readFileSync(new URL("./bootstrap-isolated-instance.live-harness.ts", import.meta.url), "utf8");
  // strip block + line comments so the prose invariants do not trip the scan
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const forbidden of [
    "process.env",
    "DATABASE_URL",
    "PrismaClient",
    "PrismaPg",
    "@prisma",
    "generated/prisma",
    "adapter-pg",
    "dotenv",
    "child_process",
    "createLiveClient",
    "$transaction",
    "$disconnect",
  ]) {
    assert.equal(code.includes(forbidden), false, `harness code must not contain "${forbidden}"`);
  }
});

// ===========================================================================
// Isolation gate — DISABLED vs REJECTED vs READY
// ===========================================================================

test("absent opt-in => DISABLED (no connection or expected ref required)", () => {
  assert.deepEqual(evaluateIsolationGate(gate({})), { status: "DISABLED" });
  // still DISABLED even if other prerequisites happen to be present
  assert.deepEqual(
    evaluateIsolationGate(gate({ dedicatedConnectionString: VALID_CONN, expectedTargetRef: VALID_REF })),
    { status: "DISABLED" },
  );
});

test("opted-in exact '1' but missing connection => REJECTED missing-connection (not skipped)", () => {
  assert.deepEqual(
    evaluateIsolationGate(gate({ liveOptIn: ACCEPTED_LIVE_OPT_IN, expectedTargetRef: VALID_REF })),
    { status: "REJECTED", reason: "missing-connection" },
  );
  // blank/whitespace connection is treated as missing, never trimmed into validity
  assert.deepEqual(
    evaluateIsolationGate(gate({ liveOptIn: "1", dedicatedConnectionString: "   ", expectedTargetRef: VALID_REF })),
    { status: "REJECTED", reason: "missing-connection" },
  );
});

test("opted-in but missing expected ref => REJECTED missing-expected-ref (not skipped)", () => {
  assert.deepEqual(
    evaluateIsolationGate(gate({ liveOptIn: "1", dedicatedConnectionString: VALID_CONN })),
    { status: "REJECTED", reason: "missing-expected-ref" },
  );
  assert.deepEqual(
    evaluateIsolationGate(gate({ liveOptIn: "1", dedicatedConnectionString: VALID_CONN, expectedTargetRef: "  " })),
    { status: "REJECTED", reason: "missing-expected-ref" },
  );
});

test("present-but-wrong opt-in values => REJECTED invalid-opt-in (no truthy/trimmed alias accepted)", () => {
  for (const bad of ["", " ", "1 ", " 1", "01", "true", "yes", "on", "TRUE", "0", "2"]) {
    assert.deepEqual(
      evaluateIsolationGate(gate({ liveOptIn: bad, dedicatedConnectionString: VALID_CONN, expectedTargetRef: VALID_REF })),
      { status: "REJECTED", reason: "invalid-opt-in" },
      `opt-in "${bad}" must be rejected, never accepted or skipped`,
    );
  }
});

test("opted-in but unparseable target => REJECTED unparseable-target", () => {
  assert.deepEqual(
    evaluateIsolationGate(gate({ liveOptIn: "1", dedicatedConnectionString: UNPARSEABLE_CONN, expectedTargetRef: VALID_REF })),
    { status: "REJECTED", reason: "unparseable-target" },
  );
});

test("opted-in but expected/detected mismatch => REJECTED ref-mismatch", () => {
  assert.deepEqual(
    evaluateIsolationGate(gate({ liveOptIn: "1", dedicatedConnectionString: VALID_CONN, expectedTargetRef: OTHER_REF })),
    { status: "REJECTED", reason: "ref-mismatch" },
  );
});

test("production ref as expected => REJECTED production-ref", () => {
  assert.deepEqual(
    evaluateIsolationGate(
      gate({ liveOptIn: "1", dedicatedConnectionString: VALID_CONN, expectedTargetRef: PRODUCTION_PROJECT_REF_DENY }),
    ),
    { status: "REJECTED", reason: "production-ref" },
  );
});

test("production ref as detected => REJECTED production-ref", () => {
  assert.deepEqual(
    evaluateIsolationGate(gate({ liveOptIn: "1", dedicatedConnectionString: PROD_CONN, expectedTargetRef: VALID_REF })),
    { status: "REJECTED", reason: "production-ref" },
  );
});

test("opted-in but malformed expected ref => REJECTED invalid-metadata", () => {
  assert.deepEqual(
    evaluateIsolationGate(gate({ liveOptIn: "1", dedicatedConnectionString: VALID_CONN, expectedTargetRef: "SHORT" })),
    { status: "REJECTED", reason: "invalid-metadata" },
  );
});

test("valid non-production exact match => READY (and READY carries no secret field)", () => {
  const result = evaluateIsolationGate(
    gate({ liveOptIn: "1", dedicatedConnectionString: VALID_CONN, expectedTargetRef: VALID_REF }),
  );
  assert.deepEqual(result, { status: "READY" });
  // READY has exactly one key: no connectionString, no ref, no host smuggled in.
  assert.deepEqual(Object.keys(result), ["status"]);
});

test("no gate result exposes the connection string, refs, host, username, or port", () => {
  const inputs: IsolationGateInput[] = [
    gate({ liveOptIn: "1", dedicatedConnectionString: VALID_CONN, expectedTargetRef: VALID_REF }),
    gate({ liveOptIn: "1", dedicatedConnectionString: VALID_CONN, expectedTargetRef: OTHER_REF }),
    gate({ liveOptIn: "1", dedicatedConnectionString: PROD_CONN, expectedTargetRef: VALID_REF }),
    gate({ liveOptIn: "1", dedicatedConnectionString: UNPARSEABLE_CONN, expectedTargetRef: VALID_REF }),
    gate({ liveOptIn: "1", dedicatedConnectionString: VALID_CONN, expectedTargetRef: "SHORT" }),
  ];
  for (const input of inputs) {
    const serialized = JSON.stringify(evaluateIsolationGate(input));
    for (const secret of [VALID_CONN, PROD_CONN, VALID_REF, OTHER_REF, PRODUCTION_PROJECT_REF_DENY, "postgres", "5432", "db."]) {
      assert.equal(serialized.includes(secret), false, `gate result must not contain "${secret}"`);
    }
  }
});

test("the gate has no DATABASE_URL fallback: a missing connection cannot be rescued", () => {
  // Even though a real DATABASE_URL may exist in the ambient process, the gate only
  // sees its explicit input and therefore rejects when the dedicated value is absent.
  assert.deepEqual(
    evaluateIsolationGate(gate({ liveOptIn: "1", dedicatedConnectionString: undefined, expectedTargetRef: VALID_REF })),
    { status: "REJECTED", reason: "missing-connection" },
  );
});

// ===========================================================================
// Run IDs
// ===========================================================================

test("generateRunId matches the accepted 32-hex format", () => {
  for (let i = 0; i < 50; i++) {
    assert.match(generateRunId(), RUN_ID_PATTERN);
  }
});

test("a sample of generated run IDs is unique", () => {
  const sample = new Set<string>();
  const N = 1000;
  for (let i = 0; i < N; i++) sample.add(generateRunId());
  assert.equal(sample.size, N);
});

// ===========================================================================
// Fixtures
// ===========================================================================

test("same supplied run ID => deterministic identical fixture config", () => {
  assert.deepEqual(buildFixtureConfig(FIXED_RUN_ID), buildFixtureConfig(FIXED_RUN_ID));
});

test("different run IDs => disjoint globally-unique identifiers", () => {
  const a = new Set(fixtureGlobalIdentifiers(FIXED_RUN_ID));
  const b = fixtureGlobalIdentifiers(FIXED_RUN_ID_B);
  for (const id of b) assert.equal(a.has(id), false, `global id "${id}" must be disjoint across runs`);
  // and each run contributes ActivityYear.name + 2 catalog keys
  assert.equal(a.size, 3);
});

test("fixture carries only the committed config keys — no connection/ref/env value", () => {
  const config = buildFixtureConfig(FIXED_RUN_ID);
  assert.deepEqual(Object.keys(config).sort(), ["activityYear", "capabilities", "groups", "offering"]);
  const serialized = JSON.stringify(config);
  for (const forbidden of ["postgres", "supabase", "connectionString", "DATABASE_URL", "projectRef", VALID_REF, "://"]) {
    assert.equal(serialized.includes(forbidden), false, `fixture must not contain "${forbidden}"`);
  }
});

test("generated fixture is accepted by the committed config validator", () => {
  const parsed = parseBootstrapConfig(buildFixtureConfig(FIXED_RUN_ID));
  assert.equal(parsed.ok, true);
});

test("every globally-unique fixture identifier carries the test marker and run ID", () => {
  const config = buildFixtureConfig(FIXED_RUN_ID);
  assert.ok(config.activityYear.name.startsWith(`${FIXTURE_MARKER}_`));
  assert.ok(config.activityYear.name.includes(FIXED_RUN_ID));
  for (const cap of config.capabilities) {
    assert.ok(cap.key.startsWith(`${FIXTURE_MARKER}_`));
    assert.ok(cap.key.includes(FIXED_RUN_ID));
  }
  // offering/group/subgroup names are recognizable test fixtures too
  assert.ok(config.offering.name.includes(FIXTURE_MARKER));
  for (const g of config.groups) {
    assert.ok(g.name.includes(FIXTURE_MARKER));
    for (const s of g.subgroups ?? []) assert.ok(s.name.includes(FIXTURE_MARKER));
  }
});

test("buildFixtureConfig rejects a malformed run ID with a value-free error", () => {
  assert.throws(
    () => buildFixtureConfig("not-hex"),
    (err: unknown) =>
      err instanceof Error &&
      err.message.includes("runId") &&
      !err.message.includes("not-hex"),
  );
});

// ===========================================================================
// Cleanup planning
// ===========================================================================

const FULL_RECORDED: RecordedRunIdentities = {
  offeringCapabilities: [
    { courseOfferingId: "off_1", capabilityKey: "K1" },
    { courseOfferingId: "off_1", capabilityKey: "K2" },
  ],
  subgroupIds: ["sub_1", "sub_2"],
  topGroupIds: ["top_1", "top_2"],
  courseOfferingIds: ["off_1"],
  activityYearIds: ["yr_1"],
  createdCapabilityKeys: ["K1", "K2"],
};

const EMPTY_RECORDED: RecordedRunIdentities = {
  offeringCapabilities: [],
  subgroupIds: [],
  topGroupIds: [],
  courseOfferingIds: [],
  activityYearIds: [],
  createdCapabilityKeys: [],
};

test("cleanup plan emits steps in exact FK-safe dependency order", () => {
  const plan = buildCleanupPlan(FULL_RECORDED);
  assert.deepEqual(
    plan.map((s) => s.order),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    plan.map((s) => `${s.model}${"tier" in s ? `/${s.tier}` : ""}`),
    [
      "CourseOfferingCapability",
      "CourseGroup/subgroup",
      "CourseGroup/topLevel",
      "CourseOffering",
      "ActivityYear",
      "CapabilityCatalog",
    ],
  );
});

test("cleanup plan contains exactly the recorded identities", () => {
  const plan = buildCleanupPlan(FULL_RECORDED);
  const byOrder = new Map(plan.map((s) => [s.order, s]));
  const oc = byOrder.get(1);
  assert.ok(oc && oc.model === "CourseOfferingCapability");
  assert.deepEqual(oc.identities, FULL_RECORDED.offeringCapabilities);
  const yr = byOrder.get(5);
  assert.ok(yr && yr.model === "ActivityYear");
  assert.deepEqual(yr.ids, ["yr_1"]);
  const cat = byOrder.get(6);
  assert.ok(cat && cat.model === "CapabilityCatalog");
  assert.deepEqual(cat.keys, ["K1", "K2"]);
});

test("empty recorded identities => empty (no-op) plan", () => {
  assert.deepEqual(buildCleanupPlan(EMPTY_RECORDED), []);
});

test("duplicate recorded identities are normalized deterministically", () => {
  const recorded: RecordedRunIdentities = {
    offeringCapabilities: [
      { courseOfferingId: "off_1", capabilityKey: "K1" },
      { courseOfferingId: "off_1", capabilityKey: "K1" }, // dup
    ],
    subgroupIds: ["sub_1", "sub_1", "sub_2"],
    topGroupIds: ["top_1", "top_1"],
    courseOfferingIds: ["off_1", "off_1"],
    activityYearIds: ["yr_1"],
    createdCapabilityKeys: ["K1", "K1", "K2"],
  };
  const plan = buildCleanupPlan(recorded);
  assert.deepEqual(buildCleanupPlan(recorded), plan); // deterministic
  const byOrder = new Map(plan.map((s) => [s.order, s]));
  const oc = byOrder.get(1);
  assert.ok(oc && oc.model === "CourseOfferingCapability");
  assert.equal(oc.identities.length, 1);
  const sub = byOrder.get(2);
  assert.ok(sub && sub.model === "CourseGroup");
  assert.deepEqual(sub.ids, ["sub_1", "sub_2"]);
  const cat = byOrder.get(6);
  assert.ok(cat && cat.model === "CapabilityCatalog");
  assert.deepEqual(cat.keys, ["K1", "K2"]);
});

test("offering-capability keys never leak into the created-catalog cleanup set", () => {
  // A run may reference a reusable/pre-existing key via an offering-capability row
  // without having created a catalog row for it. With createdCapabilityKeys empty,
  // NO CapabilityCatalog cleanup step is produced.
  const recorded: RecordedRunIdentities = {
    ...EMPTY_RECORDED,
    offeringCapabilities: [{ courseOfferingId: "off_1", capabilityKey: "REUSABLE_KEY" }],
    createdCapabilityKeys: [],
  };
  const plan = buildCleanupPlan(recorded);
  assert.equal(plan.some((s) => s.model === "CapabilityCatalog"), false);
});

test("no cleanup step can represent a broad delete (every step carries explicit identities)", () => {
  const plan = buildCleanupPlan(FULL_RECORDED);
  for (const step of plan) {
    const count = countStepIdentities(step);
    assert.ok(count > 0, `step ${step.model} must carry at least one explicit identity`);
    // there is no wildcard/"all" field on any variant
    assert.equal("all" in step, false);
    assert.equal("where" in step, false);
  }
});

function countStepIdentities(step: CleanupStep): number {
  if (step.model === "CourseOfferingCapability") return step.identities.length;
  if (step.model === "CapabilityCatalog") return step.keys.length;
  return step.ids.length;
}

// ===========================================================================
// Redaction
// ===========================================================================

test("an Error is reduced to a fixed non-secret category (message/stack/cause never leak)", () => {
  const err = new Error("SECRET postgresql://postgres:pw@db.abcdefghij0123456789.supabase.co/x", {
    cause: "SECRET-CAUSE",
  });
  const diag = redactLiveFailure("read", err);
  assert.deepEqual(diag, { operation: "read", thrownKind: "error" });
  const serialized = JSON.stringify(diag);
  for (const secret of ["SECRET", "postgresql", "SECRET-CAUSE", "abcdefghij0123456789", "supabase"]) {
    assert.equal(serialized.includes(secret), false, `diagnostic must not contain "${secret}"`);
  }
});

test("a non-Error thrown value is classified without being returned or serialized", () => {
  const diagStr = redactLiveFailure("write", "postgresql://secret-in-a-string");
  assert.deepEqual(diagStr, { operation: "write", thrownKind: "non-error" });
  assert.equal(JSON.stringify(diagStr).includes("secret-in-a-string"), false);

  const diagObj = redactLiveFailure("connect", { connectionString: "postgresql://leak" });
  assert.deepEqual(diagObj, { operation: "connect", thrownKind: "non-error" });
  assert.equal(JSON.stringify(diagObj).includes("leak"), false);
});

test("a circular thrown value does not break classification", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const diag = redactLiveFailure("cleanup", circular);
  assert.deepEqual(diag, { operation: "cleanup", thrownKind: "non-error" });
});

test("the operation label is caller-supplied and is the only variable field", () => {
  const ops: readonly LiveOperation[] = ["construct", "connect", "read", "write", "transaction", "cleanup"];
  for (const op of ops) {
    assert.deepEqual(redactLiveFailure(op, new Error("x")), { operation: op, thrownKind: "error" });
  }
});
