/**
 * MC-BOOTSTRAP-S2B1 — PURE adapter primitives for the FUTURE isolated-instance
 * bootstrap runner. See MC-BOOTSTRAP-S2B-DESIGN and the S2B-DESIGN-CORRECTION
 * report.
 *
 * PURE + IMPORT-SAFE BY CONSTRUCTION. This module has: no Prisma runtime import,
 * no Prisma TYPE import, no generated-client import, no filesystem import, no
 * dotenv, no process.env / DATABASE_URL access, no PrismaClient, no DB
 * connection, no network, no logging, no command execution, no top-level side
 * effect, no automatic execution, and no global-state mutation. Importing it
 * runs nothing.
 *
 * SCOPE (S2B1 only): (1) repository-owned synthetic persisted-row interfaces
 * describing exactly the fields a future Prisma `select` will return; (2) one
 * pure mapper that flattens those rows into the EXACT committed S1
 * `ObservedStructuralState` WITHOUT filtering, scoping, sorting, or classifying;
 * (3) the two date-only conversion helpers (UTC calendar only); (4) one strict,
 * fail-closed Supabase project-ref parser. It performs NO live read/write, NO
 * target-safety/production policy (S1 owns that), and constructs NO client.
 *
 * The date-only validity contract is the single committed one
 * (`isValidDateKey`, lib/trainee-history/interval-resolver) — deliberately not a
 * second, divergent policy. S1 remains the sole classification and target-safety
 * authority; this module only shapes already-supplied data.
 */
import { isValidDateKey, type DateKey } from "../lib/trainee-history/interval-resolver";
import type {
  ObservedStructuralState,
  ObservedActivityYear,
  ObservedCourseOffering,
  ObservedCourseGroup,
  ObservedCapabilityCatalog,
  ObservedOfferingCapability,
  OfferingStatus,
  OfferingCapabilityStatus,
} from "./bootstrap-isolated-instance.plan";

// ===========================================================================
// C — Synthetic persisted-row interfaces.
//
// These mirror ONLY the bounded fields a future Prisma `select` will return —
// never a broad model shape, never a database id "for later use". Enum fields
// are typed with the committed S1 union so no coercion is required to map them.
// ===========================================================================

/** A future `activityYear.findMany({ select:{ name,startDate,endDate } })` row. */
export interface ActivityYearRow {
  readonly name: string;
  /** @db.Date value as Prisma returns it (UTC-midnight Date), or null. */
  readonly startDate: Date | null;
  readonly endDate: Date | null;
}

/**
 * A future `courseOffering.findMany({ select:{ name,level,startDate,endDate,
 * status, activityYear:{ select:{ name } } } })` row.
 */
export interface CourseOfferingRow {
  readonly name: string;
  readonly level: number;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
  readonly status: OfferingStatus;
  readonly activityYear: { readonly name: string };
}

/**
 * A future `courseGroup.findMany({ select:{ name, parentGroup:{ select:{ name }
 * } } })` row. `parentGroup` is null for a top-level group.
 */
export interface CourseGroupRow {
  readonly name: string;
  readonly parentGroup: { readonly name: string } | null;
}

/** A future `capabilityCatalog.findMany({ select:{ key,label,isActive } })` row. */
export interface CapabilityCatalogRow {
  readonly key: string;
  readonly label: string;
  readonly isActive: boolean;
}

/**
 * A future `courseOfferingCapability.findMany({ select:{ capabilityKey,status }
 * })` row. Note the persisted column is `capabilityKey`; S1's observed shape
 * calls it `key` (mapped below).
 */
export interface CourseOfferingCapabilityRow {
  readonly capabilityKey: string;
  readonly status: OfferingCapabilityStatus;
}

/**
 * The complete set of already-read structural rows. The five collections are
 * WHOLE-DATABASE and UNFILTERED (no offering scoping) — exactly what S1 expects
 * to classify (see S2B-DESIGN-CORRECTION §5–§7).
 */
export interface StructuralRows {
  readonly activityYears: readonly ActivityYearRow[];
  readonly courseOfferings: readonly CourseOfferingRow[];
  readonly courseGroups: readonly CourseGroupRow[];
  readonly capabilityCatalog: readonly CapabilityCatalogRow[];
  readonly offeringCapabilities: readonly CourseOfferingCapabilityRow[];
}

// ===========================================================================
// E — Date-only helpers (UTC calendar components only).
//
// Contract: a @db.Date value is a UTC-midnight Date; its CALENDAR date is its
// UTC year/month/day. `dbDateToKey` reads only getUTC* components, so it is
// independent of locale and machine timezone and never uses the current time;
// a non-midnight Date is projected to its UTC calendar day BY DESIGN. Any Date
// that does not project to a valid YYYY-MM-DD key (e.g. an Invalid Date) fails
// predictably rather than silently normalizing. The reverse builds a Date at
// exactly UTC midnight from a validated key.
// ===========================================================================

/** Format a Date's UTC calendar components as a validated `YYYY-MM-DD` key. */
export function dbDateToKey(date: Date): DateKey {
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  const key = `${y}-${m}-${d}`;
  if (!isValidDateKey(key)) {
    // Predictable failure — never a silent normalization. No value is echoed.
    throw new Error("dbDateToKey: Date does not project to a valid YYYY-MM-DD UTC calendar key");
  }
  return key;
}

/** Build a Date at exactly UTC midnight from a validated `YYYY-MM-DD` key. */
export function dateKeyToDbDate(key: DateKey): Date {
  if (!isValidDateKey(key)) {
    throw new Error("dateKeyToDbDate: expected a valid YYYY-MM-DD DateKey");
  }
  return new Date(`${key}T00:00:00.000Z`);
}

