/**
 * MULTI-COURSE (dormant foundation, Slice 2) - PURE, default-deny operation
 * policy for CourseOffering statuses.
 *
 * PURE by construction: no Prisma client runtime import, no DB, no clock, no
 * randomness, no env, no auth/session/cookie, no IO. It answers ONE narrow
 * question:
 *
 *   "Given a real CourseOffering status and a closed operation category, is this
 *    operation allowed?"
 *
 * It deliberately does NOT answer who the actor is, whether the actor is
 * authorized, whether an enrollment exists, whether referenced records belong to
 * the offering, or whether a production maintenance window was approved. Those
 * checks remain separate concerns and are intentionally out of scope here.
 *
 * Design guarantees:
 *   - closed operation union (callers cannot pass arbitrary strings past the
 *     type system, and bypassed runtime values fail closed);
 *   - the status x operation table is stated as an explicit
 *     Record<CourseOfferingStatus, Record<CourseOfferingOperation, boolean>>, so
 *     adding a future Prisma status - or a future operation - fails TypeScript
 *     until it is classified in every cell;
 *   - default-deny at runtime: an unknown status or operation (only reachable if
 *     the type system is bypassed) is denied, never silently allowed;
 *   - DESTRUCTIVE_MAINTENANCE is denied for EVERY status - ordinary application
 *     policy must never authorize production repair/restore/seed writes;
 *   - the internal policy table is module-private and never exported; the public
 *     API only returns frozen, read-only decisions, so no caller can mutate the
 *     policy or supply a custom "setup"/"allowed" flag.
 *
 * DORMANT: no runtime consumer imports this slice; nothing is wired.
 */
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";

/**
 * The closed set of operation categories. Declared as a frozen `as const` array
 * so the union type below is derived from a single source of truth: adding a
 * future operation here forces it to be classified in every status cell (the
 * Record annotation on the policy table will not compile until it is).
 */
export const COURSE_OFFERING_OPERATIONS = Object.freeze([
  "OFFERING_METADATA_UPDATE",
  "OFFERING_STRUCTURE_UPDATE",
  "ENROLLMENT_MANAGEMENT",
  "GROUP_ASSIGNMENT",
  "HORSE_ASSIGNMENT",
  "SCHEDULE_DRAFT_CONFIGURATION",
  "SCHEDULE_PUBLICATION",
  "DUTY_ASSIGNMENT",
  "ATTENDANCE_LOGGING",
  "RIDING_OPERATION",
  "TEACHING_PRACTICE_OPERATION",
  "FEEDBACK_SUBMISSION",
  "MESSAGE_OR_TASK_SEND",
  "HISTORICAL_READ",
  "DESTRUCTIVE_MAINTENANCE",
] as const);

/** The closed operation type. Callers may only name one of these categories. */
export type CourseOfferingOperation = (typeof COURSE_OFFERING_OPERATIONS)[number];

/**
 * Stable, non-PII reason codes carried by every decision and by the typed error.
 * These are the ONLY externally-observable explanations; they never contain
 * offering names, dates, actor identity or any other PII.
 */
export type CourseOperationReasonCode =
  | "ALLOWED"
  | "DENIED_BY_STATUS_POLICY"
  | "DENIED_UNKNOWN_STATUS"
  | "DENIED_UNKNOWN_OPERATION";

/**
 * The immutable result of a policy evaluation. Echoes the requested status and
 * operation for diagnostics and carries a stable reason code. Never a reference
 * into the internal policy table.
 */
export interface CourseOperationDecision {
  readonly status: CourseOfferingStatus;
  readonly operation: CourseOfferingOperation;
  readonly allowed: boolean;
  readonly reason: CourseOperationReasonCode;
}

/**
 * The single source of truth for status x operation policy. Module-PRIVATE and
 * never exported, so no caller can read or mutate it. The explicit
 * Record<CourseOfferingStatus, Record<CourseOfferingOperation, boolean>> type is
 * what makes the table exhaustive: a new Prisma status leaves the outer object
 * missing a key (TS2741), and a new operation leaves every inner object missing
 * a key - either way it will not compile until classified.
 *
 * DESTRUCTIVE_MAINTENANCE is `false` in every row by construction.
 */
const OPERATION_POLICY: Record<
  CourseOfferingStatus,
  Record<CourseOfferingOperation, boolean>
