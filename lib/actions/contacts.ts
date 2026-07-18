"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentInstructor, getCurrentTrainee } from "@/lib/auth/actor";
import { mayAccessInstructorContactDirectory } from "@/lib/auth/contact-directory-access";
import { resolveCurrentCourseOffering } from "@/lib/course/current-offering";
import { getCurrentCourseEnrollmentRoster } from "@/lib/course/current-enrollments";
import { loadStudentContactsWithDeps } from "./contacts-student-directory";

// StudentContactRow is declared directly in this module (as it was before W5B1)
// and is the single source of truth for the public contract. It is a type-only
// export, erased at compile time, so the file-level "use server" server-actions
// loader never emits a runtime reference to it. The pure orchestration module
// consumes it via a type-only `import type`, so there is no runtime cycle.
export interface StudentContactRow {
  id: string;
  fullName: string;
  lastName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  phone: string | null;
}

// Audience-gated (Stage 0A3) + enrollment-backed (Multi-Course W5B1): the
// STUDENT contact directory carries trainee PII (names + phone numbers), so it
// is served ONLY to an authenticated instructor derived server-side from the
// signed session via getCurrentInstructor(). A missing/invalid/wrong-audience/
// inactive session yields a null actor (see actor-core deriveInstructorActor),
// and a trainee cookie can never satisfy this gate, so no anonymous or trainee
// caller receives any student data. The no-arg signature is unchanged (no
// client-supplied id is trusted or even accepted), so callers need no edits,
// and the ordering + StudentContactRow[] output shape are preserved unchanged.
//
// W5B1 repoints ONLY this one read path from the legacy global Student
// compatibility roster to the enrollment-backed current-course DAL: resolve the
// singleton CourseOffering, load its ACTIVE enrollment roster at one captured
// asOf, and map it to the same StudentContactRow[] contract in the same reviewed
// W5B0 ordering. Structural failures (resolver ambiguity, membership anomalies,
// malformed subgroup, duplicate id, DAL failure) fail loudly and never fall back
// to prisma.student.findMany.
export async function getStudentContacts(): Promise<StudentContactRow[]> {
  return loadStudentContactsWithDeps({
    getCurrentInstructor,
    resolveCurrentCourseOffering,
    getCurrentCourseEnrollmentRoster,
    now: () => new Date(),
  });
}

export interface InstructorContactRow {
  id: string;
  fullName: string;
  phone: string | null;
}

// Audience-gated (Stage 0A3): the INSTRUCTOR contact directory is shown to
// BOTH audiences - trainees (StudentInstructorContactsSection) and instructors
// (InstructorRidingSlotsSection roster picker) - so it is served to either an
// authenticated instructor OR an authenticated trainee, both derived
// server-side from the signed session. The instructor lookup is tried first and
// the trainee lookup is skipped when an instructor is already present. Only when
// no trustworthy actor of either audience exists (anonymous, invalid,
// wrong-audience, or inactive → null upstream) is access denied, so no
// anonymous caller receives any instructor data. The no-arg signature is
// unchanged (no client-supplied id is trusted or accepted), callers need no
// edits, and the ordering + InstructorContactRow[] output shape are preserved.
// While only one CourseOffering is active the directory stays global; no
// per-offering scoping is added in this stage.
export async function getInstructorContacts(): Promise<InstructorContactRow[]> {
  const instructor = await getCurrentInstructor();
  const trainee = instructor === null ? await getCurrentTrainee() : null;
  if (!mayAccessInstructorContactDirectory(instructor?.id, trainee?.id)) {
    return [];
  }
  const instructors = await prisma.instructor.findMany({
    where: { isActive: true },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, phone: true },
  });
  return instructors;
}
