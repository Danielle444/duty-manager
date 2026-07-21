/**
 * MULTI-COURSE (dormant foundation) — W0-CAP-3: PURE catalog synchronization
 * planning and drift validation.
 *
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env,
 * no network, no logging, no runtime side effects. Every function here takes a
 * plain snapshot array (the caller reads it; this module never does) and
 * returns a deterministic, sorted plan. The Prisma write adapter lives in
 * scripts/capability-admin.ts and may execute ONLY what a plan lists.
 *
 * WHAT A CATALOG SYNC MAY DO (CAP-3):
 *   - INSERT a canonical key that has no row, using its INSERT-ONLY initial
 *     Hebrew label;
 *   - RETIRE (isActive=false) an ACTIVE row whose key is no longer canonical;
 *   - REACTIVATE (isActive=true) a canonical key whose row is inactive, and
 *     ONLY when the operator explicitly named it via --reactivate=KEY.
 *
 * WHAT IT MUST NEVER DO:
 *   - DELETE any row (retirement is the only removal representation);
 *   - UPDATE any label (a stored label is operational state — a difference from
 *     the code label is INFORMATION only and is preserved exactly);
 *   - reactivate anything implicitly;
 *   - consult `defaultEnabled` for anything at all.
 *
 * FAIL-CLOSED (CAP-10): if the snapshot produces ANY blocker, the returned plan
 * exposes ZERO executable writes. All blockers are reported in one pass — the
 * classification never stops at the first problem.
 */
import { CAPABILITY_KEYS, isCapabilityKey, type CapabilityKey } from "./capability-keys";
import { INITIAL_CAPABILITY_LABELS } from "./capability-labels";

/** One `capability_catalog` row as read from the database (or a test fixture). */
export interface CatalogRowInput {
  readonly key: string;
  readonly label: string;
  readonly isActive: boolean;
}

/**
 * INFO             — expected state or preserved operational state; no action.
 * REPAIRABLE       — drift that an explicit `catalog-sync --apply` repairs.
 * DECISION_REQUIRED— needs an explicit operator decision (blocks ordinary sync).
 * FATAL            — impossible/unsafe input (blocks everything).
 */
export type CatalogFindingSeverity =
  | "INFO"
  | "REPAIRABLE"
  | "DECISION_REQUIRED"
  | "FATAL";

export type CatalogFindingCode =
  /** Canonical key has no catalog row -> insert with the initial label. */
  | "MISSING_CANONICAL_KEY"
  /** Active row whose key is no longer canonical -> retire (never delete). */
  | "OBSOLETE_ACTIVE_KEY"
  /** Already-retired non-canonical row -> expected no-op. */
  | "OBSOLETE_INACTIVE_KEY"
  /** Canonical key whose row is retired -> requires explicit --reactivate. */
  | "INACTIVE_CANONICAL_KEY"
  /** An explicitly requested, valid reactivation. */
  | "REACTIVATION_PLANNED"
  /** Stored label differs from the code label -> PRESERVED, informational. */
  | "LABEL_DIFFERS_FROM_INITIAL"
  /** Two snapshot rows share a key (the PK normally prevents this). */
  | "DUPLICATE_INPUT_ROW"
  /** Blank/untrimmed key or blank label. */
  | "MALFORMED_INPUT_ROW"
  /** --reactivate names a key that is not a current canonical key. */
  | "UNKNOWN_REACTIVATION_KEY"
  /** --reactivate names a canonical key that is not an inactive existing row. */
  | "REACTIVATION_TARGET_NOT_INACTIVE";

export interface CatalogFinding {
  readonly code: CatalogFindingCode;
  readonly severity: CatalogFindingSeverity;
  /** The catalog key (or the requested reactivation key) this concerns. */
  readonly key: string;
  readonly detail: string;
}

export interface CatalogInsertWrite {
  readonly kind: "insert";
  readonly key: CapabilityKey;
  /** INSERT-ONLY initial label. Never applied to an existing row. */
  readonly label: string;
}

export interface CatalogRetireWrite {
  readonly kind: "retire";
  readonly key: string;
}

export interface CatalogReactivateWrite {
  readonly kind: "reactivate";
  readonly key: CapabilityKey;
}

/**
 * The complete write vocabulary of a catalog sync. There is deliberately no
 * label-update and no delete member: an operation the type cannot express can
 * never reach the transaction.
 */
export type CatalogWrite =
  | CatalogInsertWrite
  | CatalogRetireWrite
  | CatalogReactivateWrite;

export interface CatalogSyncPlan {
  /** Executable writes. ALWAYS empty when `blocked` is true. */
  readonly writes: readonly CatalogWrite[];
  /** Every finding, sorted deterministically. */
  readonly findings: readonly CatalogFinding[];
  /** The subset of `findings` that blocks execution (FATAL/DECISION_REQUIRED). */
  readonly blockers: readonly CatalogFinding[];
  readonly blocked: boolean;
  readonly counts: {
    readonly inserts: number;
    readonly retirements: number;
    readonly reactivations: number;
  };
  /** True iff nothing is blocked and nothing needs to be written. */
  readonly isNoOp: boolean;
}

