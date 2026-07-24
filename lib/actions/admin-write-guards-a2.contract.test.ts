// ADMIN-WRITE-A2 - DB-free CONTRACT/source test for the admin authorization
// guards added to the eight remaining unguarded admin-configuration write
// actions:
//
//   lib/actions/duties.ts         createDutyType
//                                 updateDutyType
//                                 setDutyTypeActive
//   lib/actions/constraints.ts    createDutyConstraint
//                                 setDutyConstraintActive
//                                 deleteDutyConstraint
//   lib/actions/no-duty-dates.ts  markNoDutyDate
//                                 unmarkNoDutyDate
//
// This is the sibling slice of admin-write-guards-a1.contract.test.ts, which
// owns the five actions guarded by A1 (course settings, availability presets,
// course booklet). A1 and A2 assertions stay in separate files so ownership of
// each action is unambiguous; this file must never weaken A1.
//
// Each action above is directly reachable as a Server Action endpoint, so
// page-level gating on /admin/* is NOT their authorization boundary. This test
// statically inspects the action sources and asserts the invariants the
// security slice requires:
//
//   - `await requireAdmin()` is the FIRST awaited operation in every action;
//   - nothing that validates, parses, reads, writes, deletes or revalidates
//     runs before it, so an unauthorized caller performs zero Prisma reads,
//     zero Prisma writes and zero revalidatePath calls, and learns nothing
//     about the existence of a duty type id, a constraint id, or a date;
//   - the guard comes from the canonical shared helper, not a locally
//     reimplemented session/cookie/role check, and that helper is unchanged;
//   - the public signatures are unchanged (same parameter count and types), so
//     the authorized admin call sites keep working;
//   - the authorized path still falls through to the original implementation
//     (the original mutations are all still present, after the guard);
//   - no unrelated export in these modules gained or lost a guard - in
//     particular the read-only getNoDutyStatusForRange is out of A2's scope and
//     is left exactly as it was.
//
// Run: npx tsx --test lib/actions/admin-write-guards-a2.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Strip block and line comments so every invariant below is checked against real
// CODE only, never the (deliberately prose-y) contract comments - which
// legitimately name prisma, requireAdmin, etc. None of the inspected modules
// contains `//` inside a string or regex literal, so this naive strip is safe
// here.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function load(relativePath: string): string {
  return stripComments(read(relativePath));
}

const SOURCES = {
  "duties.ts": load("./duties.ts"),
  "constraints.ts": load("./constraints.ts"),
  "no-duty-dates.ts": load("./no-duty-dates.ts"),
} as const;

type ModuleName = keyof typeof SOURCES;

// Slice one top-level exported function out of a source file: from its `export async
// function NAME(` declaration up to the next top-level `export`/`const`
// declaration, or the end of file. Asserts the declaration exists.
function fnBody(mod: ModuleName, name: string): string {
  const src = SOURCES[mod];
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start > -1, `${mod}: export async function ${name}( not found`);
  const rest = src.slice(start + 1);
  const nextTop = rest.search(/\nexport\s|\nconst\s/);
  return nextTop === -1 ? src.slice(start) : rest.slice(0, nextTop);
}

