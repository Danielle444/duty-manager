/**
 * MULTI-COURSE (course-affiliation display slice A1) - server-side IO reader that
 * loads the admin trainee list together with each trainee's course affiliations.
 *
 * Server-side only: reads through the shared Prisma client. All shaping (the
 * visibility filter, dedup, badge ordering, labels) is delegated to the PURE core
 * (trainee-affiliations-core.ts), so this stays a thin IO shell.
 *
 * ONE QUERY, NO N+1: it issues EXACTLY ONE `prisma.student.findMany` with a nested
 * `courseEnrollments -> courseOffering` select. Prisma loads the nested relation in
 * a single round trip, so there is no per-student follow-up query.
 *
 * PRIVACY-NARROW (locked): the Student select is EXACTLY the nine fields the
 * current admin trainee list already consumes (see app/admin/students/page.tsx:
 * id, firstName, lastName, fullName, groupName, subgroupNumber, identityNumber,
 * phone, isActive) - it adds NO new personal-data surface (no horse, notes,
 * health, parent, attendance, feedback, messages, files, login/session). The only
 * additions are the minimal affiliation relation fields. groupName/subgroupNumber
 * are carried ONLY for the existing display and are NEVER used to derive
 * affiliation (that is Student -> CourseEnrollment -> CourseOffering only).
 *
 * OFFERING SCOPING: this reader is the GENERAL, person-centric list - it returns
 * ALL students and each student's own affiliations. It NEVER resolves the ACTIVE
 * singleton (resolveCurrentCourseOffering), NEVER reads a selected-course cookie,
 * and NEVER identifies an offering by name/level. Affiliation identity is the
 * CourseOffering id on each enrollment.
 *
 * TRUST BOUNDARY: admin-only infrastructure. It performs NO requireAdmin() itself;
 * the server page (Slice A2) MUST call requireAdmin() BEFORE using this reader,
 * mirroring the enrollable-trainees / offering-enrollments-admin layering.
 *
 * READ-ONLY: it performs no write and touches no group-membership / horse /
 * schedule / duty / attendance / message / capability data.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  buildTraineeAffiliationRows,
  type RawStudentWithAffiliations,
  type TraineeAffiliationRow,
} from "./trainee-affiliations-core";

export type {
  TraineeAffiliationRow,
  TraineeAffiliationSummary,
  VisibleAffiliation,
} from "./trainee-affiliations-core";

/**
 * The EXACT, minimal field selection. Declared once (`as const`) so Prisma narrows
 * the result and a DB-free test can assert that NO extra personal data is ever
 * requested and that the affiliation relation is minimal.
 */
export const ADMIN_TRAINEE_AFFILIATION_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  fullName: true,
  groupName: true,
  subgroupNumber: true,
  identityNumber: true,
  phone: true,
  isActive: true,
  courseEnrollments: {
    select: {
      id: true,
      status: true,
      isPrimary: true,
      courseOfferingId: true,
      courseOffering: {
        select: { id: true, name: true, level: true, status: true },
      },
    },
  },
} as const;

/**
 * The deterministic admin trainee ordering, preserved EXACTLY as the current page
 * uses it, plus an explicit `id` final tie-breaker for a stable total order:
 *   isActive descending, fullName ascending, id ascending.
 */
export const ADMIN_TRAINEE_AFFILIATION_ORDER: Prisma.StudentOrderByWithRelationInput[] =
  [{ isActive: "desc" }, { fullName: "asc" }, { id: "asc" }];

/**
 * The exact query the reader issues, built once and passed to the injected
 * fetcher. A DB-free test asserts this shape to prove the minimal select, the
 * minimal nested affiliation relation, and the preserved ordering - without a live
 * database.
 */
export interface TraineeAffiliationsQuery {
  readonly orderBy: Prisma.StudentOrderByWithRelationInput[];
  readonly select: typeof ADMIN_TRAINEE_AFFILIATION_SELECT;
}

/** Build the single-read query (PURE; no IO). */
export function buildTraineeAffiliationsQuery(): TraineeAffiliationsQuery {
  return {
    orderBy: ADMIN_TRAINEE_AFFILIATION_ORDER,
    select: ADMIN_TRAINEE_AFFILIATION_SELECT,
  };
}

/**
 * Injected boundary. `fetchStudentsWithAffiliations` receives the built query and
 * returns the raw rows. There is deliberately NO dependency capable of writing,
 * and none that reads any table other than the single Student read (with its
 * nested affiliation relation).
 */
export interface TraineeAffiliationsDeps {
  fetchStudentsWithAffiliations: (
    query: TraineeAffiliationsQuery,
  ) => Promise<RawStudentWithAffiliations[]>;
}

/**
 * DB-free DI orchestration: build the single-read query, delegate the read to the
 * injected fetcher, and hand the raw rows to the PURE core for shaping. Student
 * order is preserved exactly as the DB returned it.
 */
export async function listStudentsWithCourseAffiliationsForAdminWithDeps(
  deps: TraineeAffiliationsDeps,
): Promise<TraineeAffiliationRow[]> {
  const query = buildTraineeAffiliationsQuery();
  const rows = await deps.fetchStudentsWithAffiliations(query);
  return buildTraineeAffiliationRows(rows);
}

/**
 * Thin wrapper binding the real Prisma client. Issues EXACTLY ONE
 * `prisma.student.findMany` with the minimal select + nested affiliation relation
 * and the deterministic order. Reads ONLY Student (+ its affiliation relation);
 * performs no write and touches no other domain.
 */
export async function listStudentsWithCourseAffiliationsForAdmin(): Promise<
  TraineeAffiliationRow[]
> {
  return listStudentsWithCourseAffiliationsForAdminWithDeps({
    fetchStudentsWithAffiliations: (query) =>
      prisma.student.findMany({
        orderBy: query.orderBy,
        select: query.select,
      }) as unknown as Promise<RawStudentWithAffiliations[]>,
  });
}
