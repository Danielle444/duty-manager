import { prisma } from "@/lib/prisma";
import { ScheduleClient } from "@/app/admin/schedule/ScheduleClient";
import { dateKey } from "@/lib/dates";
import { requireAdmin } from "@/lib/auth/require-admin";
import { blockedGroupsForDayPlan } from "@/lib/duty-constraints";

export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  await requireAdmin();
  const [assignments, students, dutyTypes, settings, weeklySchedules, noDutyDates, dayPlans, constraints] =
    await Promise.all([
      prisma.dutyAssignment.findMany({
        include: { student: true, dutyType: true },
        orderBy: [{ date: "asc" }, { dutyType: { name: "asc" } }],
      }),
      prisma.student.findMany({
        where: { isActive: true },
        orderBy: { fullName: "asc" },
        select: {
          id: true,
          fullName: true,
          lastName: true,
          groupName: true,
          subgroupNumber: true,
        },
      }),
      prisma.dutyType.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, allocationMode: true },
      }),
      prisma.courseSettings.findUnique({ where: { id: 1 } }),
      prisma.weeklySchedule.findMany({ orderBy: { startDate: "asc" } }),
      prisma.noDutyDate.findMany({ select: { date: true } }),
      prisma.courseDayPlan.findMany(),
      prisma.dutyConstraint.findMany({ where: { isActive: true } }),
    ]);

  // Precomputed once per page load (not per cell click): for each date that
  // has a day plan, which group names are blocked from which duty types.
  // Static admin-config-derived data, cheap to compute eagerly here rather
  // than fetching it again every time the cell editor opens.
  const constraintsByDutyType = new Map<string, typeof constraints>();
  for (const c of constraints) {
    const list = constraintsByDutyType.get(c.dutyTypeId) ?? [];
    list.push(c);
    constraintsByDutyType.set(c.dutyTypeId, list);
  }
  const blockedGroupsByDate: Record<string, Record<string, string[]>> = {};
  for (const dayPlan of dayPlans) {
    const dk = dateKey(dayPlan.date);
    for (const dt of dutyTypes) {
      const blocked = blockedGroupsForDayPlan(dayPlan, constraintsByDutyType.get(dt.id) ?? []);
      if (blocked.size === 0) continue;
      if (!blockedGroupsByDate[dk]) blockedGroupsByDate[dk] = {};
      blockedGroupsByDate[dk][dt.id] = Array.from(blocked);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-card-foreground">שיבוץ תורנויות</h1>
      <ScheduleClient
        assignments={assignments.map((a) => ({
          id: a.id,
          dateKey: dateKey(a.date),
          studentId: a.studentId,
          studentName: a.student.fullName,
          dutyTypeId: a.dutyTypeId,
          dutyTypeName: a.dutyType.name,
          isManual: a.isManual,
          isPublished: a.isPublished,
          isCompleted: a.isCompleted,
        }))}
        students={students}
        dutyTypes={dutyTypes}
        courseRange={
          settings ? { startDate: dateKey(settings.startDate), endDate: dateKey(settings.endDate) } : null
        }
        weeklySchedules={weeklySchedules.map((w) => ({
          id: w.id,
          name: w.name,
          startDate: dateKey(w.startDate),
          endDate: dateKey(w.endDate),
        }))}
        noDutyDateKeys={noDutyDates.map((n) => dateKey(n.date))}
        blockedGroupsByDate={blockedGroupsByDate}
      />
    </div>
  );
}