// Every action guarded by this slice, with the side effects that must NOT be
// reachable before its guard.
const GUARDED: ReadonlyArray<{
  mod: ModuleName;
  action: string;
  // Exact source-level signature the slice must preserve.
  signature: RegExp;
  // Markers that must all appear AFTER the guard (they are the action's real
  // work: validation, date parsing, writes, cache revalidation).
  after: readonly string[];
}> = [
  {
    mod: "duties.ts",
    action: "createDutyType",
    signature: /createDutyType\(\s*formData:\s*FormData\s*\):\s*Promise<ActionResult>/,
    after: ["dutyTypeSchema.safeParse(", "prisma.dutyType.create(", "revalidatePath("],
  },
  {
    mod: "duties.ts",
    action: "updateDutyType",
    signature:
      /updateDutyType\(\s*dutyTypeId:\s*string,\s*formData:\s*FormData\s*\):\s*Promise<ActionResult>/,
    after: ["dutyTypeSchema.safeParse(", "prisma.dutyType.update(", "revalidatePath("],
  },
  {
    mod: "duties.ts",
    action: "setDutyTypeActive",
    signature:
      /setDutyTypeActive\(\s*dutyTypeId:\s*string,\s*isActive:\s*boolean\s*\):\s*Promise<ActionResult>/,
    after: ["prisma.dutyType.update(", "revalidatePath("],
  },
  {
    mod: "constraints.ts",
    action: "createDutyConstraint",
    signature: /createDutyConstraint\(\s*formData:\s*FormData\s*\):\s*Promise<ActionResult>/,
    after: ["constraintSchema.safeParse(", "prisma.dutyConstraint.create(", "revalidatePath("],
  },
  {
    mod: "constraints.ts",
    action: "setDutyConstraintActive",
    signature:
      /setDutyConstraintActive\(\s*constraintId:\s*string,\s*isActive:\s*boolean\s*\):\s*Promise<ActionResult>/,
    after: ["prisma.dutyConstraint.update(", "revalidatePath("],
  },
  {
    mod: "constraints.ts",
    action: "deleteDutyConstraint",
    signature: /deleteDutyConstraint\(\s*constraintId:\s*string\s*\):\s*Promise<ActionResult>/,
    after: ["prisma.dutyConstraint.delete(", "revalidatePath("],
  },
  {
    mod: "no-duty-dates.ts",
    action: "markNoDutyDate",
    signature:
      /markNoDutyDate\(\s*dateKeyStr:\s*string,\s*reason\?:\s*string\s*\):\s*Promise<ActionResult>/,
    after: ["parseDateKey(", "prisma.noDutyDate.upsert(", "revalidatePath("],
  },
  {
    mod: "no-duty-dates.ts",
    action: "unmarkNoDutyDate",
    signature: /unmarkNoDutyDate\(\s*dateKeyStr:\s*string\s*\):\s*Promise<ActionResult>/,
    after: ["parseDateKey(", "prisma.noDutyDate.deleteMany(", "revalidatePath("],
  },
];

const GUARD = "await requireAdmin()";

// Anything in this list appearing before the guard would mean an unauthorized
// caller can validate input, parse/probe a date, read a row, write, delete or
// bust a cache. Checked against the pre-guard prefix of every guarded action.
const FORBIDDEN_BEFORE_GUARD = [
  "prisma.",
  ".delete(",
  ".deleteMany(",
  ".create(",
  ".upsert(",
  ".update(",
  ".findUnique(",
  ".findMany(",
  ".groupBy(",
  "safeParse(",
  "parseDateKey(",
  "enumerateDateKeys(",
  "revalidatePath(",
  "redirect(",
  "await ",
];

