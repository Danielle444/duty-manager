/**
 * MULTI-COURSE W6B - executable tests for the PURE create-trainee form guard.
 *
 * Run with: npx tsx --test lib/course/create-trainee-form.test.ts
 * PURE: no Prisma, no DB, no DOM. This mirrors what StudentsClient enforces in
 * CREATE mode (group + subgroup required) using the SAME Hebrew messages the
 * server returns, without needing a component-test harness.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validateCreateTraineeForm } from "./create-trainee-form";
import {
  MISSING_GROUP_MESSAGE,
  MISSING_SUBGROUP_MESSAGE,
} from "./create-trainee-enrollment-core";

test("create form: blocks submission when group is missing (Hebrew message)", () => {
  for (const groupName of ["", "   "]) {
    assert.equal(
      validateCreateTraineeForm({ groupName, subgroupNumber: "2" }),
      MISSING_GROUP_MESSAGE,
    );
  }
  // The requirement is clearly present and Hebrew.
  assert.match(MISSING_GROUP_MESSAGE, /קבוצה/);
});

test("create form: blocks submission when subgroup is missing (Hebrew message)", () => {
  for (const subgroupNumber of ["", "   "]) {
    assert.equal(
      validateCreateTraineeForm({ groupName: "א", subgroupNumber }),
      MISSING_SUBGROUP_MESSAGE,
    );
  }
  assert.match(MISSING_SUBGROUP_MESSAGE, /מספר קבוצה/);
});

test("create form: group is reported before subgroup when both missing", () => {
  assert.equal(
    validateCreateTraineeForm({ groupName: "", subgroupNumber: "" }),
    MISSING_GROUP_MESSAGE,
  );
});

test("create form: a valid group + subgroup passes (null = no error)", () => {
  assert.equal(validateCreateTraineeForm({ groupName: "א", subgroupNumber: "2" }), null);
  assert.equal(validateCreateTraineeForm({ groupName: " ב ", subgroupNumber: "10" }), null);
});
