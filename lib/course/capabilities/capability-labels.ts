/**
 * MULTI-COURSE (dormant foundation) — W0-CAP-3: explicit capability business
 * configuration (initial Hebrew labels + the legacy-course initialization
 * preset).
 *
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env,
 * no network, no logging, no runtime side effects.
 *
 * OWNERSHIP SPLIT (locked, CAP-3):
 *   TypeScript owns  — canonical keys, classification, dependencies, the
 *                      INSERT-ONLY initial label, and the explicit legacy
 *                      initialization preset.
 *   The database owns — the CURRENT editable label once a catalog row exists,
 *                      isActive / retirement state, and the saved per-offering
 *                      status.
 *
 * LABELS ARE INSERT-ONLY. `INITIAL_CAPABILITY_LABELS` is consulted ONLY when a
 * canonical key has no `capability_catalog` row yet. Once a row exists its label
 * is operational state: sync preserves it exactly and reports any difference
 * from the code label as INFORMATION only. Nothing here ever plans a label
 * update (there is deliberately no --set-label in W0-CAP-3).
 *
 * THE LEGACY PRESET IS NOT DERIVED FROM `defaultEnabled`. `defaultEnabled` in
 * capability-catalog.ts is a documentation-level seed hint for FUTURE offering
 * creation; it is intentionally unused by every W0-CAP-3 planner, validator and
 * CLI path. The existing operating course is initialized from the explicit
 * constant below and nothing else — see CAP-9 ("seed L1 = current actual
 * modules ENABLED").
 */
import { CAPABILITY_KEYS, type CapabilityKey } from "./capability-keys";

/**
 * Local mirror of the Prisma `CourseCapabilityStatus` enum, declared here so
 * this module (and everything that builds on it) stays database-independent and
 * unit-testable without a generated client. There is deliberately NO `DISABLED`
 * member: DISABLED is represented by ROW ABSENCE (CAP-1/CAP-2), and adding a
 * member here would silently break the sparse-storage contract.
 */
export type CourseCapabilityStatus = "ENABLED" | "READ_ONLY";

/** Runtime tuple of the persisted statuses, for validating raw database input. */
export const COURSE_CAPABILITY_STATUSES = Object.freeze([
  "ENABLED",
  "READ_ONLY",
] as const);

/** Narrows an arbitrary string to a persisted `CourseCapabilityStatus`. */
export function isCourseCapabilityStatus(
  value: string,
): value is CourseCapabilityStatus {
  return (COURSE_CAPABILITY_STATUSES as readonly string[]).includes(value);
}

/**
 * INSERT-ONLY initial Hebrew label for every canonical capability key.
 *
 * The mapped-type annotation (same pattern as `CAPABILITY_CATALOG`) forces
 * exactly one label for every `CapabilityKey` and rejects unknown keys at
 * compile time; the test suite proves non-emptiness and trimming at runtime.
 */
export const INITIAL_CAPABILITY_LABELS: {
  readonly [K in CapabilityKey]: string;
} = {
  SCHEDULE: "לו״ז שבועי",
  CONTACTS: "אנשי קשר",
  MESSAGES: "הודעות ומשימות",
  ATTENDANCE: "נוכחות",
  DUTIES: "תורנויות",
  RIDING: "רכיבות",
  PROGRESS_RIDING: "מעקב התקדמות חניכים",
  RIDING_HORSE_ASSIGNMENTS: "שיבוץ סוסים לרכיבות",
  ADVANCED_INSTRUCTION: "הדרכת מתקדמים",
  TEACHING_PRACTICE: "התנסויות מתחילים",
};

/** One (capability, saved status) pair of an initialization preset. */
export interface OfferingCapabilityPresetEntry {
  readonly key: CapabilityKey;
  readonly status: CourseCapabilityStatus;
}

/**
 * The EXPLICIT legacy-course preset: the single existing operating course runs
 * every canonical module today, so all ten capabilities are initialized
 * ENABLED. No capability is READ_ONLY and no canonical capability is absent for
 * this specific preset.
 *
 * Written as an exhaustive mapped record (compile-time proof that every
 * `CapabilityKey` is listed exactly once and no unknown key sneaks in), then
 * projected below into canonical key order. It is explicit constant data — it
 * is NOT computed from `defaultEnabled`, which would produce a different and
 * wrong result (DUTIES/RIDING/TEACHING_PRACTICE are `defaultEnabled: false`).
 */
export const LEGACY_OFFERING_PRESET_STATUS_BY_KEY: {
  readonly [K in CapabilityKey]: CourseCapabilityStatus;
} = {
  SCHEDULE: "ENABLED",
  CONTACTS: "ENABLED",
  MESSAGES: "ENABLED",
  ATTENDANCE: "ENABLED",
  DUTIES: "ENABLED",
  RIDING: "ENABLED",
  PROGRESS_RIDING: "ENABLED",
  RIDING_HORSE_ASSIGNMENTS: "ENABLED",
  ADVANCED_INSTRUCTION: "ENABLED",
  TEACHING_PRACTICE: "ENABLED",
};

/**
 * The legacy preset in canonical key order — the exact ten rows an approved
 * State-A initialization inserts. Deterministic: the order is
 * `CAPABILITY_KEYS`, never object-iteration order of a database result.
 */
export const LEGACY_OFFERING_CAPABILITY_PRESET: readonly OfferingCapabilityPresetEntry[] =
  Object.freeze(
    CAPABILITY_KEYS.map((key) =>
      Object.freeze({
        key,
        status: LEGACY_OFFERING_PRESET_STATUS_BY_KEY[key],
      }),
    ),
  );

/** The insert-only initial label for a canonical key. */
export function initialLabelFor(key: CapabilityKey): string {
  return INITIAL_CAPABILITY_LABELS[key];
}
