/**
 * Reusable effective-dated write service for trainee HORSE assignments
 * (Stage GH2A1).
 *
 * Thin domain wrapper over the shared engine in ./apply-plan: it supplies the
 * horse `DomainWriteAdapter` (TraineeHorseAssignment delegate wiring + Student
 * horse cache), plugs normalize-horse into the engine's pre-transaction step,
 * delegates field-level enforcement to enforceHorseFieldPolicy, and exposes the
 * public `writeTraineeHorseAssignment` API. It adds no callers, no UI, no auth,
 * and never touches the Prisma schema.
 */

import { utcMidnightToDateKey } from "./israel-date";
import type { DateKey, IntervalRow } from "./interval-resolver";
import { normalizeHorse } from "./normalize-horse";
import {
  enforceHorseFieldPolicy,
  runEffectiveDatedWrite,
  type DomainWriteAdapter,
  type WriteOutcome,
  type WritePolicy,
} from "./apply-plan";

/** The horse cache/history value: the three canonical horse cache fields. */
interface HorseValue {
  assignedHorseName: string | null;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
}

const horseAdapter: DomainWriteAdapter<HorseValue> = {
  domain: "horse",
  emptyValue: { assignedHorseName: null, hasPrivateHorse: false, privateHorseName: null },
  valuesEqual(a, b) {
    return (
      a.assignedHorseName === b.assignedHorseName &&
      a.hasPrivateHorse === b.hasPrivateHorse &&
      a.privateHorseName === b.privateHorseName
    );
  },
  enforceFieldPolicy(policy, lockedCache, requested) {
    return enforceHorseFieldPolicy(policy, lockedCache, requested);
  },
  async readLockedStudent(tx, studentId) {
    const student = await tx.student.findUnique({
      where: { id: studentId },
      select: {
        isActive: true,
        assignedHorseName: true,
        hasPrivateHorse: true,
        privateHorseName: true,
      },
    });
    if (!student) {
      return null;
    }
    return {
      isActive: student.isActive,
      cache: {
        assignedHorseName: student.assignedHorseName,
        hasPrivateHorse: student.hasPrivateHorse,
        privateHorseName: student.privateHorseName,
      },
    };
  },
  async loadHistory(tx, studentId) {
    const rows = await tx.traineeHorseAssignment.findMany({
      where: { studentId },
      select: {
        id: true,
        assignedHorseName: true,
        hasPrivateHorse: true,
        privateHorseName: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
      orderBy: { effectiveFrom: "asc" },
    });
    return rows.map(
      (row): IntervalRow<HorseValue> => ({
        id: row.id,
        effectiveFrom: utcMidnightToDateKey(row.effectiveFrom),
        effectiveTo: row.effectiveTo === null ? null : utcMidnightToDateKey(row.effectiveTo),
        value: {
          assignedHorseName: row.assignedHorseName,
          hasPrivateHorse: row.hasPrivateHorse,
          privateHorseName: row.privateHorseName,
        },
      }),
    );
  },
  async insertRow(tx, studentId, effectiveFrom, effectiveTo, value) {
    await tx.traineeHorseAssignment.create({
      data: {
        studentId,
        assignedHorseName: value.assignedHorseName,
        hasPrivateHorse: value.hasPrivateHorse,
        privateHorseName: value.privateHorseName,
        effectiveFrom,
        effectiveTo,
      },
    });
  },
  async updateRow(tx, id, effectiveTo, value) {
    await tx.traineeHorseAssignment.update({
      where: { id },
      data: {
        assignedHorseName: value.assignedHorseName,
        hasPrivateHorse: value.hasPrivateHorse,
        privateHorseName: value.privateHorseName,
        effectiveTo,
      },
    });
  },
  async updateStudentCache(tx, studentId, value) {
    await tx.student.update({
      where: { id: studentId },
      data: {
        assignedHorseName: value.assignedHorseName,
        hasPrivateHorse: value.hasPrivateHorse,
        privateHorseName: value.privateHorseName,
      },
    });
  },
};

/**
 * Write a trainee horse assignment effective from `input.effectiveFrom`.
 *
 * `now` is a trusted explicit instant; the service derives Israel-local today
 * from it. The result never carries history rows, Prisma records, or ids.
 */
export function writeTraineeHorseAssignment(
  input: {
    studentId: string;
    effectiveFrom: DateKey;
    assignedHorseName: string | null;
    hasPrivateHorse: boolean;
    privateHorseName: string | null;
  },
  policy: WritePolicy,
  now: Date,
): Promise<WriteOutcome> {
  return runEffectiveDatedWrite<HorseValue>({
    domain: "horse",
    studentId: input.studentId,
    effectiveFrom: input.effectiveFrom,
    policy,
    now,
    normalize: () => {
      const result = normalizeHorse({
        assignedHorseName: input.assignedHorseName,
        hasPrivateHorse: input.hasPrivateHorse,
        privateHorseName: input.privateHorseName,
      });
      return result.ok ? { ok: true, value: result.value } : { ok: false, code: result.code };
    },
    adapter: horseAdapter,
  });
}
