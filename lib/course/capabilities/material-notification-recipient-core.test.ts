/**
 * SECURITY / LEVEL 2 SLICE L2-MATERIAL-NOTIFY-1 - focused tests for the PURE
 * material-notification recipient core.
 *
 * Everything here runs against plain values: no Next.js cookies, no live Prisma,
 * no React, no network. They lock the L2-MATERIAL-NOTIFY-1 contract:
 *  - the trainee path is entered on a POSITIVE visibility allow-list only, so
 *    every malformed value fails closed;
 *  - duplicate offering ids and duplicate trainee ids collapse deterministically,
 *    so one material can never produce two notifications for one trainee;
 *  - a blank or non-string identifier REFUSES the whole fan-out and is never
 *    silently skipped, coerced or repaired;
 *  - a refusal carries only a code-owned field name and a positional index -
 *    never the offending value, never a neighbouring id, never any PII;
 *  - the module is genuinely pure (no runtime import at all) and does not restate
 *    any part of effective-capability evaluation;
 *  - nothing in the repository imports it yet.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/course/capabilities/material-notification-recipient-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  MATERIAL_NOTIFICATION_CAPABILITY_KEY,
  MaterialNotificationIdError,
  dedupeMaterialNotificationOfferingIds,
  dedupeMaterialNotificationRecipientIds,
  shouldNotifyTrainees,
} from "./material-notification-recipient-core";
import { isCapabilityKey } from "./capability-keys";

// The two REAL production offering ids, so the Level 1 / Level 2 cases below
// describe the actual launch state rather than invented placeholders.
const LEVEL_1_OFFERING_ID = "cmrqngqhn00017gcndjixzrh0";
const LEVEL_2_OFFERING_ID = "cmrxk58vc0000lscnfm54bpze";

const MODULE_FILE = "material-notification-recipient-core.ts";
const TEST_FILE = "material-notification-recipient-core.test.ts";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * Source with block and line comments removed.
 *
 * The forbidden-identifier assertions below must test what the module actually
 * DOES, not what its documentation is allowed to mention: the core explains at
 * length WHY it refuses to restate capability evaluation, and naming those
 * concepts in prose must not be mistaken for implementing them. A real reference
 * in code still fails these checks.
 */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Narrow a caught value to the typed refusal, failing the test if it is not one. */
function asIdError(error: unknown): MaterialNotificationIdError {
  assert.ok(
    error instanceof MaterialNotificationIdError,
    "a malformed identifier must throw the typed refusal",
  );
  return error as MaterialNotificationIdError;
}

// ---------------------------------------------------------------------------
// Capability key
// ---------------------------------------------------------------------------

test("the notification capability key is the canonical materials key", () => {
  assert.equal(MATERIAL_NOTIFICATION_CAPABILITY_KEY, "COURSE_MATERIALS");
  // It must be a REAL canonical key, not a free-text string that merely looks
  // like one - an unknown key would grant nothing and fail silently.
  assert.equal(isCapabilityKey(MATERIAL_NOTIFICATION_CAPABILITY_KEY), true);
});

// ---------------------------------------------------------------------------
// Visibility predicate
// ---------------------------------------------------------------------------

test("STUDENTS and BOTH enter the trainee path", () => {
  assert.equal(shouldNotifyTrainees("STUDENTS"), true);
  assert.equal(shouldNotifyTrainees("BOTH"), true);
});

test("INSTRUCTORS does not enter the trainee path", () => {
  assert.equal(shouldNotifyTrainees("INSTRUCTORS"), false);
});

test("every malformed visibility fails closed", () => {
  const malformed: unknown[] = [
    undefined,
    null,
    "",
    " ",
    "students", // casing variant
    "Both",
    " STUDENTS", // untrimmed - deliberately NOT accepted
    "STUDENTS ",
    "ALL",
    "TRAINEES",
    "STUDENT",
    0,
    1,
    true,
    false,
    NaN,
    [],
    ["STUDENTS"],
    {},
    { visibility: "STUDENTS" },
    new String("STUDENTS"), // boxed string is not the primitive
    Symbol("STUDENTS"),
    () => "STUDENTS",
  ];
  for (const value of malformed) {
    assert.equal(
      shouldNotifyTrainees(value),
      false,
      `malformed visibility ${String(typeof value)} must fail closed`,
    );
  }
});

