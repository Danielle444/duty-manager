"use server";

import { prisma } from "@/lib/prisma";

export interface StudentContactRow {
  id: string;
  fullName: string;
  lastName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  phone: string | null;
}

// Read-only, no permission gate - same convention as getHorseAssignments,
// since instructors have no NextAuth session in this app. View-only by
// design: there is no corresponding write action for instructors here.
export async function getStudentContacts(): Promise<StudentContactRow[]> {
  const students = await prisma.student.findMany({
    where: { isActive: true },
    orderBy: [{ groupName: "asc" }, { subgroupNumber: "asc" }, { lastName: "asc" }],
    select: {
      id: true,
      fullName: true,
      lastName: true,
      groupName: true,
      subgroupNumber: true,
      phone: true,
    },
  });
  return students;
}

export interface InstructorContactRow {
  id: string;
  fullName: string;
  phone: string | null;
}

// Read-only, no permission gate - same convention as getStudentContacts,
// since students have no NextAuth session in this app either. View-only by
// design: students have no way to edit instructor phone numbers.
export async function getInstructorContacts(): Promise<InstructorContactRow[]> {
  const instructors = await prisma.instructor.findMany({
    where: { isActive: true },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, phone: true },
  });
  return instructors;
}
