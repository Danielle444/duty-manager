"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { ActionResult } from "@/lib/actions/students";
import { getHorseDisplayInfo } from "@/lib/horse-info";
import { getRidingSlotStudentNotes } from "@/lib/actions/riding-slots";
import {
  findAssignmentForStudent,
  getAssignmentInstructorNames,
  formatInstructorNames,
} from "@/lib/riding-assignment-matching";

const NOT_FOUND_RIDING_SLOT = "ניהול הרכיבה לא נמצא. נסי לרענן את העמוד.";
const NO_PERMISSION = "אין הרשאה לערוך את רשימת הסוסים לאיכוף";
const DUPLICATE_STUDENT = "אין לבחור אותו/ה חניכ/ה יותר מפעם אחת";
const DUPLICATE_HORSE_IN_SUBGROUP = "אותו שם סוס נבחר יותר מפעם אחת באותה קבוצה/תת-קבוצה";
const STUDENT_NOT_IN_ROSTER = "אחד או יותר מהחניכים שנבחרו אינם/ן קיימ/ות או אינם/ן שייכ/ות לרכיבה זו";
// RIDING-PAIRS P2 mutual-exclusivity guard - see saveRidingSlotHorseListInternal.
const COMPLEX_PLAN_EXISTS =
  "לא ניתן לשמור רשימת סוסים רגילה - קיים כבר תכנון רכיבה מורכבת עבור רכיבה זו";
const LOCK_TIMEOUT = "המערכת עמוסה כרגע - נסי שוב בעוד רגע";

// ---------- Shared read model ----------

export interface RidingHorseCandidate {
  groupName: string | null;
  subgroupNumber: number | null;
  responsibleInstructorNames: string | null;
  studentId: string;
  studentName: string;
  // Raw usable horse name (session override if set, else the student's
  // normal assigned/private horse) - null when the student currently has
  // none. Never a placeholder string - see horseNameDisplay for that.
  horseName: string | null;
  horseNameDisplay: string;
}

export interface RidingSlotHorseListItemRow {
  groupName: string | null;
  subgroupNumber: number | null;
  studentId: string | null;
  // Resolved live from the current Student row (not a stored snapshot) -
  // null when studentId is null, or when the referenced Student row no
  // longer exists (the FK is onDelete: SetNull, so the item itself survives).
  studentName: string | null;
  horseName: string;
}

export interface RidingSlotHorseListStatus {
  ridingSlotId: string;
  listId: string | null;
  version: number;
  updatedAt: string | null;
  updatedByName: string | null;
  items: RidingSlotHorseListItemRow[];
  // Read-only status only - no RidingSlotHorsePublication is created or
  // updated by any action in this file (that is a later stage's job).
  hasPublications: boolean;
  hasStalePublication: boolean;
}

export interface RidingSlotHorseListForEditing extends RidingSlotHorseListStatus {
  candidates: RidingHorseCandidate[];
}

// Builds the selection candidates from the exact same RidingSlot/group/
// subgroup/student logic already used by the riding feedback UI
// (getRidingSlotStudentNotes) - never a second, independently-drifting
// roster query. There is no Horse model in this app, so a "horse without a
// trainee" candidate cannot be derived here; H3 intentionally only exposes
// student-derived candidates (see this file's own audit note in the H3
// report - not implemented here).
//
// RIDING-PAIRS P4a - exported so lib/actions/riding-slot-complex.ts can
// reuse this exact resolution (horse + responsible-instructor) for its own
// trainee candidates, instead of maintaining a second, independently-
// drifting copy of the same logic. riding-slot-horses.ts itself imports
// nothing from riding-slot-complex.ts, so this is a one-way dependency,
// not a cycle.
export async function buildHorseCandidates(ridingSlotId: string): Promise<RidingHorseCandidate[]> {
  const [studentRows, assignments] = await Promise.all([
    getRidingSlotStudentNotes(ridingSlotId),
    prisma.ridingSlotAssignment.findMany({
      where: { ridingSlotId },
      include: {
        instructor: true,
        instructors: { include: { instructor: true }, orderBy: { createdAt: "asc" } },
      },
    }),
  ]);

  return studentRows.map((row) => {
    const assignment = findAssignmentForStudent(assignments, row.groupName, row.subgroupNumber);
    const responsibleInstructorNames = assignment
      ? formatInstructorNames(getAssignmentInstructorNames(assignment))
      : null;

    // Same priority as resolvedHorseLine/buildStudentRidingHistory elsewhere
    // in this app: a session-specific horse override always wins over the
    // student's normal horse. Never written back to Student/RidingLessonNote.
    const sessionHorse = row.sessionHorseName?.trim();
    const horseInfo = getHorseDisplayInfo(row);
    const horseName = sessionHorse || horseInfo.horseName;
    const horseNameDisplay = sessionHorse ? `סוס בשיעור: ${sessionHorse}` : horseInfo.horseNameDisplay;

    return {
      groupName: row.groupName,
      subgroupNumber: row.subgroupNumber,
      responsibleInstructorNames,
      studentId: row.studentId,
      studentName: row.studentName,
      horseName,
      horseNameDisplay,
    };
  });
}

