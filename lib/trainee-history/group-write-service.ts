/**
 * Reusable effective-dated write service for trainee GROUP memberships
 * (Stage GH2A1).
 *
 * Thin domain wrapper over the shared engine in ./apply-plan: it supplies the
 * group `DomainWriteAdapter` (TraineeGroupMembership delegate wiring + Student
 * group cache), plugs normalize-group into the engine's pre-transaction step,
 * and exposes the public `writeTraineeGroupMembership` API. It adds no callers,
 * no UI, no auth, and never touches the Prisma schema.
 */

import { utcMidnightToDateKey } from "./israel-date";
import type { DateKey, IntervalRow } from "./interval-resolver";
import { normalizeGroup } from "./normalize-group";
import {
  runEffectiveDatedWrite,
  type DomainWriteAdapter,
  type WriteOutcome,
  type WritePolicy,
} from "./apply-plan";

/** The group cache/history value: mirrors Student.groupName/subgroupNumber. */
interface GroupValue {
  groupName: string | null;
  subgroupNumber: number | null;
}

const groupAdapter: DomainWriteAdapter<GroupValue> = {
  domain: "group",
  emptyValue: { groupName: null, subgroupNumber: null },
  valuesEqual(a, b) {
    return a.groupName === b.groupName && a.subgroupNumber === b.subgroupNumber;
  },
  enforceFieldPolicy() {
    // No field-level restriction for the group domain.
    return null;
  },
  async readLockedStudent(tx, studentId) {
    const student = await tx.student.findUnique({
      where: { id: studentId },
      select: { isActive: true, groupName: true, subgroupNumber: true },
    });
    if (!student) {
      return null;
    }
    return {
      isActive: student.isActive,
      cache: { groupName: student.groupName, subgroupNumber: student.subgroupNumber },
    };
  },
  async loadHistory(tx, studentId) {
    const rows = await tx.traineeGroupMembership.findMany({
      where: { studentId },
      select: {
        id: true,
        groupName: true,
        subgroupNumber: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
      orderBy: { effectiveFrom: "asc" },
    });
    return rows.map(
      (row): IntervalRow<GroupValue> => ({
        id: row.id,
        effectiveFrom: utcMidnightToDateKey(row.effectiveFrom),
        effectiveTo: row.effectiveTo === null ? null : utcMidnightToDateKey(row.effectiveTo),
        value: { groupName: row.groupName, subgroupNumber: row.subgroupNumber },
      }),
    );
  },
  async insertRow(tx, studentId, effectiveFrom, effectiveTo, value) {
    await tx.traineeGroupMembership.create({
      data: {
        studentId,
        groupName: value.groupName,
        subgroupNumber: value.subgroupNumber,
        effectiveFrom,
        effectiveTo,
      },
    });
  },
  async updateRow(tx, id, effectiveTo, value) {
    await tx.traineeGroupMembership.update({
      where: { id },
      data: {
        groupName: value.groupName,
        subgroupNumber: value.subgroupNumber,
        effectiveTo,
      },
    });
  },
  async updateStudentCache(tx, studentId, value) {
    await tx.student.update({
      where: { id: studentId },
      data: { groupName: value.groupName, subgroupNumber: value.subgroupNumber },
    });
  },
};

/**
 * Write a trainee group membership effective from `input.effectiveFrom`.
 *
 * `now` is a trusted explicit instant; the service derives Israel-local today
 * from it. The result never carries history rows, Prisma records, or ids.
 */
export function writeTraineeGroupMembership(
  input: {
    studentId: string;
    effectiveFrom: DateKey;
    groupName: "א" | "ב" | null;
    subgroupNumber: number | null;
  },
  policy: WritePolicy,
  now: Date,
): Promise<WriteOutcome> {
  return runEffectiveDatedWrite<GroupValue>({
    domain: "group",
    studentId: input.studentId,
    effectiveFrom: input.effectiveFrom,
    policy,
    now,
    normalize: () => {
      const result = normalizeGroup({
        groupName: input.groupName,
        subgroupNumber: input.subgroupNumber,
      });
      return result.ok ? { ok: true, value: result.value } : { ok: false, code: result.code };
    },
    adapter: groupAdapter,
  });
}
