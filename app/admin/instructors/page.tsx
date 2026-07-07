import { prisma } from "@/lib/prisma";
import { InstructorsClient } from "@/app/admin/instructors/InstructorsClient";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getRidingAssignmentSummaryForAllInstructors } from "@/lib/actions/riding-assignment-summary";

export const dynamic = "force-dynamic";

export default async function InstructorsPage() {
  await requireAdmin();
  const [instructors, ridingSummaries] = await Promise.all([
    prisma.instructor.findMany({
      orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
    }),
    getRidingAssignmentSummaryForAllInstructors(),
  ]);

  const ridingSummaryByInstructorId = new Map(ridingSummaries.map((s) => [s.instructorId, s]));

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
          canEditAttendance: i.canEditAttendance,
          canEditRidingNotes: i.canEditRidingNotes,
          canEditHorseFeeding: i.canEditHorseFeeding,
          canManageTeachingPracticeAssignments: i.canManageTeachingPracticeAssignments,
          canManageTeachingPracticeHorses: i.canManageTeachingPracticeHorses,
          canEditTeachingPracticeFeedback: i.canEditTeachingPracticeFeedback,
          ridingSummary: ridingSummaryByInstructorId.get(i.id) ?? {
            instructorId: i.id,
            totalAssigned: 0,
            pastAssigned: 0,
            todayAssigned: 0,
            upcomingAssigned: 0,
          },
        }))}
      />
    </div>
  );
}
