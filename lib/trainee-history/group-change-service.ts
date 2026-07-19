/**
 * Enrollment-scoped effective-dated GROUP-CHANGE service (Stage W6D3).
 *
 * Moves a trainee between leaf CourseGroups within a single CourseOffering by
 * writing the AUTHORITATIVE, enrollment-scoped `GroupMembership` history and
 * synchronizing the Student compatibility mirror — inside ONE interactive
 * transaction that locks the parent Student row first.
 *
 * WHY A DEDICATED TRANSACTION (not `runEffectiveDatedWrite`): the generic engine
 * in ./apply-plan assumes the Student cache columns ARE the interval value `V`
 * (group-legacy: groupName/subgroupNumber live on both TraineeGroupMembership
 * and Student; horse: the three horse columns). That assumption does not hold
 * here: the authoritative interval value is `{ courseGroupId }` on an
 * enrollment-scoped row, while the Student mirror is a DERIVED
 * `{ groupName, subgroupNumber }`, and the history is keyed by
 * courseEnrollmentId (resolved only AFTER the Student lock), not studentId. The
 * engine can neither read/compare/write that mirror shape nor resolve the
 * enrollment mid-transaction. So this service reuses the engine's PURE building
 * blocks UNCHANGED — the interval planner (`planIntervalWrite` /
 * `validateIntervalRows`), the resolver, the Israel-date helpers, the Student
 * `FOR UPDATE` lock, and the planner placeholder id — plus the pure
 * group-change core (`validateResolvedTarget` / `decideGroupChange` /
 * `deriveGroupMirror` / `checkGroupChangeParity`). A FRESH per-call adapter
 * (built inside the transaction, closing over the resolved enrollment id) wires
 * the `GroupMembership` Prisma delegate. There is NO mutable module-level state.
 *
 * AUTHORITY MODEL (locked, W6D2/W6D3):
 *  - `GroupMembership` is the ONLY dated group authority; the current group is
 *    its `courseGroupId`.
 *  - `Student.groupName` / `Student.subgroupNumber` are COMPATIBILITY MIRRORS,
 *    derived from the resolved target parent group name + subgroup number.
 *  - The legacy `TraineeGroupMembership` model is NEVER read or written here and
 *    is intentionally not imported. `GroupMembership` is not dual-written to it.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { PLANNER_PLACEHOLDER_ID } from "./apply-plan";
import {
  compareDateKeys,
  isValidDateKey,
  type DateKey,
  type IntervalRow,
} from "./interval-resolver";
import { planIntervalWrite, validateIntervalRows } from "./interval-update";
import { dateKeyToUtcMidnight, utcMidnightToDateKey } from "./israel-date";
import { lockStudentForUpdate } from "./parent-lock";
import { TraineeHistoryTxError } from "./apply-plan";
import {
  validateResolvedTarget,
  decideGroupChange,
  deriveGroupMirror,
  checkGroupChangeParity,
  type GroupMembershipValue,
  type ResolvedTargetCourseGroup,
} from "./group-change-core";

// ============================================================================
// PUBLIC TYPES
// ============================================================================

/**
 * The only public error codes for a group change. Deliberately narrow and
 * ID-free: the action boundary maps each onto a safe Hebrew message and never
 * surfaces Prisma detail, ids, or identity numbers.
 */
export type GroupChangeErrorCode =
  | "TRAINEE_NOT_FOUND"
  | "TRAINEE_INACTIVE"
  | "ENROLLMENT_NOT_FOUND"
  | "ENROLLMENT_INACTIVE"
  | "INVALID_TARGET_GROUP"
  | "MEMBERSHIP_STATE_INVALID"
  | "INVARIANT_FAILURE"
  | "TRANSACTION_FAILURE";

/** Minimal public result. `changed` is false for the same-group no-op. */
export type GroupChangeOutcome =
  | { ok: true; changed: boolean }
  | { ok: false; code: GroupChangeErrorCode };

/** Trusted, server-derived input. No client offering id, no client date. */
export interface GroupChangeInput {
  studentId: string;
  courseOfferingId: string;
  targetCourseGroupId: string;
  /** Israel-local today (`YYYY-MM-DD`); the ONLY permitted effective date. */
  effectiveFrom: string;
}

// ============================================================================
// INTERNAL ROLLBACK SIGNAL
// ============================================================================

