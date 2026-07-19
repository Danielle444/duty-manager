/**
 * MULTI-COURSE W8A-4 - PURE three-way horse-cache PARITY comparator.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env. Every
 * function takes plain data (including an explicit `asOf`) and returns plain
 * data, so the whole parity contract is unit-testable without a database (see
 * horse-cache-parity.test.ts). The IO caller (the read-only diagnostic) owns all
 * fetching; this module only compares.
 *
 * THE THREE SOURCES compared per student:
 *   1. HISTORY  - the single TraineeHorseAssignment interval CURRENT at asOf
 *                 (the offering-scoped dated authority).
 *   2. ENROLLMENT - the CourseEnrollment horse cache
 *                 (hasPrivateHorse/privateHorseName/assignedHorseName), populated
 *                 by the W8A-2/3 backfill from that current interval.
 *   3. STUDENT  - the temporary Student compatibility mirror (same three fields).
 *
 * INTERVAL MODEL: identical half-open semantics to
 * lib/trainee-history/interval-resolver - effectiveFrom INCLUSIVE, effectiveTo
 * EXCLUSIVE, null effectiveTo = open-ended. A row covers asOf iff
 * effectiveFrom <= asOf AND (effectiveTo === null OR asOf < effectiveTo). This
 * module counts ALL covering rows itself, so zero vs one vs many is detectable
 * (resolveIntervalAtDate returns only the first match).
 *
 * HORSE COMPARISON: field-level canonical equality (booleans strict; names
 * trimmed, empty/whitespace collapsed to null), NOT display equivalence. This is
 * a data-integrity audit, so a stale field that `getHorseDisplayInfo` would
 * currently mask (e.g. an assignedHorseName left on a private-horse row) is still
 * surfaced as a mismatch. The HISTORY interval's horse must additionally be one
 * of the four canonical states (via lib/trainee-history/normalize-horse); a
 * noncanonical history value is an INVALID_HORSE_STATE anomaly.
 *
 * PII REDACTION (locked): every anomaly, count, and formatter line carries ONLY
 * safe public ids (studentId / courseEnrollmentId / traineeHorseAssignmentId /
 * offeringId) and reason codes. It NEVER emits a horse name, person name,
 * identity number, or phone number.
 *
 * NOTE (W8A-4 scope): read-only comparison only. Nothing here writes, and no
 * runtime read/write behavior changes.
 */
import type { CourseEnrollmentStatus } from "@/app/generated/prisma/client";
import { compareDateKeys, type DateKey } from "../trainee-history/interval-resolver";
import { normalizeHorse, type NormalizedHorse } from "../trainee-history/normalize-horse";

