/**
 * ENVIRONMENT-GATED integration tests for the trainee HORSE write service
 * (Stage GH2A1; ENROLLMENT-SCOPED in Stage MULTI-COURSE W8A-5) — ISOLATED
 * CHILD-PROCESS harness.
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
 * synthetic; each child deletes its own history/enrollment rows before its
 * Student (and its synthetic offering/year), in a finally, with per-id deletes.
 *
 * W8A-5 COVERAGE: exact enrollment resolution by (studentId, courseOfferingId);
 * inserted-row courseEnrollmentId; same-day correction and later-append link
 * preservation; identical Student + CourseEnrollment cache updates; fail-closed
 * pre-write invariants (cache/history mismatches, missing/inactive enrollment,
 * missing/multiple/wrong-linked current history); full rollback on a cache-write
 * failure; and no module-level cross-request state under concurrency.
 *
 * W8A-6 COVERAGE (child): instructor policy writes all three horse fields via the
 * same service; instructor future date fails closed.
 *
 * W8A-7 COVERAGE (child, DB-gated): trainee policy renames a private horse
 * (privateHorseName-only), maintaining dated history + both caches; empty-to-null
 * private name; assignedHorseName / hasPrivateHorse changes denied by the field
 * policy; stale forbidden-field pass-through fails closed. Plus ALWAYS-RUN, non-DB
 * source-level checks of the updateOwnPrivateHorseName action contract (public
 * signature, retained Student prechecks + exact Hebrew messages, no direct
 * prisma.student.update, trainee WritePolicy, name normalization, forbidden-field
 * pass-through, server-resolved offering) that import neither the action nor
 * Prisma, preserving this parent process's no-database guarantee.
 *
 * Run intentionally with (do NOT run during standard validation):
 *   TRAINEE_HISTORY_DB_TEST_URL=postgres://... \
 *     npx tsx --test lib/trainee-history/horse-write-service.int.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
 * Child program (plain JS; NOT type-checked here). Runs the full W8A-5
 * enrollment-scoped horse lifecycle + fail-closed matrix against the isolated
 * test DB and prints CHILD_RESULT_OK on success. Uses `.default` fallbacks
 * because a runtime-eval dynamic import exposes named exports under `default`.
 * No template `${}` interpolation is used inside.
 */
