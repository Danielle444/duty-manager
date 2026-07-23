/**
 * MULTI-COURSE W5C0 - narrow active-trainee DIRECTORY projection + read-only
 * loader for the availability / daily-tracking page contract.
 *
 * The legacy availability and daily-tracking pages both read the SAME shape:
 *
 *   prisma.student.findMany({
 *     where: { isActive: true },
 *     orderBy: { fullName: "asc" },
 *     select: { id, fullName, groupName, subgroupNumber },
 *   })
 *
 * This module rebuilds exactly that four-key row shape from the enrollment-backed
 * current-course roster (W5B0 DAL) so a later stage (W5C1) can swap the source
 * without changing either page's output. It is deliberately NARROWER than
 * EnrolledTraineeView: it exposes only id/fullName/groupName/subgroupNumber and
 * never lastName/phone/enrollmentStatus/isPrimary/identity/horse fields.
 *
 * SPLIT OF CONCERNS:
 *  - toActiveTraineeDirectoryRows / compareActiveTraineeDirectory are PURE (no
 *    Prisma, no DB, no clock, no randomness) and fully unit-tested.
 *  - loadActiveTraineeDirectoryWithDeps is dependency-injected pure orchestration
 *    (the offering resolver, the roster DAL, and the clock are all injected), so
 *    its execution order and single-asOf capture are unit-testable with fakes.
 *  - getActiveTraineeDirectory is the only IO entrypoint; it wires the real
 *    server-side resolver/DAL/clock into the injected orchestration.
 *
 * This file is server-only library code, NOT a Server Action: it has no "use
 * server" directive and no import-time side effects.
 *
 * NOTE: getActiveTraineeDirectory IS wired into its two runtime consumers -
 * app/admin/availability/page.tsx and app/admin/daily-tracking/page.tsx.
 */
import { resolveCurrentCourseOffering } from "./current-offering";
import { getCurrentCourseEnrollmentRoster } from "./current-enrollments";
import type { EnrollmentRosterResult } from "./enrollment-view";

/**
 * The exact row the availability / daily-tracking pages consume. Deliberately
 * only four keys - it must never grow into a general trainee view.
 */
