/**
 * MULTI-COURSE W1 - executable tests for the PURE seed-offering backfill
 * planning/mapping logic (backfill-course-offering.plan.ts).
 *
 * Run with: npx tsx --test scripts/backfill-course-offering.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness. Nothing here connects to a
 * database or reads the environment.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  mapEnrollmentStatus,
  normalizeGroupName,
  classifyGroupCell,
  buildGroupPlan,
  reconcile,
  resolveEffectiveFrom,
  resolveOfferingReuse,
  toDateKeyUTC,
  identifyDbTarget,
  PRODUCTION_PROJECT_REF,
  type RawStudent,
  type OfferingCandidate,
  type ExpectedOffering,
} from "./backfill-course-offering.plan";

function student(over: Partial<RawStudent> & { id: string }): RawStudent {
  return {
    groupName: null,
    subgroupNumber: null,
    isActive: true,
    ...over,
  };
}

test("enrollment-status mapping: isActive true->ACTIVE, false->INACTIVE", () => {
  assert.equal(mapEnrollmentStatus(true), "ACTIVE");
  assert.equal(mapEnrollmentStatus(false), "INACTIVE");
});

test("normalizeGroupName trims and collapses blank/whitespace to null", () => {
  assert.equal(normalizeGroupName(null), null);
  assert.equal(normalizeGroupName(""), null);
  assert.equal(normalizeGroupName("   "), null);
  assert.equal(normalizeGroupName(" א "), "א");
  assert.equal(normalizeGroupName("Group 3"), "Group 3");
});

test("classifyGroupCell: hierarchy shapes (no א/ב hardcoding)", () => {
  assert.deepEqual(classifyGroupCell({ groupName: null, subgroupNumber: null }), { kind: "none" });
  assert.deepEqual(classifyGroupCell({ groupName: "א", subgroupNumber: null }), {
    kind: "top",
    top: "א",
  });
  assert.deepEqual(classifyGroupCell({ groupName: "ב", subgroupNumber: 2 }), {
    kind: "sub",
    top: "ב",
    sub: "2",
  });
  // A group name that is neither א nor ב is accepted as a top-level group.
  assert.deepEqual(classifyGroupCell({ groupName: "ג", subgroupNumber: 1 }), {
    kind: "sub",
    top: "ג",
    sub: "1",
  });
});

test("classifyGroupCell: invalid/blank combos are reported, not repaired", () => {
  // subgroup present but parent group blank -> invalid.
  const orphanSub = classifyGroupCell({ groupName: null, subgroupNumber: 1 });
  assert.equal(orphanSub.kind, "invalid");
  // malformed subgroup with a valid parent -> invalid.
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    const r = classifyGroupCell({ groupName: "א", subgroupNumber: bad });
    assert.equal(r.kind, "invalid", `expected invalid for subgroup ${String(bad)}`);
  }
  // malformed subgroup AND blank parent -> still invalid (single bucket).
  assert.equal(classifyGroupCell({ groupName: "", subgroupNumber: 0 }).kind, "invalid");
});

test("buildGroupPlan: same top-level group reused across multiple students", () => {
  const plan = buildGroupPlan([
    student({ id: "s1", groupName: "א", subgroupNumber: 1 }),
    student({ id: "s2", groupName: "א", subgroupNumber: 2 }),
    student({ id: "s3", groupName: "א", subgroupNumber: null }),
  ]);
  assert.deepEqual(plan.topGroups, ["א"]); // deduped to a single top-level row
  assert.equal(plan.memberships.length, 3);
});

test("buildGroupPlan: same subgroup number deduped under the same parent", () => {
  const plan = buildGroupPlan([
    student({ id: "s1", groupName: "א", subgroupNumber: 1 }),
    student({ id: "s2", groupName: "א", subgroupNumber: 1 }),
  ]);
  assert.deepEqual(plan.topGroups, ["א"]);
  assert.deepEqual(plan.subGroups, [{ parentTop: "א", name: "1" }]); // one, not two
});

test("buildGroupPlan: same subgroup number under DIFFERENT parents => distinct rows", () => {
  const plan = buildGroupPlan([
    student({ id: "s1", groupName: "א", subgroupNumber: 1 }),
    student({ id: "s2", groupName: "ב", subgroupNumber: 1 }),
  ]);
  assert.deepEqual(plan.topGroups, ["א", "ב"]);
  assert.deepEqual(plan.subGroups, [
    { parentTop: "א", name: "1" },
    { parentTop: "ב", name: "1" },
  ]);
});

test("buildGroupPlan: blank group => ungrouped, no membership", () => {
  const plan = buildGroupPlan([
    student({ id: "s1", groupName: null, subgroupNumber: null }),
    student({ id: "s2", groupName: "   ", subgroupNumber: null }),
  ]);
  assert.deepEqual(plan.ungrouped, ["s1", "s2"]);
  assert.equal(plan.memberships.length, 0);
  assert.equal(plan.topGroups.length, 0);
});

test("buildGroupPlan: invalid combos reported with reasons, get no membership", () => {
  const plan = buildGroupPlan([
    student({ id: "s1", groupName: null, subgroupNumber: 3 }),
    student({ id: "s2", groupName: "א", subgroupNumber: 0 }),
    student({ id: "s3", groupName: "א", subgroupNumber: 2 }),
  ]);
  assert.equal(plan.invalid.length, 2);
  assert.deepEqual(
    plan.invalid.map((i) => i.studentId).sort(),
    ["s1", "s2"],
  );
  // Only the valid student got a membership.
  assert.deepEqual(
    plan.memberships.map((m) => m.studentId),
    ["s3"],
  );
});

test("buildGroupPlan: membership target is the deepest valid group", () => {
  const plan = buildGroupPlan([
    student({ id: "s1", groupName: "א", subgroupNumber: 2 }),
    student({ id: "s2", groupName: "ב", subgroupNumber: null }),
  ]);
  assert.deepEqual(plan.memberships, [
    { studentId: "s1", target: { kind: "sub", top: "א", sub: "2" } },
    { studentId: "s2", target: { kind: "top", top: "ב" } },
  ]);
});

test("buildGroupPlan is deterministic (idempotent planning input)", () => {
  const rows = [
    student({ id: "s1", groupName: "א", subgroupNumber: 1 }),
    student({ id: "s2", groupName: "ב", subgroupNumber: 1 }),
    student({ id: "s3", groupName: null, subgroupNumber: null }),
  ];
  assert.deepEqual(buildGroupPlan(rows), buildGroupPlan(rows));
});

test("reconcile: idempotency - everything present yields no creates", () => {
  const planned = ["א", "ב", "ג"];
  const all = reconcile(planned, new Set(planned));
  assert.deepEqual(all.toCreate, []);
  assert.deepEqual(all.toReuse, ["א", "ב", "ג"]);

  const partial = reconcile(planned, new Set(["א"]));
  assert.deepEqual(partial.toReuse, ["א"]);
  assert.deepEqual(partial.toCreate, ["ב", "ג"]);

  const none = reconcile(planned, new Set());
  assert.deepEqual(none.toCreate, ["א", "ב", "ג"]);
  assert.deepEqual(none.toReuse, []);
});

test("resolveEffectiveFrom: returns the course start key, rejects bad dates", () => {
  assert.equal(resolveEffectiveFrom("2026-03-01"), "2026-03-01");
  assert.throws(() => resolveEffectiveFrom("2026-13-01"));
  assert.throws(() => resolveEffectiveFrom("2026-02-30"));
  assert.throws(() => resolveEffectiveFrom("not-a-date"));
});

test("toDateKeyUTC: formats a @db.Date UTC-midnight value without tz shift", () => {
  assert.equal(toDateKeyUTC(new Date("2026-03-01T00:00:00.000Z")), "2026-03-01");
  assert.equal(toDateKeyUTC(new Date("2026-12-31T00:00:00.000Z")), "2026-12-31");
});

test("identifyDbTarget: production ref detected, credentials never exposed", () => {
  const prodUrl = `postgresql://postgres:SECRETPW@${PRODUCTION_PROJECT_REF}.pooler.supabase.com:6543/postgres`;
  const prod = identifyDbTarget(prodUrl);
  assert.equal(prod.isProduction, true);
  assert.equal(prod.projectRef, PRODUCTION_PROJECT_REF);
  assert.ok(!prod.display.includes("SECRETPW"), "display must not contain the password");
  assert.ok(!prod.host.includes("SECRETPW"), "host must not contain the password");
  assert.ok(prod.display.includes("[PRODUCTION]"));
});

test("identifyDbTarget: non-production dev URL", () => {
  const dev = identifyDbTarget("postgresql://postgres:pw@devref123.pooler.supabase.com:6543/postgres");
  assert.equal(dev.isProduction, false);
  assert.equal(dev.projectRef, "devref123");
  assert.ok(!dev.display.includes("pw@"));
});

test("identifyDbTarget: missing/blank URL is handled safely", () => {
  const none = identifyDbTarget(undefined);
  assert.equal(none.isProduction, false);
  assert.equal(none.host, "<no DATABASE_URL set>");
});

// --- Seed CourseOffering reuse / idempotency (MULTI-COURSE W2A) --------------

const YEAR = "year-2026-id";
const SEED_NAME = "קורס מדריכים ומאמנים – רמה 1";

function offeringCandidate(over: Partial<OfferingCandidate> & { id: string }): OfferingCandidate {
  return {
    activityYearId: YEAR,
    name: SEED_NAME,
    level: 1,
    startDate: new Date("2026-03-01T00:00:00.000Z"),
    endDate: new Date("2026-09-01T00:00:00.000Z"),
    ...over,
  };
}

const EXPECTED: ExpectedOffering = {
  activityYearId: YEAR,
  name: SEED_NAME,
  level: 1,
  startKey: "2026-03-01",
  endKey: "2026-09-01",
};

test("resolveOfferingReuse: no matching row => CREATE (query is by year+name)", () => {
  // The runner queries by (activityYearId, name); a same-year, same-level but
  // DIFFERENTLY-named offering is simply never returned, so candidates is empty.
  assert.deepEqual(resolveOfferingReuse([], EXPECTED), { action: "create" });
});

test("resolveOfferingReuse: same year+level but different name is NOT reused", () => {
  // Defensive guard: even if a differently-named row were passed in, identity is
  // (year, name) - level alone must never cause reuse of a different offering.
  const decision = resolveOfferingReuse(
    [offeringCandidate({ id: "other", name: "קורס אחר – רמה 1", level: 1 })],
    EXPECTED,
  );
  assert.notEqual(decision.action, "reuse");
});

test("resolveOfferingReuse: exact year+name (level ok) is REUSED, no warnings", () => {
  const decision = resolveOfferingReuse([offeringCandidate({ id: "off-1" })], EXPECTED);
  assert.equal(decision.action, "reuse");
  assert.equal(decision.action === "reuse" && decision.offeringId, "off-1");
  assert.deepEqual(decision.action === "reuse" && decision.warnings, []);
});

test("resolveOfferingReuse: same name but conflicting level STOPS (conflict)", () => {
  const decision = resolveOfferingReuse(
    [offeringCandidate({ id: "off-lvl2", level: 2 })],
    EXPECTED,
  );
  assert.equal(decision.action, "stop");
  assert.match(decision.action === "stop" ? decision.reason : "", /CONFLICT/);
  assert.match(decision.action === "stop" ? decision.reason : "", /level/);
});

test("resolveOfferingReuse: multiple matching rows STOP instead of picking one", () => {
  const decision = resolveOfferingReuse(
    [offeringCandidate({ id: "dup-a" }), offeringCandidate({ id: "dup-b" })],
    EXPECTED,
  );
  assert.equal(decision.action, "stop");
  assert.match(decision.action === "stop" ? decision.reason : "", /AMBIGUOUS/);
  // Both ids reported; neither silently selected.
  assert.match(decision.action === "stop" ? decision.reason : "", /dup-a/);
  assert.match(decision.action === "stop" ? decision.reason : "", /dup-b/);
});

test("resolveOfferingReuse: date drift is REPORTED (warning), never overwritten", () => {
  const decision = resolveOfferingReuse(
    [
      offeringCandidate({
        id: "off-drift",
        startDate: new Date("2026-03-15T00:00:00.000Z"),
        endDate: null,
      }),
    ],
    EXPECTED,
  );
  assert.equal(decision.action, "reuse");
  assert.equal(decision.action === "reuse" && decision.offeringId, "off-drift");
  const warnings = decision.action === "reuse" ? decision.warnings : [];
  assert.equal(warnings.length, 2);
  assert.match(warnings.join(" | "), /startDate 2026-03-15 differs from expected 2026-03-01/);
  assert.match(warnings.join(" | "), /endDate <null> differs from expected 2026-09-01/);
});

test("resolveOfferingReuse: rerun is idempotent (reuse same id, deterministic)", () => {
  const candidates = [offeringCandidate({ id: "off-1" })];
  const first = resolveOfferingReuse(candidates, EXPECTED);
  const second = resolveOfferingReuse(candidates, EXPECTED);
  assert.deepEqual(first, second);
  assert.equal(first.action, "reuse");
  assert.equal(first.action === "reuse" && first.offeringId, "off-1");
});
