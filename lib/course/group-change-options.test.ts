/**
 * Executable tests for the PURE server-side group-change option builder (Stage
 * W6D3). No Prisma, no DB. Run with:
 *   npx tsx --test lib/course/group-change-options.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLeafGroupOptions,
  groupChangeOptionLabel,
  type CourseGroupOptionRow,
} from "./group-change-options";

const PARENT_A = "pg-a";
const PARENT_B = "pg-b";

/** A representative hierarchy: two parents (א, ב) each with numbered leaves. */
const ROWS: CourseGroupOptionRow[] = [
  { id: PARENT_A, name: "א", parentGroupId: null, parentName: null },
  { id: PARENT_B, name: "ב", parentGroupId: null, parentName: null },
  { id: "cg-a2", name: "2", parentGroupId: PARENT_A, parentName: "א" },
  { id: "cg-a1", name: "1", parentGroupId: PARENT_A, parentName: "א" },
  { id: "cg-b1", name: "1", parentGroupId: PARENT_B, parentName: "ב" },
];

test("label is derived server-side as parent + subgroup", () => {
  assert.equal(groupChangeOptionLabel("א", 1), "א׳ — תת־קבוצה 1");
});

test("only leaf subgroups become options, each with courseGroupId + label", () => {
  const options = buildLeafGroupOptions(ROWS);
  assert.deepEqual(
    options.map((o) => o.courseGroupId),
    ["cg-a1", "cg-a2", "cg-b1"],
  );
  assert.deepEqual(options[0], {
    courseGroupId: "cg-a1",
    label: "א׳ — תת־קבוצה 1",
    parentName: "א",
    subgroupNumber: 1,
  });
});

test("top-level (parentGroupId null) groups are excluded", () => {
  const options = buildLeafGroupOptions(ROWS);
  assert.ok(!options.some((o) => o.courseGroupId === PARENT_A || o.courseGroupId === PARENT_B));
});

test("sorted by parent (Hebrew) then subgroup number", () => {
  const options = buildLeafGroupOptions(ROWS);
  assert.deepEqual(
    options.map((o) => o.label),
    ["א׳ — תת־קבוצה 1", "א׳ — תת־קבוצה 2", "ב׳ — תת־קבוצה 1"],
  );
});

test("malformed subgroup names and empty parents are dropped (fail closed)", () => {
  const bad: CourseGroupOptionRow[] = [
    { id: "x1", name: "abc", parentGroupId: PARENT_A, parentName: "א" },
    { id: "x2", name: "0", parentGroupId: PARENT_A, parentName: "א" },
    { id: "x3", name: "-1", parentGroupId: PARENT_A, parentName: "א" },
    { id: "x4", name: "1.5", parentGroupId: PARENT_A, parentName: "א" },
    { id: "x5", name: "3", parentGroupId: PARENT_A, parentName: "   " },
    { id: "x6", name: "4", parentGroupId: PARENT_A, parentName: null },
  ];
  assert.deepEqual(buildLeafGroupOptions(bad), []);
});
