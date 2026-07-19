"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { resolveCurrentCourseOffering } from "@/lib/course/current-offering";
import {
  createTraineeWithEnrollmentSafe,
  runTraineeCreateInTx,
} from "@/lib/course/create-trainee-enrollment-core";

// Single safe, generic message for ANY known current-offering structural
// failure (no offering / ambiguous / incomplete). Deliberately reveals no
// offering count, id, dates, class name, or Prisma detail - the manager is told
// only that trainee creation is unavailable and to contact system management.
const CURRENT_OFFERING_UNAVAILABLE_MESSAGE =
  "לא ניתן להוסיף חניך/ה כעת עקב בעיה בהגדרת הקורס הנוכחי. יש לפנות לניהול המערכת";

const studentSchema = z.object({
  firstName: z.string().trim().min(1, "יש להזין שם פרטי"),
  lastName: z.string().trim().min(1, "יש להזין שם משפחה"),
  identityNumber: z
    .string()
    .trim()
    .regex(/^\d{5,9}$/, "מספר תעודת זהות לא תקין"),
  groupName: z.string().trim().optional(),
  subgroupNumber: z.coerce.number().int().positive().optional(),
  phone: z.string().trim().optional(),
});

export interface ActionResult {
  success: boolean;
  error?: string;
}

function fullNameOf(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

export async function createStudent(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = studentSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    identityNumber: formData.get("identityNumber"),
    groupName: formData.get("groupName") || undefined,
    subgroupNumber: formData.get("subgroupNumber") || undefined,
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  // MULTI-COURSE W6B: a new trainee is created atomically as Student + ACTIVE
  // isPrimary CourseEnrollment in the SERVER-DERIVED current offering + initial
  // subgroup GroupMembership, with the Student compatibility fields kept in
  // sync. The offering is never client-supplied; the testable orchestration and
  // the transaction body live in the non-"use server" core module. All group/
  // offering/duplicate failures return before any write (all-or-nothing).
  const result = await createTraineeWithEnrollmentSafe(
    {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      identityNumber: parsed.data.identityNumber,
      phone: parsed.data.phone ?? null,
      groupName: parsed.data.groupName ?? null,
      subgroupNumber: parsed.data.subgroupNumber ?? null,
    },
    {
      resolveCurrentCourseOffering: async () => {
        const offering = await resolveCurrentCourseOffering();
        return { id: offering.id, startDate: offering.startDate };
      },
      now: () => new Date(),
      identityNumberExists: async (identityNumber) =>
        (await prisma.student.findUnique({
          where: { identityNumber },
          select: { id: true },
        })) !== null,
      findTopGroupId: async (courseOfferingId, name) =>
        (
          await prisma.courseGroup.findFirst({
            where: { courseOfferingId, parentGroupId: null, name },
            select: { id: true },
          })
        )?.id ?? null,
      findSubGroupId: async (parentGroupId, name) =>
        (
          await prisma.courseGroup.findFirst({
            where: { parentGroupId, name },
            select: { id: true },
          })
        )?.id ?? null,
      createAtomically: (plan) =>
        prisma.$transaction((tx) => runTraineeCreateInTx(tx, plan)),
    },
    CURRENT_OFFERING_UNAVAILABLE_MESSAGE,
  );

  if (!result.success) {
    return result;
  }

  revalidatePath("/admin/students");
  revalidatePath("/admin");
  return { success: true };
}

export async function updateStudent(
  studentId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = studentSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    identityNumber: formData.get("identityNumber"),
    groupName: formData.get("groupName") || undefined,
    subgroupNumber: formData.get("subgroupNumber") || undefined,
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  const conflict = await prisma.student.findUnique({
    where: { identityNumber: parsed.data.identityNumber },
  });
  if (conflict && conflict.id !== studentId) {
    return { success: false, error: "כבר קיים/ת חניך/ה עם מספר תעודת זהות זה" };
  }

  await prisma.student.update({
    where: { id: studentId },
    data: {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      fullName: fullNameOf(parsed.data.firstName, parsed.data.lastName),
      identityNumber: parsed.data.identityNumber,
      groupName: parsed.data.groupName || null,
      subgroupNumber: parsed.data.subgroupNumber ?? null,
      phone: parsed.data.phone || null,
    },
  });

  revalidatePath("/admin/students");
  return { success: true };
}

export async function setStudentActive(
  studentId: string,
  isActive: boolean
): Promise<ActionResult> {
  await requireAdmin();
  await prisma.student.update({ where: { id: studentId }, data: { isActive } });
  revalidatePath("/admin/students");
  revalidatePath("/admin");
  return { success: true };
}
