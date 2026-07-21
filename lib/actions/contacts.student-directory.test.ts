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
} from "./contacts-student-directory";
import {
  getStudentContacts,
  getInstructorContacts,
  type StudentContactRow,
} from "./contacts";
import type {
  EnrolledTraineeView,
  EnrollmentRosterResult,
  EnrollmentMembershipAnomaly,
} from "@/lib/course/enrollment-view";
import { AmbiguousCourseOfferingError } from "@/lib/course/current-offering";
import { CAPABILITY_KEYS, type CapabilityKey } from "@/lib/course/capabilities/capability-keys";
import type { EffectiveCapabilityStatus } from "@/lib/course/capabilities/effective-capability-core";

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

// Exhaustive all-ENABLED effective map, written as an explicit object literal
// annotated Record<CapabilityKey, EffectiveCapabilityStatus>. TypeScript rejects
// this literal at COMPILE TIME if any canonical key is missing, so it is a
// genuinely exhaustive fixture with NO `as any` / partial / suppressing cast (an
// Object.fromEntries build over CAPABILITY_KEYS does not type-check here: its
// index-signature result is not assignable to the specific-key Record — TS2740).
// This mirrors the app's own exhaustive-per-key pattern (INITIAL_CAPABILITY_LABELS).
// The "fixture is exhaustive over CAPABILITY_KEYS" test below is the runtime
// tripwire that keeps this literal in lock-step with the canonical key set.
const ALL_ENABLED_CAPABILITIES: Record<CapabilityKey, EffectiveCapabilityStatus> = {
  SCHEDULE: "ENABLED",
  CONTACTS: "ENABLED",
  MESSAGES: "ENABLED",
  ATTENDANCE: "ENABLED",
  DUTIES: "ENABLED",
  RIDING: "ENABLED",
  PROGRESS_RIDING: "ENABLED",
  RIDING_HORSE_ASSIGNMENTS: "ENABLED",
  ADVANCED_INSTRUCTION: "ENABLED",
  TEACHING_PRACTICE: "ENABLED",
};

// Every capability defaults to ENABLED so the pre-existing tests keep exercising
// their prior behaviour unchanged; each capability test overrides only the single
// key it exercises (e.g. { CONTACTS: "DISABLED" }).
function effectiveCapabilities(
  overrides: Partial<Record<CapabilityKey, EffectiveCapabilityStatus>> = {},
): Record<CapabilityKey, EffectiveCapabilityStatus> {
  return { ...ALL_ENABLED_CAPABILITIES, ...overrides };
}

