/**
 * MULTI-COURSE W6B - PURE, dependency-injected orchestration for ATOMIC new-
 * trainee creation.
 *
 * This module is deliberately NOT a "use server" module: it is a plain server-
 * side library, so nothing here is registered as a Server Action and its
 * testing-only helpers are safe to export (avoiding the use-server type
 * re-export ReferenceError previously hit with StudentContactRow). The public
 * server action lib/actions/students.ts -> createStudent imports the
 * orchestration + the transaction body from here and wires them to real Prisma
 * dependencies.
 *
 * NO runtime side effects at import time, and NO Prisma import: every impure
 * capability (offering resolver, clock, identity/group lookups, and the atomic
 * write itself) is passed in via {@link CreateTraineeDeps}. The only runtime
 * imports are the PURE date helpers from lib/trainee-history, so the whole
 * business contract is unit-testable without a database.
 *
 * W6B PRODUCT DECISION (locked): a newly created trainee MUST have a valid top-
 * level group AND subgroup. Missing group/subgroup, or a group/subgroup that
 * does not resolve to a CourseGroup in the current offering, FAILS before any
 * write - an enrollment is never created without its initial GroupMembership in
 * this stage.
 */
import {
  israelDateKeyFromInstant,
  dateKeyToUtcMidnight,
  utcMidnightToDateKey,
} from "../trainee-history/israel-date";
import { compareDateKeys, type DateKey } from "../trainee-history/interval-resolver";
import {
  NoCurrentCourseOfferingError,
  AmbiguousCourseOfferingError,
  IncompleteCourseOfferingError,
} from "./current-offering-core";

// --- user-facing messages (Hebrew, PII-free) --------------------------------
//
// Kept as named constants so the server action, the orchestration, and the
// tests all assert against the SAME strings. None of them ever echoes the
// submitted identityNumber or any Prisma internals (section G).

/** Duplicate identity number - preserves the exact pre-W6B wording. */
export const DUPLICATE_IDENTITY_MESSAGE = "כבר קיים/ת חניך/ה עם מספר תעודת זהות זה";
/** A trainee was submitted without a (non-blank) top-level group. */
export const MISSING_GROUP_MESSAGE = "יש להזין קבוצה";
/** A trainee was submitted without a valid positive subgroup number. */
export const MISSING_SUBGROUP_MESSAGE = "יש להזין מספר קבוצה";
/** The submitted group does not exist in the current course offering. */
export const GROUP_NOT_FOUND_MESSAGE = "הקבוצה שנבחרה אינה קיימת בקורס הנוכחי";
/** The submitted subgroup does not exist under the resolved group. */
export const SUBGROUP_NOT_FOUND_MESSAGE = "מספר הקבוצה שנבחר אינו קיים בקבוצה זו";

// --- group validation (pure) ------------------------------------------------

/** The resolved CourseGroup lookup keys for a valid new trainee. */
export interface NewTraineeGroupSelection {
  /** Top-level CourseGroup name (trimmed submitted groupName; free text). */
  topName: string;
  /** Subgroup CourseGroup name: the canonical decimal string of a positive int. */
  subName: string;
  /** The positive integer form, mirrored back into Student.subgroupNumber. */
  subgroupNumber: number;
}

export type NewTraineeGroupValidation =
  | { ok: true; selection: NewTraineeGroupSelection }
  | { ok: false; message: string };

/**
 * Validate the submitted group/subgroup for W6B new-trainee creation. Both are
 * REQUIRED: a blank/whitespace/absent group, or an absent/non-positive-integer
 * subgroup, is rejected here (before any DB lookup or write). The top name is
 * free text (trimmed - א/ב are never hardcoded); the subgroup CourseGroup name
 * is the canonical decimal string of the positive integer, matching the seed
 * backfill's classifyGroupCell "sub" rule so new and backfilled trainees share
 * one naming convention.
 */
