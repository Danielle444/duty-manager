/**
 * MULTI-COURSE (dormant foundation) — Stage 1: PURE effective-capability
 * resolver core.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no auth, no
 * cookie, no env, no network, no logging, no runtime side effects. It accepts
 * already-fetched rows and returns a plain decision, so the entire contract is
 * unit-testable without a database (see effective-capability-core.test.ts).
 *
 * WHAT THIS ANSWERS: the EFFECTIVE status of every canonical capability for a
 * single CourseOffering, given that offering's sparse capability rows plus the
 * capability catalog rows. It has ZERO runtime consumers in this stage — nothing
 * imports it outside its own test — matching the dormant-slice convention of
 * operation-policy-core.ts ("no runtime consumer imports this slice").
 *
 * PERSISTED vs EFFECTIVE vocabulary (derived from schema.prisma / migration /
 * capability-labels.ts at HEAD, never from memory):
 *   - Persisted status domain = { ENABLED, READ_ONLY } ONLY. This is the Prisma
 *     enum CourseCapabilityStatus and its TS mirror COURSE_CAPABILITY_STATUSES.
 *   - DISABLED is NOT persistable. It exists ONLY as an EFFECTIVE (computed)
 *     value, produced by row absence, inactive/missing catalog, dependency
 *     clamping, or a malformed/out-of-domain saved string — never by a saved
 *     "DISABLED".
 *   - EffectiveCapabilityStatus is a distinct output type, deliberately a
 *     superset of the persisted domain, and must not be conflated with
 *     CourseCapabilityStatus.
 *
 * ALL FAIL-CLOSED. Absence ⇒ DISABLED (the CAP-1 sparse-storage invariant);
 * `defaultEnabled` is NEVER consulted (reading it would silently enable
 * ATTENDANCE for any unconfigured offering — the exact COALESCE hazard the
 * schema comment forbids). Unknown keys grant nothing. Malformed status ⇒
 * DISABLED. Nothing here ever fails open.
 */
import { CAPABILITY_KEYS, isCapabilityKey, type CapabilityKey } from "./capability-keys";
import { CAPABILITY_CATALOG } from "./capability-catalog";
import { isCourseCapabilityStatus } from "./capability-labels";

/**
 * The EFFECTIVE (computed) status domain. A superset of the persisted
 * CourseCapabilityStatus: DISABLED is output-only and never persisted.
 */
export type EffectiveCapabilityStatus = "ENABLED" | "READ_ONLY" | "DISABLED";

/**
 * The lattice used for dependency clamping: DISABLED < READ_ONLY < ENABLED.
 * Effective status of a dependent = the MINIMUM of its own effective status and
 * every ancestor's effective status on this order.
 */
const STATUS_RANK: { readonly [S in EffectiveCapabilityStatus]: number } = {
  DISABLED: 0,
  READ_ONLY: 1,
  ENABLED: 2,
};

function minStatus(
  a: EffectiveCapabilityStatus,
  b: EffectiveCapabilityStatus,
): EffectiveCapabilityStatus {
  return STATUS_RANK[a] <= STATUS_RANK[b] ? a : b;
}

/**
 * One capability row of a single offering, as accepted by the pure core. The
 * `status` is deliberately typed as a raw `string` (not CourseCapabilityStatus)
 * so the core can defensively detect and fail-close on a malformed/out-of-domain
 * value even though the database enum currently constrains the column.
 */
export interface OfferingCapabilityRow {
  capabilityKey: string;
  status: string;
}

/** One capability_catalog row, as accepted by the pure core. */
export interface CapabilityCatalogRow {
  key: string;
  isActive: boolean;
}

/**
 * Internal, PII-free diagnostic kinds. This structure exists SOLELY so the
 * focused tests can assert malformed/unknown/retirement handling. It is NEVER
 * exposed through the public reader, logged, or returned to any runtime or
 * user-facing path in Stage 1.
 *
 * NOTE precisely which conditions do and do NOT produce a diagnostic:
 *   - LEGITIMATE ABSENCE of an offering row for a canonical key produces NO
 *     entry (it is normal sparse-storage state, not drift).
 *   - `malformedStatus` is recorded ONLY for a present row whose status string
 *     is outside { ENABLED, READ_ONLY }.
 */
export type CapabilityDiagnosticKind =
  | "malformedStatus"
  | "unknownOfferingKey"
  | "duplicateOfferingRow"
  | "missingCatalog"
  | "inactiveCatalog"
  | "unknownCatalogKey";

export interface CapabilityDiagnosticEntry {
  readonly kind: CapabilityDiagnosticKind;
  /** A capability key or a raw offered/catalog key string. Never PII. */
  readonly key: string;
}

/**
 * The internal result of the pure resolver: the exhaustive effective-status map
 * plus the diagnostic ("drift") entries. The public server reader returns ONLY
 * the `effective` half; `drift` stays internal.
 */
