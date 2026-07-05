"use server";

import { prisma } from "@/lib/prisma";

export interface InstructorSearchResult {
  id: string;
  fullName: string;
}

export async function searchInstructors(query: string): Promise<InstructorSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const instructors = await prisma.instructor.findMany({
    where: { isActive: true, fullName: { contains: trimmed, mode: "insensitive" } },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
    take: 8,
  });
  return instructors;
}

export interface InstructorProfile {
  id: string;
  fullName: string;
  canEditHorseAssignments: boolean;
}

export interface InstructorLoginResult {
  success: boolean;
  error?: string;
  instructor?: InstructorProfile;
}

export async function verifyInstructorLogin(
  instructorId: string,
  identityNumber: string
): Promise<InstructorLoginResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });

  if (
    !instructor ||
    !instructor.isActive ||
    instructor.identityNumber !== identityNumber.trim()
  ) {
    return { success: false, error: "מספר תעודת זהות שגוי" };
  }

  return {
    success: true,
    instructor: {
      id: instructor.id,
      fullName: instructor.fullName,
      canEditHorseAssignments: instructor.canEditHorseAssignments,
    },
  };
}

// Refreshes the remembered session's profile fields from the DB - mirrors
// getStudentProfile in lib/actions/auth.ts. A long-lived "remember me"
// session must not keep trusting a stale/absent canEditHorseAssignments
// value once an admin changes it.
export async function getInstructorProfile(
  instructorId: string
): Promise<InstructorProfile | null> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive) return null;
  return {
    id: instructor.id,
    fullName: instructor.fullName,
    canEditHorseAssignments: instructor.canEditHorseAssignments,
  };
}
