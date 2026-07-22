/**
 * MC-BOOTSTRAP-S1 — PURE planning/validation core for a FUTURE isolated second-
 * instance bootstrap (Option C). See MC-PLAN-3A / MC-PLAN-3A-CORRECTION.
 *
 * PURE by construction: no Prisma, no PrismaClient, no DB, no Supabase, no
 * Storage, no capability-admin, no process.env, no DATABASE_URL/DIRECT_URL, no
 * URL parsing, no filesystem, no network, no clock, no randomness, no logging,
 * and NO side effects at import time. Every function takes already-supplied
 * plain data and returns plain data, so the whole contract is unit-testable
 * without any I/O (see bootstrap-isolated-instance.plan.test.ts).
 *
 * SCOPE (S1 only): typed config parsing/validation, a pure target-safety
 * decision from SUPPLIED ref metadata, a pure structural creation PLAN (data,
 * never writes), and pure structural conflict classification from SUPPLIED
 * observed state. It DOES NOT read the environment, DOES NOT detect the target
 * ref itself, DOES NOT query CourseOffering counts, and DOES NOT execute
 * anything — all of that is the future S2 runner's job.
 *
 * The plan describes ONLY the structural spine + capability rows:
 *   ActivityYear -> exactly one CourseOffering -> CourseGroups ->
 *   CapabilityCatalog -> CourseOfferingCapability.
 * It deliberately NEVER plans CourseSettings, DutyType, AdminEmail, Students,
 * Instructors, enrollments, memberships, or any operational/personal/auth/
 * Storage data (MC-PLAN-3A-CORRECTION §4/§5). CourseSettings appears here only
 * as a generic conflict CLASSIFIER (never a create-plan), so a divergent
 * singleton can be proven to classify as CONFLICT.
 *
 * Reuse: the strict date-only primitives (isValidDateKey / compareDateKeys) come
 * from lib/trainee-history/interval-resolver — itself a pure, side-effect-free,
 * env-free, Prisma-free module whose date-only semantics match this contract
 * exactly (K reuse gate). The isolated-bootstrap SAFETY constant and all
 * conflict rules are kept LOCAL rather than imported from
 * scripts/backfill-course-offering.plan.ts, to avoid coupling S1 to the
 * backfill's URL-detection / offering-reuse semantics (which are backfill-
 * specific and weaker than the STOP-by-default rule here).
 */

import {
  isValidDateKey,
  compareDateKeys,
  type DateKey,
} from "../lib/trainee-history/interval-resolver";

// ---------------------------------------------------------------------------
// Safety constant (deny-only)
// ---------------------------------------------------------------------------

/**
 * The EXISTING production Supabase project ref. It exists in this pure core
 * SOLELY as a deny-only guard: the target-safety decision rejects any target
 * whose expected OR detected ref equals it. It is NEVER a default, NEVER a
 * fixture/expected/permitted target. This mirrors
 * scripts/backfill-course-offering.plan.ts PRODUCTION_PROJECT_REF (kept local
 * on purpose — see the module header) and must stay identical to it.
 */
export const PRODUCTION_PROJECT_REF_DENY = "yjnjfnesxhmzhzpwrmqy";

/**
 * Plausible Supabase project-ref shape: 20 lowercase alphanumeric characters
 * (the shape of the verified production ref). This is a syntactic plausibility
 * gate only — it never contacts any provider.
 */
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

// ---------------------------------------------------------------------------
// Shared result primitives
// ---------------------------------------------------------------------------

/**
 * A single typed, redacted validation/classification issue. `path` locates the
 * offending field, `code` is a stable machine key, `message` is a short human
 * string that NEVER echoes a full ref, secret, personal record, or free-text
 * name value (only structural field paths / enum tokens / counts).
 */
export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

// ---------------------------------------------------------------------------
// Enums mirrored from the Prisma schema (exact allowed values)
// ---------------------------------------------------------------------------

/** CourseOffering.status — schema enum CourseOfferingStatus (no default in S1). */
export const OFFERING_STATUSES = ["PLANNED", "ACTIVE", "ARCHIVED"] as const;
export type OfferingStatus = (typeof OFFERING_STATUSES)[number];

/** CourseOfferingCapability.status — schema enum CourseCapabilityStatus. */
export const OFFERING_CAPABILITY_STATUSES = ["ENABLED", "READ_ONLY"] as const;
export type OfferingCapabilityStatus = (typeof OFFERING_CAPABILITY_STATUSES)[number];

function isOfferingStatus(v: unknown): v is OfferingStatus {
  return typeof v === "string" && (OFFERING_STATUSES as readonly string[]).includes(v);
}

function isOfferingCapabilityStatus(v: unknown): v is OfferingCapabilityStatus {
  return (
    typeof v === "string" &&
    (OFFERING_CAPABILITY_STATUSES as readonly string[]).includes(v)
  );
}

