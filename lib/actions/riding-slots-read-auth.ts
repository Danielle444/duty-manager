/**
 * RS-SEC-1IR - PURE, dependency-injected orchestration that binds the three
 * previously-unauthenticated instructor riding READ paths to the server-derived
 * actor identity.
 *
 * Like ./attendance-read-auth and ./horse-feeding-auth, this is deliberately NOT
 * a "use server" module: it is a plain server-side library, so nothing here is
 * registered as a Server Action. It carries the testable orchestration (the
 * session-actor gate + delegation to the already-built reader) that the public
 * server actions in ./riding-slots import and wire to real dependencies (the
 * canonical actor DAL getCurrentInstructor + the existing Prisma reads).
 *
 * NO runtime side effects at import time, and NO Prisma / next-cookies / next-
 * cache import: every impure capability (the session actor resolver, the readers)
 * is passed in via the *Deps interfaces. The only edges back to ./riding-slots
 * are erased `import type`s, so the type-only edge creates no runtime circular
 * import and pulls in neither next/headers nor Prisma.
 *
 * SECURITY CONTRACT (why this exists):
 *  - getInstructorRidingSlots, getRidingSlotStudentNotes, and
 *    getStudentRidingHistoryForInstructor previously had NO authentication at
 *    all: any caller (including unauthenticated) received instructor allocations,
 *    per-trainee riding feedback/history, and attendance-derived operational
 *    information.
 * All three now derive identity ONLY from the injected server-side actor resolver
 * (getCurrentInstructor), never from a client-supplied id (none of the three ever
 * took one). A missing/invalid/inactive/wrong-audience/subject-mismatched session
 * yields a null actor (the resolver returns null in every such case): the list
 * readers fail closed to [] and the history reader fails closed to null, and the
 * underlying reader is NEVER invoked - revealing nothing, the same fail-closed
 * read convention as getAttendanceTrackingForInstructor / getStudentContacts /
 * getHorseFeedingOverviewForInstructor.
 *
 * FAIL-CLOSED ON RESOLVER REJECTION: per the RS-SEC-1IR contract, a THROWN actor
 * resolution (session/infra failure - e.g. a missing/weak SESSION_SECRET or a
 * Prisma error inside getCurrentInstructor) is caught around the actor resolution
 * ONLY and treated exactly like a null actor: the list readers return [] and the
 * history reader returns null, never touching the underlying reader. The catch is
 * scoped strictly to the actor resolution so a genuine reader error still
 * propagates unchanged (preserving current riding-slot / note / history load
 * behaviour), and no internal session/reason-code detail is surfaced.
 *
 * This stage protects WHO the instructor is (identity only). Viewing riding data
 * intentionally does NOT require canEditRidingNotes (that flag gates editing
 * only), so none of these gates check any actor-level permission flag - matching
 * the committed "all instructors may view" convention. NO ATTENDANCE capability /
 * offering gating is applied to the internal attendance-derived business-rule
 * data inside getRidingSlotStudentNotes, and NO slot-assignment ownership is
 * introduced.
 */
import type {
  WeeklyRidingDay,
  RidingSlotStudentRow,
  StudentRidingHistoryResult,
} from "./riding-slots";

// --- instructor riding-slots overview read ----------------------------------

/**
 * Injectable dependencies for {@link loadInstructorRidingSlotsWithDeps}.
 * `getCurrentInstructor` is the canonical server-side actor resolver (null for
 * any unauthenticated / invalid / inactive / wrong-audience session);
 * `readSlots` is the existing date-range reader that produces the riding-slot DTO.
 */
export interface InstructorRidingSlotsReadDeps {
  getCurrentInstructor: () => Promise<{ id: string } | null>;
  readSlots: (
    startDateKey: string,
    endDateKey: string,
  ) => Promise<WeeklyRidingDay[]>;
}

