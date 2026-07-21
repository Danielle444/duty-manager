import { prisma } from "@/lib/prisma";
import { getCurrentInstructor } from "@/lib/auth/actor";
import { InstructorClient } from "@/app/instructor/InstructorClient";
import { NAV_MAX_WIDTH_CLASSNAME } from "@/lib/components/BottomTabs";

export const dynamic = "force-dynamic";

export default async function InstructorPage() {
  // E0 - SERVER-SIDE GATE. The canonical Actor DAL is consulted BEFORE any
  // sensitive query runs. getCurrentInstructor() returns null for every
  // untrustworthy case (no cookie, invalid/expired/tampered token, missing or
  // weak SESSION_SECRET, trainee/admin session, deleted instructor row,
  // isActive=false, subject/row mismatch) and makes no DB call at all when
  // there is no valid session - see lib/auth/actor.ts + lib/auth/actor-core.ts.
  //
  // Deliberately NOT a redirect: this page also RENDERS the instructor
  // name-and-ID login form (InstructorClient's !session branch), so redirecting
  // unauthenticated callers away would make an instructor session impossible to
  // obtain and lock every instructor out. The gate instead withholds the
  // payload: an unauthenticated request gets the same login screen it gets
  // today, with empty sensitive props.
  const actor = await getCurrentInstructor();

  const data =
    actor === null ? EMPTY_INSTRUCTOR_PAGE_DATA : await loadInstructorPageData();

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
    <div className={`mx-auto flex min-h-dvh w-full flex-col bg-background ${NAV_MAX_WIDTH_CLASSNAME}`}>
      <InstructorClient
        authenticated={actor !== null}
        students={data.students}
        dutyTypes={data.dutyTypes}
        instructors={data.instructors}
        studentHorseInfo={data.studentHorseInfo}
      />
    </div>
  );
}

/**
 * The four sensitive roster loaders. Declared BELOW the page component (and
 * only ever called from its authenticated branch) so that in source order the
 * getCurrentInstructor() gate precedes every Prisma call - a property the
 * co-located contract test asserts by index comparison, which is why this
 * comment deliberately avoids writing that call prefix literally.
 */
async function loadInstructorPageData() {
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
  return { students, dutyTypes, instructors, studentHorseInfo };
}

type InstructorPageData = Awaited<ReturnType<typeof loadInstructorPageData>>;

/**
 * The payload an unauthenticated request receives: nothing. No trainee row, no
 * horse field, no duty type, and - most importantly - no instructor id, which
 * is still the bearer token every un-migrated instructor action accepts.
 */
const EMPTY_INSTRUCTOR_PAGE_DATA: InstructorPageData = {
  students: [],
  dutyTypes: [],
  instructors: [],
  studentHorseInfo: [],
};
