/**
 * MULTI-COURSE W5B1 - PURE, dependency-injected orchestration for the student
 * contact directory.
 *
 * This module is deliberately NOT a "use server" module: it is a plain
 * server-side library, so nothing here is registered as a Server Action. It
 * carries the testable orchestration (auth ordering + enrollment-backed roster
 * source + mapping/anomaly/duplicate guards) that the public server action in
 * ./contacts imports and wires to real dependencies.
 *
 * NO runtime side effects at import time, and NO Prisma / next-cookies import:
 * every impure capability (session actor, offering resolver, enrollment DAL,
 * clock) is passed in via {@link StudentContactsDeps}. The only runtime import is
 * the PURE audience-gate predicate; StudentContactRow and EnrollmentRosterResult
 * are erased `import type`s (the former's single source of truth is ./contacts),
 * so the type-only edge back to ./contacts creates no runtime circular import.
 */
import { mayAccessStudentContactDirectory } from "@/lib/auth/contact-directory-access";
import type { EnrollmentRosterResult } from "@/lib/course/current-enrollments";
import type { CapabilityKey } from "@/lib/course/capabilities/capability-keys";
import type { EffectiveCapabilityStatus } from "@/lib/course/capabilities/effective-capability-core";
import type { StudentContactRow } from "./contacts";

/**
 * Structural, PII-free failure raised when the enrollment-backed roster cannot
 * be served as-is. This never degrades to the legacy global Student roster: a
 * membership anomaly or duplicate id is a real data defect, so it propagates in
 * the same general manner as an underlying Prisma failure (and, like those,
 * carries no phone/name/identityNumber — only anomaly kinds and counts).
 */
export class StudentContactsRosterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudentContactsRosterError";
  }
}

/**
 * PURE mapping from the reviewed W5B0 enrollment roster to the EXACT
 * StudentContactRow[] contract, preserving the W5B0 ordering (rows arrive
 * pre-sorted by compareTraineeView; we never re-sort). Structural defects fail
 * loudly rather than silently returning the legacy roster:
 *  - ANY membership anomaly (no/multiple current membership, malformed subgroup,
 *    missing parent group) -> throw; do NOT drop the row and do NOT fall back.
 *  - a duplicate student id -> throw; never let it pass silently.
 * Only the six contract fields are copied out; enrollmentStatus/isPrimary and
 * every other relation stay behind.
 */
export function toStudentContactRows(roster: EnrollmentRosterResult): StudentContactRow[] {
  if (roster.anomalies.length > 0) {
    const kinds = [...new Set(roster.anomalies.map((a) => a.kind))].sort().join(", ");
    throw new StudentContactsRosterError(
      `enrollment-backed student roster has ${roster.anomalies.length} membership ` +
        `anomaly/anomalies (kinds: ${kinds}); refusing to serve the student contact ` +
        `directory rather than degrade to the legacy global roster.`,
    );
  }
  const seen = new Set<string>();
  const rows: StudentContactRow[] = [];
  for (const trainee of roster.rows) {
    if (seen.has(trainee.id)) {
      throw new StudentContactsRosterError(
        "enrollment-backed student roster contains a duplicate student id; refusing " +
          "to serve the student contact directory rather than emit duplicate rows.",
      );
    }
    seen.add(trainee.id);
    rows.push({
      id: trainee.id,
      fullName: trainee.fullName,
      lastName: trainee.lastName,
      groupName: trainee.groupName,
      subgroupNumber: trainee.subgroupNumber,
      phone: trainee.phone,
    });
  }
  return rows;
}

/**
 * Injectable dependencies for {@link loadStudentContactsWithDeps}. Only the
 * narrow surface the orchestration needs is described; the concrete wiring
 * (real session actor, real singleton offering resolver, real enrollment DAL,
 * real clock) is assembled inside getStudentContacts in ./contacts.
 */
export interface StudentContactsDeps {
  getCurrentInstructor: () => Promise<{ id: string } | null>;
  resolveCurrentCourseOffering: () => Promise<{ id: string }>;
  getEffectiveCapabilities: (
    courseOfferingId: string,
  ) => Promise<Record<CapabilityKey, EffectiveCapabilityStatus>>;
  getCurrentCourseEnrollmentRoster: (
    courseOfferingId: string,
    options: { asOf: Date },
  ) => Promise<EnrollmentRosterResult>;
  now: () => Date;
}

/**
 * Dependency-injected orchestration for the student contact directory, shared by
 * the real getStudentContacts action (in ./contacts) and its focused tests.
 *
 * Authorization runs FIRST and identically regardless of caller —
 * getCurrentInstructor() then mayAccessStudentContactDirectory(instructor?.id),
 * returning [] for any unauthorized / trainee / anonymous actor BEFORE any
 * offering or roster read. No client-supplied id is accepted and no course id is
 * client-controlled (the offering is resolved solely from the single-offering DB
 * invariant). Because this lives OUTSIDE the "use server" module it is not a
 * Server Action and is never exposed to the client action boundary.
 */
export async function loadStudentContactsWithDeps(
  deps: StudentContactsDeps,
): Promise<StudentContactRow[]> {
  const instructor = await deps.getCurrentInstructor();
  if (!mayAccessStudentContactDirectory(instructor?.id)) {
    return [];
  }
  // Authorization passed. Roster source is the enrollment-backed current-course
  // DAL, never prisma.student.findMany. Resolver ambiguity (0 or >=2 offerings)
  // throws from resolveCurrentCourseOffering and is allowed to propagate; a
  // single captured asOf drives the membership-validity decision.
  const offering = await deps.resolveCurrentCourseOffering();
  // Multi-Course Stage 2: enforce the CONTACTS capability of the resolved
  // offering AFTER the actor gate and AFTER trusted offering resolution, and
  // BEFORE any roster read. The offering id is server-owned (from the singleton
  // resolver), never client-supplied. This is an ADDITIONAL restriction on top
  // of the existing authorization, never a replacement. Only DISABLED blocks:
  // for this read-only surface READ_ONLY is behaviourally identical to ENABLED,
  // so both serve the roster. A failure inside getEffectiveCapabilities
  // propagates (like the resolver/DAL failures) and never falls open to serving
  // the directory.
  const capabilities = await deps.getEffectiveCapabilities(offering.id);
  if (capabilities.CONTACTS === "DISABLED") {
    return [];
  }
  const asOf = deps.now();
  const roster = await deps.getCurrentCourseEnrollmentRoster(offering.id, { asOf });
  return toStudentContactRows(roster);
}