export interface CatalogSyncOptions {
  /** Keys named by repeatable --reactivate=KEY options. */
  readonly reactivate?: readonly string[];
}

const SEVERITY_OF: Readonly<Record<CatalogFindingCode, CatalogFindingSeverity>> = {
  MISSING_CANONICAL_KEY: "REPAIRABLE",
  OBSOLETE_ACTIVE_KEY: "REPAIRABLE",
  OBSOLETE_INACTIVE_KEY: "INFO",
  INACTIVE_CANONICAL_KEY: "DECISION_REQUIRED",
  REACTIVATION_PLANNED: "INFO",
  LABEL_DIFFERS_FROM_INITIAL: "INFO",
  DUPLICATE_INPUT_ROW: "FATAL",
  MALFORMED_INPUT_ROW: "FATAL",
  UNKNOWN_REACTIVATION_KEY: "FATAL",
  REACTIVATION_TARGET_NOT_INACTIVE: "FATAL",
};

/** A finding blocks execution unless it is purely informational or repairable. */
function isBlocking(finding: CatalogFinding): boolean {
  return finding.severity === "FATAL" || finding.severity === "DECISION_REQUIRED";
}

const WRITE_KIND_RANK: Readonly<Record<CatalogWrite["kind"], number>> = {
  insert: 0,
  retire: 1,
  reactivate: 2,
};