/**
 * Gate the instructor riding-slots read on a trustworthy server-derived
 * instructor actor, THEN delegate to the unchanged date-range reader.
 *
 * Identity comes solely from deps.getCurrentInstructor(); there is no instructor
 * id parameter, so no client value can select or impersonate an instructor. A
 * null actor - or a thrown actor resolution (caught around the resolver only) -
 * fails closed to [] and the reader is NEVER invoked. The date-range inputs are
 * forwarded unchanged; for a valid active instructor the returned DTO is exactly
 * as before, and a genuine readSlots() error still propagates (it is outside the
 * catch).
 */
export async function loadInstructorRidingSlotsWithDeps(
  deps: InstructorRidingSlotsReadDeps,
  startDateKey: string,
  endDateKey: string,
): Promise<WeeklyRidingDay[]> {
  let instructor: { id: string } | null;
  try {
    instructor = await deps.getCurrentInstructor();
  } catch {
    return [];
  }
  if (!instructor) {
    return [];
  }
  return deps.readSlots(startDateKey, endDateKey);
}

// --- riding-slot per-student notes read --------------------------------------

/**
 * Injectable dependencies for {@link loadRidingSlotStudentNotesWithDeps}.
 * `getCurrentInstructor` is the canonical server-side actor resolver;
 * `readNotes` is the existing per-slot roster+note+attendance reader.
 */
export interface RidingSlotStudentNotesReadDeps {
  getCurrentInstructor: () => Promise<{ id: string } | null>;
  readNotes: (ridingSlotId: string) => Promise<RidingSlotStudentRow[]>;
}

/**
 * Gate the per-slot student-notes read on a trustworthy server-derived instructor
 * actor, THEN delegate to the unchanged reader.
 *
 * ridingSlotId remains a record selector only (the target slot), never actor
 * identity. A null actor - or a thrown actor resolution (caught around the
 * resolver only) - fails closed to [] and NO Prisma/attendance query runs. For a
 * valid active instructor the returned DTO - including the attendance-derived
 * status/time/notes fields - is exactly as before; a genuine readNotes() error
 * still propagates. No ATTENDANCE capability gating and no slot-assignment
 * ownership is applied here.
 */
export async function loadRidingSlotStudentNotesWithDeps(
  deps: RidingSlotStudentNotesReadDeps,
  ridingSlotId: string,
): Promise<RidingSlotStudentRow[]> {
  let instructor: { id: string } | null;
  try {
    instructor = await deps.getCurrentInstructor();
  } catch {
    return [];
  }
  if (!instructor) {
    return [];
  }
  return deps.readNotes(ridingSlotId);
}

// --- instructor-view student riding history read -----------------------------

/**
 * Injectable dependencies for {@link loadStudentRidingHistoryForInstructorWithDeps}.
 * `getCurrentInstructor` is the canonical server-side actor resolver;
 * `readHistory` is the existing per-student history builder (returns null for a
 * missing/empty student).
 */
export interface StudentRidingHistoryForInstructorReadDeps {
  getCurrentInstructor: () => Promise<{ id: string } | null>;
  readHistory: (
    studentId: string,
  ) => Promise<StudentRidingHistoryResult | null>;
}

/**
 * Gate the instructor-view student riding-history read on a trustworthy
 * server-derived instructor actor, THEN delegate to the unchanged history
 * builder.
 *
 * studentId remains the TARGET record selector only, never actor identity. A null
 * actor - or a thrown actor resolution (caught around the resolver only) - fails
 * closed to null (the reader's established empty result) and the history builder
 * is NEVER invoked. For a valid active instructor the returned history is exactly
 * as before; a genuine readHistory() error still propagates. This does NOT route
 * through the trainee-progress permission reader and adds no permission /
 * capability / assignment / group / offering restriction.
 */
export async function loadStudentRidingHistoryForInstructorWithDeps(
  deps: StudentRidingHistoryForInstructorReadDeps,
  studentId: string,
): Promise<StudentRidingHistoryResult | null> {
  let instructor: { id: string } | null;
  try {
    instructor = await deps.getCurrentInstructor();
  } catch {
    return null;
  }
  if (!instructor) {
    return null;
  }
  return deps.readHistory(studentId);
}
