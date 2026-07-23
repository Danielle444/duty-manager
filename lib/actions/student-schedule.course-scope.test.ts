/**
 * LEVEL 2 SCHEDULE SLICE S1A - wiring + ordering contract tests for the
 * COURSE-SCOPED trainee schedule read path.
 *
 * lib/actions/student-schedule.ts and lib/actions/weekly-schedule.ts are
 * "use server" modules that transitively import Prisma and next/cache, so they
 * cannot be imported into a plain `tsx --test` process the way a pure DI
 * orchestration can. The BEHAVIOUR of every gate is therefore tested against the
 * pure core in lib/course/course-scoped-week-options-core.test.ts; this file uses
 * the repository's established SOURCE-CONTRACT pattern (same convention as
 * schedule-writer-auth.contract.test.ts and
 * contacts.instructor-directory.test.ts's signature assertions) to prove that the
 * real actions are wired to that core, in the right order, with no client course
 * context and no Level 1 fallback.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/student-schedule.course-scope.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const studentScheduleSrc = readSource("./student-schedule.ts");
const weeklyScheduleSrc = readSource("./weekly-schedule.ts");
const studentClientSrc = readSource("../../app/student/StudentClient.tsx");
const scheduleSectionSrc = readSource("../../app/student/ScheduleSection.tsx");

/**
 * Extract a single function's source: from its `export async function NAME(`
 * signature up to its OWN closing brace at column 0.
 *
 * Deliberately tighter than the `next top-level export` window used by
 * schedule-writer-auth.contract.test.ts: that window also swallows any trailing
 * comment block belonging to the NEXT declaration, which would make a token
 * assertion on one function silently read the neighbouring documentation.
 */
function functionSource(src: string, name: string): string {
  const sigMarker = `export async function ${name}(`;
  const start = src.indexOf(sigMarker);
  assert.notEqual(start, -1, `expected to find ${name} in source`);
  const end = src.indexOf("\n}", start + sigMarker.length);
  assert.notEqual(end, -1, `unterminated function body for ${name}`);
  return src.slice(start, end + 2);
}

