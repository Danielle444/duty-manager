/**
 * URGENT LEVEL 2 ACCESS - SLICE L2-0: source-level contract tests for the
 * temporary compatibility module and the actor-aware resolvers.
 *
 * These assert structural properties the runtime tests cannot: that the
 * temporary ids live in exactly ONE module, that the temporary policy and the
 * actor-aware resolvers never reach a client component, and that the set of
 * production modules consuming the actor-aware resolvers is EXACTLY the
 * approved allow-list.
 *
 * That last assertion was originally "the resolvers are wired nowhere" (true
 * only for L2-0). Migration is now deliberate and incremental, so the tripwire
 * became an exact allow-list rather than being relaxed: an unapproved consumer
 * still fails it, and so does a stale entry.
 *
 * Run with: npx tsx --test lib/course/temporary-level2-compatibility.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS,
  LEGACY_COMPATIBILITY_ACTIVE_OFFERING_IDS,
  LEVEL_1_COURSE_OFFERING_ID,
  LEVEL_2_COURSE_OFFERING_ID,
} from "./temporary-level2-compatibility";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const COMPAT_MODULE = "lib/course/temporary-level2-compatibility";

const L1 = "cmrqngqhn00017gcndjixzrh0";
const L2 = "cmrxk58vc0000lscnfm54bpze";

/** Every tracked source file under the app's own directories. */
function sourceFiles(): string[] {
  const roots = ["app", "lib", "components", "scripts"].map((d) => path.join(REPO_ROOT, d));
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === "generated" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  roots.forEach(walk);
  return out;
}

const SOURCES = sourceFiles().map((file) => ({
  file,
  rel: path.relative(REPO_ROOT, file).replace(/\\/g, "/"),
  src: readFileSync(file, "utf8"),
}));

test("the verified offering ids are exactly the ones supplied", () => {
  assert.equal(LEVEL_1_COURSE_OFFERING_ID, L1);
  assert.equal(LEVEL_2_COURSE_OFFERING_ID, L2);
  assert.deepEqual([...LEGACY_COMPATIBILITY_ACTIVE_OFFERING_IDS], [L1, L2]);
  assert.deepEqual([...INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS], [L1, L2]);
});

test("the offering id literals appear in exactly ONE module (no scattered literals)", () => {
  const offenders = SOURCES.filter(
    (s) =>
      (s.src.includes(L1) || s.src.includes(L2)) &&
      !s.rel.startsWith(COMPAT_MODULE) &&
      !s.rel.endsWith(".test.ts") &&
      !s.rel.endsWith(".test.tsx"),
  ).map((s) => s.rel);
  assert.deepEqual(offenders, [], `hardcoded offering ids must live only in ${COMPAT_MODULE}.ts`);
});

test("no client component imports the temporary compatibility module", () => {
  const offenders = SOURCES.filter(
    (s) =>
      /^\s*["']use client["']/m.test(s.src) &&
      importsModule(s.src, "temporary-level2-compatibility"),
  ).map((s) => s.rel);
  assert.deepEqual(offenders, [], "the temporary policy is server-only");
});

test("no client component imports the actor-aware resolvers", () => {
  const offenders = SOURCES.filter(
    (s) =>
      /^\s*["']use client["']/m.test(s.src) &&
      importsModule(s.src, "actor-course-offering"),
  ).map((s) => s.rel);
  assert.deepEqual(offenders, []);
});

test("the temporary module keys nothing by instructor identity", () => {
  const src = readFileSync(path.join(REPO_ROOT, `${COMPAT_MODULE}.ts`), "utf8");
  // Comments legitimately discuss instructors; the executable body must not
  // reference an instructor id, name or identity number as a lookup key.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["instructorId", "fullName", "identityNumber", "firstName", "lastName"]) {
    assert.ok(!code.includes(forbidden), `temporary policy must not key on ${forbidden}`);
  }
});

/** Real import/require of a module specifier - not a mention inside a comment. */
function importsModule(src: string, moduleName: string): boolean {
  const pattern = new RegExp(
    `(?:from|import|require\\()\\s*["'][^"']*${moduleName}["']`,
  );
  return pattern.test(src);
}

/**
 * The COMPLETE set of production modules approved to consume the actor-aware
 * resolvers. This is an exact allow-list, not a floor: a module that appears
 * here without approval, and a module missing from here that starts importing
 * the resolvers, must BOTH fail the test below.
 *
 * Ownership of each entry:
 *  - lib/actions/completion.ts      - L2-C3 trainee duty completion
 *                                     (markDutyCompleted); adminSetCompletion in
 *                                     the same file keeps its requireAdmin gate
 *                                     and consumes no resolver;
 *  - lib/actions/contacts.ts        - trainee instructor directory, separately
 *                                     reviewed and committed in 19a4cf1;
 *  - lib/actions/messages.ts        - L2-C3 trainee message/task containment;
 *                                     the admin creation/fan-out and instructor
 *                                     actions in the same file are untouched
 *                                     and consume no resolver;
 *  - lib/actions/student-schedule.ts - trainee final schedule read, SLICE S1A,
 *                                     plus the L2-C3 trainee duty reader
 *                                     (getStudentDutiesForRange);
 *  - lib/actions/teaching-practice-student.ts - L2-C1 trainee Teaching Practice
 *                                     containment;
 *  - lib/actions/weekly-schedule.ts  - trainee course-scoped week picker
 *                                     (getWeeklyScheduleSelectionForTrainee),
 *                                     SLICE S1A.
 *
 * Kept sorted so the comparison is deterministic regardless of walk order.
 */
const APPROVED_ACTOR_RESOLVER_CONSUMERS: readonly string[] = [
  "lib/actions/completion.ts",
  "lib/actions/contacts.ts",
  "lib/actions/messages.ts",
  "lib/actions/student-schedule.ts",
  "lib/actions/teaching-practice-student.ts",
  "lib/actions/weekly-schedule.ts",
];

test("only the approved production modules consume the actor-aware resolvers", () => {
  // The two exclusions below are structural, NOT convenience: the resolver
  // modules themselves obviously reference their own name, and test files are
  // not production call sites. No production source file is filtered out to
  // make this pass - every one that imports the resolvers must be listed above.
  const consumers = SOURCES.filter(
    (s) =>
      importsModule(s.src, "actor-course-offering") &&
      !s.rel.startsWith("lib/course/actor-course-offering") &&
      !s.rel.endsWith(".test.ts"),
  )
    .map((s) => s.rel)
    .sort();

  // EXACT equality, never a subset check: a new consumer (approved or not) has
  // to come back through review and be added here explicitly, and a module
  // dropping the resolver must not silently leave a stale entry behind.
  assert.deepEqual(
    consumers,
    [...APPROVED_ACTOR_RESOLVER_CONSUMERS].sort(),
    "every actor-aware resolver consumer must be explicitly approved and listed",
  );
});

test("the legacy resolver still exposes its unchanged no-argument contract", () => {
  const src = readFileSync(path.join(REPO_ROOT, "lib/course/current-offering.ts"), "utf8");
  assert.ok(
    src.includes("export async function resolveCurrentCourseOffering(): Promise<CurrentCourseOffering>"),
    "legacy signature must be unchanged so no caller needs editing",
  );
});
