/**
 * MULTI-COURSE Schedule Slice W-S2A - the PURE core for the OFFERING-SCOPED
 * WeeklySchedule writer.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * cookies, no next/*, no React, no filesystem. It only validates raw input,
 * decides week ownership from explicitly supplied arguments, and SHAPES the two
 * write payloads - so the whole writer contract is unit-testable without a
 * database (see offering-weekly-schedule-writer-core.test.ts).
 *
 * WHY A SEPARATE WRITER EXISTS
 * ----------------------------
 * lib/actions/weekly-schedule.ts's commitWeeklySchedule is the GLOBAL Level 1
 * writer and is deliberately left byte-identical: its committed contract test
 * (lib/actions/schedule-writer-auth.contract.test.ts) asserts that its body
 * contains no "courseOfferingId" / "CourseOffering" / operation-policy token at
 * all. This module is therefore an ADDITIVE, parallel writer for weeks that
 * belong to ONE explicit CourseOffering; it never replaces, wraps or imports the
 * global one.
 *
 * HARD RULES BAKED IN HERE
 * ------------------------
 *  - The offering is ALWAYS an explicit, server-resolved id. Nothing in this
 *    module infers an offering from dates, week name, level, group, schedule
 *    contents, a cookie, or a "current offering" heuristic, and there is NO
 *    Level 1 fallback.
 *  - A CREATE payload can never omit the offering: buildWeekCreateData THROWS on
 *    a blank id, so this path is structurally incapable of producing a
 *    NULL-scoped week (which the committed trainee readers would then fail
 *    closed on - see lib/course/course-scoped-week-options-core.ts).
 *  - An UPDATE payload has NO courseOfferingId key at all, at the type level and
 *    at runtime - so a re-import can never erase, adopt or retarget a week's
 *    course ownership.
 *  - Neither payload carries isPublished. Publication stays a separate action;
 *    a newly created week keeps the schema default (false).
 *  - Ownership comparison is STRICT === on the exact ids. No trimming, no case
 *    folding, no prefix/truncation matching.
 *  - Every failure is a stable, non-PII code. Raw input is never reflected back.
 *
 * DORMANT: this slice is server-core only. Nothing imports it - no route, no
 * page, no Server Action, no UI.
 */
import { dateKey, parseDateKey } from "@/lib/dates";

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/** Stable, non-PII validation error codes (never echo raw input to a client). */
export type OfferingWeekValidationErrorCode =
  | "name_required"
  | "dates_required"
  | "invalid_date"
  | "invalid_items"
  | "invalid_combined";

// ---------------------------------------------------------------------------
// Raw input
// ---------------------------------------------------------------------------

/**
 * One raw, untrusted schedule row as received from the parse/preview step. Every
 * field is `unknown` because this input crosses a client boundary: the shape is
 * never trusted, only coerced. Mirrors ScheduleImportItem's field names so the
 * existing preview payload maps across unchanged.
 */
export interface RawScheduleImportItem {
  readonly dateKey?: unknown;
  readonly startTime?: unknown;
  readonly endTime?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly groupName?: unknown;
  readonly instructorName?: unknown;
  readonly location?: unknown;
  readonly rawText?: unknown;
  readonly combinedParticipation?: unknown;
  readonly combinedParticipationMalformed?: unknown;
}

/**
 * The raw week payload. `courseOfferingId` is deliberately ABSENT: the offering
 * is a server-bound argument resolved by the IO layer, never part of the
 * validated client input, so there is no field here through which a caller could
 * name a course.
 */
export interface RawOfferingWeekInput {
  readonly name: unknown;
  readonly startDate: unknown;
  readonly endDate: unknown;
  readonly uploadedFileName?: unknown;
  readonly items: unknown;
}

/** The normalized, validated week the write payload builders operate on. */
export interface ValidatedOfferingWeek {
  readonly name: string;
  readonly startDateKey: string;
  readonly endDateKey: string;
  readonly uploadedFileName: string;
  readonly items: readonly RawScheduleImportItem[];
}

