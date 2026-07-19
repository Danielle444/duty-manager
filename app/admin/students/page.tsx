import { prisma } from "@/lib/prisma";
import { StudentsClient } from "@/app/admin/students/StudentsClient";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey } from "@/lib/dates";
import { resolveCurrentCourseOffering } from "@/lib/course/current-offering";
import { isKnownCurrentOfferingError } from "@/lib/course/create-trainee-enrollment-core";
import {
  buildLeafGroupOptions,
  type GroupChangeOption,
} from "@/lib/course/group-change-options";

export const dynamic = "force-dynamic";

// Safe, ID-free message when the current offering cannot be resolved: the
// students page stays fully usable, only the group-change control is disabled.
const GROUP_CHANGE_UNAVAILABLE_MESSAGE =
  "שינוי קבוצה אינו זמין כעת עקב בעיה בהגדרת הקורס הנוכחי. יש לפנות לניהול המערכת";

export default async function StudentsPage() {
  await requireAdmin();
  const [students, presets, courseSettings] = await Promise.all([
    prisma.student.findMany({
      orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
    }),
    prisma.availabilityRangePreset.findMany({ orderBy: { startDate: "asc" } }),
    prisma.courseSettings.findUnique({ where: { id: 1 } }),
  ]);

  // W6D3: resolve the current offering server-side and expose ONLY its valid
  // leaf subgroups as group-change targets. If offering resolution fails, keep
  // the page usable and disable the control with a safe message.
  let groupChangeOptions: GroupChangeOption[] = [];
  let groupChangeDisabledMessage: string | null = null;
  try {
    const offering = await resolveCurrentCourseOffering();
    const groups = await prisma.courseGroup.findMany({
      where: { courseOfferingId: offering.id },
      select: {
        id: true,
        name: true,
        parentGroupId: true,
        parentGroup: { select: { name: true } },
      },
    });
    groupChangeOptions = buildLeafGroupOptions(
      groups.map((g) => ({
        id: g.id,
        name: g.name,
        parentGroupId: g.parentGroupId,
        parentName: g.parentGroup?.name ?? null,
      })),
    );
  } catch (err) {
    if (!isKnownCurrentOfferingError(err)) {
      throw err;
    }
    groupChangeDisabledMessage = GROUP_CHANGE_UNAVAILABLE_MESSAGE;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-card-foreground">ניהול חניכים</h1>
      </div>
      <StudentsClient
        students={students.map((s) => ({
          id: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          fullName: s.fullName,
          groupName: s.groupName,
          subgroupNumber: s.subgroupNumber,
          identityNumber: s.identityNumber,
          phone: s.phone,
          isActive: s.isActive,
        }))}
        presets={presets.map((p) => ({ id: p.id, name: p.name }))}
        courseRange={
          courseSettings
            ? {
                startDate: dateKey(courseSettings.startDate),
                endDate: dateKey(courseSettings.endDate),
              }
            : null
        }
        groupChangeOptions={groupChangeOptions}
        groupChangeDisabledMessage={groupChangeDisabledMessage}
      />
    </div>
  );
}
