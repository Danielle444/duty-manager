"use server";

import { prisma } from "@/lib/prisma";
import { issueSessionCookie, clearSessionCookie } from "@/lib/auth/session";

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
  canSendMessages: boolean;
  canEditAttendance: boolean;
  canEditRidingNotes: boolean;
  canEditHorseFeeding: boolean;
  canManageTeachingPracticeAssignments: boolean;
  canManageTeachingPracticeHorses: boolean;
  canEditTeachingPracticeFeedback: boolean;
  canManageChildSignatures: boolean;
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
    // Failed verification: clear only the instructor session cookie (never the
    // trainee cookie). Additive/non-authoritative - this mints nothing and
    // introduces no client-identity trust.
    await clearSessionCookie("instructor");
    return { success: false, error: "מספר תעודת זהות שגוי" };
  }

  // Verified existing + active + identity-number match. Mint the signed
  // httpOnly instructor session cookie keyed on the SERVER-FETCHED instructor.id
  // (never the raw client instructorId). This is deliberately NOT swallowed: a
  // missing/weak SESSION_SECRET propagates and prevents the success result. The
  // cookie is non-authoritative in this stage (no action consumes it yet).
  await issueSessionCookie({
    audience: "instructor",
    subject: instructor.id,
  });

  return {
    success: true,
    instructor: {
      id: instructor.id,
      fullName: instructor.fullName,
      canEditHorseAssignments: instructor.canEditHorseAssignments,
      canSendMessages: instructor.canSendMessages,
      canEditAttendance: instructor.canEditAttendance,
      canEditRidingNotes: instructor.canEditRidingNotes,
      canEditHorseFeeding: instructor.canEditHorseFeeding,
      canManageTeachingPracticeAssignments: instructor.canManageTeachingPracticeAssignments,
      canManageTeachingPracticeHorses: instructor.canManageTeachingPracticeHorses,
      canEditTeachingPracticeFeedback: instructor.canEditTeachingPracticeFeedback,
      canManageChildSignatures: instructor.canManageChildSignatures,
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
    canSendMessages: instructor.canSendMessages,
    canEditAttendance: instructor.canEditAttendance,
    canEditRidingNotes: instructor.canEditRidingNotes,
    canEditHorseFeeding: instructor.canEditHorseFeeding,
    canManageTeachingPracticeAssignments: instructor.canManageTeachingPracticeAssignments,
    canManageTeachingPracticeHorses: instructor.canManageTeachingPracticeHorses,
    canEditTeachingPracticeFeedback: instructor.canEditTeachingPracticeFeedback,
    canManageChildSignatures: instructor.canManageChildSignatures,
  };
}

// Clears ONLY the instructor session cookie. Takes no arguments, reads no
// client id, consults no Actor DAL, runs no Prisma query, and exposes no
// secret/cookie value. Non-authoritative in this stage; never clears the
// trainee cookie.
export async function logoutInstructor(): Promise<void> {
  await clearSessionCookie("instructor");
}
