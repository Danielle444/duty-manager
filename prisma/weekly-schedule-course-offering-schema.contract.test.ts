/**
 * Multi-course Schedule Slice S1 - focused schema/migration CONTRACT tests for
 * the ADDITIVE, NULLABLE CourseOffering relation added to WeeklySchedule.
 *
 * This slice must NOT change runtime behavior. It adds ONLY:
 *   - a nullable `courseOfferingId String?` on WeeklySchedule
 *   - a nullable `courseOffering CourseOffering? @relation(... onDelete: Restrict)`
 *   - an index on courseOfferingId
 *   - the inverse `weeklySchedules WeeklySchedule[]` on CourseOffering
 *
 * It must NOT introduce: NOT NULL, a unique constraint, Cascade deletion, any
 * data backfill (UPDATE/INSERT/DELETE), a default offering, table recreation,
 * or any ScheduleItem / descendant change. Those are explicitly later, separate
 * slices.
 *
 * Uses the repository's established SOURCE-CONTRACT test pattern (same
 * readFileSync + node:test convention as
 * lib/actions/schedule-writer-auth.contract.test.ts). Run with:
 *   npx tsx --test prisma/weekly-schedule-course-offering-schema.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const schemaSrc = readFileSync(
  fileURLToPath(new URL("./schema.prisma", import.meta.url)),
  "utf8",
);

// Locate the single S1 migration directory by its stable suffix, then read its
// SQL. Not pinned to a hard-coded timestamp so the test survives a rename of the
// timestamp prefix.
const migrationsDir = fileURLToPath(new URL("./migrations", import.meta.url));
const s1Dirs = readdirSync(migrationsDir).filter((d) =>
  d.endsWith("_add_weekly_schedule_course_offering"),
);
assert.equal(
  s1Dirs.length,
  1,
  "expected exactly one *_add_weekly_schedule_course_offering migration dir",
);
const migrationSql = readFileSync(
  `${migrationsDir}/${s1Dirs[0]}/migration.sql`,
  "utf8",
);

// Extract a single `model NAME { ... }` block: from `model NAME {` up to the
// next top-level `\nmodel ` boundary (or end of file). Precise enough for the
// field/relation/index assertions below.
function modelBlock(src: string, name: string): string {
  const marker = `model ${name} {`;
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `expected to find model ${name} in schema`);
  const next = src.indexOf("\nmodel ", start + marker.length);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

const weeklySchedule = modelBlock(schemaSrc, "WeeklySchedule");
const courseOffering = modelBlock(schemaSrc, "CourseOffering");

// Strip `//` line comments so negative assertions reason about real schema
// directives only, not explanatory prose (which deliberately mentions the
// FUTURE @@unique([courseOfferingId, startDate]) that this slice must not add).
const stripComments = (s: string) => s.replace(/\/\/[^\n]*/g, "");
const weeklyScheduleCode = stripComments(weeklySchedule);

// SQL statements with `-- ...` comments removed and split on `;`.
const sqlStatements = migrationSql
  .split(";")
  .map((s) => s.replace(/--[^\n]*(\n|$)/g, "").trim())
  .filter((s) => s.length > 0);

test("1. WeeklySchedule.courseOfferingId is a nullable String? scalar", () => {
  assert.match(
    weeklySchedule,
    /\n\s*courseOfferingId\s+String\?/,
    "courseOfferingId must be declared `String?` (nullable) on WeeklySchedule",
  );
  // Not required: never declared as bare `String` (no `?`).
  assert.doesNotMatch(
    weeklySchedule,
    /\n\s*courseOfferingId\s+String(?!\?)/,
    "courseOfferingId must NOT be a required `String` field",
  );
});

