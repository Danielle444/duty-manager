/**
 * MULTI-COURSE (dormant foundation) — W0-CAP-3: PURE CourseOffering capability
 * initialization planning, saved-state validation, and dependency validation.
 *
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env,
 * no network, no logging, no runtime side effects. Every function takes plain
 * snapshot arrays; nothing here constructs or imports a Prisma client.
 *
 * SPARSE STORAGE (CAP-1/CAP-2) — the single most important rule in this file:
 *   ABSENCE OF A ROW MEANS DISABLED. It is fail-closed and it NEVER falls back
 *   to `defaultEnabled`. `defaultEnabled` is not imported here, is not read
 *   here, and must never influence saved-state inference.
 *
 * STATIC PLANNING ONLY. This is not a runtime capability resolver and adds no
 * enforcement. It answers two operator questions before any write:
 *   1. "What exactly would initializing this offering insert?" and
 *   2. "Is the offering's saved state internally consistent and dependency-safe?"
 *
 * INITIALIZATION IS NOT A REPAIR TOOL. Only the pristine State A (zero rows)
 * plans writes. Any partial, mismatched or unexpected state is a BLOCKER that
 * plans ZERO writes: this code never overwrites a status, never fills a gap,
 * and never deletes an unexpected row. A human decides what happened.
 */
import {
  CAPABILITY_KEYS,
  isCapabilityKey,
  type CapabilityKey,
} from "./capability-keys";
import { CAPABILITY_CATALOG } from "./capability-catalog";
import {
  isCourseCapabilityStatus,
  LEGACY_OFFERING_CAPABILITY_PRESET,
  type CourseCapabilityStatus,
} from "./capability-labels";
import { type CatalogRowInput } from "./catalog-sync-core";

/** One `course_offering_capabilities` row for a single offering. */
export interface OfferingCapabilityRowInput {
  readonly capabilityKey: string;
  readonly status: string;
}

/**
 * INFO             — expected state; no action.
 * BLOCKER          — refuses this operation; a human must decide.
 * DECISION_REQUIRED— consistent-but-questionable; needs an explicit decision.
 * FATAL            — impossible/unsafe state; refuses everything.
 */
export type OfferingFindingSeverity =
  | "INFO"
  | "BLOCKER"
  | "DECISION_REQUIRED"
  | "FATAL";

export type OfferingFindingCode =
  /** A preset capability has no row for this offering (State C). */
  | "MISSING_PRESET_ROW"
  /** A preset capability's saved status differs from the preset (State D). */
  | "STATUS_MISMATCH"
  /** A row exists that the preset does not contain (State E). Never deleted. */
  | "UNEXPECTED_ROW"
  /** Two rows for the same capability (the unique index normally prevents it). */
  | "DUPLICATE_OFFERING_ROW"
  /** Blank capability key or a status outside ENABLED|READ_ONLY. */
  | "MALFORMED_OFFERING_ROW"
  /** An offering row references a key absent from CapabilityCatalog. */
  | "CATALOG_KEY_MISSING"
  /** An offering row references a RETIRED (isActive=false) catalog capability. */
  | "CATALOG_KEY_INACTIVE"
  /** ENABLED dependent whose parent has no row (= DISABLED). */
  | "DEPENDENCY_PARENT_DISABLED"
  /** ENABLED dependent whose parent is only READ_ONLY. */
  | "DEPENDENCY_PARENT_READ_ONLY"
  /** READ_ONLY dependent whose parent has no row — warn, do not fail. */
  | "DEPENDENCY_PARENT_DISABLED_FOR_READ_ONLY"
  /** The committed code graph references a non-canonical parent. */
  | "DEPENDENCY_GRAPH_UNKNOWN_PARENT"
  /** The committed code graph contains a cycle. */
  | "DEPENDENCY_GRAPH_CYCLE"
  /** The explicit legacy preset is itself malformed. */
  | "PRESET_INVALID";

export interface OfferingFinding {
  readonly code: OfferingFindingCode;
  readonly severity: OfferingFindingSeverity;
  readonly key: string;
  readonly detail: string;
}

const SEVERITY_OF: Readonly<Record<OfferingFindingCode, OfferingFindingSeverity>> = {
  MISSING_PRESET_ROW: "BLOCKER",
  STATUS_MISMATCH: "BLOCKER",
  UNEXPECTED_ROW: "BLOCKER",
  DUPLICATE_OFFERING_ROW: "FATAL",
  MALFORMED_OFFERING_ROW: "FATAL",
  CATALOG_KEY_MISSING: "FATAL",
  CATALOG_KEY_INACTIVE: "FATAL",
  DEPENDENCY_PARENT_DISABLED: "FATAL",
  DEPENDENCY_PARENT_READ_ONLY: "FATAL",
  DEPENDENCY_PARENT_DISABLED_FOR_READ_ONLY: "DECISION_REQUIRED",
  DEPENDENCY_GRAPH_UNKNOWN_PARENT: "FATAL",
  DEPENDENCY_GRAPH_CYCLE: "FATAL",
  PRESET_INVALID: "FATAL",
};

