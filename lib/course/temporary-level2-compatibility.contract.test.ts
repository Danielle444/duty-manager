/**
 * URGENT LEVEL 2 ACCESS - SLICE L2-0: source-level contract tests for the
 * temporary compatibility module and the actor-aware resolvers.
 *
 * These assert structural properties the runtime tests cannot: that the
 * temporary ids live in exactly ONE module, that the temporary policy never
 * reaches a client component, and that this slice did not migrate any schedule,
 * contact, navigation or UI call site.
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

test("this slice did not migrate schedule, contact, navigation or UI call sites", () => {
  const consumers = SOURCES.filter(
    (s) =>
      importsModule(s.src, "actor-course-offering") &&
      !s.rel.startsWith("lib/course/actor-course-offering") &&
      !s.rel.endsWith(".test.ts"),
  ).map((s) => s.rel);
  assert.deepEqual(consumers, [], "the new resolvers must stay un-wired in L2-0");
});

test("the legacy resolver still exposes its unchanged no-argument contract", () => {
  const src = readFileSync(path.join(REPO_ROOT, "lib/course/current-offering.ts"), "utf8");
  assert.ok(
    src.includes("export async function resolveCurrentCourseOffering(): Promise<CurrentCourseOffering>"),
    "legacy signature must be unchanged so no caller needs editing",
  );
});