/** Map an optional @db.Date value to an optional DateKey (null passes through). */
function optionalDateToKey(date: Date | null): DateKey | null {
  return date === null ? null : dbDateToKey(date);
}

// ===========================================================================
// D — Complete observed-state mapper (pure; unfiltered; non-classifying).
//
// Every row is preserved (no collection is filtered, deduped, or scoped to an
// offering), input order is preserved (no sort), relation names are flattened
// exactly as S1's observed types require, and NO missing/reusable/conflict
// decision is made here — S1 is the sole classifier. `.map` allocates fresh
// arrays and objects, so neither the input arrays nor the row objects are
// mutated.
// ===========================================================================

function mapActivityYear(row: ActivityYearRow): ObservedActivityYear {
  return {
    name: row.name,
    startDate: optionalDateToKey(row.startDate),
    endDate: optionalDateToKey(row.endDate),
  };
}

function mapCourseOffering(row: CourseOfferingRow): ObservedCourseOffering {
  return {
    name: row.name,
    level: row.level,
    startDate: optionalDateToKey(row.startDate),
    endDate: optionalDateToKey(row.endDate),
    status: row.status,
    activityYearName: row.activityYear.name,
  };
}

function mapCourseGroup(row: CourseGroupRow): ObservedCourseGroup {
  return {
    name: row.name,
    parentName: row.parentGroup === null ? null : row.parentGroup.name,
  };
}

function mapCapabilityCatalog(row: CapabilityCatalogRow): ObservedCapabilityCatalog {
  return { key: row.key, label: row.label, isActive: row.isActive };
}

function mapOfferingCapability(row: CourseOfferingCapabilityRow): ObservedOfferingCapability {
  return { key: row.capabilityKey, status: row.status };
}

/**
 * Map already-read structural rows into the exact committed S1
 * `ObservedStructuralState`. PURE and deterministic: identical input yields a
 * deeply-equal result. Preserves EVERY row in EVERY collection, in input order;
 * performs no filtering, scoping, sorting, or classification.
 */
export function mapObservedStructuralState(rows: StructuralRows): ObservedStructuralState {
  return {
    activityYears: rows.activityYears.map(mapActivityYear),
    courseOfferings: rows.courseOfferings.map(mapCourseOffering),
    courseGroups: rows.courseGroups.map(mapCourseGroup),
    capabilityCatalog: rows.capabilityCatalog.map(mapCapabilityCatalog),
    offeringCapabilities: rows.offeringCapabilities.map(mapOfferingCapability),
  };
}

// ===========================================================================
// F — Strict, fail-closed Supabase project-ref parser.
//
// Recognizes ONLY two explicitly supported connection-metadata shapes using
// parsed URL components (never a raw-string search). Everything else — every
// malformed, unsupported, ambiguous, or lookalike form — returns
// { detectedProjectRef: null }. It NEVER throws to its caller, NEVER extracts a
// ref from the password/query/path/fragment or an arbitrary hostname label,
// NEVER uses a "first label" fallback, and holds NO production-ref/production
// policy: it yields a strict opaque ref or null, and S1's decideTargetSafety
// remains solely responsible for target-safety and production denial. The
// permissive `identifyDbTarget` helper is deliberately NOT imported or reused.
// ===========================================================================

/** A strict project-ref: exactly 20 lowercase alphanumerics, or nothing. */
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

/** The only accepted pooled base domain (as an exact dotted suffix). */
const POOLER_SUFFIX = ".pooler.supabase.com";

/** The bounded result: a strictly derived opaque ref, or null (unavailable). */
export interface DetectedTargetRef {
  readonly detectedProjectRef: string | null;
}

const UNAVAILABLE: DetectedTargetRef = { detectedProjectRef: null };

/** Direct form: hostname EXACTLY `db.<ref>.supabase.co`. */
function directProjectRef(hostname: string): string | null {
  const labels = hostname.split(".");
  if (labels.length !== 4) return null;
  if (labels[0] !== "db" || labels[2] !== "supabase" || labels[3] !== "co") return null;
  const ref = labels[1];
  return PROJECT_REF_PATTERN.test(ref) ? ref : null;
}

/**
 * Pooled form: hostname is a non-empty subdomain of `pooler.supabase.com` AND
 * the username is EXACTLY `postgres.<ref>`.
 */
function pooledProjectRef(hostname: string, username: string): string | null {
  if (!hostname.endsWith(POOLER_SUFFIX)) return null;
  const subdomain = hostname.slice(0, hostname.length - POOLER_SUFFIX.length);
  // Require a real, non-empty subdomain label group (never the bare base domain,
  // never a leading/trailing dot).
  if (subdomain.length === 0 || subdomain.startsWith(".") || subdomain.endsWith(".")) {
    return null;
  }
  const parts = username.split(".");
  if (parts.length !== 2 || parts[0] !== "postgres") return null;
  const ref = parts[1];
  return PROJECT_REF_PATTERN.test(ref) ? ref : null;
}

/**
 * Strictly derive the Supabase project ref from connection metadata, or return
 * { detectedProjectRef: null } for anything not explicitly supported. Never
 * throws.
 */
export function parseSupabaseProjectRef(connectionMetadata: string): DetectedTargetRef {
  if (typeof connectionMetadata !== "string") return UNAVAILABLE;

  let url: URL;
  try {
    url = new URL(connectionMetadata);
  } catch {
    return UNAVAILABLE;
  }

  // Require PostgreSQL connection metadata.
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return UNAVAILABLE;

  const hostname = url.hostname;
  if (hostname.length === 0) return UNAVAILABLE;

  const direct = directProjectRef(hostname);
  if (direct !== null) return { detectedProjectRef: direct };

  const pooled = pooledProjectRef(hostname, url.username);
  if (pooled !== null) return { detectedProjectRef: pooled };

  return UNAVAILABLE;
}
