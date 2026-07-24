"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { ActionResult } from "@/lib/actions/students";

const dutyTypeSchema = z.object({
  name: z.string().trim().min(2, "יש להזין שם תורנות"),
  description: z.string().trim().optional(),
  defaultRequiredCount: z.coerce.number().int().min(1, "מספר החניכים חייב להיות לפחות 1"),
  allocationMode: z.enum(["FIXED_COUNT", "ONE_PER_SUBGROUP"]).default("FIXED_COUNT"),
});

export async function createDutyType(formData: FormData): Promise<ActionResult> {
  // ADMIN-WRITE-A2: admin authorization is the FIRST operation - before any
  // validation, read or write - so a non-admin caller of this "use server"
  // endpoint can neither create a duty type nor learn anything from the
  // validation errors.
  await requireAdmin();

  const parsed = dutyTypeSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    defaultRequiredCount: formData.get("defaultRequiredCount"),
    allocationMode: formData.get("allocationMode") || undefined,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  await prisma.dutyType.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
      defaultRequiredCount: parsed.data.defaultRequiredCount,
      allocationMode: parsed.data.allocationMode,
    },
  });

  revalidatePath("/admin/duties");
  revalidatePath("/admin");
  return { success: true };
}

export async function updateDutyType(
  dutyTypeId: string,
  formData: FormData
): Promise<ActionResult> {
  // ADMIN-WRITE-A2: authorization precedes validation and the update, so an
  // unauthorized caller cannot mutate a duty type nor probe whether dutyTypeId
  // exists (the Prisma update is the only thing that would reveal that).
  await requireAdmin();

  const parsed = dutyTypeSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    defaultRequiredCount: formData.get("defaultRequiredCount"),
    allocationMode: formData.get("allocationMode") || undefined,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  await prisma.dutyType.update({
    where: { id: dutyTypeId },
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
      defaultRequiredCount: parsed.data.defaultRequiredCount,
      allocationMode: parsed.data.allocationMode,
    },
  });

  revalidatePath("/admin/duties");
  return { success: true };
}

export async function setDutyTypeActive(
  dutyTypeId: string,
  isActive: boolean
): Promise<ActionResult> {
  // ADMIN-WRITE-A2: deactivation is authorized before the update that would
  // otherwise disclose whether dutyTypeId exists.
  await requireAdmin();

  await prisma.dutyType.update({ where: { id: dutyTypeId }, data: { isActive } });
  revalidatePath("/admin/duties");
  revalidatePath("/admin");
  return { success: true };
}