export interface EffectiveCapabilityResolution {
  readonly effective: Record<CapabilityKey, EffectiveCapabilityStatus>;
  readonly drift: readonly CapabilityDiagnosticEntry[];
}

/**
 * Resolve the effective status of EVERY canonical capability for one offering.
 *
 * The returned `effective` map:
 *   - is exhaustive over CAPABILITY_KEYS (every canonical key present exactly
 *     once), and contains no other keys;
 *   - is built on a NULL-PROTOTYPE object and populated ONLY by iterating the
 *     canonical CAPABILITY_KEYS — raw database keys are never copied in as
 *     property names, so "__proto__"/"constructor"/etc. can never pollute it or
 *     be inherited through it.
 */
export function resolveEffectiveCapabilitiesFromRows(
  offeringRows: readonly OfferingCapabilityRow[],
  catalogRows: readonly CapabilityCatalogRow[],
): EffectiveCapabilityResolution {
  const drift: CapabilityDiagnosticEntry[] = [];

  // Phase A — reduce the offering rows to an own-status per CANONICAL key,
  // independent of the catalog. Unknown keys and malformed statuses are recorded
  // and never contribute a grantable value; duplicates (which the DB unique
  // index prevents) are merged fail-closed by taking the more restrictive (min)
  // status. Null-prototype accumulator so no offered key can pollute it.
  const rowStatusByKey: Record<string, EffectiveCapabilityStatus> = Object.create(null);
  for (const row of offeringRows) {
    if (!isCapabilityKey(row.capabilityKey)) {
      drift.push({ kind: "unknownOfferingKey", key: row.capabilityKey });
      continue;
    }
    const rowStatus: EffectiveCapabilityStatus = isCourseCapabilityStatus(row.status)
      ? row.status
      : (drift.push({ kind: "malformedStatus", key: row.capabilityKey }), "DISABLED");
    if (Object.prototype.hasOwnProperty.call(rowStatusByKey, row.capabilityKey)) {
      drift.push({ kind: "duplicateOfferingRow", key: row.capabilityKey });
      rowStatusByKey[row.capabilityKey] = minStatus(
        rowStatusByKey[row.capabilityKey],
        rowStatus,
      );
    } else {
      rowStatusByKey[row.capabilityKey] = rowStatus;
    }
  }

  // Phase B — index the catalog by CANONICAL key -> isActive. A catalog row
  // whose key is not canonical is recorded and ignored. Null-prototype
  // accumulator for the same pollution-safety reason.
  const catalogActiveByKey: Record<string, boolean> = Object.create(null);
  for (const cat of catalogRows) {
    if (!isCapabilityKey(cat.key)) {
      drift.push({ kind: "unknownCatalogKey", key: cat.key });
      continue;
    }
    catalogActiveByKey[cat.key] = cat.isActive;
  }

  // Phase C — own pre-clamp effective status for each canonical key. Catalog
  // gating wins over any saved row: a missing or retired catalog row forces
  // DISABLED regardless of the offering row.
  const ownByKey: Record<string, EffectiveCapabilityStatus> = Object.create(null);
  for (const key of CAPABILITY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(catalogActiveByKey, key)) {
      drift.push({ kind: "missingCatalog", key });
      ownByKey[key] = "DISABLED";
    } else if (catalogActiveByKey[key] === false) {
      drift.push({ kind: "inactiveCatalog", key });
      ownByKey[key] = "DISABLED";
    } else if (Object.prototype.hasOwnProperty.call(rowStatusByKey, key)) {
      ownByKey[key] = rowStatusByKey[key];
    } else {
      // Legitimate absence — normal sparse-storage DISABLED. NO diagnostic.
      ownByKey[key] = "DISABLED";
    }
  }

  // Phase D — clamp by the code-owned dependency graph. Effective status of a
  // capability = min(own, every ancestor's effective). Memoized over an acyclic
  // graph (acyclicity is proven by capability-catalog.test.ts). Dependency edges
  // are read from CAPABILITY_CATALOG, never hardcoded here.
  const effective: Record<CapabilityKey, EffectiveCapabilityStatus> = Object.create(null);
  const resolving = new Set<CapabilityKey>();
  const resolveEffective = (key: CapabilityKey): EffectiveCapabilityStatus => {
    if (Object.prototype.hasOwnProperty.call(effective, key)) {
      return effective[key];
    }
    // Defensive cycle guard; the catalog is proven acyclic, so this never trips
    // in practice, but a cycle must fail closed rather than recurse forever.
    if (resolving.has(key)) {
      return "DISABLED";
    }
    resolving.add(key);
    let status = ownByKey[key];
    for (const parent of CAPABILITY_CATALOG[key].dependsOn) {
      status = minStatus(status, resolveEffective(parent));
    }
    resolving.delete(key);
    effective[key] = status;
    return status;
  };
  for (const key of CAPABILITY_KEYS) {
    resolveEffective(key);
  }

  return { effective, drift };
}
