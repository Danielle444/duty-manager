/**
 * SECURITY / LEVEL 2 SLICE L2-F1A: DB-free tests for the trainee weekly-feedback
 * containment core.
 *
 * These exercise the whole authorization contract with fakes: the actor step,
 * the offering step, the exact query shapes (so ownership provably lives inside
 * the where clause rather than in a post-fetch filter), the strict non-null
 * ownership predicate, the window classification, and - most importantly - the
 * ORDER, by asserting that the form/response fakes were never called when a gate
 * denied.
 *
 * Run with: npx tsx --test lib/course/weekly-feedback-course-scope-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  NoTraineeCourseOfferingError,
  AmbiguousTraineeCourseOfferingError,
} from "./actor-course-offering-core";
import { UnauthenticatedActorError } from "@/lib/auth/actor-types";
import {
  acceptWeeklyFeedbackFormOfferingId,
  authorizeTraineeWeeklyFeedbackSubmissionWithDeps,
  buildTraineeWeeklyFeedbackFormQuery,
  buildTraineeWeeklyFeedbackSubmissionFormQuery,
  buildWeeklyFeedbackRosterCountQuery,
  buildWeeklyFeedbackRosterQuery,
  classifyWeeklyFeedbackSubmissionWindow,
  collectWeeklyFeedbackOfferingIds,
  countWeeklyFeedbackRosterByOffering,
  emptyWeeklyFeedbackForStudent,
  isTraineeCourseContextDenial,
  isWeeklyFeedbackFormCurrentlyOpen,
  isWeeklyFeedbackFormOwnedByOffering,
  loadTraineeWeeklyFeedbackWithDeps,
  selectNotSubmittedRosterMembers,
  selectSubmittedRosterMembers,
  summarizeWeeklyFeedbackDenominator,
  toWeeklyFeedbackRosterMembers,
  weeklyFeedbackDenominatorForForm,
  type TraineeWeeklyFeedbackFormQuery,
  type TraineeWeeklyFeedbackFormRow,
  type TraineeWeeklyFeedbackSubmissionFormQuery,
} from "./weekly-feedback-course-scope-core";

const L1 = "cmrqngqhn00017gcndjixzrh0";
const L2 = "cmrxk58vc0000lscnfm54bpze";
const TRAINEE = "student-session-derived";
const IMPOSTER = "student-supplied-by-client";
const NOW = new Date("2026-07-24T12:00:00.000Z");

function formRow(overrides: Partial<TraineeWeeklyFeedbackFormRow> = {}): TraineeWeeklyFeedbackFormRow {
  return {
    id: "form-1",
    title: "משוב סוף שבוע - שבוע א",
    status: "PUBLISHED",
    opensAt: null,
    closesAt: null,
    weeklySchedule: { courseOfferingId: L1 },
    ...overrides,
  };
}

/** A read-deps builder that records every call, so ORDER can be asserted. */
function readDeps(options: {
  requireTraineeId?: () => Promise<string>;
  resolveOffering?: () => Promise<{ id: string }>;
  form?: TraineeWeeklyFeedbackFormRow | null;
  response?: { submittedAt: Date } | null;
  now?: Date;
}) {
  const calls = {
    formQueries: [] as TraineeWeeklyFeedbackFormQuery[],
    responseArgs: [] as { formId: string; traineeId: string }[],
  };
  const deps = {
    requireTraineeId: options.requireTraineeId ?? (async () => TRAINEE),
    resolveTraineeCourseOffering: options.resolveOffering ?? (async () => ({ id: L1 })),
    fetchOwnedForm: async (query: TraineeWeeklyFeedbackFormQuery) => {
      calls.formQueries.push(query);
      return options.form === undefined ? formRow() : options.form;
    },
    fetchResponse: async (args: { formId: string; traineeId: string }) => {
      calls.responseArgs.push(args);
      return options.response ?? null;
    },
    now: () => options.now ?? NOW,
  };
  return { deps, calls };
}

/** A submission-deps builder that records every call. */
function submitDeps(options: {
  requireTraineeId?: () => Promise<string>;
  resolveOffering?: () => Promise<{ id: string }>;
  form?: TraineeWeeklyFeedbackFormRow | null;
}) {
  const calls = { formQueries: [] as TraineeWeeklyFeedbackSubmissionFormQuery[] };
  const deps = {
    requireTraineeId: options.requireTraineeId ?? (async () => TRAINEE),
    resolveTraineeCourseOffering: options.resolveOffering ?? (async () => ({ id: L1 })),
    fetchOwnedFormById: async (query: TraineeWeeklyFeedbackSubmissionFormQuery) => {
      calls.formQueries.push(query);
      return options.form === undefined ? formRow() : options.form;
    },
  };
  return { deps, calls };
}

// ---------------------------------------------------------------------------
// Denial classification
// ---------------------------------------------------------------------------

test("only the three course-context failures are denials", () => {
  assert.equal(isTraineeCourseContextDenial(new UnauthenticatedActorError()), true);
  assert.equal(isTraineeCourseContextDenial(new NoTraineeCourseOfferingError(TRAINEE)), true);
  assert.equal(
    isTraineeCourseContextDenial(new AmbiguousTraineeCourseOfferingError(TRAINEE, [L1, L2])),
    true,
  );

  assert.equal(isTraineeCourseContextDenial(new Error("connection reset")), false);
  assert.equal(isTraineeCourseContextDenial(new TypeError("undefined is not a function")), false);
  assert.equal(isTraineeCourseContextDenial(null), false);
  assert.equal(isTraineeCourseContextDenial("NoTraineeCourseOfferingError"), false);
});