// ---------------------------------------------------------------------------
// Small pure guards
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Trim; return null when the trimmed result is empty (no meaningful value). */
function nonBlank(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

/**
 * Read an optional date-only field. Returns:
 *  - { present:false }                    when absent (undefined or null)
 *  - { present:true, ok:true, key }       when a valid YYYY-MM-DD string
 *  - { present:true, ok:false }           when present but malformed/invalid
 */
type OptionalDate =
  | { present: false }
  | { present: true; ok: true; key: DateKey }
  | { present: true; ok: false };

function readOptionalDate(v: unknown): OptionalDate {
  if (v === undefined || v === null) return { present: false };
  if (isValidDateKey(v)) return { present: true, ok: true, key: v };
  return { present: true, ok: false };
}

// ===========================================================================
// D.1 — Target-safety metadata + decision
// ===========================================================================

/** Supplied by a future S2 caller — S1 never obtains these itself. */
export interface TargetMetadata {
  readonly expectedProjectRef: string;
  readonly detectedProjectRef: string;
}

export type TargetSafetyDecision =
  | { readonly kind: "allowed"; readonly projectRef: string }
  | { readonly kind: "invalid_metadata"; readonly issues: readonly ValidationIssue[] }
  | {
      readonly kind: "ref_mismatch";
      readonly expectedProjectRef: string;
      readonly detectedProjectRef: string;
    }
  | {
      readonly kind: "production_ref_rejected";
      readonly which: "expected" | "detected" | "both";
    };

/**
 * Decide whether a SUPPLIED (expected, detected) ref pair is a safe bootstrap
 * target. Order of checks makes production rejection UNCONDITIONAL — a ref that
 * equals the production ref is rejected before any format/mismatch logic, so it
 * can never be laundered through a malformed-field path.
 *
 * Accepts only project-ref strings; it accepts NO secret of any kind (there is
 * no DB URL / password / service key in this contract), so no diagnostic can
 * leak one.
 */
export function decideTargetSafety(target: TargetMetadata): TargetSafetyDecision {
  const expected = target.expectedProjectRef;
  const detected = target.detectedProjectRef;

  // 1) Unconditional production denial (either side).
  const expectedIsProd = expected === PRODUCTION_PROJECT_REF_DENY;
  const detectedIsProd = detected === PRODUCTION_PROJECT_REF_DENY;
  if (expectedIsProd || detectedIsProd) {
    const which =
      expectedIsProd && detectedIsProd ? "both" : expectedIsProd ? "expected" : "detected";
    return { kind: "production_ref_rejected", which };
  }

  // 2) Structural validity of the supplied metadata.
  const issues: ValidationIssue[] = [];
  if (!PROJECT_REF_PATTERN.test(expected)) {
    issues.push(
      issue(
        "target.expectedProjectRef",
        "target.ref.invalid",
        "expectedProjectRef is empty or not a plausible 20-char project ref",
      ),
    );
  }
  if (!PROJECT_REF_PATTERN.test(detected)) {
    issues.push(
      issue(
        "target.detectedProjectRef",
        "target.ref.invalid",
        "detectedProjectRef is empty or not a plausible 20-char project ref",
      ),
    );
  }
  if (issues.length > 0) {
    return { kind: "invalid_metadata", issues };
  }

  // 3) Expected must exactly equal detected.
  if (expected !== detected) {
    return {
      kind: "ref_mismatch",
      expectedProjectRef: expected,
      detectedProjectRef: detected,
    };
  }

  // 4) Safe.
  return { kind: "allowed", projectRef: expected };
}

// ===========================================================================
// D.2–D.5 — Typed configuration contract + parsing/validation
// ===========================================================================

export interface ActivityYearInput {
  readonly name: string;
  /** Optional date-only YYYY-MM-DD; both-absent is valid (see conservative rule). */
  readonly startDate?: string | null;
  readonly endDate?: string | null;
}

export interface CourseOfferingInput {
  readonly name: string;
  readonly level: number;
  /** Required by the bootstrap contract: the singleton resolver needs concrete dates. */
  readonly startDate: string;
  readonly endDate: string;
  /** Required explicit status — S1 never supplies a default. */
  readonly status: OfferingStatus;
}

export interface CourseSubgroupInput {
  readonly name: string;
}

export interface CourseGroupInput {
  readonly name: string;
  readonly subgroups?: readonly CourseSubgroupInput[];
}

export interface CapabilityInput {
  readonly key: string;
  readonly label: string;
  readonly isActive: boolean;
  readonly offeringStatus: OfferingCapabilityStatus;
}

export interface BootstrapConfigInput {
  readonly activityYear: ActivityYearInput;
  readonly offering: CourseOfferingInput;
  readonly groups: readonly CourseGroupInput[];
  readonly capabilities: readonly CapabilityInput[];
}

/** A normalized (trimmed, validated) config ready for planning. */
export interface NormalizedBootstrapConfig {
  readonly activityYear: {
    readonly name: string;
    readonly startDate: DateKey | null;
    readonly endDate: DateKey | null;
  };
  readonly offering: {
    readonly name: string;
    readonly level: number;
    readonly startDate: DateKey;
    readonly endDate: DateKey;
    readonly status: OfferingStatus;
  };
  readonly groups: readonly {
    readonly name: string;
    readonly subgroups: readonly { readonly name: string }[];
  }[];
  readonly capabilities: readonly {
    readonly key: string;
    readonly label: string;
    readonly isActive: boolean;
    readonly offeringStatus: OfferingCapabilityStatus;
  }[];
}

export type ParseConfigResult =
  | { readonly ok: true; readonly config: NormalizedBootstrapConfig }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/**
 * CONSERVATIVE ActivityYear date rule (documented, tested): a year's dates are
 * BOTH-OR-NEITHER. Both absent is valid (a container before its bounds are
 * fixed — the schema makes them nullable). Both present requires start <= end.
 * Exactly ONE present is REJECTED: a half-specified window is ambiguous and the
 * bootstrap refuses to guess the missing bound. (CourseOffering dates, by
 * contrast, are always required — see below.)
 */
function validateActivityYear(raw: unknown, issues: ValidationIssue[]): NormalizedBootstrapConfig["activityYear"] | null {
  if (!isPlainObject(raw)) {
    issues.push(issue("activityYear", "activityYear.missing", "activityYear must be an object"));
    return null;
  }
  const name = nonBlank(raw.name);
  if (name === null) {
    issues.push(issue("activityYear.name", "name.blank", "activityYear.name is required and must be non-blank"));
  }
  const start = readOptionalDate(raw.startDate);
  const end = readOptionalDate(raw.endDate);
  if (start.present && !start.ok) {
    issues.push(issue("activityYear.startDate", "date.invalid", "activityYear.startDate is not a valid YYYY-MM-DD date"));
  }
  if (end.present && !end.ok) {
    issues.push(issue("activityYear.endDate", "date.invalid", "activityYear.endDate is not a valid YYYY-MM-DD date"));
  }
  // Both-or-neither (conservative).
  if (start.present !== end.present) {
    issues.push(
      issue(
        "activityYear.dates",
        "dates.incomplete",
        "activityYear dates are both-or-neither: supply both startDate and endDate, or omit both",
      ),
    );
  }
  if (start.present && start.ok && end.present && end.ok) {
    if (compareDateKeys(start.key, end.key) > 0) {
      issues.push(issue("activityYear.dates", "dates.reversed", "activityYear.startDate must be <= endDate"));
    }
  }
  if (name === null || (start.present && !start.ok) || (end.present && !end.ok) || start.present !== end.present) {
    return null;
  }
  return {
    name,
    startDate: start.present && start.ok ? start.key : null,
    endDate: end.present && end.ok ? end.key : null,
  };
}

function validateOffering(raw: unknown, issues: ValidationIssue[]): NormalizedBootstrapConfig["offering"] | null {
  if (!isPlainObject(raw)) {
    issues.push(issue("offering", "offering.missing", "offering must be an object"));
    return null;
  }
  let ok = true;
  const name = nonBlank(raw.name);
  if (name === null) {
    issues.push(issue("offering.name", "name.blank", "offering.name is required and must be non-blank"));
    ok = false;
  }
  const level = raw.level;
  if (typeof level !== "number" || !Number.isInteger(level)) {
    issues.push(issue("offering.level", "level.notInteger", "offering.level is required and must be an integer"));
    ok = false;
  }
  const start = readOptionalDate(raw.startDate);
  const end = readOptionalDate(raw.endDate);
  if (!start.present || !start.ok) {
    issues.push(issue("offering.startDate", "date.required", "offering.startDate is required and must be a valid YYYY-MM-DD date"));
    ok = false;
  }
  if (!end.present || !end.ok) {
    issues.push(issue("offering.endDate", "date.required", "offering.endDate is required and must be a valid YYYY-MM-DD date"));
    ok = false;
  }
  if (start.present && start.ok && end.present && end.ok && compareDateKeys(start.key, end.key) > 0) {
    issues.push(issue("offering.dates", "dates.reversed", "offering.startDate must be <= endDate"));
    ok = false;
  }
  if (!isOfferingStatus(raw.status)) {
    issues.push(
      issue(
        "offering.status",
        "status.invalid",
        "offering.status is required and must be one of PLANNED | ACTIVE | ARCHIVED (never defaulted)",
      ),
    );
    ok = false;
  }
  if (!ok || name === null || typeof level !== "number" || !start.present || !start.ok || !end.present || !end.ok || !isOfferingStatus(raw.status)) {
    return null;
  }
  return { name, level, startDate: start.key, endDate: end.key, status: raw.status };
}

/**
 * CourseGroup uniqueness rule (matches the verified schema): top-level names are
 * unique per offering (partial unique index WHERE parentGroupId IS NULL), and
 * child names are unique per PARENT (@@unique([courseOfferingId, parentGroupId,
 * name])). Therefore the SAME child name under DIFFERENT parents is ALLOWED
 * (correct), while a duplicate top-level name, or a duplicate child under the
 * same parent, is rejected. At least one top-level group is required (a course
 * with no groups cannot accept trainees downstream).
 */
function validateGroups(raw: unknown, issues: ValidationIssue[]): NormalizedBootstrapConfig["groups"] | null {
  if (!Array.isArray(raw)) {
    issues.push(issue("groups", "groups.notArray", "groups must be an array"));
    return null;
  }
  if (raw.length === 0) {
    issues.push(issue("groups", "groups.empty", "at least one top-level group is required"));
    return null;
  }
  const out: { name: string; subgroups: { name: string }[] }[] = [];
  const topSeen = new Set<string>();
  let ok = true;
  raw.forEach((g, gi) => {
    if (!isPlainObject(g)) {
      issues.push(issue(`groups[${gi}]`, "group.invalid", "each group must be an object"));
      ok = false;
      return;
    }
    const name = nonBlank(g.name);
    if (name === null) {
      issues.push(issue(`groups[${gi}].name`, "name.blank", "top-level group name is required and must be non-blank"));
      ok = false;
      return;
    }
    if (topSeen.has(name)) {
      issues.push(issue(`groups[${gi}].name`, "group.duplicateTop", "duplicate top-level group name within the offering"));
      ok = false;
    } else {
      topSeen.add(name);
    }
    const subgroups: { name: string }[] = [];
    const rawSubs = g.subgroups;
    if (rawSubs !== undefined && rawSubs !== null) {
      if (!Array.isArray(rawSubs)) {
        issues.push(issue(`groups[${gi}].subgroups`, "subgroups.notArray", "subgroups must be an array when present"));
        ok = false;
      } else {
        const childSeen = new Set<string>();
        rawSubs.forEach((s, si) => {
          if (!isPlainObject(s)) {
            issues.push(issue(`groups[${gi}].subgroups[${si}]`, "subgroup.invalid", "each subgroup must be an object"));
            ok = false;
            return;
          }
          const subName = nonBlank(s.name);
          if (subName === null) {
            issues.push(issue(`groups[${gi}].subgroups[${si}].name`, "name.blank", "subgroup name is required and must be non-blank"));
            ok = false;
            return;
          }
          if (childSeen.has(subName)) {
            issues.push(
              issue(
                `groups[${gi}].subgroups[${si}].name`,
                "subgroup.duplicateUnderParent",
                "duplicate subgroup name under the same parent group",
              ),
            );
            ok = false;
          } else {
            childSeen.add(subName);
            subgroups.push({ name: subName });
          }
        });
      }
    }
    if (name !== null) {
      out.push({ name, subgroups });
    }
  });
  return ok ? out : null;
}

function validateCapabilities(raw: unknown, issues: ValidationIssue[]): NormalizedBootstrapConfig["capabilities"] | null {
  if (!Array.isArray(raw)) {
    issues.push(issue("capabilities", "capabilities.notArray", "capabilities must be an array"));
    return null;
  }
  const out: { key: string; label: string; isActive: boolean; offeringStatus: OfferingCapabilityStatus }[] = [];
  const keySeen = new Set<string>();
  let ok = true;
  raw.forEach((c, ci) => {
    if (!isPlainObject(c)) {
      issues.push(issue(`capabilities[${ci}]`, "capability.invalid", "each capability must be an object"));
      ok = false;
      return;
    }
    const key = nonBlank(c.key);
    if (key === null) {
      issues.push(issue(`capabilities[${ci}].key`, "key.blank", "capability key is required and must be non-blank"));
      ok = false;
    }
    const label = nonBlank(c.label);
    if (label === null) {
      issues.push(issue(`capabilities[${ci}].label`, "label.blank", "capability label is required and must be non-blank"));
      ok = false;
    }
    if (typeof c.isActive !== "boolean") {
      issues.push(issue(`capabilities[${ci}].isActive`, "isActive.notBoolean", "capability isActive is required and must be an explicit boolean"));
      ok = false;
    }
    if (!isOfferingCapabilityStatus(c.offeringStatus)) {
      issues.push(
        issue(
          `capabilities[${ci}].offeringStatus`,
          "offeringStatus.invalid",
          "capability offeringStatus is required and must be ENABLED | READ_ONLY (never defaulted)",
        ),
      );
      ok = false;
    }
    if (key !== null) {
      if (keySeen.has(key)) {
        issues.push(issue(`capabilities[${ci}].key`, "capability.duplicateKey", "duplicate capability key"));
        ok = false;
      } else {
        keySeen.add(key);
      }
    }
    if (
      key !== null &&
      label !== null &&
      typeof c.isActive === "boolean" &&
      isOfferingCapabilityStatus(c.offeringStatus)
    ) {
      out.push({ key, label, isActive: c.isActive, offeringStatus: c.offeringStatus });
    }
  });
  return ok ? out : null;
}

/**
 * Parse + validate an already-supplied unknown value into a NormalizedBootstrap
 * Config, or return a flat list of typed, redacted issues. No I/O, no env, no
 * clock. Absence of a capability from the list means "not enabled for the
 * offering" — never an implicit ENABLED.
 */
export function parseBootstrapConfig(raw: unknown): ParseConfigResult {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    return { ok: false, issues: [issue("config", "config.notObject", "bootstrap config must be an object")] };
  }
  const activityYear = validateActivityYear(raw.activityYear, issues);
  const offering = validateOffering(raw.offering, issues);
  const groups = validateGroups(raw.groups, issues);
  const capabilities = validateCapabilities(raw.capabilities, issues);

  if (activityYear === null || offering === null || groups === null || capabilities === null || issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, config: { activityYear, offering, groups, capabilities } };
}

