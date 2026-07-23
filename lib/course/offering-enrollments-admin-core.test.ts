/**
 * MULTI-COURSE (enrollment slice E3) - DB-free tests for the admin enrollment-
 * setup verification list core.
 *
 * Run: npx tsx --test lib/course/offering-enrollments-admin-core.test.ts
 * No Prisma, no DB: raw enrollment rows + an explicit asOf are fed to the pure
 * builder, proving the future-dated-membership-at-offering-start behaviour, the
 * privacy-narrow display shape, deterministic ordering, and the stable
 * membership-state markers - without a live database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAdminEnrollmentDisplayRows,
  type AdminEnrollmentRow,
} from "./offering-enrollments-admin-core";

const START = new Date("2026-07-26T00:00:00.000Z"); // offering.startDate
const TODAY = new Date("2026-07-23T00:00:00.000Z"); // before the offering starts

/** A leaf-subgroup membership, effectiveFrom defaulting to the offering start. */
function subgroupEnrollment(
  id: string,
  fullName: string,
  identityNumber: string,
  subgroupName: string,
  parentName: string,
  opts: { effectiveFrom?: Date; status?: "ACTIVE" | "INACTIVE"; isPrimary?: boolean } = {},
): AdminEnrollmentRow {
  return {
    id,
    status: opts.status ?? "ACTIVE",
    isPrimary: opts.isPrimary ?? false,
    student: { id, fullName, identityNumber },
    memberships: [
      {
        effectiveFrom: opts.effectiveFrom ?? START,
        effectiveTo: null,
        courseGroup: {
          name: subgroupName,
          parentGroupId: "g-top",
          parentGroup: { name: parentName },
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The core caveat: a future-dated initial membership must show as current at
// asOf = offering.startDate, and NOT current at today.
// ---------------------------------------------------------------------------

test("future-dated membership at asOf = offering.startDate resolves as OK with the subgroup label", () => {
  const rows = buildAdminEnrollmentDisplayRows(
    [subgroupEnrollment("s1", "אבי כהן", "123456789", "1", "ג")],
    START,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].membershipState, "OK");
  assert.equal(rows[0].subgroupLabel, "ג / 1");
  assert.deepEqual(rows[0].effectiveFrom, START);
});

test("the SAME membership at asOf = today (before start) is NO_CURRENT (why asOf must be the start date)", () => {
  const rows = buildAdminEnrollmentDisplayRows(
    [subgroupEnrollment("s1", "אבי כהן", "123456789", "1", "ג")],
    TODAY,
  );
  assert.equal(rows[0].membershipState, "NO_CURRENT");
  assert.equal(rows[0].subgroupLabel, null);
  assert.equal(rows[0].effectiveFrom, null);
});

// ---------------------------------------------------------------------------
// Display fields + privacy
// ---------------------------------------------------------------------------

test("status and isPrimary are surfaced verbatim", () => {
  const rows = buildAdminEnrollmentDisplayRows(
    [subgroupEnrollment("s1", "אבי כהן", "123456789", "1", "ג", { status: "INACTIVE", isPrimary: true })],
    START,
  );
  assert.equal(rows[0].status, "INACTIVE");
  assert.equal(rows[0].isPrimary, true);
});

test("display row exposes ONLY the approved fields (identityNumber present, no phone/horse)", () => {
  const [row] = buildAdminEnrollmentDisplayRows(
    [subgroupEnrollment("s1", "אבי כהן", "123456789", "1", "ג")],
    START,
  );
  assert.deepEqual(
    Object.keys(row).sort(),
    ["effectiveFrom", "fullName", "identityNumber", "isPrimary", "membershipState", "status", "studentId", "subgroupLabel"],
  );
  const serialized = JSON.stringify(row);
  for (const forbidden of ["phone", "hasPrivateHorse", "privateHorseName", "assignedHorseName", "groupName", "subgroupNumber"]) {
    assert.equal(serialized.includes(forbidden), false, `row must not expose ${forbidden}`);
  }
});

test("the core returns the raw identityNumber (masking is the page's concern)", () => {
  const [row] = buildAdminEnrollmentDisplayRows(
    [subgroupEnrollment("s1", "אבי כהן", "123456789", "1", "ג")],
    START,
  );
  assert.equal(row.identityNumber, "123456789");
});

// ---------------------------------------------------------------------------
// Group resolution variants
// ---------------------------------------------------------------------------

test("a top-level membership yields the group name with no subgroup part", () => {
  const enrollment: AdminEnrollmentRow = {
    id: "s1",
    status: "ACTIVE",
    isPrimary: false,
    student: { id: "s1", fullName: "אבי כהן", identityNumber: "123456789" },
    memberships: [
      { effectiveFrom: START, effectiveTo: null, courseGroup: { name: "ג", parentGroupId: null, parentGroup: null } },
    ],
  };
  const [row] = buildAdminEnrollmentDisplayRows([enrollment], START);
  assert.equal(row.membershipState, "OK");
  assert.equal(row.subgroupLabel, "ג");
});

test("a malformed (non-integer) subgroup name is UNRESOLVED, not hidden", () => {
  const [row] = buildAdminEnrollmentDisplayRows(
    [subgroupEnrollment("s1", "אבי כהן", "123456789", "abc", "ג")],
    START,
  );
  assert.equal(row.membershipState, "UNRESOLVED");
  assert.equal(row.subgroupLabel, null);
  assert.deepEqual(row.effectiveFrom, START);
});

test("more than one membership current at asOf is MULTIPLE (never picks one arbitrarily)", () => {
  const enrollment: AdminEnrollmentRow = {
    id: "s1",
    status: "ACTIVE",
    isPrimary: false,
    student: { id: "s1", fullName: "אבי כהן", identityNumber: "123456789" },
    memberships: [
      { effectiveFrom: START, effectiveTo: null, courseGroup: { name: "1", parentGroupId: "g-top", parentGroup: { name: "ג" } } },
      { effectiveFrom: START, effectiveTo: null, courseGroup: { name: "2", parentGroupId: "g-top", parentGroup: { name: "ג" } } },
    ],
  };
  const [row] = buildAdminEnrollmentDisplayRows([enrollment], START);
  assert.equal(row.membershipState, "MULTIPLE");
  assert.equal(row.subgroupLabel, null);
});

test("a null asOf resolves nothing -> NO_CURRENT (offering-with-no-startDate guard)", () => {
  const [row] = buildAdminEnrollmentDisplayRows(
    [subgroupEnrollment("s1", "אבי כהן", "123456789", "1", "ג")],
    null,
  );
  assert.equal(row.membershipState, "NO_CURRENT");
});

// ---------------------------------------------------------------------------
// Deterministic ordering + no mutation
// ---------------------------------------------------------------------------

test("rows are ordered by fullName ascending (Hebrew-aware), then studentId", () => {
  const rows = buildAdminEnrollmentDisplayRows(
    [
      subgroupEnrollment("s2", "בני לוי", "222222222", "1", "ג"),
      subgroupEnrollment("s1", "אבי כהן", "111111111", "2", "ג"),
    ],
    START,
  );
  assert.deepEqual(rows.map((r) => r.studentId), ["s1", "s2"]);
});

test("the input rows are not mutated", () => {
  const input = [subgroupEnrollment("s1", "אבי כהן", "123456789", "1", "ג")];
  const snapshot = JSON.stringify(input);
  buildAdminEnrollmentDisplayRows(input, START);
  assert.equal(JSON.stringify(input), snapshot);
});

test("empty input -> empty list", () => {
  assert.deepEqual(buildAdminEnrollmentDisplayRows([], START), []);
});