// ---------------------------------------------------------------------------
// Ownership predicate
// ---------------------------------------------------------------------------

test("ownership is strict, non-null equality with no normalization", () => {
  assert.equal(isWeeklyFeedbackFormOwnedByOffering(L1, L1), true);

  // NULL-scoped legacy week fails closed - no pass-through, no Level 1 default.
  assert.equal(isWeeklyFeedbackFormOwnedByOffering(null, L1), false);
  assert.equal(isWeeklyFeedbackFormOwnedByOffering(undefined, L1), false);
  assert.equal(isWeeklyFeedbackFormOwnedByOffering("", L1), false);

  // Another course never matches.
  assert.equal(isWeeklyFeedbackFormOwnedByOffering(L2, L1), false);
  assert.equal(isWeeklyFeedbackFormOwnedByOffering(L1, L2), false);

  // A blank resolved id can never match anything, including a blank stored one.
  assert.equal(isWeeklyFeedbackFormOwnedByOffering(L1, ""), false);
  assert.equal(isWeeklyFeedbackFormOwnedByOffering("", ""), false);

  // No trimming, no case folding, no prefix matching.
  assert.equal(isWeeklyFeedbackFormOwnedByOffering(` ${L1}`, L1), false);
  assert.equal(isWeeklyFeedbackFormOwnedByOffering(`${L1} `, L1), false);
  assert.equal(isWeeklyFeedbackFormOwnedByOffering(L1.toUpperCase(), L1), false);
  assert.equal(isWeeklyFeedbackFormOwnedByOffering(L1.slice(0, -1), L1), false);
  assert.equal(isWeeklyFeedbackFormOwnedByOffering(`${L1}x`, L1), false);
});

// ---------------------------------------------------------------------------
// Query shapes
// ---------------------------------------------------------------------------

test("the read query always pins the exact offering inside the where clause", () => {
  const query = buildTraineeWeeklyFeedbackFormQuery(L1);
  assert.deepEqual(query, {
    where: {
      weeklySchedule: { courseOfferingId: L1 },
      status: { in: ["PUBLISHED", "CLOSED"] },
    },
    orderBy: { publishedAt: "desc" },
  });
  // No date range, no title pattern, no level, no group - offering scope is
  // never inferred, and there is no global "latest form" escape hatch.
  assert.deepEqual(Object.keys(query.where).sort(), ["status", "weeklySchedule"]);
});

test("a blank resolved offering id cannot widen either query", () => {
  for (const bad of ["", null, undefined]) {
    assert.throws(
      () => buildTraineeWeeklyFeedbackFormQuery(bad as unknown as string),
      /non-empty, server-resolved courseOfferingId/,
    );
    assert.throws(
      () => buildTraineeWeeklyFeedbackSubmissionFormQuery("form-1", bad as unknown as string),
      /non-empty, server-resolved courseOfferingId/,
    );
  }
});

test("the submission query ANDs the caller formId with the exact offering", () => {
  assert.deepEqual(buildTraineeWeeklyFeedbackSubmissionFormQuery("form-9", L1), {
    where: { id: "form-9", weeklySchedule: { courseOfferingId: L1 } },
  });
  assert.throws(() => buildTraineeWeeklyFeedbackSubmissionFormQuery("", L1), /non-empty formId/);
});

// ---------------------------------------------------------------------------
// Window predicates
// ---------------------------------------------------------------------------

test("open-window and submission-window rules are unchanged", () => {
  const past = new Date(NOW.getTime() - 1000);
  const future = new Date(NOW.getTime() + 1000);

  assert.equal(isWeeklyFeedbackFormCurrentlyOpen(formRow(), NOW), true);
  assert.equal(isWeeklyFeedbackFormCurrentlyOpen(formRow({ status: "CLOSED" }), NOW), false);
  assert.equal(isWeeklyFeedbackFormCurrentlyOpen(formRow({ status: "DRAFT" }), NOW), false);
  assert.equal(isWeeklyFeedbackFormCurrentlyOpen(formRow({ opensAt: future }), NOW), false);
  assert.equal(isWeeklyFeedbackFormCurrentlyOpen(formRow({ opensAt: past }), NOW), true);
  assert.equal(isWeeklyFeedbackFormCurrentlyOpen(formRow({ closesAt: past }), NOW), false);
  assert.equal(isWeeklyFeedbackFormCurrentlyOpen(formRow({ closesAt: NOW }), NOW), false);
  assert.equal(isWeeklyFeedbackFormCurrentlyOpen(formRow({ closesAt: future }), NOW), true);

  assert.equal(classifyWeeklyFeedbackSubmissionWindow(formRow(), NOW), "OPEN");
  assert.equal(classifyWeeklyFeedbackSubmissionWindow(formRow({ status: "CLOSED" }), NOW), "NOT_PUBLISHED");
  assert.equal(classifyWeeklyFeedbackSubmissionWindow(formRow({ status: "DRAFT" }), NOW), "NOT_PUBLISHED");
  assert.equal(classifyWeeklyFeedbackSubmissionWindow(formRow({ opensAt: future }), NOW), "NOT_YET_OPEN");
  assert.equal(classifyWeeklyFeedbackSubmissionWindow(formRow({ closesAt: past }), NOW), "CLOSED");
  assert.equal(classifyWeeklyFeedbackSubmissionWindow(formRow({ closesAt: NOW }), NOW), "CLOSED");
});

