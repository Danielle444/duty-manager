/**
 * W6D3-HOTFIX - READ-ONLY single-trainee group/horse history diagnostic.
 *
 * Verifies, for ONE explicitly supplied trainee, that the effective-dated history
 * still preserves the pre-change group/horse and that the readers now resolve the
 * correct value per date. Loads the trainee's enrollment-scoped GroupMembership
 * intervals, their TraineeHorseAssignment intervals, and the current Student
 * mirror; then prints the effective GROUP and HORSE resolved at one PAST date and
 * at today using the same pure resolvers the fixed readers use.
 *
 * SAFETY MODEL:
 *  - READ-ONLY: SELECTs only. No --apply, no write path, no transaction. Safe to
 *    point at production for inspection.
 *  - SINGLE SUBJECT ONLY: a `--student=<id>` argument is REQUIRED. With no id the
 *    script refuses to run — it never emits production-wide output.
 *  - Scoped output: prints only this one trainee's group/horse values (the point
 *    of the check) plus safe ids and dates. Never a person name, phone, or
 *    identity number.
 *
 * Usage (AFTER deployment; do NOT run during standard validation). Provide
 * EXACTLY ONE subject selector:
 *   npx tsx scripts/diagnose-trainee-group-horse-history.ts --student=<studentId> --as-of=2026-07-10
 *   npx tsx scripts/diagnose-trainee-group-horse-history.ts --student-name="<exact full name>" --as-of=2026-07-06
 * An exact --student-name resolves to a single ACTIVE Student (fails closed on
 * zero/multiple) and prints the resolved id for reuse.
 */
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { identifyDbTarget } from "./backfill-course-offering.plan";
import { resolveCurrentCourseOffering } from "../lib/course/current-offering";
import { isValidDateKey } from "../lib/trainee-history/interval-resolver";
import { utcMidnightToDateKey } from "../lib/trainee-history/israel-date";
import { resolveGroupFromMembership, type RawMembership } from "../lib/course/enrollment-view";
import {
  resolveHistoricalGroup,
  resolveHistoricalHorse,
  type HorseIntervalRow,
} from "../lib/course/historical-trainee-state-core";

interface ParsedArgs {
  studentId: string | null;
  studentName: string | null;
  asOf: string | null;
  errors: string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let studentId: string | null = null;
  let studentName: string | null = null;
  let asOf: string | null = null;
  const errors: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("--student=")) {
      const v = arg.slice("--student=".length).trim();
      if (v.length === 0) errors.push("--student must be a non-empty studentId");
      else studentId = v;
    } else if (arg.startsWith("--student-name=")) {
      const v = arg.slice("--student-name=".length).trim();
      if (v.length === 0) errors.push("--student-name must be a non-empty full name");
      else studentName = v;
    } else if (arg.startsWith("--as-of=")) {
      const v = arg.slice("--as-of=".length).trim();
      if (!isValidDateKey(v)) errors.push(`--as-of must be a valid YYYY-MM-DD date, got ${JSON.stringify(v)}`);
      else asOf = v;
    } else {
      errors.push(`Unrecognized argument: ${arg}`);
    }
  }
  // REQUIRED single subject via EXACTLY ONE lookup mode: refuse course-wide output.
  if (studentId === null && studentName === null) {
    errors.push("Exactly one of --student=<studentId> or --student-name=<exact full name> is REQUIRED.");
  } else if (studentId !== null && studentName !== null) {
    errors.push("Provide only ONE of --student or --student-name, not both.");
  }
  return { studentId, studentName, asOf, errors };
}

