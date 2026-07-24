/**
 * LEVEL 2 SLICE L2-DUAL: tests for the PURE trainee course-SELECTION core, plus
 * the DB-free orchestration seams (query shape, identity source, fail-closed
 * wiring) and the module-containment guarantee that no OTHER trainee module
 * became course-selectable.
 *
 * Run with: npx tsx --test lib/course/trainee-course-selection-core.test.ts
 * No Prisma, no DB, no clock, no randomness (all boundaries are injected).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildTraineeCourseOptions,
  composeTraineeCourseOptionLabel,
  eligibleTraineeOfferingsFromRows,
  selectTraineeCourseOfferingFromRows,
  resolveTraineeSelectedCourseOfferingWithDeps,
  listTraineeCourseOptionsWithDeps,
  buildTraineeCourseSelectionQuery,
  TRAINEE_COURSE_SELECTION_TAKE,
} from "./trainee-course-selection-core";
import {
  NoTraineeCourseOfferingError,
  AmbiguousTraineeCourseOfferingError,
  type TraineeEnrollmentOfferingRow,
  type TraineeEnrollmentQuery,
} from "./actor-course-offering-core";
import { IncompleteCourseOfferingError, type CourseOfferingRow } from "./current-offering-core";

const L1 = "cmrqngqhn00017gcndjixzrh0";
const L2 = "cmrxk58vc0000lscnfm54bpze";
const OUTSIDE = "cmoutsideoffering0000000x";

function offering(id: string, overrides: Partial<CourseOfferingRow> = {}): CourseOfferingRow {
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

function enrollment(
  overrides: Partial<TraineeEnrollmentOfferingRow> = {},
): TraineeEnrollmentOfferingRow {
  return {
    enrollmentId: "enr-1",
    enrollmentStatus: "ACTIVE",
    offering: offering(L1),
    ...overrides,
  };
}

/** The canonical dual-enrolled trainee: ACTIVE in both ACTIVE offerings. */
function dualEnrollmentRows(): TraineeEnrollmentOfferingRow[] {
  return [
    enrollment({ enrollmentId: "enr-l1", offering: offering(L1, { level: 1, name: "רמה א" }) }),
    enrollment({ enrollmentId: "enr-l2", offering: offering(L2, { level: 2, name: "רמה ב" }) }),
  ];
}

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/** The names a module imports from @/lib/course/actor-course-offering. */
function importedActorCourseOfferingSpecifiers(src: string): string[] {
  const names: string[] = [];
  // [^}] (not [\s\S]) so a match can never span from an EARLIER import statement
  // into this one - a specifier block contains no closing brace of its own.
  const pattern = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/course\/actor-course-offering["']/g;
  for (const match of src.matchAll(pattern)) {
    for (const specifier of match[1].split(",")) {
      const name = specifier.trim();
      if (name.length > 0) names.push(name);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// Options menu - derived ONLY from the trainee's own eligible enrollments
// ---------------------------------------------------------------------------

test("one authorized enrollment yields exactly one option", () => {
  const options = buildTraineeCourseOptions([enrollment()]);
  assert.equal(options.length, 1);
  assert.equal(options[0].id, L1);
});

test("two authorized enrollments return BOTH options", () => {
  const options = buildTraineeCourseOptions(dualEnrollmentRows());
  assert.deepEqual(
    options.map((o) => o.id),
    [L1, L2],
  );
});

test("options are ordered deterministically by level then id, regardless of row order", () => {
  const forward = buildTraineeCourseOptions(dualEnrollmentRows());
  const reversed = buildTraineeCourseOptions([...dualEnrollmentRows()].reverse());
  assert.deepEqual(
    forward.map((o) => o.id),
    reversed.map((o) => o.id),
  );
});

test("options carry a server-composed label and never leak dates or status", () => {
  const options = buildTraineeCourseOptions([
    enrollment({ offering: offering(L2, { level: 2, name: "רמה ב" }) }),
  ]);
  assert.deepEqual(options, [{ id: L2, label: "רמה 2 · רמה ב", level: 2 }]);
});

test("a blank offering name degrades to the level alone, never a dangling separator", () => {
  assert.equal(composeTraineeCourseOptionLabel(2, "   "), "רמה 2");
  assert.equal(composeTraineeCourseOptionLabel(1, "קורס"), "רמה 1 · קורס");
});

test("options EXCLUDE inactive enrollments, PLANNED offerings and inactive offerings", () => {
  const options = buildTraineeCourseOptions([
    enrollment({ enrollmentId: "a", enrollmentStatus: "INACTIVE", offering: offering(L1) }),
    enrollment({ enrollmentId: "b", offering: offering(L2, { status: "PLANNED" }) }),
    enrollment({ enrollmentId: "c", offering: offering(OUTSIDE, { status: "ARCHIVED" }) }),
  ]);
  assert.deepEqual(options, []);
});

test("two ACTIVE enrollments into ONE offering collapse to a single option", () => {
  const options = buildTraineeCourseOptions([
    enrollment({ enrollmentId: "a", offering: offering(L1) }),
    enrollment({ enrollmentId: "b", offering: offering(L1) }),
  ]);
  assert.equal(options.length, 1);
});

test("the options menu and the selection decision share ONE eligibility definition", () => {
  // Any row the menu offers must also be selectable, and vice versa - the two
  // must never drift apart into "shown but denied" or "hidden but reachable".
  const rows = [
    enrollment({ enrollmentId: "a", offering: offering(L1) }),
    enrollment({ enrollmentId: "b", enrollmentStatus: "INACTIVE", offering: offering(L2) }),
  ];
  const eligibleIds = eligibleTraineeOfferingsFromRows(rows).map((o) => o.id);
  assert.deepEqual(
    buildTraineeCourseOptions(rows).map((o) => o.id),
    eligibleIds,
  );
  for (const id of eligibleIds) {
    assert.equal(selectTraineeCourseOfferingFromRows("stu-1", id, rows).id, id);
  }
});

// ---------------------------------------------------------------------------
// Single-course trainee - the unchanged path
// ---------------------------------------------------------------------------

test("single course, id OMITTED: resolves automatically (unchanged behaviour)", () => {
  assert.equal(selectTraineeCourseOfferingFromRows("stu-1", undefined, [enrollment()]).id, L1);
  assert.equal(selectTraineeCourseOfferingFromRows("stu-1", null, [enrollment()]).id, L1);
});

test("single course, own id REQUESTED: resolves to that same course", () => {
  assert.equal(selectTraineeCourseOfferingFromRows("stu-1", L1, [enrollment()]).id, L1);
});

test("single course: a request for someone ELSE's course is denied, not downgraded", () => {
  // The dangerous failure mode would be "unknown id -> ignore it -> fall back to
  // the trainee's own single course". It must deny instead.
  assert.throws(
    () => selectTraineeCourseOfferingFromRows("stu-1", L2, [enrollment()]),
    NoTraineeCourseOfferingError,
  );
});

test("single course: the returned view keeps the full committed shape", () => {
  const result = selectTraineeCourseOfferingFromRows("stu-1", undefined, [enrollment()]);
  assert.deepEqual(Object.keys(result).sort(), [
    "activityYearId",
    "endDate",
    "id",
    "level",
    "name",
    "startDate",
    "status",
  ]);
});

test("a dateless offering still fails loudly rather than inventing dates", () => {
  assert.throws(
    () =>
      selectTraineeCourseOfferingFromRows("stu-1", undefined, [
        enrollment({ offering: offering(L1, { startDate: null }) }),
      ]),
    IncompleteCourseOfferingError,
  );
});

// ---------------------------------------------------------------------------
// Dual-enrolled trainee - explicit selection, both directions
// ---------------------------------------------------------------------------

test("dual enrollment: requesting Level 1 resolves to Level 1", () => {
  assert.equal(selectTraineeCourseOfferingFromRows("stu-1", L1, dualEnrollmentRows()).id, L1);
});

test("dual enrollment: requesting Level 2 resolves to Level 2", () => {
  assert.equal(selectTraineeCourseOfferingFromRows("stu-1", L2, dualEnrollmentRows()).id, L2);
});

test("dual enrollment with NO id stated fails closed - the server never picks", () => {
  assert.throws(
    () => selectTraineeCourseOfferingFromRows("stu-1", undefined, dualEnrollmentRows()),
    AmbiguousTraineeCourseOfferingError,
  );
});

test("dual enrollment: NO first-row / lowest-level / isPrimary fallback exists", () => {
  // Reversed input order must not change the (thrown) outcome either.
  assert.throws(
    () => selectTraineeCourseOfferingFromRows("stu-1", undefined, dualEnrollmentRows().reverse()),
    AmbiguousTraineeCourseOfferingError,
  );
});

// ---------------------------------------------------------------------------
// Denials - every reason is the SAME error, so none is distinguishable
// ---------------------------------------------------------------------------

test("an offering OUTSIDE the trainee's enrollments is denied", () => {
  assert.throws(
    () => selectTraineeCourseOfferingFromRows("stu-1", OUTSIDE, dualEnrollmentRows()),
    NoTraineeCourseOfferingError,
  );
});

test("an INACTIVE enrollment into an ACTIVE offering is denied", () => {
  assert.throws(
    () =>
      selectTraineeCourseOfferingFromRows("stu-1", L2, [
        enrollment({ enrollmentStatus: "INACTIVE", offering: offering(L2) }),
      ]),
    NoTraineeCourseOfferingError,
  );
});

test("an ACTIVE enrollment into a PLANNED offering is denied", () => {
  assert.throws(
    () =>
      selectTraineeCourseOfferingFromRows("stu-1", L2, [
        enrollment({ offering: offering(L2, { status: "PLANNED" }) }),
      ]),
    NoTraineeCourseOfferingError,
  );
});

test("an ACTIVE enrollment into an ARCHIVED offering is denied", () => {
  for (const status of ["ARCHIVED"] as const) {
    assert.throws(
      () =>
        selectTraineeCourseOfferingFromRows("stu-1", L2, [
          enrollment({ offering: offering(L2, { status }) }),
        ]),
      NoTraineeCourseOfferingError,
    );
  }
});

test("malformed requested ids are denied, never treated as 'not stated'", () => {
  for (const malformed of ["", "   ", `${L1} `, L1.toUpperCase(), L1.slice(0, -1)]) {
    assert.throws(
      () => selectTraineeCourseOfferingFromRows("stu-1", malformed, [enrollment()]),
      NoTraineeCourseOfferingError,
      `"${malformed}" must not resolve`,
    );
  }
});

test("a non-string requested value is denied (no coercion, no prefix match)", () => {
  for (const value of [123, {}, [], { id: L1 }, [L1]] as unknown[]) {
    assert.throws(
      () =>
        selectTraineeCourseOfferingFromRows(
          "stu-1",
          value as unknown as string,
          dualEnrollmentRows(),
        ),
      NoTraineeCourseOfferingError,
    );
  }
});

test("a trainee with NO eligible enrollment is denied whatever they request", () => {
  for (const requested of [undefined, null, L1, L2, OUTSIDE]) {
    assert.throws(
      () => selectTraineeCourseOfferingFromRows("stu-1", requested, []),
      NoTraineeCourseOfferingError,
    );
  }
});

test("every denial reuses the two EXISTING error types the consumers already translate", () => {
  // This is what keeps the uniform empty result intact without touching any
  // consumer's denial predicate. A NEW error class here would propagate as a
  // server fault and become a distinguishable outcome.
  const denials: unknown[] = [];
  for (const [requested, rows] of [
    [OUTSIDE, dualEnrollmentRows()],
    [undefined, dualEnrollmentRows()],
    ["", [enrollment()]],
    [L1, []],
  ] as const) {
    try {
      selectTraineeCourseOfferingFromRows("stu-1", requested, rows);
      assert.fail("expected a denial");
    } catch (error) {
      denials.push(error);
    }
  }
  for (const error of denials) {
    assert.ok(
      error instanceof NoTraineeCourseOfferingError ||
        error instanceof AmbiguousTraineeCourseOfferingError,
      `unexpected error type: ${String(error)}`,
    );
  }
});

test("a denial never names the requested offering (no probing oracle)", () => {
  try {
    selectTraineeCourseOfferingFromRows("stu-1", OUTSIDE, dualEnrollmentRows());
    assert.fail("expected a denial");
  } catch (error) {
    assert.ok(!(error as Error).message.includes(OUTSIDE));
  }
});

// ---------------------------------------------------------------------------
// The requested id is never authority: identity, query shape, returned value
// ---------------------------------------------------------------------------

test("identity comes from the session dep - a client studentId cannot be passed", () => {
  // The orchestration takes exactly (requestedId, deps). There is no student-id
  // parameter at all, so there is nothing for a client value to occupy.
  assert.equal(resolveTraineeSelectedCourseOfferingWithDeps.length, 2);
  assert.equal(listTraineeCourseOptionsWithDeps.length, 1);
});

test("the query is scoped to the SESSION trainee and never carries the requested id", async () => {
  let captured: TraineeEnrollmentQuery | null = null;
  const result = await resolveTraineeSelectedCourseOfferingWithDeps(L2, {
    requireTraineeId: async () => "session-student",
    fetchTraineeEnrollmentRows: async (query) => {
      captured = query;
      return dualEnrollmentRows();
    },
  });

  const query = captured as unknown as TraineeEnrollmentQuery;
  assert.equal(query.where.studentId, "session-student");
  assert.equal(query.where.status, "ACTIVE");
  assert.deepEqual(query.where.courseOffering, { status: "ACTIVE" });
  assert.equal(query.take, TRAINEE_COURSE_SELECTION_TAKE);
  // The requested id must appear NOWHERE in the query - it is a predicate applied
  // to already-trainee-scoped rows, never a lookup key.
  assert.ok(!JSON.stringify(query).includes(L2));
  assert.equal(result.id, L2);
});

test("the resolved id is the matched ROW's, not the caller's string", async () => {
  // The fetcher returns a row whose id is a DIFFERENT string instance than the
  // requested one; the result must be the row's own value, carrying the row's
  // server-side name/level/dates rather than anything the caller supplied.
  const requested = [L2.slice(0, 10), L2.slice(10)].join("");
  const result = await resolveTraineeSelectedCourseOfferingWithDeps(requested, {
    requireTraineeId: async () => "session-student",
    fetchTraineeEnrollmentRows: async () => dualEnrollmentRows(),
  });
  assert.equal(result.id, L2);
  assert.equal(result.name, "רמה ב");
  assert.equal(result.level, 2);
  assert.equal(result.status, "ACTIVE");
});

test("the session guard runs BEFORE any enrollment is fetched", async () => {
  const order: string[] = [];
  await assert.rejects(
    resolveTraineeSelectedCourseOfferingWithDeps(L1, {
      requireTraineeId: async () => {
        order.push("session");
        throw new Error("no trainee session");
      },
      fetchTraineeEnrollmentRows: async () => {
        order.push("fetch");
        return [];
      },
    }),
  );
  assert.deepEqual(order, ["session"], "an anonymous caller must never reach the database");
});

test("the options menu also requires a session first and never leaks course names", async () => {
  const order: string[] = [];
  await assert.rejects(
    listTraineeCourseOptionsWithDeps({
      requireTraineeId: async () => {
        order.push("session");
        throw new Error("no trainee session");
      },
      fetchTraineeEnrollmentRows: async () => {
        order.push("fetch");
        return dualEnrollmentRows();
      },
    }),
  );
  assert.deepEqual(order, ["session"]);
});

test("the options menu returns only the SESSION trainee's own courses", async () => {
  let captured: TraineeEnrollmentQuery | null = null;
  const options = await listTraineeCourseOptionsWithDeps({
    requireTraineeId: async () => "session-student",
    fetchTraineeEnrollmentRows: async (query) => {
      captured = query;
      return dualEnrollmentRows();
    },
  });
  assert.equal((captured as unknown as TraineeEnrollmentQuery).where.studentId, "session-student");
  assert.deepEqual(
    options.map((o) => o.id),
    [L1, L2],
  );
});

test("the selection query shape is identical to the committed single-course filter", () => {
  const query = buildTraineeCourseSelectionQuery("stu-1");
  assert.deepEqual(query.where, {
    studentId: "stu-1",
    status: "ACTIVE",
    courseOffering: { status: "ACTIVE" },
  });
});

// ---------------------------------------------------------------------------
// No inference of any kind
// ---------------------------------------------------------------------------

test("no Level 1 constant, cookie, date, level or name inference exists in the core", () => {
  const src = readSource("./trainee-course-selection-core.ts");
  const body = src.slice(src.indexOf("import {"));
  for (const forbidden of [
    "LEVEL_1_COURSE_OFFERING_ID",
    "LEVEL_2_COURSE_OFFERING_ID",
    "temporary-level2-compatibility",
    "courseSettings",
    "cookies",
    "isPrimary",
    "prisma",
    "Date.now",
  ]) {
    assert.ok(!body.includes(forbidden), `the pure core must not reference "${forbidden}"`);
  }
  // The legacy SINGLETON current-offering resolver specifically. The shared pure
  // cardinality mapper resolveCurrentCourseOfferingFromRows is a different thing
  // and is deliberately reused, which is why this excludes that exact suffix.
  assert.ok(
    !/resolveCurrentCourseOffering\b(?!FromRows)/.test(body),
    "the pure core must not use the legacy singleton current-offering resolver",
  );
});

test("selection is by id equality only - level/name/date never break a tie", () => {
  // Two offerings that are IDENTICAL apart from their ids: nothing but the id can
  // possibly distinguish them, so a level/name/date-based shortcut would fail here.
  const twins = [
    enrollment({ enrollmentId: "a", offering: offering(L1, { level: 7, name: "same" }) }),
    enrollment({ enrollmentId: "b", offering: offering(L2, { level: 7, name: "same" }) }),
  ];
  assert.equal(selectTraineeCourseOfferingFromRows("stu-1", L1, twins).id, L1);
  assert.equal(selectTraineeCourseOfferingFromRows("stu-1", L2, twins).id, L2);
});

// ---------------------------------------------------------------------------
// Containment: no OTHER trainee module became course-selectable
// ---------------------------------------------------------------------------

test("ONLY the schedule and contacts actions bind the selection resolver", () => {
  const selectable: string[] = [];
  const single: string[] = [];
  for (const relative of [
    "../actions/student-schedule.ts",
    "../actions/weekly-schedule.ts",
    "../actions/contacts.ts",
    "../actions/messages.ts",
    "../actions/materials.ts",
    "../actions/weekly-feedback.ts",
    "../actions/teaching-practice-student.ts",
    "../actions/completion.ts",
  ]) {
    // What each module IMPORTS, not what it happens to mention: the dependency
    // PROPERTY is also called `resolveTraineeCourseOffering`, so a plain substring
    // search cannot tell "uses the single-course resolver" from "satisfies the
    // unchanged zero-argument dependency with a bound closure".
    const specifiers = importedActorCourseOfferingSpecifiers(readSource(relative));
    if (specifiers.includes("resolveTraineeSelectedCourseOffering")) selectable.push(relative);
    if (specifiers.includes("resolveTraineeCourseOffering")) single.push(relative);
  }

  assert.deepEqual(
    selectable.sort(),
    ["../actions/contacts.ts", "../actions/student-schedule.ts", "../actions/weekly-schedule.ts"],
    "no other trainee module may accept a requested course",
  );
  // Duties live in student-schedule.ts and keep the committed no-argument
  // resolver, which is why that file legitimately imports BOTH.
  assert.deepEqual(
    single.sort(),
    [
      "../actions/completion.ts",
      "../actions/materials.ts",
      "../actions/messages.ts",
      "../actions/student-schedule.ts",
      "../actions/teaching-practice-student.ts",
      "../actions/weekly-feedback.ts",
    ],
    "every other trainee module must keep the single-course resolver",
  );
});

test("the committed single-course resolver refuses to choose UNLESS the pair is injected", async () => {
  // SUPERSEDED IN PART: when this was written the resolver every OTHER trainee
  // module uses closed those modules for a dual-enrolled trainee. It now takes an
  // OPTIONAL injected dual-enrollment compatibility, and the real binding in
  // actor-course-offering.ts supplies it, so in PRODUCTION the exact launch pair
  // {Level 1, Level 2} resolves to that trainee's own Level 1 row - deliberately,
  // to keep the Level 1 modules alive. See actor-course-offering-core.ts.
  //
  // What this assertion still proves, and why it is unchanged: the relaxation is
  // strictly OPT-IN. With no compatibility injected - as here - the resolver is
  // byte-identical to its pre-exception self and still refuses to choose. That
  // fail-closed default is what makes every OTHER ambiguous state (an unknown
  // pair, a third offering, duplicates) safe, and it is exercised against the
  // real constants in actor-course-offering-core.test.ts.
  const { resolveTraineeCourseOfferingWithDeps } = await import("./actor-course-offering-core");
  await assert.rejects(
    resolveTraineeCourseOfferingWithDeps({
      requireTraineeId: async () => "stu-1",
      fetchTraineeEnrollmentRows: async () => dualEnrollmentRows(),
    }),
    AmbiguousTraineeCourseOfferingError,
  );
});

test("the shared consumer cores were NOT modified to carry a course id", () => {
  // The three consumers inject a zero-argument closure, so these cores keep the
  // gate ordering that already shipped and cannot receive a client value.
  for (const relative of [
    "./course-scoped-week-options-core.ts",
    "../actions/contacts-instructor-directory.ts",
    "./trainee-module-containment-core.ts",
  ]) {
    const src = readSource(relative);
    assert.match(
      src,
      /resolveTraineeCourseOffering:\s*\(\)\s*=>\s*Promise<\{\s*id:\s*string\s*\}>/,
      `${relative} must keep the zero-argument resolver dependency`,
    );
    assert.ok(
      !src.includes("resolveTraineeSelectedCourseOffering"),
      `${relative} must not know about the selection resolver`,
    );
  }
});

// ---------------------------------------------------------------------------
// Client selection is UX, never authority
// ---------------------------------------------------------------------------

test("the trainee client never persists the selection", () => {
  const src = readSource("../../app/student/StudentClient.tsx");
  const selectionState = src.slice(
    src.indexOf("const [selectedCourseOfferingId"),
    src.indexOf("const [weeks,"),
  );
  assert.ok(selectionState.length > 0, "expected the selection state declaration");
  for (const forbidden of ["localStorage", "sessionStorage", "document.cookie"]) {
    assert.ok(!selectionState.includes(forbidden));
  }
  // The one storage key this client owns is the login session, unrelated to course
  // selection - assert the selected id is never written under it.
  assert.ok(!src.includes("setItem(STORAGE_KEY, JSON.stringify(selectedCourseOfferingId)"));
});

test("the selector renders nothing for a single-course trainee", () => {
  const src = readSource("../../app/student/TraineeCourseSelector.tsx");
  assert.match(src, /if \(options\.length <= 1\) return null;/);
});

test("the course selector is mounted ONLY on the schedule and contacts screens", () => {
  const src = readSource("../../app/student/StudentClient.tsx");
  const mounts = src.match(/<TraineeCourseSelector/g) ?? [];
  assert.equal(mounts.length, 2, "exactly two mount sites are approved");
  // Each mount must sit inside one of the two approved tab branches.
  for (const tab of ['activeTab === "schedule"', 'activeTab === "contacts"']) {
    const tabStart = src.indexOf(tab);
    assert.notEqual(tabStart, -1);
    assert.ok(
      src.slice(tabStart, tabStart + 700).includes("<TraineeCourseSelector"),
      `the selector must be mounted inside ${tab}`,
    );
  }
});

// ---------------------------------------------------------------------------
// The "use server" action wrapper re-exports TraineeCourseOptionView as a
// COMPILE-TIME type only. Regression guard for the /student runtime crash
// `ReferenceError: TraineeCourseOptionView is not defined`.
//
// Root cause: inside a "use server" file, Turbopack's server-action transform
// treated a BARE local type re-export `export type { TraineeCourseOptionView };`
// (of an `import type` binding) as a runtime server-action export, emitting
// `ensureServerEntryExports([..., TraineeCourseOptionView])` and
// `registerServerReference(TraineeCourseOptionView, ...)` against an identifier
// that only ever existed as a type -> the trainee action module threw at
// evaluation and every /student action module failed to load. The `from`-clause
// re-export form is erased at build time and does not regress.
// ---------------------------------------------------------------------------

test("the trainee action re-exports the option view type WITH a from-clause, never bare", () => {
  const src = readSource("../actions/trainee-course-selection.ts");

  // Inspect CODE only - the source deliberately mentions the crashing construct in
  // a warning comment, and this guard must not trip on its own documentation.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  // The exact crashing construct: a brace re-export that terminates in `;` with no
  // intervening `from`. `export type Foo = ...;` (no braces) is unaffected, and the
  // safe `export type { X } from "..."` form ends in `from "..."`, not `};`.
  const bareBraceReExport = /export\s+type\s*\{[^}]*\}\s*;/;
  assert.ok(
    !bareBraceReExport.test(code),
    "a bare `export type { ... };` in a \"use server\" file is mis-emitted by " +
      "Turbopack as a runtime server reference and crashes /student at module eval",
  );

  // ...and the option view type is still exported (so the trainee client keeps
  // importing it from the action module unchanged), via the erased from-clause form.
  assert.match(
    src,
    /export\s+type\s*\{\s*TraineeCourseOptionView\s*\}\s*from\s*["']@\/lib\/course\/trainee-course-selection-core["']/,
    "TraineeCourseOptionView must be re-exported with an erased `from`-clause re-export",
  );
});

test("the trainee action wrapper is unchanged: delegates and swallows ONLY the two typed course errors", () => {
  const src = readSource("../actions/trainee-course-selection.ts");

  // Behavior preservation (shape + fail-closed): still the thin delegate to the
  // internal reader, returning [] for exactly the two trainee course-context errors
  // and re-throwing everything else (a session fault is never laundered into "[]").
  assert.match(
    src,
    /return\s+await\s+listTraineeCourseOptionsInternal\(\)/,
    "must still delegate to the internal course-options reader",
  );
  assert.match(src, /instanceof\s+NoTraineeCourseOfferingError/);
  assert.match(src, /instanceof\s+AmbiguousTraineeCourseOfferingError/);
  assert.match(src, /throw\s+error;/, "any other error must still propagate");
});
