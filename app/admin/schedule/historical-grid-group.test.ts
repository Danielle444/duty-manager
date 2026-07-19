/**
 * Focused tests for the admin duty-grid per-student historical group mapper
 * (W6D3-HOTFIX). No Prisma, no DB, no React. Run with:
 *   npx tsx --test app/admin/schedule/historical-grid-group.test.ts
 *
 * Encodes the reported case: Nir's CURRENT mirror is ב5, but her Week A duty
 * assignments carry the historical group א1. The grid row must show א1 for Week A,
 * ב5 on/after the change, and must NEVER fall back to the current mirror.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveGridGroupByStudent,
  type HistoricalGroupAssignment,
} from "./historical-grid-group";

const NIR = "nir";

// Nir's Week A / Week B duty assignments (server-resolved historical group = א1),
// plus a post-change assignment (ב5). The current Student mirror (ב5) is
// deliberately NOT an input to the mapper — it cannot leak in.
const NIR_WEEK_A: HistoricalGroupAssignment[] = [
  { studentId: NIR, dateKey: "2026-07-13", groupName: "א", subgroupNumber: 1 },
  { studentId: NIR, dateKey: "2026-07-12", groupName: "א", subgroupNumber: 1 },
];
const NIR_AFTER_CHANGE: HistoricalGroupAssignment[] = [
  { studentId: NIR, dateKey: "2026-07-20", groupName: "ב", subgroupNumber: 5 },
];

test("Week A grid row uses א1 (historical), not the current ב5 mirror", () => {
  const map = resolveGridGroupByStudent(NIR_WEEK_A, "2026-07-12", "2026-07-17");
  assert.deepEqual(map.get(NIR), { groupName: "א", subgroupNumber: 1 });
});

test("earliest in-range assignment wins (start of the viewed week)", () => {
  // Both a Week A (א1) and a post-change (ב5) assignment in one wide range:
  // the earliest date (Week A) determines the row group.
  const straddling = [...NIR_WEEK_A, ...NIR_AFTER_CHANGE];
  const map = resolveGridGroupByStudent(straddling, "2026-07-12", "2026-07-24");
  assert.deepEqual(map.get(NIR), { groupName: "א", subgroupNumber: 1 });
});

test("on/after the change date the row uses ב5", () => {
  const map = resolveGridGroupByStudent(NIR_AFTER_CHANGE, "2026-07-19", "2026-07-24");
  assert.deepEqual(map.get(NIR), { groupName: "ב", subgroupNumber: 5 });
});

test("no in-range assignment → absent (null), never the current mirror", () => {
  // Nir has only a Week A assignment; viewing a LATER week with no assignment
  // must yield no entry (caller shows null/'–'), never her current ב5 mirror.
  const map = resolveGridGroupByStudent(NIR_WEEK_A, "2026-07-26", "2026-07-31");
  assert.equal(map.get(NIR), undefined);
});

test("out-of-range assignments are excluded", () => {
  const withEarlier: HistoricalGroupAssignment[] = [
    { studentId: NIR, dateKey: "2026-07-05", groupName: "א", subgroupNumber: 1 }, // before range
    { studentId: NIR, dateKey: "2026-07-20", groupName: "ב", subgroupNumber: 5 }, // in range
  ];
  const map = resolveGridGroupByStudent(withEarlier, "2026-07-19", "2026-07-24");
  assert.deepEqual(map.get(NIR), { groupName: "ב", subgroupNumber: 5 });
});

test("unbounded range still resolves from the earliest assignment", () => {
  const map = resolveGridGroupByStudent([...NIR_AFTER_CHANGE, ...NIR_WEEK_A], null, null);
  assert.deepEqual(map.get(NIR), { groupName: "א", subgroupNumber: 1 });
});