/**
 * Internal tagged error carrying a {@link GroupChangeErrorCode}. Thrown to force
 * the single transaction to roll back and mapped back to a public outcome at the
 * boundary. Never leaks outside this module.
 */
class GroupChangeTxError extends Error {
  readonly code: GroupChangeErrorCode;
  constructor(code: GroupChangeErrorCode) {
    super(code);
    this.name = "GroupChangeTxError";
    this.code = code;
  }
}

// ============================================================================
// PER-CALL ADAPTER
// ============================================================================

/**
 * A fresh per-call adapter binding the enrollment-scoped `GroupMembership`
 * delegate. Built INSIDE the transaction once the enrollment is resolved, so it
 * closes over the resolved `courseEnrollmentId` and never carries module-level
 * mutable state. Loads/inserts/updates GroupMembership rows and writes the
 * Student mirror — nothing else.
 */
interface GroupChangeAdapter {
  loadHistory(): Promise<IntervalRow<GroupMembershipValue>[]>;
  insertRow(effectiveFrom: Date, effectiveTo: Date | null, value: GroupMembershipValue): Promise<void>;
  updateRow(id: string, effectiveTo: Date | null, value: GroupMembershipValue): Promise<void>;
  updateStudentMirror(groupName: string, subgroupNumber: number): Promise<void>;
}

