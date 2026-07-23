/**
 * Schedule Auth Slice 0 - focused authorization-order contract tests for the
 * four schedule / day-plan Server Actions that the read-only audit found
 * UNGUARDED:
 *
 *   - commitWeeklySchedule      (lib/actions/weekly-schedule.ts)
 *   - deleteWeeklySchedule      (lib/actions/weekly-schedule.ts)
 *   - confirmDayPlanSuggestions (lib/actions/weekly-schedule.ts)
 *   - setCourseDayPlan          (lib/actions/course-day-plan.ts)
 *
 * These are "use server" modules that transitively import Prisma + next-auth +
 * next/cache, so they cannot be imported into a plain `tsx --test` process the
 * way a pure DI orchestration can. This uses the repository's established
 * SOURCE-CONTRACT test pattern (same convention as
 * attendance-write-auth.test.ts / riding-slots-write-auth.test.ts's source
 * assertions) to lock the fix behaviorally-equivalent guarantees:
 *
 *  - each function calls `await requireAdmin()` and it is the FIRST awaited
 *    statement in the body - so no Prisma read, no Prisma write (update /
 *    deleteMany / createMany / delete / upsert), no revalidatePath, and no
 *    delegation to another write service can run before the admin gate;
 *  - because requireAdmin() fails closed (it redirect()s -> throws on a missing
 *    or non-admin session), "first awaited statement" is a language-level proof
 *    that a denial prevents every subsequent read/write/revalidation;
 *  - confirmDayPlanSuggestions and setCourseDayPlan are EACH independently
 *    gated (defense in depth) - neither relies on the other or on a page/layout
 *    guard;
 *  - the fix adds authorization ONLY: no offering / lifecycle / capability /
 *    CourseOffering logic was introduced into these bodies.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/schedule-writer-auth.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const weeklyScheduleSrc = readFileSync(
  fileURLToPath(new URL("./weekly-schedule.ts", import.meta.url)),
  "utf8",
);
const courseDayPlanSrc = readFileSync(
  fileURLToPath(new URL("./course-day-plan.ts", import.meta.url)),
  "utf8",
);

// Extract a single function's source: from its `export async function NAME(`
// signature up to the next top-level `export ` boundary (or end of file). That
// window is exactly the body we reason about for ordering.
function functionSource(src: string, name: string): string {
  const sigMarker = `export async function ${name}(`;
  const start = src.indexOf(sigMarker);
  assert.notEqual(start, -1, `expected to find ${name} in source`);
  const afterSig = start + sigMarker.length;
  const nextExport = src.indexOf("\nexport ", afterSig);
  return nextExport === -1 ? src.slice(start) : src.slice(start, nextExport);
}

// Index of the first `await requireAdmin(` in a body.
function requireAdminIdx(body: string): number {
  const i = body.indexOf("await requireAdmin(");
  assert.notEqual(i, -1, "expected an `await requireAdmin(` call");
  return i;
}

// Assert the admin gate is the FIRST awaited statement, and precedes every
// Prisma access, revalidation, and (optionally) delegation token present in the
// body. A token absent from the body is not required to appear after the gate.
function assertGateFirst(
  fnLabel: string,
  body: string,
  { delegationToken }: { delegationToken?: string } = {},
) {
  assert.match(body, /await requireAdmin\(\)/, `${fnLabel}: must call await requireAdmin()`);

  const gate = requireAdminIdx(body);

  // The gate is the first awaited call in the whole body: nothing is awaited
  // before authorization.
  const firstAwait = body.indexOf("await ");
  assert.equal(
    firstAwait,
    gate,
    `${fnLabel}: await requireAdmin() must be the first awaited statement (nothing awaited before the gate)`,
  );

  // No Prisma access before the gate (reads or writes).
  const firstPrisma = body.indexOf("prisma.");
  if (firstPrisma !== -1) {
    assert.ok(
      gate < firstPrisma,
      `${fnLabel}: requireAdmin() must precede every prisma.* access`,
    );
  }

  // No revalidation before the gate.
  const firstRevalidate = body.indexOf("revalidatePath(");
  if (firstRevalidate !== -1) {
    assert.ok(
      gate < firstRevalidate,
      `${fnLabel}: requireAdmin() must precede revalidatePath()`,
    );
  }

  // No delegation to another write service before the gate.
  if (delegationToken) {
    const firstDelegate = body.indexOf(delegationToken);
    assert.ok(
      firstDelegate !== -1 && gate < firstDelegate,
      `${fnLabel}: requireAdmin() must precede delegation to ${delegationToken}`,
    );
  }
}

// The fix adds authorization only - it must not smuggle in offering / lifecycle
// / capability wiring (those are explicitly later, separate slices).
function assertNoOfferingOrLifecycleLogic(fnLabel: string, body: string) {
  for (const forbidden of [
    "courseOfferingId",
    "CourseOffering",
    "assertCourseOperationAllowed",
    "operation-policy",
    "getEffectiveCapabilities",
    "capability",
    "SCHEDULE_DRAFT_CONFIGURATION",
    "SCHEDULE_PUBLICATION",
  ]) {
    assert.ok(
      !body.includes(forbidden),
      `${fnLabel}: this auth-only slice must not introduce "${forbidden}"`,
    );
  }
}

// ===========================================================================
// Import wiring - the existing helper is used, no new auth helper was created.
// ===========================================================================

test("both modules import the existing requireAdmin helper (no new auth helper)", () => {
  const importRe = /import\s*\{\s*requireAdmin\s*\}\s*from\s*["']@\/lib\/auth\/require-admin["']/;
  assert.match(weeklyScheduleSrc, importRe, "weekly-schedule.ts imports requireAdmin from @/lib/auth/require-admin");
  assert.match(courseDayPlanSrc, importRe, "course-day-plan.ts imports requireAdmin from @/lib/auth/require-admin");
});

// ===========================================================================
// commitWeeklySchedule - create + destructive item replace by client week id.
// ===========================================================================

test("commitWeeklySchedule gates before validation, any prisma read/write, and revalidation", () => {
  const body = functionSource(weeklyScheduleSrc, "commitWeeklySchedule");
  assertGateFirst("commitWeeklySchedule", body);

  const gate = requireAdminIdx(body);
  // Prove the gate precedes each specific destructive step the audit flagged.
  for (const step of [
    "prisma.weeklySchedule.update",
    "prisma.scheduleItem.deleteMany",
    "prisma.weeklySchedule.create",
    "prisma.scheduleItem.createMany",
  ]) {
    const idx = body.indexOf(step);
    assert.ok(idx !== -1, `commitWeeklySchedule: expected step ${step} to still exist (semantics unchanged)`);
    assert.ok(gate < idx, `commitWeeklySchedule: requireAdmin() must precede ${step}`);
  }
  // The gate also precedes the input validation branch (no client-driven work
  // - not even the early validation return - happens before authorization).
  const validation = body.indexOf("if (!input.name.trim()");
  assert.ok(validation !== -1 && gate < validation, "commitWeeklySchedule: gate precedes input validation");

  assertNoOfferingOrLifecycleLogic("commitWeeklySchedule", body);
});

// ===========================================================================
// deleteWeeklySchedule - delete + cascade.
// ===========================================================================

test("deleteWeeklySchedule gates before the cascading delete and revalidation", () => {
  const body = functionSource(weeklyScheduleSrc, "deleteWeeklySchedule");
  assertGateFirst("deleteWeeklySchedule", body);

  const gate = requireAdminIdx(body);
  const del = body.indexOf("prisma.weeklySchedule.delete");
  assert.ok(del !== -1, "deleteWeeklySchedule: the delete must still exist (semantics unchanged)");
  assert.ok(gate < del, "deleteWeeklySchedule: requireAdmin() must precede the cascade-triggering delete");

  assertNoOfferingOrLifecycleLogic("deleteWeeklySchedule", body);
});

// ===========================================================================
// confirmDayPlanSuggestions - owns its own gate before delegating.
// ===========================================================================

test("confirmDayPlanSuggestions owns its own gate before delegating to setCourseDayPlan", () => {
  const body = functionSource(weeklyScheduleSrc, "confirmDayPlanSuggestions");
  assertGateFirst("confirmDayPlanSuggestions", body, { delegationToken: "setCourseDayPlan(" });

  const gate = requireAdminIdx(body);
  const loop = body.indexOf("for (const s of selections)");
  assert.ok(loop !== -1 && gate < loop, "confirmDayPlanSuggestions: gate precedes the delegation loop");

  assertNoOfferingOrLifecycleLogic("confirmDayPlanSuggestions", body);
});

// ===========================================================================
// setCourseDayPlan - independently invocable, owns its own gate.
// ===========================================================================

test("setCourseDayPlan owns its own gate before any prisma upsert or revalidation", () => {
  const body = functionSource(courseDayPlanSrc, "setCourseDayPlan");
  assertGateFirst("setCourseDayPlan", body);

  const gate = requireAdminIdx(body);
  const upsert = body.indexOf("prisma.courseDayPlan.upsert");
  assert.ok(upsert !== -1, "setCourseDayPlan: the upsert must still exist (semantics unchanged)");
  assert.ok(gate < upsert, "setCourseDayPlan: requireAdmin() must precede the upsert");

  assertNoOfferingOrLifecycleLogic("setCourseDayPlan", body);
});

// ===========================================================================
// Defense in depth - the two day-plan write paths are each independently gated.
// ===========================================================================

test("both day-plan write paths are independently gated (no reliance on the other)", () => {
  const confirm = functionSource(weeklyScheduleSrc, "confirmDayPlanSuggestions");
  const setPlan = functionSource(courseDayPlanSrc, "setCourseDayPlan");
  assert.match(confirm, /await requireAdmin\(\)/, "confirmDayPlanSuggestions has its own gate");
  assert.match(setPlan, /await requireAdmin\(\)/, "setCourseDayPlan has its own gate");
});

// ===========================================================================
// No auth/session/cookie architecture change - only the existing helper is used.
// ===========================================================================

test("no auth/session/cookie architecture change: modules do not touch cookies or the auth() session directly", () => {
  for (const [label, src] of [
    ["weekly-schedule.ts", weeklyScheduleSrc],
    ["course-day-plan.ts", courseDayPlanSrc],
  ] as const) {
    assert.ok(!/from ["']next\/headers["']/.test(src), `${label}: must not import next/headers (cookies)`);
    assert.ok(!/from ["']@\/auth["']/.test(src), `${label}: must not import the auth() session directly`);
  }
});
