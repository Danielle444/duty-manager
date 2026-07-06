"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseDateKey, todayDateKey } from "@/lib/dates";
import { getHorseDisplayInfo } from "@/lib/horse-info";
import type { ActionResult } from "@/lib/actions/students";
import type { AttendanceStatusValue } from "@/lib/actions/attendance";

// Still no separate Horse table (see HorseFeedingMeal's own schema comment) -
// horseName is the natural key everywhere here too, matched against whatever
// name string a student currently has via getHorseDisplayInfo.

export interface HorseFeedingMealView {
  hayType: string | null;
  concentrateType: string | null;
  concentrateAmount: string | null;
  notes: string | null;
}

export interface HorseFeedingOverviewRow {
  horseName: string;
  morning: HorseFeedingMealView | null;
  evening: HorseFeedingMealView | null;
  // Null means "no lunch for this horse" - distinct from a lunch row that
  // exists but happens to have every field empty.
  lunch: HorseFeedingMealView | null;
  updatedByName: string | null;
  updatedAt: string | null;
  // The one active student currently matched to this horse name, if any -
  // read-only, resolved the same way getHorseDisplayInfo already does
  // everywhere else. If a horse name is ever shared by more than one active
  // student, only the first match is shown here (not expected in current
  // data - every assignedHorseName is unique today).
  responsibleStudent: {
    id: string;
    fullName: string;
    groupName: string | null;
    subgroupNumber: number | null;
  } | null;
  // Today's attendance for that student, if matched - never written from
  // this screen, and never used to infer anything about feeding itself.
  attendanceStatus: AttendanceStatusValue | null;
  attendanceArrivalTime: string | null;
  attendanceDepartureTime: string | null;
  attendanceNotes: string | null;
}

function toMealView(meal: {
  hayType: string | null;
  concentrateType: string | null;
  concentrateAmount: string | null;
  notes: string | null;
} | null): HorseFeedingMealView | null {
  if (!meal) return null;
  return {
    hayType: meal.hayType,
    concentrateType: meal.concentrateType,
    concentrateAmount: meal.concentrateAmount,
    notes: meal.notes,
  };
}

// Shared by the admin and instructor read actions - view is unrestricted for
// both (matches the same "any instructor can view" convention already used
// by horse assignments, riding slots, etc.); only writing is gated.
async function buildHorseFeedingOverview(): Promise<HorseFeedingOverviewRow[]> {
  const [students, meals] = await Promise.all([
    prisma.student.findMany({
      where: { isActive: true },
      select: {
        id: true,
        fullName: true,
        groupName: true,
        subgroupNumber: true,
        hasPrivateHorse: true,
        privateHorseName: true,
        assignedHorseName: true,
      },
    }),
    prisma.horseFeedingMeal.findMany(),
  ]);

  const studentByHorseName = new Map<string, (typeof students)[number]>();
  for (const s of students) {
    const name = getHorseDisplayInfo(s).horseName;
    if (!name) continue;
    if (!studentByHorseName.has(name)) studentByHorseName.set(name, s);
  }

  const mealsByHorseName = new Map<string, typeof meals>();
  for (const m of meals) {
    if (!mealsByHorseName.has(m.horseName)) mealsByHorseName.set(m.horseName, []);
    mealsByHorseName.get(m.horseName)!.push(m);
  }

  // Union of "horses currently claimed by an active student" and "horses
  // with feeding data already entered" - a horse's feeding instructions
  // never disappear just because no student currently claims that name.
  const allHorseNames = new Set<string>([...studentByHorseName.keys(), ...mealsByHorseName.keys()]);

  const linkedStudentIds = Array.from(studentByHorseName.values()).map((s) => s.id);
  const attendanceRecords =
    linkedStudentIds.length > 0
      ? await prisma.studentAttendance.findMany({
          where: { date: parseDateKey(todayDateKey()), studentId: { in: linkedStudentIds } },
        })
      : [];
  const attendanceByStudentId = new Map(attendanceRecords.map((a) => [a.studentId, a]));

  const rows: HorseFeedingOverviewRow[] = [];
  for (const horseName of allHorseNames) {
    const mealsForHorse = mealsByHorseName.get(horseName) ?? [];
    const morning = mealsForHorse.find((m) => m.mealType === "MORNING") ?? null;
    const evening = mealsForHorse.find((m) => m.mealType === "EVENING") ?? null;
    const lunch = mealsForHorse.find((m) => m.mealType === "LUNCH") ?? null;

    const latestUpdated = mealsForHorse.reduce<(typeof mealsForHorse)[number] | null>(
      (latest, m) => (!latest || m.updatedAt > latest.updatedAt ? m : latest),
      null
    );

    const student = studentByHorseName.get(horseName) ?? null;
    const attendance = student ? attendanceByStudentId.get(student.id) : undefined;

    rows.push({
      horseName,
      morning: toMealView(morning),
      evening: toMealView(evening),
      lunch: toMealView(lunch),
      updatedByName: latestUpdated?.updatedByName ?? null,
      updatedAt: latestUpdated ? latestUpdated.updatedAt.toISOString() : null,
      responsibleStudent: student
        ? {
            id: student.id,
            fullName: student.fullName,
            groupName: student.groupName,
            subgroupNumber: student.subgroupNumber,
          }
        : null,
      attendanceStatus: attendance?.status ?? null,
      attendanceArrivalTime: attendance?.arrivalTime ?? null,
      attendanceDepartureTime: attendance?.departureTime ?? null,
      attendanceNotes: attendance?.notes ?? null,
    });
  }

  rows.sort((a, b) => a.horseName.localeCompare(b.horseName, "he"));
  return rows;
}