function compareStrings(a: string, b: string): number {
  // Deliberately locale-independent: catalog keys are ASCII constants and the
  // output ordering must be byte-stable across machines.
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortFindings(findings: readonly CatalogFinding[]): CatalogFinding[] {
  return [...findings].sort(
    (a, b) => compareStrings(a.key, b.key) || compareStrings(a.code, b.code),
  );
}

function sortWrites(writes: readonly CatalogWrite[]): CatalogWrite[] {
  return [...writes].sort(
    (a, b) =>
      WRITE_KIND_RANK[a.kind] - WRITE_KIND_RANK[b.kind] ||
      compareStrings(a.key, b.key),
  );
}

function finding(
  code: CatalogFindingCode,
  key: string,
  detail: string,
): CatalogFinding {
  return { code, severity: SEVERITY_OF[code], key, detail };
}

/**
 * Plan a catalog synchronization from a snapshot. Deterministic and total: any
 * input, including impossible input, yields a plan rather than a throw.
 */
export function planCatalogSync(
  rows: readonly CatalogRowInput[],
  options: CatalogSyncOptions = {},
): CatalogSyncPlan {
  const findings: CatalogFinding[] = [];
  const writes: CatalogWrite[] = [];

  // --- 1. structural validation of the snapshot ------------------------------
  const byKey = new Map<string, CatalogRowInput>();
  const duplicated = new Set<string>();
  const malformed = new Set<string>();

  for (const row of rows) {
    const rawKey = typeof row?.key === "string" ? row.key : "";
    const label = typeof row?.label === "string" ? row.label : "";
    const isMalformed =
      rawKey.length === 0 || rawKey.trim() !== rawKey || label.trim().length === 0;

    if (isMalformed) {
      const shown = rawKey.length > 0 ? rawKey : "<blank key>";
      if (!malformed.has(shown)) {
        malformed.add(shown);
        findings.push(
          finding(
            "MALFORMED_INPUT_ROW",
            shown,
            "catalog row has a blank/untrimmed key or a blank label; refusing to " +
              "classify it",
          ),
        );
      }
      continue;
    }

    if (byKey.has(rawKey)) {
      if (!duplicated.has(rawKey)) {
        duplicated.add(rawKey);
        findings.push(
          finding(
            "DUPLICATE_INPUT_ROW",
            rawKey,
            "snapshot contains more than one row for this key (the primary key " +
              "normally makes this impossible) — refusing to plan any write",
          ),
        );
      }
      continue;
    }
    byKey.set(rawKey, { key: rawKey, label, isActive: row.isActive === true });
  }

  // --- 2. requested reactivations -------------------------------------------
  const requested = new Set<string>(options.reactivate ?? []);
  const approvedReactivations = new Set<CapabilityKey>();

  for (const rawRequest of [...requested].sort(compareStrings)) {
    const key = typeof rawRequest === "string" ? rawRequest.trim() : "";
    if (!isCapabilityKey(key)) {
      findings.push(
        finding(
          "UNKNOWN_REACTIVATION_KEY",
          key.length > 0 ? key : "<blank>",
          "--reactivate names a key that is not a current canonical capability " +
            "key; refusing",
        ),
      );
      continue;
    }
    const row = byKey.get(key);
    if (!row) {
      findings.push(
        finding(
          "REACTIVATION_TARGET_NOT_INACTIVE",
          key,
          "canonical key has no catalog row — an ordinary sync inserts it as " +
            "active; it cannot be reactivated",
        ),
      );
      continue;
    }
    if (row.isActive) {
      findings.push(
        finding(
          "REACTIVATION_TARGET_NOT_INACTIVE",
          key,
          "catalog row is already active; nothing to reactivate",
        ),
      );
      continue;
    }
    approvedReactivations.add(key);
  }

  // --- 3. canonical keys ------------------------------------------------------
  for (const key of CAPABILITY_KEYS) {
    const row = byKey.get(key);
    if (!row) {
      findings.push(
        finding(
          "MISSING_CANONICAL_KEY",
          key,
          `no catalog row; insert with initial label "${INITIAL_CAPABILITY_LABELS[key]}"`,
        ),
      );
      writes.push({
        kind: "insert",
        key,
        label: INITIAL_CAPABILITY_LABELS[key],
      });
      continue;
    }

    // A stored label is operational state: report, never overwrite.
    if (row.label !== INITIAL_CAPABILITY_LABELS[key]) {
      findings.push(
        finding(
          "LABEL_DIFFERS_FROM_INITIAL",
          key,
          `stored label "${row.label}" differs from the initial code label ` +
            `"${INITIAL_CAPABILITY_LABELS[key]}" — PRESERVED unchanged`,
        ),
      );
    }

    if (row.isActive) continue;

    if (approvedReactivations.has(key)) {
      findings.push(
        finding(
          "REACTIVATION_PLANNED",
          key,
          `explicitly requested reactivation; existing label "${row.label}" is preserved`,
        ),
      );
      writes.push({ kind: "reactivate", key });
    } else {
      findings.push(
        finding(
          "INACTIVE_CANONICAL_KEY",
          key,
          "canonical key exists but is retired (isActive=false); ordinary sync " +
            "never reactivates implicitly — re-run with --reactivate=" +
            key +
            " if this is intended",
        ),
      );
    }
  }

  // --- 4. non-canonical (obsolete) rows --------------------------------------
  for (const key of [...byKey.keys()].sort(compareStrings)) {
    if (isCapabilityKey(key)) continue;
    const row = byKey.get(key) as CatalogRowInput;
    if (row.isActive) {
      findings.push(
        finding(
          "OBSOLETE_ACTIVE_KEY",
          key,
          "active catalog row is not a canonical capability key; retire it " +
            "(isActive=false). Rows are never deleted.",
        ),
      );
      writes.push({ kind: "retire", key });
    } else {
      findings.push(
        finding(
          "OBSOLETE_INACTIVE_KEY",
          key,
          "non-canonical row is already retired; expected no-op",
        ),
      );
    }
  }

  // --- 5. fail closed ---------------------------------------------------------
  const sortedFindings = sortFindings(findings);
  const blockers = sortedFindings.filter(isBlocking);
  const blocked = blockers.length > 0;
  const executable = blocked ? [] : sortWrites(writes);

  return {
    writes: Object.freeze(executable),
    findings: Object.freeze(sortedFindings),
    blockers: Object.freeze(blockers),
    blocked,
    counts: {
      inserts: executable.filter((w) => w.kind === "insert").length,
      retirements: executable.filter((w) => w.kind === "retire").length,
      reactivations: executable.filter((w) => w.kind === "reactivate").length,
    },
    isNoOp: !blocked && executable.length === 0,
  };
}

export interface CatalogValidationResult {
  /** True iff the snapshot is exactly synchronized (INFO findings allowed). */
  readonly ok: boolean;
  readonly findings: readonly CatalogFinding[];
  /** Drift an explicit `catalog-sync --apply` would repair. */
  readonly repairable: readonly CatalogFinding[];
  /** Findings needing an explicit operator decision, plus fatal input problems. */
  readonly blockers: readonly CatalogFinding[];
}

/**
 * READ-ONLY drift validation (CAP-10). Uses the same classification as the
 * planner so validate and sync can never disagree, but plans nothing. `ok` is
 * fail-closed: any drift, decision or fatal finding makes it false.
 */
export function validateCatalogState(
  rows: readonly CatalogRowInput[],
): CatalogValidationResult {
  const plan = planCatalogSync(rows);
  const repairable = plan.findings.filter((f) => f.severity === "REPAIRABLE");
  return {
    ok: repairable.length === 0 && plan.blockers.length === 0,
    findings: plan.findings,
    repairable: Object.freeze(repairable),
    blockers: plan.blockers,
  };
}

/** Deterministic human-readable finding lines for CLI output. */
export function formatCatalogFindings(
  findings: readonly CatalogFinding[],
): string[] {
  return findings.map((f) => `[${f.severity}] ${f.code} ${f.key}: ${f.detail}`);
}

/** Deterministic human-readable write lines for CLI output. */
export function formatCatalogWrites(writes: readonly CatalogWrite[]): string[] {
  return writes.map((w) =>
    w.kind === "insert"
      ? `INSERT ${w.key} label="${w.label}" isActive=true`
      : w.kind === "retire"
        ? `RETIRE ${w.key} (isActive=false; label preserved; NOT deleted)`
        : `REACTIVATE ${w.key} (isActive=true; label preserved)`,
  );
}