/** Discriminated validation result: a normalized value, or a stable code. */
export type ValidateOfferingWeekResult =
  | { readonly ok: true; readonly value: ValidatedOfferingWeek }
  | { readonly ok: false; readonly error: OfferingWeekValidationErrorCode };

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** A runtime value as a plain string, or "" when it is not a string. */
function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Trim a runtime value to a string, or null when it is not a string. */
function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A strict `YYYY-MM-DD` calendar-date key.
 *
 * Stricter than a bare pattern test on purpose: the pattern rejects the wrong
 * shape, `parseDateKey` rejects an unparseable ISO date, and the round-trip
 * through `dateKey` rejects anything that only survives by rolling over (a
 * hypothetical "2026-02-30"). A key that fails any of the three is never handed
 * to the database.
 */
export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) {
    return false;
  }
  const parsed = parseDateKey(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return dateKey(parsed) === value;
}

// ---------------------------------------------------------------------------
// Combined-participation malformed gate
// ---------------------------------------------------------------------------

/**
 * True iff ANY raw row carries an unresolved malformed "משולב" value (a
 * non-empty cell that was neither כן nor לא, flagged by the Excel parser as
 * `combinedParticipationMalformed === true`).
 *
 * This is the AUTHORITATIVE server predicate the offering writer's pre-commit
 * validation uses to reject BEFORE its transaction runs - it never trusts the
 * client to have blocked the value. Strict `=== true`, so a missing/false/other
 * marker never gates.
 */
export function hasMalformedCombinedParticipation(
  items: readonly RawScheduleImportItem[],
): boolean {
  return items.some((item) => item?.combinedParticipationMalformed === true);
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * Validate and normalize the raw week input. Returns a normalized value, or a
 * stable code for the FIRST failed rule, in this fixed order:
 *
 *   name -> date presence -> date format -> items
 *
 *   - a non-string / absent / empty / whitespace-only name -> "name_required";
 *   - either date absent, non-string or blank                -> "dates_required";
 *   - either date not a strict YYYY-MM-DD calendar key       -> "invalid_date";
 *   - items not an array                                     -> "invalid_items".
 *
 * `uploadedFileName` is NOT validated (the schema column is non-null but may be
 * an empty string, matching the existing global writer, which also never
 * validates it): a non-string collapses to "".
 *
 * It deliberately does NOT validate the offering id - the offering is never part
 * of this input - and does NOT compare startDate to endDate; ordering is not a
 * rule the existing importer enforces and inventing one here would change
 * behaviour beyond this slice. Never throws, never reflects raw input.
 */
export function validateOfferingWeekInput(
  input: RawOfferingWeekInput,
): ValidateOfferingWeekResult {
  const name = asTrimmedString(input.name);
  if (name === null || name === "") {
    return { ok: false, error: "name_required" };
  }

  const startDate = asTrimmedString(input.startDate);
  const endDate = asTrimmedString(input.endDate);
  if (startDate === null || startDate === "" || endDate === null || endDate === "") {
    return { ok: false, error: "dates_required" };
  }

  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
    return { ok: false, error: "invalid_date" };
  }

  if (!Array.isArray(input.items)) {
    return { ok: false, error: "invalid_items" };
  }

  // Reject malformed "משולב" values HERE, in the pure pre-commit validation step
  // (before the offering resolver, the ownership proof and the transaction), so a
  // malformed re-import performs ZERO deleteMany/createMany. The IO orchestrator
  // forwards this code untouched, so no edit to the writer's transaction is needed.
  if (hasMalformedCombinedParticipation(input.items as readonly RawScheduleImportItem[])) {
    return { ok: false, error: "invalid_combined" };
  }

  return {
    ok: true,
    value: {
      name,
      startDateKey: startDate,
      endDateKey: endDate,
      uploadedFileName: asString(input.uploadedFileName),
      items: input.items as readonly RawScheduleImportItem[],
    },
  };
}

// ---------------------------------------------------------------------------
// Week ownership
// ---------------------------------------------------------------------------

/** The ONLY columns a week ownership check may read. No content, no items. */
export interface WeekOwnerRow {
  readonly id: string;
  readonly courseOfferingId: string | null;
}