export async function getHorseFeedingOverviewForAdmin(): Promise<HorseFeedingOverviewRow[]> {
  await requireAdmin();
  return buildHorseFeedingOverview();
}

export async function getHorseFeedingOverviewForInstructor(): Promise<HorseFeedingOverviewRow[]> {
  return buildHorseFeedingOverview();
}

// Suggestions for the hay-type/concentrate-type inputs - never a closed
// list, just whatever has actually been typed and saved before. The
// admin/instructor form always still accepts free text beyond these.
export async function getKnownHayTypes(): Promise<string[]> {
  const rows = await prisma.horseFeedingMeal.findMany({
    where: { hayType: { not: null } },
    select: { hayType: true },
    distinct: ["hayType"],
  });
  return rows
    .map((r) => r.hayType!)
    .filter((v) => v.trim().length > 0)
    .sort((a, b) => a.localeCompare(b, "he"));
}

export async function getKnownConcentrateTypes(): Promise<string[]> {
  const rows = await prisma.horseFeedingMeal.findMany({
    where: { concentrateType: { not: null } },
    select: { concentrateType: true },
    distinct: ["concentrateType"],
  });
  return rows
    .map((r) => r.concentrateType!)
    .filter((v) => v.trim().length > 0)
    .sort((a, b) => a.localeCompare(b, "he"));
}

// Same idea as getKnownHayTypes/getKnownConcentrateTypes - concentrateAmount
// stays free text (never numeric), so this is just distinct previously-saved
// values for suggestions, never a closed list.
export async function getKnownConcentrateAmounts(): Promise<string[]> {
  const rows = await prisma.horseFeedingMeal.findMany({
    where: { concentrateAmount: { not: null } },
    select: { concentrateAmount: true },
    distinct: ["concentrateAmount"],
  });
  return rows
    .map((r) => r.concentrateAmount!)
    .filter((v) => v.trim().length > 0)
    .sort((a, b) => a.localeCompare(b, "he"));
}

const mealFieldsSchema = z.object({
  hayType: z.string().trim().optional(),
  concentrateType: z.string().trim().optional(),
  concentrateAmount: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const feedingUpsertSchema = z.object({
  horseName: z.string().trim().min(1, "יש להזין שם סוס"),
  morning: mealFieldsSchema,
  evening: mealFieldsSchema,
  hasLunch: z.boolean(),
  lunch: mealFieldsSchema,
});

export type HorseFeedingUpsertInput = z.infer<typeof feedingUpsertSchema>;

function upsertMealQuery(
  horseName: string,
  mealType: "MORNING" | "LUNCH" | "EVENING",
  fields: z.infer<typeof mealFieldsSchema>,
  updatedByName: string | null
) {
  const data = {
    hayType: fields.hayType?.trim() || null,
    concentrateType: fields.concentrateType?.trim() || null,
    concentrateAmount: fields.concentrateAmount?.trim() || null,
    notes: fields.notes?.trim() || null,
    updatedByName,
  };
  return prisma.horseFeedingMeal.upsert({
    where: { horseName_mealType: { horseName, mealType } },
    create: { horseName, mealType, ...data },
    update: data,
  });
}

// Shared core - MORNING/EVENING always exist per spec ("at minimum
// morning/evening"); LUNCH is created/updated only when hasLunch is true,
// and deleted otherwise, so "no lunch" is represented by the row's absence,
// not by a row with every field blank.
async function upsertHorseFeedingMeals(
  input: HorseFeedingUpsertInput,
  updatedByName: string | null
): Promise<ActionResult> {
  const parsed = feedingUpsertSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }
  const horseName = parsed.data.horseName;

  const ops: Prisma.PrismaPromise<unknown>[] = [
    upsertMealQuery(horseName, "MORNING", parsed.data.morning, updatedByName),
    upsertMealQuery(horseName, "EVENING", parsed.data.evening, updatedByName),
  ];
  if (parsed.data.hasLunch) {
    ops.push(upsertMealQuery(horseName, "LUNCH", parsed.data.lunch, updatedByName));
  } else {
    ops.push(prisma.horseFeedingMeal.deleteMany({ where: { horseName, mealType: "LUNCH" } }));
  }
  await prisma.$transaction(ops);

  revalidatePath("/admin/horses");
  return { success: true };
}

export async function upsertHorseFeedingMealsAsAdmin(
  input: HorseFeedingUpsertInput
): Promise<ActionResult> {
  const admin = await requireAdmin();
  return upsertHorseFeedingMeals(input, admin.name ?? admin.email);
}

// Instructors have no NextAuth session in this app, so the permission check
// re-reads canEditHorseFeeding from the DB by instructorId on every call -
// it never trusts a client-supplied boolean. This is the only gate; UI
// hiding of edit controls is not relied upon.
export async function upsertHorseFeedingMealsAsInstructor(
  instructorId: string,
  input: HorseFeedingUpsertInput
): Promise<ActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditHorseFeeding) {
    return { success: false, error: "אין הרשאה לערוך האכלות" };
  }
  return upsertHorseFeedingMeals(input, instructor.fullName);
}
