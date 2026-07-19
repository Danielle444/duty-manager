/**
 * ENVIRONMENT-GATED integration tests for the enrollment-scoped GROUP-CHANGE
 * service (Stage W6D3) — ISOLATED CHILD-PROCESS harness.
 *
 * SKIPPED BY DEFAULT. They run ONLY when `TRAINEE_HISTORY_DB_TEST_URL` names a
 * dedicated NON-PRODUCTION Postgres database. During the standard validation
 * sequence (variable absent) every test is skipped, this parent process imports
 * NO application/Prisma module, and no database is contacted.
 *
 * ISOLATION MODEL (why a child process): identical rationale to
 * group-write-service.int.test.ts — the service uses the memoized `@/lib/prisma`
 * singleton, so the DB work runs in a FRESH child whose `DATABASE_URL` is set,
 * from the verified test URL, before Node starts. Production ref
 * `yjnjfnesxhmzhzpwrmqy` is rejected (case-insensitive) before any import/spawn.
 * The URL/credentials are never printed; each child cleans up its own fixtures.
 *
 * Run intentionally with (do NOT run during standard validation):
 *   TRAINEE_HISTORY_DB_TEST_URL=postgres://... \
 *     npx tsx --test lib/trainee-history/group-change-service.int.test.ts
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

if (enabled && testUrl.toLowerCase().includes(PRODUCTION_REF)) {
  throw new Error(
    "TRAINEE_HISTORY_DB_TEST_URL resolves to the production project ref; refusing to run integration tests.",
  );
}

const skip = enabled ? false : "TRAINEE_HISTORY_DB_TEST_URL not set (integration tests skipped)";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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
  'var src = process.env.__W6D3_CHILD_SRC || "";',
  "var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;",
  "AsyncFunction(src)()",
  "  .then(function () { process.exit(0); })",
  '  .catch(function (e) { process.stderr.write(__redact(e && e.stack ? e.stack : e) + "\\n"); process.exit(1); });',
].join("\n");

/**
 * Child program (plain JS; NOT type-checked here). Builds a full offering/group/
 * enrollment fixture in the isolated test DB, drives the group-change service
 * through the required scenarios, and prints CHILD_RESULT_OK on success.
 */