/**
 * The re-import ownership predicate - what makes a client-supplied week id NOT
 * authorization. ALL of the following must hold:
 *
 *  1. the resolved offering id is a non-empty string (a blank server-resolved id
 *     can never match anything, including a blank stored value);
 *  2. the week actually exists;
 *  3. its courseOfferingId is NOT null and not blank - a NULL-scoped legacy week
 *     is NOT adoptable by this writer;
 *  4. its courseOfferingId is STRICTLY EQUAL to the resolved offering id.
 *
 * Comparison is `===` on the exact strings: a padded, case-changed, truncated or
 * prefixed id is a mismatch, never a match. Deliberately mirrors
 * isTraineeWeekReadAuthorized in course-scoped-week-options-core.ts so the write
 * side and the read side answer "does this week belong to this course?" the same
 * way.
 */
export function isWeekOwnedByOffering(
  week: { readonly courseOfferingId: string | null } | null | undefined,
  resolvedOfferingId: string,
): boolean {
  if (typeof resolvedOfferingId !== "string" || resolvedOfferingId.length === 0) {
    return false;
  }
  if (!week) {
    return false;
  }
  if (
    typeof week.courseOfferingId !== "string" ||
    week.courseOfferingId.length === 0
  ) {
    return false;
  }
  return week.courseOfferingId === resolvedOfferingId;
}

// ---------------------------------------------------------------------------
// Write payloads
// ---------------------------------------------------------------------------

/**
 * The CREATE payload. `courseOfferingId` is REQUIRED here at the type level, so
 * a NULL-scoped week cannot be expressed. There is deliberately no isPublished
 * key: a new week keeps the schema default (false) and publication stays a
 * separate action.
 */
export interface WeekCreateData {
  readonly name: string;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly uploadedFileName: string;
  readonly courseOfferingId: string;
}

/**
 * The RE-IMPORT payload. It has NO courseOfferingId key and NO isPublished key -
 * at the type level, so a re-import is structurally incapable of erasing,
 * adopting or retargeting course ownership, or of flipping publication.
 */
export interface WeekUpdateData {
  readonly name: string;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly uploadedFileName: string;
}

/**
 * Build the CREATE payload for exactly one offering.
 *
 * THROWS on a blank/non-string courseOfferingId rather than returning an error
 * code: the IO layer only ever calls this with an id that
 * requireAdminCourseOffering already resolved to a real row, so a blank value is
 * a programming error, and silently producing a NULL-scoped week would be the
 * exact failure this slice exists to prevent. Failing loudly here is the last
 * structural guarantee that no NULL week can be created by this path.
 */
export function buildWeekCreateData(
  week: ValidatedOfferingWeek,
  courseOfferingId: string,
): WeekCreateData {
  if (typeof courseOfferingId !== "string" || courseOfferingId.length === 0) {
    throw new Error(
      "buildWeekCreateData requires a non-empty, server-resolved courseOfferingId",
    );
  }
  return {
    name: week.name,
    startDate: parseDateKey(week.startDateKey),
    endDate: parseDateKey(week.endDateKey),
    uploadedFileName: week.uploadedFileName,
    courseOfferingId,
  };
}

/**
 * Build the RE-IMPORT payload. Takes NO offering argument at all - there is no
 * parameter through which ownership could be written - and emits only the four
 * header columns a re-import may change.
 */
export function buildWeekUpdateData(week: ValidatedOfferingWeek): WeekUpdateData {
  return {
    name: week.name,
    startDate: parseDateKey(week.startDateKey),
    endDate: parseDateKey(week.endDateKey),
    uploadedFileName: week.uploadedFileName,
  };
}

// ---------------------------------------------------------------------------
// Schedule item rows
// ---------------------------------------------------------------------------

/**
 * One importable schedule row, WITHOUT its parent week id. The id is attached
 * only once the week is known (created or ownership-proven), so a normalized row
 * can never carry a stale or foreign weeklyScheduleId.
 */