function groupLabel(m: RawMembership): string {
  const g = resolveGroupFromMembership(m.courseGroup);
  if (!g.ok) return `UNRESOLVED(${g.kind})`;
  return g.subgroupNumber === null ? g.groupName : `${g.groupName}${g.subgroupNumber}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.errors.length > 0) {
    for (const e of args.errors) console.error(e);
    process.exitCode = 1;
    return;
  }

  const target = identifyDbTarget(process.env.DATABASE_URL);
  console.log("=== W6D3-HOTFIX single-trainee group/horse history diagnostic (READ-ONLY) ===");
  console.log(`Database target: ${target.display}`);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    // Resolve the single subject id: either the supplied --student id, or an
    // exact ACTIVE fullName match for --student-name (fail closed on 0/multiple).
    let studentId: string;
    if (args.studentName !== null) {
      const matches = await prisma.student.findMany({
        where: { fullName: args.studentName, isActive: true },
        select: { id: true },
      });
      if (matches.length === 0) {
        console.error(`No ACTIVE student with the exact full name provided.`);
        process.exitCode = 1;
        return;
      }
      if (matches.length > 1) {
        console.error(`Multiple ACTIVE students share that exact full name (${matches.length}); refusing to guess.`);
        process.exitCode = 1;
        return;
      }
      studentId = matches[0].id;
    } else {
      studentId = args.studentId as string;
    }
    console.log(`Subject studentId: ${studentId}`);

    const pastDate = args.asOf ? new Date(`${args.asOf}T00:00:00.000Z`) : null;
    const today = new Date();

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, groupName: true, subgroupNumber: true, hasPrivateHorse: true, privateHorseName: true, assignedHorseName: true },
    });
    if (!student) {
      console.error(`No student with id ${studentId}.`);
      process.exitCode = 1;
      return;
    }

    const offering = await resolveCurrentCourseOffering();
    const enrollment = await prisma.courseEnrollment.findUnique({
      where: { studentId_courseOfferingId: { studentId, courseOfferingId: offering.id } },
      select: {
        id: true,
        status: true,
        memberships: {
          orderBy: { effectiveFrom: "asc" },
          select: {
            effectiveFrom: true,
            effectiveTo: true,
            courseGroup: { select: { name: true, parentGroupId: true, parentGroup: { select: { name: true } } } },
          },
        },
      },
    });

    const horseRows = await prisma.traineeHorseAssignment.findMany({
      where: { studentId },
      orderBy: { effectiveFrom: "asc" },
      select: { effectiveFrom: true, effectiveTo: true, hasPrivateHorse: true, privateHorseName: true, assignedHorseName: true },
    });

    const memberships: RawMembership[] = enrollment?.memberships ?? [];
    const horseIntervals: HorseIntervalRow[] = horseRows;

    console.log(`\n--- Current Student mirror (current-only) ---`);
    console.log(`  group=${student.groupName ?? "-"}${student.subgroupNumber ?? ""}  horse: private=${student.hasPrivateHorse} name=${student.privateHorseName ?? student.assignedHorseName ?? "-"}`);

    console.log(`\n--- Dated GROUP intervals (enrollment ${enrollment?.id ?? "MISSING"}, status ${enrollment?.status ?? "-"}) ---`);
    for (const m of memberships) {
      const from = utcMidnightToDateKey(m.effectiveFrom);
      const to = m.effectiveTo === null ? "open" : utcMidnightToDateKey(m.effectiveTo);
      console.log(`  [${from} .. ${to})  -> ${groupLabel(m)}`);
    }

    console.log(`\n--- Dated HORSE intervals ---`);
    for (const h of horseIntervals) {
      const from = utcMidnightToDateKey(h.effectiveFrom);
      const to = h.effectiveTo === null ? "open" : utcMidnightToDateKey(h.effectiveTo);
      console.log(`  [${from} .. ${to})  -> private=${h.hasPrivateHorse} name=${h.privateHorseName ?? h.assignedHorseName ?? "-"}`);
    }

    const report = (label: string, at: Date) => {
      const g = resolveHistoricalGroup(memberships, at);
      const hh = resolveHistoricalHorse(horseIntervals, at);
      const gStr = g.ok ? `${g.value.groupName}${g.value.subgroupNumber ?? ""}` : `UNKNOWN(${g.kind})`;
      const hStr = hh.ok ? (hh.value.privateHorseName ?? hh.value.assignedHorseName ?? "-") : `UNKNOWN(${hh.kind})`;
      console.log(`  ${label} (${utcMidnightToDateKey(new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())))}): group=${gStr} horse=${hStr}`);
    };

    console.log(`\n--- Effective resolved values ---`);
    if (pastDate) report("PAST", pastDate);
    else console.log("  PAST: (pass --as-of=YYYY-MM-DD to resolve a past date)");
    report("TODAY", today);

    console.log(`\n--- End diagnostic (no writes performed) ---`);
  } catch (error) {
    console.error("Trainee group/horse history diagnostic failed.");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
