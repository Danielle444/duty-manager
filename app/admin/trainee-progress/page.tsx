import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { TraineeProgressClient } from "@/app/admin/trainee-progress/TraineeProgressClient";

export const dynamic = "force-dynamic";

// Same full-roster-load pattern as /admin/students/page.tsx - active and
// inactive trainees both included (matches getStudentRidingHistoryForAdmin,
// which doesn't gate on isActive either), client does search/filter locally.
//
// studentId is an optional deep-link (from the "מעקב ומשובים" button on
// /admin/students) - validated against the loaded roster below rather than
// trusted as-is, so an unknown/stale id in the URL never crashes the page,
// it just falls back to "no trainee selected yet" the same as visiting the
// page with no query param at all.
export default async function TraineeProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string }>;
}) {
  await requireAdmin();
  const { studentId } = await searchParams;

  const students = await prisma.student.findMany({
    orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
  });

  const initialStudentId = studentId && students.some((s) => s.id === studentId) ? studentId : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-card-foreground">מעקב חניכים</h1>
        <p className="text-sm text-muted-foreground">
          בחירת חניך/ה לצפייה במידע ומשוב שנאסף עבורו/ה.
        </p>
      </div>
      <TraineeProgressClient
        students={students.map((s) => ({
          id: s.id,
          fullName: s.fullName,
          groupName: s.groupName,
          subgroupNumber: s.subgroupNumber,
          isActive: s.isActive,
          hasPrivateHorse: s.hasPrivateHorse,
          privateHorseName: s.privateHorseName,
          assignedHorseName: s.assignedHorseName,
        }))}
        initialStudentId={initialStudentId}
      />
    </div>
  );
}