test("the empty result is fresh on every call, never a shared singleton", () => {
  const a = emptyWeeklyFeedbackForStudent();
  const b = emptyWeeklyFeedbackForStudent();
  assert.deepEqual(a, { status: "none" });
  assert.notEqual(a, b);
});

// ---------------------------------------------------------------------------
// Read orchestration - denial and order
// ---------------------------------------------------------------------------

test("an anonymous caller is denied BEFORE any form is queried", async () => {
  const { deps, calls } = readDeps({
    requireTraineeId: async () => {
      throw new UnauthenticatedActorError();
    },
  });
  assert.deepEqual(await loadTraineeWeeklyFeedbackWithDeps(deps), { status: "none" });
  assert.equal(calls.formQueries.length, 0, "no form may be fetched for an anonymous caller");
  assert.equal(calls.responseArgs.length, 0);
});

test("expired, wrong-audience and inactive trainee sessions are denied identically", async () => {
  // requireCurrentTrainee collapses all three into UnauthenticatedActorError,
  // so all three arrive here as the same denial with the same message shape.
  for (const message of ["session expired", "wrong audience", "trainee is INACTIVE"]) {
    const { deps, calls } = readDeps({
      requireTraineeId: async () => {
        throw new UnauthenticatedActorError(message);
      },
    });
    assert.deepEqual(await loadTraineeWeeklyFeedbackWithDeps(deps), { status: "none" });
    assert.equal(calls.formQueries.length, 0);
  }
});

test("no eligible offering and ambiguous offering are denied before any form query", async () => {
  for (const error of [
    new NoTraineeCourseOfferingError(TRAINEE),
    new AmbiguousTraineeCourseOfferingError(TRAINEE, [L1, L2]),
  ]) {
    const { deps, calls } = readDeps({
      resolveOffering: async () => {
        throw error;
      },
    });
    assert.deepEqual(await loadTraineeWeeklyFeedbackWithDeps(deps), { status: "none" });
    assert.equal(calls.formQueries.length, 0);
    assert.equal(calls.responseArgs.length, 0);
  }
});

test("a PLANNED-only Level 2 trainee gets the same 'none' as everyone denied", async () => {
  // The pre-launch Level 2 state surfaces as NoTraineeCourseOfferingError from
  // the committed resolver: no ACTIVE enrollment into an ACTIVE offering.
  const { deps, calls } = readDeps({
    resolveOffering: async () => {
      throw new NoTraineeCourseOfferingError(TRAINEE);
    },
  });
  assert.deepEqual(await loadTraineeWeeklyFeedbackWithDeps(deps), { status: "none" });
  assert.equal(calls.formQueries.length, 0);
});

test("an activated Level 2 trainee never receives the Level 1 form", async () => {
  // The offering resolves to Level 2, so the query is pinned to Level 2 and the
  // Level 1 form is not among the rows the database could return.
  const { deps, calls } = readDeps({ resolveOffering: async () => ({ id: L2 }), form: null });
  assert.deepEqual(await loadTraineeWeeklyFeedbackWithDeps(deps), { status: "none" });
  assert.deepEqual(calls.formQueries[0].where.weeklySchedule, { courseOfferingId: L2 });
  assert.equal(calls.responseArgs.length, 0, "no response may be probed when no form is owned");
});

test("a NULL-scoped form fails closed even if the query somehow returned it", async () => {
  const { deps, calls } = readDeps({ form: formRow({ weeklySchedule: { courseOfferingId: null } }) });
  assert.deepEqual(await loadTraineeWeeklyFeedbackWithDeps(deps), { status: "none" });
  assert.equal(calls.responseArgs.length, 0);
});

test("another course's form fails closed even if the query somehow returned it", async () => {
  const { deps, calls } = readDeps({ form: formRow({ weeklySchedule: { courseOfferingId: L2 } }) });
  assert.deepEqual(await loadTraineeWeeklyFeedbackWithDeps(deps), { status: "none" });
  assert.equal(calls.responseArgs.length, 0);
});

test("a not-currently-open owned form is 'none', indistinguishable from denial", async () => {
  const { deps } = readDeps({ form: formRow({ status: "CLOSED" }), response: null });
  assert.deepEqual(await loadTraineeWeeklyFeedbackWithDeps(deps), { status: "none" });
});

test("infrastructure and programming failures propagate, never becoming 'none'", async () => {
  const boom = new Error("connection reset by peer");

  const resolverFailure = readDeps({
    resolveOffering: async () => {
      throw boom;
    },
  });
  await assert.rejects(() => loadTraineeWeeklyFeedbackWithDeps(resolverFailure.deps), /connection reset/);

  const { deps } = readDeps({});
  deps.fetchOwnedForm = async () => {
    throw boom;
  };
  await assert.rejects(() => loadTraineeWeeklyFeedbackWithDeps(deps), /connection reset/);
});

// ---------------------------------------------------------------------------
// Read orchestration - the authorized Level 1 path
// ---------------------------------------------------------------------------

