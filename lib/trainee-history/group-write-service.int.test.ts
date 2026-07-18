/**
 * ENVIRONMENT-GATED integration tests for the trainee GROUP write service
 * (Stage GH2A1) — ISOLATED CHILD-PROCESS harness.
 *
 * SKIPPED BY DEFAULT. They run ONLY when `TRAINEE_HISTORY_DB_TEST_URL` names a
 * dedicated NON-PRODUCTION Postgres database. During the standard validation
 * sequence (variable absent) every test is skipped, this parent process imports
 * NO application/Prisma module, and no database is contacted.
 *
 * ISOLATION MODEL (why a child process): the write service uses the shared
 * `@/lib/prisma` singleton, which `lib/prisma.ts` constructs ONCE from the
 * ambient `DATABASE_URL` and memoizes on `globalThis`. Merely reassigning
 * `process.env.DATABASE_URL` in this process is unsafe: under
 * `npx tsx --test lib/trainee-history/*.test.ts` a co-loaded test (e.g.
 * apply-plan.test.ts) may import `@/lib/prisma` first and bind the singleton to
 * the ambient URL. To make the ambient value IRRELEVANT and defeat any earlier
 * import or `globalThis` memoization, the DB work runs in a FRESH child process
 * whose `DATABASE_URL` is set — from the verified test URL — before Node starts,
 * so the child's first `@/lib/prisma` import can only bind to the test URL. No
 * singleton or env state leaks between the child and this parent, and isolation
 * does not depend on test-file load order or on running this file alone.
 *
 * Production ref `yjnjfnesxhmzhzpwrmqy` is rejected (case-insensitive) before
 * any import/spawn. The URL/credentials are never printed. Fixtures are
 * synthetic; each child deletes its own history rows before its Student, in a
 * finally, with per-id deletes only.
 *
 * Run intentionally with (do NOT run during standard validation):
 *   TRAINEE_HISTORY_DB_TEST_URL=postgres://... \
 *     npx tsx --test lib/trainee-history/group-write-service.int.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCTION_REF = "yjnjfnesxhmzhzpwrmqy";

const rawUrl = process.env.TRAINEE_HISTORY_DB_TEST_URL;
const testUrl = typeof rawUrl === "string" ? rawUrl.trim() : "";
const enabled = testUrl.length > 0;

// Reject the production project ref BEFORE any DB import or spawn. This parent
// process never imports @/lib/prisma, so this runs before any DB client exists.
if (enabled && testUrl.toLowerCase().includes(PRODUCTION_REF)) {
  throw new Error(
    "TRAINEE_HISTORY_DB_TEST_URL resolves to the production project ref; refusing to run integration tests.",
  );
}

const skip = enabled ? false : "TRAINEE_HISTORY_DB_TEST_URL not set (integration tests skipped)";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Fixed bootstrap (plain JS): decode the child program from an env var and run
// it as an async function in a child that already has DATABASE_URL = test URL.
// Any error written to stderr is redacted so the URL/host/user/password never
// print (Prisma connection errors can embed the host).
const BOOTSTRAP = [
  "function __redact(s) {",
  "  s = String(s);",
  "  try {",
  '    var u = process.env.DATABASE_URL || "";',
  "    if (u) {",
  '      s = s.split(u).join("<redacted-url>");',
  "      var parsed = new URL(u);",
  '      var parts = [parsed.host, parsed.hostname, parsed.username, parsed.password];',
  "      for (var i = 0; i < parts.length; i++) {",
  '        if (parts[i]) s = s.split(parts[i]).join("<redacted>");',
  "      }",
  "    }",
  "  } catch (ignore) {}",
  '  return s.replace(/(postgres(?:ql)?:\\/\\/)[^\\s"\\x27]+/gi, "$1<redacted>");',
  "}",
  'var src = process.env.__GH2A1_CHILD_SRC || "";',
  "var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;",
  "AsyncFunction(src)()",
  "  .then(function () { process.exit(0); })",
  '  .catch(function (e) { process.stderr.write(__redact(e && e.stack ? e.stack : e) + "\\n"); process.exit(1); });',
].join("\n");

/**
 * Child program (plain JS; NOT type-checked here). Runs the full group
 * lifecycle against the isolated test DB and prints CHILD_RESULT_OK on success.
 * Uses `.default` fallbacks because a runtime-eval dynamic import exposes named
 * exports under `default`. No template `${}` interpolation is used inside.
 */
