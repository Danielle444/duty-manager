// DB-free CONTRACT/source test for the Stage-3B.1 optimistic-concurrency
// hardening of the EXISTING structural complex-plan writers in
// lib/actions/riding-slot-complex.ts. It runs no Prisma and opens no DB: it
// statically inspects the action module's source and asserts the invariants the
// approved Stage-3B.1 contract requires, so a future refactor cannot silently
// re-introduce the unconditional last-write-wins behavior this stage removed.
//
// Scope: the SEVEN hardened structural writers (save block, save station,
// delete station, reorder stations, delete block, duplicate block, reorder
// blocks), their shared withLockedComplexPlan helper, the two mutating input
// schemas, the fourteen admin/instructor wrappers, and the deliberately
// version-less-but-now-serialized whole-plan delete. Plan creation and
// publish/unpublish are intentionally out of scope (see the contract).
//
// Run: npx tsx --test lib/actions/riding-slot-complex-hardening.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Strip block + line comments so invariants are checked against real CODE only,
// never the (deliberately prose-y) contract comments. This file contains no
// `//` inside a string/regex literal, so this naive strip is safe.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const rawSrc = readFileSync(fileURLToPath(new URL("./riding-slot-complex.ts", import.meta.url)), "utf8");
const src = stripComments(rawSrc);

// Extract [startMarker, endMarker) from the stripped source.
function region(startMarker: string, endMarker: string | null): string {
  const start = src.indexOf(startMarker);
  assert.ok(start > -1, `start marker not found: ${startMarker}`);
  const end = endMarker ? src.indexOf(endMarker, start + startMarker.length) : src.length;
  assert.ok(end > start, `end marker not found: ${endMarker}`);
  return src.slice(start, end);
}

// The seven hardened structural writers, each keyed by its internal function
// name and the marker that begins the NEXT top-level declaration (so the region
// covers exactly that writer's internal body + nothing else).
const HARDENED_WRITERS: { name: string; internal: string; next: string }[] = [
  { name: "save block", internal: "async function saveComplexBlockInternal", next: "export async function saveRidingSlotComplexBlockAsAdmin" },
  { name: "save station", internal: "async function saveComplexStationInternal", next: "export async function saveRidingSlotComplexStationAsAdmin" },
  { name: "delete station", internal: "async function deleteComplexStationInternal", next: "export async function deleteRidingSlotComplexStationAsAdmin" },
  { name: "reorder stations", internal: "async function reorderComplexStationsInternal", next: "export async function reorderRidingSlotComplexStationsAsAdmin" },
  { name: "delete block", internal: "async function deleteComplexBlockInternal", next: "export async function deleteRidingSlotComplexBlockAsAdmin" },
  { name: "duplicate block", internal: "async function duplicateComplexBlockInternal", next: "export async function duplicateRidingSlotComplexBlockAsAdmin" },
  { name: "reorder blocks", internal: "async function reorderComplexBlocksInternal", next: "export async function reorderRidingSlotComplexBlocksAsAdmin" },
];

function writerRegion(w: { internal: string; next: string }): string {
  return region(w.internal, w.next);
}

// The shared helper's body (the ONE place the lock/read/version/increment
// lives).
const helperRegion = () => region("async function withLockedComplexPlan", "async function saveComplexBlockInternal");

// -------------------------------------------------------------------------
// The shared concurrency helper
// -------------------------------------------------------------------------

test("withLockedComplexPlan is module-private (never exported - no client bypass)", () => {
  assert.ok(src.includes("async function withLockedComplexPlan"), "the helper must exist");
  assert.ok(
    !/export\s+(async\s+)?function\s+withLockedComplexPlan/.test(src),
    "the concurrency helper must never be exported from this 'use server' module"
  );
  // Neither may the rollback sentinel escape.
  assert.ok(!/export\s+class\s+StalePlanRollback/.test(src), "StalePlanRollback must stay module-private");
});

