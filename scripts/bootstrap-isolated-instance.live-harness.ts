/**
 * MC-BOOTSTRAP-S2B2C-A — DB-FREE foundation for the FUTURE isolated-database live
 * integration tests (S2B2C-C read-only, S2B2C-D write). This stage builds ONLY
 * the pure, fail-closed primitives those later stages will consume; it performs
 * no database work of any kind.
 *
 * DB-FREE + IMPORT-SAFE BY CONSTRUCTION. This module has: no Prisma runtime
 * import, no Prisma TYPE import, no generated-client import, no PrismaClient /
 * PrismaPg construction, no createLiveClient call, no database delegate / query /
 * transaction, no subprocess, no filesystem write, no dotenv, no process.env
 * access, no DATABASE_URL reference, no network, and no top-level side effect.
 * Importing it runs nothing; a run ID is generated ONLY when generateRunId() is
 * explicitly called.
 *
 * SCOPE (S2B2C-A only): (1) isolation-gate evaluation over EXPLICIT caller inputs
 * — never process.env — reusing the committed parseSupabaseProjectRef (S2B1) and
 * decideTargetSafety (S1) without re-deriving their production-ref constant or
 * decision logic; (2) run-ID generation; (3) deterministic, run-namespaced
 * fixture-config generation matching the committed BootstrapConfigInput contract;
 * (4) fixed, secret-free diagnostic categorization; (5) a DESCRIPTIVE-ONLY
 * exact-identity cleanup PLAN builder that imports no database code and never
 * deletes anything.
 *
 * INVARIANTS THAT ARE EASY TO MISUSE:
 *  - DISABLED (no explicit opt-in) is a DIFFERENT result from REJECTED (opt-in is
 *    present but a prerequisite is missing/invalid). A misspelled or omitted
 *    prerequisite under an explicit opt-in must REJECT, never silently skip, so an
 *    explicitly requested live run can never falsely succeed.
 *  - There is NO fallback to DATABASE_URL anywhere. The dedicated connection value
 *    is supplied explicitly by the caller; it is never read from the environment
 *    here, never printed, and never returned in any result or diagnostic.
 *  - The cleanup plan is a pure DESCRIPTION. Executing it, applying migrations, and
 *    the first live connection all live OUTSIDE S2B2C-A and are each separately
 *    authorized (applying migrations is itself a real connection + a write).
 */
import { randomUUID } from "node:crypto";
import { decideTargetSafety, type BootstrapConfigInput } from "./bootstrap-isolated-instance.plan";
import { parseSupabaseProjectRef } from "./bootstrap-isolated-instance.adapter";

// ===========================================================================
// A — Isolation gate (over EXPLICIT inputs; never process.env, never DATABASE_URL).
// ===========================================================================

/**
 * The narrowest explicit input the gate needs. It deliberately does NOT accept the
 * whole environment object, and there is deliberately no ambient/DATABASE_URL
 * fallback field: the dedicated connection string is a first-class, caller-owned
 * value that the live entry layer (NOT this pure core) will read from the
 * dedicated environment variable and pass in.
 */
export interface IsolationGateInput {
  /** The value of the dedicated live opt-in variable, or undefined when absent. */
  readonly liveOptIn: string | undefined;
  /** The dedicated (NON-DATABASE_URL) isolated connection string, or undefined. */
  readonly dedicatedConnectionString: string | undefined;
  /** The separately-supplied expected isolated project ref, or undefined. */
  readonly expectedTargetRef: string | undefined;
}

/**
 * The ONLY accepted explicit live opt-in value. No truthy/aliased/whitespace-padded
 * variant ("true", "yes", "on", "01", " 1 ") is accepted, and an invalid value is
 * never trimmed into validity.
 */
export const ACCEPTED_LIVE_OPT_IN = "1";

