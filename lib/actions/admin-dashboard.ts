import { prisma } from "@/lib/prisma";
import { todayDateKey, parseDateKey } from "@/lib/dates";
import {
  resolveCurrentCourseOffering,
  NoCurrentCourseOfferingError,
  AmbiguousCourseOfferingError,
  IncompleteCourseOfferingError,
} from "@/lib/course/current-offering";

// Plain server-only helper (no "use server") - nothing client-side needs to
// call this directly, /admin/page.tsx (a server component) is the only
// caller, so there is no reason to expose it as an invokable action.

export interface RecentMessageTaskItem {
  id: string;
  title: string;
  type: "MESSAGE" | "TASK";
  createdAt: Date;
}

export interface RecentMaterialItem {
  id: string;
  title: string;
  materialType: "FILE" | "LINK";
  createdAt: Date;
}

export interface AdminDashboardData {
  activeStudents: number;
  activeInstructors: number;
  courseRange: { startDate: Date; endDate: Date } | null;
  todayAssignmentsTotal: number;
  todayAssignmentsCompleted: number;
  activeMaterialsCount: number;

  studentsWithoutPhone: number;
  studentsWithoutHorse: number | null;
  incompleteTaskRecipients: number;

  recentMessageTasks: RecentMessageTaskItem[];
  recentMaterials: RecentMaterialItem[];
}

/**
 * MULTI-COURSE W8A-8D - dependency-injected orchestrator for the admin
 * dashboard's "students without horse" attention statistic.
 *
 * Authority migration: this statistic no longer reads Student horse columns. It
 * counts ACTIVE CourseEnrollment rows (missing a horse) in the server-resolved
 * current CourseOffering. There is NO Student fallback and NO client-supplied
 * offering id.
 *
 * Failure contract (this statistic only, never the whole dashboard):
 *  - a KNOWN structural current-offering error (none / ambiguous / incomplete)
 *    degrades this one statistic to `null` so the rest of the dashboard still
 *    loads.
 *  - any UNEXPECTED resolver error is rethrown (preserves fail-loud behavior).
 *  - the count call sits OUTSIDE the try, so count/query errors always
 *    propagate and are never misclassified as an offering error.
 *  - count is not invoked at all when offering resolution fails structurally.
 */
export interface StudentsWithoutHorseDeps {
  resolveCurrentCourseOffering: () => Promise<{ id: string }>;
  countActiveEnrollmentsMissingHorse: (courseOfferingId: string) => Promise<number>;
}

/**
 * The three typed cardinality/completeness errors the temporary singleton
 * offering resolver can throw. Only these degrade the statistic to null; every
 * other error is unexpected and must surface.
 */
function isKnownCurrentOfferingError(err: unknown): boolean {
  return (
    err instanceof NoCurrentCourseOfferingError ||
    err instanceof AmbiguousCourseOfferingError ||
    err instanceof IncompleteCourseOfferingError
  );
}

export async function resolveStudentsWithoutHorseCount(
  deps: StudentsWithoutHorseDeps,
): Promise<number | null> {
  let offering: { id: string };
  try {
    offering = await deps.resolveCurrentCourseOffering();
  } catch (err) {
    if (isKnownCurrentOfferingError(err)) return null;
    throw err;
  }
  // Outside the try on purpose: count/query errors must propagate, not be
  // absorbed as a "no current offering" null.
  return deps.countActiveEnrollmentsMissingHorse(offering.id);
}

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const today = parseDateKey(todayDateKey());

  const [
    activeStudents,
    activeInstructors,
    settings,
    todayAssignments,
    activeMaterialsCount,
    studentsWithoutPhone,
    studentsWithoutHorse,
    incompleteTaskRecipients,
    recentMessageTasks,
    recentMaterials,
  ] = await Promise.all([
    prisma.student.count({ where: { isActive: true } }),
    prisma.instructor.count({ where: { isActive: true } }),
    prisma.courseSettings.findUnique({ where: { id: 1 } }),
    prisma.dutyAssignment.findMany({
      where: { date: today, isPublished: true },
      select: { isCompleted: true },
    }),
    prisma.courseMaterial.count({ where: { isActive: true } }),
    // Missing phone: active students with no phone value at all.
    prisma.student.count({
      where: { isActive: true, OR: [{ phone: null }, { phone: "" }] },
    }),
    // Missing horse assignment, migrated to the enrollment cache authority:
    // counts ACTIVE enrollments (of the server-resolved current offering) that
    // have no assigned horse and are not private-horse. Mirrors the previous
    // raw null/empty-string "none" condition - a private-horse enrollment is
    // never "missing" regardless of whether a name was entered yet. Resolves to
    // null (not a rejection) on a known offering error so the rest of the
    // dashboard still loads.
    resolveStudentsWithoutHorseCount({
      resolveCurrentCourseOffering,
      countActiveEnrollmentsMissingHorse: (courseOfferingId) =>
        prisma.courseEnrollment.count({
          where: {
            courseOfferingId,
            status: "ACTIVE",
            hasPrivateHorse: false,
            OR: [{ assignedHorseName: null }, { assignedHorseName: "" }],
          },
        }),
    }),
    prisma.messageTaskRecipient.count({
      where: { completedAt: null, messageTask: { type: "TASK", isArchived: false } },
    }),
    prisma.messageTask.findMany({
      where: { isArchived: false },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, title: true, type: true, createdAt: true },
    }),
    prisma.courseMaterial.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, title: true, materialType: true, createdAt: true },
    }),
  ]);

  return {
    activeStudents,
    activeInstructors,
    courseRange: settings ? { startDate: settings.startDate, endDate: settings.endDate } : null,
    todayAssignmentsTotal: todayAssignments.length,
    todayAssignmentsCompleted: todayAssignments.filter((a) => a.isCompleted).length,
    activeMaterialsCount,
    studentsWithoutPhone,
    studentsWithoutHorse,
    incompleteTaskRecipients,
    recentMessageTasks,
    recentMaterials,
  };
}
