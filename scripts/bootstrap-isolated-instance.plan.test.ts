/**
 * MC-BOOTSTRAP-S1 — executable tests for the PURE isolated-instance bootstrap
 * planning/validation core (bootstrap-isolated-instance.plan.ts).
 *
 * Run with: npx tsx --test scripts/bootstrap-isolated-instance.plan.test.ts
 *
 * PURE: no Prisma, no DB, no Supabase, no Storage, no clock, no randomness, no
 * environment. Nothing here connects anywhere or mocks a database connection.
 *
 * All fixtures are SYNTHETIC: no real course names, group names, people, emails,
 * identity numbers, phones, domains, URLs, secrets, or production-copied dates.
 * The only production-like literal is the production project ref, used solely in
 * its DENY-ONLY rejection test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTION_PROJECT_REF_DENY,
  OFFERING_STATUSES,
  decideTargetSafety,
  parseBootstrapConfig,
  buildBootstrapPlan,
  planIsolatedInstanceBootstrap,
  classifyActivityYear,
  classifyCourseOffering,
  classifyCourseGroups,
  classifyCapabilities,
  classifyCourseSettingsSingleton,
  classifyActivityYearCardinality,
  classifyAggregateBootstrapState,
  type TargetMetadata,
  type OfferingStatus,
  type NormalizedBootstrapConfig,
  type BootstrapCreationPlan,
  type ObservedStructuralState,
  type ObservedCourseGroup,
} from "./bootstrap-isolated-instance.plan";

// --- synthetic fixtures ------------------------------------------------------

// Two obviously-fake 20-char refs (never a real/proposed project).
const REF_A = "aaaa1111bbbb2222cccc";
const REF_B = "zzzz9999yyyy8888xxxx";

function minimalConfigRaw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    activityYear: { name: "YEAR-FIXTURE" },
    offering: {
      name: "OFFERING-FIXTURE",
      level: 1,
      startDate: "2000-01-01",
      endDate: "2000-02-01",
      status: "PLANNED",
    },
    groups: [{ name: "TOP-1" }],
    capabilities: [
      { key: "CAP_SYNTH_A", label: "Synthetic A", isActive: true, offeringStatus: "ENABLED" },
    ],
    ...over,
  };
}

function parseOk(raw: unknown): NormalizedBootstrapConfig {
  const r = parseBootstrapConfig(raw);
  assert.equal(r.ok, true, "expected config to parse");
  if (!r.ok) throw new Error("unreachable");
  return r.config;
}

function hasCode(issues: readonly { code: string }[], code: string): boolean {
  return issues.some((i) => i.code === code);
}

// ===========================================================================
// 1. Valid minimal configuration
// ===========================================================================
test("1. valid minimal configuration parses and plans", () => {
  const cfg = parseOk(minimalConfigRaw());
  const plan = buildBootstrapPlan(cfg);
  assert.equal(plan.courseOffering.name, "OFFERING-FIXTURE");
  assert.equal(plan.courseGroups.length, 1);
  assert.equal(plan.offeringCapabilities.length, 1);
});

// ===========================================================================
// 2. Valid hierarchy with top-level and child groups
// ===========================================================================
test("2. valid hierarchy with top-level and child groups", () => {
  const cfg = parseOk(
    minimalConfigRaw({
      groups: [
        { name: "TOP-1", subgroups: [{ name: "1" }, { name: "2" }] },
        { name: "TOP-2", subgroups: [{ name: "1" }] },
      ],
    }),
  );
  const plan = buildBootstrapPlan(cfg);
  // 2 top-level + 3 subgroups = 5 groups.
  assert.equal(plan.courseGroups.length, 5);
  const tops = plan.courseGroups.filter((g) => g.parentGroupRef === null);
  assert.equal(tops.length, 2);
  const subs = plan.courseGroups.filter((g) => g.parentGroupRef !== null);
  assert.equal(subs.length, 3);
  // every subgroup's parentGroupRef resolves to a planned top-level group
  const topRefs = new Set(tops.map((t) => t.ref));
  for (const s of subs) assert.ok(topRefs.has(s.parentGroupRef as string));
});

// ===========================================================================
// 3. Duplicate top-level group rejection
// ===========================================================================
test("3. duplicate top-level group name is rejected", () => {
  const r = parseBootstrapConfig(minimalConfigRaw({ groups: [{ name: "DUP" }, { name: "DUP" }] }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(hasCode(r.issues, "group.duplicateTop"));
});

// ===========================================================================
// 4. Duplicate child group under the same parent rejection
// ===========================================================================
test("4. duplicate child name under the same parent is rejected", () => {
  const r = parseBootstrapConfig(
    minimalConfigRaw({ groups: [{ name: "TOP-1", subgroups: [{ name: "X" }, { name: "X" }] }] }),
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(hasCode(r.issues, "subgroup.duplicateUnderParent"));
});

// ===========================================================================
// 5. Same child name under DIFFERENT parents — ALLOWED
// Documented rule: schema @@unique([courseOfferingId, parentGroupId, name])
// scopes child uniqueness to the parent, so the same child name under two
// different parents is a legitimate, distinct group.
// ===========================================================================
test("5. same child name under different parents is allowed (documented rule)", () => {
  const r = parseBootstrapConfig(
    minimalConfigRaw({
      groups: [
        { name: "TOP-1", subgroups: [{ name: "1" }] },
        { name: "TOP-2", subgroups: [{ name: "1" }] },
      ],
    }),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    const plan = buildBootstrapPlan(r.config);
    const subsNamed1 = plan.courseGroups.filter((g) => g.parentGroupRef !== null && g.name === "1");
    assert.equal(subsNamed1.length, 2);
    assert.notEqual(subsNamed1[0].parentGroupRef, subsNamed1[1].parentGroupRef);
  }
});

// ===========================================================================
// 6. Invalid, missing or non-integer level
// ===========================================================================
test("6. invalid/missing/non-integer level is rejected", () => {
  for (const bad of [undefined, "1", 1.5, null, Number.NaN]) {
    const r = parseBootstrapConfig(minimalConfigRaw({ offering: { name: "O", level: bad, startDate: "2000-01-01", endDate: "2000-02-01", status: "PLANNED" } }));
    assert.equal(r.ok, false, `level ${String(bad)} should be rejected`);
    if (!r.ok) assert.ok(hasCode(r.issues, "level.notInteger"));
  }
});

// ===========================================================================
// 7. Missing offering status
// ===========================================================================
test("7. missing offering status is rejected (never defaulted)", () => {
  const r = parseBootstrapConfig(
    minimalConfigRaw({ offering: { name: "O", level: 1, startDate: "2000-01-01", endDate: "2000-02-01" } }),
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(hasCode(r.issues, "status.invalid"));
});

// ===========================================================================
// 8. Each allowed offering status
// ===========================================================================
test("8. each allowed offering status is accepted and preserved", () => {
  for (const status of OFFERING_STATUSES) {
    const cfg = parseOk(
      minimalConfigRaw({ offering: { name: "O", level: 2, startDate: "2000-01-01", endDate: "2000-02-01", status } }),
    );
    const plan = buildBootstrapPlan(cfg);
    assert.equal(plan.courseOffering.status, status);
  }
});

// ===========================================================================
// 9. Invalid or reversed dates
// ===========================================================================
test("9. invalid and reversed offering dates are rejected", () => {
  const malformed = parseBootstrapConfig(
    minimalConfigRaw({ offering: { name: "O", level: 1, startDate: "2000-13-01", endDate: "2000-02-01", status: "PLANNED" } }),
  );
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.ok(hasCode(malformed.issues, "date.required"));

  const reversed = parseBootstrapConfig(
    minimalConfigRaw({ offering: { name: "O", level: 1, startDate: "2000-03-01", endDate: "2000-02-01", status: "PLANNED" } }),
  );
  assert.equal(reversed.ok, false);
  if (!reversed.ok) assert.ok(hasCode(reversed.issues, "dates.reversed"));

  // A non-leap Feb 29 must be rejected as an invalid calendar date.
  const badCalendar = parseBootstrapConfig(
    minimalConfigRaw({ offering: { name: "O", level: 1, startDate: "2001-02-29", endDate: "2001-03-01", status: "PLANNED" } }),
  );
  assert.equal(badCalendar.ok, false);
});

// ===========================================================================
// 10. Optional ActivityYear date behavior (both-or-neither, ordering)
// ===========================================================================
test("10. ActivityYear dates are both-or-neither and ordered", () => {
  // both absent -> valid
  assert.equal(parseBootstrapConfig(minimalConfigRaw({ activityYear: { name: "Y" } })).ok, true);

  // both present, ordered -> valid, preserved
  const bothCfg = parseOk(minimalConfigRaw({ activityYear: { name: "Y", startDate: "2000-01-01", endDate: "2000-06-01" } }));
  assert.equal(bothCfg.activityYear.startDate, "2000-01-01");
  assert.equal(bothCfg.activityYear.endDate, "2000-06-01");

  // exactly one present -> rejected (conservative)
  const oneOnly = parseBootstrapConfig(minimalConfigRaw({ activityYear: { name: "Y", startDate: "2000-01-01" } }));
  assert.equal(oneOnly.ok, false);
  if (!oneOnly.ok) assert.ok(hasCode(oneOnly.issues, "dates.incomplete"));

  // both present but reversed -> rejected
  const rev = parseBootstrapConfig(minimalConfigRaw({ activityYear: { name: "Y", startDate: "2000-06-01", endDate: "2000-01-01" } }));
  assert.equal(rev.ok, false);
  if (!rev.ok) assert.ok(hasCode(rev.issues, "dates.reversed"));
});

// ===========================================================================
// 11. Capability missing explicit offering status
// ===========================================================================
test("11. capability missing offeringStatus is rejected", () => {
  const r = parseBootstrapConfig(
    minimalConfigRaw({ capabilities: [{ key: "K", label: "L", isActive: true }] }),
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(hasCode(r.issues, "offeringStatus.invalid"));
});

// ===========================================================================
// 12. Duplicate capability key
// ===========================================================================
test("12. duplicate capability key is rejected", () => {
  const r = parseBootstrapConfig(
    minimalConfigRaw({
      capabilities: [
        { key: "SAME", label: "A", isActive: true, offeringStatus: "ENABLED" },
        { key: "SAME", label: "B", isActive: false, offeringStatus: "READ_ONLY" },
      ],
    }),
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(hasCode(r.issues, "capability.duplicateKey"));
});

// ===========================================================================
// 13. Capability status ENABLED  &  14. READ_ONLY  — preserved explicitly
// ===========================================================================
test("13+14. capability offering statuses ENABLED and READ_ONLY are preserved", () => {
  const cfg = parseOk(
    minimalConfigRaw({
      capabilities: [
        { key: "CAP_EN", label: "en", isActive: true, offeringStatus: "ENABLED" },
        { key: "CAP_RO", label: "ro", isActive: true, offeringStatus: "READ_ONLY" },
      ],
    }),
  );
  const plan = buildBootstrapPlan(cfg);
  const byKey = new Map(plan.offeringCapabilities.map((o) => [o.capabilityKey, o.status]));
  assert.equal(byKey.get("CAP_EN"), "ENABLED");
  assert.equal(byKey.get("CAP_RO"), "READ_ONLY");
});

// ===========================================================================
// 15. No implicit ENABLED default (absence = not enabled)
// ===========================================================================
test("15. absence never becomes an implicit ENABLED; empty capabilities plan is empty", () => {
  const cfg = parseOk(minimalConfigRaw({ capabilities: [] }));
  const plan = buildBootstrapPlan(cfg);
  assert.equal(plan.capabilityCatalog.length, 0);
  assert.equal(plan.offeringCapabilities.length, 0);
  // and a capability with an explicit READ_ONLY never silently flips to ENABLED
  const cfg2 = parseOk(
    minimalConfigRaw({ capabilities: [{ key: "K", label: "L", isActive: true, offeringStatus: "READ_ONLY" }] }),
  );
  assert.equal(buildBootstrapPlan(cfg2).offeringCapabilities[0].status, "READ_ONLY");
});

// ===========================================================================
// 16. Expected/detected target-ref mismatch
// ===========================================================================
test("16. expected/detected ref mismatch is rejected", () => {
  const d = decideTargetSafety({ expectedProjectRef: REF_A, detectedProjectRef: REF_B });
  assert.equal(d.kind, "ref_mismatch");
});

// ===========================================================================
// 17. Rejection of the production ref (deny-only)
// ===========================================================================
test("17. production ref is unconditionally rejected on either side", () => {
  const asExpected = decideTargetSafety({ expectedProjectRef: PRODUCTION_PROJECT_REF_DENY, detectedProjectRef: REF_A });
  assert.equal(asExpected.kind, "production_ref_rejected");
  if (asExpected.kind === "production_ref_rejected") assert.equal(asExpected.which, "expected");

  const asDetected = decideTargetSafety({ expectedProjectRef: REF_A, detectedProjectRef: PRODUCTION_PROJECT_REF_DENY });
  assert.equal(asDetected.kind, "production_ref_rejected");
  if (asDetected.kind === "production_ref_rejected") assert.equal(asDetected.which, "detected");

  const both = decideTargetSafety({ expectedProjectRef: PRODUCTION_PROJECT_REF_DENY, detectedProjectRef: PRODUCTION_PROJECT_REF_DENY });
  assert.equal(both.kind, "production_ref_rejected");
  if (both.kind === "production_ref_rejected") assert.equal(both.which, "both");
});

// ===========================================================================
// 18. Synthetic non-production target accepted
// ===========================================================================
test("18. matching synthetic non-production target is allowed", () => {
  const d = decideTargetSafety({ expectedProjectRef: REF_A, detectedProjectRef: REF_A });
  assert.equal(d.kind, "allowed");
  if (d.kind === "allowed") assert.equal(d.projectRef, REF_A);

  // invalid metadata (empty / wrong shape) -> invalid_metadata, never allowed
  const bad = decideTargetSafety({ expectedProjectRef: "", detectedProjectRef: "short" });
  assert.equal(bad.kind, "invalid_metadata");
});

// ===========================================================================
// 19. CourseOffering absent / reuse / conflict
// ===========================================================================
test("19. CourseOffering absent, exact reuse, and conflict classifications", () => {
  const plan = buildBootstrapPlan(parseOk(minimalConfigRaw()));
  const po = plan.courseOffering;

  assert.equal(classifyCourseOffering(po, "YEAR-FIXTURE", []).class, "ABSENT");

  const exact = {
    name: po.name,
    level: po.level,
    startDate: po.startDate,
    endDate: po.endDate,
    status: po.status,
    activityYearName: "YEAR-FIXTURE",
  } as const;
  assert.equal(classifyCourseOffering(po, "YEAR-FIXTURE", [exact]).class, "EXACT_REUSE");

  const differingStatus = { ...exact, status: "ACTIVE" as OfferingStatus };
  assert.equal(classifyCourseOffering(po, "YEAR-FIXTURE", [differingStatus]).class, "CONFLICT");

  const differingYear = { ...exact, activityYearName: "OTHER-YEAR" };
  assert.equal(classifyCourseOffering(po, "YEAR-FIXTURE", [differingYear]).class, "CONFLICT");
});

// ---------------------------------------------------------------------------
// 19b. ActivityYear absent / exact reuse / conflict (G.1)
// ---------------------------------------------------------------------------
test("19b. ActivityYear absent, exact reuse, and conflict classifications", () => {
  const plan = buildBootstrapPlan(parseOk(minimalConfigRaw({ activityYear: { name: "Y", startDate: "2000-01-01", endDate: "2000-06-01" } })));
  const py = plan.activityYear;

  assert.equal(classifyActivityYear(py, null).class, "ABSENT");
  assert.equal(
    classifyActivityYear(py, { name: "Y", startDate: "2000-01-01", endDate: "2000-06-01" }).class,
    "EXACT_REUSE",
  );
  // same name, different dates -> conflict (never updated)
  assert.equal(
    classifyActivityYear(py, { name: "Y", startDate: "2000-01-01", endDate: "2000-07-07" }).class,
    "CONFLICT",
  );
  // unexpected different-named year -> conflict
  assert.equal(
    classifyActivityYear(py, { name: "OTHER", startDate: "2000-01-01", endDate: "2000-06-01" }).class,
    "CONFLICT",
  );
});

// ===========================================================================
// 20. More than one offering -> conflict
// ===========================================================================
test("20. more than one existing offering is a conflict", () => {
  const plan = buildBootstrapPlan(parseOk(minimalConfigRaw()));
  const po = plan.courseOffering;
  const one = {
    name: po.name, level: po.level, startDate: po.startDate, endDate: po.endDate, status: po.status, activityYearName: "YEAR-FIXTURE",
  } as const;
  const res = classifyCourseOffering(po, "YEAR-FIXTURE", [one, { ...one, name: "OTHER" }]);
  assert.equal(res.class, "CONFLICT");
  assert.ok(hasCode(res.issues, "offering.multiple"));
});

// ===========================================================================
// 21. Exact versus partial CourseGroup hierarchy
// ===========================================================================
test("21. CourseGroup hierarchy exact reuse vs partial/absent conflict", () => {
  const cfg = parseOk(minimalConfigRaw({ groups: [{ name: "TOP-1", subgroups: [{ name: "1" }, { name: "2" }] }] }));
  const plan = buildBootstrapPlan(cfg);

  assert.equal(classifyCourseGroups(plan.courseGroups, []).class, "ABSENT");

  const exact = [
    { name: "TOP-1", parentName: null },
    { name: "1", parentName: "TOP-1" },
    { name: "2", parentName: "TOP-1" },
  ];
  assert.equal(classifyCourseGroups(plan.courseGroups, exact).class, "EXACT_REUSE");

  // partial (missing one subgroup) -> CONFLICT, not auto-fill
  const partial = [
    { name: "TOP-1", parentName: null },
    { name: "1", parentName: "TOP-1" },
  ];
  assert.equal(classifyCourseGroups(plan.courseGroups, partial).class, "CONFLICT");

  // extra/unexpected group -> CONFLICT
  const extra = [...exact, { name: "GHOST", parentName: null }];
  assert.equal(classifyCourseGroups(plan.courseGroups, extra).class, "CONFLICT");
});

// ===========================================================================
// 22. Exact versus partial capability state
// ===========================================================================
test("22. capability state exact reuse vs partial/divergent conflict", () => {
  const cfg = parseOk(
    minimalConfigRaw({
      capabilities: [
        { key: "A", label: "la", isActive: true, offeringStatus: "ENABLED" },
        { key: "B", label: "lb", isActive: true, offeringStatus: "READ_ONLY" },
      ],
    }),
  );
  const plan = buildBootstrapPlan(cfg);

  assert.equal(classifyCapabilities(plan.capabilityCatalog, plan.offeringCapabilities, [], []).class, "ABSENT");

  const catExact = [
    { key: "A", label: "la", isActive: true },
    { key: "B", label: "lb", isActive: true },
  ];
  const ocExact = [
    { key: "A", status: "ENABLED" as const },
    { key: "B", status: "READ_ONLY" as const },
  ];
  assert.equal(classifyCapabilities(plan.capabilityCatalog, plan.offeringCapabilities, catExact, ocExact).class, "EXACT_REUSE");

  // partial catalog -> CONFLICT
  assert.equal(
    classifyCapabilities(plan.capabilityCatalog, plan.offeringCapabilities, [catExact[0]], ocExact).class,
    "CONFLICT",
  );

  // divergent offering status -> CONFLICT
  const ocDiverge = [
    { key: "A", status: "READ_ONLY" as const },
    { key: "B", status: "READ_ONLY" as const },
  ];
  assert.equal(
    classifyCapabilities(plan.capabilityCatalog, plan.offeringCapabilities, catExact, ocDiverge).class,
    "CONFLICT",
  );
});

// ===========================================================================
// 23. CourseSettings divergence -> conflict (generic classifier only)
// ===========================================================================
test("23. CourseSettings singleton divergence is classified as conflict, never updated", () => {
  const expected = { startDate: "2000-01-01" as const, endDate: "2000-02-01" as const };

  assert.equal(classifyCourseSettingsSingleton(expected, []).class, "ABSENT");
  assert.equal(
    classifyCourseSettingsSingleton(expected, [{ id: 1, startDate: "2000-01-01", endDate: "2000-02-01" }]).class,
    "EXACT_REUSE",
  );
  const diff = classifyCourseSettingsSingleton(expected, [{ id: 1, startDate: "2000-01-01", endDate: "2000-09-09" }]);
  assert.equal(diff.class, "CONFLICT");
  assert.ok(hasCode(diff.issues, "courseSettings.conflict"));

  const extraRows = classifyCourseSettingsSingleton(expected, [
    { id: 1, startDate: "2000-01-01", endDate: "2000-02-01" },
    { id: 2, startDate: "2000-01-01", endDate: "2000-02-01" },
  ]);
  assert.equal(extraRows.class, "CONFLICT");
});

// ===========================================================================
// 24. Deterministic identical plan output
// ===========================================================================
test("24. identical input yields deeply-equal plan output", () => {
  const cfg = parseOk(
    minimalConfigRaw({
      groups: [{ name: "TOP-1", subgroups: [{ name: "1" }] }, { name: "TOP-2" }],
      capabilities: [
        { key: "A", label: "la", isActive: true, offeringStatus: "ENABLED" },
        { key: "B", label: "lb", isActive: false, offeringStatus: "READ_ONLY" },
      ],
    }),
  );
  const p1 = buildBootstrapPlan(cfg);
  const p2 = buildBootstrapPlan(cfg);
  assert.deepEqual(p1, p2);

  // whole pipeline is deterministic too
  const raw = minimalConfigRaw();
  const target: TargetMetadata = { expectedProjectRef: REF_A, detectedProjectRef: REF_A };
  assert.deepEqual(planIsolatedInstanceBootstrap(raw, target), planIsolatedInstanceBootstrap(raw, target));
});

// ===========================================================================
// 25. Plan contains no excluded entity or personal/operational data
// ===========================================================================
test("25. plan JSON contains only structural spine + capability entities", () => {
  const result = planIsolatedInstanceBootstrap(minimalConfigRaw(), { expectedProjectRef: REF_A, detectedProjectRef: REF_A });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  const plan: BootstrapCreationPlan = result.plan;

  const allowedEntities = new Set([
    "ActivityYear",
    "CourseOffering",
    "CourseGroup",
    "CapabilityCatalog",
    "CourseOfferingCapability",
  ]);
  for (const step of plan.steps) assert.ok(allowedEntities.has(step.entity), `unexpected entity ${step.entity}`);

  const json = JSON.stringify(plan);
  for (const forbidden of [
    "CourseSettings",
    "DutyType",
    "AdminEmail",
    "Student",
    "Instructor",
    "Enrollment",
    "Membership",
    "email",
    "identityNumber",
    "phone",
    "password",
    "secret",
    "SESSION_SECRET",
    "DATABASE_URL",
  ]) {
    assert.equal(json.includes(forbidden), false, `plan must not contain "${forbidden}"`);
  }
});

// ===========================================================================
// 26. Plan contains explicit dependency order and logical references
// ===========================================================================
test("26. plan steps carry explicit order, logical refs, and satisfiable dependencies", () => {
  const cfg = parseOk(minimalConfigRaw({ groups: [{ name: "TOP-1", subgroups: [{ name: "1" }] }] }));
  const plan = buildBootstrapPlan(cfg);

  // orders are strictly increasing 0..n-1
  plan.steps.forEach((s, i) => assert.equal(s.order, i));

  // no generated DB ids: refs are logical tokens only
  for (const s of plan.steps) assert.match(s.ref, /^(activityYear|courseOffering|group:|catalog:|offeringCapability:)/);

  // every dependency appears in an EARLIER step (valid topological order)
  const seen = new Set<string>();
  for (const s of plan.steps) {
    for (const dep of s.dependsOn) assert.ok(seen.has(dep), `dependency ${dep} must precede ${s.ref}`);
    seen.add(s.ref);
  }

  // offering depends on the activity year; a subgroup depends on offering + its parent
  const offeringStep = plan.steps.find((s) => s.ref === "courseOffering");
  assert.deepEqual(offeringStep?.dependsOn, ["activityYear"]);
  const subStep = plan.steps.find((s) => s.entity === "CourseGroup" && s.ref.includes("/sub:"));
  assert.ok(subStep);
  assert.ok(subStep?.dependsOn.includes("courseOffering"));
  assert.ok(subStep?.dependsOn.some((d) => d.startsWith("group:")));
});

// ===========================================================================
// 27. Importing the production module causes no observable side effect
// ===========================================================================
test("27. module import is side-effect free (re-import is stable and does nothing)", async () => {
  // A second dynamic import must resolve to the identical module object (Node
  // caches modules); if importing had side effects they would run only once and
  // any global mutation would be observable. We assert the exported constant is
  // stable and the module object is referentially identical.
  const mod1 = await import("./bootstrap-isolated-instance.plan");
  const mod2 = await import("./bootstrap-isolated-instance.plan");
  assert.equal(mod1, mod2);
  assert.equal(mod1.PRODUCTION_PROJECT_REF_DENY, PRODUCTION_PROJECT_REF_DENY);
  // pure functions remain callable with no environment configured
  assert.equal(mod1.decideTargetSafety({ expectedProjectRef: REF_A, detectedProjectRef: REF_A }).kind, "allowed");
});

// ===========================================================================
// Aggregate whole-bootstrap safety decision (C/D/E) + regression tests (F/G)
// ===========================================================================

const EMPTY_OBSERVED: ObservedStructuralState = {
  activityYears: [],
  courseOfferings: [],
  courseGroups: [],
  capabilityCatalog: [],
  offeringCapabilities: [],
};

/** Build the exact observed state that mirrors a plan (for rerun/no-op tests). */
function exactObservedFor(plan: BootstrapCreationPlan): ObservedStructuralState {
  const nameByRef = new Map(plan.courseGroups.map((g) => [g.ref, g.name] as const));
  return {
    activityYears: [
      { name: plan.activityYear.name, startDate: plan.activityYear.startDate, endDate: plan.activityYear.endDate },
    ],
    courseOfferings: [
      {
        name: plan.courseOffering.name,
        level: plan.courseOffering.level,
        startDate: plan.courseOffering.startDate,
        endDate: plan.courseOffering.endDate,
        status: plan.courseOffering.status,
        activityYearName: plan.activityYear.name,
      },
    ],
    courseGroups: plan.courseGroups.map((g) => ({
      name: g.name,
      parentName: g.parentGroupRef === null ? null : (nameByRef.get(g.parentGroupRef) ?? null),
    })),
    capabilityCatalog: plan.capabilityCatalog.map((c) => ({ key: c.key, label: c.label, isActive: c.isActive })),
    offeringCapabilities: plan.offeringCapabilities.map((o) => ({ key: o.capabilityKey, status: o.status })),
  };
}