/** Fixed, non-secret rejection reason codes (never interpolated, never value-bearing). */
export type IsolationRejectionReason =
  | "invalid-opt-in"
  | "missing-connection"
  | "missing-expected-ref"
  | "unparseable-target"
  | "invalid-metadata"
  | "ref-mismatch"
  | "production-ref";

/**
 * A discriminated result that makes it impossible to mistake REJECTED for DISABLED.
 * READY carries NO secret-bearing field (no connection string, no ref): the gate
 * proves readiness only, and the live entry layer reuses the connection value it
 * already owns after confirming status === "READY".
 */
export type IsolationGateResult =
  | { readonly status: "DISABLED" }
  | { readonly status: "REJECTED"; readonly reason: IsolationRejectionReason }
  | { readonly status: "READY" };

/**
 * Evaluate the isolation gate from explicit inputs. Only a completely ABSENT
 * opt-in disables; any present-but-wrong opt-in, and any missing/unparseable/
 * mismatched/production target once opted in, REJECTS with a fixed reason. No
 * result ever contains the connection string, a ref, a host, a username, a port,
 * or any other supplied value.
 */
export function evaluateIsolationGate(input: IsolationGateInput): IsolationGateResult {
  // Absent opt-in => ordinary skip. Present-but-not-exactly-"1" => explicit reject,
  // so a misspelled/aliased opt-in can never masquerade as a safe skip.
  if (input.liveOptIn === undefined) {
    return { status: "DISABLED" };
  }
  if (input.liveOptIn !== ACCEPTED_LIVE_OPT_IN) {
    return { status: "REJECTED", reason: "invalid-opt-in" };
  }

  // Opted in: every remaining prerequisite must be present and valid, or REJECT.
  const conn = input.dedicatedConnectionString;
  if (conn === undefined || conn.trim().length === 0) {
    return { status: "REJECTED", reason: "missing-connection" };
  }
  const expected = input.expectedTargetRef;
  if (expected === undefined || expected.trim().length === 0) {
    return { status: "REJECTED", reason: "missing-expected-ref" };
  }

  // Detect the ref via the committed strict parser (in memory only; never printed).
  const detected = parseSupabaseProjectRef(conn).detectedProjectRef;
  if (detected === null) {
    return { status: "REJECTED", reason: "unparseable-target" };
  }

  // Reuse the committed target-safety decision verbatim (production denial, format,
  // and exact expected===detected equality all live there, not here).
  const decision = decideTargetSafety({ expectedProjectRef: expected, detectedProjectRef: detected });
  if (decision.kind === "allowed") {
    return { status: "READY" };
  }
  if (decision.kind === "production_ref_rejected") {
    return { status: "REJECTED", reason: "production-ref" };
  }
  if (decision.kind === "ref_mismatch") {
    return { status: "REJECTED", reason: "ref-mismatch" };
  }
  // The only remaining kind is "invalid_metadata".
  return { status: "REJECTED", reason: "invalid-metadata" };
}

// ===========================================================================
// B — Run-ID generation (cryptographically strong; never timestamp/Math.random).
// ===========================================================================

/** A run ID: exactly 32 lowercase hex characters (a UUID with dashes removed). */
export const RUN_ID_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Generate a fresh run ID from Node's cryptographically-strong randomUUID (dashes
 * removed -> 32 hex chars). Not timestamp-based, no Math.random, no external
 * dependency. Called ONLY here; importing the module never generates one.
 */
export function generateRunId(): string {
  return randomUUID().replace(/-/g, "");
}

/** Fail closed on a run ID that is not the accepted format (value never echoed). */
function assertRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error("live-harness: runId must be exactly 32 lowercase hex characters");
  }
}

// ===========================================================================
// C — Deterministic, run-namespaced fixture-config generation.
// ===========================================================================

/** The stable, unmistakably test-only marker every fixture identifier carries. */
export const FIXTURE_MARKER = "ZZ_S2B2C";

