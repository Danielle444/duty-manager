/**
 * MULTI-COURSE Schedule Slice W-S2A - PURE unit tests for the offering-scoped
 * WeeklySchedule writer core.
 *
 * No Prisma, no DB, no clock: every assertion is on validation codes, ownership
 * decisions and the SHAPE of the two write payloads.
 *
 * Run with: npx tsx --test lib/course/offering-weekly-schedule-writer-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseDateKey } from "@/lib/dates";
import {
  attachWeeklyScheduleId,
  buildScheduleItemRows,
  buildWeekCreateData,
  buildWeekUpdateData,
  hasMalformedCombinedParticipation,
  isValidDateKey,
  isWeekOwnedByOffering,
  selectImportableItems,
  validateOfferingWeekInput,
  type RawOfferingWeekInput,
  type RawScheduleImportItem,
  type ValidatedOfferingWeek,
} from "./offering-weekly-schedule-writer-core";

const OFFERING_ID = "cmrxk58vc0000lscnfm54bpze";
const WEEK_ID = "week-1";

function rawInput(overrides: Partial<RawOfferingWeekInput> = {}): RawOfferingWeekInput {
  return {
    name: 'לו"ז שבוע 1',
    startDate: "2026-07-26",
    endDate: "2026-07-31",
    uploadedFileName: "week1.xlsx",
    items: [],
    ...overrides,
  };
}

function validatedWeek(overrides: Partial<ValidatedOfferingWeek> = {}): ValidatedOfferingWeek {
  return {
    name: 'לו"ז שבוע 1',
    startDateKey: "2026-07-26",
    endDateKey: "2026-07-31",
    uploadedFileName: "week1.xlsx",
    items: [],
    ...overrides,
  };
}

function item(overrides: Partial<RawScheduleImportItem> = {}): RawScheduleImportItem {
  return {
    dateKey: "2026-07-26",
    startTime: "08:00",
    endTime: "09:30",
    title: "רכיבה",
    description: "",
    groupName: "א",
    instructorName: "",
    location: "",
    rawText: "",
    ...overrides,
  };
}

// ===========================================================================
// validateOfferingWeekInput - every stable code
// ===========================================================================

test("valid input normalizes name, dates, filename and items", () => {
  const result = validateOfferingWeekInput(rawInput({ name: '  לו"ז שבוע 1  ' }));
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.name, 'לו"ז שבוע 1');
  assert.equal(result.value.startDateKey, "2026-07-26");
  assert.equal(result.value.endDateKey, "2026-07-31");
  assert.equal(result.value.uploadedFileName, "week1.xlsx");
  assert.deepEqual(result.value.items, []);
});

test("name_required: missing, non-string, empty and whitespace-only names", () => {
  for (const name of [undefined, null, 42, {}, "", "   ", "\t\n"]) {
    const result = validateOfferingWeekInput(rawInput({ name }));
    assert.deepEqual(
      result,
      { ok: false, error: "name_required" },
      `expected name_required for ${JSON.stringify(name)}`,
    );
  }
});

test("dates_required: either date missing, non-string, empty or whitespace-only", () => {
  for (const bad of [undefined, null, 20260726, "", "   "]) {
    assert.deepEqual(validateOfferingWeekInput(rawInput({ startDate: bad })), {
      ok: false,
      error: "dates_required",
    });
    assert.deepEqual(validateOfferingWeekInput(rawInput({ endDate: bad })), {
      ok: false,
      error: "dates_required",
    });
  }
});

test("invalid_date: malformed, non-calendar and non-canonical date keys", () => {
  for (const bad of [
    "26/07/2026",
    "2026-7-26",
    "20260726",
    "2026-13-01",
    "2026-02-30",
    "2026-00-10",
    "2026-07-26T00:00:00Z",
    "not-a-date",
  ]) {
    assert.deepEqual(
      validateOfferingWeekInput(rawInput({ startDate: bad })),
      { ok: false, error: "invalid_date" },
      `expected invalid_date for startDate ${bad}`,
    );
    assert.deepEqual(
      validateOfferingWeekInput(rawInput({ endDate: bad })),
      { ok: false, error: "invalid_date" },
      `expected invalid_date for endDate ${bad}`,
    );
  }
});

test("invalid_items: items absent or not an array", () => {
  for (const bad of [undefined, null, "", "[]", 0, {}, { length: 0 }]) {
    assert.deepEqual(
      validateOfferingWeekInput(rawInput({ items: bad })),
      { ok: false, error: "invalid_items" },
      `expected invalid_items for ${JSON.stringify(bad)}`,
    );
  }
});

test("validation order is fixed: name -> dates -> date format -> items", () => {
  // Everything is wrong at once; only the FIRST rule's code is reported.
  assert.deepEqual(
    validateOfferingWeekInput({
      name: "",
      startDate: "",
      endDate: "bad",
      items: null,
    }),
    { ok: false, error: "name_required" },
  );
  assert.deepEqual(
    validateOfferingWeekInput({ name: "x", startDate: "", endDate: "bad", items: null }),
    { ok: false, error: "dates_required" },
  );
  assert.deepEqual(
    validateOfferingWeekInput({
      name: "x",
      startDate: "2026-07-26",
      endDate: "bad",
      items: null,
    }),
    { ok: false, error: "invalid_date" },
  );
});

test("a non-string uploadedFileName collapses to an empty string (never rejected)", () => {
  const result = validateOfferingWeekInput(rawInput({ uploadedFileName: undefined }));
  assert.ok(result.ok);
  assert.equal(result.value.uploadedFileName, "");
});

test("isValidDateKey accepts only strict canonical YYYY-MM-DD keys", () => {
  assert.equal(isValidDateKey("2026-07-26"), true);
  assert.equal(isValidDateKey("2026-08-13"), true);
  for (const bad of [null, undefined, 20260726, "2026-2-01", "2026-02-30", " 2026-07-26"]) {
    assert.equal(isValidDateKey(bad), false, `expected false for ${String(bad)}`);
  }
});

// ===========================================================================
// isWeekOwnedByOffering - strict, fail-closed ownership
// ===========================================================================

test("ownership: an exact strict match is the ONLY accepted case", () => {
  assert.equal(isWeekOwnedByOffering({ courseOfferingId: OFFERING_ID }, OFFERING_ID), true);
});

test("ownership rejects a missing week (null and undefined)", () => {
  assert.equal(isWeekOwnedByOffering(null, OFFERING_ID), false);
  assert.equal(isWeekOwnedByOffering(undefined, OFFERING_ID), false);
});

test("ownership rejects a NULL-scoped legacy week (no adoption, no Level 1 fallback)", () => {
  assert.equal(isWeekOwnedByOffering({ courseOfferingId: null }, OFFERING_ID), false);
});

test("ownership rejects a blank stored offering id", () => {
  assert.equal(isWeekOwnedByOffering({ courseOfferingId: "" }, OFFERING_ID), false);
});

test("ownership rejects a blank resolved offering id - even against a blank stored id", () => {
  assert.equal(isWeekOwnedByOffering({ courseOfferingId: OFFERING_ID }, ""), false);
  assert.equal(isWeekOwnedByOffering({ courseOfferingId: "" }, ""), false);
  assert.equal(isWeekOwnedByOffering({ courseOfferingId: null }, ""), false);
});

test("ownership rejects padded, case-changed, truncated and prefixed ids", () => {
  const variants = [
    ` ${OFFERING_ID}`,
    `${OFFERING_ID} `,
    OFFERING_ID.toUpperCase(),
    OFFERING_ID.slice(0, OFFERING_ID.length - 1),
    `${OFFERING_ID}x`,
  ];
  for (const stored of variants) {
    assert.equal(
      isWeekOwnedByOffering({ courseOfferingId: stored }, OFFERING_ID),
      false,
      `stored "${stored}" must not match`,
    );
    assert.equal(
      isWeekOwnedByOffering({ courseOfferingId: OFFERING_ID }, stored),
      false,
      `resolved "${stored}" must not match`,
    );
  }
});

test("ownership rejects a different offering", () => {
  assert.equal(
    isWeekOwnedByOffering({ courseOfferingId: "cmrqngqhn00017gcndjixzrh0" }, OFFERING_ID),
    false,
  );
});

// ===========================================================================
// buildWeekCreateData - a NULL-scoped week is not expressible
// ===========================================================================

test("create payload always carries the exact offering id and the header columns", () => {
  const data = buildWeekCreateData(validatedWeek(), OFFERING_ID);
  assert.equal(data.courseOfferingId, OFFERING_ID);
  assert.equal(data.name, 'לו"ז שבוע 1');
  assert.deepEqual(data.startDate, parseDateKey("2026-07-26"));
  assert.deepEqual(data.endDate, parseDateKey("2026-07-31"));
  assert.equal(data.uploadedFileName, "week1.xlsx");
});

test("create payload has EXACTLY the five expected keys - no isPublished", () => {
  const data = buildWeekCreateData(validatedWeek(), OFFERING_ID);
  assert.deepEqual(Object.keys(data).sort(), [
    "courseOfferingId",
    "endDate",
    "name",
    "startDate",
    "uploadedFileName",
  ]);
  assert.equal("isPublished" in data, false);
});

test("a blank or non-string offering id cannot create - it throws", () => {
  for (const bad of ["", "   ".slice(0, 0), null, undefined, 0]) {
    assert.throws(
      () => buildWeekCreateData(validatedWeek(), bad as unknown as string),
      /non-empty, server-resolved courseOfferingId/,
      `expected a throw for ${JSON.stringify(bad)}`,
    );
  }
});

// ===========================================================================
// buildWeekUpdateData - ownership and publication are unreachable
// ===========================================================================

test("update payload has EXACTLY four keys: no courseOfferingId, no isPublished", () => {
  const data = buildWeekUpdateData(validatedWeek());
  assert.deepEqual(Object.keys(data).sort(), [
    "endDate",
    "name",
    "startDate",
    "uploadedFileName",
  ]);
  assert.equal("courseOfferingId" in data, false);
  assert.equal("isPublished" in data, false);
});

test("update payload preserves name, both dates and the uploaded filename", () => {
  const data = buildWeekUpdateData(
    validatedWeek({
      name: "שבוע מעודכן",
      startDateKey: "2026-08-09",
      endDateKey: "2026-08-13",
      uploadedFileName: "week3.xlsx",
    }),
  );
  assert.equal(data.name, "שבוע מעודכן");
  assert.deepEqual(data.startDate, parseDateKey("2026-08-09"));
  assert.deepEqual(data.endDate, parseDateKey("2026-08-13"));
  assert.equal(data.uploadedFileName, "week3.xlsx");
});

test("buildWeekUpdateData takes no offering parameter at all (arity is 1)", () => {
  assert.equal(buildWeekUpdateData.length, 1);
});

// ===========================================================================
// Schedule item rows - filtering, mapping and exact counts
// ===========================================================================

test("rows without a valid dateKey are skipped and counted", () => {
  const items = [
    item({ dateKey: "2026-07-26" }),
    item({ dateKey: null }),
    item({ dateKey: "" }),
    item({ dateKey: "26/07/2026" }),
    item({ dateKey: undefined }),
    item({ dateKey: 20260727 }),
    item({ dateKey: "2026-07-27" }),
  ];
  const selected = selectImportableItems(items);
  assert.equal(selected.savedCount, 2);
  assert.equal(selected.skippedCount, 5);
  assert.equal(selected.savedCount + selected.skippedCount, items.length);
  assert.equal(selected.importable.length, 2);
});

test("counts are exact for all-valid and all-invalid inputs", () => {
  const allValid = selectImportableItems([item(), item(), item()]);
  assert.equal(allValid.savedCount, 3);
  assert.equal(allValid.skippedCount, 0);

  const allInvalid = selectImportableItems([item({ dateKey: null }), item({ dateKey: "x" })]);
  assert.equal(allInvalid.savedCount, 0);
  assert.equal(allInvalid.skippedCount, 2);
  assert.deepEqual(allInvalid.importable, []);

  const empty = selectImportableItems([]);
  assert.deepEqual(empty, { importable: [], savedCount: 0, skippedCount: 0 });
});

test("column mapping matches the existing importer: '' collapses to null", () => {
  const [row] = selectImportableItems([
    item({
      dateKey: "2026-08-02",
      startTime: "10:00",
      endTime: "11:00",
      title: "תיאוריה",
      description: "",
      groupName: "ב",
      instructorName: "",
      location: "אולם",
      rawText: "",
    }),
  ]).importable;

  assert.deepEqual(row, {
    date: parseDateKey("2026-08-02"),
    startTime: "10:00",
    endTime: "11:00",
    title: "תיאוריה",
    description: null,
    groupName: "ב",
    instructorName: null,
    location: "אולם",
    rawText: null,
    // Slice 1: the item() helper sets no combinedParticipation -> null.
    combinedParticipation: null,
  });
  assert.equal("weeklyScheduleId" in row, false);
});

test("non-string item fields coerce to '' (then to null for optional columns)", () => {
  const [row] = selectImportableItems([
    {
      dateKey: "2026-08-02",
      startTime: 800,
      endTime: null,
      title: undefined,
      description: 5,
      groupName: {},
      instructorName: false,
      location: [],
      rawText: undefined,
    },
  ]).importable;

  assert.equal(row.startTime, "");
  assert.equal(row.endTime, "");
  assert.equal(row.title, "");
  assert.equal(row.description, null);
  assert.equal(row.groupName, null);
  assert.equal(row.instructorName, null);
  assert.equal(row.location, null);
  assert.equal(row.rawText, null);
});

test("attachWeeklyScheduleId binds every row and requires a non-empty week id", () => {
  const { importable } = selectImportableItems([item(), item()]);
  const rows = attachWeeklyScheduleId(importable, WEEK_ID);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.weeklyScheduleId, WEEK_ID);
  }
  for (const bad of ["", null, undefined]) {
    assert.throws(
      () => attachWeeklyScheduleId(importable, bad as unknown as string),
      /non-empty weeklyScheduleId/,
    );
  }
});

test("buildScheduleItemRows binds rows and reports exact saved/skipped counts", () => {
  const built = buildScheduleItemRows(
    [item({ dateKey: "2026-08-09" }), item({ dateKey: null }), item({ dateKey: "2026-08-10" })],
    WEEK_ID,
  );
  assert.equal(built.savedCount, 2);
  assert.equal(built.skippedCount, 1);
  assert.equal(built.rows.length, built.savedCount);
  assert.deepEqual(
    built.rows.map((r) => r.weeklyScheduleId),
    [WEEK_ID, WEEK_ID],
  );
});

test("no built row can carry an isPublished or courseOfferingId key", () => {
  const built = buildScheduleItemRows([item()], WEEK_ID);
  for (const row of built.rows) {
    assert.equal("isPublished" in row, false);
    assert.equal("courseOfferingId" in row, false);
  }
});

// ===========================================================================
// Combined Participation Slice 1 - combinedParticipation coercion + malformed
// ===========================================================================

test("selectImportableItems keeps false as false and null as null (no truthiness)", () => {
  const { importable } = selectImportableItems([
    item({ combinedParticipation: true }),
    item({ combinedParticipation: false }),
    item({ combinedParticipation: null }),
    item({ combinedParticipation: undefined }),
    item({}), // absent
  ]);
  assert.equal(importable.length, 5);
  assert.deepEqual(
    importable.map((r) => r.combinedParticipation),
    [true, false, null, null, null],
    "a real `false` must survive; only absent/other becomes null",
  );
});

test("the malformed MARKER never appears on a NormalizedScheduleItem / createMany row", () => {
  const { importable } = selectImportableItems([
    item({ combinedParticipation: false, combinedParticipationMalformed: true }),
  ]);
  for (const row of importable) {
    assert.equal("combinedParticipationMalformed" in row, false);
    // The tri-state value is still present and correctly preserved.
    assert.equal(row.combinedParticipation, false);
  }
  const built = buildScheduleItemRows(
    [item({ combinedParticipation: true, combinedParticipationMalformed: true })],
    WEEK_ID,
  );
  for (const row of built.rows) {
    assert.equal("combinedParticipationMalformed" in row, false);
  }
});

test("hasMalformedCombinedParticipation is true iff any row has the strict marker", () => {
  assert.equal(hasMalformedCombinedParticipation([item(), item()]), false);
  assert.equal(
    hasMalformedCombinedParticipation([item(), item({ combinedParticipationMalformed: true })]),
    true,
  );
  // Only a strict `true` gates.
  assert.equal(
    hasMalformedCombinedParticipation([item({ combinedParticipationMalformed: "true" as unknown })]),
    false,
  );
});

test("validateOfferingWeekInput rejects a malformed משולב row with invalid_combined", () => {
  const result = validateOfferingWeekInput(
    rawInput({ items: [item(), item({ combinedParticipationMalformed: true })] }),
  );
  assert.deepEqual(result, { ok: false, error: "invalid_combined" });
});

test("validateOfferingWeekInput accepts blank and explicit false משולב values", () => {
  const result = validateOfferingWeekInput(
    rawInput({
      items: [item({ combinedParticipation: false }), item({ combinedParticipation: null })],
    }),
  );
  assert.equal(result.ok, true);
});