/** The three horse fields shared by all three sources. */
export interface HorseTriple {
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

/** One CourseEnrollment in the current offering (source 2 + cardinality/active). */
export interface ParityEnrollmentInput extends HorseTriple {
  id: string;
  studentId: string;
  status: CourseEnrollmentStatus;
}

/** One TraineeHorseAssignment history row (source 1), already date-normalized. */
export interface ParityHistoryInput extends HorseTriple {
  id: string;
  studentId: string;
  courseEnrollmentId: string | null;
  effectiveFrom: DateKey;
  effectiveTo: DateKey | null;
}

/** One Student compatibility mirror row (source 3). */
export interface ParityStudentInput extends HorseTriple {
  id: string;
}

/** Everything the pure comparator needs, already fetched + date-normalized. */
export interface BuildHorseCacheParityInput {
  /** The single server-resolved current CourseOffering id (a public cuid). */
  currentOfferingId: string;
  /** The single captured effective date at which "current horse" is resolved. */
  asOf: DateKey;
  /** ALL CourseEnrollment rows in the current offering (already offering-scoped). */
  enrollments: readonly ParityEnrollmentInput[];
  /** ALL TraineeHorseAssignment rows (any student; orphans surface as anomalies). */
  horseAssignments: readonly ParityHistoryInput[];
  /** Student compatibility caches for every subject student. */
  students: readonly ParityStudentInput[];
}

/** A reported parity anomaly. Every field is a safe id (no PII) + a reason code. */
export type HorseCacheParityAnomaly =
  | { code: "ZERO_ENROLLMENT"; studentId: string }
  | { code: "MULTIPLE_ENROLLMENT"; studentId: string; courseEnrollmentIds: string[] }
  | { code: "INACTIVE_ENROLLMENT"; studentId: string; courseEnrollmentId: string; status: CourseEnrollmentStatus }
  | { code: "NO_CURRENT_HISTORY"; studentId: string; courseEnrollmentId: string }
  | {
      code: "MULTIPLE_CURRENT_HISTORY";
      studentId: string;
      courseEnrollmentId: string;
      traineeHorseAssignmentIds: string[];
    }
  | {
      code: "INVALID_HORSE_STATE";
      studentId: string;
      courseEnrollmentId: string;
      traineeHorseAssignmentId: string;
    }
  | {
      code: "WRONG_LINKED_ENROLLMENT";
      studentId: string;
      courseEnrollmentId: string;
      traineeHorseAssignmentId: string;
      linkedCourseEnrollmentId: string | null;
    }
  | {
      code: "HISTORY_ENROLLMENT_MISMATCH";
      studentId: string;
      courseEnrollmentId: string;
      traineeHorseAssignmentId: string;
    }
  | { code: "ENROLLMENT_STUDENT_MISMATCH"; studentId: string; courseEnrollmentId: string }
  | {
      code: "HISTORY_STUDENT_MISMATCH";
      studentId: string;
      courseEnrollmentId: string;
      traineeHorseAssignmentId: string;
    };

export type HorseCacheParityCode = HorseCacheParityAnomaly["code"];

/** Deterministic, PII-free counts describing the whole parity comparison. */
export interface HorseCacheParitySummary {
  currentOfferingId: string;
  asOf: DateKey;
  totalEnrollments: number;
  totalHistoryRows: number;
  totalStudents: number;
  subjectsChecked: number;
  subjectsOk: number;
  zeroEnrollment: number;
  multipleEnrollment: number;
  inactiveEnrollment: number;
  noCurrentHistory: number;
  multipleCurrentHistory: number;
  invalidHorseState: number;
  wrongLinkedEnrollment: number;
  historyEnrollmentMismatch: number;
  enrollmentStudentMismatch: number;
  historyStudentMismatch: number;
  anomalyTotal: number;
}

export interface HorseCacheParityResult {
  currentOfferingId: string;
  asOf: DateKey;
  /** Deterministic order: (studentId, code rank). */
  anomalies: HorseCacheParityAnomaly[];
  summary: HorseCacheParitySummary;
  /** True iff there are zero anomalies of any kind (full three-way parity). */
  ok: boolean;
}

/**
 * A row covers `date` iff effectiveFrom <= date AND (effectiveTo === null OR
 * date < effectiveTo). Evaluated over EVERY row so zero vs one vs many covering
 * intervals is detectable.
 */
function covers(row: { effectiveFrom: DateKey; effectiveTo: DateKey | null }, date: DateKey): boolean {
  const startsOnOrBeforeDate = compareDateKeys(row.effectiveFrom, date) <= 0;
  const endsAfterDate = row.effectiveTo === null || compareDateKeys(date, row.effectiveTo) < 0;
  return startsOnOrBeforeDate && endsAfterDate;
}

/** Trim a name to a canonical value: empty/whitespace collapses to null. */
function canonicalName(name: string | null): string | null {
  if (name === null) return null;
  const trimmed = name.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Canonical field-level horse equality: booleans strict, names trimmed with
 * empty/whitespace collapsed to null. NOT display equivalence - all three fields
 * are compared, so a stale field that display logic would mask still counts as a
 * difference.
 */
function sameHorse(a: HorseTriple, b: HorseTriple): boolean {
  return (
    a.hasPrivateHorse === b.hasPrivateHorse &&
    canonicalName(a.privateHorseName) === canonicalName(b.privateHorseName) &&
    canonicalName(a.assignedHorseName) === canonicalName(b.assignedHorseName)
  );
}

/** Stable rank so a subject's anomalies always emit in the same order. */
const CODE_RANK: Record<HorseCacheParityCode, number> = {
  ZERO_ENROLLMENT: 0,
  MULTIPLE_ENROLLMENT: 1,
  INACTIVE_ENROLLMENT: 2,
  ENROLLMENT_STUDENT_MISMATCH: 3,
  NO_CURRENT_HISTORY: 4,
  MULTIPLE_CURRENT_HISTORY: 5,
  INVALID_HORSE_STATE: 6,
  WRONG_LINKED_ENROLLMENT: 7,
  HISTORY_ENROLLMENT_MISMATCH: 8,
  HISTORY_STUDENT_MISMATCH: 9,
};

/**
 * Build the deterministic, PII-free three-way parity result. PURE: identical
 * inputs always yield an identical result regardless of input array order.
 *
 * SUBJECTS: every studentId that appears in ANY enrollment OR history row (their
 * union), so a history orphan with no enrollment surfaces as ZERO_ENROLLMENT and
 * an enrollment with no current history surfaces as NO_CURRENT_HISTORY.
 *
 * PER-SUBJECT RESOLUTION (matching key is studentId only; never name/phone):
 *   1. enrollment cardinality: 0 -> ZERO_ENROLLMENT (stop); >1 -> MULTIPLE_ENROLLMENT (stop).
 *   2. the single enrollment must be ACTIVE; else INACTIVE_ENROLLMENT (stop).
 *   3. ENROLLMENT vs STUDENT value parity (history-independent).
 *   4. history cardinality current at asOf: 0 -> NO_CURRENT_HISTORY (stop history checks);
 *      >1 -> MULTIPLE_CURRENT_HISTORY (stop history checks).
 *   5. the single current interval: normalize (noncanonical -> INVALID_HORSE_STATE);
 *      link must point at the resolved enrollment (else WRONG_LINKED_ENROLLMENT);
 *      HISTORY vs ENROLLMENT and HISTORY vs STUDENT value parity.
 * A subject with zero emitted anomalies is counted as ok.
 */
export function buildHorseCacheParity(input: BuildHorseCacheParityInput): HorseCacheParityResult {
  const anomalies: HorseCacheParityAnomaly[] = [];

  // --- Index the three sources by their studentId (the ONLY matching key). ----
  const enrollmentsByStudent = new Map<string, ParityEnrollmentInput[]>();
  for (const e of input.enrollments) {
    const list = enrollmentsByStudent.get(e.studentId);
    if (list) list.push(e);
    else enrollmentsByStudent.set(e.studentId, [e]);
  }
  const historyByStudent = new Map<string, ParityHistoryInput[]>();
  for (const h of input.horseAssignments) {
    const list = historyByStudent.get(h.studentId);
    if (list) list.push(h);
    else historyByStudent.set(h.studentId, [h]);
  }
  const studentById = new Map<string, ParityStudentInput>();
  for (const s of input.students) {
    if (!studentById.has(s.id)) studentById.set(s.id, s);
  }

  // --- Subjects: the sorted union of studentIds across enrollments + history. -
  const subjectIds = [
    ...new Set<string>([...enrollmentsByStudent.keys(), ...historyByStudent.keys()]),
  ].sort();

  let subjectsOk = 0;

  for (const studentId of subjectIds) {
    const before = anomalies.length;

    // 1. Enrollment cardinality.
    const studentEnrollments = enrollmentsByStudent.get(studentId) ?? [];
    if (studentEnrollments.length === 0) {
      anomalies.push({ code: "ZERO_ENROLLMENT", studentId });
      continue;
    }
    if (studentEnrollments.length > 1) {
      anomalies.push({
        code: "MULTIPLE_ENROLLMENT",
        studentId,
        courseEnrollmentIds: studentEnrollments.map((e) => e.id).sort(),
      });
      continue;
    }
    const enrollment = studentEnrollments[0];

    // 2. Active requirement.
    if (enrollment.status !== "ACTIVE") {
      anomalies.push({
        code: "INACTIVE_ENROLLMENT",
        studentId,
        courseEnrollmentId: enrollment.id,
        status: enrollment.status,
      });
      continue;
    }

    // 3. ENROLLMENT vs STUDENT parity (history-independent).
    const student = studentById.get(studentId) ?? null;
    if (student !== null && !sameHorse(enrollment, student)) {
      anomalies.push({
        code: "ENROLLMENT_STUDENT_MISMATCH",
        studentId,
        courseEnrollmentId: enrollment.id,
      });
    }

    // 4. History cardinality current at asOf.
    const studentHistory = historyByStudent.get(studentId) ?? [];
    const covering = studentHistory.filter((h) => covers(h, input.asOf));
    if (covering.length === 0) {
      anomalies.push({ code: "NO_CURRENT_HISTORY", studentId, courseEnrollmentId: enrollment.id });
      if (anomalies.length === before) subjectsOk++;
      continue;
    }
    if (covering.length > 1) {
      anomalies.push({
        code: "MULTIPLE_CURRENT_HISTORY",
        studentId,
        courseEnrollmentId: enrollment.id,
        traineeHorseAssignmentIds: covering.map((h) => h.id).sort(),
      });
      if (anomalies.length === before) subjectsOk++;
      continue;
    }
    const history = covering[0];

    // 5a. History horse must be canonical (the authority for the value checks).
    const normalized = normalizeHorse({
      assignedHorseName: history.assignedHorseName,
      hasPrivateHorse: history.hasPrivateHorse,
      privateHorseName: history.privateHorseName,
    });
    const historyHorse: NormalizedHorse | null = normalized.ok ? normalized.value : null;
    if (historyHorse === null) {
      anomalies.push({
        code: "INVALID_HORSE_STATE",
        studentId,
        courseEnrollmentId: enrollment.id,
        traineeHorseAssignmentId: history.id,
      });
    }

    // 5b. The current interval must be linked to the resolved enrollment.
    if (history.courseEnrollmentId !== enrollment.id) {
      anomalies.push({
        code: "WRONG_LINKED_ENROLLMENT",
        studentId,
        courseEnrollmentId: enrollment.id,
        traineeHorseAssignmentId: history.id,
        linkedCourseEnrollmentId: history.courseEnrollmentId,
      });
    }

    // 5c. HISTORY value parity (only when the authority is canonical).
    if (historyHorse !== null) {
      if (!sameHorse(historyHorse, enrollment)) {
        anomalies.push({
          code: "HISTORY_ENROLLMENT_MISMATCH",
          studentId,
          courseEnrollmentId: enrollment.id,
          traineeHorseAssignmentId: history.id,
        });
      }
      if (student !== null && !sameHorse(historyHorse, student)) {
        anomalies.push({
          code: "HISTORY_STUDENT_MISMATCH",
          studentId,
          courseEnrollmentId: enrollment.id,
          traineeHorseAssignmentId: history.id,
        });
      }
    }

    if (anomalies.length === before) subjectsOk++;
  }

  // Deterministic final order: (studentId, code rank).
  anomalies.sort((a, b) =>
    a.studentId === b.studentId
      ? CODE_RANK[a.code] - CODE_RANK[b.code]
      : a.studentId < b.studentId
        ? -1
        : 1,
  );

  const count = (code: HorseCacheParityCode): number =>
    anomalies.reduce((n, x) => (x.code === code ? n + 1 : n), 0);

  const summary: HorseCacheParitySummary = {
    currentOfferingId: input.currentOfferingId,
    asOf: input.asOf,
    totalEnrollments: input.enrollments.length,
    totalHistoryRows: input.horseAssignments.length,
    totalStudents: input.students.length,
    subjectsChecked: subjectIds.length,
    subjectsOk,
    zeroEnrollment: count("ZERO_ENROLLMENT"),
    multipleEnrollment: count("MULTIPLE_ENROLLMENT"),
    inactiveEnrollment: count("INACTIVE_ENROLLMENT"),
    noCurrentHistory: count("NO_CURRENT_HISTORY"),
    multipleCurrentHistory: count("MULTIPLE_CURRENT_HISTORY"),
    invalidHorseState: count("INVALID_HORSE_STATE"),
    wrongLinkedEnrollment: count("WRONG_LINKED_ENROLLMENT"),
    historyEnrollmentMismatch: count("HISTORY_ENROLLMENT_MISMATCH"),
    enrollmentStudentMismatch: count("ENROLLMENT_STUDENT_MISMATCH"),
    historyStudentMismatch: count("HISTORY_STUDENT_MISMATCH"),
    anomalyTotal: anomalies.length,
  };

  return {
    currentOfferingId: input.currentOfferingId,
    asOf: input.asOf,
    anomalies,
    summary,
    ok: anomalies.length === 0,
  };
}

/**
 * Render a PII-free, credential-free one-block summary for operator logs.
 * Emits ONLY counts and safe ids (offeringId) - never a name, phone, identity
 * number, horse name, connection string, or DATABASE_URL.
 */
export function formatHorseCacheParitySummary(result: HorseCacheParityResult): string {
  const s = result.summary;
  return [
    `current offering:            ${s.currentOfferingId}`,
    `asOf (current-horse date):   ${s.asOf}`,
    `total enrollments:           ${s.totalEnrollments}`,
    `total history rows:          ${s.totalHistoryRows}`,
    `total students:              ${s.totalStudents}`,
    `subjects checked:            ${s.subjectsChecked}`,
    `subjects in full parity:     ${s.subjectsOk}`,
    `anomalies (total):           ${s.anomalyTotal}`,
    `  zero-enrollment:              ${s.zeroEnrollment}`,
    `  multiple-enrollment:          ${s.multipleEnrollment}`,
    `  inactive-enrollment:          ${s.inactiveEnrollment}`,
    `  no-current-history:           ${s.noCurrentHistory}`,
    `  multiple-current-history:     ${s.multipleCurrentHistory}`,
    `  invalid-horse-state:          ${s.invalidHorseState}`,
    `  wrong-linked-enrollment:      ${s.wrongLinkedEnrollment}`,
    `  history/enrollment mismatch:  ${s.historyEnrollmentMismatch}`,
    `  enrollment/student mismatch:  ${s.enrollmentStudentMismatch}`,
    `  history/student mismatch:     ${s.historyStudentMismatch}`,
    `full three-way parity:       ${result.ok ? "yes (0 anomalies)" : "NO (anomalies present)"}`,
  ].join("\n");
}

/**
 * Render each anomaly as a single PII-free diagnostic line (safe ids + code
 * only), so an operator can locate the offending rows without any names,
 * credentials, or horse identities.
 */
export function formatHorseCacheParityAnomalies(result: HorseCacheParityResult): string[] {
  return result.anomalies.map((x) => {
    switch (x.code) {
      case "ZERO_ENROLLMENT":
        return `ZERO_ENROLLMENT: student ${x.studentId} has history but no enrollment in the current offering`;
      case "MULTIPLE_ENROLLMENT":
        return `MULTIPLE_ENROLLMENT: student ${x.studentId} has ${x.courseEnrollmentIds.length} enrollments (${x.courseEnrollmentIds.join(", ")}) in the current offering`;
      case "INACTIVE_ENROLLMENT":
        return `INACTIVE_ENROLLMENT: student ${x.studentId} enrollment ${x.courseEnrollmentId} is ${x.status} (not ACTIVE)`;
      case "NO_CURRENT_HISTORY":
        return `NO_CURRENT_HISTORY: enrollment ${x.courseEnrollmentId} (student ${x.studentId}) has no history interval current at asOf`;
      case "MULTIPLE_CURRENT_HISTORY":
        return `MULTIPLE_CURRENT_HISTORY: enrollment ${x.courseEnrollmentId} (student ${x.studentId}) has ${x.traineeHorseAssignmentIds.length} intervals current at asOf (${x.traineeHorseAssignmentIds.join(", ")})`;
      case "INVALID_HORSE_STATE":
        return `INVALID_HORSE_STATE: history ${x.traineeHorseAssignmentId} (student ${x.studentId}, enrollment ${x.courseEnrollmentId}) is not a canonical horse state`;
      case "WRONG_LINKED_ENROLLMENT":
        return `WRONG_LINKED_ENROLLMENT: history ${x.traineeHorseAssignmentId} (student ${x.studentId}) links to ${x.linkedCourseEnrollmentId ?? "null"}, expected ${x.courseEnrollmentId}`;
      case "HISTORY_ENROLLMENT_MISMATCH":
        return `HISTORY_ENROLLMENT_MISMATCH: history ${x.traineeHorseAssignmentId} vs enrollment cache ${x.courseEnrollmentId} (student ${x.studentId}) disagree`;
      case "ENROLLMENT_STUDENT_MISMATCH":
        return `ENROLLMENT_STUDENT_MISMATCH: enrollment cache ${x.courseEnrollmentId} vs Student cache (student ${x.studentId}) disagree`;
      case "HISTORY_STUDENT_MISMATCH":
        return `HISTORY_STUDENT_MISMATCH: history ${x.traineeHorseAssignmentId} vs Student cache (student ${x.studentId}, enrollment ${x.courseEnrollmentId}) disagree`;
    }
  });
}