test("the advisory lock is the FIRST in-transaction DB statement, keyed by ridingSlotId", () => {
  const h = helperRegion();
  const txIdx = h.indexOf("prisma.$transaction(");
  assert.ok(txIdx > -1, "the helper opens one interactive transaction");
  const lockIdx = h.indexOf("pg_advisory_xact_lock");
  assert.ok(lockIdx > txIdx, "the advisory lock is inside the transaction");
  assert.ok(
    /pg_advisory_xact_lock\(hashtext\(\$\{ridingSlotId\}\)\)/.test(h),
    "same hashtext(ridingSlotId) key convention as Stage 3B"
  );
  // No tx table access precedes the lock.
  const firstTable = h.search(/tx\.ridingSlotComplex/);
  assert.ok(firstTable > -1 && lockIdx < firstTable, "no tx table read/write precedes the advisory lock");
});

test("the plan is re-read AFTER the lock, via tx, scoped by exact ridingSlotId", () => {
  const h = helperRegion();
  const lockIdx = h.indexOf("pg_advisory_xact_lock");
  const readIdx = h.indexOf("tx.ridingSlotComplexPlan.findUnique(");
  assert.ok(readIdx > lockIdx, "plan re-read must come after the lock");
  assert.ok(/where:\s*\{\s*ridingSlotId\s*\}/.test(h), "the re-read is scoped by exact ridingSlotId");
});

test("a missing plan maps to the not-found contract; a version mismatch maps to STALE before any mutation", () => {
  const h = helperRegion();
  assert.ok(/if\s*\(!plan\)/.test(h), "missing plan is handled");
  assert.ok(h.includes("error: NOT_FOUND_COMPLEX_PLAN"), "missing plan uses the existing not-found copy");
  // The version check comes AFTER the read and BEFORE the body call.
  const readIdx = h.indexOf("tx.ridingSlotComplexPlan.findUnique(");
  const versionCheckIdx = h.search(/plan\.version\s*!==\s*expectedVersion/);
  const bodyIdx = h.indexOf("await body(tx, plan.id)");
  assert.ok(versionCheckIdx > readIdx, "the version check comes after the plan re-read");
  assert.ok(bodyIdx > versionCheckIdx, "the version check comes before the writer body runs");
  assert.ok(/error:\s*STALE_PLAN,\s*staleConflict:\s*true/.test(h), "a mismatch returns the stable STALE_PLAN + staleConflict");
});