const CHILD_SRC = String.raw`
const groupMod = await import("@/lib/trainee-history/group-write-service");
const write = groupMod.writeTraineeGroupMembership || (groupMod.default && groupMod.default.writeTraineeGroupMembership);
const prismaMod = await import("@/lib/prisma");
const prisma = prismaMod.prisma || (prismaMod.default && prismaMod.default.prisma);
const cryptoMod = await import("node:crypto");
const randomUUID = cryptoMod.randomUUID || (cryptoMod.default && cryptoMod.default.randomUUID);

const CUTOVER = "2026-07-18";
const NOW = new Date("2026-07-18T09:00:00.000Z");
const policy = { actorKind: "admin", allowFutureEffectiveDates: true, allowedDomain: "group", cutover: CUTOVER };

function match(obj, exp, msg) {
  for (const k in exp) {
    if (obj[k] !== exp[k]) {
      throw new Error("MISMATCH " + msg + " key=" + k + " got=" + JSON.stringify(obj[k]) + " exp=" + JSON.stringify(exp[k]));
    }
  }
}
function assertTrue(cond, msg) { if (!cond) throw new Error("ASSERT FAILED: " + msg); }

async function makeStudent(isActive) {
  const suffix = randomUUID();
  const s = await prisma.student.create({
    data: { firstName: "GH2A1", lastName: suffix, fullName: "GH2A1 " + suffix, identityNumber: "GH2A1-" + suffix, isActive: isActive, groupName: null, subgroupNumber: null },
    select: { id: true },
  });
  return s.id;
}
async function cleanup(id) {
  await prisma.traineeGroupMembership.deleteMany({ where: { studentId: id } });
  await prisma.student.deleteMany({ where: { id: id } });
}

let mainId = null;
let inactiveId = null;
try {
  // missing Student -> TRAINEE_NOT_FOUND
  const nf = await write({ studentId: "missing-" + randomUUID(), effectiveFrom: CUTOVER, groupName: "א", subgroupNumber: 1 }, policy, NOW);
  match(nf, { ok: false, code: "TRAINEE_NOT_FOUND" }, "missing->TRAINEE_NOT_FOUND");

  // inactive Student -> TRAINEE_INACTIVE
  inactiveId = await makeStudent(false);
  const ia = await write({ studentId: inactiveId, effectiveFrom: CUTOVER, groupName: "א", subgroupNumber: 1 }, policy, NOW);
  match(ia, { ok: false, code: "TRAINEE_INACTIVE" }, "inactive->TRAINEE_INACTIVE");

  // lifecycle on an active Student
  mainId = await makeStudent(true);

  const first = await write({ studentId: mainId, effectiveFrom: CUTOVER, groupName: "א", subgroupNumber: 1 }, policy, NOW);
  match(first, { ok: true, resolvedTodayChanged: true }, "first write");
  let stu = await prisma.student.findUniqueOrThrow({ where: { id: mainId }, select: { groupName: true, subgroupNumber: true } });
  match(stu, { groupName: "א", subgroupNumber: 1 }, "cache after first");

  const future = await write({ studentId: mainId, effectiveFrom: "2026-09-01", groupName: "ב", subgroupNumber: 2 }, policy, NOW);
  match(future, { ok: true, resolvedTodayChanged: false }, "future write");
  stu = await prisma.student.findUniqueOrThrow({ where: { id: mainId }, select: { groupName: true, subgroupNumber: true } });
  match(stu, { groupName: "א", subgroupNumber: 1 }, "cache unchanged after future");

  const rows = await prisma.traineeGroupMembership.findMany({ where: { studentId: mainId }, orderBy: { effectiveFrom: "asc" }, select: { effectiveTo: true } });
  assertTrue(rows.length === 2, "two history rows after future");
  assertTrue(rows[0].effectiveTo && rows[0].effectiveTo.toISOString() === "2026-09-01T00:00:00.000Z", "prior interval closed at future date");
  assertTrue(rows[1].effectiveTo === null, "future interval open-ended");

  const correction = await write({ studentId: mainId, effectiveFrom: CUTOVER, groupName: "ב", subgroupNumber: 3 }, policy, NOW);
  match(correction, { ok: true, resolvedTodayChanged: true }, "same-date correction");
  stu = await prisma.student.findUniqueOrThrow({ where: { id: mainId }, select: { groupName: true, subgroupNumber: true } });
  match(stu, { groupName: "ב", subgroupNumber: 3 }, "cache after correction");
  const afterCount = await prisma.traineeGroupMembership.count({ where: { studentId: mainId } });
  assertTrue(afterCount === 2, "still two rows after in-place correction");

  // serialized same-date re-write does not create a duplicate effectiveFrom
  await write({ studentId: mainId, effectiveFrom: "2026-09-01", groupName: "א", subgroupNumber: 2 }, policy, NOW);
  const finalRows = await prisma.traineeGroupMembership.findMany({ where: { studentId: mainId }, select: { effectiveFrom: true } });
  const keys = finalRows.map(function (r) { return r.effectiveFrom.toISOString(); });
  assertTrue(finalRows.length === 2, "no extra row from same-date re-write");
  assertTrue(new Set(keys).size === keys.length, "no duplicate effectiveFrom");

  process.stdout.write("CHILD_RESULT_OK\n");
} finally {
  if (mainId) { await cleanup(mainId); }
  if (inactiveId) { await cleanup(inactiveId); }
  await prisma.$disconnect();
}
`;

// Defense-in-depth: strip the test URL and its host/user/password from any text
// surfaced in assertion messages, in case a lower-level (pre-bootstrap) crash
// emitted unredacted output.
function redact(text: string): string {
  let out = text;
  try {
    if (testUrl) {
      out = out.split(testUrl).join("<redacted-url>");
      const u = new URL(testUrl);
      for (const part of [u.host, u.hostname, u.username, u.password]) {
        if (part) out = out.split(part).join("<redacted>");
      }
    }
  } catch {
    /* ignore URL parse issues */
  }
  return out.replace(/(postgres(?:ql)?:\/\/)[^\s"']+/gi, "$1<redacted>");
}

function runChildLifecycle(): ReturnType<typeof spawnSync> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: testUrl, __GH2A1_CHILD_SRC: CHILD_SRC };
  delete childEnv.TRAINEE_HISTORY_DB_TEST_URL;
  return spawnSync(process.execPath, ["--import", "tsx", "-e", BOOTSTRAP], {
    cwd: repoRoot,
    env: childEnv,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

test("integration/group: isolated child-process lifecycle", { skip }, () => {
  const result = runChildLifecycle();
  assert.equal(result.error, undefined, "child process failed to spawn");
  assert.equal(
    result.status,
    0,
    `child exited ${String(result.status)}; stderr:\n${redact(String(result.stderr ?? ""))}`,
  );
  assert.ok(
    typeof result.stdout === "string" && result.stdout.includes("CHILD_RESULT_OK"),
    `child did not report success; stdout:\n${redact(String(result.stdout ?? ""))}`,
  );
});
