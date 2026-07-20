"use server";

// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3B - Move/Swap server action) - the
// DORMANT transactional wiring on top of the committed Stage-3A pure core
// (lib/riding-complex-schedule-board/move-swap.ts) and the Stage-3B pure
// write-plan adapter (lib/riding-complex-schedule-board/move-swap-write-plan.ts).
//
// No UI/component/action imports these wrappers yet (Stage 3C wires them). This
// stage adds NO route and changes NO current behavior. It exists to prove the
// transaction, lock, plan-read, pure-core invocation, targeted persistence,
// version guard, and authorization all compose correctly - fully offline, with
// DB-free contract tests only.
//
// TRANSACTION SHAPE (one interactive transaction, in this exact order):
//   1. pg_advisory_xact_lock(hashtext(ridingSlotId)) - the FIRST in-tx statement,
//      the same transaction-scoped key convention createComplexPlanInternal and
//      saveRidingSlotHorseListInternal use. It serializes two Move/Swaps for one
//      slot (and against plan/simple-list CREATION), so they can never both read
//      the same version and race.
//   2. Re-read the COMPLETE plan tree (id/version/blocks->stations->pairs, only
//      Stage-3A fields) inside the tx, scoped by exact ridingSlotId, via `tx`.
//   3. Convert the Prisma tree explicitly to ComplexPlanInput (no broad spreads).
//   4. Call applyComplexPlanMoveSwap exactly once. Any failure -> zero writes, no
//      version bump, one stable non-PII reason code.
//   5. On success: build the pure write plan and apply ONLY its targeted row
//      updates (never the whole plan, never delete/recreate).
//   6. Conditional version guard: updateMany WHERE version === the just-read
//      version, incrementing exactly once. count === 0 -> a concurrent writer
//      moved the version -> throw -> the whole transaction (including the pair
//      updates above) rolls back. This is what makes an interleaving with a
//      NON-cooperating full-station/block writer fail closed instead of
//      overwriting: every sibling writer in riding-slot-complex.ts bumps
//      `version` in the same tx as its mutation, so any committed sibling change
//      trips this guard.
//
// IDENTITY LIMITATION (known, deliberate): the instructor wrapper trusts the
// client-asserted instructorId, then RE-READS that Instructor server-side and
// requires isActive && canEditRidingNotes - the exact same established contract
// as every sibling instructor writer in riding-slot-complex.ts. It is NOT a
// cookie-auth actor. A partial cookie-auth cutover is explicitly out of scope
// for this task; the whole complex-plan write surface shares this limitation and
// must be migrated together, not one action at a time.

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  applyComplexPlanMoveSwap,
  type ComplexPlanInput,
  type ComplexPlanMoveSwapAffected,
  type ComplexPlanMoveSwapCommand,
  type ComplexPlanMoveSwapOperation,
  type ComplexPlanMoveSwapReason,
} from "@/lib/riding-complex-schedule-board/move-swap";
import { buildComplexPlanWritePlan } from "@/lib/riding-complex-schedule-board/move-swap-write-plan";

// Generic, non-PII Hebrew messages. The precise, stable machine reason travels
// in `reason` so Stage 3C can map it to a specific message without this action
// having to invent a Hebrew string per reason code now.
const GENERIC_CONFLICT = "התכנון עודכן בינתיים - נסי לרענן את העמוד ולנסות שוב.";
const GENERIC_INVALID = "פעולה לא תקינה. נסי לרענן את העמוד.";
const LOCK_TIMEOUT = "המערכת עמוסה כרגע - נסי שוב בעוד רגע";
const NO_PERMISSION = "אין הרשאה לערוך תכנון רכיבה מורכבת";

// The stable, opaque machine reason for a Move/Swap action outcome. A superset
// of the pure core's reasons plus the transaction-layer outcomes. Safe to log;
// never contains an id, name, horse, or note.
export type ComplexPlanMoveSwapActionReason =
  | ComplexPlanMoveSwapReason
  | "NOT_AUTHORIZED"
  | "INVALID_INPUT"
  | "PLAN_NOT_FOUND"
  | "LOCK_TIMEOUT"
  | "INTERNAL";

