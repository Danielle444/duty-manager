/**
 * Effective-dated write engine + locked public contract for dated trainee
 * history (Stage GH2A1).
 *
 * This module owns:
 *  - the LOCKED public types (actor kinds, domains, policy, outcome, error set);
 *  - the pure PRE-TRANSACTION validation (policy shape, actor/domain, cutover +
 *    effectiveFrom date-key validity, normalization dispatch, before-cutover,
 *    Israel-local today derivation, actor-specific future-date rules);
 *  - the single interactive transaction that locks the parent Student row, runs
 *    the FROZEN GH1A interval planner, applies the plan, synchronizes the
 *    Student compatibility cache to today's resolved value, and re-verifies
 *    history/cache agreement before commit.
 *
 * It never imports UI/actions/auth, adds callers, wires revalidatePath, exposes
 * history rows / Prisma records / persisted ids, or implements a delete API.
 * The GH1A primitives and the Prisma schema are consumed UNCHANGED.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import {
  compareDateKeys,
  isValidDateKey,
  resolveIntervalAtDate,
  type DateKey,
  type IntervalRow,
} from "./interval-resolver";
import { planIntervalWrite, validateIntervalRows } from "./interval-update";
import { dateKeyToUtcMidnight, israelDateKeyFromInstant } from "./israel-date";
import { lockStudentForUpdate } from "./parent-lock";

// ============================================================================
// LOCKED PUBLIC TYPES
// ============================================================================

export type ActorKind = "admin" | "instructor" | "trainee";

export type WriteDomain = "group" | "horse";

export type HorseField = "assignedHorseName" | "hasPrivateHorse" | "privateHorseName";

/**
 * The trusted, explicit write policy. `cutover` is the EARLIEST permitted
 * effective date — NOT "today", never defaulted, never read from env, the
 * system clock, or UTC. `actorId` is intentionally absent (identity is resolved
 * by the caller, never here).
 */
export interface WritePolicy {
  actorKind: ActorKind;
  allowFutureEffectiveDates: boolean;
  allowedDomain: WriteDomain;
  allowedHorseFields?: readonly HorseField[];
  cutover: DateKey;
}

/** The only public error codes. No alternative names are ever exposed. */
export type PublicErrorCode =
  | "TRAINEE_NOT_FOUND"
  | "TRAINEE_INACTIVE"
  | "INVALID_GROUP"
  | "INVALID_SUBGROUP"
  | "INVALID_HORSE_STATE"
  | "BEFORE_CUTOVER"
  | "INSTRUCTOR_FUTURE_CHANGE"
  | "TRAINEE_FUTURE_CHANGE"
  | "LOCK_FAILED"
  | "DUPLICATE_EFFECTIVE_FROM"
  | "INTERVAL_INVARIANT_FAILURE"
  | "TRANSACTION_FAILURE"
  | "CACHE_MISMATCH"
  | "UNAUTHORIZED_ACTOR";

/** The minimal public result. Never carries rows, records, or ids. */
export type WriteOutcome =
  | { ok: true; resolvedTodayChanged: boolean }
  | { ok: false; code: PublicErrorCode };

// ============================================================================
// INTERNAL ROLLBACK SIGNAL
// ============================================================================

/**
 * Internal tagged error carrying a {@link PublicErrorCode}. Thrown to force the
 * interactive transaction to roll back (so an in-transaction failure never
 * commits partial work) and mapped back to a public outcome at the boundary.
 * Never leaks outside this module.
 */
export class TraineeHistoryTxError extends Error {
  readonly code: PublicErrorCode;
  constructor(code: PublicErrorCode) {
    super(code);
    this.name = "TraineeHistoryTxError";
    this.code = code;
  }
}

/**
 * Correlation-only placeholder id handed to the GH1A planner for a would-be
 * insert. It is NEVER persisted as the Prisma row id (inserts omit `id` so
 * `@default(cuid())` generates it) and NEVER surfaces in a {@link WriteOutcome}.
 */