// ===========================================================================
// H — Pure creation plan (data only; deterministic logical refs)
// ===========================================================================

export const ACTIVITY_YEAR_REF = "activityYear" as const;
export const COURSE_OFFERING_REF = "courseOffering" as const;

export interface PlannedActivityYear {
  readonly ref: string;
  readonly name: string;
  readonly startDate: DateKey | null;
  readonly endDate: DateKey | null;
}

export interface PlannedCourseOffering {
  readonly ref: string;
  readonly activityYearRef: string;
  readonly name: string;
  readonly level: number;
  readonly startDate: DateKey;
  readonly endDate: DateKey;
  readonly status: OfferingStatus;
}

export interface PlannedCourseGroup {
  readonly ref: string;
  readonly courseOfferingRef: string;
  /** null for a top-level group; otherwise the parent group's logical ref. */
  readonly parentGroupRef: string | null;
  readonly name: string;
}

export interface PlannedCapabilityCatalogEntry {
  readonly ref: string;
  readonly key: string;
  readonly label: string;
  readonly isActive: boolean;
}

export interface PlannedOfferingCapability {
  readonly ref: string;
  readonly courseOfferingRef: string;
  readonly capabilityCatalogRef: string;
  readonly capabilityKey: string;
  readonly status: OfferingCapabilityStatus;
}