export function validateNewTraineeGroup(input: {
  groupName?: string | null;
  subgroupNumber?: number | null;
}): NewTraineeGroupValidation {
  const topName = typeof input.groupName === "string" ? input.groupName.trim() : "";
  if (topName.length === 0) {
    return { ok: false, message: MISSING_GROUP_MESSAGE };
  }
  const sub = input.subgroupNumber;
  if (sub === null || sub === undefined || !Number.isInteger(sub) || sub <= 0) {
    return { ok: false, message: MISSING_SUBGROUP_MESSAGE };
  }
  return { ok: true, selection: { topName, subName: String(sub), subgroupNumber: sub } };
}

// --- initial effective-date rule (pure) -------------------------------------

/**
 * The locked W6B effective-date rule (single deterministic instant):
 *
 *   effectiveDate = max(Israel-local today, CourseOffering.startDate)
 *
 * The SAME effectiveDate is used for BOTH CourseEnrollment.startDate and the
 * initial GroupMembership.effectiveFrom, so the enrollment and its opening
 * half-open interval never disagree. Rationale:
 *  - Before the course starts, a pre-enrolled trainee opens at the course start
 *    (matching the seed backfill's "interval opens at course start" decision).
 *  - Once the course has started, a newly created trainee is NOT backdated -
 *    their membership opens today (Israel-local), never before they existed.
 *
 * PURE: `now` is the ONLY clock input (injected). Comparison is on YYYY-MM-DD
 * DateKeys (lexicographic == chronological), so no local/UTC Date arithmetic can
 * shift the calendar day. `offeringStartDate` is a Prisma @db.Date (UTC-midnight
 * Date). The returned `date` is a fresh UTC-midnight Date matching how @db.Date
 * columns are stored.
 */
export function resolveInitialEffectiveDate(
  now: Date,
  offeringStartDate: Date,
): { key: DateKey; date: Date } {
  const todayKey = israelDateKeyFromInstant(now);
  const startKey = utcMidnightToDateKey(offeringStartDate);
  const key = compareDateKeys(todayKey, startKey) >= 0 ? todayKey : startKey;
  return { key, date: dateKeyToUtcMidnight(key) };
}

// --- duplicate-identity error detection (pure) ------------------------------

/**
 * Detect a Prisma unique-constraint violation (P2002) that corresponds to the
 * Student.identityNumber constraint, WITHOUT importing Prisma. The atomic
 * transaction creates a brand-new Student, a brand-new CourseEnrollment, and a
 * brand-new GroupMembership; of every unique constraint they touch, only
 * Student.identityNumber can collide (the enrollment/membership uniques are
 * keyed on the just-created ids, and no CourseGroup is created), so a P2002
 * whose target cannot be read is still safely attributed to identityNumber.
 * Never inspects or echoes the offending value.
 */
export function isDuplicateIdentityNumberError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  if (code !== "P2002") {
    return false;
  }
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) {
    return target.some((t) => typeof t === "string" && t.includes("identityNumber"));
  }
  if (typeof target === "string") {
    return target.includes("identityNumber");
  }
  return true;
}

// --- atomic write plan + transaction body -----------------------------------

/** Student row data for the atomic create, including the compatibility mirror. */
export interface TraineeStudentCreateData {
  firstName: string;
  lastName: string;
  fullName: string;
  identityNumber: string;
  phone: string | null;
  /** Compatibility mirror: kept in sync with the authoritative membership. */
  groupName: string;
  /** Compatibility mirror: kept in sync with the authoritative membership. */
  subgroupNumber: number;
  /** Compatibility mirror: a newly created trainee is active. */
  isActive: boolean;
}

/** The fully-resolved, all-or-nothing creation plan for one new trainee. */
export interface AtomicTraineePlan {
  student: TraineeStudentCreateData;
  courseOfferingId: string;
  /** The resolved offering-scoped CourseGroup id the membership targets. */
  courseGroupId: string;
  /** The single effectiveDate shared by enrollment.startDate and membership.effectiveFrom. */
  effectiveDate: Date;
}