test("exactly ONE conditional version increment in the whole module, guarded by expectedVersion", () => {
  const increments = (src.match(/version:\s*\{\s*increment:\s*1\s*\}/g) ?? []).length;
  assert.equal(increments, 1, "exactly one version increment across the module - no unconditional bump remains");
  const h = helperRegion();
  assert.ok(
    /updateMany\(\{\s*where:\s*\{\s*id:\s*plan\.id,\s*version:\s*expectedVersion\s*\}/.test(h),
    "the increment is a conditional updateMany guarded by (id + the just-read expectedVersion)"
  );
});

test("a zero-row conditional claim throws to roll back the body's writes (no silent overwrite)", () => {
  const h = helperRegion();
  assert.ok(/bumped\.count === 0/.test(h), "a zero-row claim is detected");
  assert.ok(/throw new StalePlanRollback\(\)/.test(h), "a zero-row claim throws the rollback sentinel");
  // The thrown sentinel is caught and mapped to the stable STALE outcome.
  assert.ok(/err instanceof StalePlanRollback/.test(h), "the sentinel is caught");
  assert.ok(/prismaErrorCode\(err\)\s*===\s*"P2028"/.test(h), "a lock timeout maps to LOCK_TIMEOUT");
});

test("no global prisma client is used inside the helper's transaction callback", () => {
  const h = helperRegion();
  const cbIdx = h.indexOf("async (tx) =>");
  assert.ok(cbIdx > -1, "the tx callback exists");
  // Everything from the callback opener up to the outer catch is tx-only.
  const catchIdx = h.indexOf("} catch (err) {");
  const callback = h.slice(cbIdx, catchIdx > cbIdx ? catchIdx : undefined);
  assert.ok(!/[^a-zA-Z]prisma\./.test(callback), "no global prisma may be used inside the tx callback");
});

// -------------------------------------------------------------------------
// Every hardened writer routes through the shared helper (no bespoke tx)
// -------------------------------------------------------------------------

test("all seven hardened writers delegate to withLockedComplexPlan and open no bespoke transaction", () => {
  for (const w of HARDENED_WRITERS) {
    const r = writerRegion(w);
    assert.ok(r.includes("withLockedComplexPlan("), `${w.name}: must delegate to the shared helper`);
    assert.ok(!r.includes("prisma.$transaction("), `${w.name}: must NOT open its own transaction`);
  }
});

test("every hardened writer body reads/writes ONLY via tx (no global prisma, no pre-lock lookup)", () => {
  for (const w of HARDENED_WRITERS) {
    const r = writerRegion(w);
    assert.ok(!/[^a-zA-Z]prisma\./.test(r), `${w.name}: the internal writer must not touch the global prisma client`);
    // The lock/read live in the helper, so the writer itself must not take a
    // second lock or re-read the plan by ridingSlotId outside the helper.
    assert.ok(!r.includes("pg_advisory_xact_lock"), `${w.name}: only the shared helper takes the lock`);
  }
});

test("only the shared helper and the two excluded actions open a transaction", () => {
  // withLockedComplexPlan (1) + createComplexPlanInternal (1, excluded: create)
  // + deleteRidingSlotComplexPlanAsAdmin (1, excluded: whole-plan delete) = 3.
  const txs = (src.match(/prisma\.\$transaction\(/g) ?? []).length;
  assert.equal(txs, 3, "exactly three transactions: the shared helper + create + whole-plan delete");
});

// -------------------------------------------------------------------------
// Required inputs: ridingSlotId + expectedVersion
// -------------------------------------------------------------------------

test("both mutating input schemas REQUIRE an integer expectedVersion (never optional/defaulted)", () => {
  for (const schema of ["blockSaveInputSchema", "stationSaveInputSchema"]) {
    const r = region(`const ${schema} = z.object({`, "});");
    assert.ok(/ridingSlotId:\s*z\.string\(\)\.min\(1\)/.test(r), `${schema}: ridingSlotId required`);
    assert.ok(/expectedVersion:\s*z\.number\(\)\.int\(\)/.test(r), `${schema}: expectedVersion is a required int`);
    assert.ok(!/expectedVersion[^,\n]*\.optional\(\)/.test(r), `${schema}: expectedVersion must not be optional`);
    assert.ok(!/expectedVersion[^,\n]*\.default\(/.test(r), `${schema}: expectedVersion must never be server-defaulted`);
  }
});

test("the delete/reorder/duplicate wrappers take expectedVersion in their signature", () => {
  const signatures = [
    "deleteRidingSlotComplexStationAsAdmin",
    "deleteRidingSlotComplexStationAsInstructor",
    "reorderRidingSlotComplexStationsAsAdmin",
    "reorderRidingSlotComplexStationsAsInstructor",
    "deleteRidingSlotComplexBlockAsAdmin",
    "deleteRidingSlotComplexBlockAsInstructor",
    "duplicateRidingSlotComplexBlockAsAdmin",
    "duplicateRidingSlotComplexBlockAsInstructor",
    "reorderRidingSlotComplexBlocksAsAdmin",
    "reorderRidingSlotComplexBlocksAsInstructor",
  ];
  for (const fn of signatures) {
    const r = region(`export async function ${fn}(`, ")");
    assert.ok(/expectedVersion:\s*number/.test(r), `${fn}: must accept expectedVersion: number`);
  }
});

// -------------------------------------------------------------------------
// Authorization preserved exactly (unchanged from the pre-hardening contract)
// -------------------------------------------------------------------------

test("every admin wrapper still calls requireAdmin(); every instructor wrapper still re-reads + gates the Instructor", () => {
  const adminWrappers = [
    "saveRidingSlotComplexBlockAsAdmin",
    "saveRidingSlotComplexStationAsAdmin",
    "deleteRidingSlotComplexStationAsAdmin",
    "reorderRidingSlotComplexStationsAsAdmin",
    "deleteRidingSlotComplexBlockAsAdmin",
    "duplicateRidingSlotComplexBlockAsAdmin",
    "reorderRidingSlotComplexBlocksAsAdmin",
  ];
  for (const fn of adminWrappers) {
    const r = region(`export async function ${fn}(`, "export async function");
    assert.ok(r.includes("requireAdmin("), `${fn}: must call requireAdmin()`);
  }

  const instructorWrappers = [
    "saveRidingSlotComplexBlockAsInstructor",
    "saveRidingSlotComplexStationAsInstructor",
    "deleteRidingSlotComplexStationAsInstructor",
    "reorderRidingSlotComplexStationsAsInstructor",
    "deleteRidingSlotComplexBlockAsInstructor",
    "duplicateRidingSlotComplexBlockAsInstructor",
    "reorderRidingSlotComplexBlocksAsInstructor",
  ];
  for (const fn of instructorWrappers) {
    // Region runs to the next `export async function` (or end for the last one).
    const start = src.indexOf(`export async function ${fn}(`);
    assert.ok(start > -1, `${fn} not found`);
    const nextExport = src.indexOf("export async function", start + 1);
    const r = src.slice(start, nextExport > start ? nextExport : undefined);
    assert.ok(r.includes("prisma.instructor.findUnique("), `${fn}: must re-read the Instructor server-side`);
    assert.ok(
      /!instructor\.isActive/.test(r) && /!instructor\.canEditRidingNotes/.test(r),
      `${fn}: must require isActive && canEditRidingNotes`
    );
  }
});

test("no wrapper or writer trusts a client-supplied permission/canEdit flag", () => {
  // `canEdit` legitimately appears server-side in the READ path
  // (buildComplexPlanForEditing({ canEdit: true }), computed from the
  // re-read instructor's canEditRidingNotes) - what must never happen is a
  // client-supplied canEdit reaching a writer. Assert it is never read off an
  // input/payload and never appears in a mutating input schema.
  assert.ok(!/\b(input|data|args|payload)\.canEdit\b/.test(src), "no writer may read a client-supplied canEdit");
  for (const schema of ["blockSaveInputSchema", "stationSaveInputSchema"]) {
    const r = region(`const ${schema} = z.object({`, "});");
    assert.ok(!/canEdit/.test(r), `${schema}: must not accept a client canEdit field`);
  }
});

// -------------------------------------------------------------------------
// Whole-plan delete: serialized (lock) but deliberately NOT version-gated
// -------------------------------------------------------------------------

test("whole-plan delete is admin-only, now takes the advisory lock, and has NO version gate", () => {
  const r = region("export async function deleteRidingSlotComplexPlanAsAdmin(", null);
  assert.ok(r.includes("requireAdmin("), "still admin-only");
  assert.ok(/pg_advisory_xact_lock\(hashtext\(\$\{ridingSlotId\}\)\)/.test(r), "now serialized under the same per-slot lock");
  assert.ok(!/expectedVersion/.test(r), "must NOT gain an expectedVersion gate (delete-whatever-exists semantics)");
  assert.ok(!/version:\s*\{\s*increment/.test(r), "must NOT bump the version");
  assert.ok(r.includes(".delete({"), "still performs the destructive delete");
});

// -------------------------------------------------------------------------
// Response-shape / non-PII outcome signal
// -------------------------------------------------------------------------

test("STALE_PLAN copy is a single stable non-PII constant carried via staleConflict", () => {
  assert.ok(/const STALE_PLAN =/.test(src), "a single STALE_PLAN copy constant exists");
  // The generic copy must not interpolate any id/name/version.
  const line = rawSrc.split("\n").find((l) => l.includes("const STALE_PLAN ="));
  assert.ok(line && !/\$\{/.test(line), "the STALE_PLAN message interpolates nothing (no PII, no version number)");
  assert.ok(/staleConflict\?:\s*boolean/.test(src), "the result type exposes an optional staleConflict signal");
});

test("the action module imports no UI / React / component code (server-only)", () => {
  const imports = rawSrc.match(/from\s+["'][^"']+["']/g) ?? [];
  for (const imp of imports) {
    assert.ok(!/react/i.test(imp), `unexpected React import: ${imp}`);
    assert.ok(!/\.tsx/i.test(imp), `unexpected .tsx import: ${imp}`);
  }
  assert.ok(/^\s*["']use server["'];/.test(rawSrc), "must be a 'use server' module");
});
