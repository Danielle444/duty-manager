/**
 * MULTI-COURSE (course-affiliation display slice A2) - DB-free CONTRACT/source
 * tests for wiring the committed A1 affiliation read model into the GENERAL admin
 * trainees screen and rendering compact course-affiliation badges.
 *
 * Runs no Prisma and opens no DB. It:
 *   - statically inspects app/admin/students/page.tsx to prove the server-page
 *     wiring invariants (requireAdmin FIRST, the A1 reader is the single trainee
 *     list source, the old bare prisma.student.findMany is gone, affiliation is
 *     handed to the client, no affiliation-inference resolver, unrelated reads
 *     preserved, no write/mutation introduced);
 *   - statically inspects app/admin/students/StudentsClient.tsx to prove the badge
 *     contract (renders from the A1 summary only, `רמה N` per visible affiliation,
 *     keyed by courseOfferingId, full name in the tooltip, `ללא קורס` neutral
 *     badge, wrap-capable container, no group-derived badge, no recomputation from
 *     raw courseEnrollments, no affiliation editing control, legacy trainee UI
 *     preserved);
 *   - exercises the committed A1 PURE core so the exact L1 / L2 / dual / no-course
 *     display values the badges render are pinned.
 *
 * Run: npx tsx --test "app/admin/students/students-course-affiliations.contract.test.ts"
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildTraineeAffiliationSummary,
  NO_COURSE_LABEL,
  type RawAffiliationEnrollment,
} from "@/lib/course/trainee-affiliations-core";

// Strip block and line comments so invariants are checked against real CODE only,
// never the (deliberately prose-y) contract comments. Neither file contains `//`
// inside a string or regex literal, so this naive strip is safe here.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function read(relative: string): string {
  return stripComments(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8"));
}

const pageSrc = read("./page.tsx");
const clientSrc = read("./StudentsClient.tsx");

const ENROLLMENT = (
  overrides: Partial<RawAffiliationEnrollment> & {
    courseOffering: RawAffiliationEnrollment["courseOffering"];
  },
): RawAffiliationEnrollment => ({
  id: overrides.id ?? "e1",
  status: overrides.status ?? "ACTIVE",
  isPrimary: overrides.isPrimary ?? false,
  courseOfferingId: overrides.courseOfferingId ?? overrides.courseOffering.id,
  courseOffering: overrides.courseOffering,
});

// ---------------------------------------------------------------------------
// Server page: authorization order + single authoritative reader
// ---------------------------------------------------------------------------

test("page authorizes (requireAdmin) BEFORE loading any trainee data", () => {
  const admin = pageSrc.indexOf("requireAdmin(");
  const reader = pageSrc.indexOf("listStudentsWithCourseAffiliationsForAdmin(");
  assert.ok(admin > -1, "requireAdmin call not found");
  assert.ok(reader > -1, "A1 reader call not found");
  assert.ok(admin < reader, "requireAdmin must precede the trainee-list read");
});

test("page reads the trainee list through the committed A1 reader", () => {
  assert.ok(
    pageSrc.includes("listStudentsWithCourseAffiliationsForAdmin()"),
    "page must call the A1 reader",
  );
});

test("the old bare prisma.student.findMany is no longer the trainee-list source", () => {
  assert.ok(
    !pageSrc.includes("prisma.student.findMany"),
    "page must not read the trainee list via prisma.student.findMany",
  );
});

test("no second Student list query exists on the page", () => {
  const matches = pageSrc.match(/prisma\.student\./g) ?? [];
  assert.equal(matches.length, 0, "there must be no prisma.student.* query left on the page");
  const readerCalls = pageSrc.match(/listStudentsWithCourseAffiliationsForAdmin\(\)/g) ?? [];
  assert.equal(readerCalls.length, 1, "the A1 reader is the single trainee-list read");
});

test("the affiliation summary is passed to StudentsClient", () => {
  assert.ok(pageSrc.includes("affiliation: s.affiliation"), "affiliation must be forwarded to the client");
  assert.ok(pageSrc.includes("<StudentsClient"), "StudentsClient must receive the rows");
});

test("the page introduces NO Student / group / enrollment mutation", () => {
  // Concrete mutation call sites only - never a broad substring, so a legitimate
  // pre-existing import (e.g. the group-change error helper from
  // create-trainee-enrollment-core) is not misread as a write.
  for (const forbidden of [
    "student.update",
    "student.create",
    "student.delete",
    "createStudent(",
    "updateStudent(",
    "changeTraineeGroup(",
    "courseEnrollment.create",
    "courseEnrollment.update",
    "enrollExistingTrainee(",
  ]) {
    assert.ok(!pageSrc.includes(forbidden), `page must not reference ${forbidden}`);
  }
});

test("no current-offering resolver feeds affiliation inference (reader owns identity)", () => {
  // Affiliation identity is owned entirely by the A1 reader: it is called with NO
  // offering/cookie argument, and the badges are handed the reader row's own
  // `s.affiliation`. resolveCurrentCourseOffering is preserved for the pre-existing
  // group-change control ONLY and is called with no argument there too - it never
  // produces the trainee list or its affiliations.
  assert.ok(
    pageSrc.includes("listStudentsWithCourseAffiliationsForAdmin()"),
    "the reader takes no offering/cookie argument",
  );
  assert.ok(pageSrc.includes("affiliation: s.affiliation"), "badges use the reader row's own affiliation");
  // The affiliation forwarded to the client is EXACTLY the reader row's own
  // `s.affiliation`; there is no `affiliation:` assignment sourced from the
  // resolver/cookie/singleton anywhere on the page.
  const affiliationAssignments = pageSrc.match(/affiliation:\s*[^,\n]+/g) ?? [];
  assert.deepEqual(
    affiliationAssignments,
    ["affiliation: s.affiliation"],
    "the only affiliation assignment must be the reader row's own affiliation",
  );
});

test("unrelated existing page reads remain intact (presets, courseSettings, group-change)", () => {
  assert.ok(pageSrc.includes("availabilityRangePreset.findMany"), "presets read preserved");
  assert.ok(pageSrc.includes("courseSettings.findUnique"), "course settings read preserved");
  assert.ok(pageSrc.includes("resolveCurrentCourseOffering"), "group-change resolver preserved");
  assert.ok(pageSrc.includes("buildLeafGroupOptions"), "group-change options preserved");
});

// ---------------------------------------------------------------------------
// Client: badge contract
// ---------------------------------------------------------------------------

test("the client row type carries the affiliation summary", () => {
  assert.ok(clientSrc.includes("affiliation: TraineeAffiliationSummary"), "StudentRow must include affiliation");
  assert.ok(
    clientSrc.includes('import type { TraineeAffiliationSummary } from "@/lib/course/trainee-affiliations"'),
    "affiliation type must come from the A1 reader module",
  );
});

test("the no-course state renders the neutral ללא קורס badge", () => {
  assert.ok(clientSrc.includes("hasNoActiveCourse"), "must branch on hasNoActiveCourse");
  assert.ok(clientSrc.includes("NO_COURSE_LABEL"), "must render the A1 NO_COURSE_LABEL");
  assert.equal(NO_COURSE_LABEL, "ללא קורס");
});

test("each visible affiliation renders a `רמה N` badge from the level", () => {
  assert.ok(clientSrc.includes("visibleAffiliations.map"), "must iterate visibleAffiliations");
  assert.ok(clientSrc.includes("רמה {aff.level}"), "badge text is `רמה` + the offering level");
});

test("the badge key is the courseOfferingId (never level or name)", () => {
  assert.ok(clientSrc.includes("key={aff.courseOfferingId}"), "badge key must be courseOfferingId");
  assert.ok(!clientSrc.includes("key={aff.level}"), "badge key must not be level");
  assert.ok(!clientSrc.includes("key={aff.name}"), "badge key must not be name");
});

test("the full offering name is used in the badge title/tooltip", () => {
  assert.ok(clientSrc.includes("title={aff.name}"), "badge title must be the full offering name");
});

test("badges never derive from groupName/subgroupNumber", () => {
  // The badge component reads only from `affiliation`; the group fields are used
  // solely by the legacy group column, filters, and sorters - never by the badge.
  const badgeBlock = clientSrc.slice(
    clientSrc.indexOf("function CourseAffiliationBadges"),
    clientSrc.indexOf("export function StudentsClient"),
  );
  assert.ok(badgeBlock.length > 0, "badge component block not found");
  assert.ok(!badgeBlock.includes("groupName"), "badge must not read groupName");
  assert.ok(!badgeBlock.includes("subgroupNumber"), "badge must not read subgroupNumber");
});

test("affiliation is NOT recomputed from raw courseEnrollments in the component", () => {
  assert.ok(!clientSrc.includes("courseEnrollments"), "client must not touch raw courseEnrollments");
  assert.ok(
    !clientSrc.includes("buildTraineeAffiliationSummary"),
    "client must not rebuild the summary - it consumes A1's derived summary",
  );
});

test("the badge container is wrap-capable (responsive, no horizontal overflow)", () => {
  const badgeBlock = clientSrc.slice(
    clientSrc.indexOf("function CourseAffiliationBadges"),
    clientSrc.indexOf("export function StudentsClient"),
  );
  assert.ok(badgeBlock.includes("flex-wrap"), "badge cluster must wrap");
});

test("no affiliation editing control is added", () => {
  const badgeBlock = clientSrc.slice(
    clientSrc.indexOf("function CourseAffiliationBadges"),
    clientSrc.indexOf("export function StudentsClient"),
  );
  for (const forbidden of ["onClick", "onChange", "<button", "<select", "<input", "Button"]) {
    assert.ok(!badgeBlock.includes(forbidden), `badge must not include an interactive ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Client: legacy trainee UI preserved
// ---------------------------------------------------------------------------

test("existing masked-identity behavior remains", () => {
  assert.ok(clientSrc.includes("maskIdentityNumber(student.identityNumber)"), "masked identity preserved");
});

test("existing edit / activate / progress controls remain", () => {
  assert.ok(clientSrc.includes("openModal(student)"), "edit control preserved");
  assert.ok(clientSrc.includes("handleToggleActive(student)"), "activation toggle preserved");
  assert.ok(clientSrc.includes("/admin/trainee-progress?studentId="), "progress link preserved");
});

test("existing legacy group / subgroup display remains", () => {
  assert.ok(clientSrc.includes("{student.groupName ?? \"-\"}"), "legacy group column preserved");
  assert.ok(clientSrc.includes("{student.subgroupNumber ?? \"-\"}"), "legacy subgroup column preserved");
});

test("existing group filter behavior is preserved", () => {
  assert.ok(clientSrc.includes("matchesGroupFilter"), "group filter helper preserved");
  assert.ok(clientSrc.includes("handleGroupFilterChange"), "group filter handler preserved");
});

test("the import UI is still present", () => {
  assert.ok(clientSrc.includes("ImportStudentsClient"), "import UI preserved");
});

// ---------------------------------------------------------------------------
// Pure A1 core: the exact display values the badges render (L1 / L2 / dual / none)
// ---------------------------------------------------------------------------

test("one L1 affiliation yields a single `רמה 1` badge value", () => {
  const summary = buildTraineeAffiliationSummary([
    ENROLLMENT({ courseOffering: { id: "o1", name: "קורס רמה 1 2026", level: 1, status: "ACTIVE" } }),
  ]);
  assert.equal(summary.visibleAffiliations.length, 1);
  assert.equal(`רמה ${summary.visibleAffiliations[0].level}`, "רמה 1");
  assert.equal(summary.visibleAffiliations[0].name, "קורס רמה 1 2026");
  assert.equal(summary.hasNoActiveCourse, false);
});

test("one L2 affiliation yields a single `רמה 2` badge value", () => {
  const summary = buildTraineeAffiliationSummary([
    ENROLLMENT({ courseOffering: { id: "o2", name: "קורס רמה 2 2026", level: 2, status: "PLANNED" } }),
  ]);
  assert.equal(summary.visibleAffiliations.length, 1);
  assert.equal(`רמה ${summary.visibleAffiliations[0].level}`, "רמה 2");
});

test("dual affiliation yields BOTH `רמה 1` and `רמה 2` (not an ambiguous count)", () => {
  const summary = buildTraineeAffiliationSummary([
    ENROLLMENT({ id: "e1", courseOffering: { id: "o1", name: "רמה 1", level: 1, status: "ACTIVE" } }),
    ENROLLMENT({ id: "e2", courseOffering: { id: "o2", name: "רמה 2", level: 2, status: "ACTIVE" } }),
  ]);
  const labels = summary.visibleAffiliations.map((a) => `רמה ${a.level}`);
  assert.deepEqual(labels, ["רמה 1", "רמה 2"]);
  assert.equal(summary.isCombined, true);
});

test("INACTIVE enrollment + ARCHIVED offering are already filtered → no-course", () => {
  const summary = buildTraineeAffiliationSummary([
    ENROLLMENT({ id: "e1", status: "INACTIVE", courseOffering: { id: "o1", name: "רמה 1", level: 1, status: "ACTIVE" } }),
    ENROLLMENT({ id: "e2", status: "ACTIVE", courseOffering: { id: "o2", name: "ארכיון", level: 2, status: "ARCHIVED" } }),
  ]);
  assert.equal(summary.visibleAffiliations.length, 0);
  assert.equal(summary.hasNoActiveCourse, true);
  assert.equal(summary.shortLabel, NO_COURSE_LABEL);
});
