// Pure unit tests for projectScheduleBoard. Run:
//   npx tsx --test lib/riding-complex-schedule-board/project.test.ts
//
// These tests are pure and DB-free: no Prisma, no network, no clock, no
// randomness. Every input is a fixed literal.

import test from "node:test";
import assert from "node:assert/strict";

import {
  projectScheduleBoard,
  type ScheduleBoardBlockInput,
  type ScheduleBoardStationInput,
  type ScheduleBoardPairInput,
  type ScheduleBoardCandidateInput,
} from "./project";

function pair(overrides: Partial<ScheduleBoardPairInput> = {}): ScheduleBoardPairInput {
  return {
    trainee1Id: null,
    trainee1Name: null,
    trainee2Id: null,
    trainee2Name: null,
    horseName: null,
    note: null,
    sortOrder: 0,
    ...overrides,
  };
}

function station(overrides: Partial<ScheduleBoardStationInput> = {}): ScheduleBoardStationInput {
  return {
    instructor: null,
    arena: null,
    sortOrder: 0,
    pairs: [],
    ...overrides,
  };
}

function block(overrides: Partial<ScheduleBoardBlockInput> = {}): ScheduleBoardBlockInput {
  return {
    startTime: "09:00",
    endTime: "10:00",
    sortOrder: 0,
    stations: [],
    ...overrides,
  };
}

const candidates: ScheduleBoardCandidateInput[] = [
  { studentId: "s1", studentName: "דנה" },
  { studentId: "s2", studentName: "יואב" },
  { studentId: "s3", studentName: "מאיה" },
];

test("empty plan -> empty board", () => {
  const vm = projectScheduleBoard({ blocks: [] }, candidates);
  assert.deepEqual(vm, { blocks: [] });
});

test("null/undefined plan and candidates -> empty board (no throw)", () => {
  assert.deepEqual(projectScheduleBoard(null, null), { blocks: [] });
  assert.deepEqual(projectScheduleBoard(undefined, undefined), { blocks: [] });
});

test("blocks are ordered chronologically by start time, not array position", () => {
  const vm = projectScheduleBoard(
    {
      blocks: [
        block({ startTime: "11:00", endTime: "12:00" }),
        block({ startTime: "08:00", endTime: "09:00" }),
        block({ startTime: "09:30", endTime: "10:30" }),
      ],
    },
    candidates
  );
  assert.deepEqual(
    vm.blocks.map((b) => b.startTime),
    ["08:00", "09:30", "11:00"]
  );
  assert.deepEqual(
    vm.blocks.map((b) => b.key),
    ["b0", "b1", "b2"]
  );
});

test("equal start times tie-break by sortOrder then original position (deterministic)", () => {
  const vm = projectScheduleBoard(
    {
      blocks: [
        block({ startTime: "09:00", endTime: "10:00", sortOrder: 5 }),
        block({ startTime: "09:00", endTime: "09:45", sortOrder: 2 }),
      ],
    },
    candidates
  );
  assert.deepEqual(
    vm.blocks.map((b) => b.endTime),
    ["09:45", "10:00"]
  );
});

test("stations and pairs are ordered by sortOrder", () => {
  const vm = projectScheduleBoard(
    {
      blocks: [
        block({
          stations: [
            station({
              sortOrder: 2,
              instructor: { fullName: "מאמן ב" },
              pairs: [
                pair({ sortOrder: 3, trainee1Id: "s3" }),
                pair({ sortOrder: 1, trainee1Id: "s1" }),
              ],
            }),
            station({ sortOrder: 1, instructor: { fullName: "מאמן א" } }),
          ],
        }),
      ],
    },
    candidates
  );
  assert.deepEqual(
    vm.blocks[0].stations.map((s) => s.instructorName),
    ["מאמן א", "מאמן ב"]
  );
  assert.deepEqual(vm.blocks[0].stations[1].pairs.map((p) => p.traineeNames[0]), ["דנה", "מאיה"]);
});

test("trainee names resolve via candidate lookup, then fall back to row name, else drop", () => {
  const vm = projectScheduleBoard(
    {
      blocks: [
        block({
          stations: [
            station({
              pairs: [
                // resolved via candidate map (row name intentionally stale)
                pair({ trainee1Id: "s2", trainee1Name: "שם ישן" }),
                // no id match -> falls back to denormalized row name
                pair({ trainee1Id: "gone", trainee1Name: "אורח" }),
                // no id, no name -> dropped, leaving an empty pair
                pair({ horseName: "כוכב" }),
                // candidate name is whitespace-only -> falls through to the
                // trimmed denormalized row name (blank candidate never wins)
                pair({ trainee1Id: "sBlank", trainee1Name: " גיבוי " }),
              ],
            }),
          ],
        }),
      ],
    },
    [...candidates, { studentId: "sBlank", studentName: "   " }]
  );
  const pairs = vm.blocks[0].stations[0].pairs;
  assert.deepEqual(pairs[0].traineeNames, ["יואב"]);
  assert.deepEqual(pairs[1].traineeNames, ["אורח"]);
  assert.deepEqual(pairs[2].traineeNames, []);
  assert.deepEqual(pairs[3].traineeNames, ["גיבוי"]);
});

test("two-trainee pair lists both names in order (who rides with whom)", () => {
  const vm = projectScheduleBoard(
    {
      blocks: [
        block({
          stations: [station({ pairs: [pair({ trainee1Id: "s1", trainee2Id: "s3" })] })],
        }),
      ],
    },
    candidates
  );
  assert.deepEqual(vm.blocks[0].stations[0].pairs[0].traineeNames, ["דנה", "מאיה"]);
});