test("a Level 1 owned, open form is returned with its questions", async () => {
  const { deps, calls } = readDeps({ form: formRow(), response: null });
  const outcome = await loadTraineeWeeklyFeedbackWithDeps(deps);

  assert.equal(outcome.status, "open");
  assert.deepEqual(calls.formQueries[0].where.weeklySchedule, { courseOfferingId: L1 });
  // The response lookup is keyed by the SESSION-derived trainee id.
  assert.deepEqual(calls.responseArgs, [{ formId: "form-1", traineeId: TRAINEE }]);
});

test("'submitted' is decided before the open-window gate, so it survives closing", async () => {
  const submittedAt = new Date("2026-07-20T08:00:00.000Z");
  const { deps } = readDeps({ form: formRow({ status: "CLOSED" }), response: { submittedAt } });
  const outcome = await loadTraineeWeeklyFeedbackWithDeps(deps);

  assert.equal(outcome.status, "submitted");
  assert.equal(outcome.status === "submitted" && outcome.submittedAt, submittedAt);
});

test("a client-supplied trainee id can never reach the response lookup", async () => {
  // The core has no parameter for a trainee id at all; the only id that reaches
  // fetchResponse is the one requireTraineeId produced.
  const { deps, calls } = readDeps({ response: null });
  await loadTraineeWeeklyFeedbackWithDeps(deps);
  assert.deepEqual(calls.responseArgs, [{ formId: "form-1", traineeId: TRAINEE }]);
  assert.equal(
    JSON.stringify(calls.responseArgs).includes(IMPOSTER),
    false,
    "no client-supplied id may appear in a response lookup",
  );
});

// ---------------------------------------------------------------------------
// Submission gate
// ---------------------------------------------------------------------------

test("every submission denial is the same value and reads no form for an unauthenticated caller", async () => {
  const unauth = submitDeps({
    requireTraineeId: async () => {
      throw new UnauthenticatedActorError();
    },
  });
  assert.deepEqual(await authorizeTraineeWeeklyFeedbackSubmissionWithDeps("form-1", unauth.deps), {
    authorized: false,
  });
  assert.equal(unauth.calls.formQueries.length, 0, "no form may be fetched before the actor gate");

  for (const error of [
    new NoTraineeCourseOfferingError(TRAINEE),
    new AmbiguousTraineeCourseOfferingError(TRAINEE, [L1, L2]),
  ]) {
    const { deps, calls } = submitDeps({
      resolveOffering: async () => {
        throw error;
      },
    });
    assert.deepEqual(await authorizeTraineeWeeklyFeedbackSubmissionWithDeps("form-1", deps), {
      authorized: false,
    });
    assert.equal(calls.formQueries.length, 0);
  }
});

test("a cross-course submission is denied with the same value as an unknown form", async () => {
  // The Level 2 trainee names the real Level 1 form id. The ownership predicate
  // is in the where clause, so the row does not match and nothing is returned.
  const crossCourse = submitDeps({ resolveOffering: async () => ({ id: L2 }), form: null });
  const crossResult = await authorizeTraineeWeeklyFeedbackSubmissionWithDeps("form-1", crossCourse.deps);

  const unknown = submitDeps({ form: null });
  const unknownResult = await authorizeTraineeWeeklyFeedbackSubmissionWithDeps("no-such-form", unknown.deps);

  assert.deepEqual(crossResult, { authorized: false });
  assert.deepEqual(crossResult, unknownResult, "cross-course must be indistinguishable from not-found");
  assert.deepEqual(crossCourse.calls.formQueries[0].where, {
    id: "form-1",
    weeklySchedule: { courseOfferingId: L2 },
  });
});

test("a NULL-scoped or foreign form fails closed after fetch as defense in depth", async () => {
  for (const offering of [null, L2]) {
    const { deps } = submitDeps({ form: formRow({ weeklySchedule: { courseOfferingId: offering } }) });
    assert.deepEqual(await authorizeTraineeWeeklyFeedbackSubmissionWithDeps("form-1", deps), {
      authorized: false,
    });
  }
});

test("a blank formId is a uniform denial, not a thrown defect", async () => {
  const { deps } = submitDeps({});
  assert.deepEqual(await authorizeTraineeWeeklyFeedbackSubmissionWithDeps("", deps), {
    authorized: false,
  });
});

test("an authorized submission carries the session-derived trainee id, never the client's", async () => {
  const { deps, calls } = submitDeps({});
  const result = await authorizeTraineeWeeklyFeedbackSubmissionWithDeps("form-1", deps);

  assert.equal(result.authorized, true);
  if (!result.authorized) return;
  assert.equal(result.traineeId, TRAINEE);
  assert.notEqual(result.traineeId, IMPOSTER);
  assert.equal(result.courseOfferingId, L1);
  assert.equal(result.form.id, "form-1");
  assert.deepEqual(calls.formQueries[0].where.weeklySchedule, { courseOfferingId: L1 });
});

test("submission infrastructure failures propagate rather than denying", async () => {
  const { deps } = submitDeps({});
  deps.fetchOwnedFormById = async () => {
    throw new Error("connection reset by peer");
  };
  await assert.rejects(
    () => authorizeTraineeWeeklyFeedbackSubmissionWithDeps("form-1", deps),
    /connection reset/,
  );
});