export interface NormalizedScheduleItem {
  readonly date: Date;
  readonly startTime: string;
  readonly endTime: string;
  readonly title: string;
  readonly description: string | null;
  readonly groupName: string | null;
  readonly instructorName: string | null;
  readonly location: string | null;
  readonly rawText: string | null;
  // Tri-state "משולב": true/false/null. The malformed MARKER is deliberately NOT
  // here - it is a preview-only signal and must never reach a createMany row.
  readonly combinedParticipation: boolean | null;
}

/** A row ready for insertion, i.e. a normalized item bound to its week. */
export interface ScheduleItemRow extends NormalizedScheduleItem {
  readonly weeklyScheduleId: string;
}

/** The outcome of filtering + normalizing raw rows. */
export interface SelectedScheduleItems {
  readonly importable: NormalizedScheduleItem[];
  readonly savedCount: number;
  readonly skippedCount: number;
}

/** "" -> null, matching the existing importer's optional-column convention. */
function optionalText(value: unknown): string | null {
  const text = asString(value);
  return text === "" ? null : text;
}

/**
 * Filter raw rows to the importable ones and normalize them.
 *
 * A row is importable only when its dateKey is a strict YYYY-MM-DD calendar key;
 * everything else is skipped and counted. This is marginally stricter than the
 * global writer (which filters on a merely truthy dateKey and would then hand a
 * malformed key straight to the database as an Invalid Date): a malformed key is
 * skipped here rather than written.
 *
 * The column mapping is otherwise IDENTICAL to the existing importer:
 * startTime/endTime/title are plain strings; description, groupName,
 * instructorName, location and rawText collapse "" to null.
 */
export function selectImportableItems(
  items: readonly RawScheduleImportItem[],
): SelectedScheduleItems {
  const importable: NormalizedScheduleItem[] = [];
  let skippedCount = 0;

  for (const item of items) {
    const key = item?.dateKey;
    if (!isValidDateKey(key)) {
      skippedCount += 1;
      continue;
    }
    importable.push({
      date: parseDateKey(key),
      startTime: asString(item.startTime),
      endTime: asString(item.endTime),
      title: asString(item.title),
      description: optionalText(item.description),
      groupName: optionalText(item.groupName),
      instructorName: optionalText(item.instructorName),
      location: optionalText(item.location),
      rawText: optionalText(item.rawText),
      // Explicit tri-state coercion (never truthiness): a real `false` stays
      // `false`, only genuinely absent/other becomes null. The marker is dropped.
      combinedParticipation:
        item.combinedParticipation === true
          ? true
          : item.combinedParticipation === false
            ? false
            : null,
    });
  }

  return { importable, savedCount: importable.length, skippedCount };
}

/**
 * Bind already-normalized rows to their parent week. Requires a non-empty id for
 * the same reason buildWeekCreateData does: an orphan/blank parent id must fail
 * loudly, never be written.
 */
export function attachWeeklyScheduleId(
  items: readonly NormalizedScheduleItem[],
  weeklyScheduleId: string,
): ScheduleItemRow[] {
  if (typeof weeklyScheduleId !== "string" || weeklyScheduleId.length === 0) {
    throw new Error("attachWeeklyScheduleId requires a non-empty weeklyScheduleId");
  }
  return items.map((item) => ({ ...item, weeklyScheduleId }));
}

/** The insertable rows plus their exact counts, for one known week. */
export interface BuiltScheduleItemRows {
  readonly rows: ScheduleItemRow[];
  readonly savedCount: number;
  readonly skippedCount: number;
}

/**
 * Filter, normalize and bind raw rows to one week in a single step. savedCount
 * is exactly rows.length; skippedCount is exactly the number of raw rows without
 * a valid date key. The two always sum to items.length.
 */
export function buildScheduleItemRows(
  items: readonly RawScheduleImportItem[],
  weeklyScheduleId: string,
): BuiltScheduleItemRows {
  const selected = selectImportableItems(items);
  return {
    rows: attachWeeklyScheduleId(selected.importable, weeklyScheduleId),
    savedCount: selected.savedCount,
    skippedCount: selected.skippedCount,
  };
}