/**
 * The narrow structural view of a Prisma transaction client this stage needs -
 * only the three create calls, in dependency order. Real Prisma
 * `Prisma.TransactionClient` satisfies this structurally; tests pass a plain
 * fake to observe ordering and rollback without a database.
 */
export interface TraineeTxClient {
  student: { create(args: { data: TraineeStudentCreateData }): Promise<{ id: string }> };
  courseEnrollment: {
    create(args: {
      data: {
        studentId: string;
        courseOfferingId: string;
        status: "ACTIVE";
        isPrimary: boolean;
        startDate: Date;
      };
    }): Promise<{ id: string }>;
  };
  groupMembership: {
    create(args: {
      data: {
        courseEnrollmentId: string;
        courseGroupId: string;
        effectiveFrom: Date;
        effectiveTo: null;
      };
    }): Promise<{ id: string }>;
  };
}

/**
 * The transaction body: Student -> CourseEnrollment -> GroupMembership, in that
 * fixed order (each step depends on the previous id). Run inside a single Prisma
 * interactive transaction by the caller, so any thrown step aborts the whole
 * transaction and leaves NO Student, NO CourseEnrollment, and NO GroupMembership
 * behind. Writes ONLY these three rows - never TraineeGroupMembership.
 */
export async function runTraineeCreateInTx(
  tx: TraineeTxClient,
  plan: AtomicTraineePlan,
): Promise<void> {
  const student = await tx.student.create({ data: { ...plan.student } });
  const enrollment = await tx.courseEnrollment.create({
    data: {
      studentId: student.id,
      courseOfferingId: plan.courseOfferingId,
      status: "ACTIVE",
      isPrimary: true,
      startDate: plan.effectiveDate,
    },
  });
  await tx.groupMembership.create({
    data: {
      courseEnrollmentId: enrollment.id,
      courseGroupId: plan.courseGroupId,
      effectiveFrom: plan.effectiveDate,
      effectiveTo: null,
    },
  });
}

// --- dependency-injected orchestration --------------------------------------

/** The current offering, reduced to exactly what W6B creation needs. */
export interface CreateTraineeOffering {
  id: string;
  /** @db.Date UTC-midnight start of the offering; drives the effective-date rule. */
  startDate: Date;
}

/** The already-validated, server-trusted input for a new trainee. */
export interface CreateTraineeInput {
  firstName: string;
  lastName: string;
  identityNumber: string;
  phone: string | null;
  groupName: string | null;
  subgroupNumber: number | null;
}

/** Structurally identical to lib/actions/students.ts ActionResult (never re-exported across the use-server boundary). */
export interface CreateTraineeResult {
  success: boolean;
  error?: string;
}

/**
 * The injectable server dependencies. Real wiring lives in the createStudent
 * server action; tests pass fakes to observe ordering, "fail before writes"
 * guarantees, and error mapping without touching Prisma. The offering is ALWAYS
 * server-derived here - there is deliberately no courseOfferingId parameter.
 */
export interface CreateTraineeDeps {
  resolveCurrentCourseOffering: () => Promise<CreateTraineeOffering>;
  now: () => Date;
  identityNumberExists: (identityNumber: string) => Promise<boolean>;
  findTopGroupId: (courseOfferingId: string, name: string) => Promise<string | null>;
  findSubGroupId: (parentGroupId: string, name: string) => Promise<string | null>;
  createAtomically: (plan: AtomicTraineePlan) => Promise<void>;
}

/**
 * Orchestrate atomic new-trainee creation in a fixed, fail-before-writes order:
 *   1. resolve the singleton current offering (server-derived; 0/ambiguous/
 *      incomplete all throw out of this via the resolver, before any write);
 *   2. validate that a group AND subgroup were supplied (pure);
 *   3. resolve the offering-scoped top-level CourseGroup, then its subgroup -
 *      a miss on either FAILS before the transaction is opened;
 *   4. pre-check identityNumber uniqueness (preserves the pre-W6B UX message);
 *   5. compute the single effectiveDate;
 *   6. perform the all-or-nothing create (Student + ACTIVE isPrimary enrollment
 *      + initial subgroup membership). A concurrent duplicate that slips past
 *      the pre-check is caught via the DB unique constraint and mapped to the
 *      same friendly message; any other error propagates unchanged.
 *
 * Every early return is a `{ success:false }` result BEFORE createAtomically is
 * ever called, so no partial rows can exist.
 */
