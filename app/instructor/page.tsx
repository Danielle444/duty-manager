import { prisma } from "@/lib/prisma";
import { InstructorClient } from "@/app/instructor/InstructorClient";

export const dynamic = "force-dynamic";

export default async function InstructorPage() {
  const [students, dutyTypes, instructors, studentHorseInfo] = await Promise.all([
    prisma.student.findMany({
      where: { isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, groupName: true, subgroupNumber: true },
    }),
    prisma.dutyType.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.instructor.findMany({
      where: { isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
    // Separate from the `students` select above (kept as-is - it's threaded
    // through InstructorClient to every instructor tab) so widening it for
    // מעקב חניכים's horse display doesn't touch the shared StudentOption
    // shape. Only InstructorTraineeProgressSection consumes this.
    prisma.student.findMany({
      where: { isActive: true },
      select: { id: true, hasPrivateHorse: true, privateHorseName: true, assignedHorseName: true },
    }),
  ]);

  return (
    // Widens from tablet upward (mobile portrait keeps today's max-w-lg).
    // Each tier's cap is set to that breakpoint's own viewport width (px
    // arbitrary values, not max-w-3xl/4xl or max-w-screen-*, which Tailwind
    // v4 doesn't ship - verified against node_modules/tailwindcss/theme.css,
    // whose max-width scale is --container-* only, with no screen-based
    // entries) - so the shell is effectively edge-to-edge (minus header/
    // main's own px-4) right up until the next breakpoint, instead of
    // leaving a visible unused margin on phone landscape and tablet sizes.
    // xl:max-w-[1280px] still caps very wide desktop windows so lines don't
    // grow unreasonably long. BottomTabs gets the same ladder via its
    // maxWidthClassName prop below, so the fixed bottom nav never
    // mismatches this shell's width.
    //
    // min-h-dvh (100dvh), not min-h-screen (100vh): on mobile Safari/Chrome,
    // 100vh is computed against the layout viewport with the address bar
    // collapsed, so it's taller than what's actually visible whenever the
    // bar is showing - that mismatch is what made the fixed BottomTabs
    // appear to float/detach from the true bottom edge as the bar
    // animates in/out. 100dvh tracks the real visible viewport instead.
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-background sm:max-w-[640px] md:max-w-[768px] lg:max-w-[1024px] xl:max-w-[1280px]">
      <InstructorClient
        students={students}
        dutyTypes={dutyTypes}
        instructors={instructors}
        studentHorseInfo={studentHorseInfo}
      />
    </div>
  );
}
