/**
 * MULTI-COURSE W9A-2 - DB-free IO-boundary tests for createCourseOfferingWithDeps.
 *
 * Run with: npx tsx --test lib/course/create-offering.test.ts
 * No Prisma, no DB: the ActivityYear existence read and the single offering
 * write are injected as fakes that record their calls, so these tests prove the
 * write boundary (exactly one CourseOffering, status hard-coded PLANNED, the
 * validated year id used, no write before the year check, P2002 -> duplicate)
 * without a live database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createCourseOfferingWithDeps,
  type CreateOfferingDeps,
  type NewOfferingWriteData,
  type CreateOfferingResult,
} from "./create-offering";
import type { RawNewOfferingInput } from "./create-offering-core";

function validInput(overrides: Partial<RawNewOfferingInput> = {}): RawNewOfferingInput {
  return {
    activityYearId: "year-1",
    name: "רמה 2",
    level: "2",
    startDate: "2026-07-05",
    endDate: "2026-07-31",
    ...overrides,
  };
}

interface Recorder {
  yearChecks: string[];
  writes: NewOfferingWriteData[];
  deps: CreateOfferingDeps;
}

function recordingDeps(opts: {
  yearExists?: boolean;
  createId?: string;
  createThrows?: unknown;
}): Recorder {
  const yearChecks: string[] = [];
  const writes: NewOfferingWriteData[] = [];
  const deps: CreateOfferingDeps = {
    activityYearExists: async (id) => {
      yearChecks.push(id);
      return opts.yearExists ?? true;
    },
    createOffering: async (data) => {
      writes.push(data);
      if (opts.createThrows !== undefined) {
        throw opts.createThrows;
      }
      return { id: opts.createId ?? "offering-new" };
    },
  };
  return { yearChecks, writes, deps };
}

test("a valid request creates exactly one CourseOffering and returns its id", async () => {
  const rec = recordingDeps({ createId: "offering-new" });
  const result: CreateOfferingResult = await createCourseOfferingWithDeps(validInput(), rec.deps);
  assert.deepEqual(result, { success: true, id: "offering-new" });
  assert.equal(rec.writes.length, 1);
});

test("the created status is explicitly PLANNED (no client status can alter it)", async () => {
  const rec = recordingDeps({});
  // Even with a stray client-provided status property, the writer hard-codes PLANNED.
  await createCourseOfferingWithDeps(
    { ...validInput(), status: "ACTIVE" } as unknown as RawNewOfferingInput,
    rec.deps,
  );
  assert.equal(rec.writes.length, 1);
  assert.equal(rec.writes[0].status, "PLANNED");
});

test("the validated existing ActivityYear id is used for the write", async () => {
  const rec = recordingDeps({});
  await createCourseOfferingWithDeps(validInput({ activityYearId: "  year-42  " }), rec.deps);
  assert.deepEqual(rec.yearChecks, ["year-42"]);
  assert.equal(rec.writes[0].activityYearId, "year-42");
});

test("a missing ActivityYear is rejected BEFORE any offering write", async () => {
  const rec = recordingDeps({ yearExists: false });
  const result = await createCourseOfferingWithDeps(validInput(), rec.deps);
  assert.deepEqual(result, { success: false, error: "activity_year_not_found" });
  assert.equal(rec.yearChecks.length, 1);
  assert.equal(rec.writes.length, 0);
});

test("a duplicate-name P2002 maps to the safe duplicate_name result", async () => {
  const rec = recordingDeps({ createThrows: { code: "P2002" } });
  const result = await createCourseOfferingWithDeps(validInput(), rec.deps);
  assert.deepEqual(result, { success: false, error: "duplicate_name" });
  assert.equal(rec.writes.length, 1);
});

test("an unexpected write error collapses to unexpected without exposing details", async () => {
  const rec = recordingDeps({ createThrows: new Error("connection reset at 10.0.0.1") });
  const result = await createCourseOfferingWithDeps(validInput(), rec.deps);
  assert.deepEqual(result, { success: false, error: "unexpected" });
});

test("invalid input fails validation before any year check or write", async () => {
  const rec = recordingDeps({});
  const result = await createCourseOfferingWithDeps(validInput({ name: "" }), rec.deps);
  assert.deepEqual(result, { success: false, error: "name_required" });
  assert.equal(rec.yearChecks.length, 0);
  assert.equal(rec.writes.length, 0);
});

test("the operation depends only on a year-existence read and a single offering write", async () => {
  // The dependency surface itself proves no ActivityYear/capability/group/
  // enrollment/membership creation is part of the operation: CreateOfferingDeps
  // exposes exactly two methods, and a successful run invokes each once.
  const rec = recordingDeps({});
  await createCourseOfferingWithDeps(validInput(), rec.deps);
  assert.deepEqual(Object.keys(rec.deps).sort(), ["activityYearExists", "createOffering"]);
  assert.equal(rec.yearChecks.length, 1);
  assert.equal(rec.writes.length, 1);
});
