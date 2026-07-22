/**
 * ATT-1 — PURE attendance capability policy core.
 *
 * PURE by construction: no Prisma client runtime import, no DB, no clock, no
 * randomness, no env, no auth/session/cookie, no IO, no runtime side effects.
 * The only sibling imports are erased `import type`s, so this module pulls in no
 * runtime code and is fully unit-testable on its own.
 *
 * WHAT THIS ANSWERS (and only this): given the ALREADY-RESOLVED effective
 * ATTENDANCE status for one CourseOffering context, does that context permit
 * attendance VISIBILITY, READS, and WRITES? It answers nothing else. It does
 * NOT:
 *   - resolve the current offering or fetch capability rows (that is
 *     effective-capability-core.ts + a future offering-resolution layer);
 *   - know who the actor is, whether canEditAttendance holds, or whether a
 *     session exists (that is the actor/session layer — ATT-SEC-1/2);
 *   - own or reference the attendance FACT. StudentAttendance stays one shared
 *     Student + calendar-date row with NO courseOfferingId; this policy governs
 *     ACCESS THROUGH an offering surface, never ownership of the fact (Design 1).
 *
 * MODE SEMANTICS (the authoritative ENABLED / READ_ONLY / DISABLED contract):
 *   ENABLED   → visible, read, write.
 *   READ_ONLY → visible, read; write DENIED. READ_ONLY blocks writes THROUGH
 *               this offering only; it does NOT freeze or stale the shared fact,
 *               which another ENABLED offering may still edit (Design 1 §5/§6).
 *   DISABLED  → not available through this offering: not visible, no read, no
 *               write. (DISABLED is the effective, computed, row-absent state —
 *               it is never a persisted status; see effective-capability-core.)
 *
 * VIEW vs READ: `canView` (entry-point / navigation visibility) and `canRead`
 * (data read) are kept as distinct axes even though this policy currently yields
 * the same value for both in every mode. They serve DIFFERENT future consumers
 * (navigation/UI-state gating vs a read surface) and a future mode could diverge
 * them; collapsing them now would bake in an assumption the Design 1 wording
 * (which lists "visible" and "reads allowed" separately) deliberately avoids.
 *
 * FAIL CLOSED EVERYWHERE. Any input outside the effective domain — a missing
 * offering context, an absent ATTENDANCE entry, or a value that bypassed the
 * type system (including inherited keys like "__proto__"/"toString") — yields
 * the fully-denied result. There is NO permissive attendance default; the
 * `defaultEnabled` seed hint in capability-catalog.ts is never consulted here.
 */
import type { EffectiveCapabilityStatus } from "./effective-capability-core";
import type { CapabilityKey } from "./capability-keys";

/**
 * The three access axes the ATTENDANCE mode governs, plus a stable non-PII
 * reason code. Immutable by type. `status` is the normalized effective status
 * that produced this decision, or `null` when the input was missing/unknown (so
 * an arbitrary bypassed string is never reflected back to callers).
 */
export interface AttendanceCapabilityAccess {
  readonly status: EffectiveCapabilityStatus | null;
  /** Entry-point / navigation visibility of the attendance domain. */
  readonly canView: boolean;
  /** Permission to READ the shared attendance fact through this offering. */
  readonly canRead: boolean;
  /** Permission to WRITE the shared attendance fact through this offering. */
  readonly canWrite: boolean;
  readonly reason: AttendanceCapabilityReasonCode;
}

/**
 * Stable, non-PII reason codes. For the three in-domain modes the reason echoes
 * the mode; the two DENIED_* codes distinguish "no offering context at all" from
 * "context present but the ATTENDANCE status is absent/out-of-domain".
 */
export type AttendanceCapabilityReasonCode =
  | "ENABLED"
  | "READ_ONLY"
  | "DISABLED"
  | "DENIED_MISSING_CONTEXT"
  | "DENIED_UNKNOWN_STATUS";

