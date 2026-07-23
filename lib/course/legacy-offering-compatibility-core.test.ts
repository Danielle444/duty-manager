/**
 * URGENT LEVEL 2 ACCESS - SLICE L2-0: tests for the PURE legacy two-ACTIVE
 * compatibility filter.
 *
 * Run with: npx tsx --test lib/course/legacy-offering-compatibility-core.test.ts
 * No Prisma, no DB, no clock, no randomness.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { selectLegacyCompatibleActiveRows } from "./legacy-offering-compatibility-core";
import type { CourseOfferingRow } from "./current-offering-core";

const L1 = "cmrqngqhn00017gcndjixzrh0";
const L2 = "cmrxk58vc0000lscnfm54bpze";
const COMPAT = { level1OfferingId: L1, level2OfferingId: L2 };

function row(id: string, overrides: Partial<CourseOfferingRow> = {}): CourseOfferingRow {
  return {
    id,
    activityYearId: "year-1",
    name: "קורס",
    level: 1,
    startDate: new Date("2026-07-05T00:00:00.000Z"),
    endDate: new Date("2026-07-31T00:00:00.000Z"),
    status: "ACTIVE",
    ...overrides,
  };
}

test("zero rows passes through untouched", () => {
  const rows: CourseOfferingRow[] = [];
  assert.equal(selectLegacyCompatibleActiveRows(rows, COMPAT), rows);
});

test("one row passes through untouched (identity, not a copy)", () => {
  const rows = [row(L1)];
  assert.equal(selectLegacyCompatibleActiveRows(rows, COMPAT), rows);
});

test("one row that is the Level 2 offering still passes through untouched", () => {
  // Level 2 alone ACTIVE is a legitimate single-offering state; the filter does
  // NOT rewrite it to Level 1 and does not drop it.
  const rows = [row(L2, { level: 2 })];
  const result = selectLegacyCompatibleActiveRows(rows, COMPAT);
  assert.equal(result, rows);
  assert.equal(result[0].id, L2);
});

test("exactly the known Level 1 + Level 2 pair narrows to the Level 1 row", () => {
  const l1 = row(L1);
  const l2 = row(L2, { level: 2 });
  const result = selectLegacyCompatibleActiveRows([l1, l2], COMPAT);
  assert.equal(result.length, 1);
  assert.equal(result[0], l1);
});

test("the known pair narrows to Level 1 regardless of row order", () => {
  // Proves the decision is id-set equality, not row position.
  const l1 = row(L1);
  const l2 = row(L2, { level: 2 });
  const result = selectLegacyCompatibleActiveRows([l2, l1], COMPAT);
  assert.equal(result.length, 1);
  assert.equal(result[0], l1);
});

test("known Level 1 + an unknown third ACTIVE offering passes through (stays ambiguous)", () => {
  const rows = [row(L1), row(L2, { level: 2 }), row("offer-unknown", { level: 3 })];
  assert.equal(selectLegacyCompatibleActiveRows(rows, COMPAT), rows);
});

test("Level 1 paired with an unknown offering passes through (stays ambiguous)", () => {
  const rows = [row(L1), row("offer-unknown")];
  assert.equal(selectLegacyCompatibleActiveRows(rows, COMPAT), rows);
});

test("Level 2 paired with an unknown offering passes through (stays ambiguous)", () => {
  const rows = [row(L2, { level: 2 }), row("offer-unknown")];
  assert.equal(selectLegacyCompatibleActiveRows(rows, COMPAT), rows);
});

test("two unknown offerings pass through (stays ambiguous)", () => {
  const rows = [row("offer-a"), row("offer-b")];
  assert.equal(selectLegacyCompatibleActiveRows(rows, COMPAT), rows);
});

test("a duplicated Level 1 row is not the known pair (stays ambiguous)", () => {
  const rows = [row(L1), row(L1)];
  assert.equal(selectLegacyCompatibleActiveRows(rows, COMPAT), rows);
});

test("no name / level / date / activityYear inference decides the pair", () => {
  // Two rows carrying Level-1-looking metadata but UNKNOWN ids must stay
  // ambiguous: only the exact ids matter.
  const rows = [
    row("decoy-1", { name: "קורס מדריכים ומאמנים – רמה 1", level: 1 }),
    row("decoy-2", {
      name: "קורס מדריכים ומאמנים – רמה 2",
      level: 2,
      startDate: new Date("2020-01-01T00:00:00.000Z"),
    }),
  ];
  assert.equal(selectLegacyCompatibleActiveRows(rows, COMPAT), rows);
});

test("the filter never mutates the input array", () => {
  const l1 = row(L1);
  const l2 = row(L2, { level: 2 });
  const rows = [l1, l2];
  selectLegacyCompatibleActiveRows(rows, COMPAT);
  assert.deepEqual(rows, [l1, l2]);
  assert.equal(rows.length, 2);
});

test("the filter never mutates offering status", () => {
  const l1 = row(L1, { status: "ACTIVE" });
  const l2 = row(L2, { level: 2, status: "ACTIVE" });
  const result = selectLegacyCompatibleActiveRows([l1, l2], COMPAT);
  assert.equal(result[0].status, "ACTIVE");
  assert.equal(l2.status, "ACTIVE");
});

test("degenerate config where both compatibility ids are identical stays ambiguous", () => {
  const rows = [row(L1), row(L1)];
  assert.equal(
    selectLegacyCompatibleActiveRows(rows, {
      level1OfferingId: L1,
      level2OfferingId: L1,
    }),
    rows,
  );
});