/**
 * Build the in-memory bootstrap fixture config for one run. DETERMINISTIC: the same
 * runId yields a deeply-equal object; different runIds produce disjoint globally-
 * unique identifiers (ActivityYear.name and every CapabilityCatalog key embed the
 * runId). Every identifier is unmistakably test-only, no real course/person/
 * capability data appears, and there is no target ref, connection string, or
 * environment-specific value anywhere in the object. Schema-valid dates, level,
 * statuses, group hierarchy, and capability definitions (so a later stage can
 * actually apply it). No file is written here.
 */
export function buildFixtureConfig(runId: string): BootstrapConfigInput {
  assertRunId(runId);
  const tag = (part: string): string => `${FIXTURE_MARKER}_${part}_${runId}`;
  return {
    activityYear: {
      name: tag("YEAR"),
      startDate: "2000-08-01",
      endDate: "2001-07-31",
    },
    offering: {
      name: tag("OFFERING"),
      level: 1,
      startDate: "2000-09-01",
      endDate: "2001-06-30",
      status: "PLANNED",
    },
    groups: [
      { name: tag("GROUP_A"), subgroups: [{ name: tag("SUB_A1") }, { name: tag("SUB_A2") }] },
      { name: tag("GROUP_B"), subgroups: [{ name: tag("SUB_B1") }] },
    ],
    capabilities: [
      { key: tag("CAP1"), label: `${FIXTURE_MARKER} capability one`, isActive: true, offeringStatus: "ENABLED" },
      { key: tag("CAP2"), label: `${FIXTURE_MARKER} capability two`, isActive: false, offeringStatus: "READ_ONLY" },
    ],
  };
}

/**
 * The globally-unique identifiers a run's fixtures introduce: ActivityYear.name
 * (a global unique) and every created CapabilityCatalog key (a global primary
 * key). Callers use this to assert cross-run disjointness. Derived purely from the
 * fixture config, so it stays in lockstep with it.
 */
export function fixtureGlobalIdentifiers(runId: string): readonly string[] {
  const config = buildFixtureConfig(runId);
  return [config.activityYear.name, ...config.capabilities.map((c) => c.key)];
}

// ===========================================================================
// D — Exact-identity cleanup PLAN (descriptive only; imports no database code).
// ===========================================================================

/** An exact CourseOfferingCapability identity — the (offering, key) composite. */
export interface OfferingCapabilityIdentity {
  readonly courseOfferingId: string;
  readonly capabilityKey: string;
}

/**
 * Exactly the identities ONE run recorded as created. Nothing is inferred from a
 * run ID, and there is deliberately NO field for reusable/pre-existing catalog
 * keys — only keys this run itself created can ever enter cleanup.
 */
export interface RecordedRunIdentities {
  readonly offeringCapabilities: readonly OfferingCapabilityIdentity[];
  readonly subgroupIds: readonly string[];
  readonly topGroupIds: readonly string[];
  readonly courseOfferingIds: readonly string[];
  readonly activityYearIds: readonly string[];
  /** ONLY keys this run CREATED (never reusable/pre-existing catalog rows). */
  readonly createdCapabilityKeys: readonly string[];
}

/**
 * One dependency-safe cleanup step. Every variant carries an EXPLICIT, non-empty
 * list of exact identities — there is deliberately no "all"/wildcard variant, so a
 * broad delete (deleteMany({}), model-wide, date-based, or bare-prefix) cannot be
 * represented by this type at all.
 */
export type CleanupStep =
  | { readonly order: 1; readonly model: "CourseOfferingCapability"; readonly identities: readonly OfferingCapabilityIdentity[] }
  | { readonly order: 2; readonly model: "CourseGroup"; readonly tier: "subgroup"; readonly ids: readonly string[] }
  | { readonly order: 3; readonly model: "CourseGroup"; readonly tier: "topLevel"; readonly ids: readonly string[] }
  | { readonly order: 4; readonly model: "CourseOffering"; readonly ids: readonly string[] }
  | { readonly order: 5; readonly model: "ActivityYear"; readonly ids: readonly string[] }
  | { readonly order: 6; readonly model: "CapabilityCatalog"; readonly keys: readonly string[] };