test("2. WeeklySchedule.courseOffering relation is nullable with onDelete: Restrict", () => {
  assert.match(
    weeklySchedule,
    /\n\s*courseOffering\s+CourseOffering\?\s+@relation\(fields:\s*\[courseOfferingId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict\)/,
    "courseOffering must be `CourseOffering?` with onDelete: Restrict",
  );
});

test("3. CourseOffering has the inverse weeklySchedules relation", () => {
  assert.match(
    courseOffering,
    /\n\s*weeklySchedules\s+WeeklySchedule\[\]/,
    "CourseOffering must expose `weeklySchedules WeeklySchedule[]`",
  );
});

test("4. courseOfferingId is indexed (schema @@index + migration CREATE INDEX)", () => {
  assert.match(
    weeklySchedule,
    /@@index\(\[courseOfferingId\]\)/,
    "WeeklySchedule must have @@index([courseOfferingId])",
  );
  assert.match(
    migrationSql,
    /CREATE INDEX "weekly_schedules_courseOfferingId_idx" ON "weekly_schedules"\("courseOfferingId"\)/,
    "migration must CREATE INDEX on weekly_schedules(courseOfferingId)",
  );
});

test("5. no unique constraint on the new column yet", () => {
  assert.doesNotMatch(
    weeklyScheduleCode,
    /@@unique\(\[[^\]]*courseOfferingId/,
    "no @@unique touching courseOfferingId is allowed in this slice",
  );
  assert.doesNotMatch(
    migrationSql,
    /UNIQUE/i,
    "migration must not create any UNIQUE constraint/index",
  );
});

test("6. migration performs no data backfill (no DML statement)", () => {
  // Leading-verb check per statement: this ignores the referential actions
  // `ON UPDATE CASCADE` / `ON DELETE RESTRICT`, which are not DML.
  for (const stmt of sqlStatements) {
    assert.doesNotMatch(
      stmt,
      /^(UPDATE|INSERT|DELETE)\b/i,
      `migration must contain no data-mutation statement, found: ${stmt.slice(0, 40)}`,
    );
  }
});

test("7. no NOT NULL on the new column", () => {
  assert.doesNotMatch(
    migrationSql,
    /NOT NULL/i,
    "the additive column must be nullable - no NOT NULL in the migration",
  );
  assert.match(
    migrationSql,
    /ALTER TABLE "weekly_schedules" ADD COLUMN "courseOfferingId" TEXT;/,
    "column must be added as a plain nullable TEXT column",
  );
});

test("9. no ScheduleItem / descendant table is touched by the migration", () => {
  for (const table of [
    "schedule_items",
    "weekly_feedback",
    "riding_slot",
    "riding_lesson",
  ]) {
    assert.ok(
      !migrationSql.includes(table),
      `migration must not reference ${table}`,
    );
  }
});

test("10. no Cascade deletion is introduced", () => {
  assert.doesNotMatch(
    migrationSql,
    /ON DELETE CASCADE/i,
    "the new FK must be ON DELETE RESTRICT, never CASCADE",
  );
  assert.match(
    migrationSql,
    /ADD CONSTRAINT "weekly_schedules_courseOfferingId_fkey" FOREIGN KEY \("courseOfferingId"\) REFERENCES "course_offerings"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE;/,
    "FK must reference course_offerings(id) with ON DELETE RESTRICT",
  );
});

test("11. existing rows are not recreated (no destructive DDL)", () => {
  for (const ddl of [/DROP TABLE/i, /CREATE TABLE/i, /TRUNCATE/i, /RENAME/i]) {
    assert.doesNotMatch(migrationSql, ddl, `migration must not contain ${ddl}`);
  }
});

test("12. migration is additive: only ADD COLUMN + CREATE INDEX + ADD CONSTRAINT", () => {
  assert.equal(sqlStatements.length, 3, "expected exactly three DDL statements");
  assert.ok(sqlStatements[0].startsWith('ALTER TABLE "weekly_schedules" ADD COLUMN'));
  assert.ok(sqlStatements[1].startsWith("CREATE INDEX"));
  assert.ok(sqlStatements[2].startsWith('ALTER TABLE "weekly_schedules" ADD CONSTRAINT'));
});