export type PlanEntity =
  | "ActivityYear"
  | "CourseOffering"
  | "CourseGroup"
  | "CapabilityCatalog"
  | "CourseOfferingCapability";

export interface BootstrapPlanStep {
  readonly order: number;
  readonly entity: PlanEntity;
  readonly ref: string;
  readonly dependsOn: readonly string[];
}

export interface BootstrapCreationPlan {
  readonly activityYear: PlannedActivityYear;
  readonly courseOffering: PlannedCourseOffering;
  readonly courseGroups: readonly PlannedCourseGroup[];
  readonly capabilityCatalog: readonly PlannedCapabilityCatalogEntry[];
  readonly offeringCapabilities: readonly PlannedOfferingCapability[];
  /** Safe dependency-ordered step list for a future S2 executor. */
  readonly steps: readonly BootstrapPlanStep[];
}

function topGroupRef(gi: number): string {
  return `group:${gi}`;
}
function subGroupRef(gi: number, si: number): string {
  return `group:${gi}/sub:${si}`;
}
function catalogRef(key: string): string {
  return `catalog:${key}`;
}
function offeringCapRef(key: string): string {
  return `offeringCapability:${key}`;
}

/**
 * Build the deterministic structural creation plan from a NORMALIZED config.
 * PURE and referentially transparent: identical input yields deeply-equal
 * output (no clock, no randomness, no generated cuid — only positional logical
 * refs). Contains no SQL, no Prisma calls, no secrets, no personal/operational
 * data, and no CourseSettings/DutyType/AdminEmail entries.
 *
 * Dependency order (also encoded per-step in `steps`):
 *   1. ActivityYear
 *   2. CourseOffering            (depends on ActivityYear)
 *   3. top-level CourseGroups    (depend on CourseOffering)
 *   4. subgroup CourseGroups     (depend on CourseOffering + parent group)
 *   5. CapabilityCatalog entries (independent — dependsOn [])
 *   6. CourseOfferingCapability  (depends on CourseOffering + its catalog row)
 */