export async function createTraineeWithEnrollmentWithDeps(
  input: CreateTraineeInput,
  deps: CreateTraineeDeps,
): Promise<CreateTraineeResult> {
  const offering = await deps.resolveCurrentCourseOffering();

  const group = validateNewTraineeGroup(input);
  if (!group.ok) {
    return { success: false, error: group.message };
  }
  const { topName, subName, subgroupNumber } = group.selection;

  const topGroupId = await deps.findTopGroupId(offering.id, topName);
  if (topGroupId === null) {
    return { success: false, error: GROUP_NOT_FOUND_MESSAGE };
  }
  const subGroupId = await deps.findSubGroupId(topGroupId, subName);
  if (subGroupId === null) {
    return { success: false, error: SUBGROUP_NOT_FOUND_MESSAGE };
  }

  if (await deps.identityNumberExists(input.identityNumber)) {
    return { success: false, error: DUPLICATE_IDENTITY_MESSAGE };
  }

  const { date: effectiveDate } = resolveInitialEffectiveDate(deps.now(), offering.startDate);

  const plan: AtomicTraineePlan = {
    student: {
      firstName: input.firstName,
      lastName: input.lastName,
      fullName: `${input.firstName} ${input.lastName}`.trim(),
      identityNumber: input.identityNumber,
      phone: input.phone,
      groupName: topName,
      subgroupNumber,
      isActive: true,
    },
    courseOfferingId: offering.id,
    courseGroupId: subGroupId,
    effectiveDate,
  };

  try {
    await deps.createAtomically(plan);
  } catch (err) {
    if (isDuplicateIdentityNumberError(err)) {
      return { success: false, error: DUPLICATE_IDENTITY_MESSAGE };
    }
    throw err;
  }

  return { success: true };
}

/**
 * Classify whether `err` is one of the three KNOWN current-offering structural
 * failures (zero / ambiguous / incomplete). The Server Action boundary uses
 * this to convert ONLY these into a safe user-facing ActionResult, while every
 * unexpected error keeps throwing. Carries NO UI language and never inspects
 * offering ids, counts, or dates - the caller supplies the user-facing message.
 */
export function isKnownCurrentOfferingError(err: unknown): boolean {
  return (
    err instanceof NoCurrentCourseOfferingError ||
    err instanceof AmbiguousCourseOfferingError ||
    err instanceof IncompleteCourseOfferingError
  );
}

/**
 * Boundary-safe wrapper over {@link createTraineeWithEnrollmentWithDeps}: it
 * still resolves the offering server-side, still fails before any write, and
 * never falls back to Student-only creation - but a KNOWN current-offering
 * structural failure is converted into `{ success:false, error: <caller's
 * message> }` instead of an unhandled Server Action rejection. The safe Hebrew
 * message is INJECTED by the caller (kept at the action boundary), so this core
 * stays free of UI language. Unexpected errors (incl. a genuine DB failure)
 * propagate unchanged; duplicate-identity and group/subgroup handling are
 * untouched (they already return friendly results from the inner orchestration).
 */
export async function createTraineeWithEnrollmentSafe(
  input: CreateTraineeInput,
  deps: CreateTraineeDeps,
  offeringUnavailableMessage: string,
): Promise<CreateTraineeResult> {
  try {
    return await createTraineeWithEnrollmentWithDeps(input, deps);
  } catch (err) {
    if (isKnownCurrentOfferingError(err)) {
      return { success: false, error: offeringUnavailableMessage };
    }
    throw err;
  }
}