> = {
  // PLANNED: the offering is being set up. Structural edits and setup are
  // allowed; nothing that produces live operational records (publication, duty,
  // attendance, riding, teaching practice, feedback, messages/tasks) is allowed
  // yet. Messages/tasks are denied by default.
  PLANNED: {
    OFFERING_METADATA_UPDATE: true,
    OFFERING_STRUCTURE_UPDATE: true,
    ENROLLMENT_MANAGEMENT: true,
    GROUP_ASSIGNMENT: true,
    HORSE_ASSIGNMENT: true,
    SCHEDULE_DRAFT_CONFIGURATION: true,
    SCHEDULE_PUBLICATION: false,
    DUTY_ASSIGNMENT: false,
    ATTENDANCE_LOGGING: false,
    RIDING_OPERATION: false,
    TEACHING_PRACTICE_OPERATION: false,
    FEEDBACK_SUBMISSION: false,
    MESSAGE_OR_TASK_SEND: false,
    HISTORICAL_READ: true,
    DESTRUCTIVE_MAINTENANCE: false,
  },
  // ACTIVE: the offering is running. Everyday operations are allowed. Structural
  // identity (course level / ActivityYear ownership) is now frozen, and
  // destructive maintenance is never ordinary policy.
  ACTIVE: {
    OFFERING_METADATA_UPDATE: true,
    OFFERING_STRUCTURE_UPDATE: false,
    ENROLLMENT_MANAGEMENT: true,
    GROUP_ASSIGNMENT: true,
    HORSE_ASSIGNMENT: true,
    SCHEDULE_DRAFT_CONFIGURATION: true,
    SCHEDULE_PUBLICATION: true,
    DUTY_ASSIGNMENT: true,
    ATTENDANCE_LOGGING: true,
    RIDING_OPERATION: true,
    TEACHING_PRACTICE_OPERATION: true,
    FEEDBACK_SUBMISSION: true,
    MESSAGE_OR_TASK_SEND: true,
    HISTORICAL_READ: true,
    DESTRUCTIVE_MAINTENANCE: false,
  },
  // ARCHIVED: read-only history. Only HISTORICAL_READ is allowed (and even that
  // is gated separately on actor authorization). There is NO ordinary
  // unarchive/restore allowance - a future restoration workflow requires its own
  // explicit design and approval.
  ARCHIVED: {
    OFFERING_METADATA_UPDATE: false,
    OFFERING_STRUCTURE_UPDATE: false,
    ENROLLMENT_MANAGEMENT: false,
    GROUP_ASSIGNMENT: false,
    HORSE_ASSIGNMENT: false,
    SCHEDULE_DRAFT_CONFIGURATION: false,
    SCHEDULE_PUBLICATION: false,
    DUTY_ASSIGNMENT: false,
    ATTENDANCE_LOGGING: false,
    RIDING_OPERATION: false,
    TEACHING_PRACTICE_OPERATION: false,
    FEEDBACK_SUBMISSION: false,
    MESSAGE_OR_TASK_SEND: false,
    HISTORICAL_READ: true,
    DESTRUCTIVE_MAINTENANCE: false,
  },
};

/** True only for a key the object owns directly (never an inherited/proto key). */
function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/**
 * Defensive, default-deny lookup. A status/operation that bypassed the type
 * system - including inherited keys such as `toString`, `constructor` or
 * `__proto__` - must NOT resolve through the prototype chain. Only an
 * own-property whose value is an actual boolean counts as classified; anything
 * else surfaces as `undefined`, which callers treat as "deny".
 */
function lookupPolicy(
  status: CourseOfferingStatus,
  operation: CourseOfferingOperation,
): boolean | undefined {
  if (!hasOwn(OPERATION_POLICY, status)) {
    return undefined;
  }
  const perStatus = (
    OPERATION_POLICY as Readonly<Record<string, Record<string, unknown>>>
  )[status];
  if (!hasOwn(perStatus, operation)) {
    return undefined;
  }
  const value = perStatus[operation];
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Build a decision. Each evaluation returns a FRESH object, so freezing it would
 * not protect any shared state (the module-private policy table is never handed
 * out); the result is left as an ordinary immutable-by-type object.
 */
function makeDecision(
  status: CourseOfferingStatus,
  operation: CourseOfferingOperation,
  allowed: boolean,
  reason: CourseOperationReasonCode,
): CourseOperationDecision {
  return { status, operation, allowed, reason };
}

/**
 * Evaluate the policy for a single (status, operation) pair. Pure and
 * deterministic. Never throws. Default-deny: an unknown status or operation is
 * reported as not allowed with a specific reason code.
 */
export function evaluateCourseOperationPolicy(
  status: CourseOfferingStatus,
  operation: CourseOfferingOperation,
): CourseOperationDecision {
  if (!hasOwn(OPERATION_POLICY, status)) {
    return makeDecision(status, operation, false, "DENIED_UNKNOWN_STATUS");
  }

  const allowed = lookupPolicy(status, operation);
  if (allowed === undefined) {
    return makeDecision(status, operation, false, "DENIED_UNKNOWN_OPERATION");
  }

  return makeDecision(
    status,
    operation,
    allowed,
    allowed ? "ALLOWED" : "DENIED_BY_STATUS_POLICY",
  );
}

/**
 * Thrown by assertCourseOperationAllowed when a (status, operation) pair is not
 * permitted. Carries only stable, non-PII fields: the status, the operation and
 * the reason code. Its message is built solely from those enum values.
 */
export class CourseOperationNotPermittedError extends Error {
  readonly code = "COURSE_OPERATION_NOT_PERMITTED" as const;
  readonly status: CourseOfferingStatus;
  readonly operation: CourseOfferingOperation;
  readonly reason: CourseOperationReasonCode;

  constructor(decision: CourseOperationDecision) {
    // Generic, stable message: it never interpolates the status/operation/reason,
    // because a runtime-bypassed `operation` could be an arbitrary string and
    // Error.message must not reflect it. The values remain available as
    // structured fields below for server-side diagnostics.
    super("Course operation is not permitted.");
    this.name = "CourseOperationNotPermittedError";
    this.status = decision.status;
    this.operation = decision.operation;
    this.reason = decision.reason;
  }
}

/**
 * Assert that a (status, operation) pair is allowed, throwing
 * CourseOperationNotPermittedError otherwise. Returns nothing on success. This
 * is the guard callers will use; it still performs only pure policy evaluation
 * and never touches auth, enrollment, ownership or IO.
 */
export function assertCourseOperationAllowed(
  status: CourseOfferingStatus,
  operation: CourseOfferingOperation,
): void {
  const decision = evaluateCourseOperationPolicy(status, operation);
  if (!decision.allowed) {
    throw new CourseOperationNotPermittedError(decision);
  }
}