export function buildBootstrapPlan(config: NormalizedBootstrapConfig): BootstrapCreationPlan {
  const activityYear: PlannedActivityYear = {
    ref: ACTIVITY_YEAR_REF,
    name: config.activityYear.name,
    startDate: config.activityYear.startDate,
    endDate: config.activityYear.endDate,
  };

  const courseOffering: PlannedCourseOffering = {
    ref: COURSE_OFFERING_REF,
    activityYearRef: ACTIVITY_YEAR_REF,
    name: config.offering.name,
    level: config.offering.level,
    startDate: config.offering.startDate,
    endDate: config.offering.endDate,
    status: config.offering.status,
  };

  const courseGroups: PlannedCourseGroup[] = [];
  const steps: BootstrapPlanStep[] = [];
  let order = 0;

  steps.push({ order: order++, entity: "ActivityYear", ref: activityYear.ref, dependsOn: [] });
  steps.push({ order: order++, entity: "CourseOffering", ref: courseOffering.ref, dependsOn: [activityYear.ref] });

  // Top-level groups first (parents), then subgroups (need their parent ref).
  config.groups.forEach((g, gi) => {
    const ref = topGroupRef(gi);
    courseGroups.push({ ref, courseOfferingRef: COURSE_OFFERING_REF, parentGroupRef: null, name: g.name });
    steps.push({ order: order++, entity: "CourseGroup", ref, dependsOn: [COURSE_OFFERING_REF] });
  });
  config.groups.forEach((g, gi) => {
    const parentRef = topGroupRef(gi);
    g.subgroups.forEach((s, si) => {
      const ref = subGroupRef(gi, si);
      courseGroups.push({ ref, courseOfferingRef: COURSE_OFFERING_REF, parentGroupRef: parentRef, name: s.name });
      steps.push({ order: order++, entity: "CourseGroup", ref, dependsOn: [COURSE_OFFERING_REF, parentRef] });
    });
  });

  // Capability catalog entries (independent of the offering/group chain).
  const capabilityCatalog: PlannedCapabilityCatalogEntry[] = config.capabilities.map((c) => ({
    ref: catalogRef(c.key),
    key: c.key,
    label: c.label,
    isActive: c.isActive,
  }));
  capabilityCatalog.forEach((entry) => {
    steps.push({ order: order++, entity: "CapabilityCatalog", ref: entry.ref, dependsOn: [] });
  });

  // Offering-capability rows (need offering + the catalog row for the key).
  const offeringCapabilities: PlannedOfferingCapability[] = config.capabilities.map((c) => ({
    ref: offeringCapRef(c.key),
    courseOfferingRef: COURSE_OFFERING_REF,
    capabilityCatalogRef: catalogRef(c.key),
    capabilityKey: c.key,
    status: c.offeringStatus,
  }));
  offeringCapabilities.forEach((oc) => {
    steps.push({
      order: order++,
      entity: "CourseOfferingCapability",
      ref: oc.ref,
      dependsOn: [COURSE_OFFERING_REF, oc.capabilityCatalogRef],
    });
  });

  return { activityYear, courseOffering, courseGroups, capabilityCatalog, offeringCapabilities, steps };
}

// ===========================================================================
// Top-level compose: target-safety + config -> plan (pure)
// ===========================================================================

export type IsolatedBootstrapPlanResult =
  | {
      readonly ok: true;
      readonly target: Extract<TargetSafetyDecision, { kind: "allowed" }>;
      readonly plan: BootstrapCreationPlan;
    }
  | { readonly ok: false; readonly reason: "target"; readonly target: TargetSafetyDecision }
  | { readonly ok: false; readonly reason: "config"; readonly issues: readonly ValidationIssue[] };

/**
 * Compose the pure pipeline: reject an unsafe target FIRST (fail fast), then
 * parse/validate the config, then build the deterministic plan. No I/O.
 */
export function planIsolatedInstanceBootstrap(
  rawConfig: unknown,
  target: TargetMetadata,
): IsolatedBootstrapPlanResult {
  const safety = decideTargetSafety(target);
  if (safety.kind !== "allowed") {
    return { ok: false, reason: "target", target: safety };
  }
  const parsed = parseBootstrapConfig(rawConfig);
  if (!parsed.ok) {
    return { ok: false, reason: "config", issues: parsed.issues };
  }
  return { ok: true, target: safety, plan: buildBootstrapPlan(parsed.config) };
}

