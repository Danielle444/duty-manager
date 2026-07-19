/**
 * Non-DB CONTRACT (source-scan) tests locking the W6D3 group-change wiring
 * decisions into the suite — mirroring the source-scan pattern already used by
 * group-change-core.test.ts. No Prisma, no DB, no imports of the "use server"
 * action module (which would pull in Prisma). Run with:
 *   npx tsx --test lib/trainee-history/group-change-service.contract.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SERVICE = readFileSync("lib/trainee-history/group-change-service.ts", "utf8");
const ACTION = readFileSync("lib/actions/students.ts", "utf8");
const CLIENT = readFileSync("app/admin/students/StudentsClient.tsx", "utf8");

// Executable code only for the service (strip comments) so a comment naming the
// banned legacy model does not itself trip the scan.
const SERVICE_CODE = SERVICE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// --- D. legacy-model prohibition -------------------------------------------

test("24. service never reads/writes legacy TraineeGroupMembership", () => {
  assert.ok(
    !/traineeGroupMembership/i.test(SERVICE_CODE),
    "service code must not reference the legacy TraineeGroupMembership model",
  );
  assert.ok(
    !/writeTraineeGroupMembership/.test(SERVICE_CODE),
    "service must not call the legacy writeTraineeGroupMembership writer",
  );
});

test("service writes the authoritative GroupMembership via a per-call adapter", () => {
  assert.ok(/tx\.groupMembership\.create/.test(SERVICE_CODE), "must create GroupMembership rows");
  assert.ok(/tx\.groupMembership\.update/.test(SERVICE_CODE), "must update GroupMembership rows");
  assert.ok(
    /createGroupChangeAdapter/.test(SERVICE_CODE),
    "must build a fresh per-call adapter",
  );
});

// --- 26/27. action resolves offering server-side; no client offering/date ---

test("26. action resolves the current offering server-side", () => {
  assert.ok(
    /resolveCurrentCourseOffering\(\)/.test(ACTION),
    "changeTraineeGroup must resolve the offering server-side",
  );
  assert.ok(
    /israelDateKeyFromInstant\(new Date\(\)\)/.test(ACTION),
    "action must derive a single trusted server 'now' for effectiveFrom",
  );
});

test("27. public action exposes no courseOfferingId/date parameter", () => {
  const match = ACTION.match(
    /export async function changeTraineeGroup\(([\s\S]*?)\):\s*Promise<ActionResult>/,
  );
  assert.ok(match, "changeTraineeGroup signature must be present");
  const params = match![1];
  assert.ok(/studentId:\s*string/.test(params), "takes studentId");
  assert.ok(/targetCourseGroupId:\s*string/.test(params), "takes targetCourseGroupId");
  assert.ok(!/courseOfferingId/.test(params), "must NOT accept a client courseOfferingId");
  assert.ok(
    !/effectiveFrom/.test(params) && !/\bdate\b/i.test(params),
    "must NOT accept a client effective date",
  );
});

// --- 28. updateStudent no longer edits group fields ------------------------

test("28. updateStudent no longer writes groupName/subgroupNumber", () => {
  const match = ACTION.match(
    /export async function updateStudent\([\s\S]*?\n}\n/,
  );
  assert.ok(match, "updateStudent body must be present");
  const body = match![0];
  assert.ok(
    /studentEditSchema/.test(body),
    "updateStudent must parse via the group-field-free studentEditSchema",
  );
  assert.ok(!/groupName:/.test(body), "updateStudent must not set groupName");
  assert.ok(!/subgroupNumber:/.test(body), "updateStudent must not set subgroupNumber");
  assert.ok(
    /studentEditSchema\s*=\s*studentSchema\.omit\(\{\s*groupName:\s*true,\s*subgroupNumber:\s*true\s*\}\)/.test(
      ACTION,
    ),
    "studentEditSchema must omit both group fields from the edit payload",
  );
});

// --- 29. createStudent flow remains unchanged ------------------------------

test("29. createStudent still uses studentSchema + atomic enrollment flow", () => {
  const match = ACTION.match(/export async function createStudent\([\s\S]*?\n}\n/);
  assert.ok(match, "createStudent body must be present");
  const body = match![0];
  assert.ok(/studentSchema\.safeParse/.test(body), "createStudent still parses via studentSchema");
  assert.ok(
    /createTraineeWithEnrollmentSafe/.test(body),
    "createStudent still runs the atomic enrollment creation flow",
  );
  assert.ok(/groupName:/.test(body), "createStudent still supplies the initial group");
});

// --- 30. UI submits a courseGroupId, never a free-text label ----------------

test("30. UI submits targetCourseGroupId (a courseGroupId), not a free-text label", () => {
  assert.ok(
    /changeTraineeGroup\(\s*studentId,\s*selectedGroupId\s*\)/.test(CLIENT),
    "client must call changeTraineeGroup(studentId, selectedGroupId)",
  );
  assert.ok(
    /value=\{o\.courseGroupId\}/.test(CLIENT),
    "the group-change select options must carry courseGroupId as their value",
  );
  // The free-text group/subgroup inputs must be gated to creation only.
  assert.ok(
    /modalStudent === "new" && \(/.test(CLIENT),
    "free-text group inputs must be rendered for creation only",
  );
});