export const PLANNER_PLACEHOLDER_ID = "__gh2a1_new_interval__";

/** Build the (only) success outcome shape. */
export function successOutcome(resolvedTodayChanged: boolean): WriteOutcome {
  return { ok: true, resolvedTodayChanged };
}

// ============================================================================
// PURE POLICY / PRE-TRANSACTION VALIDATION
// ============================================================================

const VALID_ACTOR_KINDS: readonly ActorKind[] = ["admin", "instructor", "trainee"];
const VALID_DOMAINS: readonly WriteDomain[] = ["group", "horse"];
const VALID_HORSE_FIELDS: readonly HorseField[] = [
  "assignedHorseName",
  "hasPrivateHorse",
  "privateHorseName",
];

/**
 * Validate the structural SHAPE of a policy (types/enums only). Does NOT check
 * whether `cutover` is a real calendar date — that is a separate step mapped to
 * `INTERVAL_INVARIANT_FAILURE`, not `UNAUTHORIZED_ACTOR`.
 */
export function validatePolicyShape(policy: unknown): policy is WritePolicy {
  if (typeof policy !== "object" || policy === null) {
    return false;
  }
  const p = policy as Record<string, unknown>;
  if (!VALID_ACTOR_KINDS.includes(p.actorKind as ActorKind)) {
    return false;
  }
  if (!VALID_DOMAINS.includes(p.allowedDomain as WriteDomain)) {
    return false;
  }
  if (typeof p.allowFutureEffectiveDates !== "boolean") {
    return false;
  }
  if (typeof p.cutover !== "string") {
    return false;
  }
  if (p.allowedHorseFields !== undefined) {
    if (!Array.isArray(p.allowedHorseFields)) {
      return false;
    }
    for (const field of p.allowedHorseFields) {
      if (!VALID_HORSE_FIELDS.includes(field as HorseField)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Validate the actor/domain combination against the invoked service domain.
 * Wrong domain → `UNAUTHORIZED_ACTOR`. Trainee is horse-only and MUST carry an
 * `allowedHorseFields` list (default-deny; omission → `UNAUTHORIZED_ACTOR`).
 */
export function validateActorDomain(
  policy: WritePolicy,
  invokedDomain: WriteDomain,
): PublicErrorCode | null {
  if (policy.allowedDomain !== invokedDomain) {
    return "UNAUTHORIZED_ACTOR";
  }
  if (policy.actorKind === "trainee") {
    if (invokedDomain !== "horse") {
      return "UNAUTHORIZED_ACTOR";
    }
    if (policy.allowedHorseFields === undefined) {
      return "UNAUTHORIZED_ACTOR";
    }
  }
  return null;
}

/**
 * Enforce actor-specific future-date rules for `effectiveFrom` relative to the
 * Israel-local `today`. A non-future date is always permitted here. Admin
 * future writes require `allowFutureEffectiveDates`; instructor/trainee future
 * writes are their own dedicated codes.
 */
export function checkFutureEffectiveDate(
  policy: WritePolicy,
  effectiveFrom: DateKey,
  today: DateKey,
): PublicErrorCode | null {
  if (compareDateKeys(effectiveFrom, today) <= 0) {
    return null;
  }
  if (policy.actorKind === "admin") {
    return policy.allowFutureEffectiveDates ? null : "UNAUTHORIZED_ACTOR";
  }
  if (policy.actorKind === "instructor") {
    return "INSTRUCTOR_FUTURE_CHANGE";
  }
  return "TRAINEE_FUTURE_CHANGE";
}

/**
 * Field-level horse-change gate. When `allowedHorseFields` is present (mandatory
 * for trainees; optional field-restriction for admin/instructor), any changed
 * cache field NOT in the allow-list → `UNAUTHORIZED_ACTOR`. Only the three horse
 * cache fields are compared. Omission for admin/instructor means "no field-level
 * restriction".
 */
export function enforceHorseFieldPolicy(
  policy: WritePolicy,
  locked: { assignedHorseName: string | null; hasPrivateHorse: boolean; privateHorseName: string | null },
  requested: { assignedHorseName: string | null; hasPrivateHorse: boolean; privateHorseName: string | null },
): PublicErrorCode | null {
  if (policy.allowedHorseFields === undefined) {
    return null;
  }
  const allowed = new Set<HorseField>(policy.allowedHorseFields);
  const changed: HorseField[] = [];
  if (locked.assignedHorseName !== requested.assignedHorseName) {
    changed.push("assignedHorseName");
  }
  if (locked.hasPrivateHorse !== requested.hasPrivateHorse) {
    changed.push("hasPrivateHorse");
  }
  if (locked.privateHorseName !== requested.privateHorseName) {
    changed.push("privateHorseName");
  }
  for (const field of changed) {
    if (!allowed.has(field)) {
      return "UNAUTHORIZED_ACTOR";
    }
  }
  return null;
}

/** Result of the pure pre-transaction phase (no DB was touched). */
export type PreTransactionResult<V> =
  | { ok: true; policy: WritePolicy; effectiveFrom: DateKey; today: DateKey; value: V }
  | { ok: false; code: PublicErrorCode };

/**
 * Run the EXACT pre-transaction order (no DB access). No transaction may open
 * until every one of these pure checks passes:
 *   1. policy shape                → UNAUTHORIZED_ACTOR
 *   2. actor/domain combination    → UNAUTHORIZED_ACTOR
 *   3. cutover DateKey validity    → INTERVAL_INVARIANT_FAILURE
 *   4. effectiveFrom DateKey valid → INTERVAL_INVARIANT_FAILURE
 *   5. normalize domain input      → INVALID_GROUP / INVALID_SUBGROUP / INVALID_HORSE_STATE
 *   6. reject before cutover       → BEFORE_CUTOVER
 *   7. derive Israel-local today from the trusted `now`
 *   8. actor-specific future rules → INSTRUCTOR_FUTURE_CHANGE / TRAINEE_FUTURE_CHANGE / UNAUTHORIZED_ACTOR
 */
export function preparePreTransaction<V>(args: {
  domain: WriteDomain;
  policy: unknown;
  effectiveFrom: unknown;
  now: Date;
  normalize: () => { ok: true; value: V } | { ok: false; code: PublicErrorCode };
}): PreTransactionResult<V> {
  // 1. policy shape
  if (!validatePolicyShape(args.policy)) {
    return { ok: false, code: "UNAUTHORIZED_ACTOR" };
  }
  const policy = args.policy;

  // 2. actor/domain combination
  const actorError = validateActorDomain(policy, args.domain);
  if (actorError) {
    return { ok: false, code: actorError };
  }

  // 3. cutover as DateKey
  if (!isValidDateKey(policy.cutover)) {
    return { ok: false, code: "INTERVAL_INVARIANT_FAILURE" };
  }

  // 4. effectiveFrom as DateKey
  if (!isValidDateKey(args.effectiveFrom)) {
    return { ok: false, code: "INTERVAL_INVARIANT_FAILURE" };
  }
  const effectiveFrom = args.effectiveFrom;

  // 5. normalize domain input
  const normalized = args.normalize();
  if (!normalized.ok) {
    return { ok: false, code: normalized.code };
  }

  // 6. reject effectiveFrom before cutover
  if (compareDateKeys(effectiveFrom, policy.cutover) < 0) {
    return { ok: false, code: "BEFORE_CUTOVER" };
  }

  // 7. derive Israel-local today from the trusted instant
  let today: DateKey;
  try {
    today = israelDateKeyFromInstant(args.now);
  } catch {
    return { ok: false, code: "INTERVAL_INVARIANT_FAILURE" };
  }

  // 8. actor-specific future-date rules
  const futureError = checkFutureEffectiveDate(policy, effectiveFrom, today);
  if (futureError) {
    return { ok: false, code: futureError };
  }

  return { ok: true, policy, effectiveFrom, today, value: normalized.value };
}

// ============================================================================
// DOMAIN ADAPTER + TRANSACTION ENGINE
// ============================================================================

/**
 * Domain-specific persistence adapter. The engine is generic over the value
 * payload `V`; each domain (group/horse) supplies the Prisma delegate wiring,
 * the cache read/compare, the field-policy gate, and the cache write.
 */
export interface DomainWriteAdapter<V> {
  readonly domain: WriteDomain;
  /** Canonical "empty" value used when today has no covering row. */
  readonly emptyValue: V;
  valuesEqual(a: V, b: V): boolean;
  /** Field-level gate (horse); group returns `null` (no field restriction). */
  enforceFieldPolicy(policy: WritePolicy, lockedCache: V, requested: V): PublicErrorCode | null;
  /** Read the LOCKED Student: isActive + this domain's compatibility cache. */
  readLockedStudent(
    tx: Prisma.TransactionClient,
    studentId: string,
  ): Promise<{ isActive: boolean; cache: V } | null>;
  /** Ordered history rows converted to plain DateKey interval rows. */
  loadHistory(tx: Prisma.TransactionClient, studentId: string): Promise<IntervalRow<V>[]>;
  insertRow(
    tx: Prisma.TransactionClient,
    studentId: string,
    effectiveFrom: Date,
    effectiveTo: Date | null,
    value: V,
  ): Promise<void>;
  updateRow(
    tx: Prisma.TransactionClient,
    id: string,
    effectiveTo: Date | null,
    value: V,
  ): Promise<void>;
  updateStudentCache(tx: Prisma.TransactionClient, studentId: string, value: V): Promise<void>;
}

/**
 * Resolve the value covering `today` in a planned/persisted interval set and
 * decide whether the Student compatibility cache must change. ALWAYS resolves
 * at `today` (never at cutover). A future write that does not move today's
 * covering value yields `resolvedTodayChanged: false`.
 */
export function resolveTodayDecision<V>(
  resultingRows: readonly IntervalRow<V>[],
  today: DateKey,
  lockedCache: V,
  adapter: Pick<DomainWriteAdapter<V>, "emptyValue" | "valuesEqual">,
): { resolvedValue: V; resolvedTodayChanged: boolean } {
  const resolved = resolveIntervalAtDate(resultingRows, today);
  const resolvedValue = resolved ? resolved.value : adapter.emptyValue;
  return {
    resolvedValue,
    resolvedTodayChanged: !adapter.valuesEqual(resolvedValue, lockedCache),
  };
}

/** True for a Prisma unique-violation (P2002) — the studentId+effectiveFrom key. */
function isDuplicateEffectiveFromError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

interface EngineInput<V> {
  domain: WriteDomain;
  studentId: string;
  effectiveFrom: DateKey;
  policy: WritePolicy;
  now: Date;
  normalize: () => { ok: true; value: V } | { ok: false; code: PublicErrorCode };
  adapter: DomainWriteAdapter<V>;
}

/**
 * Execute a reusable effective-dated write: pure pre-transaction validation,
 * then ONE interactive transaction that locks the parent Student, plans via the
 * frozen GH1A planner, applies the plan, synchronizes today's cache, and
 * re-verifies history + cache agreement before commit.
 */
export async function runEffectiveDatedWrite<V>(input: EngineInput<V>): Promise<WriteOutcome> {
  const pre = preparePreTransaction<V>({
    domain: input.domain,
    policy: input.policy,
    effectiveFrom: input.effectiveFrom,
    now: input.now,
    normalize: input.normalize,
  });
  if (!pre.ok) {
    return { ok: false, code: pre.code };
  }

  const { policy, effectiveFrom, today, value } = pre;
  const { adapter, studentId } = input;

  try {
    return await prisma.$transaction(async (tx) => {
      // 1-3. acquire the parent Student lock; map missing/lock failure.
      await lockStudentForUpdate(tx, studentId);

      // 4-5. read the LOCKED Student; reject inactive.
      const locked = await adapter.readLockedStudent(tx, studentId);
      if (!locked) {
        throw new TraineeHistoryTxError("TRAINEE_NOT_FOUND");
      }
      if (!locked.isActive) {
        throw new TraineeHistoryTxError("TRAINEE_INACTIVE");
      }

      // 6. horse field-level enforcement against the locked cache.
      const fieldError = adapter.enforceFieldPolicy(policy, locked.cache, value);
      if (fieldError) {
        throw new TraineeHistoryTxError(fieldError);
      }

      // 7-8. load ordered history as plain DateKey interval rows.
      const history = await adapter.loadHistory(tx, studentId);

      // 9. run the FROZEN GH1A planner.
      const planResult = planIntervalWrite<V>(history, {
        effectiveFrom,
        value,
        newId: PLANNER_PLACEHOLDER_ID,
      });
      if (!planResult.ok) {
        // 10-11. distinguish duplicate effectiveFrom from other invariant failures.
        const duplicate = planResult.errors.some((e) => e.code === "DUPLICATE_EFFECTIVE_FROM");
        throw new TraineeHistoryTxError(
          duplicate ? "DUPLICATE_EFFECTIVE_FROM" : "INTERVAL_INVARIANT_FAILURE",
        );
      }

      // 12. apply insert/update ops. Inserts OMIT id (Prisma @default(cuid())
      //     generates it); updates target the persisted existing row id.
      for (const operation of planResult.plan.operations) {
        if (operation.type === "insert") {
          await adapter.insertRow(
            tx,
            studentId,
            dateKeyToUtcMidnight(operation.row.effectiveFrom),
            operation.row.effectiveTo === null
              ? null
              : dateKeyToUtcMidnight(operation.row.effectiveTo),
            operation.row.value,
          );
        } else if (operation.type === "update") {
          await adapter.updateRow(
            tx,
            operation.id,
            operation.row.effectiveTo === null
              ? null
              : dateKeyToUtcMidnight(operation.row.effectiveTo),
            operation.row.value,
          );
        } else {
          // The write planner never emits deletes; treat any as unexpected.
          throw new TraineeHistoryTxError("TRANSACTION_FAILURE");
        }
      }

      // 13-15. resolve today's value and conditionally sync the Student cache.
      const decision = resolveTodayDecision<V>(planResult.plan.resultingRows, today, locked.cache, adapter);
      if (decision.resolvedTodayChanged) {
        await adapter.updateStudentCache(tx, studentId, decision.resolvedValue);
      }

      // 16-17. re-read history and validate the resulting interval structure.
      const rereadHistory = await adapter.loadHistory(tx, studentId);
      if (validateIntervalRows(rereadHistory).length > 0) {
        throw new TraineeHistoryTxError("INTERVAL_INVARIANT_FAILURE");
      }

      // 18-20. re-read the Student cache and verify it equals today's resolved
      //         history value; any mismatch rolls back.
      const fresh = await adapter.readLockedStudent(tx, studentId);
      if (!fresh) {
        throw new TraineeHistoryTxError("CACHE_MISMATCH");
      }
      const reResolved = resolveIntervalAtDate(rereadHistory, today);
      const reResolvedValue = reResolved ? reResolved.value : adapter.emptyValue;
      if (!adapter.valuesEqual(fresh.cache, reResolvedValue)) {
        throw new TraineeHistoryTxError("CACHE_MISMATCH");
      }

      return successOutcome(decision.resolvedTodayChanged);
    });
  } catch (err) {
    if (err instanceof TraineeHistoryTxError) {
      return { ok: false, code: err.code };
    }
    if (isDuplicateEffectiveFromError(err)) {
      return { ok: false, code: "DUPLICATE_EFFECTIVE_FROM" };
    }
    return { ok: false, code: "TRANSACTION_FAILURE" };
  }
}