test("blank horse/note/instructor/arena trim to null; present values are trimmed", () => {
  const vm = projectScheduleBoard(
    {
      blocks: [
        block({
          stations: [
            station({
              instructor: { fullName: "  " },
              arena: "   ",
              pairs: [pair({ trainee1Id: "s1", horseName: "  ", note: "  " })],
            }),
            station({
              instructor: { fullName: " רוני " },
              arena: " מגרש 1 ",
              pairs: [pair({ trainee1Id: "s2", horseName: " כוכב ", note: " בודקים " })],
            }),
          ],
        }),
      ],
    },
    candidates
  );
  const [s0, s1] = vm.blocks[0].stations;
  assert.equal(s0.instructorName, null);
  assert.equal(s0.arena, null);
  assert.equal(s0.pairs[0].horseName, null);
  assert.equal(s0.pairs[0].note, null);
  assert.equal(s1.instructorName, "רוני");
  assert.equal(s1.arena, "מגרש 1");
  assert.equal(s1.pairs[0].horseName, "כוכב");
  assert.equal(s1.pairs[0].note, "בודקים");
});

test("empty blocks and empty stations render safely (no pairs/stations, no throw)", () => {
  const vm = projectScheduleBoard(
    {
      blocks: [
        block({ startTime: "08:00", endTime: "09:00", stations: [] }),
        block({
          startTime: "09:00",
          endTime: "10:00",
          stations: [station({ instructor: { fullName: "רוני" }, pairs: [] })],
        }),
      ],
    },
    candidates
  );
  assert.equal(vm.blocks[0].stations.length, 0);
  assert.equal(vm.blocks[1].stations[0].pairs.length, 0);
  assert.equal(vm.blocks[1].stations[0].instructorName, "רוני");
});

test("output view model exposes no database ids or internal metadata", () => {
  const vm = projectScheduleBoard(
    {
      blocks: [
        block({
          stations: [station({ instructor: { fullName: "רוני" }, pairs: [pair({ trainee1Id: "s1" })] })],
        }),
      ],
    },
    candidates
  );
  const serialized = JSON.stringify(vm);
  // Keys are index-derived, never leaked db ids.
  assert.match(serialized, /"key":"b0"/);
  assert.doesNotMatch(serialized, /sortOrder|updatedAt|updatedByName|"id"/);
  assert.doesNotMatch(serialized, /s1/); // no studentId leaked (only resolved name)
});

test("null array elements are skipped defensively", () => {
  const vm = projectScheduleBoard(
    {
      blocks: [
        null as unknown as ScheduleBoardBlockInput,
        block({
          stations: [
            null as unknown as ScheduleBoardStationInput,
            station({
              instructor: { fullName: "רוני" },
              pairs: [null as unknown as ScheduleBoardPairInput, pair({ trainee1Id: "s1" })],
            }),
          ],
        }),
      ],
    },
    candidates
  );
  assert.equal(vm.blocks.length, 1);
  assert.equal(vm.blocks[0].stations.length, 1);
  assert.equal(vm.blocks[0].stations[0].pairs.length, 1);
  assert.deepEqual(vm.blocks[0].stations[0].pairs[0].traineeNames, ["דנה"]);
});

test("malformed/blank start times sort after valid times, tie-broken deterministically", () => {
  const vm = projectScheduleBoard(
    {
      blocks: [
        block({ startTime: "", endTime: "blank-a", sortOrder: 9 }),
        block({ startTime: "10:00", endTime: "valid-late" }),
        block({ startTime: "not-a-time", endTime: "malformed", sortOrder: 3 }),
        block({ startTime: "08:00", endTime: "valid-early" }),
        // second blank: same (sentinel) time + same sortOrder as the first
        // blank -> tie-broken by original array position, stays after it.
        block({ startTime: "   ", endTime: "blank-b", sortOrder: 9 }),
      ],
    },
    candidates
  );
  // Valid times first in chronological order; all unparseable times sort last.
  // Among the unparseable ones: sortOrder 3 before sortOrder 9, and the two
  // equal-sortOrder blanks keep their original relative order.
  assert.deepEqual(
    vm.blocks.map((b) => b.endTime),
    ["valid-early", "valid-late", "malformed", "blank-a", "blank-b"]
  );
});

test("projection does not mutate input arrays or their ordering", () => {
  const p1 = pair({ sortOrder: 3, trainee1Id: "s3" });
  const p2 = pair({ sortOrder: 1, trainee1Id: "s1" });
  const pairsInput = [p1, p2];
  const s1 = station({ sortOrder: 2, instructor: { fullName: "מאמן ב" }, pairs: pairsInput });
  const s2 = station({ sortOrder: 1, instructor: { fullName: "מאמן א" } });
  const stationsInput = [s1, s2];
  const b1 = block({ startTime: "11:00", endTime: "12:00", stations: stationsInput });
  const b2 = block({ startTime: "08:00", endTime: "09:00" });
  const blocksInput = [b1, b2];

  const before = {
    blocks: blocksInput.slice(),
    stations: stationsInput.slice(),
    pairs: pairsInput.slice(),
  };

  projectScheduleBoard({ blocks: blocksInput }, candidates);

  // Same array references, same element order, same length - untouched.
  assert.deepEqual(blocksInput, before.blocks);
  assert.equal(blocksInput[0], b1);
  assert.equal(blocksInput[1], b2);
  assert.deepEqual(stationsInput, before.stations);
  assert.equal(stationsInput[0], s1);
  assert.equal(stationsInput[1], s2);
  assert.deepEqual(pairsInput, before.pairs);
  assert.equal(pairsInput[0], p1);
  assert.equal(pairsInput[1], p2);
});