const CHILD_SRC = String.raw`
const horseMod = await import("@/lib/trainee-history/horse-write-service");
const write = horseMod.writeTraineeHorseAssignment || (horseMod.default && horseMod.default.writeTraineeHorseAssignment);
const prismaMod = await import("@/lib/prisma");
const prisma = prismaMod.prisma || (prismaMod.default && prismaMod.default.prisma);
const cryptoMod = await import("node:crypto");
const randomUUID = cryptoMod.randomUUID || (cryptoMod.default && cryptoMod.default.randomUUID);

const TODAY = "2026-07-18";
const NOW = new Date("2026-07-18T09:00:00.000Z");
const adminPolicy = { actorKind: "admin", allowFutureEffectiveDates: false, allowedDomain: "horse", cutover: TODAY };
// W8A-6: the instructor action reuses this SAME service with an instructor policy
// and NO field-level restriction (its prior capability was all three horse
// fields). No allowedHorseFields key => no field restriction, like admin.
const instructorPolicy = { actorKind: "instructor", allowFutureEffectiveDates: false, allowedDomain: "horse", cutover: TODAY };
// W8A-7: the trainee action reuses this SAME service with a trainee policy that
// HARD-restricts the changeable field set to privateHorseName only. It carries an
// allowedHorseFields list (mandatory for trainees); hasPrivateHorse and
// assignedHorseName are NOT in it, so any change to them fails closed.
const traineePolicy = { actorKind: "trainee", allowFutureEffectiveDates: false, allowedDomain: "horse", allowedHorseFields: ["privateHorseName"], cutover: TODAY };
const FUTURE = "2026-07-25";

const EMPTY = { hasPrivateHorse: false, privateHorseName: null, assignedHorseName: null };
const BELLA = { hasPrivateHorse: false, privateHorseName: null, assignedHorseName: "Bella" };
const STAR = { hasPrivateHorse: true, privateHorseName: "Star", assignedHorseName: null };
const COMET = { hasPrivateHorse: true, privateHorseName: "Comet", assignedHorseName: null };
const STAR_NONAME = { hasPrivateHorse: true, privateHorseName: null, assignedHorseName: null };

function d(key) { return new Date(key + "T00:00:00.000Z"); }
function assertTrue(cond, msg) { if (!cond) throw new Error("ASSERT FAILED: " + msg); }
function sameHorse(a, b, msg) {
  if (a.hasPrivateHorse !== b.hasPrivateHorse || a.privateHorseName !== b.privateHorseName || a.assignedHorseName !== b.assignedHorseName) {
    throw new Error("HORSE MISMATCH " + msg + " got=" + JSON.stringify({ h: a.hasPrivateHorse, p: a.privateHorseName, a: a.assignedHorseName }));
  }
}

// --- synthetic fixtures (tracked for FK-safe cleanup) -----------------------
const createdStudents = [];
const createdOfferings = [];
const createdYears = [];

async function makeOffering() {
  const suffix = randomUUID();
  const year = await prisma.activityYear.create({ data: { name: "W8A5-year-" + suffix }, select: { id: true } });
  createdYears.push(year.id);
  const offering = await prisma.courseOffering.create({
    data: { activityYearId: year.id, name: "W8A5-off-" + suffix, level: 1, status: "ACTIVE", startDate: d("2026-07-01"), endDate: d("2026-12-31") },
    select: { id: true },
  });
  createdOfferings.push(offering.id);
  return offering.id;
}
async function makeStudent(cache, isActive) {
  const suffix = randomUUID();
  const s = await prisma.student.create({
    data: { firstName: "W8A5", lastName: suffix, fullName: "W8A5 " + suffix, identityNumber: "W8A5-" + suffix, isActive: isActive, hasPrivateHorse: cache.hasPrivateHorse, privateHorseName: cache.privateHorseName, assignedHorseName: cache.assignedHorseName },
    select: { id: true },
  });
  createdStudents.push(s.id);
  return s.id;
}
async function makeEnrollment(studentId, offeringId, status, cache) {
  const e = await prisma.courseEnrollment.create({
    data: { studentId: studentId, courseOfferingId: offeringId, status: status, isPrimary: true, startDate: d("2026-07-01"), hasPrivateHorse: cache.hasPrivateHorse, privateHorseName: cache.privateHorseName, assignedHorseName: cache.assignedHorseName },
    select: { id: true },
  });
  return e.id;
}
async function seedHistory(studentId, enrollmentId, from, to, horse) {
  const h = await prisma.traineeHorseAssignment.create({
    data: { studentId: studentId, courseEnrollmentId: enrollmentId, hasPrivateHorse: horse.hasPrivateHorse, privateHorseName: horse.privateHorseName, assignedHorseName: horse.assignedHorseName, effectiveFrom: d(from), effectiveTo: to === null ? null : d(to) },
    select: { id: true },
  });
  return h.id;
}
async function fetchState(studentId, enrollmentId) {
  const stu = await prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { hasPrivateHorse: true, privateHorseName: true, assignedHorseName: true } });
  const enr = await prisma.courseEnrollment.findUniqueOrThrow({ where: { id: enrollmentId }, select: { hasPrivateHorse: true, privateHorseName: true, assignedHorseName: true } });
  const rows = await prisma.traineeHorseAssignment.findMany({ where: { studentId: studentId }, orderBy: { effectiveFrom: "asc" }, select: { id: true, courseEnrollmentId: true, hasPrivateHorse: true, privateHorseName: true, assignedHorseName: true, effectiveFrom: true, effectiveTo: true } });
  return { stu: stu, enr: enr, rows: rows };
}
async function cleanupAll() {
  for (const sid of createdStudents) {
    await prisma.traineeHorseAssignment.deleteMany({ where: { studentId: sid } });
    await prisma.courseEnrollment.deleteMany({ where: { studentId: sid } });
    await prisma.student.deleteMany({ where: { id: sid } });
  }
  for (const oid of createdOfferings) { await prisma.courseOffering.deleteMany({ where: { id: oid } }); }
  for (const yid of createdYears) { await prisma.activityYear.deleteMany({ where: { id: yid } }); }
}

// Temporarily wrap prisma.$transaction so a chosen tx delegate's .update always
// throws, to prove the single transaction rolls back ALL work (history + both
// caches). Restores the original on teardown. Same singleton instance the engine
// imports, so the interactive-transaction client it receives is the proxied one.
function installUpdateFailure(delegateName) {
  const orig = prisma.$transaction.bind(prisma);
  prisma.$transaction = function (arg, opts) {
    if (typeof arg !== "function") { return orig(arg, opts); }
    return orig(async function (tx) {
      const proxied = new Proxy(tx, {
        get: function (target, prop) {
          if (prop === delegateName) {
            const delegate = target[prop];
            return new Proxy(delegate, {
              get: function (dTarget, dProp) {
                if (dProp === "update") {
                  return async function () { throw new Error("INJECTED_" + delegateName + "_UPDATE_FAIL"); };
                }
                const dv = dTarget[dProp];
                return typeof dv === "function" ? dv.bind(dTarget) : dv;
              },
            });
          }
          const v = target[prop];
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
      return arg(proxied);
    }, opts);
  };
  return function restore() { prisma.$transaction = orig; };
}

try {
  // ---- T1/T2/T4: exact enrollment resolution + later-append linked to it. ----
  {
    const off = await makeOffering();
    const sid = await makeStudent(EMPTY, true);
    const eid = await makeEnrollment(sid, off, "ACTIVE", EMPTY);
    await seedHistory(sid, eid, "2026-07-01", null, EMPTY);

    const res = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: BELLA.hasPrivateHorse, privateHorseName: BELLA.privateHorseName, assignedHorseName: BELLA.assignedHorseName }, adminPolicy, NOW);
    assertTrue(res.ok === true && res.resolvedTodayChanged === true, "T1 later-append ok");

    // T1: the writer resolved the exact enrollment by (studentId, courseOfferingId).
    const byKey = await prisma.courseEnrollment.findUnique({ where: { studentId_courseOfferingId: { studentId: sid, courseOfferingId: off } }, select: { id: true } });
    assertTrue(byKey && byKey.id === eid, "T1 exact enrollment key resolves to eid");

    const st = await fetchState(sid, eid);
    assertTrue(st.rows.length === 2, "T4 two history rows after later append");
    const closed = st.rows[0];
    const current = st.rows[1];
    assertTrue(closed.effectiveTo && closed.effectiveTo.toISOString() === "2026-07-18T00:00:00.000Z", "T4 seeded row closed at today");
    assertTrue(closed.courseEnrollmentId === eid, "T4 closed row keeps its enrollment link");
    assertTrue(current.effectiveTo === null, "T4 new row open-ended");
    assertTrue(current.courseEnrollmentId === eid, "T2 inserted row linked to resolved enrollment");
    sameHorse(current, BELLA, "T4 new row value");
    // T5: both caches updated identically to the new value.
    sameHorse(st.stu, BELLA, "T5 student cache updated");
    sameHorse(st.enr, BELLA, "T5 enrollment cache updated");
    sameHorse(st.stu, st.enr, "T5 student and enrollment caches identical");
  }

  // ---- T3: same-day correction updates seeded interval in place, keeps link. --
  {
    const off = await makeOffering();
    const sid = await makeStudent(EMPTY, true);
    const eid = await makeEnrollment(sid, off, "ACTIVE", EMPTY);
    await seedHistory(sid, eid, TODAY, null, EMPTY);

    const res = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: STAR.hasPrivateHorse, privateHorseName: STAR.privateHorseName, assignedHorseName: STAR.assignedHorseName }, adminPolicy, NOW);
    assertTrue(res.ok === true && res.resolvedTodayChanged === true, "T3 same-day correction ok");

    const st = await fetchState(sid, eid);
    assertTrue(st.rows.length === 1, "T3 stays one row (update in place)");
    assertTrue(st.rows[0].courseEnrollmentId === eid, "T3 correction preserves enrollment link");
    sameHorse(st.rows[0], STAR, "T3 history value corrected");
    sameHorse(st.stu, STAR, "T3 student cache");
    sameHorse(st.enr, STAR, "T3 enrollment cache");
  }

  // ---- T6: pre-write Student/enrollment cache mismatch fails closed. ----------
  {
    const off = await makeOffering();
    const sid = await makeStudent(STAR, true); // Student cache corrupted vs enrollment/history
    const eid = await makeEnrollment(sid, off, "ACTIVE", EMPTY);
    await seedHistory(sid, eid, "2026-07-01", null, EMPTY);

    const res = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: BELLA.hasPrivateHorse, privateHorseName: BELLA.privateHorseName, assignedHorseName: BELLA.assignedHorseName }, adminPolicy, NOW);
    assertTrue(res.ok === false && res.code === "CACHE_MISMATCH", "T6 student/enrollment mismatch -> CACHE_MISMATCH");
    const st = await fetchState(sid, eid);
    assertTrue(st.rows.length === 1, "T6 no new row written");
    sameHorse(st.rows[0], EMPTY, "T6 history unchanged");
    sameHorse(st.stu, STAR, "T6 student cache unchanged");
    sameHorse(st.enr, EMPTY, "T6 enrollment cache unchanged");
  }

  // ---- T7: pre-write history/enrollment cache mismatch fails closed. ----------
  {
    const off = await makeOffering();
    const sid = await makeStudent(EMPTY, true);
    const eid = await makeEnrollment(sid, off, "ACTIVE", STAR); // enrollment cache corrupted vs history
    await seedHistory(sid, eid, "2026-07-01", null, EMPTY);

    const res = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: BELLA.hasPrivateHorse, privateHorseName: BELLA.privateHorseName, assignedHorseName: BELLA.assignedHorseName }, adminPolicy, NOW);
    assertTrue(res.ok === false && res.code === "CACHE_MISMATCH", "T7 history/enrollment mismatch -> CACHE_MISMATCH");
    const st = await fetchState(sid, eid);
    assertTrue(st.rows.length === 1, "T7 no new row written");
    sameHorse(st.rows[0], EMPTY, "T7 history unchanged");
    sameHorse(st.enr, STAR, "T7 enrollment cache unchanged");
  }

  // ---- T8: missing enrollment (wrong offering) fails closed, zero writes. -----
  {
    const off = await makeOffering();
    const otherOff = await makeOffering();
    const sid = await makeStudent(EMPTY, true);
    const eid = await makeEnrollment(sid, off, "ACTIVE", EMPTY);
    await seedHistory(sid, eid, "2026-07-01", null, EMPTY);

    const res = await write({ studentId: sid, courseOfferingId: otherOff, effectiveFrom: TODAY, hasPrivateHorse: BELLA.hasPrivateHorse, privateHorseName: BELLA.privateHorseName, assignedHorseName: BELLA.assignedHorseName }, adminPolicy, NOW);
    assertTrue(res.ok === false && res.code === "TRAINEE_NOT_FOUND", "T8 missing enrollment -> TRAINEE_NOT_FOUND");
    const st = await fetchState(sid, eid);
    assertTrue(st.rows.length === 1, "T8 no writes");
    sameHorse(st.rows[0], EMPTY, "T8 history unchanged");
    sameHorse(st.stu, EMPTY, "T8 student cache unchanged");
    sameHorse(st.enr, EMPTY, "T8 enrollment cache unchanged");
  }

  // ---- T9: inactive enrollment fails closed, zero writes. --------------------
  {
    const off = await makeOffering();
    const sid = await makeStudent(EMPTY, true);
    const eid = await makeEnrollment(sid, off, "INACTIVE", EMPTY);
    await seedHistory(sid, eid, "2026-07-01", null, EMPTY);

    const res = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: BELLA.hasPrivateHorse, privateHorseName: BELLA.privateHorseName, assignedHorseName: BELLA.assignedHorseName }, adminPolicy, NOW);
    assertTrue(res.ok === false && res.code === "TRAINEE_INACTIVE", "T9 inactive enrollment -> TRAINEE_INACTIVE");
    const st = await fetchState(sid, eid);
    assertTrue(st.rows.length === 1, "T9 no writes");
    sameHorse(st.rows[0], EMPTY, "T9 history unchanged");
  }

  // ---- T10: missing current history fails closed. ----------------------------
  {
    const off = await makeOffering();
    const sid = await makeStudent(EMPTY, true);
    const eid = await makeEnrollment(sid, off, "ACTIVE", EMPTY);
    // no seeded history at all

    const res = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: BELLA.hasPrivateHorse, privateHorseName: BELLA.privateHorseName, assignedHorseName: BELLA.assignedHorseName }, adminPolicy, NOW);
    assertTrue(res.ok === false && res.code === "INTERVAL_INVARIANT_FAILURE", "T10 zero current history -> INTERVAL_INVARIANT_FAILURE");
    const st = await fetchState(sid, eid);
    assertTrue(st.rows.length === 0, "T10 still zero rows");
    sameHorse(st.stu, EMPTY, "T10 student cache unchanged");
    sameHorse(st.enr, EMPTY, "T10 enrollment cache unchanged");
  }

  // ---- T11: multiple current histories fail closed. --------------------------
  {
    const off = await makeOffering();
    const sid = await makeStudent(EMPTY, true);
    const eid = await makeEnrollment(sid, off, "ACTIVE", EMPTY);
    await seedHistory(sid, eid, "2026-07-01", null, EMPTY);
    await seedHistory(sid, eid, "2026-07-10", null, EMPTY); // second open interval also covering today

    const res = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: BELLA.hasPrivateHorse, privateHorseName: BELLA.privateHorseName, assignedHorseName: BELLA.assignedHorseName }, adminPolicy, NOW);
    assertTrue(res.ok === false && res.code === "INTERVAL_INVARIANT_FAILURE", "T11 multiple current history -> INTERVAL_INVARIANT_FAILURE");
    const st = await fetchState(sid, eid);
    assertTrue(st.rows.length === 2, "T11 rows unchanged (no repair)");
  }

  // ---- T12: wrong/null history courseEnrollmentId fails closed. ---------------
  {
    const off = await makeOffering();
    const sid = await makeStudent(EMPTY, true);
    const eid = await makeEnrollment(sid, off, "ACTIVE", EMPTY);
    await seedHistory(sid, null, "2026-07-01", null, EMPTY); // current history unlinked

    const res = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: BELLA.hasPrivateHorse, privateHorseName: BELLA.privateHorseName, assignedHorseName: BELLA.assignedHorseName }, adminPolicy, NOW);
    assertTrue(res.ok === false && res.code === "INTERVAL_INVARIANT_FAILURE", "T12 wrong/null link -> INTERVAL_INVARIANT_FAILURE");
    const st = await fetchState(sid, eid);
    assertTrue(st.rows.length === 1 && st.rows[0].courseEnrollmentId === null, "T12 link not silently corrected");
    sameHorse(st.stu, EMPTY, "T12 student cache unchanged");
    sameHorse(st.enr, EMPTY, "T12 enrollment cache unchanged");
  }

  // ---- T13: a failing CourseEnrollment cache update rolls back everything. ----
  {
    const off = await makeOffering();
    const sid = await makeStudent(EMPTY, true);
    const eid = await makeEnrollment(sid, off, "ACTIVE", EMPTY);
    await seedHistory(sid, eid, "2026-07-01", null, EMPTY);

    const restore = installUpdateFailure("courseEnrollment");
    let res;
    try {
      res = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: BELLA.hasPrivateHorse, privateHorseName: BELLA.privateHorseName, assignedHorseName: BELLA.assignedHorseName }, adminPolicy, NOW);
    } finally {
      restore();
    }
    assertTrue(res.ok === false && res.code === "TRANSACTION_FAILURE", "T13 CE cache failure -> TRANSACTION_FAILURE");
    const st = await fetchState(sid, eid);
    assertTrue(st.rows.length === 1, "T13 history rolled back (no new row, seeded not closed)");
    assertTrue(st.rows[0].effectiveTo === null && st.rows[0].courseEnrollmentId === eid, "T13 seeded interval intact");
    sameHorse(st.rows[0], EMPTY, "T13 history value intact");
    sameHorse(st.stu, EMPTY, "T13 student cache rolled back");
    sameHorse(st.enr, EMPTY, "T13 enrollment cache unchanged");
  }

  // ---- T14: a failing Student cache update rolls back everything. -------------
  {
    const off = await makeOffering();
    const sid = await makeStudent(EMPTY, true);
    const eid = await makeEnrollment(sid, off, "ACTIVE", EMPTY);
    await seedHistory(sid, eid, "2026-07-01", null, EMPTY);

    const restore = installUpdateFailure("student");
    let res;
    try {
      res = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: BELLA.hasPrivateHorse, privateHorseName: BELLA.privateHorseName, assignedHorseName: BELLA.assignedHorseName }, adminPolicy, NOW);
    } finally {
      restore();
    }
    assertTrue(res.ok === false && res.code === "TRANSACTION_FAILURE", "T14 Student cache failure -> TRANSACTION_FAILURE");
    const st = await fetchState(sid, eid);
    assertTrue(st.rows.length === 1, "T14 history rolled back");
    assertTrue(st.rows[0].effectiveTo === null && st.rows[0].courseEnrollmentId === eid, "T14 seeded interval intact");
    sameHorse(st.stu, EMPTY, "T14 student cache unchanged");
    sameHorse(st.enr, EMPTY, "T14 enrollment cache rolled back");
  }

  // ---- T15: no module-level cross-request state (two concurrent writes). ------
  {
    const off = await makeOffering();
    const sid1 = await makeStudent(EMPTY, true);
    const eid1 = await makeEnrollment(sid1, off, "ACTIVE", EMPTY);
    await seedHistory(sid1, eid1, "2026-07-01", null, EMPTY);
    const sid2 = await makeStudent(EMPTY, true);
    const eid2 = await makeEnrollment(sid2, off, "ACTIVE", EMPTY);
    await seedHistory(sid2, eid2, "2026-07-01", null, EMPTY);

    const [r1, r2] = await Promise.all([
      write({ studentId: sid1, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: BELLA.hasPrivateHorse, privateHorseName: BELLA.privateHorseName, assignedHorseName: BELLA.assignedHorseName }, adminPolicy, NOW),
      write({ studentId: sid2, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: STAR.hasPrivateHorse, privateHorseName: STAR.privateHorseName, assignedHorseName: STAR.assignedHorseName }, adminPolicy, NOW),
    ]);
    assertTrue(r1.ok === true && r2.ok === true, "T15 both concurrent writes ok");

    const st1 = await fetchState(sid1, eid1);
    const st2 = await fetchState(sid2, eid2);
    const cur1 = st1.rows[st1.rows.length - 1];
    const cur2 = st2.rows[st2.rows.length - 1];
    assertTrue(cur1.courseEnrollmentId === eid1, "T15 student1 new row linked to enrollment1");
    assertTrue(cur2.courseEnrollmentId === eid2, "T15 student2 new row linked to enrollment2");
    sameHorse(cur1, BELLA, "T15 student1 value");
    sameHorse(cur2, STAR, "T15 student2 value");
    sameHorse(st1.enr, BELLA, "T15 enrollment1 cache");
    sameHorse(st2.enr, STAR, "T15 enrollment2 cache");
  }

  // ---- T16: no instructor/trainee writer functions in this service module. ----
  assertTrue(!horseMod.updateStudentHorseInfoAsInstructor && !horseMod.updateOwnPrivateHorseName, "T16 service exposes no instructor/trainee writers");

  // ---- T17 (regression): forbidden field for a trainee policy -> no write. -----
  {
    const off = await makeOffering();
    const sid = await makeStudent(EMPTY, true);
    const eid = await makeEnrollment(sid, off, "ACTIVE", EMPTY);
    await seedHistory(sid, eid, "2026-07-01", null, EMPTY);
    const traineePolicy = { actorKind: "trainee", allowFutureEffectiveDates: false, allowedDomain: "horse", allowedHorseFields: ["hasPrivateHorse"], cutover: TODAY };

    const res = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: false, privateHorseName: null, assignedHorseName: "Rocky" }, traineePolicy, NOW);
    assertTrue(res.ok === false && res.code === "UNAUTHORIZED_ACTOR", "T17 forbidden field -> UNAUTHORIZED_ACTOR");
    const st = await fetchState(sid, eid);
    assertTrue(st.rows.length === 1, "T17 no history row written on forbidden field change");
    sameHorse(st.rows[0], EMPTY, "T17 history unchanged");
  }

  // ---- T18 (W8A-6): instructor policy writes all three fields via SAME service.
  // Proves the instructor path (no field restriction) maintains dated history
  // linked to the resolved enrollment plus both caches, identically to admin.
  {
    const off = await makeOffering();
    const sid = await makeStudent(EMPTY, true);
    const eid = await makeEnrollment(sid, off, "ACTIVE", EMPTY);
    await seedHistory(sid, eid, "2026-07-01", null, EMPTY);

    // assigned-name path
    const r1 = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: BELLA.hasPrivateHorse, privateHorseName: BELLA.privateHorseName, assignedHorseName: BELLA.assignedHorseName }, instructorPolicy, NOW);
    assertTrue(r1.ok === true && r1.resolvedTodayChanged === true, "T18 instructor assigned-name write ok");
    let st = await fetchState(sid, eid);
    const cur1 = st.rows[st.rows.length - 1];
    assertTrue(cur1.courseEnrollmentId === eid, "T18 instructor inserted row linked to resolved enrollment");
    sameHorse(cur1, BELLA, "T18 instructor history value");
    sameHorse(st.stu, BELLA, "T18 instructor student cache updated");
    sameHorse(st.enr, BELLA, "T18 instructor enrollment cache updated");
    sameHorse(st.stu, st.enr, "T18 instructor caches identical");

    // private-horse path (same-day correction), proving hasPrivateHorse +
    // privateHorseName are also permitted for the instructor policy.
    const r2 = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: STAR.hasPrivateHorse, privateHorseName: STAR.privateHorseName, assignedHorseName: STAR.assignedHorseName }, instructorPolicy, NOW);
    assertTrue(r2.ok === true, "T18 instructor private-horse write ok");
    st = await fetchState(sid, eid);
    sameHorse(st.rows[st.rows.length - 1], STAR, "T18 instructor private-horse history value");
    sameHorse(st.stu, STAR, "T18 instructor private-horse student cache");
    sameHorse(st.enr, STAR, "T18 instructor private-horse enrollment cache");
  }

  // ---- T19 (W8A-6): instructor future effective date is denied, zero writes. ---
  // The action never sends a future date, but this pins the policy invariant that
  // an instructor future write fails closed with its dedicated code.
  {
    const off = await makeOffering();
    const sid = await makeStudent(EMPTY, true);
    const eid = await makeEnrollment(sid, off, "ACTIVE", EMPTY);
    await seedHistory(sid, eid, "2026-07-01", null, EMPTY);

    const res = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: FUTURE, hasPrivateHorse: BELLA.hasPrivateHorse, privateHorseName: BELLA.privateHorseName, assignedHorseName: BELLA.assignedHorseName }, instructorPolicy, NOW);
    assertTrue(res.ok === false && res.code === "INSTRUCTOR_FUTURE_CHANGE", "T19 instructor future date -> INSTRUCTOR_FUTURE_CHANGE");
    const st = await fetchState(sid, eid);
    assertTrue(st.rows.length === 1, "T19 no history row written");
    sameHorse(st.rows[0], EMPTY, "T19 history unchanged");
    sameHorse(st.stu, EMPTY, "T19 student cache unchanged");
    sameHorse(st.enr, EMPTY, "T19 enrollment cache unchanged");
  }

  // ---- T20 (W8A-7): trainee policy changes ONLY privateHorseName via SAME
  // service. Seeded as a private-horse trainee (STAR); the trainee renames the
  // private horse and passes hasPrivateHorse/assignedHorseName through unchanged.
  // Proves the trainee path maintains dated history linked to the resolved
  // enrollment plus BOTH caches, identically to admin/instructor.
  {
    const off = await makeOffering();
    const sid = await makeStudent(STAR, true);
    const eid = await makeEnrollment(sid, off, "ACTIVE", STAR);
    await seedHistory(sid, eid, "2026-07-01", null, STAR);

    const res = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: STAR.hasPrivateHorse, privateHorseName: COMET.privateHorseName, assignedHorseName: STAR.assignedHorseName }, traineePolicy, NOW);
    assertTrue(res.ok === true && res.resolvedTodayChanged === true, "T20 trainee rename ok");
    const st = await fetchState(sid, eid);
    assertTrue(st.rows.length === 2, "T20 later-append (seeded row closed + new row)");
    const cur = st.rows[st.rows.length - 1];
    assertTrue(cur.courseEnrollmentId === eid, "T20 trainee inserted row linked to resolved enrollment");
    sameHorse(cur, COMET, "T20 trainee history value");
    sameHorse(st.stu, COMET, "T20 trainee student cache updated");
    sameHorse(st.enr, COMET, "T20 trainee enrollment cache updated");
    sameHorse(st.stu, st.enr, "T20 trainee caches identical");
  }

  // ---- T21 (W8A-7): trainee empty-to-null private name (action sends null after
  // trim) keeps hasPrivateHorse true, clears the name only. Canonical state 3. ---
  {
    const off = await makeOffering();
    const sid = await makeStudent(STAR, true);
    const eid = await makeEnrollment(sid, off, "ACTIVE", STAR);
    await seedHistory(sid, eid, "2026-07-01", null, STAR);

    const res = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: STAR.hasPrivateHorse, privateHorseName: null, assignedHorseName: STAR.assignedHorseName }, traineePolicy, NOW);
    assertTrue(res.ok === true, "T21 trainee clear-name ok");
    const st = await fetchState(sid, eid);
    sameHorse(st.rows[st.rows.length - 1], STAR_NONAME, "T21 trainee history value (name cleared, still private)");
    sameHorse(st.stu, STAR_NONAME, "T21 trainee student cache");
    sameHorse(st.enr, STAR_NONAME, "T21 trainee enrollment cache");
  }

  // ---- T22 (W8A-7): trainee attempt to change assignedHorseName is denied by the
  // field policy (single canonical field change), zero writes. ------------------
  {
    const off = await makeOffering();
    const sid = await makeStudent(BELLA, true);
    const eid = await makeEnrollment(sid, off, "ACTIVE", BELLA);
    await seedHistory(sid, eid, "2026-07-01", null, BELLA);

    const res = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: false, privateHorseName: null, assignedHorseName: "Rocky" }, traineePolicy, NOW);
    assertTrue(res.ok === false && res.code === "UNAUTHORIZED_ACTOR", "T22 assignedHorseName change -> UNAUTHORIZED_ACTOR");
    const st = await fetchState(sid, eid);
    assertTrue(st.rows.length === 1, "T22 no history row written");
    sameHorse(st.rows[0], BELLA, "T22 history unchanged");
    sameHorse(st.stu, BELLA, "T22 student cache unchanged");
    sameHorse(st.enr, BELLA, "T22 enrollment cache unchanged");
  }

  // ---- T23 (W8A-7): trainee attempt to turn OFF hasPrivateHorse is denied by the
  // field policy (single canonical field change), zero writes. ------------------
  {
    const off = await makeOffering();
    const sid = await makeStudent(STAR_NONAME, true);
    const eid = await makeEnrollment(sid, off, "ACTIVE", STAR_NONAME);
    await seedHistory(sid, eid, "2026-07-01", null, STAR_NONAME);

    const res = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: false, privateHorseName: null, assignedHorseName: null }, traineePolicy, NOW);
    assertTrue(res.ok === false && res.code === "UNAUTHORIZED_ACTOR", "T23 hasPrivateHorse change -> UNAUTHORIZED_ACTOR");
    const st = await fetchState(sid, eid);
    assertTrue(st.rows.length === 1, "T23 no history row written");
    sameHorse(st.rows[0], STAR_NONAME, "T23 history unchanged");
    sameHorse(st.stu, STAR_NONAME, "T23 student cache unchanged");
    sameHorse(st.enr, STAR_NONAME, "T23 enrollment cache unchanged");
  }

  // ---- T24 (W8A-7): STALE pass-through fails closed. The action passes the two
  // forbidden fields as it read them from Student pre-lock; if the locked cache
  // diverged (here the trainee became a ranch horse), the field policy denies the
  // otherwise privateHorseName-only write. Zero writes. ------------------------
  {
    const off = await makeOffering();
    const sid = await makeStudent(BELLA, true);
    const eid = await makeEnrollment(sid, off, "ACTIVE", BELLA);
    await seedHistory(sid, eid, "2026-07-01", null, BELLA);

    // Requested: canonical private-horse rename with STALE hasPrivateHorse=true /
    // assignedHorseName=null pass-through (locked cache is the ranch horse BELLA).
    const res = await write({ studentId: sid, courseOfferingId: off, effectiveFrom: TODAY, hasPrivateHorse: true, privateHorseName: "Comet", assignedHorseName: null }, traineePolicy, NOW);
    assertTrue(res.ok === false && res.code === "UNAUTHORIZED_ACTOR", "T24 stale pass-through -> UNAUTHORIZED_ACTOR");
    const st = await fetchState(sid, eid);
    assertTrue(st.rows.length === 1, "T24 no history row written");
    sameHorse(st.rows[0], BELLA, "T24 history unchanged");
    sameHorse(st.stu, BELLA, "T24 student cache unchanged");
    sameHorse(st.enr, BELLA, "T24 enrollment cache unchanged");
  }

  process.stdout.write("CHILD_RESULT_OK\n");
} finally {
  await cleanupAll();
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
    timeout: 120_000,
  });
}

// A child that exceeds the bounded timeout is terminated by spawnSync (killSignal
// SIGTERM) and reported via an ETIMEDOUT error; a clean run exits with signal
// null, so any kill-signal termination here is the timeout. Detection returns a
// boolean only — the surfaced message is fixed and never carries the URL, host,
// username, password, project ref, child env, or any credential.
function childTimedOut(result: ReturnType<typeof spawnSync>): boolean {
  const err = result.error as NodeJS.ErrnoException | undefined;
  if (err && err.code === "ETIMEDOUT") return true;
  return result.signal === "SIGTERM";
}

test("integration/horse: enrollment-scoped isolated child-process lifecycle", { skip }, () => {
  const result = runChildLifecycle();
  assert.ok(!childTimedOut(result), "integration child timed out");
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

// ============================================================================
// W8A-7 ACTION SOURCE-LEVEL CHECKS (non-DB, ALWAYS RUN)
// ----------------------------------------------------------------------------
// These pin the action-level contract of updateOwnPrivateHorseName by reading
// lib/actions/horses.ts as TEXT. They deliberately do NOT import the action (or
// @/lib/prisma) so this parent process still contacts no database and holds no
// Prisma singleton — the same isolation guarantee the child-process harness
// relies on. Assertions are scoped to the function body slice so admin/instructor
// writer code cannot satisfy them by accident.
// ============================================================================

const horsesActionSource = readFileSync(
  path.join(repoRoot, "lib", "actions", "horses.ts"),
  "utf8",
);

// Slice from the trainee action to end-of-file (it is the last exported function).
const traineeActionStart = horsesActionSource.indexOf(
  "export async function updateOwnPrivateHorseName",
);
const traineeActionSource =
  traineeActionStart === -1 ? "" : horsesActionSource.slice(traineeActionStart);

test("action/trainee: public signature is unchanged (studentId, privateHorseName) => ActionResult", () => {
  assert.ok(traineeActionStart !== -1, "updateOwnPrivateHorseName not found in horses.ts");
  assert.match(
    traineeActionSource,
    /export async function updateOwnPrivateHorseName\(\s*studentId: string,\s*privateHorseName: string\s*\): Promise<ActionResult>/,
    "trainee action signature changed",
  );
  // No smuggled offering/effective-date/client params.
  const header = traineeActionSource.slice(0, traineeActionSource.indexOf(") {") + 3);
  assert.ok(!/courseOfferingId\s*:/.test(header), "signature must not accept courseOfferingId");
  assert.ok(!/effective\w*\s*:/i.test(header), "signature must not accept an effective-date param");
});

test("action/trainee: existing Student prechecks and exact Hebrew messages retained", () => {
  assert.match(traineeActionSource, /if \(!student \|\| !student\.isActive\)/, "missing/inactive precheck removed");
  assert.ok(traineeActionSource.includes("חניך/ה לא נמצא/ה"), "missing/inactive message changed");
  assert.match(traineeActionSource, /if \(!student\.hasPrivateHorse\)/, "hasPrivateHorse precheck removed");
  assert.ok(traineeActionSource.includes("לא סומן/ה כבעל/ת סוס פרטי"), "hasPrivateHorse message changed");
});

test("action/trainee: no direct prisma.student.update remains in the trainee writer", () => {
  assert.ok(
    !/prisma\.student\.update/.test(traineeActionSource),
    "updateOwnPrivateHorseName must not write Student directly",
  );
  // Belt and suspenders: the whole action module no longer writes Student directly
  // (admin + instructor + trainee all go through the service now).
  assert.ok(
    !/prisma\.student\.update/.test(horsesActionSource),
    "no horse action may write Student directly",
  );
});

test("action/trainee: trainee WritePolicy restricts changes to privateHorseName only", () => {
  assert.match(traineeActionSource, /actorKind:\s*"trainee"/, "policy must use the trainee actor kind");
  assert.match(traineeActionSource, /allowFutureEffectiveDates:\s*false/, "trainee policy must forbid future dates");
  assert.match(traineeActionSource, /allowedDomain:\s*"horse"/, "trainee policy must be horse-domain");
  assert.match(
    traineeActionSource,
    /allowedHorseFields:\s*\["privateHorseName"\]/,
    "trainee policy must hard-restrict to privateHorseName",
  );
});

test("action/trainee: normalizes name (trim/empty->null) and passes forbidden fields through unchanged", () => {
  assert.match(
    traineeActionSource,
    /privateHorseName:\s*privateHorseName\.trim\(\) \|\| null/,
    "requested private name must be trimmed with empty->null",
  );
  assert.match(
    traineeActionSource,
    /assignedHorseName:\s*student\.assignedHorseName/,
    "assignedHorseName must be passed through from the read Student",
  );
  assert.match(
    traineeActionSource,
    /hasPrivateHorse:\s*student\.hasPrivateHorse/,
    "hasPrivateHorse must be passed through from the read Student",
  );
});

test("action/trainee: current offering is server-resolved and the service is used", () => {
  assert.match(traineeActionSource, /resolveCurrentCourseOffering\(\)/, "offering must be resolved server-side");
  assert.ok(
    !/courseOfferingId\s*=\s*[^;]*args|params/.test(traineeActionSource),
    "courseOfferingId must never come from client args",
  );
  assert.match(traineeActionSource, /writeTraineeHorseAssignment\(/, "trainee action must call the shared service");
});
