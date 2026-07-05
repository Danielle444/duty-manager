import { prisma } from "@/lib/prisma";
import { CompletionClient } from "@/app/admin/completion/CompletionClient";
import { dateKey, todayDateKey } from "@/lib/dates";
import { requireAdmin } from "@/lib/auth/require-admin";

export const dynamic = "force-dynamic";

export default async function CompletionPage() {
  await requireAdmin();
  const assignments = await prisma.dutyAssignment.findMany({
    include: { student: true, dutyType: true },
    orderBy: [{ date: "asc" }, { dutyType: { name: "asc" } }],
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-card-foreground">מעקב ביצוע תורנויות</h1>
      <CompletionClient
        assignments={assignments.map((a) => ({
          id: a.id,
          dateKey: dateKey(a.date),
          studentName: a.student.fullName,
          groupName: a.student.groupName,
          subgroupNumber: a.student.subgroupNumber,
          dutyTypeName: a.dutyType.name,
          isPublished: a.isPublished,
          isCompleted: a.isCompleted,
          completedAt: a.completedAt ? a.completedAt.toISOString() : null,
        }))}
        defaultDateKey={todayDateKey()}
      />
    </div>
  );
}