export interface ComplexPlanMoveSwapActionResult {
  success: boolean;
  /** Generic, user-safe Hebrew message (never PII). */
  error?: string;
  /** Stable machine reason for Stage 3C's precise UI mapping / logging. */
  reason?: ComplexPlanMoveSwapActionReason;
  /** The applied operation (present on success). */
  operation?: ComplexPlanMoveSwapOperation;
  /** The new persisted plan version (present on success). Stage 3C can reload the
   *  authoritative editing DTO through the committed reader
   *  (getRidingSlotComplexPlanForAdmin / ...ForInstructor) rather than this
   *  narrow action duplicating that heavy query on every move. */
  version?: number;
  /** The block/station/pair ids the operation changed (present on success). */
  affected?: ComplexPlanMoveSwapAffected;
}

// A Prisma error carrying a `.code` (P2028 lock timeout, P2025 record-not-found,
// P2003 FK violation) - duck-typed exactly like the P2002/P2028 checks already
// used across this app (e.g. lib/actions/weekly-feedback.ts).
function prismaErrorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
    return (err as { code: string }).code;
  }
  return null;
}

// Thrown from inside the tx callback AFTER targeted writes to force a rollback
// when the conditional version guard matches zero rows (a concurrent, committed
// sibling writer moved the version). Carries its own stable reason; caught by
// the outer mapper so no partial write is ever committed.
class MoveSwapRollback extends Error {
  constructor(readonly actionReason: ComplexPlanMoveSwapActionReason) {
    super(actionReason);
    this.name = "MoveSwapRollback";
  }
}

// Convert the freshly-read (post-lock, in-tx) Prisma tree explicitly to the pure
// core's ComplexPlanInput. No spread of broad Prisma objects; every field is
// named, nullable values preserved, order deterministic (the read orders every
// level by sortOrder then createdAt).
function toComplexPlanInput(planRow: PlanReadRow): ComplexPlanInput {
  return {
    id: planRow.id,
    version: planRow.version,
    blocks: planRow.blocks.map((block) => ({
      id: block.id,
      stations: block.stations.map((station) => ({
        id: station.id,
        instructorId: station.instructorId,
        arena: station.arena,
        sortOrder: station.sortOrder,
        pairs: station.pairs.map((pair) => ({
          id: pair.id,
          trainee1Id: pair.trainee1Id,
          trainee2Id: pair.trainee2Id,
          horseName: pair.horseName,
          note: pair.note,
          sortOrder: pair.sortOrder,
        })),
      })),
    })),
  };
}

// The exact, minimal read shape (only Stage-3A fields). No publication, feedback,
// notes beyond pair.note, audit-display data, names, CourseOffering fallback, or
// unrelated relations.
type PlanReadRow = {
  id: string;
  version: number;
  blocks: {
    id: string;
    stations: {
      id: string;
      instructorId: string | null;
      arena: string | null;
      sortOrder: number;
      pairs: {
        id: string;
        trainee1Id: string | null;
        trainee2Id: string | null;
        horseName: string | null;
        note: string | null;
        sortOrder: number;
      }[];
    }[];
  }[];
};

const PLAN_READ_SELECT = {
  id: true,
  version: true,
  blocks: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    select: {
      id: true,
      stations: {
        orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
        select: {
          id: true,
          instructorId: true,
          arena: true,
          sortOrder: true,
          pairs: {
            orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
            select: {
              id: true,
              trainee1Id: true,
              trainee2Id: true,
              horseName: true,
              note: true,
              sortOrder: true,
            },
          },
        },
      },
    },
  },
};

// The dual-actor metadata written alongside the version bump, same shape/
// convention as actorWriteFields in riding-slot-complex.ts.
interface MoveSwapActor {
  updatedByInstructorId: string | null;
  updatedByAdminEmail: string | null;
  updatedByAdminName: string | null;
  updatedByName: string;
}