async function buildHorseListStatus(ridingSlotId: string): Promise<RidingSlotHorseListStatus> {
  const list = await prisma.ridingSlotHorseList.findUnique({
    where: { ridingSlotId },
    include: {
      items: { include: { student: { select: { id: true, fullName: true } } } },
      publications: { select: { sourceVersion: true } },
    },
  });

  if (!list) {
    return {
      ridingSlotId,
      listId: null,
      version: 0,
      updatedAt: null,
      updatedByName: null,
      items: [],
      hasPublications: false,
      hasStalePublication: false,
    };
  }

  return {
    ridingSlotId,
    listId: list.id,
    version: list.version,
    updatedAt: list.updatedAt.toISOString(),
    updatedByName: list.updatedByName,
    items: list.items.map((item) => ({
      groupName: item.groupName,
      subgroupNumber: item.subgroupNumber,
      studentId: item.studentId,
      studentName: item.student?.fullName ?? null,
      horseName: item.horseName,
    })),
    hasPublications: list.publications.length > 0,
    hasStalePublication: list.publications.some((p) => p.sourceVersion < list.version),
  };
}

// ---------- Get (read-only, no mutation) ----------

export async function getRidingSlotHorseListForAdmin(
  ridingSlotId: string
): Promise<RidingSlotHorseListForEditing | null> {
  await requireAdmin();

  const slot = await prisma.ridingSlot.findUnique({ where: { id: ridingSlotId }, select: { id: true } });
  if (!slot) return null;

  const [statusResult, candidates] = await Promise.all([
    buildHorseListStatus(ridingSlotId),
    buildHorseCandidates(ridingSlotId),
  ]);
  return { ...statusResult, candidates };
}

// instructorId is re-checked for existence/isActive only - NOT
// canEditRidingNotes. Viewing a riding slot's roster/notes has no
// permission-level gate anywhere else in this app (see
// getRidingSlotStudentNotes/getInstructorRidingSlots in
// lib/actions/riding-slots.ts), only saving does; but unlike those, this
// still confirms the caller is a real, active instructor account rather
// than accepting any id with zero validation. Returns null (the same
// "not found" shape already used for a missing RidingSlot) rather than an
// ActionResult error, since this function's return type has no separate
// error channel - never trusts the UI's own canEdit check as authorization.
export async function getRidingSlotHorseListForInstructor(
  instructorId: string,
  ridingSlotId: string
): Promise<RidingSlotHorseListForEditing | null> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive) return null;

  const slot = await prisma.ridingSlot.findUnique({ where: { id: ridingSlotId }, select: { id: true } });
  if (!slot) return null;

  const [statusResult, candidates] = await Promise.all([
    buildHorseListStatus(ridingSlotId),
    buildHorseCandidates(ridingSlotId),
  ]);
  return { ...statusResult, candidates };
}

// ---------- Save (full replace, versioned) ----------

const horseListItemInputSchema = z.object({
  // Free text, same as RidingSlotAssignment's own per-item groupName
  // (assignmentInputSchema) rather than the stricter bulk-template enum -
  // this is a single item, not a bulk-apply template. Overridden server-side
  // below for any item that has a studentId anyway.
  groupName: z.string().trim().optional(),
  subgroupNumber: z.coerce.number().int().positive().optional(),
  studentId: z.string().trim().min(1).optional(),
  horseName: z.string().trim().min(1, "יש להזין שם סוס"),
});

const horseListSaveInputSchema = z.object({
  ridingSlotId: z.string().min(1),
  items: z.array(horseListItemInputSchema),
});

export interface RidingSlotHorseListSaveInput {
  ridingSlotId: string;
  items: {
    groupName?: string;
    subgroupNumber?: number;
    studentId?: string;
    horseName: string;
  }[];
}

export interface RidingSlotHorseListSaveResult extends ActionResult {
  status?: RidingSlotHorseListStatus;
}

