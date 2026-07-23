/**
 * MULTI-COURSE (course-affiliation display slice A1) - DB-free tests for the PURE
 * affiliation-summary core.
 *
 * Run with: npx tsx --test lib/course/trainee-affiliations-core.test.ts
 * No Prisma, no DB: every case is a plain object fed to buildTraineeAffiliationSummary
 * / buildTraineeAffiliationRows. These prove the visibility filter (ACTIVE-only,
 * non-ARCHIVED), the PLANNED-is-visible rule, the deterministic badge ordering and
 * dedup, the Hebrew short-label rules, input immutability, and that groupName/
 * subgroupNumber are never consulted for affiliation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTraineeAffiliationSummary,
  buildTraineeAffiliationRows,
  NO_COURSE_LABEL,
  type RawAffiliationEnrollment,
  type RawStudentWithAffiliations,
} from "./trainee-affiliations-core";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function offering(
  id: string,
  level: number,
  status: "PLANNED" | "ACTIVE" | "ARCHIVED" = "ACTIVE",
  name = `offering-${id}`,
) {
  return { id, name, level, status } as const;
}

function enrollment(
  overrides: Partial<RawAffiliationEnrollment> & {
    courseOffering: RawAffiliationEnrollment["courseOffering"];
  },
): RawAffiliationEnrollment {
  return {
    id: overrides.id ?? `e-${overrides.courseOffering.id}`,
    status: overrides.status ?? "ACTIVE",
    isPrimary: overrides.isPrimary ?? false,
    courseOfferingId: overrides.courseOfferingId ?? overrides.courseOffering.id,
    courseOffering: overrides.courseOffering,
  };
}

// ---------------------------------------------------------------------------
// 1-3. "ללא קורס" cases (no visible affiliation)
// ---------------------------------------------------------------------------

test("no enrollments -> ללא קורס", () => {
  const s = buildTraineeAffiliationSummary([]);
  assert.deepEqual(s.visibleAffiliations, []);
  assert.equal(s.activeAffiliationCount, 0);
  assert.equal(s.hasNoActiveCourse, true);
  assert.equal(s.isCombined, false);
  assert.equal(s.shortLabel, NO_COURSE_LABEL);
});

test("only an INACTIVE enrollment -> ללא קורס", () => {
  const s = buildTraineeAffiliationSummary([
    enrollment({ status: "INACTIVE", courseOffering: offering("o1", 1, "ACTIVE") }),
  ]);
  assert.equal(s.hasNoActiveCourse, true);
  assert.equal(s.shortLabel, NO_COURSE_LABEL);
  assert.equal(s.isCombined, false);
});

test("ACTIVE enrollment in an ARCHIVED offering -> ללא קורס", () => {
  const s = buildTraineeAffiliationSummary([
    enrollment({ status: "ACTIVE", courseOffering: offering("o1", 1, "ARCHIVED") }),
  ]);
  assert.equal(s.hasNoActiveCourse, true);
  assert.equal(s.shortLabel, NO_COURSE_LABEL);
});

// ---------------------------------------------------------------------------
// 4-5. Single-affiliation labels
// ---------------------------------------------------------------------------

test("ACTIVE Level 1 enrollment in ACTIVE offering -> רמה 1", () => {
  const s = buildTraineeAffiliationSummary([
    enrollment({ courseOffering: offering("o1", 1, "ACTIVE") }),
  ]);
  assert.equal(s.shortLabel, "רמה 1");
  assert.equal(s.activeAffiliationCount, 1);
  assert.equal(s.hasNoActiveCourse, false);
  assert.equal(s.isCombined, false);
  assert.deepEqual(s.visibleAffiliations, [
    { courseOfferingId: "o1", name: "offering-o1", level: 1, isPrimary: false },
  ]);
});

test("ACTIVE Level 2 enrollment in a PLANNED offering is VISIBLE -> רמה 2", () => {
  const s = buildTraineeAffiliationSummary([
    enrollment({ courseOffering: offering("o2", 2, "PLANNED") }),
  ]);
  assert.equal(s.shortLabel, "רמה 2");
  assert.equal(s.activeAffiliationCount, 1);
  assert.equal(s.visibleAffiliations[0].courseOfferingId, "o2");
});

// ---------------------------------------------------------------------------
// 6. Combined
// ---------------------------------------------------------------------------

test("ACTIVE Level 1 + ACTIVE Level 2 -> רמה 1 + רמה 2 and combined", () => {
  const s = buildTraineeAffiliationSummary([
    enrollment({ courseOffering: offering("o1", 1, "ACTIVE") }),
    enrollment({ courseOffering: offering("o2", 2, "PLANNED") }),
  ]);
  assert.equal(s.shortLabel, "רמה 1 + רמה 2");
  assert.equal(s.activeAffiliationCount, 2);
  assert.equal(s.isCombined, true);
});

test("combined label is level-ascending regardless of input order", () => {
  const s = buildTraineeAffiliationSummary([
    enrollment({ courseOffering: offering("o2", 2, "ACTIVE") }),
    enrollment({ courseOffering: offering("o1", 1, "ACTIVE") }),
  ]);
  assert.equal(s.shortLabel, "רמה 1 + רמה 2");
});

// ---------------------------------------------------------------------------
// 7-9. Ordering: primary first, then level, then name, then id
// ---------------------------------------------------------------------------

test("isPrimary=true sorts first even when its level is higher", () => {
  const s = buildTraineeAffiliationSummary([
    enrollment({ courseOffering: offering("o1", 1, "ACTIVE"), isPrimary: false }),
    enrollment({ courseOffering: offering("o2", 2, "ACTIVE"), isPrimary: true }),
  ]);
  assert.deepEqual(
    s.visibleAffiliations.map((a) => a.courseOfferingId),
    ["o2", "o1"],
  );
});

test("among non-primary affiliations, level ascending", () => {
  const s = buildTraineeAffiliationSummary([
    enrollment({ courseOffering: offering("oB", 3, "ACTIVE") }),
    enrollment({ courseOffering: offering("oA", 1, "ACTIVE") }),
    enrollment({ courseOffering: offering("oC", 2, "ACTIVE") }),
  ]);
  assert.deepEqual(
    s.visibleAffiliations.map((a) => a.level),
    [1, 2, 3],
  );
});

test("same level -> ordered by name then by offering id", () => {
  const s = buildTraineeAffiliationSummary([
    enrollment({ courseOffering: offering("id-2", 2, "ACTIVE", "בית") }),
    enrollment({ courseOffering: offering("id-1", 2, "ACTIVE", "אבן") }),
    enrollment({ courseOffering: offering("id-0", 2, "ACTIVE", "אבן") }),
  ]);
  // Names sort first ("אבן" before "בית"); ties on name break by offering id asc.
  assert.deepEqual(
    s.visibleAffiliations.map((a) => a.courseOfferingId),
    ["id-0", "id-1", "id-2"],
  );
});

// ---------------------------------------------------------------------------
// 10-11. Dedup of levels (label) and of offering ids (badges)
// ---------------------------------------------------------------------------

test("two ACTIVE enrollments with the SAME level -> label dedups but both badges remain", () => {
  const s = buildTraineeAffiliationSummary([
    enrollment({ courseOffering: offering("oX", 2, "ACTIVE") }),
    enrollment({ courseOffering: offering("oY", 2, "PLANNED") }),
  ]);
  assert.equal(s.shortLabel, "רמה 2");
  assert.equal(s.activeAffiliationCount, 2);
  assert.equal(s.isCombined, true);
});

test("duplicate raw rows for the SAME offering id collapse to one badge", () => {
  const off = offering("o1", 1, "ACTIVE");
  const s = buildTraineeAffiliationSummary([
    enrollment({ id: "e1", courseOffering: off }),
    enrollment({ id: "e2", courseOffering: off }),
  ]);
  assert.equal(s.activeAffiliationCount, 1);
  assert.equal(s.isCombined, false);
  assert.deepEqual(s.visibleAffiliations.map((a) => a.courseOfferingId), ["o1"]);
});

test("duplicate offering rows: any primary row marks the single badge primary", () => {
  const off = offering("o1", 1, "ACTIVE");
  const s = buildTraineeAffiliationSummary([
    enrollment({ id: "e1", courseOffering: off, isPrimary: false }),
    enrollment({ id: "e2", courseOffering: off, isPrimary: true }),
  ]);
  assert.equal(s.visibleAffiliations.length, 1);
  assert.equal(s.visibleAffiliations[0].isPrimary, true);
});

// ---------------------------------------------------------------------------
// 12-13. Multiple / no primary remain deterministic
// ---------------------------------------------------------------------------

test("multiple primary rows across offerings remain deterministic (level asc among them)", () => {
  const s = buildTraineeAffiliationSummary([
    enrollment({ courseOffering: offering("o2", 2, "ACTIVE"), isPrimary: true }),
    enrollment({ courseOffering: offering("o1", 1, "ACTIVE"), isPrimary: true }),
  ]);
  assert.deepEqual(
    s.visibleAffiliations.map((a) => a.courseOfferingId),
    ["o1", "o2"],
  );
});

test("no primary row remains deterministic", () => {
  const s = buildTraineeAffiliationSummary([
    enrollment({ courseOffering: offering("o2", 2, "ACTIVE"), isPrimary: false }),
    enrollment({ courseOffering: offering("o1", 1, "ACTIVE"), isPrimary: false }),
  ]);
  assert.deepEqual(
    s.visibleAffiliations.map((a) => a.courseOfferingId),
    ["o1", "o2"],
  );
});

// ---------------------------------------------------------------------------
// 14. Immutability
// ---------------------------------------------------------------------------

test("input array and rows are not mutated", () => {
  const input: RawAffiliationEnrollment[] = [
    enrollment({ courseOffering: offering("o2", 2, "ACTIVE") }),
    enrollment({ courseOffering: offering("o1", 1, "ACTIVE") }),
  ];
  const snapshot = JSON.parse(JSON.stringify(input));
  buildTraineeAffiliationSummary(input);
  assert.deepEqual(JSON.parse(JSON.stringify(input)), snapshot);
});

// ---------------------------------------------------------------------------
// 15. groupName / subgroupNumber are never used for affiliation
// ---------------------------------------------------------------------------

test("groupName/subgroupNumber on the student never affect affiliation", () => {
  const base: Omit<RawStudentWithAffiliations, "groupName" | "subgroupNumber"> = {
    id: "s1",
    firstName: "אבי",
    lastName: "כהן",
    fullName: "אבי כהן",
    identityNumber: "111",
    phone: null,
    isActive: true,
    courseEnrollments: [enrollment({ courseOffering: offering("o1", 1, "ACTIVE") })],
  };
  const withGroup = buildTraineeAffiliationRows([
    { ...base, groupName: "ג", subgroupNumber: 3 },
  ]);
  const withoutGroup = buildTraineeAffiliationRows([
    { ...base, groupName: null, subgroupNumber: null },
  ]);
  assert.deepEqual(withGroup[0].affiliation, withoutGroup[0].affiliation);
  assert.equal(withGroup[0].affiliation.shortLabel, "רמה 1");
});

// ---------------------------------------------------------------------------
// 16. INACTIVE / ARCHIVED do not count toward isCombined
// ---------------------------------------------------------------------------

test("INACTIVE and ARCHIVED entries do not count toward isCombined", () => {
  const s = buildTraineeAffiliationSummary([
    enrollment({ courseOffering: offering("o1", 1, "ACTIVE"), status: "ACTIVE" }),
    enrollment({ courseOffering: offering("o2", 2, "ACTIVE"), status: "INACTIVE" }),
    enrollment({ courseOffering: offering("o3", 2, "ARCHIVED"), status: "ACTIVE" }),
  ]);
  assert.equal(s.activeAffiliationCount, 1);
  assert.equal(s.isCombined, false);
  assert.equal(s.shortLabel, "רמה 1");
});

// ---------------------------------------------------------------------------
// Fail-closed: a malformed (non-schema-reachable) level is dropped, never thrown
// ---------------------------------------------------------------------------

test("a non-finite level is dropped fail-closed rather than throwing", () => {
  const s = buildTraineeAffiliationSummary([
    enrollment({ courseOffering: offering("bad", Number.NaN, "ACTIVE") }),
    enrollment({ courseOffering: offering("ok", 1, "ACTIVE") }),
  ]);
  assert.deepEqual(s.visibleAffiliations.map((a) => a.courseOfferingId), ["ok"]);
  assert.equal(s.shortLabel, "רמה 1");
});

// ---------------------------------------------------------------------------
// Row assembly preserves DB student order and carries display fields through
// ---------------------------------------------------------------------------

test("buildTraineeAffiliationRows preserves student input order and display fields", () => {
  const rows = buildTraineeAffiliationRows([
    {
      id: "s2",
      firstName: "בני",
      lastName: "לוי",
      fullName: "בני לוי",
      groupName: "א",
      subgroupNumber: 1,
      identityNumber: "222",
      phone: "050",
      isActive: false,
      courseEnrollments: [],
    },
    {
      id: "s1",
      firstName: "אבי",
      lastName: "כהן",
      fullName: "אבי כהן",
      groupName: null,
      subgroupNumber: null,
      identityNumber: "111",
      phone: null,
      isActive: true,
      courseEnrollments: [enrollment({ courseOffering: offering("o1", 1, "ACTIVE") })],
    },
  ]);
  // Order is preserved exactly as given (the reader owns the DB orderBy).
  assert.deepEqual(rows.map((r) => r.id), ["s2", "s1"]);
  assert.equal(rows[0].affiliation.shortLabel, NO_COURSE_LABEL);
  assert.equal(rows[1].affiliation.shortLabel, "רמה 1");
  assert.equal(rows[0].phone, "050");
  assert.equal(rows[1].identityNumber, "111");
});