test("the visibility predicate is a positive allow-list, not a negated INSTRUCTORS test", () => {
  const code = readCode(`./${MODULE_FILE}`);
  assert.ok(
    !/!==\s*["']INSTRUCTORS["']/.test(code),
    "the trainee path must never be opened by excluding INSTRUCTORS",
  );
  assert.ok(
    code.includes('visibility === "STUDENTS"') && code.includes('visibility === "BOTH"'),
    "the trainee path must be opened by an explicit positive allow-list",
  );
});

// ---------------------------------------------------------------------------
// Offering-id deduplication
// ---------------------------------------------------------------------------

test("duplicate offering ids collapse deterministically in first-seen order", () => {
  const rows = [
    { courseOfferingId: LEVEL_2_OFFERING_ID },
    { courseOfferingId: LEVEL_1_OFFERING_ID },
    { courseOfferingId: LEVEL_2_OFFERING_ID },
    { courseOfferingId: LEVEL_1_OFFERING_ID },
    { courseOfferingId: LEVEL_2_OFFERING_ID },
  ];
  const first = dedupeMaterialNotificationOfferingIds(rows);

  // First-seen order, NOT sorted: the input order is the caller's (database)
  // order and must be preserved verbatim.
  assert.deepEqual(first, [LEVEL_2_OFFERING_ID, LEVEL_1_OFFERING_ID]);

  // Deterministic: identical input always produces identical output.
  assert.deepEqual(dedupeMaterialNotificationOfferingIds(rows), first);

  assert.deepEqual(dedupeMaterialNotificationOfferingIds([]), []);
  assert.deepEqual(dedupeMaterialNotificationOfferingIds([{ courseOfferingId: LEVEL_1_OFFERING_ID }]), [
    LEVEL_1_OFFERING_ID,
  ]);
});

test("a blank or non-string offering id throws instead of being skipped", () => {
  const invalid: unknown[] = [
    { courseOfferingId: "" },
    { courseOfferingId: "   " },
    { courseOfferingId: null },
    { courseOfferingId: undefined },
    { courseOfferingId: 42 },
    { courseOfferingId: {} },
    { courseOfferingId: [] },
    { courseOfferingId: [LEVEL_1_OFFERING_ID] },
    { courseOfferingId: new String(LEVEL_1_OFFERING_ID) },
    {}, // property entirely absent
    null,
    undefined,
  ];
  for (const row of invalid) {
    assert.throws(
      () =>
        dedupeMaterialNotificationOfferingIds([row] as unknown as { courseOfferingId: string }[]),
      MaterialNotificationIdError,
    );
  }
});

// ---------------------------------------------------------------------------
// Recipient-id deduplication
// ---------------------------------------------------------------------------

test("duplicate student ids collapse deterministically in first-seen order", () => {
  // The real reason this matters: one trainee holding ACTIVE enrollments in two
  // enabled offerings appears twice in the roster query, and Notification has no
  // uniqueness constraint - without dedupe they would receive the same material
  // notification twice.
  const rows = [
    { studentId: "student-b" },
    { studentId: "student-a" },
    { studentId: "student-b" },
    { studentId: "student-c" },
    { studentId: "student-a" },
  ];
  const first = dedupeMaterialNotificationRecipientIds(rows);

  assert.deepEqual(first, ["student-b", "student-a", "student-c"]);
  assert.deepEqual(dedupeMaterialNotificationRecipientIds(rows), first);

  assert.deepEqual(dedupeMaterialNotificationRecipientIds([]), []);
});

test("a blank or non-string student id throws instead of being skipped", () => {
  const invalid: unknown[] = [
    { studentId: "" },
    { studentId: "\t\n " },
    { studentId: null },
    { studentId: undefined },
    { studentId: 0 },
    { studentId: 123 },
    { studentId: true },
    { studentId: {} },
    { studentId: [] },
    { studentId: new String("student-a") },
    {},
    null,
    undefined,
  ];
  for (const row of invalid) {
    assert.throws(
      () => dedupeMaterialNotificationRecipientIds([row] as unknown as { studentId: string }[]),
      MaterialNotificationIdError,
    );
  }
});

test("one malformed id refuses the WHOLE fan-out - valid neighbours are not returned", () => {
  // A partial send is indistinguishable from a complete one, so the only safe
  // outcome is a refusal. Nothing is returned and nothing is silently dropped.
  assert.throws(
    () =>
      dedupeMaterialNotificationRecipientIds([
        { studentId: "student-a" },
        { studentId: "" },
        { studentId: "student-b" },
      ] as unknown as { studentId: string }[]),
    (error: unknown) => {
      const refusal = asIdError(error);
      assert.equal(refusal.field, "studentId");
      assert.equal(refusal.index, 1);
      return true;
    },
  );

  assert.throws(
    () =>
      dedupeMaterialNotificationOfferingIds([
        { courseOfferingId: LEVEL_1_OFFERING_ID },
        { courseOfferingId: LEVEL_2_OFFERING_ID },
        { courseOfferingId: null },
      ] as unknown as { courseOfferingId: string }[]),
    (error: unknown) => {
      const refusal = asIdError(error);
      assert.equal(refusal.field, "courseOfferingId");
      assert.equal(refusal.index, 2);
      return true;
    },
  );
});

test("identifiers are never trimmed, normalized, or otherwise rewritten", () => {
  // `trim()` exists ONLY as an emptiness TEST. A whitespace-padded id that is
  // otherwise usable must come back byte-for-byte as supplied, so two distinct
  // database ids can never be folded into one.
  const padded = ` ${LEVEL_1_OFFERING_ID} `;
  assert.deepEqual(dedupeMaterialNotificationOfferingIds([{ courseOfferingId: padded }]), [padded]);
  assert.deepEqual(
    dedupeMaterialNotificationOfferingIds([
      { courseOfferingId: padded },
      { courseOfferingId: LEVEL_1_OFFERING_ID },
    ]),
    [padded, LEVEL_1_OFFERING_ID],
  );

  const mixedCase = "Student-A";
  assert.deepEqual(
    dedupeMaterialNotificationRecipientIds([
      { studentId: mixedCase },
      { studentId: "student-a" },
    ]),
    [mixedCase, "student-a"],
  );
});

// ---------------------------------------------------------------------------
// Refusals are PII-free
// ---------------------------------------------------------------------------

test("a refusal never discloses the offending value, a neighbour, or any PII", () => {
  const PII = {
    fullName: "שרה כהן",
    phone: "0501234567",
    identityNumber: "123456789",
    title: "חוברת הקורס - שלב א",
  };

  const cases: { run: () => unknown; secrets: string[] }[] = [
    {
      // The malformed value itself is a whole PII-bearing object.
      run: () =>
        dedupeMaterialNotificationRecipientIds([
          { studentId: PII },
        ] as unknown as { studentId: string }[]),
      secrets: [PII.fullName, PII.phone, PII.identityNumber],
    },
    {
      // A VALID neighbouring id must not be echoed either.
      run: () =>
        dedupeMaterialNotificationOfferingIds([
          { courseOfferingId: LEVEL_1_OFFERING_ID },
          { courseOfferingId: PII.title },
          { courseOfferingId: "" },
        ] as unknown as { courseOfferingId: string }[]),
      secrets: [LEVEL_1_OFFERING_ID, PII.title],
    },
  ];

  for (const { run, secrets } of cases) {
    assert.throws(run, (error: unknown) => {
      const refusal = asIdError(error);
      const own = refusal as unknown as Record<string, unknown>;

      // Everything a logger could plausibly reach: the message, the string form,
      // the enumerable own properties, and the full own-property dump including
      // the non-enumerable ones (message/stack).
      const surfaces = [
        refusal.message,
        String(refusal),
        JSON.stringify(refusal),
        JSON.stringify(Object.getOwnPropertyNames(refusal).map((key) => own[key])),
      ].join("\n");

      for (const secret of secrets) {
        assert.ok(
          !surfaces.includes(secret),
          `refusal surface must not disclose ${JSON.stringify(secret)}`,
        );
      }

      // What it MAY carry: a code-owned field name and a positional index.
      assert.ok(["courseOfferingId", "studentId"].includes(refusal.field));
      assert.equal(typeof refusal.index, "number");
      assert.equal(refusal.name, "MaterialNotificationIdError");
      assert.ok(refusal instanceof Error);
      return true;
    });
  }
});

// ---------------------------------------------------------------------------
// Purity of this core
// ---------------------------------------------------------------------------

test("the core has no runtime import at all", () => {
  const src = readCode(`./${MODULE_FILE}`);
  const valueImports = [
    ...src.matchAll(/^\s*import\s+(?!type\b)[\s\S]*?from\s*["']([^"']+)["']/gm),
  ].map((m) => m[1]);
  const bareImports = [...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  const dynamicImports = [...src.matchAll(/\bimport\s*\(/g)].map((m) => m[0]);
  const requires = [...src.matchAll(/\brequire\s*\(/g)].map((m) => m[0]);

  assert.deepEqual([...valueImports, ...bareImports], []);
  assert.deepEqual(dynamicImports, []);
  assert.deepEqual(requires, []);

  // The single import is type-only and therefore fully erased at runtime.
  const typeImports = [...src.matchAll(/^\s*import\s+type[\s\S]*?from\s*["']([^"']+)["']/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual(typeImports, ["./capability-keys"]);
});

test("the core touches no impure or out-of-scope surface", () => {
  const src = readCode(`./${MODULE_FILE}`);
  const forbidden = [
    // IO / environment / non-determinism
    "prisma",
    "Prisma",
    "next/headers",
    "next/cache",
    "cookies(",
    "process.env",
    "Date",
    "Math.random",
    "console.",
    "fetch(",
    "use server",
    // Adjacent surfaces this slice must not reach into. (The module's OWN
    // "…Notification…" export names are why the bare word is not listed here -
    // these are the real production symbols it must not touch.)
    "createMaterialAddedNotifications",
    "notificationsWhere",
    "webpush",
    "web-push",
    "sendNewMessagePush",
    "messageTask",
    "MessageTaskRecipient",
    "courseMaterial",
    "createMany",
    "getStudentMaterials",
    "requireAdmin",
    "getCurrentTrainee",
    "getCurrentInstructor",
    // Course-scope inference that is forbidden outright
    "resolveCurrentCourseOffering",
    "groupName",
    "subgroupNumber",
    "startDate",
    "endDate",
    "activityYear",
  ];
  for (const token of forbidden) {
    assert.ok(!src.includes(token), `the pure core must not reference ${token}`);
  }
});

test("the core does not restate effective-capability evaluation", () => {
  // The whole point of the slice: capability EVALUATION stays in the committed
  // effective-capability core behind getEffectiveCapabilities. A second copy
  // here would be a silently-drifting authorization path.
  const src = readCode(`./${MODULE_FILE}`);
  const forbidden = [
    "ENABLED",
    "READ_ONLY",
    "DISABLED",
    "getEffectiveCapabilities",
    "EffectiveCapabilityStatus",
    "resolveEffectiveCapabilitiesFromRows",
    "CapabilityCatalog",
    "CAPABILITY_CATALOG",
    "capabilityKey",
    "dependsOn",
    "defaultEnabled",
    "isActive",
  ];
  for (const token of forbidden) {
    assert.ok(!src.includes(token), `capability evaluation must not be restated (${token})`);
  }

  // The ONE capability-layer value it may hold is the key constant itself.
  assert.ok(src.includes('"COURSE_MATERIALS"'));
});

// ---------------------------------------------------------------------------
// Unwired
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCAN_ROOTS = ["app", "lib", "scripts", "prisma"];
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  ".git",
  "generated", // app/generated is machine-generated Prisma output
]);
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function collectSourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, found);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry))) {
      found.push(full);
    }
  }
  return found;
}

test("nothing in the repository imports this module yet", () => {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    const full = path.join(REPO_ROOT, root);
    try {
      if (statSync(full).isDirectory()) collectSourceFiles(full, files);
    } catch {
      // A scan root that does not exist is simply skipped.
    }
  }

  // Sanity check: the walker really did scan the tree it claims to.
  assert.ok(files.length > 100, `expected a populated scan, walked ${files.length} files`);
  assert.ok(files.some((f) => f.endsWith(path.join("lib", "actions", "notifications.ts"))));
  assert.ok(files.some((f) => f.endsWith(path.join("lib", "actions", "materials.ts"))));

  const importers = files.filter((file) => {
    const base = path.basename(file);
    if (base === MODULE_FILE || base === TEST_FILE) return false;
    return readFileSync(file, "utf8").includes("material-notification-recipient-core");
  });

  assert.deepEqual(importers, [], "the core must stay unwired in this slice");
});