/**
 * The authoritative mode → access table. The exhaustive mapped-type annotation
 * (`{ [S in EffectiveCapabilityStatus]: ... }`) forces every effective status —
 * and any future one — to be classified on all three axes, or this file will not
 * compile. Module-private and never exported, so no caller can read or mutate
 * the policy.
 */
const ACCESS_BY_STATUS: {
  readonly [S in EffectiveCapabilityStatus]: {
    readonly canView: boolean;
    readonly canRead: boolean;
    readonly canWrite: boolean;
  };
} = {
  ENABLED: { canView: true, canRead: true, canWrite: true },
  READ_ONLY: { canView: true, canRead: true, canWrite: false },
  DISABLED: { canView: false, canRead: false, canWrite: false },
};

/** The capability key this policy is bound to. */
const ATTENDANCE_KEY: CapabilityKey = "ATTENDANCE";

/** True only for a key the object owns directly (never an inherited/proto key). */
function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/** The fully-denied decision for a given fail-closed reason. */
function denied(
  reason: "DENIED_MISSING_CONTEXT" | "DENIED_UNKNOWN_STATUS",
): AttendanceCapabilityAccess {
  return { status: null, canView: false, canRead: false, canWrite: false, reason };
}

/**
 * Evaluate the attendance policy for one ALREADY-RESOLVED effective status.
 *
 * Pure, deterministic, never throws. `status` is typed to the effective domain,
 * but a runtime-bypassed value (only reachable if the type system is
 * circumvented) is not looked up through the prototype chain and fails closed to
 * the fully-denied result with `DENIED_UNKNOWN_STATUS`.
 */
export function evaluateAttendanceCapabilityPolicy(
  status: EffectiveCapabilityStatus,
): AttendanceCapabilityAccess {
  if (typeof status !== "string" || !hasOwn(ACCESS_BY_STATUS, status)) {
    return denied("DENIED_UNKNOWN_STATUS");
  }
  const access = ACCESS_BY_STATUS[status];
  return {
    status,
    canView: access.canView,
    canRead: access.canRead,
    canWrite: access.canWrite,
    // reason echoes the in-domain mode; the union guarantees this is valid.
    reason: status,
  };
}

/**
 * Attendance-authoritative entry point: select and evaluate the ATTENDANCE
 * status out of an already-resolved effective-capability map (as produced by
 * resolveEffectiveCapabilitiesFromRows for a single offering context).
 *
 * This performs NO resolution itself — it only reads the resolved context. It
 * fails closed when:
 *   - the map is null/undefined (no CourseOffering context) → DENIED_MISSING_CONTEXT;
 *   - the ATTENDANCE entry is absent or not an in-domain status → DENIED_UNKNOWN_STATUS.
 *
 * The parameter is a Partial map so a full `Record<CapabilityKey,
 * EffectiveCapabilityStatus>` (the resolver's output) assigns directly, while an
 * incomplete/absent context is still representable and fails closed. Membership
 * is tested with own-property semantics, so a null-prototype map (the resolver's
 * own shape) and a plain object both read safely and no inherited key leaks in.
 */
export function attendanceCapabilityAccessFromEffective(
  effective:
    | Readonly<Partial<Record<CapabilityKey, EffectiveCapabilityStatus>>>
    | null
    | undefined,
): AttendanceCapabilityAccess {
  if (effective === null || effective === undefined) {
    return denied("DENIED_MISSING_CONTEXT");
  }
  if (!hasOwn(effective, ATTENDANCE_KEY)) {
    return denied("DENIED_UNKNOWN_STATUS");
  }
  const status = (effective as Record<string, unknown>)[ATTENDANCE_KEY];
  if (typeof status !== "string" || !hasOwn(ACCESS_BY_STATUS, status)) {
    return denied("DENIED_UNKNOWN_STATUS");
  }
  return evaluateAttendanceCapabilityPolicy(status as EffectiveCapabilityStatus);
}
