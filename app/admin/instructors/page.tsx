import { prisma } from "@/lib/prisma";
import { InstructorsClient } from "@/app/admin/instructors/InstructorsClient";
import { requireAdmin } from "@/lib/auth/require-admin";

export const dynamic = "force-dynamic";

export default async function InstructorsPage() {
  await requireAdmin();
  const instructors = await prisma.instructor.findMany({
    orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-card-foreground">ניהול מדריכים</h1>
      </div>
      <InstructorsClient
        instructors={instructors.map((i) => ({
          id: i.id,
          firstName: i.firstName,
          lastName: i.lastName,
          fullName: i.fullName,
          identityNumber: i.identityNumber,
          phone: i.phone,
          isActive: i.isActive,
          canEditHorseAssignments: i.canEditHorseAssignments,
          canSendMessages: i.canSendMessages,
        }))}
      />
    </div>
  );
}
