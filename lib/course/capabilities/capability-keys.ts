/**
 * MULTI-COURSE (dormant foundation) — W0-CAP-1: canonical capability KEY set.
 *
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env,
 * no network, no logging. This module defines ONLY the code-owned set of
 * capability keys and its derived TypeScript type.
 *
 * Layer scope (COURSE-ARCHITECTURE-HANDOFF.md, Part 13 "Corrected next stage" +
 * CAP-1..CAP-10, §13): this is the pure-code foundation only. There is no
 * database `CapabilityCatalog` / `CourseOfferingCapability` at this layer, so:
 *   - `missing row = DISABLED` (CAP-1) remains a DESIGN INVARIANT for a later
 *     layer and is NOT implemented here;
 *   - there is NO capability resolution, enabled/disabled evaluation, or
 *     enforcement here;
 *   - "drift" at this layer means only internal inconsistency between this key
 *     set and the pure code-defined catalog — NOT any code<->database drift.
 *
 * Keys are stable string constants suitable for a later database
 * representation. Adding a capability later = a new key here + a catalog entry,
 * never a schema column or enum alter (CAP-3).
 */

/**
 * Single authoritative runtime representation of the capability keys. The
 * `CapabilityKey` type is DERIVED from this tuple, so there is no separately
 * maintained union that could drift out of sync. Frozen for runtime
 * immutability; `as const` gives the compile-time readonly tuple.
 *
 * Scope (this stage): only the capabilities the handoff names explicitly
 * (CAP-4/CAP-5/§13/DUT-3). `TEACHING_PRACTICE` is the TP capability (TP-1/TP-7).
 * EXAMS is intentionally absent (EXAM-1: no EXAMS capability in first release).
 */
export const CAPABILITY_KEYS = Object.freeze([
  "SCHEDULE",
  "CONTACTS",
  "MESSAGES",
  "ATTENDANCE",
  "DUTIES",
  "RIDING",
  "PROGRESS_RIDING",
  "RIDING_HORSE_ASSIGNMENTS",
  "ADVANCED_INSTRUCTION",
  "TEACHING_PRACTICE",
] as const);

/** Derived capability-key type — the only capability-key union in the codebase. */
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

/** Pure membership test; narrows an arbitrary string to `CapabilityKey`. */
export function isCapabilityKey(value: string): value is CapabilityKey {
  return (CAPABILITY_KEYS as readonly string[]).includes(value);
}
