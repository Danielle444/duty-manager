/**
 * Parent-row locking for dated trainee history writes (Stage GH2A1).
 *
 * Acquires the Student row lock (`SELECT ... FOR UPDATE`) INSIDE the caller's
 * interactive transaction so concurrent effective-dated writers for the same
 * trainee are serialized (no overlap / no duplicate effectiveFrom). Uses a
 * parameterized Prisma tagged-template query — never string interpolation.
 *
 * NOTE: the `TraineeHistoryTxError` import forms a deferred (function-body-only)
 * cycle with ./apply-plan; the class is referenced only at call time, after
 * both modules have finished evaluating, so it is safe under ESM live bindings.
 */

import { Prisma } from "@/app/generated/prisma/client";
import { TraineeHistoryTxError } from "./apply-plan";

/**
 * Lock the parent Student row `FOR UPDATE` within `tx`.
 *
 *  - query succeeds with no row  → throws `TRAINEE_NOT_FOUND`
 *  - query throws / times out / lock acquisition fails → throws `LOCK_FAILED`
 *  - row found → returns (caller continues inside the same transaction)
 *
 * Both failure modes throw the internal tagged error so the surrounding
 * transaction rolls back rather than committing partial work.
 */
export async function lockStudentForUpdate(
  tx: Prisma.TransactionClient,
  studentId: string,
): Promise<void> {
  let rows: Array<{ id: string }>;
  try {
    rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM students WHERE id = ${studentId} FOR UPDATE
    `;
  } catch {
    throw new TraineeHistoryTxError("LOCK_FAILED");
  }
  if (rows.length === 0) {
    throw new TraineeHistoryTxError("TRAINEE_NOT_FOUND");
  }
}
