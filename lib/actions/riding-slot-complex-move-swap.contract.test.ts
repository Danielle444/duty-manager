// DB-free CONTRACT/source test for the Stage-3B Move/Swap server action. Runs no
// Prisma and opens no DB: it statically inspects the source of the action module
// (and the pure write-plan adapter) and asserts the invariants the approved
// Stage-3B contract requires - the transaction shape, lock ordering, single pure
// invocation, targeted (never full-replace) persistence, conditional single
// version increment, authorization tiers, the unexported private internal, and
// dormancy (no UI import). This guards against a future refactor silently
// breaking any of them.
//
// Run: npx tsx --test lib/actions/riding-slot-complex-move-swap.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Strip block + line comments so invariants are checked against real CODE only,
// never the (deliberately prose-y) contract comments. Neither source file
// contains `//` inside a string/regex literal, so this naive strip is safe.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const rawActionSrc = readFileSync(
  fileURLToPath(new URL("./riding-slot-complex-move-swap.ts", import.meta.url)),
  "utf8"
);
const actionSrc = stripComments(rawActionSrc);
const adapterSrc = stripComments(
  readFileSync(
    fileURLToPath(new URL("../riding-complex-schedule-board/move-swap-write-plan.ts", import.meta.url)),
    "utf8"
  )
);

function region(src: string, startMarker: string, endMarker: string | null): string {
  const start = src.indexOf(startMarker);
  assert.ok(start > -1, `start marker not found: ${startMarker}`);
  const end = endMarker ? src.indexOf(endMarker, start + startMarker.length) : src.length;
  assert.ok(end > start, `end marker not found: ${endMarker}`);
  return src.slice(start, end);
}

const internalRegion = () =>
  region(
    actionSrc,
    "async function applyComplexPlanMoveSwapInternal",
    "export async function applyComplexPlanMoveSwapAsAdmin"
  );
const adminRegion = () =>
  region(
    actionSrc,
    "export async function applyComplexPlanMoveSwapAsAdmin",
    "export async function applyComplexPlanMoveSwapAsInstructor"
  );
const instructorRegion = () =>
  region(actionSrc, "export async function applyComplexPlanMoveSwapAsInstructor", null);

// The tx callback body (from the `async (tx) =>` opener to the internal's end).
function txCallbackTail(): string {
  const r = internalRegion();
  const idx = r.indexOf("async (tx) =>");
  assert.ok(idx > -1, "tx callback opener not found");
  return r.slice(idx);
}

test("the private internal is NOT exported (no client-callable bypass)", () => {
  assert.ok(
    actionSrc.includes("async function applyComplexPlanMoveSwapInternal"),
    "internal must exist"
  );
  assert.ok(
    !/export\s+async\s+function\s+applyComplexPlanMoveSwapInternal/.test(actionSrc),
    "the private internal must never be exported from this 'use server' module"
  );
});

