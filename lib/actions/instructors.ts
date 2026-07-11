"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { ActionResult } from "@/lib/actions/students";

const instructorSchema = z.object({
  firstName: z.string().trim().min(1, "יש להזין שם פרטי"),
  lastName: z.string().trim().min(1, "יש להזין שם משפחה"),
  identityNumber: z
    .string()
    .trim()
    .regex(/^\d{5,9}$/, "מספר תעודת זהות לא תקין"),
  phone: z.string().trim().optional(),
});

function fullNameOf(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

export async function createInstructor(formData: FormData): Promise<ActionResult> {
  const parsed = instructorSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    identityNumber: formData.get("identityNumber"),
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  const existing = await prisma.instructor.findUnique({
    where: { identityNumber: parsed.data.identityNumber },
  });
  if (existing) {
    return { success: false, error: "כבר קיים/ת מדריך/ה עם מספר תעודת זהות זה" };
  }

  await prisma.instructor.create({
    data: {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      fullName: fullNameOf(parsed.data.firstName, parsed.data.lastName),
      identityNumber: parsed.data.identityNumber,
      phone: parsed.data.phone || null,
    },
  });

  revalidatePath("/admin/instructors");
  return { success: true };
}

export async function updateInstructor(
  instructorId: string,
  formData: FormData
): Promise<ActionResult> {
  const parsed = instructorSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    identityNumber: formData.get("identityNumber"),
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  const conflict = await prisma.instructor.findUnique({
    where: { identityNumber: parsed.data.identityNumber },
  });
  if (conflict && conflict.id !== instructorId) {
    return { success: false, error: "כבר קיים/ת מדריך/ה עם מספר תעודת זהות זה" };
  }

  await prisma.instructor.update({
    where: { id: instructorId },
    data: {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      fullName: fullNameOf(parsed.data.firstName, parsed.data.lastName),
      identityNumber: parsed.data.identityNumber,
      phone: parsed.data.phone || null,
    },
  });

  revalidatePath("/admin/instructors");
  return { success: true };
}

export async function setInstructorActive(
  instructorId: string,
  isActive: boolean
): Promise<ActionResult> {
  await prisma.instructor.update({ where: { id: instructorId }, data: { isActive } });
  revalidatePath("/admin/instructors");
  return { success: true };
}

export async function setInstructorCanEditHorseAssignments(
  instructorId: string,
  canEditHorseAssignments: boolean
): Promise<ActionResult> {
  await requireAdmin();
  await prisma.instructor.update({
    where: { id: instructorId },
    data: { canEditHorseAssignments },
  });
  revalidatePath("/admin/instructors");
  return { success: true };
}

export async function setInstructorCanSendMessages(
  instructorId: string,
  canSendMessages: boolean
): Promise<ActionResult> {
  await requireAdmin();
  await prisma.instructor.update({
    where: { id: instructorId },
    data: { canSendMessages },
  });
  revalidatePath("/admin/instructors");
  return { success: true };
}

export async function setInstructorCanEditAttendance(
  instructorId: string,
  canEditAttendance: boolean
): Promise<ActionResult> {
  await requireAdmin();
  await prisma.instructor.update({
    where: { id: instructorId },
    data: { canEditAttendance },
  });
  revalidatePath("/admin/instructors");
  revalidatePath("/instructor");
  return { success: true };
}

export async function setInstructorCanEditRidingNotes(
  instructorId: string,
  canEditRidingNotes: boolean
): Promise<ActionResult> {
  await requireAdmin();
  await prisma.instructor.update({
    where: { id: instructorId },
    data: { canEditRidingNotes },
  });
  revalidatePath("/admin/instructors");
  revalidatePath("/instructor");
  return { success: true };
}

export async function setInstructorCanEditHorseFeeding(
  instructorId: string,
  canEditHorseFeeding: boolean
): Promise<ActionResult> {
  await requireAdmin();
  await prisma.instructor.update({
    where: { id: instructorId },
    data: { canEditHorseFeeding },
  });
  revalidatePath("/admin/instructors");
  revalidatePath("/instructor");
  return { success: true };
}

export async function setInstructorCanManageTeachingPracticeAssignments(
  instructorId: string,
  canManageTeachingPracticeAssignments: boolean
): Promise<ActionResult> {
  await requireAdmin();
  await prisma.instructor.update({
    where: { id: instructorId },
    data: { canManageTeachingPracticeAssignments },
  });
  revalidatePath("/admin/instructors");
  revalidatePath("/instructor");
  return { success: true };
}

export async function setInstructorCanManageTeachingPracticeHorses(
  instructorId: string,
  canManageTeachingPracticeHorses: boolean
): Promise<ActionResult> {
  await requireAdmin();
  await prisma.instructor.update({
    where: { id: instructorId },
    data: { canManageTeachingPracticeHorses },
  });
  revalidatePath("/admin/instructors");
  revalidatePath("/instructor");
  return { success: true };
}

export async function setInstructorCanEditTeachingPracticeFeedback(
  instructorId: string,
  canEditTeachingPracticeFeedback: boolean
): Promise<ActionResult> {
  await requireAdmin();
  await prisma.instructor.update({
    where: { id: instructorId },
    data: { canEditTeachingPracticeFeedback },
  });
  revalidatePath("/admin/instructors");
  revalidatePath("/instructor");
  return { success: true };
}

export async function setInstructorCanManageChildSignatures(
  instructorId: string,
  canManageChildSignatures: boolean
): Promise<ActionResult> {
  await requireAdmin();
  await prisma.instructor.update({
    where: { id: instructorId },
    data: { canManageChildSignatures },
  });
  revalidatePath("/admin/instructors");
  revalidatePath("/instructor");
  return { success: true };
}