function makeDeps(overrides: Partial<StudentContactsDeps> = {}): StudentContactsDeps {
  return {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    resolveCurrentCourseOffering: async () => ({ id: "offering-1" }),
    getEffectiveCapabilities: async () => effectiveCapabilities(),
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

// --- capability enforcement (Multi-Course Stage 2: CONTACTS) ----------------

test("fixture: the default capability map is exhaustive over CAPABILITY_KEYS", () => {
  // Runtime tripwire tying the compile-time-checked literal to the canonical key
  // set: if a capability key is ever added/removed, this fails until the fixture
  // is updated, so the "exhaustive map" guarantee cannot silently drift.
  assert.deepEqual(Object.keys(ALL_ENABLED_CAPABILITIES).sort(), [...CAPABILITY_KEYS].sort());
  for (const key of CAPABILITY_KEYS) {
    assert.equal(ALL_ENABLED_CAPABILITIES[key], "ENABLED");
  }
});

test("capability: unauthorized actor returns [] and calls neither resolver, caps, nor roster", async () => {
  let resolverCalled = false;
  let capsCalled = false;
  let rosterCalled = false;
  const rows = await loadStudentContactsWithDeps(
    makeDeps({
      getCurrentInstructor: async () => null,
      resolveCurrentCourseOffering: async () => {
        resolverCalled = true;
        return { id: "offering-1" };
      },
      getEffectiveCapabilities: async () => {
        capsCalled = true;
        return effectiveCapabilities();
      },
      getCurrentCourseEnrollmentRoster: async () => {
        rosterCalled = true;
        return roster([]);
      },
    }),
  );
  assert.deepEqual(rows, []);
  assert.equal(resolverCalled, false, "must not resolve an offering when unauthorized");
  assert.equal(capsCalled, false, "must not read capabilities when unauthorized");
  assert.equal(rosterCalled, false, "must not read the roster when unauthorized");
});

test("capability: ENABLED passes the trusted offering.id to caps + roster and returns the full roster", async () => {
  let capsOfferingId: string | null = null;
  let rosterOfferingId: string | null = null;
  let rosterAsOf: Date | null = null;
  const rows = await loadStudentContactsWithDeps(
    makeDeps({
      resolveCurrentCourseOffering: async () => ({ id: "offering-ENABLED" }),
      now: () => AS_OF,
      getEffectiveCapabilities: async (offeringId) => {
        capsOfferingId = offeringId;
        return effectiveCapabilities({ CONTACTS: "ENABLED" });
      },
      getCurrentCourseEnrollmentRoster: async (offeringId, options) => {
        rosterOfferingId = offeringId;
        rosterAsOf = options.asOf;
        return roster([
          traineeView("s1", "א", 1, "אבן", "050-1111111"),
          traineeView("s2", "ב", 2, "כהן", null),
        ]);
      },
    }),
  );
  // The capability lookup and the roster read both receive EXACTLY the trusted
  // offering.id from resolveCurrentCourseOffering, with the existing asOf.
  assert.equal(capsOfferingId, "offering-ENABLED");
  assert.equal(rosterOfferingId, "offering-ENABLED");
  assert.equal(rosterAsOf, AS_OF);
  assert.deepEqual(rows, [
    { id: "s1", fullName: "full s1", lastName: "אבן", groupName: "א", subgroupNumber: 1, phone: "050-1111111" },
    { id: "s2", fullName: "full s2", lastName: "כהן", groupName: "ב", subgroupNumber: 2, phone: null },
  ]);
});

test("capability: READ_ONLY behaves exactly like ENABLED (roster served, not blocked)", async () => {
  let rosterCalled = false;
  const rows = await loadStudentContactsWithDeps(
    makeDeps({
      getEffectiveCapabilities: async () => effectiveCapabilities({ CONTACTS: "READ_ONLY" }),
      getCurrentCourseEnrollmentRoster: async () => {
        rosterCalled = true;
        return roster([traineeView("s1", "א", 1, "אבן")]);
      },
    }),
  );
  assert.equal(rosterCalled, true, "READ_ONLY must NOT be blocked on a read-only surface");
  assert.deepEqual(rows.map((r: StudentContactRow) => r.id), ["s1"]);
});

test("capability: DISABLED returns [] and never reads the roster", async () => {
  let rosterCalled = false;
  const rows = await loadStudentContactsWithDeps(
    makeDeps({
      getEffectiveCapabilities: async () => effectiveCapabilities({ CONTACTS: "DISABLED" }),
      getCurrentCourseEnrollmentRoster: async () => {
        rosterCalled = true;
        return roster([traineeView("s1", "א", 1, "אבן", "050-1111111")]);
      },
    }),
  );
  assert.deepEqual(rows, []);
  assert.equal(rosterCalled, false, "DISABLED must block before any roster / PII read");
});

test("capability: an offering-resolution failure propagates before caps or roster", async () => {
  let capsCalled = false;
  let rosterCalled = false;
  await assert.rejects(
    () =>
      loadStudentContactsWithDeps(
        makeDeps({
          resolveCurrentCourseOffering: async () => {
            throw new AmbiguousCourseOfferingError(["offering-1", "offering-2"]);
          },
          getEffectiveCapabilities: async () => {
            capsCalled = true;
            return effectiveCapabilities();
          },
          getCurrentCourseEnrollmentRoster: async () => {
            rosterCalled = true;
            return roster([]);
          },
        }),
      ),
    /Ambiguous current CourseOffering/,
  );
  assert.equal(capsCalled, false, "offering failure must abort before the capability lookup");
  assert.equal(rosterCalled, false, "offering failure must abort before any roster read");
});

test("capability: a capability-reader failure propagates and never falls open to the roster", async () => {
  let rosterCalled = false;
  await assert.rejects(
    () =>
      loadStudentContactsWithDeps(
        makeDeps({
          getEffectiveCapabilities: async () => {
            throw new Error("simulated capability-reader failure");
          },
          getCurrentCourseEnrollmentRoster: async () => {
            rosterCalled = true;
            return roster([traineeView("s1", "א", 1, "אבן")]);
          },
        }),
      ),
    /simulated capability-reader failure/,
  );
  assert.equal(rosterCalled, false, "a capability-reader failure must not fail open to the roster");
});

test("capability: strict call order actor -> offering -> capability -> roster", async () => {
  const calls: string[] = [];
  await loadStudentContactsWithDeps(
    makeDeps({
      getCurrentInstructor: async () => {
        calls.push("actor");
        return { id: "instructor-1" };
      },
      resolveCurrentCourseOffering: async () => {
        calls.push("offering");
        return { id: "offering-1" };
      },
      getEffectiveCapabilities: async () => {
        calls.push("capability");
        return effectiveCapabilities();
      },
      getCurrentCourseEnrollmentRoster: async () => {
        calls.push("roster");
        return roster([]);
      },
    }),
  );
  assert.deepEqual(calls, ["actor", "offering", "capability", "roster"]);
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
