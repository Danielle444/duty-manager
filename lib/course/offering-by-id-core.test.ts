/**
 * MULTI-COURSE (dormant foundation, Slice 1) - executable tests for the PURE
 * explicit-ID CourseOffering core.
 *
 * Run with: npx tsx --test lib/course/offering-by-id-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOfferingId,
  mapOfferingByIdRowToView,
  mapSelectableOfferingRowToView,
  orderSelectableOfferings,
  type CourseOfferingByIdRow,
  type SelectableCourseOfferingRow,
} from "./offering-by-id-core";

function idRow(over: Partial<CourseOfferingByIdRow> = {}): CourseOfferingByIdRow {
  return {
    id: "off-1",
    activityYearId: "year-1",
    name: "קורס מדריכים ומאמנים – רמה 1",
    level: 1,
    startDate: new Date("2026-07-05T00:00:00.000Z"),
    endDate: new Date("2026-07-31T00:00:00.000Z"),
    status: "PLANNED",
    ...over,
  };
}

function selRow(over: Partial<SelectableCourseOfferingRow> = {}): SelectableCourseOfferingRow {
  return {
    ...idRow(over),
    activityYear: over.activityYear ?? { name: "תשפ״ו" },
  };
}

// --- A. id normalization -----------------------------------------------------

test("empty id is invalid (null)", () => {
  assert.equal(normalizeOfferingId(""), null);
});

test("whitespace-only id is invalid (null)", () => {
  assert.equal(normalizeOfferingId("   "), null);
  assert.equal(normalizeOfferingId("\t\n "), null);
});

test("a valid id is returned unchanged (not trimmed/rewritten)", () => {
  assert.equal(normalizeOfferingId("cmr6pj73o000reccntxj563gs"), "cmr6pj73o000reccntxj563gs");
});

// --- B. by-id row mapping ----------------------------------------------------

test("row mapping includes exactly the approved view fields", () => {
  const view = mapOfferingByIdRowToView(idRow({ id: "off-x", level: 2, status: "ACTIVE" }));
  assert.deepEqual(Object.keys(view).sort(), [
    "activityYearId",
    "endDate",
    "id",
    "level",
    "name",
    "startDate",
    "status",
  ]);
  assert.deepEqual(view, {
    id: "off-x",
    activityYearId: "year-1",
    name: "קורס מדריכים ומאמנים – רמה 1",
    level: 2,
    startDate: new Date("2026-07-05T00:00:00.000Z"),
    endDate: new Date("2026-07-31T00:00:00.000Z"),
    status: "ACTIVE",
  });
});

test("row mapping passes through null start/end dates without fabrication", () => {
  const view = mapOfferingByIdRowToView(idRow({ startDate: null, endDate: null }));
  assert.equal(view.startDate, null);
  assert.equal(view.endDate, null);
});

test("all three real statuses are supported by the by-id mapper", () => {
  for (const status of ["PLANNED", "ACTIVE", "ARCHIVED"] as const) {
    assert.equal(mapOfferingByIdRowToView(idRow({ status })).status, status);
  }
});

// --- C. selectable row mapping ----------------------------------------------

test("selectable mapping exposes exactly the approved view fields incl. year name", () => {
  const view = mapSelectableOfferingRowToView(selRow());
  assert.deepEqual(Object.keys(view).sort(), [
    "activityYearId",
    "activityYearName",
    "endDate",
    "id",
    "level",
    "name",
    "startDate",
    "status",
  ]);
  assert.equal(view.activityYearName, "תשפ״ו");
});

// --- D. deterministic ordering (public orderSelectableOfferings only) --------

test("ordering places ACTIVE before PLANNED before ARCHIVED", () => {
  const rows = [
    selRow({ id: "archived", status: "ARCHIVED" }),
    selRow({ id: "planned", status: "PLANNED" }),
    selRow({ id: "active", status: "ACTIVE" }),
  ];
  assert.deepEqual(
    orderSelectableOfferings(rows).map((v) => v.id),
    ["active", "planned", "archived"],
  );
});

test("within a status, newer startDate comes before older", () => {
  const rows = [
    selRow({ id: "older", status: "ACTIVE", startDate: new Date("2025-01-01T00:00:00.000Z") }),
    selRow({ id: "newer", status: "ACTIVE", startDate: new Date("2026-01-01T00:00:00.000Z") }),
  ];
  assert.deepEqual(
    orderSelectableOfferings(rows).map((v) => v.id),
    ["newer", "older"],
  );
});

test("within a status, null startDate sorts after all dated rows", () => {
  const rows = [
    selRow({ id: "undated", status: "PLANNED", startDate: null }),
    selRow({ id: "dated", status: "PLANNED", startDate: new Date("2020-01-01T00:00:00.000Z") }),
  ];
  assert.deepEqual(
    orderSelectableOfferings(rows).map((v) => v.id),
    ["dated", "undated"],
  );
});

test("stable tie-breaker: equal status+date orders by name then id", () => {
  const date = new Date("2026-01-01T00:00:00.000Z");
  const rows = [
    selRow({ id: "b", name: "Beta", status: "ACTIVE", startDate: date }),
    selRow({ id: "a", name: "Alpha", status: "ACTIVE", startDate: date }),
    selRow({ id: "a2", name: "Alpha", status: "ACTIVE", startDate: date }),
  ];
  // Alpha before Beta; within Alpha, id "a" before "a2".
  assert.deepEqual(
    orderSelectableOfferings(rows).map((v) => v.id),
    ["a", "a2", "b"],
  );
});

test("two undated rows in the same status order deterministically by id", () => {
  const rows = [
    selRow({ id: "z", name: "Same", status: "ARCHIVED", startDate: null }),
    selRow({ id: "a", name: "Same", status: "ARCHIVED", startDate: null }),
  ];
  assert.deepEqual(
    orderSelectableOfferings(rows).map((v) => v.id),
    ["a", "z"],
  );
});

test("ARCHIVED offerings are included, never silently excluded", () => {
  const rows = [selRow({ id: "arch", status: "ARCHIVED" })];
  const out = orderSelectableOfferings(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "ARCHIVED");
});

test("ordering implies NO automatic selection (no selected/current marker, first != chosen)", () => {
  const rows = [
    selRow({ id: "active", status: "ACTIVE" }),
    selRow({ id: "planned", status: "PLANNED" }),
  ];
  const out = orderSelectableOfferings(rows);
  // No selection marker leaks into the view shape.
  for (const v of out) {
    for (const key of Object.keys(v)) {
      assert.ok(!/select|current|chosen|primary|default/i.test(key), `unexpected key: ${key}`);
    }
  }
  // Returning first in the list must never be interpreted as "select this".
  assert.equal(out.length, 2);
});
