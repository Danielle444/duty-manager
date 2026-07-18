/**
 * COURSE-DATA GH1B - backfill script for effective-dated trainee history.
 *
 * Prepares exactly one TraineeGroupMembership row and exactly one
 * TraineeHorseAssignment row per Student, using the current (compatibility)
 * Student columns as the value snapshot, with effectiveFrom = the supplied
 * cutover date and effectiveTo = null. It NEVER updates or deletes Student
 * rows and NEVER invents pre-cutover history (GRP-6 / TUX-7).
 *
 * SAFETY MODEL:
 *  - Requires an explicit --cutover=YYYY-MM-DD (no env-var cutover, no
 *    interactive prompt, no implicit "today"/UTC default).
 *  - Default mode is DRY-RUN (performs no writes).
 *  - --apply performs all inserts inside ONE Prisma transaction; any error
 *    rolls the whole transaction back (no partial commit) and exits non-zero.
 *  - Idempotent: for each Student it checks existence by
 *    (studentId, effectiveFrom) and inserts only when no row exists.
 *  - IDs are omitted so @default(cuid()) generates them (no createMany, no
 *    added cuid/uuid dependency).
 *
 * Usage:
 *   npx tsx scripts/backfill-trainee-history.ts --cutover=YYYY-MM-DD
 *   npx tsx scripts/backfill-trainee-history.ts --cutover=YYYY-MM-DD --apply
 */
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { isValidDateKey } from "../lib/trainee-history/interval-resolver";

const USAGE =
  "Usage: tsx scripts/backfill-trainee-history.ts --cutover=YYYY-MM-DD [--apply]";

interface ParsedArgs {
  cutover: string | null;
  apply: boolean;
  unknown: string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const CUTOVER_PREFIX = "--cutover=";
  let cutover: string | null = null;
  let apply = false;
  const unknown: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith(CUTOVER_PREFIX)) {
      cutover = arg.slice(CUTOVER_PREFIX.length);
    } else if (arg === "--apply") {
      apply = true;
    } else {
      unknown.push(arg);
    }
  }
  return { cutover, apply, unknown };
}

async function main(): Promise<void> {
  const { cutover, apply, unknown } = parseArgs(process.argv.slice(2));

  if (unknown.length > 0) {
    console.error(`Unrecognized argument(s): ${unknown.join(", ")}`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (cutover === null) {
    console.error("Missing required --cutover=YYYY-MM-DD");
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (!isValidDateKey(cutover)) {
    console.error(
      `Invalid --cutover value: ${JSON.stringify(cutover)} (expected a real YYYY-MM-DD date)`,
    );
    process.exitCode = 1;
    return;
  }

  const mode = apply ? "APPLY (writes enabled)" : "DRY-RUN (no writes)";
  console.log(`Cutover date: ${cutover}`);
  console.log(`Execution mode: ${mode}`);

  // Date-only column (@db.Date): construct at UTC midnight from the explicit
  // cutover key so no local-timezone shift can move the calendar date.
  const cutoverDate = new Date(`${cutover}T00:00:00.000Z`);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    // Load ALL students, including inactive trainees (no isActive filter).
    const students = await prisma.student.findMany({
      select: {
        id: true,
        groupName: true,
        subgroupNumber: true,
        assignedHorseName: true,
        hasPrivateHorse: true,
        privateHorseName: true,
      },
    });
    console.log(`Total students loaded (including inactive): ${students.length}`);

    if (!apply) {
      let groupToInsert = 0;
      let groupSkipped = 0;
      let horseToInsert = 0;
      let horseSkipped = 0;
      for (const student of students) {
        const existingGroup = await prisma.traineeGroupMembership.findUnique({
          where: {
            studentId_effectiveFrom: { studentId: student.id, effectiveFrom: cutoverDate },
          },
          select: { id: true },
        });
        if (existingGroup) {
          groupSkipped++;
        } else {
          groupToInsert++;
        }

        const existingHorse = await prisma.traineeHorseAssignment.findUnique({
          where: {
            studentId_effectiveFrom: { studentId: student.id, effectiveFrom: cutoverDate },
          },
          select: { id: true },
        });
        if (existingHorse) {
          horseSkipped++;
        } else {
          horseToInsert++;
        }
      }
      console.log("DRY-RUN summary (no writes performed):");
      console.log(`  Group memberships that would be inserted: ${groupToInsert}`);
      console.log(`  Group memberships skipped (already exist): ${groupSkipped}`);
      console.log(`  Horse assignments that would be inserted: ${horseToInsert}`);
      console.log(`  Horse assignments skipped (already exist): ${horseSkipped}`);
      return;
    }

    let groupInserted = 0;
    let groupSkipped = 0;
    let horseInserted = 0;
    let horseSkipped = 0;
    await prisma.$transaction(
      async (tx) => {
        for (const student of students) {
          const existingGroup = await tx.traineeGroupMembership.findUnique({
            where: {
              studentId_effectiveFrom: { studentId: student.id, effectiveFrom: cutoverDate },
            },
            select: { id: true },
          });
          if (existingGroup) {
            groupSkipped++;
          } else {
            await tx.traineeGroupMembership.create({
              data: {
                studentId: student.id,
                groupName: student.groupName,
                subgroupNumber: student.subgroupNumber,
                effectiveFrom: cutoverDate,
                effectiveTo: null,
              },
            });
            groupInserted++;
          }

          const existingHorse = await tx.traineeHorseAssignment.findUnique({
            where: {
              studentId_effectiveFrom: { studentId: student.id, effectiveFrom: cutoverDate },
            },
            select: { id: true },
          });
          if (existingHorse) {
            horseSkipped++;
          } else {
            await tx.traineeHorseAssignment.create({
              data: {
                studentId: student.id,
                assignedHorseName: student.assignedHorseName,
                hasPrivateHorse: student.hasPrivateHorse,
                privateHorseName: student.privateHorseName,
                effectiveFrom: cutoverDate,
                effectiveTo: null,
              },
            });
            horseInserted++;
          }
        }
      },
      { timeout: 60000 },
    );

    console.log("APPLY summary (committed in a single transaction):");
    console.log(`  Group memberships inserted: ${groupInserted}`);
    console.log(`  Group memberships skipped (already exist): ${groupSkipped}`);
    console.log(`  Horse assignments inserted: ${horseInserted}`);
    console.log(`  Horse assignments skipped (already exist): ${horseSkipped}`);
  } catch (error) {
    console.error("Backfill failed; transaction rolled back, no partial commit was made.");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
