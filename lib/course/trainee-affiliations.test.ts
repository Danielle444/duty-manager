/**
 * MULTI-COURSE (course-affiliation display slice A1) - DB-free tests for the admin
 * trainee-affiliations reader.
 *
 * Run with: npx tsx --test lib/course/trainee-affiliations.test.ts
 * No Prisma, no DB: the single Student read is injected as a fake that records the
 * exact query it receives, so these tests prove there is exactly ONE query (no
 * N+1), a minimal privacy-narrow select, a minimal nested affiliation relation,
 * no group-membership / horse / schedule / duty / attendance / message / contact
 * data, no ACTIVE-singleton resolver or cookie dependency, no write surface, and
 * that the current admin trainee ordering is preserved - without a live database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  listStudentsWithCourseAffiliationsForAdminWithDeps,
  buildTraineeAffiliationsQuery,
  ADMIN_TRAINEE_AFFILIATION_SELECT,
  ADMIN_TRAINEE_AFFILIATION_ORDER,
  type TraineeAffiliationsDeps,
  type TraineeAffiliationsQuery,
} from "./trainee-affiliations";
import type { RawStudentWithAffiliations } from "./trainee-affiliations-core";

interface Recorder {
  queries: TraineeAffiliationsQuery[];
  deps: TraineeAffiliationsDeps;
}

function recordingDeps(rows: RawStudentWithAffiliations[] = []): Recorder {
  const rec: Recorder = {
    queries: [],
    deps: undefined as unknown as TraineeAffiliationsDeps,
  };
  rec.deps = {
    fetchStudentsWithAffiliations: async (query) => {
      rec.queries.push(query);
      return rows;
    },
  };
  return rec;
}

const STUDENT = (
  id: string,
  fullName: string,
  isActive: boolean,
  courseEnrollments: RawStudentWithAffiliations["courseEnrollments"] = [],
): RawStudentWithAffiliations => ({
  id,
  firstName: fullName.split(" ")[0] ?? fullName,
  lastName: fullName.split(" ")[1] ?? "",
  fullName,
  groupName: null,
  subgroupNumber: null,
  identityNumber: `id-${id}`,
  phone: null,
  isActive,
  courseEnrollments,
});

// ---------------------------------------------------------------------------
// Exactly one query, no N+1
// ---------------------------------------------------------------------------

test("issues EXACTLY ONE Student read (no N+1)", async () => {
  const rec = recordingDeps([
    STUDENT("s1", "אבי כהן", true, [
      {
        id: "e1",
        status: "ACTIVE",
        isPrimary: true,
        courseOfferingId: "o1",
        courseOffering: { id: "o1", name: "רמה 1", level: 1, status: "ACTIVE" },
      },
    ]),
    STUDENT("s2", "בני לוי", true),
  ]);
  await listStudentsWithCourseAffiliationsForAdminWithDeps(rec.deps);
  assert.equal(rec.queries.length, 1);
});

// ---------------------------------------------------------------------------
// Deterministic ordering preserved
// ---------------------------------------------------------------------------

test("ordering is isActive desc, fullName asc, id asc", () => {
  const q = buildTraineeAffiliationsQuery();
  assert.deepEqual(q.orderBy, [
    { isActive: "desc" },
    { fullName: "asc" },
    { id: "asc" },
  ]);
  assert.deepEqual(ADMIN_TRAINEE_AFFILIATION_ORDER, [
    { isActive: "desc" },
    { fullName: "asc" },
    { id: "asc" },
  ]);
});

test("student order returned by the DB is preserved verbatim", async () => {
  const rec = recordingDeps([
    STUDENT("s2", "בני לוי", true),
    STUDENT("s1", "אבי כהן", true),
  ]);
  const rows = await listStudentsWithCourseAffiliationsForAdminWithDeps(rec.deps);
  assert.deepEqual(rows.map((r) => r.id), ["s2", "s1"]);
});

// ---------------------------------------------------------------------------
// Minimal Student select (privacy-narrow) + minimal nested affiliation relation
// ---------------------------------------------------------------------------

test("Student select is exactly the nine current-page fields plus courseEnrollments", () => {
  const q = buildTraineeAffiliationsQuery();
  assert.deepEqual(Object.keys(q.select).sort(), [
    "courseEnrollments",
    "firstName",
    "fullName",
    "groupName",
    "id",
    "identityNumber",
    "isActive",
    "lastName",
    "phone",
    "subgroupNumber",
  ]);
});

test("no NEW sensitive Student field is selected (no horse/notes/health/parent/created)", () => {
  const q = buildTraineeAffiliationsQuery();
  const studentKeys = Object.keys(q.select);
  for (const forbidden of [
    "hasPrivateHorse",
    "privateHorseName",
    "assignedHorseName",
    "availability",
    "attendance",
    "generalNotes",
    "weeklyFeedbackResponses",
    "createdAt",
    "updatedAt",
  ]) {
    assert.equal(
      studentKeys.includes(forbidden),
      false,
      `select must not include ${forbidden}`,
    );
  }
});

test("nested affiliation relation selects only id/status/isPrimary/courseOfferingId + offering id/name/level/status", () => {
  const enrollmentSelect = (
    ADMIN_TRAINEE_AFFILIATION_SELECT.courseEnrollments as {
      select: Record<string, unknown>;
    }
  ).select;
  assert.deepEqual(Object.keys(enrollmentSelect).sort(), [
    "courseOffering",
    "courseOfferingId",
    "id",
    "isPrimary",
    "status",
  ]);
  const offeringSelect = (
    enrollmentSelect.courseOffering as { select: Record<string, unknown> }
  ).select;
  assert.deepEqual(Object.keys(offeringSelect).sort(), [
    "id",
    "level",
    "name",
    "status",
  ]);
});

// ---------------------------------------------------------------------------
// No forbidden domains anywhere in the query
// ---------------------------------------------------------------------------

test("query references no group-membership / horse / schedule / duty / attendance / message / contact / capability data", () => {
  const q = buildTraineeAffiliationsQuery();
  const serialized = JSON.stringify({ orderBy: q.orderBy, select: q.select });
  for (const forbidden of [
    "memberships",
    "groupMemberships",
    "courseGroup",
    "horseAssignment",
    "traineeHorse",
    "privateHorse",
    "assignedHorse",
    "availability",
    "attendance",
    "assignments",
    "feedback",
    "message",
    "capabilit",
    "ridingLesson",
    "generalNote",
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `query must not reference ${forbidden}`,
    );
  }
});

test("query performs NO ACTIVE-singleton / cookie / offering-name-or-level identity lookup", () => {
  // The reader takes no arguments and its query carries no offering predicate at
  // all - affiliation identity is the CourseOffering id ON each enrollment row.
  const q = buildTraineeAffiliationsQuery();
  assert.deepEqual(Object.keys(q).sort(), ["orderBy", "select"]);
  const serialized = JSON.stringify(q);
  for (const forbidden of ["resolveCurrentCourseOffering", "cookie", "where"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

// ---------------------------------------------------------------------------
// Read-only: the dependency surface is a single READ, no write / other-table method
// ---------------------------------------------------------------------------

test("the dependency surface is a single READ (no write, no other-domain method)", () => {
  const rec = recordingDeps();
  const keys = Object.keys(rec.deps);
  assert.deepEqual(keys, ["fetchStudentsWithAffiliations"]);
  for (const k of keys) {
    assert.equal(/create|update|delete|write|upsert/i.test(k), false);
    assert.equal(
      /membership|horse|schedule|dut(y|ies)|attendance|message|capabilit|contact/i.test(k),
      false,
    );
  }
});

// ---------------------------------------------------------------------------
// End-to-end shaping through the pure core (affiliation attached per trainee)
// ---------------------------------------------------------------------------

test("each returned row carries the derived affiliation summary", async () => {
  const rec = recordingDeps([
    STUDENT("s1", "אבי כהן", true, [
      {
        id: "e1",
        status: "ACTIVE",
        isPrimary: true,
        courseOfferingId: "o1",
        courseOffering: { id: "o1", name: "רמה 1", level: 1, status: "ACTIVE" },
      },
      {
        id: "e2",
        status: "ACTIVE",
        isPrimary: false,
        courseOfferingId: "o2",
        courseOffering: { id: "o2", name: "רמה 2", level: 2, status: "PLANNED" },
      },
    ]),
    STUDENT("s2", "בני לוי", true),
  ]);
  const rows = await listStudentsWithCourseAffiliationsForAdminWithDeps(rec.deps);
  assert.equal(rows[0].affiliation.shortLabel, "רמה 1 + רמה 2");
  assert.equal(rows[0].affiliation.isCombined, true);
  assert.equal(rows[1].affiliation.shortLabel, "ללא קורס");
  assert.equal(rows[1].affiliation.hasNoActiveCourse, true);
});
