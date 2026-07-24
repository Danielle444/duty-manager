/**
 * SECURITY / LEVEL 2 SLICE L2-MATERIAL-NOTIFY-1 - the PURE core for the
 * COURSE-SCOPED material-added notification fan-out.
 *
 * PURE by construction: no Prisma, no database, no `next/headers`, no cookies,
 * no session, no auth, no clock, no randomness, no environment access, no
 * network, no logging, no React, and no "use server" directive. Every function
 * decides from its arguments alone, so the whole contract is unit-testable
 * without a database (see material-notification-recipient-core.test.ts).
 *
 * WHY THIS EXISTS
 * ---------------
 * The committed fan-out (lib/actions/notifications.ts) resolves trainee
 * recipients from a GLOBAL `Student.isActive` query. It consults no offering, no
 * enrollment and no capability, so a Level 1 material add materializes a
 * Notification row - carrying the material's real title in `body` - for every
 * Level 2 trainee, even though the trainee materials reader correctly denies
 * them the document itself. This slice supplies the pieces the later IO shell
 * needs to replace that global query with an offering-scoped one.
 *
 * WHAT THIS DELIBERATELY DOES **NOT** DO
 * --------------------------------------
 * It does NOT model, re-implement, mirror, or approximate effective-capability
 * evaluation. Row absence, READ_ONLY, catalog retirement, malformed status,
 * duplicate rows and dependency clamping are ALREADY owned - and already tested
 * - by ./effective-capability-core.ts behind the committed
 * getEffectiveCapabilities reader. Restating any part of that decision here
 * would create a second, silently-drifting authorization path, which is exactly
 * the failure mode this codebase's capability layer was built to avoid. The
 * later IO shell calls that committed reader per candidate offering and keeps an
 * offering only on a positively enabled COURSE_MATERIALS status; this module
 * never sees a capability status at all.
 *
 * It also owns NO course-scope inference of any kind. There is deliberately no
 * parameter here through which a caller could supply - or this module could
 * consult - a date, a level number, a course name, an activity year, a group
 * name, a subgroup number, or a hardcoded offering id.
 *
 * FAIL-CLOSED ON IDENTIFIERS
 * --------------------------
 * A blank or non-string identifier REFUSES the whole fan-out by throwing. It is
 * never skipped, never coerced, and never repaired: silently dropping one bad id
 * would turn a data defect into a partial send that is indistinguishable from a
 * correct one, and silently repairing it would invent a recipient.
 *
 * UNWIRED IN THIS SLICE: nothing in the repository imports this module.
 */
import type { CapabilityKey } from "./capability-keys";

// ---------------------------------------------------------------------------
// The capability key
// ---------------------------------------------------------------------------

/**
 * The single capability that authorizes any trainee material notification.
 *
 * It is the EXISTING canonical key added by L2-M1A and already enforced by the
 * trainee materials READER (L2-M1C) - deliberately the same key, so a notice
 * about a material can never reach a trainee whose offering is denied the
 * material itself. This slice invents no key and reuses no unrelated one. The
 * `CapabilityKey` annotation makes a typo a compile error.
 */
export const MATERIAL_NOTIFICATION_CAPABILITY_KEY: CapabilityKey = "COURSE_MATERIALS";

// ---------------------------------------------------------------------------
// Audience predicate
// ---------------------------------------------------------------------------

/**
 * Does this material's visibility address TRAINEES at all?
 *
 * Positive allow-list (`"STUDENTS"` or `"BOTH"`), never a negative
 * `!== "INSTRUCTORS"` test: `undefined`, `null`, `""`, a number, an object, a
 * casing variant, and any future or misspelled visibility value must all answer
 * `false` rather than accidentally opening the trainee path.
 *
 * The parameter is `unknown` on purpose. The persisted visibility domain lives
 * on the Prisma enum and its mirror in lib/actions/materials.ts, which is a
 * `"use server"` module this pure core must not import; accepting `unknown` lets
 * the check be genuinely defensive instead of trusting a compile-time type that
 * says nothing about the value actually read back from the database.
 */
export function shouldNotifyTrainees(visibility: unknown): boolean {
  return visibility === "STUDENTS" || visibility === "BOTH";
}

// ---------------------------------------------------------------------------
// Identifier refusal
// ---------------------------------------------------------------------------

/** Which identifier list a refusal came from. A closed, code-owned set. */
export type MaterialNotificationIdField = "courseOfferingId" | "studentId";

/**
 * A malformed-identifier refusal.
 *
 * PII-FREE BY CONSTRUCTION: it carries only the field name (one of two
 * code-owned constants) and the positional index. The offending VALUE is never
 * placed on the error, never interpolated into the message, and never stored on
 * the instance - so this error can be logged or surfaced without disclosing a
 * trainee id, an offering id, a name, a phone number, an identity number, or any
 * fragment of whatever malformed data produced it.
 */
export class MaterialNotificationIdError extends Error {
  readonly field: MaterialNotificationIdField;
  readonly index: number;

  constructor(field: MaterialNotificationIdField, index: number) {
    super(
      `Material notification fan-out refused: ${field} at index ${index} is not a ` +
        `non-blank string. A malformed identifier is never skipped or repaired.`,
    );
    this.name = "MaterialNotificationIdError";
    this.field = field;
    this.index = index;
  }
}

/**
 * Validity test for one identifier.
 *
 * `trim()` is used ONLY as a test for emptiness - it never touches the value
 * that is compared, deduplicated or returned. NOTHING here normalizes an
 * identifier: an id that is valid is emitted byte-for-byte as supplied, so two
 * database ids can never be collapsed into one by whitespace folding, case
 * folding, or any other rewriting.
 */
function isUsableId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Shared first-seen deduplication over one projected identifier.
 *
 * Order is the caller's input order, which for the real IO shell is the database
 * result order - deterministic for identical input, and never re-sorted, so the
 * produced fan-out is reproducible.
 */
function dedupeIds(
  rows: readonly unknown[],
  field: MaterialNotificationIdField,
  read: (row: unknown) => unknown,
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const value = row === null || row === undefined ? undefined : read(row);
    if (!isUsableId(value)) {
      throw new MaterialNotificationIdError(field, index);
    }
    if (seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Collapse capability rows to the unique candidate offering ids, in first-seen
 * order.
 *
 * The database's `@@unique([courseOfferingId, capabilityKey])` already prevents
 * a duplicate here for a single capability key, so this is defence in depth
 * rather than a repair: a duplicate collapses to ONE candidate instead of
 * causing the same offering's roster to be loaded - and its trainees notified -
 * twice.
 *
 * A blank or non-string id throws {@link MaterialNotificationIdError}.
 */
export function dedupeMaterialNotificationOfferingIds(
  rows: readonly { courseOfferingId: string }[],
): string[] {
  return dedupeIds(rows, "courseOfferingId", (row) => (row as { courseOfferingId: unknown }).courseOfferingId);
}

/**
 * Collapse enrollment rows to the unique recipient trainee ids, in first-seen
 * order.
 *
 * REQUIRED, not cosmetic: one Student may hold simultaneous ACTIVE enrollments
 * in several offerings, and `Notification` has no uniqueness constraint, so a
 * trainee enrolled in two enabled offerings would otherwise receive two
 * identical notifications for a single material.
 *
 * A blank or non-string id throws {@link MaterialNotificationIdError}.
 */
export function dedupeMaterialNotificationRecipientIds(
  rows: readonly { studentId: string }[],
): string[] {
  return dedupeIds(rows, "studentId", (row) => (row as { studentId: unknown }).studentId);
}
