/**
 * MULTI-COURSE (new-trainee slice N2A) - DB-free CONTRACT/source tests for the
 * new-trainee admin server action and its stable Hebrew error map. Runs no Prisma
 * and opens no DB: it imports the pure error-message map for a totality check, and
 * statically inspects the source of createTraineeIntoOfferingAction to assert the
 * approved safety invariants (authorization order, route-id trust, five-field
 * whitelist, no cookie/header/singleton/offering-name identity, delegation-only,
 * no direct write / no activation, distinct redirect keys). This guards against a
 * future refactor silently breaking the slice-N2A contract.
 *
 * All source assertions are scoped to the createTraineeIntoOfferingAction body
 * (the last export in actions.ts), so the sibling enrollExistingTraineeAction never
 * leaks into a match.
 *
 * Run: npx tsx --test "app/admin/courses/[courseOfferingId]/enrollments/new-trainee.contract.test.ts"
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  NEW_TRAINEE_ERROR_MESSAGES,
  newTraineeErrorMessage,
} from "./new-trainee-error-messages";

// Strip block and line comments so invariants are checked against real CODE only,
// never the (deliberately prose-y) contract comments.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function readRaw(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

function read(relative: string): string {
  return stripComments(readRaw(relative));
}

const actionSrc = read("./actions.ts");
const errorMapSrc = read("./new-trainee-error-messages.ts");
const pageSrc = read("./page.tsx");

// The new action is the last export; slice from its declaration to end of file so
// every ordering/field assertion is scoped to its body only.
const newActionStart = actionSrc.indexOf(
  "export async function createTraineeIntoOfferingAction",
);
assert.ok(newActionStart > -1, "createTraineeIntoOfferingAction must be exported");
const newActionSrc = actionSrc.slice(newActionStart);

// The exact stable N1 error surface (kept in lock-step with
// CreateTraineeIntoOfferingErrorCode). A drift here fails the totality test.
const N1_ERROR_CODES = [
  "invalid_input",
  "offering_not_found",
  "operation_not_allowed",
  "offering_start_date_missing",
  "invalid_group",
  "duplicate_identity",
  "unexpected",
] as const;

// ---------------------------------------------------------------------------
// Authorization order
// ---------------------------------------------------------------------------

test("action calls requireAdmin", () => {
  assert.ok(newActionSrc.includes("requireAdmin("), "requireAdmin must be called");
});

test("requireAdmin runs BEFORE the first formData.get", () => {
  const admin = newActionSrc.indexOf("requireAdmin(");
  const firstGet = newActionSrc.indexOf("formData.get(");
  assert.ok(admin > -1 && firstGet > -1);
  assert.ok(admin < firstGet, "requireAdmin must precede any formData read");
});

test("requireAdmin runs BEFORE createTraineeIntoOffering", () => {
  const admin = newActionSrc.indexOf("requireAdmin(");
  const create = newActionSrc.indexOf("createTraineeIntoOffering(");
  assert.ok(admin > -1 && create > -1);
  assert.ok(admin < create, "requireAdmin must precede the N1 mutation");
});

test("requireAdmin runs BEFORE revalidatePath and redirect", () => {
  const admin = newActionSrc.indexOf("requireAdmin(");
  const reval = newActionSrc.indexOf("revalidatePath(");
  const redir = newActionSrc.indexOf("redirect(");
  assert.ok(admin > -1 && reval > -1 && redir > -1);
  assert.ok(admin < reval, "requireAdmin must precede revalidatePath");
  assert.ok(admin < redir, "requireAdmin must precede redirect");
});

// ---------------------------------------------------------------------------
// Route-bound offering
// ---------------------------------------------------------------------------

test("courseOfferingId is the leading bound parameter", () => {
  assert.ok(
    /createTraineeIntoOfferingAction\(\s*courseOfferingId: string/.test(newActionSrc),
    "courseOfferingId must be the leading parameter",
  );
});

test("the offering id is NEVER read from FormData", () => {
  assert.ok(
    !newActionSrc.includes('formData.get("courseOfferingId")'),
    "offering id must not be read from formData",
  );
});

test("no current-offering resolver / cookie / header / name / level identity", () => {
  for (const forbidden of [
    "resolveCurrentCourseOffering",
    "cookies(",
    "headers(",
    ".level",
    ".name",
  ]) {
    assert.ok(!newActionSrc.includes(forbidden), `action must not reference ${forbidden}`);
  }
});

test("no production offering / group id is hardcoded anywhere in the action file", () => {
  for (const prodId of [
    "cmrxk58vc0000lscnfm54bpze",
    "cmrxk5qti0001lscnrmebu68r",
    "cmrxk5vb10002lscna61hbnaz",
    "cmrxk5xfh0003lscna0c6v457",
    "cmrxk60lw0004lscn4d2lr9jd",
  ]) {
    assert.ok(!actionSrc.includes(prodId), `must not hardcode production id ${prodId}`);
  }
});

// ---------------------------------------------------------------------------
// FormData whitelist (exactly five approved fields)
// ---------------------------------------------------------------------------

test("the action reads EXACTLY the five approved trainee fields", () => {
  for (const field of ["firstName", "lastName", "identityNumber", "phone", "courseGroupId"]) {
    assert.ok(
      newActionSrc.includes(`formData.get("${field}")`),
      `${field} must be read from the form`,
    );
  }
});

test("no operational / identity-override field is read from the client", () => {
  for (const forbidden of [
    "courseOfferingId",
    "isActive",
    "groupName",
    "subgroupNumber",
    "isPrimary",
    "status",
    "startDate",
    "effectiveFrom",
    "studentId",
    "enrollmentId",
    "password",
  ]) {
    assert.ok(
      !newActionSrc.includes(`formData.get("${forbidden}")`),
      `action must not read ${forbidden} from the client`,
    );
  }
});

// ---------------------------------------------------------------------------
// Delegation and proof of no direct writes / no activation
// ---------------------------------------------------------------------------

test("the action delegates the write to createTraineeIntoOffering and forwards the bound id", () => {
  assert.ok(newActionSrc.includes("createTraineeIntoOffering({"), "must call the N1 service");
  assert.ok(newActionSrc.includes("courseOfferingId,"), "must forward the bound courseOfferingId");
});

test("the action file imports no Prisma client", () => {
  assert.ok(!actionSrc.includes("@/lib/prisma"), "must not import the prisma client");
  assert.ok(!actionSrc.includes("prisma."), "must not reference prisma.*");
});

test("the action performs no direct Student / enrollment / membership write", () => {
  for (const forbidden of [
    "student.create",
    "student.update",
    "courseEnrollment.create",
    "groupMembership.create",
    "createStudent",
  ]) {
    assert.ok(!newActionSrc.includes(forbidden), `action must not reference ${forbidden}`);
  }
});

test("the action introduces no activation path", () => {
  for (const forbidden of ["setStudentActive", "activate", "isActive"]) {
    assert.ok(!newActionSrc.includes(forbidden), `action must not reference ${forbidden}`);
  }
});

test("the action does not call the existing-trainee enrollment service", () => {
  assert.ok(!newActionSrc.includes("enrollExistingTrainee("), "must not call E1");
});

test("the action references no horse writer", () => {
  for (const forbidden of ["TraineeHorseAssignment", "traineeHorseAssignment", "horse"]) {
    assert.ok(!newActionSrc.includes(forbidden), `action must not reference ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Redirect / revalidation contract (distinct N2 keys)
// ---------------------------------------------------------------------------

test("success revalidates the exact enrollments path and redirects with created=1", () => {
  assert.ok(newActionSrc.includes("revalidatePath(enrollPath)"), "must revalidate the exact path");
  assert.ok(newActionSrc.includes("?created=1"), "success must redirect with created=1");
  assert.ok(newActionSrc.includes("/enrollments`"), "path built from the bound offering id");
});

test("ordinary errors redirect with the newError key", () => {
  assert.ok(newActionSrc.includes("?newError="), "errors redirect with newError=<code>");
});

test("offering_not_found routes to the safe courses list", () => {
  assert.ok(
    newActionSrc.includes('"/admin/courses?error=invalid"'),
    "offering_not_found routes to the courses list",
  );
});

test("the N2 action reuses NEITHER the enrolled NOR the enrollments error key", () => {
  assert.ok(!newActionSrc.includes("enrolled"), "must not reuse the enrolled key");
  assert.ok(
    !newActionSrc.includes("${enrollPath}?error="),
    "must not reuse the error key on the enrollments path",
  );
});

test("no unrelated global revalidation", () => {
  assert.ok(!newActionSrc.includes('revalidatePath("/")'), "must not revalidate unrelated paths");
});

// ---------------------------------------------------------------------------
// Error map (totality + no PII + typed)
// ---------------------------------------------------------------------------

test("NEW_TRAINEE_ERROR_MESSAGES covers EXACTLY the stable N1 error codes", () => {
  assert.deepEqual(Object.keys(NEW_TRAINEE_ERROR_MESSAGES).sort(), [...N1_ERROR_CODES].sort());
});

test("every N1 error code maps to a non-empty Hebrew message", () => {
  for (const code of N1_ERROR_CODES) {
    const message = NEW_TRAINEE_ERROR_MESSAGES[code];
    assert.equal(typeof message, "string");
    assert.ok(message.trim().length > 0, `${code} must have a message`);
  }
});

test("duplicate_identity guides the manager to the existing-trainee flow", () => {
  assert.ok(
    NEW_TRAINEE_ERROR_MESSAGES.duplicate_identity.includes("רישום חניך קיים"),
    "duplicate_identity must point to the existing-trainee enrollment flow",
  );
});

test("no message reflects raw ids, interpolation, or PII field names", () => {
  const serialized = JSON.stringify(NEW_TRAINEE_ERROR_MESSAGES);
  for (const forbidden of [
    "${",
    "studentId",
    "courseGroupId",
    "courseOfferingId",
    "identityNumber",
    "firstName",
    "lastName",
    "phone",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `messages must not include ${forbidden}`);
  }
});

test("the map is typed against CreateTraineeIntoOfferingErrorCode", () => {
  assert.ok(
    errorMapSrc.includes("CreateTraineeIntoOfferingErrorCode"),
    "the Record must be keyed by the N1 error-code type",
  );
});

test("an unknown code falls back to the generic message", () => {
  assert.equal(newTraineeErrorMessage("not_a_real_code"), NEW_TRAINEE_ERROR_MESSAGES.unexpected);
});

// ---------------------------------------------------------------------------
// Scope: N2A adds no UI and touches no page / N1 file
// ---------------------------------------------------------------------------

test("the enrollments page was NOT wired to the new action (N2A adds no UI)", () => {
  for (const forbidden of [
    "createTraineeIntoOfferingAction",
    "NewTraineeForm",
    "newError",
    "created",
  ]) {
    assert.ok(!pageSrc.includes(forbidden), `page.tsx must not reference ${forbidden}`);
  }
});

test("no new-trainee form component was added in this slice", () => {
  const formPath = fileURLToPath(new URL("./NewTraineeForm.tsx", import.meta.url));
  assert.equal(existsSync(formPath), false, "NewTraineeForm.tsx must not exist in N2A");
});

test("N1 remains the only write service and its locked invariants are intact", () => {
  const n1CoreSrc = readRaw(
    "../../../../../lib/course/create-trainee-into-offering-core.ts",
  );
  assert.ok(n1CoreSrc.includes("isActive: false"), "N1 must still stage inactive");
  assert.ok(n1CoreSrc.includes("groupName: null"), "N1 must still null groupName");
  assert.ok(n1CoreSrc.includes("subgroupNumber: null"), "N1 must still null subgroupNumber");
});
