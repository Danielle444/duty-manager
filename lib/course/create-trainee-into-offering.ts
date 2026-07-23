/**
 * MULTI-COURSE (Level-2-only new-trainee slice N1) - server-side IO for atomic
 * creation of a BRAND-NEW, INACTIVE-STAGED Student inside ONE exact PLANNED
 * CourseOffering.
 *
 * Two layers, mirroring the enroll-existing-trainee.ts convention:
 *   - createTraineeIntoOfferingWithDeps(input, deps): the DB-free DI orchestration
 *     - normalize input, run the whole proof+write body inside ONE injected
 *     interactive transaction (deps.transaction), and map the internal
 *     DuplicateIdentityError / any other thrown failure onto the stable result
 *     union. Unit-tested with a fake transaction (create-trainee-into-offering.test.ts).
 *   - createTraineeIntoOffering(input): the thin wrapper binding the real Prisma
 *     client. It builds a {@link CreateTraineeTxClient} over a real
 *     prisma.$transaction interactive transaction so every proof AND all three
 *     writes share one atomic scope. It creates exactly THREE rows (Student +
 *     CourseEnrollment + GroupMembership) and binds NO TraineeHorseAssignment and
 *     NO legacy TraineeGroupMembership writer.
 *
 * The offering is ALWAYS the exact id in `input.courseOfferingId`. This module
 * NEVER resolves an ACTIVE/current singleton, NEVER reads a selected-course
 * cookie, and NEVER selects an offering by name/level. Authorization is NOT done
 * here: this is admin-only infrastructure and a FUTURE server action must call
 * requireAdmin() (with an admin-validated route offering id) before invoking it.
 * There is deliberately NO activation path - the created Student stays inactive.
 */
import { prisma } from "@/lib/prisma";
import {
  DuplicateIdentityError,
  normalizeCreateTraineeInput,
  runCreateTraineeIntoOfferingInTx,
  type CreateTraineeIntoOfferingInput,
  type CreateTraineeIntoOfferingResult,
  type CreateTraineeTxClient,
} from "./create-trainee-into-offering-core";

export type {
  CreateTraineeIntoOfferingInput,
  CreateTraineeIntoOfferingResult,
  CreateTraineeIntoOfferingErrorCode,
} from "./create-trainee-into-offering-core";

/**
 * The injected transaction boundary: runs `fn` inside one atomic transaction,
 * passing it a transaction-scoped {@link CreateTraineeTxClient}. The real wrapper
 * binds prisma.$transaction; a test binds a fake that observes the flow without a
 * database.
 */
export interface CreateTraineeIntoOfferingDeps {
  transaction: <T>(fn: (tx: CreateTraineeTxClient) => Promise<T>) => Promise<T>;
}

/**
 * DB-free DI orchestration. Order:
 *   1. normalize/validate the input (pure) -> invalid_input, BEFORE opening a
 *      transaction;
 *   2. run the full proof+write body inside one injected transaction;
 *   3. map failures: the internal DuplicateIdentityError (a rolled-back concurrent
 *      unique violation on Student.identityNumber) -> duplicate_identity; any OTHER
 *      thrown failure (e.g. an enrollment/membership write error, which also rolled
 *      the transaction back) -> unexpected. Proof failures are returned by the body
 *      itself before any write, so they arrive here as a normal result value and
 *      are never mislabelled "unexpected".
 */
export async function createTraineeIntoOfferingWithDeps(
  input: CreateTraineeIntoOfferingInput,
  deps: CreateTraineeIntoOfferingDeps,
): Promise<CreateTraineeIntoOfferingResult> {
  const normalized = normalizeCreateTraineeInput(input);
  if (!normalized.ok) {
    return { success: false, error: "invalid_input" };
  }

  try {
    return await deps.transaction((tx) => runCreateTraineeIntoOfferingInTx(tx, normalized.value));
  } catch (error) {
    if (error instanceof DuplicateIdentityError) {
      return { success: false, error: "duplicate_identity" };
    }
    // Any other failure means the interactive transaction rolled back all writes;
    // surface a stable, non-PII code without echoing Prisma internals.
    return { success: false, error: "unexpected" };
  }
}

/**
 * Thin wrapper binding the real Prisma client. Every read AND all three writes
 * below run inside a single prisma.$transaction interactive transaction, so the
 * transaction-local proofs are authoritative and any failure rolls back every
 * write. The Prisma select shapes are kept inline so Prisma infers the exact row
 * payloads. No TraineeHorseAssignment and no legacy TraineeGroupMembership writer
 * is bound, and there is no student.update / activation binding.
 *
 * findLeafGroup is the compound ownership+leaf proof: id AND this offering AND
 * parentGroupId NOT null (a top-level group is never a valid target).
 * findStudentByIdentityNumber uses the Student.identityNumber unique.
 */
export async function createTraineeIntoOffering(
  input: CreateTraineeIntoOfferingInput,
): Promise<CreateTraineeIntoOfferingResult> {
  return createTraineeIntoOfferingWithDeps(input, {
    transaction: (fn) =>
      prisma.$transaction((tx) =>
        fn({
          findOffering: (courseOfferingId) =>
            tx.courseOffering.findUnique({
              where: { id: courseOfferingId },
              select: { id: true, status: true, startDate: true },
            }),
          findLeafGroup: (courseGroupId, courseOfferingId) =>
            tx.courseGroup.findFirst({
              where: {
                id: courseGroupId,
                courseOfferingId,
                parentGroupId: { not: null },
              },
              select: { id: true },
            }),
          findStudentByIdentityNumber: (identityNumber) =>
            tx.student.findUnique({
              where: { identityNumber },
              select: { id: true },
            }),
          createStudent: (data) => tx.student.create({ data, select: { id: true } }),
          createEnrollment: (data) => tx.courseEnrollment.create({ data, select: { id: true } }),
          createMembership: (data) => tx.groupMembership.create({ data, select: { id: true } }),
        }),
      ),
  });
}