/** The declared parameter list of `export async function NAME(...)`. */
function parameterList(src: string, name: string): string[] {
  const sigMarker = `export async function ${name}(`;
  const start = src.indexOf(sigMarker);
  assert.notEqual(start, -1, `expected to find ${name} in source`);
  const open = start + sigMarker.length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  assert.notEqual(close, -1, `unbalanced parameter list for ${name}`);
  const raw = src.slice(open + 1, close);
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Index of `needle` in `body`, asserted present. */
function requiredIndex(body: string, needle: string, label: string): number {
  const i = body.indexOf(needle);
  assert.notEqual(i, -1, `${label}: expected to find \`${needle}\``);
  return i;
}

// ===========================================================================
// getScheduleForStudent - signature is unchanged and carries no course context.
// ===========================================================================

test("getScheduleForStudent still takes exactly four parameters", () => {
  const params = parameterList(studentScheduleSrc, "getScheduleForStudent");
  assert.equal(params.length, 4, `expected 4 parameters, got: ${JSON.stringify(params)}`);
  assert.ok(params[0].startsWith("studentId"));
  assert.ok(params[1].startsWith("weeklyScheduleId"));
  assert.ok(params[2].startsWith("dayKey"));
  assert.ok(params[3].startsWith("groupFilter"));
});

test("no parameter of getScheduleForStudent can name a course", () => {
  for (const param of parameterList(studentScheduleSrc, "getScheduleForStudent")) {
    assert.ok(
      !/courseOffering|offeringId|courseId|level/i.test(param),
      `parameter "${param}" must not accept a client-supplied course context`,
    );
  }
});

// ===========================================================================
// getScheduleForStudent - server-derived course context, no legacy resolver.
// ===========================================================================

test("student-schedule.ts wires the TRAINEE resolver and never resolveCurrentCourseOffering", () => {
  assert.match(
    studentScheduleSrc,
    /import\s*\{\s*resolveTraineeCourseOffering\s*\}\s*from\s*["']@\/lib\/course\/actor-course-offering["']/,
    "must import the committed no-argument trainee resolver",
  );
  assert.ok(
    !studentScheduleSrc.includes("resolveCurrentCourseOffering"),
    "the migrated trainee read path must never use the legacy singleton resolver",
  );
});

test("student-schedule.ts has no Level 1 fallback and infers nothing about the course", () => {
  for (const forbidden of [
    "LEVEL_1_COURSE_OFFERING_ID",
    "LEVEL_2_COURSE_OFFERING_ID",
    "temporary-level2-compatibility",
    "resolveCurrentCourseOffering",
    "current-offering",
    "courseSettings",
    "CourseSettings",
  ]) {
    assert.ok(
      !studentScheduleSrc.includes(forbidden),
      `student-schedule.ts must not reference "${forbidden}"`,
    );
  }
});

test("the course context is resolved INDEPENDENTLY inside getScheduleForStudent", () => {
  const body = functionSource(studentScheduleSrc, "getScheduleForStudent");
  assert.match(
    body,
    /authorizeTraineeWeekReadWithDeps\(\s*weeklyScheduleId\s*,\s*\{/,
    "the gate must be invoked with the requested week id",
  );
  assert.match(body, /resolveTraineeCourseOffering,/, "the real resolver must be injected");
  assert.match(body, /getEffectiveCapabilities,/, "the real capability reader must be injected");
});

// ===========================================================================
// getScheduleForStudent - authorization strictly precedes every content read.
// ===========================================================================

test("the authorization gate precedes the ScheduleItem query and the publication reader", () => {
  const body = functionSource(studentScheduleSrc, "getScheduleForStudent");

  const gate = requiredIndex(body, "await authorizeTraineeWeekReadWithDeps(", "getScheduleForStudent");
  const guard = requiredIndex(
    body,
    "if (!authorization.authorized) return emptyStudentScheduleResult();",
    "getScheduleForStudent",
  );
  const items = requiredIndex(body, "prisma.scheduleItem.findMany(", "getScheduleForStudent");
  const publications = requiredIndex(
    body,
    "getPublishedComplexRidingPlansForStudentInternal(",
    "getScheduleForStudent",
  );

  assert.ok(gate < guard, "the deny-guard must follow the gate call");
  assert.ok(
    guard < items,
    "no ScheduleItem may be queried before the authorization guard returns",
  );
  assert.ok(
    guard < publications,
    "the nested publication reader must never run before the authorization guard",
  );
});

test("the week header fetch selects only the authorization columns - it never includes items", () => {
  const body = functionSource(studentScheduleSrc, "getScheduleForStudent");
  assert.match(
    body,
    /prisma\.weeklySchedule\.findUnique\(\{\s*where:\s*\{\s*id\s*\}\s*,\s*select:\s*TRAINEE_WEEK_META_SELECT\s*\}\)/,
    "the header fetch must use the narrow meta projection",
  );
  // The pre-S1A shape nested the entire item tree onto the week fetch. That
  // nesting is exactly what would load another course's items before any check.
  const headerFetch = body.indexOf("prisma.weeklySchedule.findUnique(");
  const itemsQuery = body.indexOf("prisma.scheduleItem.findMany(");
  assert.ok(headerFetch !== -1 && itemsQuery !== -1);
  assert.ok(
    headerFetch < itemsQuery,
    "the header fetch and the item query must be two separate, ordered reads",
  );
  assert.ok(
    !/findUnique\([\s\S]{0,400}?include:\s*\{\s*items:/.test(body),
    "the week fetch must not include items",
  );
});

test("every denial path returns the same uniform empty result", () => {
  const body = functionSource(studentScheduleSrc, "getScheduleForStudent");
  const returns = body.match(/return emptyStudentScheduleResult\(\);/g) ?? [];
  assert.ok(returns.length >= 2, "unknown student and unauthorized week both return the empty result");
  // No denial constructs a distinguishable payload of its own.
  assert.ok(
    !/return \{ hasSchedule: false/.test(body),
    "denials must go through the single empty-result helper",
  );
  assert.match(
    studentScheduleSrc,
    /function emptyStudentScheduleResult\(\): StudentScheduleResult \{\s*return \{ hasSchedule: false, weekName: null, items: \[\] \};/,
    "the empty result must stay byte-identical to the pre-S1A empty result",
  );
});

test("the pre-existing publication guard is preserved (now inside the shared gate)", () => {
  const coreSrc = readSource("../course/course-scoped-week-options-core.ts");
  assert.match(
    coreSrc,
    /return week\.isPublished === true;/,
    "the trainee final-read predicate must still require a published week",
  );
});

// ===========================================================================
// getWeeklyScheduleSelectionForTrainee - the new, course-scoped week picker.
// ===========================================================================

test("getWeeklyScheduleSelectionForTrainee takes no arguments at all", () => {
  assert.deepEqual(parameterList(weeklyScheduleSrc, "getWeeklyScheduleSelectionForTrainee"), []);
});

test("getWeeklyScheduleSelectionForTrainee wires the trainee resolver, capabilities and the pure core", () => {
  const body = functionSource(weeklyScheduleSrc, "getWeeklyScheduleSelectionForTrainee");
  assert.match(body, /loadTraineeWeeklyScheduleSelectionWithDeps\(\{/);
  assert.match(body, /resolveTraineeCourseOffering,/);
  assert.match(body, /getEffectiveCapabilities,/);
  assert.match(body, /prisma\.weeklySchedule\.findMany\(query\)/);
  assert.match(body, /todayDateKey,/);
  // No hand-rolled where clause: the query shape comes only from the pure core.
  assert.ok(
    !body.includes("where:"),
    "the action must not build its own where clause - buildTraineeWeekOptionsQuery owns it",
  );
  assert.ok(!body.includes("resolveCurrentCourseOffering"));
});

test("weekly-schedule.ts imports the trainee resolver, not the legacy singleton one", () => {
  assert.match(
    weeklyScheduleSrc,
    /import\s*\{\s*resolveTraineeCourseOffering\s*\}\s*from\s*["']@\/lib\/course\/actor-course-offering["']/,
  );
  assert.ok(!weeklyScheduleSrc.includes("resolveCurrentCourseOffering"));
});

// ===========================================================================
// The legacy readers were NOT re-scoped by this slice.
// ===========================================================================

test("listWeeklyScheduleOptions is untouched: still global, still unfiltered", () => {
  const body = functionSource(weeklyScheduleSrc, "listWeeklyScheduleOptions");
  assert.ok(!body.includes("where:"), "must remain unfiltered (admin surfaces depend on it)");
  assert.ok(!body.includes("courseOfferingId"));
});

test("listPublishedWeeklyScheduleOptions is untouched: still published-only, still global", () => {
  const body = functionSource(weeklyScheduleSrc, "listPublishedWeeklyScheduleOptions");
  assert.match(body, /where: \{ isPublished: true \}/);
  assert.ok(!body.includes("courseOfferingId"));
});

test("the two legacy selection readers still delegate to the legacy list readers", () => {
  const legacy = functionSource(weeklyScheduleSrc, "getWeeklyScheduleSelection");
  const legacyStudent = functionSource(weeklyScheduleSrc, "getWeeklyScheduleSelectionForStudent");
  assert.match(legacy, /await listWeeklyScheduleOptions\(\)/);
  assert.match(legacyStudent, /await listPublishedWeeklyScheduleOptions\(\)/);
  for (const body of [legacy, legacyStudent]) {
    assert.ok(!body.includes("courseOfferingId"));
    assert.ok(!body.includes("getEffectiveCapabilities"));
    assert.match(body, /pickDefaultWeekId\(weeks, todayDateKey\(\)\)/);
  }
});

test("pickDefaultWeekId has ONE implementation, imported from the pure core", () => {
  assert.ok(
    !/function pickDefaultWeekId/.test(weeklyScheduleSrc),
    "weekly-schedule.ts must not keep a second, drifting copy",
  );
  assert.ok(
    !/function daysBetweenKeys/.test(weeklyScheduleSrc),
    "its helper moved with it",
  );
  assert.match(
    weeklyScheduleSrc,
    /import \{[\s\S]*?pickDefaultWeekId,[\s\S]*?\} from "@\/lib\/course\/course-scoped-week-options-core"/,
  );
});

// ===========================================================================
// StudentClient - the only UI change is the swapped week-picker call.
// ===========================================================================

test("StudentClient calls getWeeklyScheduleSelectionForTrainee() with no arguments", () => {
  assert.match(
    studentClientSrc,
    /import \{ getWeeklyScheduleSelectionForTrainee \} from "@\/lib\/actions\/weekly-schedule"/,
  );
  assert.match(studentClientSrc, /getWeeklyScheduleSelectionForTrainee\(\)\.then\(\(sel\) => \{/);
  assert.ok(
    !studentClientSrc.includes("getWeeklyScheduleSelectionForStudent"),
    "the trainee app must no longer use the globally-scoped picker",
  );
});

test("no course context is present anywhere in the trainee client", () => {
  for (const forbidden of ["courseOfferingId", "LEVEL_1_COURSE_OFFERING_ID", "LEVEL_2_COURSE_OFFERING_ID"]) {
    assert.ok(!studentClientSrc.includes(forbidden), `StudentClient must not reference "${forbidden}"`);
  }
});

test("the existing loading and empty-state behaviour is preserved", () => {
  // Same state assignments from the same result shape...
  assert.match(studentClientSrc, /setWeeks\(sel\.weeks\);/);
  assert.match(studentClientSrc, /setSelectedWeekId\(sel\.defaultWeekId\);/);
  assert.match(
    studentClientSrc,
    /const defaultWeek = sel\.weeks\.find\(\(w\) => w\.id === sel\.defaultWeekId\) \?\? null;/,
  );
  // ...and the `weeks === null` loading branches are untouched.
  assert.ok(
    (studentClientSrc.match(/weeks === null/g) ?? []).length >= 2,
    "the loading branches must be preserved",
  );
});

test("ScheduleSection's props are unchanged - no other student component signature moved", () => {
  assert.match(
    scheduleSectionSrc,
    /studentId: string;\s*weeklyScheduleId: string \| null;\s*dayFilter: string \| "all";/,
  );
  assert.ok(
    !scheduleSectionSrc.includes("courseOfferingId"),
    "ScheduleSection must not gain a course prop",
  );
  assert.match(
    scheduleSectionSrc,
    /getScheduleForStudent\(studentId, weeklyScheduleId, dayFilter, groupFilter\)/,
    "the four-argument call site is unchanged",
  );
});
