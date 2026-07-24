/**
 * Non-DB CONTRACT (source-scan) tests locking the W6D3-HOTFIX wiring: every
 * historical group/horse reader must resolve via loadHistoricalTraineeState keyed
 * by the record's OWN date and must NOT read the current Student mirror for the
 * historical value. Mirrors the source-scan pattern already used by
 * group-change-service.contract.test.ts. No Prisma, no DB. Run with:
 *   npx tsx --test lib/course/historical-readers.contract.test.ts
 *
 * The as-of-date SEMANTICS (before→א1, on/after→ב5, half-open boundary, missing→
 * unknown, no mirror fallback) are proven in historical-trainee-state-core.test.ts;
 * these tests prove each reader feeds the correct date into that resolver.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

const COMPLETION = read("app/admin/completion/page.tsx");
const SCHEDULE_PAGE = read("app/admin/schedule/page.tsx");
const SCHEDULE_CLIENT = read("app/admin/schedule/ScheduleClient.tsx");
const EXPORT = read("lib/exports/schedule-export.ts");
const DIAGNOSTICS = read("lib/schedule-diagnostics.ts");
const FAIRNESS = read("lib/schedule-fairness.ts");
const WEEKLY = read("lib/actions/weekly-feedback.ts");
const INSTRUCTOR_DUTIES = read("lib/actions/instructor-schedule.ts");
const RIDING = read("lib/actions/riding-slots.ts");

function usesHelper(src: string): boolean {
  return /loadHistoricalTraineeState/.test(src);
}

// --- A: duty readers resolve group by the duty's own date ---

test("3. completion resolves group at the duty date, not the current mirror", () => {
  assert.ok(usesHelper(COMPLETION));
  assert.ok(/groupAt\(a\.studentId,\s*a\.date\)/.test(COMPLETION), "keyed by a.date");
  assert.ok(!/groupName:\s*a\.student\.groupName/.test(COMPLETION), "no current-mirror group output");
});

test("1/2. admin schedule resolves per-assignment group at the duty date", () => {
  assert.ok(usesHelper(SCHEDULE_PAGE));
  assert.ok(/groupAt\(a\.studentId,\s*a\.date\)/.test(SCHEDULE_PAGE), "keyed by a.date");
  // Client renders/filters the per-assignment historical group, not studentById.
  assert.ok(/a\.groupName \?\? "-"/.test(SCHEDULE_CLIENT), "display uses per-assignment group");
  assert.ok(
    /filterGroup && a\.groupName !== filterGroup/.test(SCHEDULE_CLIENT),
    "filter uses per-assignment group",
  );
  assert.ok(
    !/studentById\.get\(a\.studentId\)\?\.groupName/.test(SCHEDULE_CLIENT),
    "no current-mirror group lookup remains for display/filter",
  );
});

test("4. day export resolves at the export date; grid export resolves at endDate", () => {
  assert.ok(usesHelper(EXPORT));
  assert.ok(/groupAt\(a\.studentId,\s*date\)/.test(EXPORT), "day export keyed by the export date");
  assert.ok(/groupAt\(s\.id,\s*endDate\)/.test(EXPORT), "grid export keyed by endDate");
  assert.ok(!/groupName:\s*a\.student\.groupName/.test(EXPORT), "no current-mirror group output");
});

test("6. diagnostics buckets each assignment's subgroup at the duty date", () => {
  assert.ok(usesHelper(DIAGNOSTICS));
  assert.ok(/groupAt\(a\.studentId,\s*a\.date\)/.test(DIAGNOSTICS), "keyed by a.date");
  assert.ok(
    !/subgroupKey\(a\.student\.groupName/.test(DIAGNOSTICS),
    "no current-mirror subgroup bucketing",
  );
});

test("7. fairness resolves each student's group at the report endDate", () => {
  assert.ok(usesHelper(FAIRNESS));
  assert.ok(/groupAt\(s\.id,\s*endDate\)/.test(FAIRNESS), "keyed by endDate");
});

// --- B: weekly feedback resolves by the feedback week ---

test("8/9. weekly feedback resolves group at the feedback week's startDate", () => {
  assert.ok(usesHelper(WEEKLY));
  assert.ok(/weekStart = form\.weeklySchedule\.startDate/.test(WEEKLY), "week start selected");
  assert.ok(/groupAt\(r\.studentId,\s*weekStart\)/.test(WEEKLY), "submitted keyed by week start");
  // L2-F1B renamed the not-submitted source from the global active-student rows
  // (`s`) to the form's own course roster members (`member`). The historical
  // contract is unchanged: whoever is listed is still keyed at the week start.
  assert.ok(/groupAt\(member\.id,\s*weekStart\)/.test(WEEKLY), "not-submitted keyed by week start");
  assert.ok(!/groupName:\s*r\.student\.groupName/.test(WEEKLY), "no current-mirror group output");
});

// --- G: already-shipped readers not regressed ---

test("already-fixed readers still resolve historically (not regressed)", () => {
  assert.ok(usesHelper(INSTRUCTOR_DUTIES));
  assert.ok(/groupAt\(a\.studentId,\s*a\.date\)/.test(INSTRUCTOR_DUTIES), "instructor duties keyed by a.date");
  assert.ok(usesHelper(RIDING));
  assert.ok(/groupAt\(studentId,\s*first\.date\)/.test(RIDING), "riding history keyed by lesson date");
  assert.ok(/horseAt\(studentId,\s*first\.date\)/.test(RIDING), "riding history horse keyed by lesson date");
});
