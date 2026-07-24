"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseDateKey } from "@/lib/dates";
import { applyDateRangeAvailability } from "@/lib/availability-helpers";
import type { ActionResult } from "@/lib/actions/students";

const presetSchema = z
  .object({
    name: z.string().trim().min(1, "יש להזין שם לפריסט"),
    startDate: z.string().min(1, "יש לבחור תאריך התחלה"),
    endDate: z.string().min(1, "יש לבחור תאריך סיום"),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "תאריך הסיום חייב להיות אחרי תאריך ההתחלה",
    path: ["endDate"],
  });

export async function createAvailabilityPreset(formData: FormData): Promise<ActionResult> {
  // ADMIN-WRITE-A1: authorize before any validation or write.
  await requireAdmin();

  const parsed = presetSchema.safeParse({
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  await prisma.availabilityRangePreset.create({
    data: {
      name: parsed.data.name,
      startDate: parseDateKey(parsed.data.startDate),
      endDate: parseDateKey(parsed.data.endDate),
    },
  });

  revalidatePath("/admin/availability");
  return { success: true };
}

export async function deleteAvailabilityPreset(presetId: string): Promise<ActionResult> {
  // ADMIN-WRITE-A1: authorize before the delete, so an unauthorized caller can
  // neither destroy a preset nor probe preset ids through the delete's outcome.
  await requireAdmin();

  await prisma.availabilityRangePreset.delete({ where: { id: presetId } });
  revalidatePath("/admin/availability");
  return { success: true };
}

export async function applyPresetToStudents(
  presetId: string,
  studentIds: string[]
): Promise<ActionResult> {
  // ADMIN-WRITE-A1: authorize before reading CourseSettings, before reading the
  // preset (whose existence the error message would otherwise reveal), and
  // before any availability write for the supplied student ids.
  await requireAdmin();

  const [preset, settings] = await Promise.all([
    prisma.availabilityRangePreset.findUnique({ where: { id: presetId } }),
    prisma.courseSettings.findUnique({ where: { id: 1 } }),
  ]);
  if (!preset) return { success: false, error: "הפריסט לא נמצא" };
  if (!settings) return { success: false, error: "יש להגדיר תחילה את תאריכי הקורס" };

  await applyDateRangeAvailability(
    studentIds,
    settings.startDate,
    settings.endDate,
    preset.startDate,
    preset.endDate
  );

  revalidatePath("/admin/availability");
  revalidatePath("/admin/students");
  return { success: true };
}