function finding(
  code: OfferingFindingCode,
  key: string,
  detail: string,
): OfferingFinding {
  return { code, severity: SEVERITY_OF[code], key, detail };
}

export function isBlockingOfferingFinding(f: OfferingFinding): boolean {
  return f.severity !== "INFO";
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortFindings(findings: readonly OfferingFinding[]): OfferingFinding[] {
  return [...findings].sort(
    (a, b) => compareStrings(a.key, b.key) || compareStrings(a.code, b.code),
  );
}

// ---------------------------------------------------------------------------
// Effective saved state (absence = DISABLED, never defaultEnabled)
// ---------------------------------------------------------------------------

export interface NormalizedOfferingRows {
  /** Well-formed, de-duplicated saved rows. Absence from this map = DISABLED. */
  readonly statusByKey: ReadonlyMap<string, CourseCapabilityStatus>;
  /** Structural problems (duplicates / malformed rows). */
  readonly findings: readonly OfferingFinding[];
}

/**
 * Normalize a raw snapshot into `key -> saved status`. A key absent from the
 * returned map is DISABLED — that is the whole meaning of absence, and no
 * default of any kind is substituted.
 */
export function normalizeOfferingRows(
  rows: readonly OfferingCapabilityRowInput[],
): NormalizedOfferingRows {
  const statusByKey = new Map<string, CourseCapabilityStatus>();
  const findings: OfferingFinding[] = [];
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  const malformed = new Set<string>();

  for (const row of rows) {
    const rawKey = typeof row?.capabilityKey === "string" ? row.capabilityKey : "";
    const rawStatus = typeof row?.status === "string" ? row.status : "";
    const keyOk = rawKey.length > 0 && rawKey.trim() === rawKey;

    if (!keyOk || !isCourseCapabilityStatus(rawStatus)) {
      const shown = rawKey.length > 0 ? rawKey : "<blank key>";
      if (!malformed.has(shown)) {
        malformed.add(shown);
        findings.push(
          finding(
            "MALFORMED_OFFERING_ROW",
            shown,
            `blank/untrimmed capability key or status outside ENABLED|READ_ONLY ` +
              `(got ${JSON.stringify(rawStatus)}); refusing to classify it`,
          ),
        );
      }
      continue;
    }

    if (seen.has(rawKey)) {
      if (!duplicated.has(rawKey)) {
        duplicated.add(rawKey);
        findings.push(
          finding(
            "DUPLICATE_OFFERING_ROW",
            rawKey,
            "more than one row for this capability on one offering (the unique " +
              "index normally makes this impossible)",
          ),
        );
      }
      continue;
    }

    seen.add(rawKey);
    statusByKey.set(rawKey, rawStatus);
  }

  return { statusByKey, findings };
}

// ---------------------------------------------------------------------------
// Dependency validation (code-owned graph; never persisted)
// ---------------------------------------------------------------------------

/**
 * Validate the COMMITTED code dependency graph itself: every parent must be a
 * canonical key and the graph must be acyclic. Independent of any offering.
 */
export function validateDependencyGraph(): readonly OfferingFinding[] {
  const findings: OfferingFinding[] = [];

  for (const key of CAPABILITY_KEYS) {
    for (const parent of CAPABILITY_CATALOG[key].dependsOn) {
      if (!isCapabilityKey(parent)) {
        findings.push(
          finding(
            "DEPENDENCY_GRAPH_UNKNOWN_PARENT",
            key,
            `declares a dependency on non-canonical key ${String(parent)}`,
          ),
        );
      }
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<CapabilityKey, number>();
  for (const key of CAPABILITY_KEYS) color.set(key, WHITE);

  const visit = (key: CapabilityKey, path: readonly CapabilityKey[]): void => {
    color.set(key, GRAY);
    for (const parent of CAPABILITY_CATALOG[key].dependsOn) {
      if (!isCapabilityKey(parent)) continue;
      const parentColor = color.get(parent);
      if (parentColor === GRAY) {
        findings.push(
          finding(
            "DEPENDENCY_GRAPH_CYCLE",
            key,
            `dependency cycle: ${[...path, key, parent].join(" -> ")}`,
          ),
        );
        continue;
      }
      if (parentColor === WHITE) visit(parent, [...path, key]);
    }
    color.set(key, BLACK);
  };

  for (const key of CAPABILITY_KEYS) {
    if (color.get(key) === WHITE) visit(key, []);
  }

  return Object.freeze(sortFindings(findings));
}

/**
 * Validate saved capability state against the code-owned dependency graph.
 *
 * Rules (locked):
 *   ENABLED   dependent + missing  parent -> FATAL
 *   ENABLED   dependent + READ_ONLY parent -> FATAL
 *   READ_ONLY dependent + ENABLED   parent -> valid
 *   READ_ONLY dependent + READ_ONLY parent -> valid (history-preserving pair)
 *   READ_ONLY dependent + missing  parent -> DECISION_REQUIRED (warning)
 *   absent    dependent (= DISABLED)       -> no requirement at all
 */
export function validateCapabilityDependencies(
  statusByKey: ReadonlyMap<string, CourseCapabilityStatus>,
): readonly OfferingFinding[] {
  const findings: OfferingFinding[] = [];

  for (const key of CAPABILITY_KEYS) {
    const status = statusByKey.get(key);
    // Absent dependent = DISABLED: nothing is required of its parents.
    if (status === undefined) continue;

    for (const parent of CAPABILITY_CATALOG[key].dependsOn) {
      const parentStatus = statusByKey.get(parent);

      if (status === "ENABLED") {
        if (parentStatus === undefined) {
          findings.push(
            finding(
              "DEPENDENCY_PARENT_DISABLED",
              key,
              `is ENABLED but its required parent ${parent} has no row (DISABLED)`,
            ),
          );
        } else if (parentStatus === "READ_ONLY") {
          findings.push(
            finding(
              "DEPENDENCY_PARENT_READ_ONLY",
              key,
              `is ENABLED but its required parent ${parent} is only READ_ONLY`,
            ),
          );
        }
        continue;
      }

      // status === "READ_ONLY"
      if (parentStatus === undefined) {
        findings.push(
          finding(
            "DEPENDENCY_PARENT_DISABLED_FOR_READ_ONLY",
            key,
            `is READ_ONLY (history preserved) while its parent ${parent} has no ` +
              `row (DISABLED) — allowed, but requires an explicit operator decision`,
          ),
        );
      }
    }
  }

  return Object.freeze(sortFindings(findings));
}

// ---------------------------------------------------------------------------
// Legacy preset integrity
// ---------------------------------------------------------------------------

/**
 * Validate the explicit legacy preset itself: exactly one entry per canonical
 * key, no unknown key, every status a persisted status, and dependency-safe.
 */
export function validateLegacyPreset(): readonly OfferingFinding[] {
  const findings: OfferingFinding[] = [];
  const seen = new Set<string>();

  for (const entry of LEGACY_OFFERING_CAPABILITY_PRESET) {
    if (!isCapabilityKey(entry.key)) {
      findings.push(
        finding("PRESET_INVALID", String(entry.key), "preset contains a non-canonical key"),
      );
      continue;
    }
    if (seen.has(entry.key)) {
      findings.push(finding("PRESET_INVALID", entry.key, "preset lists this key twice"));
      continue;
    }
    seen.add(entry.key);
    if (!isCourseCapabilityStatus(entry.status)) {
      findings.push(
        finding(
          "PRESET_INVALID",
          entry.key,
          `preset status ${JSON.stringify(entry.status)} is not a persisted status`,
        ),
      );
    }
  }

  for (const key of CAPABILITY_KEYS) {
    if (!seen.has(key)) {
      findings.push(finding("PRESET_INVALID", key, "canonical key missing from the preset"));
    }
  }

  const presetState = new Map<string, CourseCapabilityStatus>(
    LEGACY_OFFERING_CAPABILITY_PRESET.map((e) => [e.key, e.status]),
  );
  findings.push(...validateCapabilityDependencies(presetState));

  return Object.freeze(sortFindings(findings));
}

/**
 * Every preset key must exist in `CapabilityCatalog` and be ACTIVE before an
 * offering may be initialized. Run this BEFORE opening the write transaction.
 */
export function checkPresetAgainstCatalog(
  catalogRows: readonly CatalogRowInput[],
): readonly OfferingFinding[] {
  const findings: OfferingFinding[] = [];
  const byKey = new Map<string, CatalogRowInput>();
  for (const row of catalogRows) {
    if (typeof row?.key === "string" && row.key.length > 0 && !byKey.has(row.key)) {
      byKey.set(row.key, row);
    }
  }

  for (const entry of LEGACY_OFFERING_CAPABILITY_PRESET) {
    const row = byKey.get(entry.key);
    if (!row) {
      findings.push(
        finding(
          "CATALOG_KEY_MISSING",
          entry.key,
          "preset capability has no CapabilityCatalog row — run catalog-sync first",
        ),
      );
    } else if (row.isActive !== true) {
      findings.push(
        finding(
          "CATALOG_KEY_INACTIVE",
          entry.key,
          "preset capability's catalog row is RETIRED (isActive=false)",
        ),
      );
    }
  }

  return Object.freeze(sortFindings(findings));
}

// ---------------------------------------------------------------------------
// Initialization planning (States A–E)
// ---------------------------------------------------------------------------

export interface OfferingCapabilityInsert {
  readonly kind: "insert";
  readonly capabilityKey: CapabilityKey;
  readonly status: CourseCapabilityStatus;
}

export interface OfferingStatusMismatch {
  readonly key: CapabilityKey;
  readonly expected: CourseCapabilityStatus;
  readonly actual: CourseCapabilityStatus;
}

export interface OfferingExistingRow {
  readonly key: string;
  readonly status: CourseCapabilityStatus;
}

/**
 * State A — zero rows: plan the complete preset.
 * State B — exact keys and statuses already present: successful no-op.
 * BLOCKED — any partial set (C), status mismatch (D), unexpected row (E), or
 *           structurally impossible input. All differences reported in ONE
 *           pass; ZERO writes planned.
 */
export type OfferingInitState = "A" | "B" | "BLOCKED";

export interface OfferingInitPlan {
  readonly state: OfferingInitState;
  /** Executable inserts. ALWAYS empty unless `state === "A"`. */
  readonly writes: readonly OfferingCapabilityInsert[];
  readonly findings: readonly OfferingFinding[];
  readonly blockers: readonly OfferingFinding[];
  readonly blocked: boolean;
  readonly isNoOp: boolean;
  readonly detected: {
    /** Preset keys with no saved row (State C evidence). */
    readonly missing: readonly CapabilityKey[];
    /** Preset keys that DO have a saved row, with their saved status. */
    readonly existing: readonly OfferingExistingRow[];
    /** Preset keys whose saved status differs (State D evidence). */
    readonly mismatched: readonly OfferingStatusMismatch[];
    /** Saved rows the preset does not contain (State E evidence). */
    readonly unexpected: readonly OfferingExistingRow[];
  };
}

/**
 * Plan initialization of an offering to the EXPLICIT legacy preset.
 *
 * Never repairs, never overwrites, never deletes, never consults
 * `defaultEnabled`. Only the pristine State A produces writes.
 */
export function planLegacyOfferingInit(
  rows: readonly OfferingCapabilityRowInput[],
): OfferingInitPlan {
  const normalized = normalizeOfferingRows(rows);
  const findings: OfferingFinding[] = [...normalized.findings];

  const presetByKey = new Map<string, CourseCapabilityStatus>(
    LEGACY_OFFERING_CAPABILITY_PRESET.map((e) => [e.key, e.status]),
  );

  const missing: CapabilityKey[] = [];
  const existing: OfferingExistingRow[] = [];
  const mismatched: OfferingStatusMismatch[] = [];
  const unexpected: OfferingExistingRow[] = [];

  // Preset side, in canonical order.
  for (const entry of LEGACY_OFFERING_CAPABILITY_PRESET) {
    const saved = normalized.statusByKey.get(entry.key);
    if (saved === undefined) {
      missing.push(entry.key);
      continue;
    }
    existing.push({ key: entry.key, status: saved });
    if (saved !== entry.status) {
      mismatched.push({ key: entry.key, expected: entry.status, actual: saved });
    }
  }

  // Saved side: anything the preset does not contain.
  for (const key of [...normalized.statusByKey.keys()].sort(compareStrings)) {
    if (presetByKey.has(key)) continue;
    unexpected.push({
      key,
      status: normalized.statusByKey.get(key) as CourseCapabilityStatus,
    });
  }

  const structurallyFatal = normalized.findings.length > 0;
  const savedRowCount = normalized.statusByKey.size;

  // State A: pristine offering (and no structurally impossible input).
  if (!structurallyFatal && savedRowCount === 0) {
    const writes: OfferingCapabilityInsert[] = LEGACY_OFFERING_CAPABILITY_PRESET.map(
      (e) => ({ kind: "insert", capabilityKey: e.key, status: e.status }),
    );
    return {
      state: "A",
      writes: Object.freeze(writes),
      findings: Object.freeze(sortFindings(findings)),
      blockers: Object.freeze([]),
      blocked: false,
      isNoOp: false,
      detected: {
        missing: Object.freeze(missing),
        existing: Object.freeze(existing),
        mismatched: Object.freeze(mismatched),
        unexpected: Object.freeze(unexpected),
      },
    };
  }

  // Report every difference in one pass (States C, D and E may all apply).
  for (const key of missing) {
    findings.push(
      finding(
        "MISSING_PRESET_ROW",
        key,
        "preset capability has no row while the offering already holds other " +
          "capability state — partial initialization; this command never fills gaps",
      ),
    );
  }
  for (const m of mismatched) {
    findings.push(
      finding(
        "STATUS_MISMATCH",
        m.key,
        `saved status ${m.actual} differs from the preset status ${m.expected} — ` +
          "this command never overwrites a saved status",
      ),
    );
  }
  for (const u of unexpected) {
    findings.push(
      finding(
        "UNEXPECTED_ROW",
        u.key,
        `row (status ${u.status}) is not part of the legacy preset — reported ` +
          "only; it is NEVER deleted",
      ),
    );
  }

  const sorted = sortFindings(findings);
  const blockers = sorted.filter(isBlockingOfferingFinding);
  const blocked = blockers.length > 0;

  return {
    state: blocked ? "BLOCKED" : "B",
    writes: Object.freeze([]),
    findings: Object.freeze(sorted),
    blockers: Object.freeze(blockers),
    blocked,
    isNoOp: !blocked,
    detected: {
      missing: Object.freeze(missing),
      existing: Object.freeze(existing),
      mismatched: Object.freeze(mismatched),
      unexpected: Object.freeze(unexpected),
    },
  };
}

// ---------------------------------------------------------------------------
// Saved-state validation (read-only)
// ---------------------------------------------------------------------------

export interface OfferingValidationResult {
  readonly ok: boolean;
  readonly findings: readonly OfferingFinding[];
  readonly blockers: readonly OfferingFinding[];
  /** Saved statuses; a canonical key absent from this list is DISABLED. */
  readonly effective: readonly OfferingExistingRow[];
}

/**
 * READ-ONLY validation of one offering's saved capability state against the
 * catalog snapshot and the code-owned dependency graph. Reports DISABLED purely
 * as row absence — no default is ever substituted.
 */
export function validateOfferingCapabilityState(
  rows: readonly OfferingCapabilityRowInput[],
  catalogRows: readonly CatalogRowInput[],
): OfferingValidationResult {
  const normalized = normalizeOfferingRows(rows);
  const findings: OfferingFinding[] = [...normalized.findings];

  const catalogByKey = new Map<string, CatalogRowInput>();
  for (const row of catalogRows) {
    if (typeof row?.key === "string" && row.key.length > 0 && !catalogByKey.has(row.key)) {
      catalogByKey.set(row.key, row);
    }
  }

  for (const key of [...normalized.statusByKey.keys()].sort(compareStrings)) {
    const catalogRow = catalogByKey.get(key);
    if (!catalogRow) {
      findings.push(
        finding(
          "CATALOG_KEY_MISSING",
          key,
          "offering row references a capability with no CapabilityCatalog row",
        ),
      );
    } else if (catalogRow.isActive !== true) {
      findings.push(
        finding(
          "CATALOG_KEY_INACTIVE",
          key,
          "offering row references a RETIRED (isActive=false) catalog capability",
        ),
      );
    }
  }

  findings.push(...validateCapabilityDependencies(normalized.statusByKey));

  const sorted = sortFindings(findings);
  const blockers = sorted.filter(isBlockingOfferingFinding);

  const effective: OfferingExistingRow[] = [...normalized.statusByKey.keys()]
    .sort(compareStrings)
    .map((key) => ({
      key,
      status: normalized.statusByKey.get(key) as CourseCapabilityStatus,
    }));

  return {
    ok: blockers.length === 0,
    findings: Object.freeze(sorted),
    blockers: Object.freeze(blockers),
    effective: Object.freeze(effective),
  };
}

/** Canonical keys with no saved row — DISABLED by absence (never a default). */
export function disabledCapabilityKeys(
  statusByKey: ReadonlyMap<string, CourseCapabilityStatus>,
): readonly CapabilityKey[] {
  return Object.freeze(CAPABILITY_KEYS.filter((k) => !statusByKey.has(k)));
}

/** Deterministic human-readable finding lines for CLI output. */
export function formatOfferingFindings(
  findings: readonly OfferingFinding[],
): string[] {
  return findings.map((f) => `[${f.severity}] ${f.code} ${f.key}: ${f.detail}`);
}