// ===========================================================================
// G — Pure structural conflict classification (from supplied observed state)
// ===========================================================================

/** ABSENT: safe for a future S2 create. EXACT_REUSE: safe rerun no-op. CONFLICT: S2 must STOP. */
export type ConflictClass = "ABSENT" | "EXACT_REUSE" | "CONFLICT";

export interface ConflictResult {
  readonly class: ConflictClass;
  readonly issues: readonly ValidationIssue[];
}

function absent(): ConflictResult {
  return { class: "ABSENT", issues: [] };
}
function reuse(): ConflictResult {
  return { class: "EXACT_REUSE", issues: [] };
}
function conflict(path: string, code: string, message: string): ConflictResult {
  return { class: "CONFLICT", issues: [issue(path, code, message)] };
}

/** Observed rows are supplied by S2; kept minimal and PII-free. */
export interface ObservedActivityYear {
  readonly name: string;
  readonly startDate: DateKey | null;
  readonly endDate: DateKey | null;
}
export interface ObservedCourseOffering {
  readonly name: string;
  readonly level: number;
  readonly startDate: DateKey | null;
  readonly endDate: DateKey | null;
  readonly status: OfferingStatus;
  readonly activityYearName: string;
}
export interface ObservedCourseGroup {
  readonly name: string;
  /** null for a top-level group; otherwise the parent group's name. */
  readonly parentName: string | null;
}
export interface ObservedCapabilityCatalog {
  readonly key: string;
  readonly label: string;
  readonly isActive: boolean;
}
export interface ObservedOfferingCapability {
  readonly key: string;
  readonly status: OfferingCapabilityStatus;
}
export interface ObservedCourseSettings {
  readonly id: number;
  readonly startDate: DateKey;
  readonly endDate: DateKey;
}

/**
 * ActivityYear: absent -> ABSENT; exact match on (name, dates) -> EXACT_REUSE;
 * a same-named year with different dates, or any other divergence -> CONFLICT.
 * Never plans an update.
 */
export function classifyActivityYear(
  planned: PlannedActivityYear,
  observed: ObservedActivityYear | null,
): ConflictResult {
  if (observed === null) return absent();
  if (observed.name !== planned.name) {
    return conflict("activityYear.name", "activityYear.conflict", "an unexpected ActivityYear exists");
  }
  if (observed.startDate !== planned.startDate || observed.endDate !== planned.endDate) {
    return conflict("activityYear.dates", "activityYear.conflict", "existing ActivityYear dates differ from planned");
  }
  return reuse();
}

/**
 * CourseOffering: zero offerings -> ABSENT (initial create allowed); exactly one
 * fully-matching offering -> EXACT_REUSE (rerun); a single differing offering,
 * OR more than one offering, -> CONFLICT. Differences in name/level/dates/status/
 * ActivityYear relationship are all conflicts. (S1 only classifies supplied
 * state; S2 still enforces the hard zero-offerings precondition before apply.)
 */
export function classifyCourseOffering(
  planned: PlannedCourseOffering,
  plannedActivityYearName: string,
  observed: readonly ObservedCourseOffering[],
): ConflictResult {
  if (observed.length === 0) return absent();
  if (observed.length > 1) {
    return conflict("courseOffering", "offering.multiple", "more than one CourseOffering exists");
  }
  const o = observed[0];
  if (
    o.name !== planned.name ||
    o.level !== planned.level ||
    o.startDate !== planned.startDate ||
    o.endDate !== planned.endDate ||
    o.status !== planned.status ||
    o.activityYearName !== plannedActivityYearName
  ) {
    return conflict("courseOffering", "offering.conflict", "existing CourseOffering differs from planned");
  }
  return reuse();
}

function groupKey(name: string, parentName: string | null): string {
  // Parent length-prefixed ("N:parentName") so a free-text name can never forge
  // the parent/child boundary; the explicit printable "|" is the intentional,
  // human-readable delimiter. Injectivity comes from the length prefix (a
  // top-level key begins with "|", a subgroup key begins with a digit), so the
  // separator char is irrelevant to correctness as long as it is applied
  // identically to planned and observed groups (it is). Deterministic and
  // order-independent by construction.
  const parent = parentName === null ? "" : `${parentName.length}:${parentName}`;
  return `${parent}|${name}`;
}

/**
 * CourseGroup hierarchy: EXACT_REUSE only when the observed set equals the
 * planned set exactly (same top-level names, same child-under-parent names).
 * Empty observed -> ABSENT. Any missing/partial/extra/changed-parent state ->
 * CONFLICT (never an auto-fill of missing groups).
 */
export function classifyCourseGroups(
  plannedGroups: readonly PlannedCourseGroup[],
  observed: readonly ObservedCourseGroup[],
): ConflictResult {
  if (observed.length === 0) return absent();

  const plannedByRef = new Map<string, PlannedCourseGroup>();
  for (const g of plannedGroups) plannedByRef.set(g.ref, g);
  const nameByRef = (ref: string): string => plannedByRef.get(ref)?.name ?? "";

  const plannedKeys = new Set<string>();
  for (const g of plannedGroups) {
    const parentName = g.parentGroupRef === null ? null : nameByRef(g.parentGroupRef);
    plannedKeys.add(groupKey(g.name, parentName));
  }

  const observedKeys = new Set<string>();
  for (const g of observed) observedKeys.add(groupKey(g.name, g.parentName));

  if (observedKeys.size !== observed.length) {
    return conflict("courseGroups", "groups.duplicateObserved", "observed groups contain duplicates");
  }

  let missing = 0;
  let extra = 0;
  for (const k of plannedKeys) if (!observedKeys.has(k)) missing++;
  for (const k of observedKeys) if (!plannedKeys.has(k)) extra++;

  if (missing === 0 && extra === 0 && plannedKeys.size === observedKeys.size) {
    return reuse();
  }
  return conflict("courseGroups", "groups.conflict", "observed group hierarchy differs from planned (partial/extra/changed)");
}

