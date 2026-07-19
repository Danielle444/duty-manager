/**
 * MULTI-COURSE W8A-4 - READ-ONLY horse-cache parity diagnostic.
 *
 * Resolves the single current CourseOffering, loads its ACTIVE-and-INACTIVE
 * enrollments (with their horse caches), ALL TraineeHorseAssignment history rows,
 * and the Student compatibility caches for every subject student, then builds the
 * PURE three-way parity result (lib/course/horse-cache-parity.ts) and prints a
 * PII-FREE summary + safe-id anomaly lines.
 *
 * SAFETY MODEL:
 *  - READ-ONLY: performs SELECTs only. There is NO --apply, NO write path, NO
 *    transaction. It can be pointed at any DB (including production) for
 *    inspection without risk of mutation.
 *  - PII-FREE OUTPUT: only counts, reason codes, and safe public ids
 *    (offeringId / studentId / enrollmentId / traineeHorseAssignmentId) are ever
 *    printed. Never a horse name, person name, phone, or identity number.
 *
 * The single captured asOf is the Israel-local calendar day of one trusted
 * instant taken at startup (override with --as-of=YYYY-MM-DD for inspection).
 *
 * Usage:
 *   npx tsx scripts/diagnose-horse-cache-parity.ts
 *   npx tsx scripts/diagnose-horse-cache-parity.ts --as-of=2026-07-19
 */
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { identifyDbTarget } from "./backfill-course-offering.plan";
import { resolveCurrentCourseOffering } from "../lib/course/current-offering";
import { israelDateKeyFromInstant, utcMidnightToDateKey } from "../lib/trainee-history/israel-date";
import { isValidDateKey } from "../lib/trainee-history/interval-resolver";
import {
  buildHorseCacheParity,
  formatHorseCacheParityAnomalies,
  formatHorseCacheParitySummary,
  type ParityEnrollmentInput,
  type ParityHistoryInput,
  type ParityStudentInput,
} from "../lib/course/horse-cache-parity";

interface ParsedArgs {
  asOf: string | null;
  errors: string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let asOf: string | null = null;
  const errors: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("--as-of=")) {
      const v = arg.slice("--as-of=".length).trim();
      if (!isValidDateKey(v)) {
        errors.push(`--as-of must be a valid YYYY-MM-DD date, got ${JSON.stringify(v)}`);
      } else {
        asOf = v;
      }
    } else {
      errors.push(`Unrecognized argument: ${arg}`);
    }
  }
  return { asOf, errors };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.errors.length > 0) {
    for (const e of args.errors) console.error(e);
    process.exitCode = 1;
    return;
  }

  const target = identifyDbTarget(process.env.DATABASE_URL);
  console.log("=== MULTI-COURSE W8A-4 horse-cache parity diagnostic (READ-ONLY) ===");
  console.log(`Database target: ${target.display}`);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const now = args.asOf ? new Date(`${args.asOf}T12:00:00.000Z`) : new Date();
    const asOf = israelDateKeyFromInstant(now);
    const offering = await resolveCurrentCourseOffering();

    // ALL enrollments in the offering (both statuses) - inactive must surface.
    const enrollmentRows = await prisma.courseEnrollment.findMany({
      where: { courseOfferingId: offering.id },
      select: {
        id: true,
        studentId: true,
        status: true,
        hasPrivateHorse: true,
        privateHorseName: true,
        assignedHorseName: true,
      },
    });
    const enrollments: ParityEnrollmentInput[] = enrollmentRows.map((e) => ({
      id: e.id,
      studentId: e.studentId,
      status: e.status,
      hasPrivateHorse: e.hasPrivateHorse,
      privateHorseName: e.privateHorseName,
      assignedHorseName: e.assignedHorseName,
    }));

    // ALL history rows - an orphan (no enrollment) must surface, not be skipped.
    const historyRows = await prisma.traineeHorseAssignment.findMany({
      select: {
        id: true,
        studentId: true,
        courseEnrollmentId: true,
        assignedHorseName: true,
        hasPrivateHorse: true,
        privateHorseName: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    });
    const horseAssignments: ParityHistoryInput[] = historyRows.map((h) => ({
      id: h.id,
      studentId: h.studentId,
      courseEnrollmentId: h.courseEnrollmentId,
      hasPrivateHorse: h.hasPrivateHorse,
      privateHorseName: h.privateHorseName,
      assignedHorseName: h.assignedHorseName,
      effectiveFrom: utcMidnightToDateKey(h.effectiveFrom),
      effectiveTo: h.effectiveTo === null ? null : utcMidnightToDateKey(h.effectiveTo),
    }));

    // Student compatibility caches for exactly the subject students.
    const subjectIds = [
      ...new Set<string>([
        ...enrollments.map((e) => e.studentId),
        ...horseAssignments.map((h) => h.studentId),
      ]),
    ];
    const studentRows = await prisma.student.findMany({
      where: { id: { in: subjectIds } },
      select: { id: true, hasPrivateHorse: true, privateHorseName: true, assignedHorseName: true },
    });
    const students: ParityStudentInput[] = studentRows.map((s) => ({
      id: s.id,
      hasPrivateHorse: s.hasPrivateHorse,
      privateHorseName: s.privateHorseName,
      assignedHorseName: s.assignedHorseName,
    }));

    const result = buildHorseCacheParity({
      currentOfferingId: offering.id,
      asOf,
      enrollments,
      horseAssignments,
      students,
    });

    console.log("\n--- Parity summary (READ-ONLY, PII-free) ---");
    console.log(formatHorseCacheParitySummary(result));
    if (result.anomalies.length > 0) {
      console.log("\n--- Anomalies (reported, safe ids only) ---");
      for (const line of formatHorseCacheParityAnomalies(result)) console.log(`  - ${line}`);
    }
    console.log("\n--- End diagnostic (no writes performed) ---");
  } catch (error) {
    console.error("Horse-cache parity diagnostic failed.");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
