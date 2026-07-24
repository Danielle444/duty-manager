/**
 * Combined Participation Slice 1 - SOURCE-CONTRACT tests for the parts of the
 * "use server" schedule modules that cannot be imported into a plain
 * `tsx --test` process (they transitively import Prisma / next-auth / next/cache).
 *
 * Same readFileSync + node:test convention as
 * schedule-writer-auth.contract.test.ts. Covers:
 *   - the Excel parser recognizes "משולב" and populates the two new fields in all
 *     three parse phases;
 *   - the LEGACY commitWeeklySchedule rejects a malformed value BEFORE any
 *     update / deleteMany / createMany (zero writes), and its createMany map uses
 *     an explicit tri-state (never truthiness);
 *   - CONTAINMENT: the trainee schedule reader is untouched by this slice.
 *
 * Run with: npx tsx --test lib/actions/weekly-schedule-combined-participation.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const weeklyScheduleSrc = read("./weekly-schedule.ts");
const scheduleItemsSrc = read("./schedule-items.ts");
const studentScheduleSrc = read("./student-schedule.ts");

function functionSource(src: string, name: string): string {
  const marker = `export async function ${name}(`;
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `expected to find ${name}`);
  const next = src.indexOf("\nexport ", start + marker.length);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

// ===========================================================================
// Parser: "משולב" recognition + field population in all three phases
// ===========================================================================

test('the parser declares the "משולב" synonym and a "combined" column kind', () => {
  assert.match(weeklyScheduleSrc, /const COMBINED_SYNONYMS = \["משולב"\];/);
  assert.match(weeklyScheduleSrc, /kind:\s*"combined"/, "classifyHeaderCell must classify a combined column");
  assert.ok(
    weeklyScheduleSrc.includes("COMBINED_SYNONYMS.some((s) => normalizeHeader(s) === normalized)"),
    "the combined branch must follow the existing exact-match synonym pattern",
  );
});

test("the parser imports the pure parseHebrewYesNo helper", () => {
  assert.match(
    weeklyScheduleSrc,
    /import \{ parseHebrewYesNo \} from "@\/lib\/course\/parse-hebrew-yes-no"/,
  );
});

test("ScheduleImportItem carries the tri-state value and the malformed marker", () => {
  assert.match(weeklyScheduleSrc, /combinedParticipation:\s*boolean\s*\|\s*null;/);
  assert.match(weeklyScheduleSrc, /combinedParticipationMalformed:\s*boolean;/);
});

test("all three parse phases populate the two combined fields", () => {
  // Structured phase reads the cell via parseHebrewYesNo and forwards value+malformed.
  assert.ok(weeklyScheduleSrc.includes("parseHebrewYesNo(cellText(row, block.combinedCol))"));
  assert.ok(weeklyScheduleSrc.includes("combinedParticipation: combined.value"));
  assert.ok(weeklyScheduleSrc.includes("combinedParticipationMalformed: combined.malformed"));
  // Transposed + freeform have no combined column -> null / false. Two literal
  // occurrences of each (one per phase).
  assert.ok(
    (weeklyScheduleSrc.match(/combinedParticipation: null,/g) ?? []).length >= 2,
    "transposed and freeform phases must set combinedParticipation: null",
  );
  assert.ok(
    (weeklyScheduleSrc.match(/combinedParticipationMalformed: false,/g) ?? []).length >= 2,
    "transposed and freeform phases must set combinedParticipationMalformed: false",
  );
});

// ===========================================================================
// Legacy commitWeeklySchedule: reject-before-write + explicit createMany map
// ===========================================================================

test("commitWeeklySchedule gates malformed משולב BEFORE any write, after requireAdmin", () => {
  const body = functionSource(weeklyScheduleSrc, "commitWeeklySchedule");
  const gate = body.indexOf("hasUnresolvedMalformedCombinedParticipation(input.items)");
  assert.notEqual(gate, -1, "the malformed gate must be present");

  const admin = body.indexOf("await requireAdmin()");
  assert.ok(admin !== -1 && admin < gate, "requireAdmin() must precede the combined gate");

  for (const step of [
    "prisma.weeklySchedule.update",
    "prisma.scheduleItem.deleteMany",
    "prisma.weeklySchedule.create",
    "prisma.scheduleItem.createMany",
  ]) {
    const idx = body.indexOf(step);
    assert.ok(idx !== -1, `expected ${step} to still exist`);
    assert.ok(gate < idx, `the combined gate must precede ${step} (zero writes on rejection)`);
  }

  // The rejection uses the specified Hebrew message and the contained result shape.
  assert.ok(body.includes("יש לתקן את הערכים הלא תקינים בעמודת משולב לפני השמירה."));
});

test("the createMany map uses an explicit tri-state, never truthiness", () => {
  const body = functionSource(weeklyScheduleSrc, "commitWeeklySchedule");
  assert.ok(
    body.includes("i.combinedParticipation === true"),
    "the map must branch explicitly on === true / === false",
  );
  // A real `false` must never be coerced to null via `|| null`.
  assert.ok(
    !/combinedParticipation:\s*i\.combinedParticipation\s*\|\|\s*null/.test(body),
    "combinedParticipation must not be mapped with `|| null`",
  );
});

test("schedule-items.ts accepts an optional nullable combinedParticipation and preserves false", () => {
  assert.match(scheduleItemsSrc, /combinedParticipation:\s*z\.boolean\(\)\.nullable\(\)\.optional\(\)/);
  // `?? null` preserves an explicit false (false is not nullish).
  assert.ok(scheduleItemsSrc.includes("combinedParticipation: input.combinedParticipation ?? null"));
});

// ===========================================================================
// CONTAINMENT: the trainee schedule reader is untouched by this slice
// ===========================================================================

test("student-schedule.ts reads no combinedParticipation / משולב (visibility unchanged)", () => {
  for (const token of ["combinedParticipation", "combined_participation", "משולב"]) {
    assert.ok(
      !studentScheduleSrc.includes(token),
      `student-schedule.ts must not reference ${token} (data-only slice, no visibility change)`,
    );
  }
});