for (const { mod, action, signature, after } of GUARDED) {
  test(`${mod}: ${action} calls await requireAdmin() as its FIRST awaited operation`, () => {
    const body = fnBody(mod, action);
    const guardIdx = body.indexOf(GUARD);
    assert.ok(guardIdx > -1, `${action} must call ${GUARD}`);

    // The very first `await` in the function IS the guard - not merely one of
    // several awaits that happens to be early.
    const firstAwait = body.indexOf("await ");
    assert.equal(
      firstAwait,
      guardIdx,
      `${action}: the first awaited operation must be ${GUARD}, not something at index ${firstAwait}`
    );

    // Exactly one guard call - no duplicated/partial gating.
    assert.equal(
      body.split("requireAdmin(").length - 1,
      1,
      `${action} must call requireAdmin exactly once`
    );
    // Awaited, never fire-and-forget (a floating promise would not block).
    assert.ok(
      !/(?<!await\s)requireAdmin\(\)/.test(body.replace(/await\s+requireAdmin\(\)/g, "")),
      `${action} must always await requireAdmin()`
    );
  });

  test(`${mod}: ${action} performs no read, write, revalidation or validation before the guard`, () => {
    const body = fnBody(mod, action);
    const prefix = body.slice(0, body.indexOf(GUARD));
    for (const marker of FORBIDDEN_BEFORE_GUARD) {
      assert.ok(
        !prefix.includes(marker),
        `${action}: "${marker}" must not appear before ${GUARD} (found in: ${prefix.trim()})`
      );
    }
    // The guard is the first *statement*, not merely the first await: nothing
    // but the declaration line precedes it.
    const beforeGuard = prefix.slice(prefix.indexOf("{") + 1).trim();
    assert.equal(
      beforeGuard,
      "",
      `${action}: ${GUARD} must be the first statement in the body (found: ${beforeGuard})`
    );
  });

  test(`${mod}: ${action} still reaches its original implementation after the guard`, () => {
    const body = fnBody(mod, action);
    const guardIdx = body.indexOf(GUARD);
    for (const marker of after) {
      const idx = body.indexOf(marker);
      assert.ok(idx > -1, `${action}: original implementation marker "${marker}" is missing`);
      assert.ok(idx > guardIdx, `${action}: "${marker}" must run after ${GUARD}`);
    }
    // Authorized callers still get the unchanged success contract.
    assert.ok(
      body.includes("return { success: true }"),
      `${action}: the authorized success result must be preserved`
    );
  });

  test(`${mod}: ${action} keeps its exact public signature`, () => {
    assert.ok(
      signature.test(SOURCES[mod]),
      `${action}: signature changed - admin call sites must keep working unchanged`
    );
  });
}

test("every guarded id/date-taking action authorizes before any existence-revealing lookup", () => {
  // Deactivate/delete/unmark actions are the probing surface: their only DB
  // statement is keyed by an attacker-supplied id or date, so it must be
  // strictly preceded by the guard. Re-asserted here explicitly (rather than
  // only via FORBIDDEN_BEFORE_GUARD) because this is the property the slice
  // exists for.
  const PROBEABLE: ReadonlyArray<[ModuleName, string, string]> = [
    ["duties.ts", "updateDutyType", "prisma.dutyType.update("],
    ["duties.ts", "setDutyTypeActive", "prisma.dutyType.update("],
    ["constraints.ts", "setDutyConstraintActive", "prisma.dutyConstraint.update("],
    ["constraints.ts", "deleteDutyConstraint", "prisma.dutyConstraint.delete("],
    ["no-duty-dates.ts", "markNoDutyDate", "prisma.noDutyDate.upsert("],
    ["no-duty-dates.ts", "unmarkNoDutyDate", "prisma.noDutyDate.deleteMany("],
  ];
  for (const [mod, action, lookup] of PROBEABLE) {
    const body = fnBody(mod, action);
    assert.ok(
      body.indexOf(GUARD) < body.indexOf(lookup),
      `${action}: ${lookup} must not be reachable before ${GUARD}`
    );
    // Exactly one DB statement, so there is no second, unguarded path.
    assert.equal(
      body.split("prisma.").length - 1,
      1,
      `${action}: expected exactly one Prisma statement, all of it behind the guard`
    );
  }
});

test("the guard is the canonical shared helper, not a local session/cookie/role check", () => {
  for (const mod of Object.keys(SOURCES) as ModuleName[]) {
    const src = SOURCES[mod];
    assert.ok(
      src.includes('import { requireAdmin } from "@/lib/auth/require-admin";'),
      `${mod} must import requireAdmin from the canonical helper`
    );
    // No auth/session/cookie logic was copied into these action modules.
    for (const marker of ["cookies(", "getServerSession", "adminEmail", "next-auth"]) {
      assert.ok(!src.includes(marker), `${mod} must not reimplement auth ("${marker}")`);
    }
    assert.ok(
      !/from\s+"@\/auth"/.test(src) && !/from\s+"next\/headers"/.test(src),
      `${mod} must not reach into the auth/session/cookie layer directly`
    );
  }
});

