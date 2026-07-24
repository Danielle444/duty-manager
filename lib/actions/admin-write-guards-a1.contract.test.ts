// ADMIN-WRITE-A1 - DB-free CONTRACT/source test for the admin authorization
// guards added to five previously unguarded "use server" write actions:
//
//   lib/actions/course-settings.ts      updateCourseSettings
//   lib/actions/availability-presets.ts createAvailabilityPreset
//                                       deleteAvailabilityPreset
//                                       applyPresetToStudents
//   lib/actions/course-booklet.ts       removeCourseBooklet
//
// Each of these is directly reachable as a Server Action endpoint, so page-level
// gating on /admin/* is NOT their authorization boundary. This test statically
// inspects the action sources and asserts the invariants the security slice
// requires:
//
//   - `await requireAdmin()` is the FIRST awaited operation in every action;
//   - nothing that validates, reads, writes, deletes storage objects, or
//     revalidates runs before it, so an unauthorized caller performs zero Prisma
//     writes, zero Prisma reads, zero Supabase Storage deletes, and learns
//     nothing about the existence of a preset / booklet / course window;
//   - the guard comes from the canonical shared helper, not a locally
//     reimplemented session/cookie/role check;
//   - the public signatures are unchanged (same parameter count and types), so
//     the authorized admin call sites keep working;
//   - the authorized path still falls through to the original implementation
//     (the original mutations are all still present, after the guard);
//   - no unrelated export in these modules gained or lost a guard - in
//     particular the deliberately public read `getBookletAccess` is untouched.
//
// Run: npx tsx --test lib/actions/admin-write-guards-a1.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Strip block and line comments so every invariant below is checked against real
// CODE only, never the (deliberately prose-y) contract comments - which
// legitimately name prisma, supabase, requireAdmin, etc. None of the inspected
// modules contains `//` inside a string or regex literal, so this naive strip is
// safe here.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function load(relativePath: string): string {
  return stripComments(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"));
}

const SOURCES = {
  "course-settings.ts": load("./course-settings.ts"),
  "availability-presets.ts": load("./availability-presets.ts"),
  "course-booklet.ts": load("./course-booklet.ts"),
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
  // work: validation, reads, writes, storage deletes, cache revalidation).
  after: readonly string[];
}> = [
  {
    mod: "course-settings.ts",
    action: "updateCourseSettings",
    signature: /updateCourseSettings\(\s*formData:\s*FormData\s*\):\s*Promise<ActionResult>/,
    after: ["settingsSchema.safeParse(", "prisma.courseSettings.upsert(", "parseDateKey(", "revalidatePath("],
  },
  {
    mod: "availability-presets.ts",
    action: "createAvailabilityPreset",
    signature: /createAvailabilityPreset\(\s*formData:\s*FormData\s*\):\s*Promise<ActionResult>/,
    after: ["presetSchema.safeParse(", "prisma.availabilityRangePreset.create(", "revalidatePath("],
  },
  {
    mod: "availability-presets.ts",
    action: "deleteAvailabilityPreset",
    signature: /deleteAvailabilityPreset\(\s*presetId:\s*string\s*\):\s*Promise<ActionResult>/,
    after: ["prisma.availabilityRangePreset.delete(", "revalidatePath("],
  },
  {
    mod: "availability-presets.ts",
    action: "applyPresetToStudents",
    signature:
      /applyPresetToStudents\(\s*presetId:\s*string,\s*studentIds:\s*string\[\]\s*\):\s*Promise<ActionResult>/,
    after: [
      "prisma.availabilityRangePreset.findUnique(",
      "prisma.courseSettings.findUnique(",
      "applyDateRangeAvailability(",
      "revalidatePath(",
    ],
  },
  {
    mod: "course-booklet.ts",
    action: "removeCourseBooklet",
    signature: /removeCourseBooklet\(\s*\):\s*Promise<ActionResult>/,
    after: [
      "prisma.courseBooklet.findUnique(",
      "getSupabaseClient(",
      "COURSE_BOOKLET_BUCKET).remove(",
      "prisma.courseBooklet.delete(",
      "revalidatePath(",
    ],
  },
];

const GUARD = "await requireAdmin()";

// Anything in this list appearing before the guard would mean an unauthorized
// caller can validate input, read a row, write, delete a storage object, or bust
// a cache. Checked against the pre-guard prefix of every guarded action.
const FORBIDDEN_BEFORE_GUARD = [
  "prisma.",
  "supabase",
  "getSupabaseClient",
  ".remove(",
  ".delete(",
  ".create(",
  ".upsert(",
  ".update(",
  ".findUnique(",
  ".findMany(",
  "safeParse(",
  "parseDateKey(",
  "applyDateRangeAvailability(",
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

  test(`${mod}: ${action} performs no read, write, storage delete or validation before the guard`, () => {
    const body = fnBody(mod, action);
    const prefix = body.slice(0, body.indexOf(GUARD));
    for (const marker of FORBIDDEN_BEFORE_GUARD) {
      assert.ok(
        !prefix.includes(marker),
        `${action}: "${marker}" must not appear before ${GUARD} (found in: ${prefix.trim()})`
      );
    }
  });

  test(`${mod}: ${action} still reaches its original implementation after the guard`, () => {
    const body = fnBody(mod, action);
    const guardIdx = body.indexOf(GUARD);
    for (const marker of after) {
      const idx = body.indexOf(marker);
      assert.ok(idx > -1, `${action}: original implementation marker "${marker}" is missing`);
      assert.ok(idx > guardIdx, `${action}: "${marker}" must run after ${GUARD}`);
    }
  });

  test(`${mod}: ${action} keeps its exact public signature`, () => {
    assert.ok(
      signature.test(SOURCES[mod]),
      `${action}: signature changed - admin call sites must keep working unchanged`
    );
  });
}

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

test("no unrelated export was modified: exported surfaces are exactly as before", () => {
  const exportsOf = (mod: ModuleName) =>
    [...SOURCES[mod].matchAll(/export\s+(?:async\s+function|function|interface|const)\s+(\w+)/g)]
      .map((m) => m[1])
      .sort();

  assert.deepEqual(exportsOf("course-settings.ts"), ["updateCourseSettings"]);
  assert.deepEqual(exportsOf("availability-presets.ts"), [
    "applyPresetToStudents",
    "createAvailabilityPreset",
    "deleteAvailabilityPreset",
  ]);
  assert.deepEqual(exportsOf("course-booklet.ts"), [
    "CourseBookletAccess",
    "getBookletAccess",
    "removeCourseBooklet",
  ]);
});

test("the deliberately public read getBookletAccess is untouched by this slice", () => {
  // /student and /instructor rely on this read degrading to null; adding an
  // admin guard here would break them. This slice must not have touched it.
  const body = fnBody("course-booklet.ts", "getBookletAccess");
  assert.ok(!body.includes("requireAdmin"), "getBookletAccess must remain unguarded by requireAdmin");
  assert.ok(body.includes("prisma.courseBooklet.findUnique("), "getBookletAccess must keep its read");
  assert.ok(body.includes("createSignedUrl("), "getBookletAccess must keep its signed-url behavior");
  assert.ok(!body.includes(".remove("), "getBookletAccess must never delete storage objects");
});