/**
 * Capability state (catalog + offering rows): EXACT_REUSE only when both the
 * catalog entries and the offering-capability rows match the plan exactly (keys,
 * labels, isActive, offering status). Empty observed on both -> ABSENT. Partial
 * or divergent state -> CONFLICT. Never calls capability-admin.
 */
export function classifyCapabilities(
  plannedCatalog: readonly PlannedCapabilityCatalogEntry[],
  plannedOfferingCaps: readonly PlannedOfferingCapability[],
  observedCatalog: readonly ObservedCapabilityCatalog[],
  observedOfferingCaps: readonly ObservedOfferingCapability[],
): ConflictResult {
  if (observedCatalog.length === 0 && observedOfferingCaps.length === 0) return absent();

  // Catalog exact-match.
  const plannedCatByKey = new Map(plannedCatalog.map((c) => [c.key, c]));
  const observedCatByKey = new Map<string, ObservedCapabilityCatalog>();
  for (const c of observedCatalog) {
    if (observedCatByKey.has(c.key)) {
      return conflict("capabilityCatalog", "catalog.duplicateObserved", "observed catalog contains duplicate keys");
    }
    observedCatByKey.set(c.key, c);
  }
  if (plannedCatByKey.size !== observedCatByKey.size) {
    return conflict("capabilityCatalog", "catalog.conflict", "observed catalog set differs from planned");
  }
  for (const [key, planned] of plannedCatByKey) {
    const obs = observedCatByKey.get(key);
    if (!obs || obs.label !== planned.label || obs.isActive !== planned.isActive) {
      return conflict("capabilityCatalog", "catalog.conflict", "observed catalog entry differs from planned");
    }
  }

  // Offering-capability exact-match.
  const plannedOcByKey = new Map(plannedOfferingCaps.map((o) => [o.capabilityKey, o]));
  const observedOcByKey = new Map<string, ObservedOfferingCapability>();
  for (const o of observedOfferingCaps) {
    if (observedOcByKey.has(o.key)) {
      return conflict("offeringCapabilities", "offeringCap.duplicateObserved", "observed offering capabilities contain duplicate keys");
    }
    observedOcByKey.set(o.key, o);
  }
  if (plannedOcByKey.size !== observedOcByKey.size) {
    return conflict("offeringCapabilities", "offeringCap.conflict", "observed offering-capability set differs from planned");
  }
  for (const [key, planned] of plannedOcByKey) {
    const obs = observedOcByKey.get(key);
    if (!obs || obs.status !== planned.status) {
      return conflict("offeringCapabilities", "offeringCap.conflict", "observed offering-capability status differs from planned");
    }
  }

  return reuse();
}

/**
 * GENERIC CourseSettings singleton classifier — used ONLY to prove that a
 * divergent singleton is classified as CONFLICT. S1 produces NO CourseSettings
 * create-plan and NEVER an update plan: absent -> ABSENT, exact id=1/date match
 * -> EXACT_REUSE, different dates or any unexpected additional row -> CONFLICT.
 */
export function classifyCourseSettingsSingleton(
  expected: { readonly startDate: DateKey; readonly endDate: DateKey },
  observed: readonly ObservedCourseSettings[],
): ConflictResult {
  if (observed.length === 0) return absent();
  if (observed.length > 1) {
    return conflict("courseSettings", "courseSettings.multiple", "unexpected additional CourseSettings rows exist");
  }
  const row = observed[0];
  if (row.id !== 1) {
    return conflict("courseSettings.id", "courseSettings.conflict", "CourseSettings row is not the id=1 singleton");
  }
  if (row.startDate !== expected.startDate || row.endDate !== expected.endDate) {
    return conflict("courseSettings.dates", "courseSettings.conflict", "existing CourseSettings dates differ (no update is planned)");
  }
  return reuse();
}

// ===========================================================================
// D — ActivityYear cardinality-aware classifier
// ===========================================================================

/**
 * Cardinality-aware ActivityYear classification over the FULL supplied observed
 * set — it never silently selects one row from an array:
 *  - 0 rows                  -> ABSENT
 *  - exactly 1 matching row  -> EXACT_REUSE (delegates to classifyActivityYear)
 *  - exactly 1 differing row -> CONFLICT
 *  - >1 rows                 -> CONFLICT (activityYear.multiple)
 * The single-record classifyActivityYear is retained for its focused comparison;
 * this wrapper is what the aggregate decision uses so no caller must count rows
 * separately.
 */
export function classifyActivityYearCardinality(
  planned: PlannedActivityYear,
  observed: readonly ObservedActivityYear[],
): ConflictResult {
  if (observed.length === 0) return absent();
  if (observed.length > 1) {
    return conflict("activityYear", "activityYear.multiple", "more than one ActivityYear exists");
  }
  return classifyActivityYear(planned, observed[0]);
}

// ===========================================================================
// E — Aggregate observed structural state (already-supplied data only)
// ===========================================================================

/**
 * The minimal, PII-free structural snapshot a future S2 runner maps its live
 * reads into. It carries ONLY the five structural areas the entity classifiers
 * consume — deliberately no Prisma types, no DB clients, no opaque row ids, and
 * no CourseSettings/DutyType/AdminEmail/operational/auth/Storage/secret data.
 */