// ---------------------------------------------------------------------------
// Source-level contract over the wired action module
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ACTION_SRC = readFileSync(path.join(REPO_ROOT, "lib/actions/weekly-feedback.ts"), "utf8");
const CORE_SRC = readFileSync(
  path.join(REPO_ROOT, "lib/course/weekly-feedback-course-scope-core.ts"),
  "utf8",
);

/**
 * Executable body only. Both modules' doc comments legitimately DISCUSS the
 * things the code must not do ("no next/headers", "no capability key",
 * "SCHEDULE would be the dangerous reuse") - naming a forbidden mechanism in
 * order to rule it out must not trip the tripwires below. Same comment-stripping
 * convention as temporary-level2-compatibility.contract.test.ts.
 */
function executableCode(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const ACTION_CODE = executableCode(ACTION_SRC);
const CORE_CODE = executableCode(CORE_SRC);

test("the wired action module keeps no global newest-published-form lookup", () => {
  // The old leak was findFirst({ where: { status: { in: [...] } } }) with no
  // offering predicate. Every remaining trainee form read must go through the
  // core's builder, which cannot be constructed without an offering id.
  assert.equal(
    /findFirst\(\s*\{\s*where:\s*\{\s*status:/.test(ACTION_SRC),
    false,
    "no status-only form lookup may remain",
  );
  assert.ok(ACTION_SRC.includes("loadTraineeWeeklyFeedbackWithDeps"));
  assert.ok(ACTION_SRC.includes("authorizeTraineeWeeklyFeedbackSubmissionWithDeps"));
});

test("the trainee actions discard the client-supplied studentId", () => {
  const voidCount = (ACTION_SRC.match(/void studentId;/g) ?? []).length;
  assert.equal(voidCount, 2, "both trainee actions must discard their studentId argument");
  assert.ok(ACTION_SRC.includes("requireCurrentTrainee"));
  assert.ok(ACTION_SRC.includes("resolveTraineeCourseOffering"));
});

test("neither module reaches for a forbidden course-context source", () => {
  for (const [name, code] of [
    ["action", ACTION_CODE],
    ["core", CORE_CODE],
  ] as const) {
    assert.equal(code.includes("resolveCurrentCourseOffering"), false, `${name}: no legacy singleton resolver`);
    assert.equal(code.includes(L1), false, `${name}: no Level 1 offering id literal`);
    assert.equal(code.includes(L2), false, `${name}: no Level 2 offering id literal`);
    assert.equal(code.includes("next/headers"), false, `${name}: no direct cookie access`);
  }

  // The ownership FILTER is built in exactly one place. The action may project
  // `weeklySchedule: { select: { courseOfferingId: true } }` - that is how it
  // re-asserts ownership on the fetched row - but it must never assemble the
  // where-clause predicate itself, and it takes no offering id of its own.
  assert.ok(
    CORE_CODE.includes("weeklySchedule: { courseOfferingId }"),
    "the core must build the ownership predicate",
  );
  assert.equal(
    /weeklySchedule:\s*\{\s*courseOfferingId[^:]/.test(ACTION_CODE),
    false,
    "the action must not assemble the ownership predicate itself",
  );
  // Remove the two legitimate `courseOfferingId: true` select projections, then
  // require that no binding of an offering id VALUE remains anywhere.
  const actionWithoutProjections = ACTION_CODE.replace(/courseOfferingId:\s*true/g, "");
  assert.equal(
    /courseOfferingId\s*[:=]/.test(actionWithoutProjections),
    false,
    "the action must never bind an offering id value",
  );
});

test("no capability key is added or reused for weekly feedback", () => {
  for (const code of [ACTION_CODE, CORE_CODE]) {
    assert.equal(code.includes("getEffectiveCapabilities"), false);
    assert.equal(code.includes("capability-keys"), false);
    assert.equal(code.includes("CapabilityKey"), false);
    // "SCHEDULE" would be the most tempting and the most dangerous reuse: it is
    // ENABLED for Level 2 at launch, so gating on it grants what must be denied.
    for (const key of ["SCHEDULE", "TEACHING_PRACTICE", "CONTACTS", "MESSAGES", "ATTENDANCE"]) {
      assert.equal(code.includes(`"${key}"`), false, `no capability key ${key} may be reused`);
    }
  }
});

test("the core stays pure - no IO of any kind", () => {
  for (const forbidden of [
    "@/lib/prisma",
    "next/headers",
    "next/cache",
    "node:fs",
    "process.env",
    "Math.random",
    "use server",
  ]) {
    assert.equal(CORE_CODE.includes(forbidden), false, `core must not reference ${forbidden}`);
  }
  // Date is only ever injected (deps.now / a `now` argument), never read here.
  assert.equal(CORE_CODE.includes("new Date("), false, "core must not read the clock");
});

test("every admin action keeps its requireAdmin gate", () => {
  const ADMIN_ACTIONS = [
    "listWeeklyFeedbackForms",
    "createWeeklyFeedbackDraft",
    "getWeeklyFeedbackDraftForAdmin",
    "updateWeeklyFeedbackSchedule",
    "addWeeklyFeedbackQuestion",
    "updateWeeklyFeedbackQuestion",
    "deleteWeeklyFeedbackQuestion",
    "reorderWeeklyFeedbackQuestions",
    "suggestWeeklyFeedbackQuestionsFromSchedule",
    "publishWeeklyFeedbackForm",
    "closeWeeklyFeedbackForm",
    "getWeeklyFeedbackResults",
  ];
  for (const action of ADMIN_ACTIONS) {
    const at = ACTION_SRC.indexOf(`export async function ${action}(`);
    assert.notEqual(at, -1, `${action} must still exist`);
    const body = ACTION_SRC.slice(at, at + 600);
    assert.ok(body.includes("await requireAdmin();"), `${action} must keep its requireAdmin gate`);
    assert.equal(
      body.includes("requireCurrentTrainee"),
      false,
      `${action} must not consume the trainee actor - admin identity is requireAdmin()`,
    );
  }
});

// ===========================================================================
// ADMIN DENOMINATOR SCOPING - SECURITY / LEVEL 2 SLICE L2-F1B
// ===========================================================================
//
// L2-F1A stopped a Level 2 trainee from READING or ANSWERING a Level 1 form.
// These tests cover the other half: a Level 2 trainee must not distort Level 1
// numbers merely by EXISTING. The defect was a global
// `Student.isActive = true` population used as every form's denominator and as
// the entire missing-response list.

const OTHER = "cmrother0000offering0id00";

/** An enrollment row as the results roster query projects it. */
function rosterRow(studentId: string, fullName = `name-${studentId}`) {
  return { studentId, student: { fullName } };
}

// --- strict ownership acceptance -------------------------------------------

test("form offering acceptance is strict and fails closed", () => {
  assert.equal(acceptWeeklyFeedbackFormOfferingId(L1), L1);
  for (const bad of [null, undefined, "", 0, false, {}, []]) {
    assert.equal(
      acceptWeeklyFeedbackFormOfferingId(bad as unknown as string | null),
      null,
      `${JSON.stringify(bad)} must not be accepted as an offering id`,
    );
  }
  // Verbatim: no trimming, no case folding, no prefix matching.
  assert.equal(acceptWeeklyFeedbackFormOfferingId(` ${L1} `), ` ${L1} `);
});

test("distinct offering ids are collected once, in order, dropping unscoped weeks", () => {
  assert.deepEqual(
    collectWeeklyFeedbackOfferingIds([L1, L2, L1, null, undefined, "", L2, OTHER]),
    [L1, L2, OTHER],
  );
  assert.deepEqual(collectWeeklyFeedbackOfferingIds([null, undefined, ""]), []);
  assert.deepEqual(collectWeeklyFeedbackOfferingIds([]), []);
});

// --- roster query shapes ----------------------------------------------------

test("the roster query pins offering, enrollment status and student activity", () => {
  assert.deepEqual(buildWeeklyFeedbackRosterQuery(L1), {
    where: { courseOfferingId: L1, status: "ACTIVE", student: { isActive: true } },
    orderBy: { student: { fullName: "asc" } },
  });
  assert.deepEqual(buildWeeklyFeedbackRosterCountQuery([L1, L2]), {
    where: { courseOfferingId: { in: [L1, L2] }, status: "ACTIVE", student: { isActive: true } },
  });
  // An empty list is a query that matches NOTHING - never "no filter".
  assert.deepEqual(buildWeeklyFeedbackRosterCountQuery([]).where.courseOfferingId, { in: [] });
});

test("a blank offering id throws rather than widening the roster to every course", () => {
  for (const blank of ["", null, undefined]) {
    assert.throws(
      () => buildWeeklyFeedbackRosterQuery(blank as unknown as string),
      /non-empty courseOfferingId/,
    );
    assert.throws(
      () => buildWeeklyFeedbackRosterCountQuery([L1, blank as unknown as string]),
      /non-empty courseOfferingId/,
    );
  }
});

test("the batch roster query snapshots its id list", () => {
  const ids = [L1];
  const query = buildWeeklyFeedbackRosterCountQuery(ids);
  ids.push(L2);
  assert.deepEqual(
    query.where.courseOfferingId.in,
    [L1],
    "a later mutation of the caller's array must not widen an already-built query",
  );
});

// --- roster projection / dedupe --------------------------------------------

test("roster members are deduped by student id, first occurrence winning", () => {
  const members = toWeeklyFeedbackRosterMembers([
    rosterRow("s1", "אבי"),
    rosterRow("s2", "בני"),
    rosterRow("s1", "אבי (duplicate row)"),
  ]);
  assert.deepEqual(members, [
    { id: "s1", fullName: "אבי" },
    { id: "s2", fullName: "בני" },
  ]);
});

test("the roster projection exposes only id and fullName", () => {
  const [member] = toWeeklyFeedbackRosterMembers([
    {
      studentId: "s1",
      student: { fullName: "אבי", groupName: "א", subgroupNumber: 2, phone: "050" },
    } as unknown as { studentId: string; student: { fullName: string } },
  ]);
  assert.deepEqual(Object.keys(member).sort(), ["fullName", "id"]);
});

test("per-offering counts dedupe by (offering, student) and count a dual enrollment once each", () => {
  const counts = countWeeklyFeedbackRosterByOffering([
    { courseOfferingId: L1, studentId: "s1" },
    { courseOfferingId: L1, studentId: "s2" },
    { courseOfferingId: L1, studentId: "s1" }, // defensive duplicate
    { courseOfferingId: L2, studentId: "s2" }, // dual-enrolled trainee
    { courseOfferingId: L2, studentId: "s3" },
  ]);
  assert.equal(counts.get(L1), 2);
  assert.equal(counts.get(L2), 2, "a dual-enrolled trainee counts once per offering, never twice in one");
  assert.equal(counts.get(OTHER), undefined);
});

// --- denominator ------------------------------------------------------------

test("a NULL-scoped form gets denominator 0 and never falls back", () => {
  const counts = countWeeklyFeedbackRosterByOffering([
    { courseOfferingId: L1, studentId: "s1" },
    { courseOfferingId: L2, studentId: "s2" },
  ]);
  for (const unscoped of [null, undefined, ""]) {
    assert.equal(weeklyFeedbackDenominatorForForm(unscoped, counts), 0);
  }
  // An offering with no active roster is 0 too - no distinction, no fallback.
  assert.equal(weeklyFeedbackDenominatorForForm(OTHER, counts), 0);
  assert.equal(weeklyFeedbackDenominatorForForm(L1, counts), 1);
});

test("an active Level 2 trainee never enters a Level 1 form's denominator", () => {
  // The roster query returns ONLY Level 1 enrollments: the Level 2 trainee's
  // enrollment cannot satisfy courseOfferingId = L1.
  const counts = countWeeklyFeedbackRosterByOffering([
    { courseOfferingId: L1, studentId: "l1-a" },
    { courseOfferingId: L1, studentId: "l1-b" },
    { courseOfferingId: L2, studentId: "l2-only" },
  ]);
  assert.equal(weeklyFeedbackDenominatorForForm(L1, counts), 2);
  assert.equal(weeklyFeedbackDenominatorForForm(L2, counts), 1);
});

// --- submitted / not-submitted split ---------------------------------------

test("the summary splits the scoped roster and always sums back to it", () => {
  const roster = toWeeklyFeedbackRosterMembers([rosterRow("s1"), rosterRow("s2"), rosterRow("s3")]);
  const summary = summarizeWeeklyFeedbackDenominator(roster, new Set(["s1", "s3"]));
  assert.deepEqual(summary, { activeTraineeCount: 3, submittedCount: 2, notSubmittedCount: 1 });
  assert.equal(summary.submittedCount + summary.notSubmittedCount, summary.activeTraineeCount);
});

test("an off-roster response does not decrement the missing count or list", () => {
  const roster = toWeeklyFeedbackRosterMembers([rosterRow("active-1"), rosterRow("active-2")]);
  // "gone" submitted while enrolled and was later deactivated; "l2-only" belongs
  // to another course entirely. Neither is on this form's roster.
  const submitted = new Set(["active-1", "gone", "l2-only"]);

  const summary = summarizeWeeklyFeedbackDenominator(roster, submitted);
  assert.deepEqual(summary, { activeTraineeCount: 2, submittedCount: 1, notSubmittedCount: 1 });
  assert.deepEqual(
    selectNotSubmittedRosterMembers(roster, submitted).map((m) => m.id),
    ["active-2"],
  );
  assert.deepEqual(
    selectSubmittedRosterMembers(roster, submitted).map((m) => m.id),
    ["active-1"],
    "only roster members are counted as submitters",
  );
});

test("notSubmitted never goes negative when responses outnumber the roster", () => {
  const roster = toWeeklyFeedbackRosterMembers([rosterRow("active-1")]);
  const summary = summarizeWeeklyFeedbackDenominator(
    roster,
    new Set(["active-1", "gone-1", "gone-2", "gone-3"]),
  );
  assert.deepEqual(summary, { activeTraineeCount: 1, submittedCount: 1, notSubmittedCount: 0 });
});

test("an empty (NULL-scoped or unenrolled) roster yields an all-zero summary and no missing list", () => {
  const summary = summarizeWeeklyFeedbackDenominator([], new Set(["someone", "another"]));
  assert.deepEqual(summary, { activeTraineeCount: 0, submittedCount: 0, notSubmittedCount: 0 });
  assert.deepEqual(selectNotSubmittedRosterMembers([], new Set(["someone"])), []);
});

test("the roster split does not mutate its inputs", () => {
  const roster = toWeeklyFeedbackRosterMembers([rosterRow("s1"), rosterRow("s2")]);
  const submitted = new Set(["s1"]);
  selectSubmittedRosterMembers(roster, submitted);
  selectNotSubmittedRosterMembers(roster, submitted);
  summarizeWeeklyFeedbackDenominator(roster, submitted);
  assert.deepEqual(roster.map((m) => m.id), ["s1", "s2"]);
  assert.deepEqual([...submitted], ["s1"]);
});

// ---------------------------------------------------------------------------
// Source-level contract over the two wired ADMIN actions
// ---------------------------------------------------------------------------

/** The executable body of one exported action, up to the next top-level export. */
function actionBody(name: string): string {
  const at = ACTION_CODE.indexOf(`export async function ${name}(`);
  assert.notEqual(at, -1, `${name} must still exist`);
  const rest = ACTION_CODE.slice(at + 1);
  const end = rest.indexOf("\nexport ");
  return end === -1 ? rest : rest.slice(0, end);
}

test("no global active-student count or read remains anywhere in the module", () => {
  assert.equal(
    ACTION_CODE.includes("prisma.student.count"),
    false,
    "the global active-student count is the exact defect L2-F1B removes",
  );
  assert.equal(
    ACTION_CODE.includes("prisma.student.findMany"),
    false,
    "the global active-student read is the exact defect L2-F1B removes",
  );
  assert.equal(
    /where:\s*\{\s*isActive:\s*true\s*\}/.test(ACTION_CODE),
    false,
    "no unscoped isActive-only where clause may remain",
  );
});

test("both scoped admin actions derive the denominator from the enrollment roster", () => {
  for (const action of ["listWeeklyFeedbackForms", "getWeeklyFeedbackResults"]) {
    const body = actionBody(action);
    assert.ok(
      body.includes("prisma.courseEnrollment.findMany"),
      `${action} must read the enrollment-backed roster`,
    );
    assert.ok(
      body.includes("weeklySchedule.courseOfferingId"),
      `${action} must derive ownership from the form's own week`,
    );
  }
});

test("the admin roster where-clause is built only by the core", () => {
  // The action may PROJECT courseOfferingId (`courseOfferingId: true`) but must
  // never assemble a roster predicate itself - same rule as the trainee path.
  const withoutProjections = ACTION_CODE.replace(/courseOfferingId:\s*true/g, "");
  assert.equal(
    /courseOfferingId\s*[:=]/.test(withoutProjections),
    false,
    "the action must never bind an offering id value",
  );
  assert.equal(
    /status:\s*"ACTIVE"/.test(ACTION_CODE),
    false,
    "the enrollment-status predicate belongs to the core",
  );
  // `isActive: true` still appears as a legitimate SELECT projection on a
  // response's student (submittedTrainees[].isActive). What must not appear is
  // the relation-filter form `student: { isActive: ... }` - the roster
  // predicate itself.
  assert.equal(
    /student:\s*\{\s*isActive/.test(ACTION_CODE),
    false,
    "the student-activity predicate belongs to the core",
  );
  for (const builder of [
    "acceptWeeklyFeedbackFormOfferingId",
    "buildWeeklyFeedbackRosterQuery",
    "buildWeeklyFeedbackRosterCountQuery",
  ]) {
    assert.ok(ACTION_CODE.includes(builder), `the action must go through ${builder}`);
  }
});

test("the admin scoping uses no resolver fallback and no offering constant", () => {
  // Re-asserted for the admin half specifically, now that admin code also
  // handles offering ids.
  assert.equal(ACTION_CODE.includes("resolveCurrentCourseOffering"), false);
  assert.equal(CORE_CODE.includes("resolveCurrentCourseOffering"), false);
  for (const id of [L1, L2, OTHER]) {
    assert.equal(ACTION_CODE.includes(id), false, "no offering-id literal may appear in the action");
    assert.equal(CORE_CODE.includes(id), false, "no offering-id literal may appear in the core");
  }
});

test("historical responses stay sourced from the form, not the roster", () => {
  const body = actionBody("getWeeklyFeedbackResults");
  // submittedTrainees / traineeResponses / question answers all iterate
  // form.responses, so a since-deactivated or off-roster respondent is still
  // shown. Only the missing list is roster-derived.
  assert.ok(
    /const submittedTrainees[\s\S]*?form\.responses/.test(body),
    "submittedTrainees must still come from the form's own responses",
  );
  assert.ok(
    /const traineeResponses[\s\S]*?form\.responses\.map/.test(body),
    "traineeResponses must still come from the form's own responses",
  );
  assert.ok(
    body.includes("selectNotSubmittedRosterMembers"),
    "the missing list must be roster-derived",
  );
  assert.equal(
    /notSubmittedCount:/.test(body),
    false,
    "notSubmitted must never be recomputed in the action - the core owns the arithmetic",
  );
});

test("the trainee actions are untouched by the admin slice", () => {
  for (const action of ["getOpenWeeklyFeedbackForStudent", "submitWeeklyFeedback"]) {
    const body = actionBody(action);
    assert.ok(body.includes("void studentId;"), `${action} must still discard its studentId`);
    assert.ok(body.includes("requireCurrentTrainee"), `${action} must still use the session actor`);
    assert.equal(body.includes("requireAdmin"), false, `${action} must not acquire an admin gate`);
    for (const adminOnly of [
      "prisma.courseEnrollment",
      "buildWeeklyFeedbackRosterQuery",
      "buildWeeklyFeedbackRosterCountQuery",
      "summarizeWeeklyFeedbackDenominator",
      "selectNotSubmittedRosterMembers",
      "toWeeklyFeedbackRosterMembers",
    ]) {
      assert.equal(
        body.includes(adminOnly),
        false,
        `${action} must not gain the admin-only ${adminOnly}`,
      );
    }
  }
  // The L2-F1A trainee containment wiring is intact and still exclusive.
  assert.equal((ACTION_SRC.match(/void studentId;/g) ?? []).length, 2);
  assert.equal((ACTION_SRC.match(/requireCurrentTrainee\(\)/g) ?? []).length, 2);
});

test("the core stays pure after the admin additions", () => {
  for (const forbidden of ["@/lib/prisma", "PrismaClient", "prisma.", "use server"]) {
    assert.equal(CORE_CODE.includes(forbidden), false, `core must not reference ${forbidden}`);
  }
});
