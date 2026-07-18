/**
 * MULTI-COURSE W5B1 - focused tests for the enrollment-backed student contact
 * directory pilot (lib/actions/contacts.ts -> getStudentContacts).
 *
 * These exercise the dependency-injected orchestration `loadStudentContactsWithDeps`
 * with plain fakes, so no Next.js cookies and no live Prisma are needed. They lock
 * the W5B1 contract:
 *  - authorization is preserved exactly (getCurrentInstructor -> mayAccess -> []);
 *  - a trainee / anonymous caller (null instructor actor) gets [];
 *  - the roster source is the enrollment DAL, mapped to the EXACT StudentContactRow
 *    shape in the reviewed W5B0 order;
 *  - resolver ambiguity, membership anomalies, and duplicate ids FAIL LOUDLY and
 *    never fall back to the legacy global roster.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/contacts.student-directory.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// The dependency-injected orchestration is imported from the NON-"use server"
// core module (never from ./contacts), so these pure tests never pull in
// Next.js cookie/session code or Prisma. The public server actions
// getStudentContacts / getInstructorContacts still come from ./contacts.
import {
  loadStudentContactsWithDeps,
  type StudentContactsDeps,
  type StudentContactRow,
} from "./contacts-student-directory";
import { getStudentContacts, getInstructorContacts } from "./contacts";
import type {
  EnrolledTraineeView,
  EnrollmentRosterResult,
  EnrollmentMembershipAnomaly,
} from "@/lib/course/enrollment-view";
import { AmbiguousCourseOfferingError } from "@/lib/course/current-offering";

const AS_OF = new Date("2026-07-19T12:00:00.000Z");

// --- fixtures ---------------------------------------------------------------

function traineeView(
  id: string,
  groupName: string | null,
  subgroupNumber: number | null,
  lastName: string,
  phone: string | null = null,
): EnrolledTraineeView {
  return {
    id,
    fullName: `full ${id}`,
    lastName,
    phone,
    groupName,
    subgroupNumber,
    enrollmentStatus: "ACTIVE",
    isPrimary: false,
  };
}

function roster(
  rows: EnrolledTraineeView[],
  anomalies: EnrollmentMembershipAnomaly[] = [],
): EnrollmentRosterResult {
  return { rows, anomalies };
}

function makeDeps(overrides: Partial<StudentContactsDeps> = {}): StudentContactsDeps {
  return {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    resolveCurrentCourseOffering: async () => ({ id: "offering-1" }),
    getCurrentCourseEnrollmentRoster: async () => roster([]),
    now: () => AS_OF,
    ...overrides,
  };
}

const CONTACT_ROW_KEYS = [
  "fullName",
  "groupName",
  "id",
  "lastName",
  "phone",
  "subgroupNumber",
].sort();

// --- authorized mapping -----------------------------------------------------

test("authorized: maps the enrollment roster to StudentContactRow-compatible rows", async () => {
  const rows = await loadStudentContactsWithDeps(
    makeDeps({
      getCurrentCourseEnrollmentRoster: async () =>
        roster([
          traineeView("s1", "א", 1, "אבן", "050-1111111"),
          traineeView("s2", "ב", 2, "כהן", null),
        ]),
    }),
  );
  assert.deepEqual(rows, [
    { id: "s1", fullName: "full s1", lastName: "אבן", groupName: "א", subgroupNumber: 1, phone: "050-1111111" },
    { id: "s2", fullName: "full s2", lastName: "כהן", groupName: "ב", subgroupNumber: 2, phone: null },
  ]);
});

test("authorized: output rows carry EXACTLY the six contract keys (no extras)", async () => {
  const rows = await loadStudentContactsWithDeps(
    makeDeps({
      getCurrentCourseEnrollmentRoster: async () =>
        roster([traineeView("s1", "א", null, "אבן")]),
    }),
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), CONTACT_ROW_KEYS);
});

test("authorized: null phone stays null; null subgroup stays null", async () => {
  const rows = await loadStudentContactsWithDeps(
    makeDeps({
      getCurrentCourseEnrollmentRoster: async () =>
        roster([traineeView("s1", "א", null, "אבן", null)]),
    }),
  );
  assert.equal(rows[0].phone, null);
  assert.equal(rows[0].subgroupNumber, null);
});

test("authorized: ordering is taken from the W5B0 roster and never re-sorted", async () => {
  // Rows arrive already sorted by compareTraineeView; the mapping must preserve
  // that exact order (here s2 before s1, deliberately not alphabetical by id).
  const rows = await loadStudentContactsWithDeps(
    makeDeps({
      getCurrentCourseEnrollmentRoster: async () =>
        roster([traineeView("s2", "א", 1, "אבן"), traineeView("s1", "ב", 1, "כהן")]),
    }),
  );
  assert.deepEqual(rows.map((r: StudentContactRow) => r.id), ["s2", "s1"]);
});

test("authorized: a single asOf is captured and passed to the roster DAL", async () => {
  let capturedOffering: string | null = null;
  let capturedAsOf: Date | null = null;
  await loadStudentContactsWithDeps(
    makeDeps({
      resolveCurrentCourseOffering: async () => ({ id: "offering-XYZ" }),
      now: () => AS_OF,
      getCurrentCourseEnrollmentRoster: async (offeringId, options) => {
        capturedOffering = offeringId;
        capturedAsOf = options.asOf;
        return roster([]);
      },
    }),
  );
  assert.equal(capturedOffering, "offering-XYZ");
  assert.equal(capturedAsOf, AS_OF);
});

// --- authorization preserved ------------------------------------------------

test("unauthorized: a null instructor actor returns [] without touching the roster", async () => {
  let resolverCalled = false;
  let rosterCalled = false;
  const rows = await loadStudentContactsWithDeps(
    makeDeps({
      getCurrentInstructor: async () => null,
      resolveCurrentCourseOffering: async () => {
        resolverCalled = true;
        return { id: "offering-1" };
      },
      getCurrentCourseEnrollmentRoster: async () => {
        rosterCalled = true;
        return roster([]);
      },
    }),
  );
  assert.deepEqual(rows, []);
  assert.equal(resolverCalled, false, "must not resolve an offering when unauthorized");
  assert.equal(rosterCalled, false, "must not read the roster when unauthorized");
});

test("trainee/anonymous: instructor-only gate yields [] (no student PII)", async () => {
  // A trainee or anonymous session collapses to a null instructor actor upstream;
  // the student directory gate is instructor-only, so access is denied with [].
  const rows = await loadStudentContactsWithDeps(
    makeDeps({ getCurrentInstructor: async () => null }),
  );
  assert.deepEqual(rows, []);
});

// --- failures never fall back to the legacy global roster -------------------

test("resolver ambiguity throws and does NOT fall back to a legacy roster", async () => {
  let rosterCalled = false;
  await assert.rejects(
    () =>
      loadStudentContactsWithDeps(
        makeDeps({
          resolveCurrentCourseOffering: async () => {
            throw new AmbiguousCourseOfferingError(["offering-1", "offering-2"]);
          },
          getCurrentCourseEnrollmentRoster: async () => {
            rosterCalled = true;
            return roster([]);
          },
        }),
      ),
    /Ambiguous current CourseOffering/,
  );
  assert.equal(rosterCalled, false, "ambiguity must abort before any roster read");
});

test("a membership anomaly throws and does NOT fall back to a legacy roster", async () => {
  const anomaly: EnrollmentMembershipAnomaly = {
    enrollmentId: "e9",
    studentId: "s9",
    kind: "NO_CURRENT_MEMBERSHIP",
    currentMembershipCount: 0,
  };
  await assert.rejects(
    () =>
      loadStudentContactsWithDeps(
        makeDeps({
          getCurrentCourseEnrollmentRoster: async () =>
            roster([traineeView("s1", "א", 1, "אבן")], [anomaly]),
        }),
      ),
    /membership\s+anomaly/,
  );
});

test("a malformed-subgroup anomaly throws (never degrades to the global roster)", async () => {
  const anomaly: EnrollmentMembershipAnomaly = {
    enrollmentId: "e1",
    studentId: "s1",
    kind: "MALFORMED_SUBGROUP",
    currentMembershipCount: 1,
  };
  await assert.rejects(
    () =>
      loadStudentContactsWithDeps(
        makeDeps({ getCurrentCourseEnrollmentRoster: async () => roster([], [anomaly]) }),
      ),
    /MALFORMED_SUBGROUP/,
  );
});

test("a duplicate student id does NOT pass silently (throws)", async () => {
  await assert.rejects(
    () =>
      loadStudentContactsWithDeps(
        makeDeps({
          getCurrentCourseEnrollmentRoster: async () =>
            roster([traineeView("s1", "א", 1, "אבן"), traineeView("s1", "א", 1, "אבן")]),
        }),
      ),
    /duplicate student id/,
  );
});

test("a DAL failure propagates (not swallowed into [])", async () => {
  await assert.rejects(
    () =>
      loadStudentContactsWithDeps(
        makeDeps({
          getCurrentCourseEnrollmentRoster: async () => {
            throw new Error("simulated Prisma failure");
          },
        }),
      ),
    /simulated Prisma failure/,
  );
});

// --- surrounding contract unchanged ----------------------------------------

test("getStudentContacts keeps its no-argument signature", () => {
  assert.equal(typeof getStudentContacts, "function");
  assert.equal(getStudentContacts.length, 0);
});

test("getInstructorContacts remains exported and unchanged (no-arg)", () => {
  assert.equal(typeof getInstructorContacts, "function");
  assert.equal(getInstructorContacts.length, 0);
});

// --- module purity: no Next cookie/session or Prisma at runtime -------------

test("the core orchestration module pulls no Next.js cookie/session or Prisma code", () => {
  // Structural guard on the core module's OWN import graph: everything impure is
  // injected via StudentContactsDeps, so its only runtime (value) import must be
  // the pure audience-gate predicate. A type-only import (e.g. EnrollmentRosterResult)
  // is erased and irrelevant. This fails loudly if a future edit reaches for
  // next/headers, next/cookies, Prisma, or the session/actor DAL.
  const corePath = fileURLToPath(new URL("./contacts-student-directory.ts", import.meta.url));
  const src = readFileSync(corePath, "utf8");
  const valueImports = [
    ...src.matchAll(/^\s*import\s+(?!type\b)[^\n]*?from\s*["']([^"']+)["']/gm),
  ].map((m) => m[1]);
  const bareImports = [...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  const runtimeSpecifiers = [...valueImports, ...bareImports];
  assert.deepEqual(runtimeSpecifiers, ["@/lib/auth/contact-directory-access"]);
  for (const spec of runtimeSpecifiers) {
    assert.ok(
      !/next\/(headers|cookies)|prisma|auth\/(actor|session)/.test(spec),
      `core module must not import ${spec}`,
    );
  }
});
