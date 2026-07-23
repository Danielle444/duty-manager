/**
 * MULTI-COURSE (enrollment slice E3) - DB-free CONTRACT/source tests for the
 * enrollment page, its server action, and the client form. Runs no Prisma and
 * opens no DB: it imports the pure error-message map for a totality check, and
 * statically inspects the source of the three UI modules to assert the approved
 * safety invariants (authorization order, route-id trust, minimal form fields, no
 * cookie/singleton/offering-name identity, PLANNED-only affordance, leaf-only
 * subgroup options, identity masking). This guards against a future refactor
 * silently breaking the slice-E3 contract.
 *
 * Run: npx tsx --test "app/admin/courses/[courseOfferingId]/enrollments/enrollments.contract.test.ts"
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ENROLL_ERROR_MESSAGES, enrollErrorMessage } from "./enroll-error-messages";

// Strip block and line comments so invariants are checked against real CODE only,
// never the (deliberately prose-y) contract comments. None of these files contain
// `//` inside a string or regex literal, so this naive strip is safe here.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function read(relative: string): string {
  return stripComments(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8"));
}

const actionSrc = read("./actions.ts");
const pageSrc = read("./page.tsx");
const formSrc = read("./EnrollExistingTraineeForm.tsx");

// ---------------------------------------------------------------------------
// Error-message map totality (server-action result/error mapping)
// ---------------------------------------------------------------------------

// The exact stable E1 error surface (kept in lock-step with
// EnrollExistingTraineeErrorCode). A drift here fails this test.
const E1_ERROR_CODES = [
  "invalid_input",
  "offering_not_found",
  "operation_not_allowed",
  "offering_start_date_missing",
  "student_not_found",
  "inactive_student",
  "invalid_group",
  "already_enrolled",
  "unexpected",
] as const;

test("ENROLL_ERROR_MESSAGES covers EXACTLY the stable E1 error codes", () => {
  assert.deepEqual(Object.keys(ENROLL_ERROR_MESSAGES).sort(), [...E1_ERROR_CODES].sort());
});

test("every E1 error code maps to a non-empty Hebrew message", () => {
  for (const code of E1_ERROR_CODES) {
    const message = ENROLL_ERROR_MESSAGES[code];
    assert.equal(typeof message, "string");
    assert.ok(message.trim().length > 0, `${code} must have a message`);
  }
});

test("an unknown code falls back to the generic message", () => {
  assert.equal(enrollErrorMessage("not_a_real_code"), ENROLL_ERROR_MESSAGES.unexpected);
});

test("no message reflects raw ids or PII (fixed Hebrew strings only)", () => {
  const serialized = JSON.stringify(ENROLL_ERROR_MESSAGES);
  for (const forbidden of ["studentId", "courseGroupId", "courseOfferingId", "${", "identityNumber"]) {
    assert.equal(serialized.includes(forbidden), false, `messages must not include ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Server action: authorization order + route-id trust + minimal input
// ---------------------------------------------------------------------------

test("action authorizes (requireAdmin) BEFORE invoking the E1 mutation", () => {
  const admin = actionSrc.indexOf("requireAdmin(");
  const enroll = actionSrc.indexOf("enrollExistingTrainee(");
  assert.ok(admin > -1, "requireAdmin call not found");
  assert.ok(enroll > -1, "enrollExistingTrainee call not found");
  assert.ok(admin < enroll, "requireAdmin must precede the mutation");
});

test("the offering id is the SERVER-BOUND route argument, never a form field", () => {
  // Bound as a leading function parameter.
  assert.ok(
    /enrollExistingTraineeAction\(\s*courseOfferingId: string/.test(actionSrc),
    "courseOfferingId must be a bound leading parameter",
  );
  // And it is passed straight into E1, not read from the client form.
  assert.ok(!actionSrc.includes('formData.get("courseOfferingId")'), "offering id must not be read from formData");
});

test("the action reads ONLY studentId and courseGroupId from the form", () => {
  assert.ok(actionSrc.includes('formData.get("studentId")'), "studentId must be read");
  assert.ok(actionSrc.includes('formData.get("courseGroupId")'), "courseGroupId must be read");
  for (const forbidden of ["status", "isPrimary", "effectiveFrom", "startDate", "courseOfferingId"]) {
    assert.ok(
      !actionSrc.includes(`formData.get("${forbidden}")`),
      `action must not read ${forbidden} from the client`,
    );
  }
});

test("the action uses no singleton resolver / cookie / offering name / level", () => {
  for (const forbidden of ["resolveCurrentCourseOffering", "cookies(", "cookie", ".level", ".name"]) {
    assert.ok(!actionSrc.includes(forbidden), `action must not reference ${forbidden}`);
  }
});

test("the action redirects and revalidates the EXACT enrollments route", () => {
  assert.ok(actionSrc.includes("revalidatePath(enrollPath)"), "must revalidate the exact enrollments path");
  assert.ok(actionSrc.includes("/enrollments`"), "the enrollments path is built from the bound offering id");
  assert.ok(actionSrc.includes('"/admin/courses?error=invalid"'), "offering_not_found routes to the safe courses list");
  // No unrelated global revalidations.
  assert.ok(!actionSrc.includes('revalidatePath("/admin/courses")'), "must not revalidate the whole courses list");
  assert.ok(!actionSrc.includes('revalidatePath("/")'), "must not revalidate unrelated global paths");
});

test("the action performs no Student / horse / Level-1 write", () => {
  for (const forbidden of ["student.update", "student.create", "TraineeHorseAssignment", "traineeHorseAssignment", "horse"]) {
    assert.ok(!actionSrc.includes(forbidden), `action must not reference ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Page: authorization order, route-scoped reads, PLANNED-only form, masking
// ---------------------------------------------------------------------------

test("page validates the exact route offering via requireAdminCourseOffering", () => {
  assert.ok(pageSrc.includes("requireAdminCourseOffering(courseOfferingId)"));
  assert.ok(pageSrc.includes("CourseOfferingNotFoundError"), "must fail closed on not-found");
});

test("page gates the READ with the pure HISTORICAL_READ policy", () => {
  assert.ok(pageSrc.includes('assertCourseOperationAllowed(context.status, "HISTORICAL_READ")'));
});

test("eligible trainees and group tree are read from the VALIDATED context id only", () => {
  assert.ok(pageSrc.includes("listEnrollableTrainees(context.id)"), "eligible trainees from context.id");
  assert.ok(pageSrc.includes("getCourseGroupTreeByOfferingId(context.id)"), "group tree from context.id");
  assert.ok(pageSrc.includes("readOfferingEnrollmentsForAdmin(context.id, context.startDate)"), "enrollments from context.id at startDate");
});

test("the enrollment form is gated on PLANNED status + ENROLLMENT_MANAGEMENT", () => {
  assert.ok(pageSrc.includes('context.status === "PLANNED"'), "form gated to PLANNED");
  assert.ok(pageSrc.includes('"ENROLLMENT_MANAGEMENT"'), "form gated on the enrollment-management policy");
});

test("only LEAF subgroups become options (top-level groups are excluded)", () => {
  // Options iterate the subgroups of each top-level group and use the subgroup id.
  assert.ok(pageSrc.includes("group.subgroups"), "must iterate leaf subgroups");
  assert.ok(pageSrc.includes("id: subgroup.id"), "option value must be the subgroup id");
  // The top-level group id is never emitted as an option value.
  assert.ok(!pageSrc.includes("id: group.id"), "a top-level group id must never be an option value");
});

test("the action target is bound from the validated context id (no arbitrary offering)", () => {
  assert.ok(pageSrc.includes("enrollExistingTraineeAction.bind(null, context.id)"));
});

test("identity numbers are masked before reaching the client", () => {
  assert.ok(pageSrc.includes("maskIdentityNumber"), "page must mask identity numbers");
});

test("page uses no singleton resolver / cookie", () => {
  for (const forbidden of ["resolveCurrentCourseOffering", "cookies(", "cookie"]) {
    assert.ok(!pageSrc.includes(forbidden), `page must not reference ${forbidden}`);
  }
});

test("page queries no phone / horse fields", () => {
  for (const forbidden of ["phone", "privateHorse", "assignedHorse", "hasPrivateHorse"]) {
    assert.ok(!pageSrc.includes(forbidden), `page must not reference ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Client form: exact fields, pending disable, no client-controlled operational
// values, no offering selector
// ---------------------------------------------------------------------------

test("the form submits EXACTLY studentId and courseGroupId", () => {
  assert.ok(formSrc.includes('name="studentId"'));
  assert.ok(formSrc.includes('name="courseGroupId"'));
});

test("the form has NO client-controlled status / isPrimary / effectiveFrom / offering selector", () => {
  for (const forbidden of ["courseOfferingId", "status", "isPrimary", "effectiveFrom", "startDate"]) {
    assert.ok(!formSrc.includes(`name="${forbidden}"`), `form must not carry a ${forbidden} field`);
  }
});

test("the submit button is disabled while the action is pending", () => {
  assert.ok(formSrc.includes("useFormStatus"), "must use useFormStatus");
  assert.ok(formSrc.includes("disabled={pending}"), "submit must be disabled while pending");
});