test("the auth implementation itself is unchanged and still fails closed", () => {
  // A2 adds call sites only. requireAdmin must still redirect (never return) for
  // an anonymous or non-admin caller - that is what makes "zero reads, zero
  // writes, zero revalidations" true for unauthorized callers of every action
  // above.
  const helper = stripComments(read("../auth/require-admin.ts"));
  assert.ok(helper.includes('redirect("/login")'), "anonymous callers must be redirected");
  assert.ok(
    helper.includes('redirect("/login?error=AccessDenied")'),
    "non-admin and deactivated-admin callers must be redirected"
  );
  assert.ok(
    helper.includes("!adminEmail || !adminEmail.isActive"),
    "the active-admin check must be unchanged"
  );
  assert.ok(
    /export const requireAdmin = cache\(async \(\): Promise<CurrentAdmin> => \{/.test(helper),
    "requireAdmin's own signature must be unchanged"
  );
});

test("no unrelated export was modified: exported surfaces are exactly as before", () => {
  const exportsOf = (mod: ModuleName) =>
    [...SOURCES[mod].matchAll(/export\s+(?:async\s+function|function|interface|const)\s+(\w+)/g)]
      .map((m) => m[1])
      .sort();

  assert.deepEqual(exportsOf("duties.ts"), [
    "createDutyType",
    "setDutyTypeActive",
    "updateDutyType",
  ]);
  assert.deepEqual(exportsOf("constraints.ts"), [
    "createDutyConstraint",
    "deleteDutyConstraint",
    "setDutyConstraintActive",
  ]);
  assert.deepEqual(exportsOf("no-duty-dates.ts"), [
    "NoDutyDayStatus",
    "getNoDutyStatusForRange",
    "markNoDutyDate",
    "unmarkNoDutyDate",
  ]);
});

test("the read-only getNoDutyStatusForRange is outside A2's scope and untouched", () => {
  // A2 guards writes only. This read keeps its exact previous shape; changing
  // it would be scope expansion, and its authorization is tracked separately.
  const body = fnBody("no-duty-dates.ts", "getNoDutyStatusForRange");
  assert.ok(!body.includes("requireAdmin"), "getNoDutyStatusForRange must be unchanged by A2");
  assert.ok(body.includes("prisma.noDutyDate.findMany("), "its no-duty read must be preserved");
  assert.ok(body.includes("prisma.dutyAssignment.groupBy("), "its assignment count must be preserved");
  assert.ok(!body.includes(".delete("), "it must remain read-only");
  assert.ok(!body.includes(".upsert("), "it must remain read-only");
});

test("A2 does not overlap or weaken the A1 slice", () => {
  // The five A1-guarded actions live in other modules, owned by
  // admin-write-guards-a1.contract.test.ts. A2's modules must not have absorbed
  // any of them.
  const a1Actions = [
    "updateCourseSettings",
    "createAvailabilityPreset",
    "deleteAvailabilityPreset",
    "applyPresetToStudents",
    "removeCourseBooklet",
  ];
  for (const mod of Object.keys(SOURCES) as ModuleName[]) {
    for (const action of a1Actions) {
      assert.ok(!SOURCES[mod].includes(action), `${mod} must not redefine or call A1's ${action}`);
    }
  }
  // The A1 contract test still exists and still asserts guard-is-first.
  const a1Test = read("./admin-write-guards-a1.contract.test.ts");
  assert.ok(
    a1Test.includes("const GUARD = \"await requireAdmin()\";"),
    "the A1 contract test must remain intact"
  );
  for (const action of a1Actions) {
    assert.ok(a1Test.includes(action), `A1 contract test must still cover ${action}`);
  }
});