test("exactly two exported wrappers, both delegating to the one internal", () => {
  const exportedFns = actionSrc.match(/export\s+async\s+function\s+(\w+)/g) ?? [];
  assert.deepEqual(exportedFns.sort(), [
    "export async function applyComplexPlanMoveSwapAsAdmin",
    "export async function applyComplexPlanMoveSwapAsInstructor",
  ]);
  // Each wrapper delegates to the single internal.
  assert.ok(adminRegion().includes("applyComplexPlanMoveSwapInternal("));
  assert.ok(instructorRegion().includes("applyComplexPlanMoveSwapInternal("));
  // The internal is the ONLY place the pure core / transaction lives; both
  // wrappers `return applyComplexPlanMoveSwapInternal(...)` (the bare
  // `applyComplexPlanMoveSwapInternal(` also matches the definition, so scope to
  // the delegating call sites).
  const delegations = (actionSrc.match(/return applyComplexPlanMoveSwapInternal\(/g) ?? []).length;
  assert.equal(delegations, 2, "exactly the two wrappers delegate to the internal");
});

test("admin wrapper calls requireAdmin() BEFORE delegating", () => {
  const r = adminRegion();
  const requireIdx = r.indexOf("requireAdmin(");
  const delegateIdx = r.indexOf("applyComplexPlanMoveSwapInternal(");
  assert.ok(requireIdx > -1, "requireAdmin not called");
  assert.ok(delegateIdx > requireIdx, "requireAdmin must run before delegation");
});

test("instructor wrapper freshly re-reads Instructor and requires isActive + canEditRidingNotes", () => {
  const r = instructorRegion();
  assert.ok(r.includes("prisma.instructor.findUnique("), "must re-read the Instructor server-side");
  assert.ok(r.includes("isActive !== true"), "must require isActive === true");
  assert.ok(r.includes("canEditRidingNotes !== true"), "must require canEditRidingNotes === true");
  // The read + permission checks precede delegation.
  const readIdx = r.indexOf("prisma.instructor.findUnique(");
  const delegateIdx = r.indexOf("applyComplexPlanMoveSwapInternal(");
  assert.ok(delegateIdx > readIdx, "the permission read must run before delegation");
});

test("no wrapper accepts a client-supplied canEdit / permission flag", () => {
  assert.ok(!/canEdit\b/.test(actionSrc), "no client canEdit flag anywhere");
  // Signatures take only ids + command, never a boolean capability.
  assert.ok(/applyComplexPlanMoveSwapAsInstructor\(\s*instructorId: string,\s*ridingSlotId: string,\s*command: ComplexPlanMoveSwapCommand\s*\)/.test(actionSrc));
  assert.ok(/applyComplexPlanMoveSwapAsAdmin\(\s*ridingSlotId: string,\s*command: ComplexPlanMoveSwapCommand\s*\)/.test(actionSrc));
});

test("exactly one interactive transaction", () => {
  const txs = (actionSrc.match(/prisma\.\$transaction\(/g) ?? []).length;
  assert.equal(txs, 1, "exactly one prisma.$transaction");
});

test("the advisory lock is the FIRST in-transaction DB statement", () => {
  const tail = txCallbackTail();
  const lockIdx = tail.indexOf("pg_advisory_xact_lock");
  assert.ok(lockIdx > -1, "advisory lock missing");
  // Same key convention as the create writers.
  assert.ok(/pg_advisory_xact_lock\(hashtext\(\$\{normalizedSlotId\}\)\)/.test(tail));
  // No tx table access precedes the lock.
  const firstTableAccess = tail.search(/tx\.ridingSlotComplex/);
  assert.ok(firstTableAccess > -1, "expected a tx table access");
  assert.ok(lockIdx < firstTableAccess, "the advisory lock must precede any tx table read/write");
});

test("the complete plan re-read happens AFTER the lock, via tx, scoped by ridingSlotId", () => {
  const tail = txCallbackTail();
  const lockIdx = tail.indexOf("pg_advisory_xact_lock");
  const readIdx = tail.indexOf("tx.ridingSlotComplexPlan.findUnique(");
  assert.ok(readIdx > lockIdx, "plan re-read must come after the lock");
  assert.ok(/where:\s*\{\s*ridingSlotId:\s*normalizedSlotId\s*\}/.test(tail), "read scoped by exact ridingSlotId");
});

test("the pure core is invoked EXACTLY once", () => {
  const calls = (actionSrc.match(/applyComplexPlanMoveSwap\(/g) ?? []).length;
  assert.equal(calls, 1, "applyComplexPlanMoveSwap must be called exactly once");
});

test("no global prisma client is used inside the tx callback", () => {
  const tail = txCallbackTail();
  // lowercase `prisma.` = the global client; `tx.` is the injected client.
  assert.ok(!/\bprisma\./.test(tail), "no global prisma may be used inside the tx callback");
});

test("the version increment is conditional on the just-read version and happens exactly once", () => {
  const increments = (actionSrc.match(/version:\s*\{\s*increment:\s*1\s*\}/g) ?? []).length;
  assert.equal(increments, 1, "exactly one version increment");
  const tail = txCallbackTail();
  assert.ok(
    /updateMany\(\{\s*where:\s*\{\s*id:\s*planRow\.id,\s*version:\s*planRow\.version\s*\}/.test(tail),
    "the version bump must be a conditional updateMany guarded by the just-read version"
  );
  // The increment must come AFTER the pure core call and AFTER the write loops.
  const pureIdx = tail.indexOf("applyComplexPlanMoveSwap(");
  const buildIdx = tail.indexOf("buildComplexPlanWritePlan(");
  const incrementIdx = tail.search(/version:\s*\{\s*increment:\s*1\s*\}/);
  assert.ok(pureIdx > -1 && buildIdx > pureIdx, "write plan built after the pure core");
  assert.ok(incrementIdx > buildIdx, "the version bump must come after the write plan is applied");
});

test("a zero-row conditional update rolls back (no silent overwrite)", () => {
  const tail = txCallbackTail();
  assert.ok(/bumped\.count === 0/.test(tail), "must detect a zero-row conditional update");
  assert.ok(/throw new MoveSwapRollback\("STALE_PLAN"\)/.test(tail), "zero rows must throw to roll back");
});

test("persistence is TARGETED only - never a full-replace delete/createMany", () => {
  for (const forbidden of [".deleteMany(", ".createMany(", ".delete("]) {
    assert.ok(!actionSrc.includes(forbidden), `action must not use ${forbidden} (no delete/recreate)`);
  }
  // The only writes are the four targeted update kinds derived from the adapter.
  assert.ok(actionSrc.includes("buildComplexPlanWritePlan("), "must derive writes from the pure adapter");
  assert.ok(actionSrc.includes("tx.ridingSlotComplexPair.update("), "pair updates are targeted .update()");
  assert.ok(actionSrc.includes("tx.ridingSlotComplexStation.update("), "station updates are targeted .update()");
});

test("nextPlan.version is never persisted verbatim", () => {
  // The persisted new version is derived by increment, never assigned from
  // nextPlan.version / pure.nextPlan.version.
  assert.ok(!/version:\s*\w*nextPlan\.version/.test(actionSrc), "must not persist nextPlan.version as the new value");
});

test("the action module imports no UI / React / component code (dormant, server-only)", () => {
  const imports = rawActionSrc.match(/from\s+["'][^"']+["']/g) ?? [];
  for (const imp of imports) {
    assert.ok(!/react/i.test(imp), `unexpected React import: ${imp}`);
    assert.ok(!/components?/i.test(imp), `unexpected component import: ${imp}`);
    assert.ok(!/\.tsx/i.test(imp), `unexpected .tsx import: ${imp}`);
  }
  // It is a server module.
  assert.ok(/^\s*["']use server["'];/.test(rawActionSrc), "must be a 'use server' module");
});

test("only existing relevant paths are revalidated; no publish side effect", () => {
  const paths = (actionSrc.match(/revalidatePath\("([^"]+)"\)/g) ?? []).sort();
  assert.deepEqual(paths, ['revalidatePath("/admin/weekly-schedule")', 'revalidatePath("/instructor")']);
  assert.ok(!/[Pp]ublication/.test(actionSrc), "no publication model is touched");
  assert.ok(!/\.publish/i.test(actionSrc), "no publish side effect");
});

test("lock timeout maps to the existing LOCK_TIMEOUT convention", () => {
  assert.ok(/code === "P2028"/.test(actionSrc), "P2028 must be handled");
  assert.ok(/reason:\s*"LOCK_TIMEOUT"/.test(actionSrc), "P2028 maps to LOCK_TIMEOUT");
});

// ----- Adapter invariants (the pure write-plan scope contract) -----

test("adapter uses affected.stationIds (not only affected.pairIds) for pair move/swap", () => {
  const pairBranch = region(adapterSrc, 'case "MOVE_PAIR":', "default:");
  assert.ok(pairBranch.includes("affected.stationIds"), "pair move/swap must iterate affected.stationIds");
  assert.ok(pairBranch.includes("station.pairs"), "it must reproduce every pair in those stations");
});

test("adapter emits no delete/recreate and preserves pair ids", () => {
  assert.ok(!/delete|createMany/i.test(adapterSrc), "adapter is pure - no delete/recreate vocabulary");
  const pairBranch = region(adapterSrc, 'case "MOVE_PAIR":', "default:");
  assert.ok(pairBranch.includes("pairId: pair.id"), "placement updates preserve the stable pair id");
});
