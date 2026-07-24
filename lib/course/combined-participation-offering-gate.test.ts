/**
 * Combined Participation Slice 1 - DB-free tests that the OFFERING-SCOPED write
 * boundary rejects a malformed "משולב" value BEFORE its transaction runs.
 *
 * The offering resolver, week-owner reader and commit are injected as fakes that
 * RECORD their calls. The malformed check lives in validateOfferingWeekInput
 * (step 1 of commitOfferingWeeklyScheduleWithDeps), which runs before the
 * offering resolver, the ownership proof and commit() - so a malformed payload
 * causes ZERO resolve / fetch / commit calls. commit() is the ONLY thing that
 * performs deleteMany + createMany, so proving it is never called proves "zero
 * delete, zero create" for both create and re-import.
 *
 * Run with: npx tsx --test lib/course/combined-participation-offering-gate.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  commitOfferingWeeklyScheduleWithDeps,
  type CommitOfferingWeekInput,
  type OfferingWeekCommitPlan,
  type OfferingWeekWriterDeps,
} from "./offering-weekly-schedule-writer";
import type { WeekOwnerRow } from "./offering-weekly-schedule-writer-core";

const OFFERING_ID = "cmrxk58vc0000lscnfm54bpze";
const WEEK_ID = "week-l2-1";

interface Recorder {
  deps: OfferingWeekWriterDeps;
  resolveCalls: string[];
  fetchCalls: string[];
  commitCalls: OfferingWeekCommitPlan[];
}

function makeDeps(weekOwner: WeekOwnerRow | null = null): Recorder {
  const resolveCalls: string[] = [];
  const fetchCalls: string[] = [];
  const commitCalls: OfferingWeekCommitPlan[] = [];
  const deps: OfferingWeekWriterDeps = {
    resolveOffering: async (id) => {
      resolveCalls.push(id);
      return { id: OFFERING_ID, status: "PLANNED" };
    },
    fetchWeekOwner: async (id) => {
      fetchCalls.push(id);
      return weekOwner;
    },
    commit: async (plan) => {
      commitCalls.push(plan);
      return plan.mode === "reimport" ? plan.weeklyScheduleId : "week-created";
    },
  };
  return { deps, resolveCalls, fetchCalls, commitCalls };
}

function baseInput(overrides: Partial<CommitOfferingWeekInput> = {}): CommitOfferingWeekInput {
  return {
    courseOfferingId: OFFERING_ID,
    name: 'לו"ז שבוע 1',
    startDate: "2026-07-26",
    endDate: "2026-07-31",
    uploadedFileName: "week1.xlsx",
    items: [
      { dateKey: "2026-07-26", startTime: "08:00", endTime: "09:30", title: "רכיבה" },
    ],
    ...overrides,
  };
}

const MALFORMED_ROW = {
  dateKey: "2026-07-27",
  startTime: "10:00",
  endTime: "11:00",
  title: "רכיבה",
  combinedParticipationMalformed: true,
};

test("offering CREATE with a malformed משולב row performs ZERO writes", async () => {
  const r = makeDeps();
  const result = await commitOfferingWeeklyScheduleWithDeps(
    baseInput({ items: [...baseInput().items as unknown[], MALFORMED_ROW] }),
    r.deps,
  );
  assert.deepEqual(result, { success: false, error: "invalid_combined" });
  // Rejected at pure validation (step 1): nothing downstream ran.
  assert.deepEqual(r.resolveCalls, []);
  assert.deepEqual(r.fetchCalls, []);
  assert.deepEqual(r.commitCalls, []);
});

test("offering RE-IMPORT with a malformed משולב row is rejected BEFORE deleteMany (no commit)", async () => {
  const r = makeDeps({ id: WEEK_ID, courseOfferingId: OFFERING_ID });
  const result = await commitOfferingWeeklyScheduleWithDeps(
    baseInput({ weeklyScheduleId: WEEK_ID, items: [MALFORMED_ROW] }),
    r.deps,
  );
  assert.deepEqual(result, { success: false, error: "invalid_combined" });
  // commit() (the only place delete+create happen) was never called, and the
  // ownership fetch never ran either.
  assert.deepEqual(r.fetchCalls, []);
  assert.deepEqual(r.commitCalls, []);
});

test("a CRAFTED payload with combinedParticipationMalformed=true is rejected server-side", async () => {
  // Proves the server gate - not the client - is the real control: even if a
  // hand-built payload sets the marker, the writer rejects it and never commits.
  const r = makeDeps();
  const result = await commitOfferingWeeklyScheduleWithDeps(
    baseInput({
      items: [{ dateKey: "2026-07-26", startTime: "08:00", endTime: "09:00", title: "x", combinedParticipationMalformed: true }],
    }),
    r.deps,
  );
  assert.equal(result.success, false);
  assert.deepEqual(r.commitCalls, []);
});

test("blank and explicit-false משולב values are accepted and reach commit", async () => {
  const r = makeDeps();
  const result = await commitOfferingWeeklyScheduleWithDeps(
    baseInput({
      items: [
        { dateKey: "2026-07-26", startTime: "08:00", endTime: "09:00", title: "a", combinedParticipation: false },
        { dateKey: "2026-07-27", startTime: "08:00", endTime: "09:00", title: "b", combinedParticipation: null },
        { dateKey: "2026-07-28", startTime: "08:00", endTime: "09:00", title: "c" },
      ],
    }),
    r.deps,
  );
  assert.equal(result.success, true);
  assert.equal(r.commitCalls.length, 1);
  const plan = r.commitCalls[0];
  // The explicit `false` survived into the normalized createMany rows.
  assert.deepEqual(
    plan.items.map((i) => i.combinedParticipation),
    [false, null, null],
  );
  // The malformed marker is not carried on any normalized row.
  for (const row of plan.items) {
    assert.equal("combinedParticipationMalformed" in row, false);
  }
});
