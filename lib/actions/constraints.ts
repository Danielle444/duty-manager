"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { ActionResult } from "@/lib/actions/students";

const constraintSchema = z.object({
  dutyTypeId: z.string().min(1, "יש לבחור סוג תורנות"),
  slot: z.enum([
    "FIRST_MORNING",
    "SECOND_MORNING",
    "FIRST_AFTER_LUNCH",
    "SECOND_AFTER_LUNCH",
  ]),
  note: z.string().trim().optional(),
});

export async function createDutyConstraint(formData: FormData): Promise<ActionResult> {
  // ADMIN-WRITE-A2: admin authorization is the FIRST operation - before any
  // validation, read or write - so a non-admin caller of this "use server"
  // endpoint can neither create a constraint nor learn anything from the
  // validation errors.
  await requireAdmin();

  const parsed = constraintSchema.safeParse({
    dutyTypeId: formData.get("dutyTypeId"),
    slot: formData.get("slot"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  await prisma.dutyConstraint.create({
    data: {
      dutyTypeId: parsed.data.dutyTypeId,
      slot: parsed.data.slot,
      note: parsed.data.note || null,
    },
  });

  revalidatePath("/admin/duties");
  return { success: true };
}

export async function setDutyConstraintActive(
  constraintId: string,
  isActive: boolean
): Promise<ActionResult> {
  // ADMIN-WRITE-A2: deactivation is authorized before the update that would
  // otherwise disclose whether constraintId exists.
  await requireAdmin();

  await prisma.dutyConstraint.update({
    where: { id: constraintId },
    data: { isActive },
  });
  revalidatePath("/admin/duties");
  return { success: true };
}

export async function deleteDutyConstraint(constraintId: string): Promise<ActionResult> {
  // ADMIN-WRITE-A2: authorization precedes the delete, which is also the only
  // lookup here - so an unauthorized caller can neither remove a constraint nor
  // probe whether constraintId exists.
  await requireAdmin();

  await prisma.dutyConstraint.delete({ where: { id: constraintId } });
  revalidatePath("/admin/duties");
  return { success: true };
}
