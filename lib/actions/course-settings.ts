"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseDateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";

const settingsSchema = z
  .object({
    startDate: z.string().min(1, "יש לבחור תאריך התחלה"),
    endDate: z.string().min(1, "יש לבחור תאריך סיום"),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "תאריך הסיום חייב להיות אחרי תאריך ההתחלה",
    path: ["endDate"],
  });

export async function updateCourseSettings(formData: FormData): Promise<ActionResult> {
  // ADMIN-WRITE-A1: admin authorization is the FIRST operation - before any
  // validation, read or write - so a non-admin caller of this "use server"
  // endpoint can neither mutate the course window nor learn anything from the
  // validation errors.
  await requireAdmin();

  const parsed = settingsSchema.safeParse({
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  await prisma.courseSettings.upsert({
    where: { id: 1 },
    update: {
      startDate: parseDateKey(parsed.data.startDate),
      endDate: parseDateKey(parsed.data.endDate),
    },
    create: {
      id: 1,
      startDate: parseDateKey(parsed.data.startDate),
      endDate: parseDateKey(parsed.data.endDate),
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/availability");
  revalidatePath("/admin/schedule");
  return { success: true };
}