export interface ActiveTraineeDirectoryRow {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

const HE_LOCALE = "he";

/** Deterministic final tie-breaker: student id ascending (byte order). */
function compareId(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Directory ordering, matching the page contract `orderBy: { fullName: "asc" }`:
 *   1. fullName ascending (Hebrew-aware, "he"), then
 *   2. student id ascending (deterministic tie-breaker for identical fullName).
 * Uses localeCompare("he") for consistency with the app's other Hebrew sorts;
 * see the ordering-observation note in the parity script for why this is only a
 * loose match with PostgreSQL collation.
 */
export function compareActiveTraineeDirectoryRow(
  a: ActiveTraineeDirectoryRow,
  b: ActiveTraineeDirectoryRow,
): number {
  return a.fullName.localeCompare(b.fullName, HE_LOCALE) || compareId(a.id, b.id);
}

/**
 * PURE projection from the enrollment roster to the narrow directory rows.
 *
 * Refuses (throws) rather than degrading:
 *  - ANY membership anomaly present in the roster -> throw (a trainee is never
 *    silently dropped, and there is no fallback to Student).
 *  - a duplicate student id among the rows -> throw (each trainee appears once).
 * Null group/subgroup values are preserved as-is. Rows are returned sorted by
 * fullName ascending with the student-id tie-breaker. All error messages are
 * PII-free: they carry only safe internal ids/kinds/counts, never fullName,
 * phone, or identity numbers.
 */
export function toActiveTraineeDirectoryRows(
  roster: EnrollmentRosterResult,
): ActiveTraineeDirectoryRow[] {
  if (roster.anomalies.length > 0) {
    const detail = roster.anomalies
      .map((a) => `${a.kind}(enrollmentId=${a.enrollmentId})`)
      .join(", ");
    throw new Error(
      `Active trainee directory refused: enrollment roster has ${roster.anomalies.length} ` +
        `membership anomaly(ies) [${detail}]; a trainee is never silently dropped and there ` +
        `is no fallback to Student.`,
    );
  }

  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  const rows: ActiveTraineeDirectoryRow[] = [];
  for (const row of roster.rows) {
    if (seen.has(row.id)) {
      duplicateIds.push(row.id);
      continue;
    }
    seen.add(row.id);
    // Narrow to exactly four keys - lastName / phone / enrollmentStatus /
    // isPrimary from EnrolledTraineeView are intentionally NOT copied.
    rows.push({
      id: row.id,
      fullName: row.fullName,
      groupName: row.groupName,
      subgroupNumber: row.subgroupNumber,
    });
  }

  if (duplicateIds.length > 0) {
    throw new Error(
      `Active trainee directory refused: duplicate student id(s) in enrollment roster ` +
        `[${duplicateIds.join(", ")}]; each trainee must appear exactly once.`,
    );
  }

  rows.sort(compareActiveTraineeDirectoryRow);
  return rows;
}

// --- dependency-injected read-only loader -----------------------------------

/**
 * The injectable server dependencies. Real wiring lives in
 * getActiveTraineeDirectory; tests pass fakes to observe execution order, the
 * single asOf capture, and error propagation without touching Prisma.
 */
export interface ActiveTraineeDirectoryDeps {
  resolveCurrentCourseOffering: () => Promise<{ id: string }>;
  getCurrentCourseEnrollmentRoster: (
    courseOfferingId: string,
    options: { asOf: Date },
  ) => Promise<EnrollmentRosterResult>;
  now: () => Date;
}

/**
 * Orchestrate the directory load in a fixed order:
 *   1. resolve the singleton current offering,
 *   2. capture ONE asOf,
 *   3. load the ACTIVE enrollment roster for that offering at that asOf,
 *   4. project to the narrow directory rows.
 * No client input, no courseOfferingId argument exposed to callers, no global
 * Student fallback. Resolver, roster, and projection errors all propagate
 * unchanged - there is no catch/fallback path.
 */
export async function loadActiveTraineeDirectoryWithDeps(
  deps: ActiveTraineeDirectoryDeps,
): Promise<ActiveTraineeDirectoryRow[]> {
  const offering = await deps.resolveCurrentCourseOffering();
  const asOf = deps.now();
  const roster = await deps.getCurrentCourseEnrollmentRoster(offering.id, { asOf });
  return toActiveTraineeDirectoryRows(roster);
}

/**
 * The single server-side IO entrypoint: resolve the current offering and load
 * its ACTIVE enrollment-backed directory at one captured server-time asOf. Takes
 * no arguments (the offering is resolved solely from the single-offering
 * invariant) and performs no Prisma query of its own - it reuses the W5B0 DAL.
 */
export function getActiveTraineeDirectory(): Promise<ActiveTraineeDirectoryRow[]> {
  return loadActiveTraineeDirectoryWithDeps({
    resolveCurrentCourseOffering,
    getCurrentCourseEnrollmentRoster,
    now: () => new Date(),
  });
}

// --- read-only directory parity comparison (pure) ---------------------------

/**
 * The legacy directory row as read from Student (isActive=true) in fullName
 * order. fullName is deliberately absent: the pure comparison compares positional
 * id order for the ordering observation, so fullName never enters this module and
 * can never be printed.
 */
export interface LegacyDirectoryRow {
  id: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

/** A structured, PII-free parity report for the four-key page contract. */
export interface ActiveDirectoryParityReport {
  ok: boolean;
  legacyCount: number;
  directoryCount: number;
  missingFromDirectory: string[];
  extraInDirectory: string[];
  duplicateLegacyIds: string[];
  duplicateDirectoryIds: string[];
  groupMismatches: string[];
  subgroupMismatches: string[];
  orderMismatch: boolean;
  orderFirstDivergenceIndex: number | null;
}

/**
 * Compare the legacy Student directory against the enrollment-backed directory.
 * PURE: no IO. `ok` is the HARD data-parity verdict - true only when the two
 * sources agree on count, id set, per-id group, and per-id subgroup, with no
 * duplicate ids on either side. It deliberately EXCLUDES orderMismatch: legacy
 * order comes from PostgreSQL collation while the directory is ordered by
 * JavaScript localeCompare("he"), and the two engines are not guaranteed to
 * produce identical Hebrew ordering, so a collation-only difference must not
 * classify otherwise-correct data as corrupt. Every reported detail is a safe
 * internal id (never fullName/phone/identity). Both inputs must already be in
 * their respective fullName-ascending order for the ordering observation to mean
 * anything.
 */
export function compareActiveTraineeDirectory(
  legacy: readonly LegacyDirectoryRow[],
  directory: readonly ActiveTraineeDirectoryRow[],
): ActiveDirectoryParityReport {
  const legacyById = new Map<string, LegacyDirectoryRow>();
  const duplicateLegacyIds: string[] = [];
  for (const row of legacy) {
    if (legacyById.has(row.id)) duplicateLegacyIds.push(row.id);
    else legacyById.set(row.id, row);
  }

  const directoryById = new Map<string, ActiveTraineeDirectoryRow>();
  const duplicateDirectoryIds: string[] = [];
  for (const row of directory) {
    if (directoryById.has(row.id)) duplicateDirectoryIds.push(row.id);
    else directoryById.set(row.id, row);
  }

  const missingFromDirectory: string[] = [];
  for (const id of legacyById.keys()) {
    if (!directoryById.has(id)) missingFromDirectory.push(id);
  }
  const extraInDirectory: string[] = [];
  for (const id of directoryById.keys()) {
    if (!legacyById.has(id)) extraInDirectory.push(id);
  }

  const groupMismatches: string[] = [];
  const subgroupMismatches: string[] = [];
  for (const [id, dir] of directoryById) {
    const legacyRow = legacyById.get(id);
    if (!legacyRow) continue; // reported via extraInDirectory
    if ((legacyRow.groupName ?? null) !== (dir.groupName ?? null)) {
      groupMismatches.push(id);
    }
    if ((legacyRow.subgroupNumber ?? null) !== (dir.subgroupNumber ?? null)) {
      subgroupMismatches.push(id);
    }
  }

  let orderMismatch = false;
  let orderFirstDivergenceIndex: number | null = null;
  const compared = Math.min(legacy.length, directory.length);
  for (let i = 0; i < compared; i++) {
    if (legacy[i].id !== directory[i].id) {
      orderMismatch = true;
      orderFirstDivergenceIndex = i;
      break;
    }
  }
  if (!orderMismatch && legacy.length !== directory.length) {
    orderMismatch = true;
    orderFirstDivergenceIndex = compared;
  }

  const ok =
    legacy.length === directory.length &&
    missingFromDirectory.length === 0 &&
    extraInDirectory.length === 0 &&
    duplicateLegacyIds.length === 0 &&
    duplicateDirectoryIds.length === 0 &&
    groupMismatches.length === 0 &&
    subgroupMismatches.length === 0;

  return {
    ok,
    legacyCount: legacy.length,
    directoryCount: directory.length,
    missingFromDirectory,
    extraInDirectory,
    duplicateLegacyIds,
    duplicateDirectoryIds,
    groupMismatches,
    subgroupMismatches,
    orderMismatch,
    orderFirstDivergenceIndex,
  };
}
