import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveInitialStudentsTab } from "./instructor-riding-initial-tab-core";

// This test intentionally imports ONLY the pure helper - never
// InstructorRidingSlotsSection.tsx - so the runtime graph contains no React,
// Prisma, or server action. The helper is the sole decision surface.

test("complex mode lands on the schedule tab", () => {
  assert.equal(resolveInitialStudentsTab("complex"), "schedule");
});

test("simple mode lands on the list tab", () => {
  assert.equal(resolveInitialStudentsTab("simple"), "list");
});

test("a missing (undefined) map entry lands on the list tab", () => {
  assert.equal(resolveInitialStudentsTab(undefined), "list");
});

test("a null value lands on the list tab", () => {
  assert.equal(resolveInitialStudentsTab(null), "list");
});

test("the other known modes ('none'/'error') land on the list tab", () => {
  assert.equal(resolveInitialStudentsTab("none"), "list");
  assert.equal(resolveInitialStudentsTab("error"), "list");
});

test("an unexpected runtime value lands on the list tab", () => {
  assert.equal(resolveInitialStudentsTab("COMPLEX"), "list");
  assert.equal(resolveInitialStudentsTab("Complex"), "list");
  assert.equal(resolveInitialStudentsTab(42), "list");
  assert.equal(resolveInitialStudentsTab(true), "list");
  assert.equal(resolveInitialStudentsTab({ mode: "complex" }), "list");
});

test("repeated calls with the same input are deterministic", () => {
  assert.equal(resolveInitialStudentsTab("complex"), "schedule");
  assert.equal(resolveInitialStudentsTab("complex"), "schedule");
  assert.equal(resolveInitialStudentsTab("complex"), "schedule");
  assert.equal(resolveInitialStudentsTab("simple"), "list");
  assert.equal(resolveInitialStudentsTab("simple"), "list");
});

test("an object/wrapper input is not mutated", () => {
  const wrapper = { mode: "complex", nested: { value: "complex" } };
  const before = JSON.stringify(wrapper);
  const result = resolveInitialStudentsTab(wrapper);
  assert.equal(result, "list");
  assert.equal(JSON.stringify(wrapper), before);
});