/** Recursively freeze so any attempted mutation throws under strict-mode ESM. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

function planWithHierarchy(): BootstrapCreationPlan {
  return buildBootstrapPlan(
    parseOk(
      minimalConfigRaw({
        groups: [{ name: "TOP-1", subgroups: [{ name: "1" }, { name: "2" }] }, { name: "TOP-2" }],
        capabilities: [
          { key: "A", label: "la", isActive: true, offeringStatus: "ENABLED" },
          { key: "B", label: "lb", isActive: true, offeringStatus: "READ_ONLY" },
        ],
      }),
    ),
  );
}

const OFFERING_OBSERVED_EXACT = {
  name: "OFFERING-FIXTURE",
  level: 1,
  startDate: "2000-01-01",
  endDate: "2000-02-01",
  status: "PLANNED" as OfferingStatus,
  activityYearName: "YEAR-FIXTURE",
} as const;

// --- F1 ---------------------------------------------------------------------
test("F1. all structural state absent -> INITIAL_APPLY_ALLOWED", () => {
  const plan = planWithHierarchy();
  assert.equal(classifyAggregateBootstrapState(plan, EMPTY_OBSERVED).kind, "INITIAL_APPLY_ALLOWED");
});

// --- F2 / F12 (shuffled) ----------------------------------------------------
test("F2+F12. all exact match -> EXACT_RERUN_NOOP, order-independent", () => {
  const plan = planWithHierarchy();
  assert.equal(classifyAggregateBootstrapState(plan, exactObservedFor(plan)).kind, "EXACT_RERUN_NOOP");

  // shuffled (reversed) observed group + capability rows still classify as no-op
  const exact = exactObservedFor(plan);
  const shuffled: ObservedStructuralState = {
    ...exact,
    courseGroups: [...exact.courseGroups].reverse(),
    capabilityCatalog: [...exact.capabilityCatalog].reverse(),
    offeringCapabilities: [...exact.offeringCapabilities].reverse(),
  };
  assert.equal(classifyAggregateBootstrapState(plan, shuffled).kind, "EXACT_RERUN_NOOP");
});

// --- F3 ---------------------------------------------------------------------
test("F3. ActivityYear exact but offering absent -> STOP_CONFLICT (mixed)", () => {
  const plan = planWithHierarchy();
  const observed: ObservedStructuralState = {
    ...EMPTY_OBSERVED,
    activityYears: [{ name: "YEAR-FIXTURE", startDate: null, endDate: null }],
  };
  const d = classifyAggregateBootstrapState(plan, observed);
  assert.equal(d.kind, "STOP_CONFLICT");
  if (d.kind === "STOP_CONFLICT") assert.equal(d.reason, "MIXED_ABSENT_AND_REUSE");
});

// --- F4 ---------------------------------------------------------------------
test("F4. offering exact but groups absent -> STOP_CONFLICT (mixed)", () => {
  const plan = planWithHierarchy();
  const observed: ObservedStructuralState = {
    ...EMPTY_OBSERVED,
    activityYears: [{ name: "YEAR-FIXTURE", startDate: null, endDate: null }],
    courseOfferings: [OFFERING_OBSERVED_EXACT],
  };
  const d = classifyAggregateBootstrapState(plan, observed);
  assert.equal(d.kind, "STOP_CONFLICT");
  if (d.kind === "STOP_CONFLICT") assert.equal(d.reason, "MIXED_ABSENT_AND_REUSE");
});

// --- F5 ---------------------------------------------------------------------
test("F5. groups exact but capabilities absent (mixed) or partial (conflict) -> STOP", () => {
  const plan = planWithHierarchy();
  const base = exactObservedFor(plan);

  // capabilities absent -> mixed
  const capsAbsent: ObservedStructuralState = { ...base, capabilityCatalog: [], offeringCapabilities: [] };
  const d1 = classifyAggregateBootstrapState(plan, capsAbsent);
  assert.equal(d1.kind, "STOP_CONFLICT");
  if (d1.kind === "STOP_CONFLICT") assert.equal(d1.reason, "MIXED_ABSENT_AND_REUSE");

  // capabilities partial (catalog missing one row) -> entity conflict
  const capsPartial: ObservedStructuralState = { ...base, capabilityCatalog: [base.capabilityCatalog[0]] };
  const d2 = classifyAggregateBootstrapState(plan, capsPartial);
  assert.equal(d2.kind, "STOP_CONFLICT");
  if (d2.kind === "STOP_CONFLICT") assert.equal(d2.reason, "ENTITY_CONFLICT");
});

// --- F6 ---------------------------------------------------------------------
test("F6. catalog exact but offering-capability rows absent -> STOP_CONFLICT (entity)", () => {
  const plan = planWithHierarchy();
  const base = exactObservedFor(plan);
  const observed: ObservedStructuralState = { ...base, offeringCapabilities: [] };
  const d = classifyAggregateBootstrapState(plan, observed);
  assert.equal(d.kind, "STOP_CONFLICT");
  if (d.kind === "STOP_CONFLICT") assert.equal(d.reason, "ENTITY_CONFLICT");
});

// --- F7 ---------------------------------------------------------------------
test("F7. any individual conflict -> STOP_CONFLICT (entity)", () => {
  const plan = planWithHierarchy();
  // a single differing offering (wrong status) while all else absent
  const observed: ObservedStructuralState = {
    ...EMPTY_OBSERVED,
    courseOfferings: [{ ...OFFERING_OBSERVED_EXACT, status: "ACTIVE" }],
  };
  const d = classifyAggregateBootstrapState(plan, observed);
  assert.equal(d.kind, "STOP_CONFLICT");
  if (d.kind === "STOP_CONFLICT") assert.equal(d.reason, "ENTITY_CONFLICT");
});

// --- F8 ---------------------------------------------------------------------
test("F8. more than one observed ActivityYear -> STOP_CONFLICT", () => {
  const plan = planWithHierarchy();
  const observed: ObservedStructuralState = {
    ...EMPTY_OBSERVED,
    activityYears: [
      { name: "YEAR-FIXTURE", startDate: null, endDate: null },
      { name: "YEAR-TWO", startDate: null, endDate: null },
    ],
  };
  const d = classifyAggregateBootstrapState(plan, observed);
  assert.equal(d.kind, "STOP_CONFLICT");
  if (d.kind === "STOP_CONFLICT") assert.equal(d.reason, "ENTITY_CONFLICT");
  // also assert the standalone cardinality classifier
  assert.equal(classifyActivityYearCardinality(plan.activityYear, observed.activityYears).class, "CONFLICT");
});

// --- F9 ---------------------------------------------------------------------
test("F9. more than one observed CourseOffering -> STOP_CONFLICT", () => {
  const plan = planWithHierarchy();
  const observed: ObservedStructuralState = {
    ...EMPTY_OBSERVED,
    courseOfferings: [OFFERING_OBSERVED_EXACT, { ...OFFERING_OBSERVED_EXACT, name: "SECOND" }],
  };
  const d = classifyAggregateBootstrapState(plan, observed);
  assert.equal(d.kind, "STOP_CONFLICT");
  if (d.kind === "STOP_CONFLICT") assert.equal(d.reason, "ENTITY_CONFLICT");
});

// --- F10 --------------------------------------------------------------------
test("F10. partial group hierarchy -> STOP_CONFLICT (entity)", () => {
  const plan = planWithHierarchy();
  const base = exactObservedFor(plan);
  // drop one subgroup from the observed groups
  const partialGroups: ObservedCourseGroup[] = base.courseGroups.filter((g) => !(g.parentName === "TOP-1" && g.name === "2"));
  const observed: ObservedStructuralState = { ...base, courseGroups: partialGroups };
  const d = classifyAggregateBootstrapState(plan, observed);
  assert.equal(d.kind, "STOP_CONFLICT");
  if (d.kind === "STOP_CONFLICT") assert.equal(d.reason, "ENTITY_CONFLICT");
});

// --- F11 --------------------------------------------------------------------
test("F11. unexpected extra group or capability row -> STOP_CONFLICT", () => {
  const plan = planWithHierarchy();
  const base = exactObservedFor(plan);

  const extraGroup: ObservedStructuralState = {
    ...base,
    courseGroups: [...base.courseGroups, { name: "GHOST", parentName: null }],
  };
  assert.equal(classifyAggregateBootstrapState(plan, extraGroup).kind, "STOP_CONFLICT");

  const extraCap: ObservedStructuralState = {
    ...base,
    offeringCapabilities: [...base.offeringCapabilities, { key: "GHOST", status: "ENABLED" }],
  };
  assert.equal(classifyAggregateBootstrapState(plan, extraCap).kind, "STOP_CONFLICT");
});

// --- F13 --------------------------------------------------------------------
test("F13. aggregate classifier does not mutate observed input", () => {
  const plan = planWithHierarchy();
  const observed = exactObservedFor(plan);
  const snapshot = JSON.parse(JSON.stringify(observed));
  deepFreeze(observed);
  // must not throw (no mutation attempt) and observed is byte-identical after
  assert.equal(classifyAggregateBootstrapState(plan, observed).kind, "EXACT_RERUN_NOOP");
  assert.deepEqual(JSON.parse(JSON.stringify(observed)), snapshot);
});

// --- F14 --------------------------------------------------------------------
test("F14. repeated aggregate calls with deeply-equal inputs return deeply-equal decisions", () => {
  const plan = planWithHierarchy();
  const observed = exactObservedFor(plan);
  assert.deepEqual(
    classifyAggregateBootstrapState(plan, observed),
    classifyAggregateBootstrapState(plan, observed),
  );
  assert.deepEqual(
    classifyAggregateBootstrapState(plan, EMPTY_OBSERVED),
    classifyAggregateBootstrapState(plan, EMPTY_OBSERVED),
  );
});

// --- F15 --------------------------------------------------------------------
test("F15. aggregate conflict diagnostics do not echo supplied values", () => {
  const plan = planWithHierarchy();

  // an entity conflict (wrong offering status) ...
  const entity = classifyAggregateBootstrapState(plan, {
    ...EMPTY_OBSERVED,
    courseOfferings: [{ ...OFFERING_OBSERVED_EXACT, status: "ACTIVE" }],
  });
  // ... and a mixed conflict
  const mixed = classifyAggregateBootstrapState(plan, {
    ...EMPTY_OBSERVED,
    activityYears: [{ name: "YEAR-FIXTURE", startDate: null, endDate: null }],
  });

  for (const d of [entity, mixed]) {
    assert.equal(d.kind, "STOP_CONFLICT");
    if (d.kind !== "STOP_CONFLICT") continue;
    const json = JSON.stringify(d.issues);
    for (const supplied of ["OFFERING-FIXTURE", "YEAR-FIXTURE", "TOP-1", "2000-01-01", "2000-02-01", REF_A]) {
      assert.equal(json.includes(supplied), false, `diagnostic must not echo "${supplied}"`);
    }
  }
});

// --- G. order-independence at the classifier level + parse/plan no-mutation --
test("G1. classifier-level exact matching is independent of observed row order", () => {
  const plan = planWithHierarchy();
  const exact = exactObservedFor(plan);

  // groups: reversed order still EXACT_REUSE
  assert.equal(classifyCourseGroups(plan.courseGroups, [...exact.courseGroups].reverse()).class, "EXACT_REUSE");
  // capabilities: reversed catalog + offering rows still EXACT_REUSE
  assert.equal(
    classifyCapabilities(
      plan.capabilityCatalog,
      plan.offeringCapabilities,
      [...exact.capabilityCatalog].reverse(),
      [...exact.offeringCapabilities].reverse(),
    ).class,
    "EXACT_REUSE",
  );
});

test("G2. parse + build do not mutate the caller-supplied raw config", () => {
  const raw = minimalConfigRaw({ groups: [{ name: "TOP-1", subgroups: [{ name: "1" }] }] });
  const snapshot = JSON.parse(JSON.stringify(raw));
  deepFreeze(raw);
  const parsed = parseBootstrapConfig(raw); // must not throw on frozen input
  assert.equal(parsed.ok, true);
  if (parsed.ok) buildBootstrapPlan(parsed.config);
  assert.deepEqual(JSON.parse(JSON.stringify(raw)), snapshot);
});