/** Dedupe strings, preserving first-seen order (deterministic). */
function dedupeStrings(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Dedupe composite offering-capability identities (NUL-joined key), first-seen order. */
function dedupeOfferingCaps(items: readonly OfferingCapabilityIdentity[]): OfferingCapabilityIdentity[] {
  const seen = new Set<string>();
  const out: OfferingCapabilityIdentity[] = [];
  for (const it of items) {
    const composite = JSON.stringify([it.courseOfferingId, it.capabilityKey]);
    if (!seen.has(composite)) {
      seen.add(composite);
      out.push(it);
    }
  }
  return out;
}

/**
 * Build a dependency-safe, exact-identity cleanup PLAN. DESCRIPTIVE ONLY: it never
 * deletes anything and imports no database code. Steps are emitted strictly in the
 * FK-safe order (children before parents), each ONLY when it has at least one exact
 * identity, so empty input yields an empty (no-op) plan. Duplicates are normalized
 * deterministically. Created CapabilityCatalog keys are the ONLY catalog rows that
 * can appear, and only in the final step, after the referencing offering-capability
 * rows are removed.
 */
export function buildCleanupPlan(recorded: RecordedRunIdentities): readonly CleanupStep[] {
  const steps: CleanupStep[] = [];

  const offeringCaps = dedupeOfferingCaps(recorded.offeringCapabilities);
  if (offeringCaps.length > 0) {
    steps.push({ order: 1, model: "CourseOfferingCapability", identities: offeringCaps });
  }
  const subgroupIds = dedupeStrings(recorded.subgroupIds);
  if (subgroupIds.length > 0) {
    steps.push({ order: 2, model: "CourseGroup", tier: "subgroup", ids: subgroupIds });
  }
  const topGroupIds = dedupeStrings(recorded.topGroupIds);
  if (topGroupIds.length > 0) {
    steps.push({ order: 3, model: "CourseGroup", tier: "topLevel", ids: topGroupIds });
  }
  const offeringIds = dedupeStrings(recorded.courseOfferingIds);
  if (offeringIds.length > 0) {
    steps.push({ order: 4, model: "CourseOffering", ids: offeringIds });
  }
  const yearIds = dedupeStrings(recorded.activityYearIds);
  if (yearIds.length > 0) {
    steps.push({ order: 5, model: "ActivityYear", ids: yearIds });
  }
  const createdKeys = dedupeStrings(recorded.createdCapabilityKeys);
  if (createdKeys.length > 0) {
    steps.push({ order: 6, model: "CapabilityCatalog", keys: createdKeys });
  }

  return steps;
}

// ===========================================================================
// E — Redacted diagnostic categorization (fixed categories; never any content).
// ===========================================================================

/** The fixed, non-secret live operations a diagnostic can be attributed to. */
export type LiveOperation = "construct" | "connect" | "read" | "write" | "transaction" | "cleanup";

/** Whether the thrown value was an Error — the ONLY thing ever read from it. */
export type ThrownKind = "error" | "non-error";

/** A fully redacted diagnostic: fixed operation + thrownKind, never any content. */
export interface RedactedDiagnostic {
  readonly operation: LiveOperation;
  readonly thrownKind: ThrownKind;
}

/**
 * Classify a thrown value WITHOUT exposing its contents. `caught: unknown` is a
 * true boundary parameter: it is never asserted/cast into an error type and never
 * serialized. The only thing read is `instanceof Error` (a narrowing guard), so a
 * circular or exotic thrown value can never break classification and no message,
 * stack, cause, host, connection string, or ref can leak into the result.
 */
export function redactLiveFailure(operation: LiveOperation, caught: unknown): RedactedDiagnostic {
  return { operation, thrownKind: caught instanceof Error ? "error" : "non-error" };
}