const CHILD_SRC = String.raw`
const svcMod = await import("@/lib/trainee-history/group-change-service");
const change = svcMod.writeTraineeGroupChange || (svcMod.default && svcMod.default.writeTraineeGroupChange);
const prismaMod = await import("@/lib/prisma");
const prisma = prismaMod.prisma || (prismaMod.default && prismaMod.default.prisma);
const cryptoMod = await import("node:crypto");
const randomUUID = cryptoMod.randomUUID || (cryptoMod.default && cryptoMod.default.randomUUID);

const TODAY = "2026-07-19";
const YESTERDAY = "2026-07-18";
function d(key) { return new Date(key + "T00:00:00.000Z"); }
function assertTrue(cond, msg) { if (!cond) throw new Error("ASSERT FAILED: " + msg); }
function match(obj, exp, msg) {
  for (const k in exp) {
    if (obj[k] !== exp[k]) throw new Error("MISMATCH " + msg + " key=" + k + " got=" + JSON.stringify(obj[k]) + " exp=" + JSON.stringify(exp[k]));
  }
}
async function memberships(enrollmentId) {
  return prisma.groupMembership.findMany({ where: { courseEnrollmentId: enrollmentId }, orderBy: { effectiveFrom: "asc" }, select: { courseGroupId: true, effectiveFrom: true, effectiveTo: true } });
}
async function studentMirror(id) {
  return prisma.student.findUniqueOrThrow({ where: { id }, select: { groupName: true, subgroupNumber: true } });
}

const created = { students: [], enrollments: [], groups: [], offerings: [], years: [] };
async function makeYear() { const y = await prisma.activityYear.create({ data: { name: "W6D3-" + randomUUID() }, select: { id: true } }); created.years.push(y.id); return y.id; }
async function makeOffering(yearId) { const o = await prisma.courseOffering.create({ data: { activityYearId: yearId, name: "W6D3-" + randomUUID(), level: 1 }, select: { id: true } }); created.offerings.push(o.id); return o.id; }
async function makeGroup(offeringId, name, parentGroupId) { const g = await prisma.courseGroup.create({ data: { courseOfferingId: offeringId, name: name, parentGroupId: parentGroupId }, select: { id: true } }); created.groups.push({ id: g.id, parent: parentGroupId }); return g.id; }
async function makeStudent(isActive) { const s = await prisma.student.create({ data: { firstName: "W6D3", lastName: randomUUID(), fullName: "W6D3", identityNumber: "W6D3-" + randomUUID(), isActive: isActive, groupName: "א", subgroupNumber: 1 }, select: { id: true } }); created.students.push(s.id); return s.id; }
async function makeEnrollment(studentId, offeringId, status) { const e = await prisma.courseEnrollment.create({ data: { studentId: studentId, courseOfferingId: offeringId, status: status, isPrimary: true }, select: { id: true } }); created.enrollments.push(e.id); return e.id; }
async function makeMembership(enrollmentId, groupId, from, to) { await prisma.groupMembership.create({ data: { courseEnrollmentId: enrollmentId, courseGroupId: groupId, effectiveFrom: d(from), effectiveTo: to ? d(to) : null } }); }

try {
  const yearId = await makeYear();
  const offeringId = await makeOffering(yearId);
  const otherOfferingId = await makeOffering(yearId);

  const parentA = await makeGroup(offeringId, "א", null);
  const parentB = await makeGroup(offeringId, "ב", null);
  const a1 = await makeGroup(offeringId, "1", parentA);
  const a2 = await makeGroup(offeringId, "2", parentA);
  const b1 = await makeGroup(offeringId, "1", parentB);
  const badSub = await makeGroup(offeringId, "abc", parentA);
  const otherParent = await makeGroup(otherOfferingId, "א", null);
  const otherLeaf = await makeGroup(otherOfferingId, "1", otherParent);

  // ---- main lifecycle on an active enrollment ----
  const mainId = await makeStudent(true);
  const mainEnr = await makeEnrollment(mainId, offeringId, "ACTIVE");
  await makeMembership(mainEnr, a1, YESTERDAY, null);

  // 1-6. cross-day move A1 -> A2 today: close old at today, insert new today.
  const r1 = await change({ studentId: mainId, courseOfferingId: offeringId, targetCourseGroupId: a2, effectiveFrom: TODAY });
  match(r1, { ok: true, changed: true }, "cross-day move");
  let rows = await memberships(mainEnr);
  assertTrue(rows.length === 2, "two rows after cross-day move");
  assertTrue(rows[0].courseGroupId === a1 && rows[0].effectiveTo && rows[0].effectiveTo.toISOString() === TODAY + "T00:00:00.000Z", "old closes at today");
  assertTrue(rows[1].courseGroupId === a2 && rows[1].effectiveFrom.toISOString() === TODAY + "T00:00:00.000Z" && rows[1].effectiveTo === null, "new starts today open-ended");
  match(await studentMirror(mainId), { groupName: "א", subgroupNumber: 2 }, "mirror after move");

  // 8. same-day correction A2 -> B1 today: update today's row IN PLACE.
  const r2 = await change({ studentId: mainId, courseOfferingId: offeringId, targetCourseGroupId: b1, effectiveFrom: TODAY });
  match(r2, { ok: true, changed: true }, "same-day correction");
  rows = await memberships(mainEnr);
  assertTrue(rows.length === 2, "still two rows after same-day correction");
  assertTrue(rows[1].courseGroupId === b1 && rows[1].effectiveTo === null, "today row updated in place to B1");
  match(await studentMirror(mainId), { groupName: "ב", subgroupNumber: 1 }, "mirror after correction");

  // 9. same-day change-back to A1 today: update today's row in place again.
  const r3 = await change({ studentId: mainId, courseOfferingId: offeringId, targetCourseGroupId: a1, effectiveFrom: TODAY });
  match(r3, { ok: true, changed: true }, "same-day change back");
  rows = await memberships(mainEnr);
  assertTrue(rows.length === 2 && rows[1].courseGroupId === a1, "today row back to A1, still two rows");

  // 7. same-group request -> successful no-op, zero writes.
  const before = await memberships(mainEnr);
  const r4 = await change({ studentId: mainId, courseOfferingId: offeringId, targetCourseGroupId: a1, effectiveFrom: TODAY });
  match(r4, { ok: true, changed: false }, "same-group no-op");
  const after = await memberships(mainEnr);
  assertTrue(JSON.stringify(before) === JSON.stringify(after), "no writes on same-group no-op");

  // 24. never dual-writes the legacy TraineeGroupMembership.
  assertTrue((await prisma.traineeGroupMembership.count({ where: { studentId: mainId } })) === 0, "no TraineeGroupMembership rows written");

  // 17. top-level target fails closed.
  match(await change({ studentId: mainId, courseOfferingId: offeringId, targetCourseGroupId: parentA, effectiveFrom: TODAY }), { ok: false, code: "INVALID_TARGET_GROUP" }, "top-level target");
  // 16. cross-offering target fails closed.
  match(await change({ studentId: mainId, courseOfferingId: offeringId, targetCourseGroupId: otherLeaf, effectiveFrom: TODAY }), { ok: false, code: "INVALID_TARGET_GROUP" }, "cross-offering target");
  // 18. malformed subgroup name fails closed.
  match(await change({ studentId: mainId, courseOfferingId: offeringId, targetCourseGroupId: badSub, effectiveFrom: TODAY }), { ok: false, code: "INVALID_TARGET_GROUP" }, "malformed subgroup");

  // 10. missing Student fails with zero writes.
  match(await change({ studentId: "missing-" + randomUUID(), courseOfferingId: offeringId, targetCourseGroupId: a2, effectiveFrom: TODAY }), { ok: false, code: "TRAINEE_NOT_FOUND" }, "missing student");

  // 11. inactive Student fails.
  const inactiveId = await makeStudent(false);
  const inactiveEnr = await makeEnrollment(inactiveId, offeringId, "ACTIVE");
  await makeMembership(inactiveEnr, a1, YESTERDAY, null);
  match(await change({ studentId: inactiveId, courseOfferingId: offeringId, targetCourseGroupId: a2, effectiveFrom: TODAY }), { ok: false, code: "TRAINEE_INACTIVE" }, "inactive student");

  // 12. missing enrollment fails.
  const noEnrId = await makeStudent(true);
  match(await change({ studentId: noEnrId, courseOfferingId: offeringId, targetCourseGroupId: a2, effectiveFrom: TODAY }), { ok: false, code: "ENROLLMENT_NOT_FOUND" }, "missing enrollment");

  // 13. inactive enrollment fails.
  const inEnrStu = await makeStudent(true);
  const inEnr = await makeEnrollment(inEnrStu, offeringId, "INACTIVE");
  await makeMembership(inEnr, a1, YESTERDAY, null);
  match(await change({ studentId: inEnrStu, courseOfferingId: offeringId, targetCourseGroupId: a2, effectiveFrom: TODAY }), { ok: false, code: "ENROLLMENT_INACTIVE" }, "inactive enrollment");

  // 14. missing current membership fails closed.
  const noMemStu = await makeStudent(true);
  const noMemEnr = await makeEnrollment(noMemStu, offeringId, "ACTIVE");
  match(await change({ studentId: noMemStu, courseOfferingId: offeringId, targetCourseGroupId: a2, effectiveFrom: TODAY }), { ok: false, code: "MEMBERSHIP_STATE_INVALID" }, "missing membership");

  // 15. multiple current memberships fail closed (two open-ended rows cover today).
  const multiStu = await makeStudent(true);
  const multiEnr = await makeEnrollment(multiStu, offeringId, "ACTIVE");
  await makeMembership(multiEnr, a1, YESTERDAY, null);
  await makeMembership(multiEnr, a2, TODAY, null);
  match(await change({ studentId: multiStu, courseOfferingId: offeringId, targetCourseGroupId: b1, effectiveFrom: TODAY }), { ok: false, code: "MEMBERSHIP_STATE_INVALID" }, "multiple memberships");

  process.stdout.write("CHILD_RESULT_OK\n");
} finally {
  // Restrict FKs: delete memberships -> enrollments -> students; child groups
  // before parents; then offerings, then activity years.
  for (const id of created.enrollments) { await prisma.groupMembership.deleteMany({ where: { courseEnrollmentId: id } }); }
  for (const id of created.enrollments) { await prisma.courseEnrollment.deleteMany({ where: { id: id } }); }
  for (const id of created.students) { await prisma.traineeGroupMembership.deleteMany({ where: { studentId: id } }); await prisma.student.deleteMany({ where: { id: id } }); }
  for (const g of created.groups) { if (g.parent) { await prisma.courseGroup.deleteMany({ where: { id: g.id } }); } }
  for (const g of created.groups) { if (!g.parent) { await prisma.courseGroup.deleteMany({ where: { id: g.id } }); } }
  for (const id of created.offerings) { await prisma.courseOffering.deleteMany({ where: { id: id } }); }
  for (const id of created.years) { await prisma.activityYear.deleteMany({ where: { id: id } }); }
  await prisma.$disconnect();
}
`;

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
  const childEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: testUrl, __W6D3_CHILD_SRC: CHILD_SRC };
  delete childEnv.TRAINEE_HISTORY_DB_TEST_URL;
  return spawnSync(process.execPath, ["--import", "tsx", "-e", BOOTSTRAP], {
    cwd: repoRoot,
    env: childEnv,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000,
  });
}

function childTimedOut(result: ReturnType<typeof spawnSync>): boolean {
  const err = result.error as NodeJS.ErrnoException | undefined;
  if (err && err.code === "ETIMEDOUT") return true;
  return result.signal === "SIGTERM";
}

test("integration/group-change: isolated child-process lifecycle", { skip }, () => {
  const result = runChildLifecycle();
  assert.ok(!childTimedOut(result), "integration child timed out after 60s");
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