function createGroupChangeAdapter(
  tx: Prisma.TransactionClient,
  studentId: string,
  courseEnrollmentId: string,
): GroupChangeAdapter {
  return {
    async loadHistory() {
      const rows = await tx.groupMembership.findMany({
        where: { courseEnrollmentId },
        select: { id: true, courseGroupId: true, effectiveFrom: true, effectiveTo: true },
        orderBy: { effectiveFrom: "asc" },
      });
      return rows.map(
        (row): IntervalRow<GroupMembershipValue> => ({
          id: row.id,
          effectiveFrom: utcMidnightToDateKey(row.effectiveFrom),
          effectiveTo: row.effectiveTo === null ? null : utcMidnightToDateKey(row.effectiveTo),
          value: { courseGroupId: row.courseGroupId },
        }),
      );
    },
    async insertRow(effectiveFrom, effectiveTo, value) {
      await tx.groupMembership.create({
        data: { courseEnrollmentId, courseGroupId: value.courseGroupId, effectiveFrom, effectiveTo },
      });
    },
    async updateRow(id, effectiveTo, value) {
      await tx.groupMembership.update({
        where: { id },
        data: { courseGroupId: value.courseGroupId, effectiveTo },
      });
    },
    async updateStudentMirror(groupName, subgroupNumber) {
      await tx.student.update({ where: { id: studentId }, data: { groupName, subgroupNumber } });
    },
  };
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Return the single membership interval covering `today`, or throw
 * `MEMBERSHIP_STATE_INVALID` when zero or more than one row covers it (fail
 * closed on a missing or ambiguous current membership).
 */
function requireExactlyOneCovering(
  rows: readonly IntervalRow<GroupMembershipValue>[],
  today: DateKey,
): IntervalRow<GroupMembershipValue> {
  const covering = rows.filter((row) => {
    const startsOnOrBefore = compareDateKeys(row.effectiveFrom, today) <= 0;
    const endsAfter = row.effectiveTo === null || compareDateKeys(today, row.effectiveTo) < 0;
    return startsOnOrBefore && endsAfter;
  });
  if (covering.length !== 1) {
    throw new GroupChangeTxError("MEMBERSHIP_STATE_INVALID");
  }
  return covering[0];
}

/**
 * Resolve and structurally validate the target leaf CourseGroup against the
 * supplied current offering. Every failure — missing target, cross-offering
 * target, top-level (non-leaf) target, missing/empty parent, or a child name
 * that does not parse to a positive-integer subgroup — throws
 * `INVALID_TARGET_GROUP`. Returns the normalized {@link ResolvedTargetCourseGroup}.
 */
async function resolveTarget(
  tx: Prisma.TransactionClient,
  targetCourseGroupId: string,
  courseOfferingId: string,
): Promise<ResolvedTargetCourseGroup> {
  const target = await tx.courseGroup.findUnique({
    where: { id: targetCourseGroupId },
    select: {
      id: true,
      courseOfferingId: true,
      parentGroupId: true,
      name: true,
      parentGroup: { select: { id: true, name: true } },
    },
  });

  if (!target) {
    throw new GroupChangeTxError("INVALID_TARGET_GROUP");
  }
  // Cross-offering target: never move a trainee onto a group from another course.
  if (target.courseOfferingId !== courseOfferingId) {
    throw new GroupChangeTxError("INVALID_TARGET_GROUP");
  }
  // Top-level group: only leaf subgroups are valid move targets.
  if (target.parentGroupId === null || target.parentGroup === null) {
    throw new GroupChangeTxError("INVALID_TARGET_GROUP");
  }

  // Child name must parse to a strict positive integer subgroup; parent name
  // (the mirror's groupName) must be non-empty.
  const subgroupNumber = parsePositiveIntegerSubgroup(target.name);
  if (subgroupNumber === null) {
    throw new GroupChangeTxError("INVALID_TARGET_GROUP");
  }

  const validated = validateResolvedTarget({
    courseGroupId: target.id,
    courseOfferingId: target.courseOfferingId,
    parentGroupId: target.parentGroupId,
    groupName: target.parentGroup.name,
    subgroupNumber,
  });
  if (!validated.ok) {
    throw new GroupChangeTxError("INVALID_TARGET_GROUP");
  }
  return validated.value;
}

/** Strict positive-integer parse of a subgroup CourseGroup name (e.g. "1"). */
function parsePositiveIntegerSubgroup(name: string): number | null {
  if (!/^\d+$/.test(name.trim())) {
    return null;
  }
  const value = Number(name.trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** True for a Prisma unique-violation (P2002) — the enrollment+effectiveFrom key. */
function isDuplicateEffectiveFromError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

// ============================================================================
// PUBLIC SERVICE
// ============================================================================

/**
 * Change a trainee's group within the supplied CourseOffering, effective from
 * `input.effectiveFrom` (Israel-local today). Runs the EXACT locked transaction
 * order in ONE interactive transaction; any failure rolls the whole thing back
 * with zero writes.
 */
export async function writeTraineeGroupChange(input: GroupChangeInput): Promise<GroupChangeOutcome> {
  // Effective date must be a real date-only key (the action always supplies
  // Israel-local today; a malformed value is an invariant failure, not a write).
  if (!isValidDateKey(input.effectiveFrom)) {
    return { ok: false, code: "INVARIANT_FAILURE" };
  }
  const today: DateKey = input.effectiveFrom;

  try {
    return await prisma.$transaction(async (tx) => {
      // 1-3. lock + re-read the parent Student; require it exists and is active.
      await lockStudentForUpdate(tx, input.studentId);
      const student = await tx.student.findUnique({
        where: { id: input.studentId },
        select: { isActive: true, groupName: true, subgroupNumber: true },
      });
      if (!student) {
        throw new GroupChangeTxError("TRAINEE_NOT_FOUND");
      }
      if (!student.isActive) {
        throw new GroupChangeTxError("TRAINEE_INACTIVE");
      }

      // 4-5. resolve the CourseEnrollment by the exact compound key; require ACTIVE.
      const enrollment = await tx.courseEnrollment.findUnique({
        where: {
          studentId_courseOfferingId: {
            studentId: input.studentId,
            courseOfferingId: input.courseOfferingId,
          },
        },
        select: { id: true, status: true },
      });
      if (!enrollment) {
        throw new GroupChangeTxError("ENROLLMENT_NOT_FOUND");
      }
      if (enrollment.status !== "ACTIVE") {
        throw new GroupChangeTxError("ENROLLMENT_INACTIVE");
      }

      const adapter = createGroupChangeAdapter(tx, input.studentId, enrollment.id);

      // 6-8. load enrollment-scoped history; require exactly one row covers today.
      const history = await adapter.loadHistory();
      const covering = requireExactlyOneCovering(history, today);
      const currentCourseGroupId = covering.value.courseGroupId;

      // 9-11. resolve + validate the target leaf CourseGroup against the offering.
      const target = await resolveTarget(tx, input.targetCourseGroupId, input.courseOfferingId);

      // 12. decide NO_CHANGE vs APPLY_CHANGE on authoritative CourseGroup ids only.
      const decision = decideGroupChange(currentCourseGroupId, target);
      if (!decision.ok) {
        throw new GroupChangeTxError("INVALID_TARGET_GROUP");
      }

      // 13. same-group request → successful no-op, zero writes — but never hide
      //     a stale mirror. If the authoritative membership already equals the
      //     target yet the locked Student mirror disagrees, fail closed with
      //     zero writes rather than return success with broken parity.
      if (decision.decision === "NO_CHANGE") {
        const mirror = deriveGroupMirror(target);
        if (student.groupName !== mirror.groupName || student.subgroupNumber !== mirror.subgroupNumber) {
          throw new GroupChangeTxError("INVARIANT_FAILURE");
        }
        return { ok: true, changed: false };
      }

      // 14. plan + apply the interval write (cross-day close+insert; same-day
      //     correction updates today's row in place) via the frozen planner.
      const plan = planIntervalWrite<GroupMembershipValue>(history, {
        effectiveFrom: today,
        value: { courseGroupId: target.courseGroupId },
        newId: PLANNER_PLACEHOLDER_ID,
      });
      if (!plan.ok) {
        // Duplicate effectiveFrom and any other interval-invariant failure both
        // fail closed with zero committed writes.
        throw new GroupChangeTxError("INVARIANT_FAILURE");
      }
      for (const operation of plan.plan.operations) {
        if (operation.type === "insert") {
          await adapter.insertRow(
            dateKeyToUtcMidnight(operation.row.effectiveFrom),
            operation.row.effectiveTo === null ? null : dateKeyToUtcMidnight(operation.row.effectiveTo),
            operation.row.value,
          );
        } else if (operation.type === "update") {
          await adapter.updateRow(
            operation.id,
            operation.row.effectiveTo === null ? null : dateKeyToUtcMidnight(operation.row.effectiveTo),
            operation.row.value,
          );
        } else {
          // The write planner never emits deletes; treat any as unexpected.
          throw new GroupChangeTxError("TRANSACTION_FAILURE");
        }
      }

      // 15. update the Student compatibility mirror in the same transaction.
      const mirror = deriveGroupMirror(target);
      await adapter.updateStudentMirror(mirror.groupName, mirror.subgroupNumber);

      // 16. re-read and verify EVERY invariant before commit; any mismatch rolls back.
      const rereadHistory = await adapter.loadHistory();
      if (validateIntervalRows(rereadHistory).length > 0) {
        // no overlap / no duplicate effectiveFrom / well-formed intervals.
        throw new GroupChangeTxError("INVARIANT_FAILURE");
      }
      const rereadCovering = requireExactlyOneCovering(rereadHistory, today);
      // (courseEnrollmentId is guaranteed by the enrollment-scoped query, but we
      // assert the resolved membership targets the intended group + enrollment.)
      const rereadRow = await tx.groupMembership.findUnique({
        where: { id: rereadCovering.id },
        select: { courseEnrollmentId: true, courseGroupId: true },
      });
      if (
        !rereadRow ||
        rereadRow.courseEnrollmentId !== enrollment.id ||
        rereadRow.courseGroupId !== target.courseGroupId
      ) {
        throw new GroupChangeTxError("INVARIANT_FAILURE");
      }
      const freshStudent = await tx.student.findUnique({
        where: { id: input.studentId },
        select: { groupName: true, subgroupNumber: true },
      });
      if (!freshStudent || freshStudent.groupName === null || freshStudent.subgroupNumber === null) {
        throw new GroupChangeTxError("INVARIANT_FAILURE");
      }
      const parity = checkGroupChangeParity(
        {
          membershipCourseGroupId: rereadCovering.value.courseGroupId,
          mirror: { groupName: freshStudent.groupName, subgroupNumber: freshStudent.subgroupNumber },
        },
        target,
      );
      if (!parity.ok) {
        throw new GroupChangeTxError("INVARIANT_FAILURE");
      }

      return { ok: true, changed: true };
    });
  } catch (err) {
    if (err instanceof GroupChangeTxError) {
      return { ok: false, code: err.code };
    }
    // lockStudentForUpdate throws the engine's tagged error (TRAINEE_NOT_FOUND /
    // LOCK_FAILED); map onto this service's public codes.
    if (err instanceof TraineeHistoryTxError) {
      return { ok: false, code: err.code === "TRAINEE_NOT_FOUND" ? "TRAINEE_NOT_FOUND" : "TRANSACTION_FAILURE" };
    }
    if (isDuplicateEffectiveFromError(err)) {
      return { ok: false, code: "INVARIANT_FAILURE" };
    }
    return { ok: false, code: "TRANSACTION_FAILURE" };
  }
}