// Map a pure-core failure reason to a generic user message. Every core reason is
// non-PII already; the machine reason is passed through untouched.
function failureMessage(reason: ComplexPlanMoveSwapReason): string {
  switch (reason) {
    case "INVALID_COMMAND":
    case "MALFORMED_PLAN":
      return GENERIC_INVALID;
    default:
      // Every other reason (stale/occupied/duplicate/same-*/nothing-to-move/...)
      // is a "state changed or invalid target" case the user resolves by
      // refreshing and retrying.
      return GENERIC_CONFLICT;
  }
}

// ---------------------------------------------------------------------------
// The ONE private internal mutation implementation. Not exported (no
// client-callable bypass); both wrappers below authorize first, then delegate
// here with an already-resolved, server-trusted actor.
// ---------------------------------------------------------------------------

async function applyComplexPlanMoveSwapInternal(
  ridingSlotId: unknown,
  command: unknown,
  actor: MoveSwapActor
): Promise<ComplexPlanMoveSwapActionResult> {
  // Input safety: normalize the slot id and reject malformed/empty fail-closed
  // with a stable generic code. The command itself is validated by the pure core
  // (below) - its unsafe runtime fields are never dereferenced here first.
  const normalizedSlotId = typeof ridingSlotId === "string" ? ridingSlotId.trim() : "";
  if (normalizedSlotId.length === 0) {
    return { success: false, error: GENERIC_INVALID, reason: "INVALID_INPUT" };
  }

  try {
    const txResult = await prisma.$transaction(async (tx) => {
      // (1) Advisory lock FIRST - transaction-scoped, auto-released at
      // commit/rollback, safe under pooled connections. No global-prisma call is
      // made anywhere inside this callback.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${normalizedSlotId}))`;

      // (2) Complete plan re-read AFTER the lock, scoped by exact ridingSlotId.
      const planRow = (await tx.ridingSlotComplexPlan.findUnique({
        where: { ridingSlotId: normalizedSlotId },
        select: PLAN_READ_SELECT,
      })) as PlanReadRow | null;
      if (!planRow) {
        return { ok: false as const, reason: "PLAN_NOT_FOUND" as const };
      }

      // (3) Explicit conversion to the pure input shape.
      const planInput = toComplexPlanInput(planRow);

      // (4) Pure core exactly once. It re-checks command.expectedVersion against
      // this in-tx plan.version (STALE_PLAN on mismatch) and validates the
      // command shape (INVALID_COMMAND) - never throwing for malformed input.
      const pure = applyComplexPlanMoveSwap(planInput, command as ComplexPlanMoveSwapCommand);
      if (!pure.ok) {
        // No write has happened; safe to return (read-only + lock commit).
        return { ok: false as const, reason: pure.reason, operation: pure.operation };
      }

      // (5) Pure write plan -> targeted writes only. A malformed success shape
      // (an affected id missing from nextPlan) fails closed before any write.
      const built = buildComplexPlanWritePlan(pure.operation, pure.nextPlan, pure.affected);
      if (!built.ok) {
        return { ok: false as const, reason: "INTERNAL" as const, operation: pure.operation };
      }
      const writePlan = built.writePlan;

      for (const u of writePlan.pairTraineeUpdates) {
        await tx.ridingSlotComplexPair.update({
          where: { id: u.pairId },
          data: { trainee1Id: u.trainee1Id, trainee2Id: u.trainee2Id },
        });
      }
      for (const u of writePlan.pairHorseUpdates) {
        await tx.ridingSlotComplexPair.update({
          where: { id: u.pairId },
          data: { horseName: u.horseName },
        });
      }
      for (const u of writePlan.pairPlacementUpdates) {
        await tx.ridingSlotComplexPair.update({
          where: { id: u.pairId },
          data: { stationId: u.stationId, sortOrder: u.sortOrder },
        });
      }
      for (const u of writePlan.stationInstructorUpdates) {
        await tx.ridingSlotComplexStation.update({
          where: { id: u.stationId },
          data: { instructorId: u.instructorId },
        });
      }

      // (6) Conditional version guard + actor metadata, incremented exactly once.
      // WHERE version === the just-read version, so a concurrent committed writer
      // that bumped it makes this match zero rows -> throw -> rollback everything
      // above (never persist nextPlan.version verbatim; never overwrite).
      const bumped = await tx.ridingSlotComplexPlan.updateMany({
        where: { id: planRow.id, version: planRow.version },
        data: {
          version: { increment: 1 },
          updatedByInstructorId: actor.updatedByInstructorId,
          updatedByAdminEmail: actor.updatedByAdminEmail,
          updatedByAdminName: actor.updatedByAdminName,
          updatedByName: actor.updatedByName,
        },
      });
      if (bumped.count === 0) {
        throw new MoveSwapRollback("STALE_PLAN");
      }

      return {
        ok: true as const,
        operation: pure.operation,
        version: planRow.version + 1,
        affected: pure.affected,
      };
    });

    if (!txResult.ok) {
      const reason = txResult.reason;
      const error =
        reason === "PLAN_NOT_FOUND"
          ? GENERIC_CONFLICT
          : reason === "INTERNAL"
            ? GENERIC_INVALID
            : failureMessage(reason);
      return { success: false, error, reason, operation: txResult.operation ?? undefined };
    }

    // Revalidate only the existing relevant paths, same convention as every
    // sibling writer. No automatic (re)publish - an existing publication becomes
    // STALE purely through the version increment above.
    revalidatePath("/admin/weekly-schedule");
    revalidatePath("/instructor");

    return {
      success: true,
      operation: txResult.operation,
      version: txResult.version,
      affected: txResult.affected,
    };
  } catch (err) {
    if (err instanceof MoveSwapRollback) {
      return { success: false, error: GENERIC_CONFLICT, reason: err.actionReason };
    }
    const code = prismaErrorCode(err);
    if (code === "P2028") {
      return { success: false, error: LOCK_TIMEOUT, reason: "LOCK_TIMEOUT" };
    }
    // P2025 (a targeted row vanished under us) / P2003 (a trainee/instructor FK
    // was SetNull-deleted mid-flight): a concurrent change removed a referenced
    // row - fail closed as a stale reference, never a partial write.
    if (code === "P2025" || code === "P2003") {
      return { success: false, error: GENERIC_CONFLICT, reason: "STALE_REFERENCE" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Admin wrapper: requireAdmin() FIRST, then delegate to the one internal.
// ---------------------------------------------------------------------------

export async function applyComplexPlanMoveSwapAsAdmin(
  ridingSlotId: string,
  command: ComplexPlanMoveSwapCommand
): Promise<ComplexPlanMoveSwapActionResult> {
  const admin = await requireAdmin();
  return applyComplexPlanMoveSwapInternal(ridingSlotId, command, {
    updatedByInstructorId: null,
    updatedByAdminEmail: admin.email,
    updatedByAdminName: admin.name ?? null,
    updatedByName: admin.name ?? admin.email,
  });
}

// ---------------------------------------------------------------------------
// Instructor wrapper: same established edit tier as every sibling complex-plan
// write. Re-read the Instructor server-side; require isActive === true AND
// canEditRidingNotes === true. NEVER trust a client canEdit flag. Then delegate
// to the one internal. (See the IDENTITY LIMITATION note at the top of the file
// re: the client-asserted instructorId this contract deliberately mirrors.)
// ---------------------------------------------------------------------------

export async function applyComplexPlanMoveSwapAsInstructor(
  instructorId: string,
  ridingSlotId: string,
  command: ComplexPlanMoveSwapCommand
): Promise<ComplexPlanMoveSwapActionResult> {
  const trimmedInstructorId = typeof instructorId === "string" ? instructorId.trim() : "";
  if (trimmedInstructorId.length === 0) {
    return { success: false, error: NO_PERMISSION, reason: "NOT_AUTHORIZED" };
  }
  const instructor = await prisma.instructor.findUnique({ where: { id: trimmedInstructorId } });
  if (!instructor || instructor.isActive !== true || instructor.canEditRidingNotes !== true) {
    return { success: false, error: NO_PERMISSION, reason: "NOT_AUTHORIZED" };
  }
  return applyComplexPlanMoveSwapInternal(ridingSlotId, command, {
    updatedByInstructorId: instructor.id,
    updatedByAdminEmail: null,
    updatedByAdminName: null,
    updatedByName: instructor.fullName,
  });
}