export interface ObservedStructuralState {
  readonly activityYears: readonly ObservedActivityYear[];
  readonly courseOfferings: readonly ObservedCourseOffering[];
  readonly courseGroups: readonly ObservedCourseGroup[];
  readonly capabilityCatalog: readonly ObservedCapabilityCatalog[];
  readonly offeringCapabilities: readonly ObservedOfferingCapability[];
}

// ===========================================================================
// C — Aggregate whole-bootstrap safety decision (pure)
// ===========================================================================

/** Typed reason for a STOP: a hard entity conflict, or an unsafe absent/reuse mix. */
export type AggregateStopReason = "ENTITY_CONFLICT" | "MIXED_ABSENT_AND_REUSE";

export type AggregateBootstrapDecision =
  | { readonly kind: "INITIAL_APPLY_ALLOWED" }
  | { readonly kind: "EXACT_RERUN_NOOP" }
  | {
      readonly kind: "STOP_CONFLICT";
      readonly reason: AggregateStopReason;
      readonly issues: readonly ValidationIssue[];
    };

/** Per-area classification, incl. VACUOUS (nothing planned AND nothing observed). */
type AreaClass = "ABSENT" | "EXACT_REUSE" | "CONFLICT" | "VACUOUS";

interface AreaOutcome {
  readonly area: string;
  readonly klass: AreaClass;
  readonly result: ConflictResult;
}

/**
 * Combine the per-entity classifiers into ONE typed whole-bootstrap decision, so
 * the aggregate safety policy lives in pure S1 rather than being reimplemented
 * in S2. PURE: reads only the supplied plan + observed state, mutates neither,
 * performs no I/O.
 *
 * Contract for S2: perform NO writes unless this returns INITIAL_APPLY_ALLOWED.
 * EXACT_RERUN_NOOP means "already fully in place — write nothing". STOP_CONFLICT
 * means "stop".
 *
 * Decision rules:
 *  - ANY entity CONFLICT (incl. >1 ActivityYear, >1 CourseOffering, a differing
 *    offering, partial/extra/changed groups, partial/divergent capabilities,
 *    an offering-capability set that does not match its catalog) ->
 *    STOP_CONFLICT / ENTITY_CONFLICT.
 *  - every required area ABSENT      -> INITIAL_APPLY_ALLOWED.
 *  - every required area EXACT_REUSE  -> EXACT_RERUN_NOOP.
 *  - any ABSENT + EXACT_REUSE mix     -> STOP_CONFLICT / MIXED_ABSENT_AND_REUSE
 *    (covers "an offering without its complete dependencies" and "reused rows
 *    while another required area is absent").
 *
 * A capability area with NOTHING planned and NOTHING observed is VACUOUS and
 * casts no vote, so an intentionally capability-less plan can still rerun
 * cleanly; an empty-planned capability area with unexpected observed rows is
 * already CONFLICT via classifyCapabilities. ActivityYear/CourseOffering/
 * CourseGroups are always planned, so at least those three always vote.
 */
export function classifyAggregateBootstrapState(
  plan: BootstrapCreationPlan,
  observed: ObservedStructuralState,
): AggregateBootstrapDecision {
  const outcomes: AreaOutcome[] = [];

  const yearRes = classifyActivityYearCardinality(plan.activityYear, observed.activityYears);
  outcomes.push({ area: "activityYear", klass: yearRes.class, result: yearRes });

  const offeringRes = classifyCourseOffering(
    plan.courseOffering,
    plan.activityYear.name,
    observed.courseOfferings,
  );
  outcomes.push({ area: "courseOffering", klass: offeringRes.class, result: offeringRes });

  const groupsRes = classifyCourseGroups(plan.courseGroups, observed.courseGroups);
  outcomes.push({ area: "courseGroups", klass: groupsRes.class, result: groupsRes });

  const capsPlannedEmpty = plan.capabilityCatalog.length === 0 && plan.offeringCapabilities.length === 0;
  const capsObservedEmpty = observed.capabilityCatalog.length === 0 && observed.offeringCapabilities.length === 0;
  const capsRes = classifyCapabilities(
    plan.capabilityCatalog,
    plan.offeringCapabilities,
    observed.capabilityCatalog,
    observed.offeringCapabilities,
  );
  const capsClass: AreaClass = capsPlannedEmpty && capsObservedEmpty ? "VACUOUS" : capsRes.class;
  outcomes.push({ area: "capabilities", klass: capsClass, result: capsRes });

  // 1) Any hard entity CONFLICT stops immediately.
  const conflicts = outcomes.filter((o) => o.klass === "CONFLICT");
  if (conflicts.length > 0) {
    return { kind: "STOP_CONFLICT", reason: "ENTITY_CONFLICT", issues: conflicts.flatMap((o) => o.result.issues) };
  }

  // 2) Vote over the non-vacuous areas (year/offering/groups always contribute).
  const votes = outcomes.filter((o) => o.klass !== "VACUOUS").map((o) => o.klass);
  if (votes.every((k) => k === "ABSENT")) return { kind: "INITIAL_APPLY_ALLOWED" };
  if (votes.every((k) => k === "EXACT_REUSE")) return { kind: "EXACT_RERUN_NOOP" };

  // 3) A mixture of ABSENT and EXACT_REUSE is unsafe. Report only counts (no values).
  const absentCount = outcomes.filter((o) => o.klass === "ABSENT").length;
  const reuseCount = outcomes.filter((o) => o.klass === "EXACT_REUSE").length;
  return {
    kind: "STOP_CONFLICT",
    reason: "MIXED_ABSENT_AND_REUSE",
    issues: [
      issue(
        "aggregate",
        "aggregate.mixed",
        `structural state mixes absent (${absentCount}) and reusable (${reuseCount}) areas; refuse to partially apply`,
      ),
    ],
  };
}