interface NormalizedHorseListItem {
  groupName: string | null;
  subgroupNumber: number | null;
  studentId: string | null;
  horseName: string;
}

interface HorseListActor {
  instructorId: string | null;
  adminEmail: string | null;
  adminName: string | null;
  displayName: string;
}

// Shared core of saveRidingSlotHorseListAsAdmin/AsInstructor. Every save
// fully replaces RidingSlotHorseListItem for this RidingSlot (delete +
// recreate, same convention as syncAssignmentInstructors in
// lib/actions/riding-slots.ts) and increments RidingSlotHorseList.version by
// exactly one, including when the submitted item set is empty. Never
// touches RidingSlotHorsePublication or its items.
async function saveRidingSlotHorseListInternal(
  input: RidingSlotHorseListSaveInput,
  actor: HorseListActor
): Promise<RidingSlotHorseListSaveResult> {
  const parsed = horseListSaveInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }
  const data = parsed.data;

  const slot = await prisma.ridingSlot.findUnique({ where: { id: data.ridingSlotId } });
  if (!slot) {
    return { success: false, error: NOT_FOUND_RIDING_SLOT };
  }

  // Authoritative roster for this slot right now - never trust the client's
  // own group/subgroup pairing for a student row. Only the studentId is
  // trusted; its group/subgroup is always overwritten from this roster.
  const candidates = await buildHorseCandidates(data.ridingSlotId);
  const rosterByStudentId = new Map(candidates.map((c) => [c.studentId, c]));

  const normalized: NormalizedHorseListItem[] = [];
  for (const item of data.items) {
    const studentId = item.studentId || null;
    let groupName = item.groupName || null;
    let subgroupNumber = item.subgroupNumber ?? null;

    if (studentId) {
      const roster = rosterByStudentId.get(studentId);
      if (!roster) {
        return { success: false, error: STUDENT_NOT_IN_ROSTER };
      }
      groupName = roster.groupName;
      subgroupNumber = roster.subgroupNumber;
    }

    normalized.push({ groupName, subgroupNumber, studentId, horseName: item.horseName });
  }

  // Deduplicate exact submitted rows (same group/subgroup/student/horseName) -
  // a harmless client-side artifact, silently collapsed rather than rejected.
  const seenExact = new Set<string>();
  const deduped: NormalizedHorseListItem[] = [];
  for (const item of normalized) {
    const key = JSON.stringify([
      item.groupName,
      item.subgroupNumber,
      item.studentId,
      item.horseName.toLowerCase(),
    ]);
    if (seenExact.has(key)) continue;
    seenExact.add(key);
    deduped.push(item);
  }

  // Reject the same non-null trainee appearing more than once with
  // conflicting data - ambiguous which row should win, so this is a hard
  // error rather than a silent collapse.
  const studentCounts = new Map<string, number>();
  for (const item of deduped) {
    if (!item.studentId) continue;
    studentCounts.set(item.studentId, (studentCounts.get(item.studentId) ?? 0) + 1);
  }
  if (Array.from(studentCounts.values()).some((count) => count > 1)) {
    return { success: false, error: DUPLICATE_STUDENT };
  }

  // Reject duplicate normalized horse names within the same group/subgroup.
  // Cross-subgroup collisions are deliberately NOT checked - horseName is
  // free text, not a real Horse entity (see RidingSlotHorseListItem's own
  // schema comment), so a DB-wide uniqueness claim would be misleading.
  const horseKeyCounts = new Map<string, number>();
  for (const item of deduped) {
    const key = `${item.groupName ?? ""}::${item.subgroupNumber ?? ""}::${item.horseName.toLowerCase()}`;
    horseKeyCounts.set(key, (horseKeyCounts.get(key) ?? 0) + 1);
  }
  if (Array.from(horseKeyCounts.values()).some((count) => count > 1)) {
    return { success: false, error: DUPLICATE_HORSE_IN_SUBGROUP };
  }

  // RIDING-PAIRS P2 mutual-exclusivity guard - txResult.ok mirrors the same
  // discriminated-transaction-result convention already used by
  // publishRidingHorseListToInstructorsInternal in
  // riding-slot-horse-publications.ts, rather than throwing. The guard check
  // and the list write happen inside ONE transaction (never relying only on
  // a pre-transaction read), guarded by the same Postgres advisory
  // transaction lock (keyed by ridingSlotId) that
  // createComplexPlanInternal in lib/actions/riding-slot-complex.ts takes as
  // its own first statement - transaction-scoped (not session-scoped), so
  // it is safe under Supabase's pooled connections and fully serializes any
  // concurrent create-simple-list / create-complex-plan attempt for this
  // exact ridingSlotId. Applies to every save (both first creation and
  // later updates), not just creation, since a complex plan must never
  // coexist with this list regardless of how the list came to exist.
  // Waiting on the advisory lock below counts against this transaction's
  // normal interactive-transaction timeout (Prisma default 5000ms). No
  // custom timeout is added here (this transaction's own work is a handful
  // of point reads/writes, not a long loop like
  // teaching-practice-child-import.ts's explicit 30s case) - if two callers
  // contend for the same ridingSlotId for more than 5s, the loser gets a
  // P2028 timeout, caught below and mapped to a clear Hebrew message (same
  // duck-typed error-code check already used for P2002 in
  // lib/actions/weekly-feedback.ts), never a raw Prisma error.
  try {
    const txResult = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${data.ridingSlotId}))`;

      const complexPlan = await tx.ridingSlotComplexPlan.findUnique({
        where: { ridingSlotId: data.ridingSlotId },
        select: { id: true },
      });
      if (complexPlan) {
        return { ok: false as const };
      }

      const existing = await tx.ridingSlotHorseList.findUnique({
        where: { ridingSlotId: data.ridingSlotId },
      });
      const actorData = {
        updatedByInstructorId: actor.instructorId,
        updatedByAdminEmail: actor.adminEmail,
        updatedByAdminName: actor.adminName,
        updatedByName: actor.displayName,
      };

      const list = existing
        ? await tx.ridingSlotHorseList.update({
            where: { id: existing.id },
            data: { version: { increment: 1 }, ...actorData },
          })
        : await tx.ridingSlotHorseList.create({
            data: { ridingSlotId: data.ridingSlotId, version: 1, ...actorData },
          });

      await tx.ridingSlotHorseListItem.deleteMany({ where: { listId: list.id } });
      if (deduped.length > 0) {
        await tx.ridingSlotHorseListItem.createMany({
          data: deduped.map((item) => ({
            listId: list.id,
            groupName: item.groupName,
            subgroupNumber: item.subgroupNumber,
            studentId: item.studentId,
            horseName: item.horseName,
          })),
        });
      }

      return { ok: true as const, list };
    });

    if (!txResult.ok) {
      return { success: false, error: COMPLEX_PLAN_EXISTS };
    }
    const savedList = txResult.list;

    // Publications are never touched here - just read for the caller's
    // read-only status display (e.g. a later stage's "stale" banner).
    const publications = await prisma.ridingSlotHorsePublication.findMany({
      where: { horseListId: savedList.id },
      select: { sourceVersion: true },
    });

    revalidatePath("/admin/weekly-schedule");
    revalidatePath("/instructor");

    return {
      success: true,
      status: {
        ridingSlotId: data.ridingSlotId,
        listId: savedList.id,
        version: savedList.version,
        updatedAt: savedList.updatedAt.toISOString(),
        updatedByName: savedList.updatedByName,
        items: deduped.map((item) => ({
          groupName: item.groupName,
          subgroupNumber: item.subgroupNumber,
          studentId: item.studentId,
          studentName: item.studentId ? (rosterByStudentId.get(item.studentId)?.studentName ?? null) : null,
          horseName: item.horseName,
        })),
        hasPublications: publications.length > 0,
        hasStalePublication: publications.some((p) => p.sourceVersion < savedList.version),
      },
    };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2028") {
      return { success: false, error: LOCK_TIMEOUT };
    }
    throw err;
  }
}

export async function saveRidingSlotHorseListAsAdmin(
  input: RidingSlotHorseListSaveInput
): Promise<RidingSlotHorseListSaveResult> {
  const admin = await requireAdmin();
  return saveRidingSlotHorseListInternal(input, {
    instructorId: null,
    adminEmail: admin.email,
    adminName: admin.name ?? null,
    displayName: admin.name ?? admin.email,
  });
}

// Instructors have no NextAuth session in this app (see requireAdmin), so
// this re-reads isActive/canEditRidingNotes from the DB by instructorId on
// every call - it never trusts a client-supplied boolean. No new permission
// is introduced; this reuses the same flag that already gates
// upsertRidingLessonNoteAsInstructor.
export async function saveRidingSlotHorseListAsInstructor(
  instructorId: string,
  input: RidingSlotHorseListSaveInput
): Promise<RidingSlotHorseListSaveResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return saveRidingSlotHorseListInternal(input, {
    instructorId: instructor.id,
    adminEmail: null,
    adminName: null,
    displayName: instructor.fullName,
  });
}
