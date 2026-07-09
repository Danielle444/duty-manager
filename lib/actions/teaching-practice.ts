"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey, parseDateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";
import {
  addMinutesToTimeString,
  computeTeachingPracticeRotation,
  TEACHING_PRACTICE_DURATION_MINUTES,
  TEACHING_PRACTICE_TEAM_SIZE,
  type TeachingPracticeRoleValue,
  type TeachingPracticeTypeValue,
} from "@/lib/teaching-practice-rotation";
import {
  attachTeachingPracticeScheduleWarnings,
  type TeachingPracticeScheduleWarning,
} from "@/lib/teaching-practice-schedule-check";

// Deliberately not re-exported from here: this is a "use server" module, and
// Next.js's server-actions transform scans every export to build a client
// reference stub for it - a type-only `export type { ... }` has no runtime
// value at all, but the transform still tried to wrap it, producing a
// reference to a binding that was never actually defined at runtime
// ("TeachingPracticeRoleValue is not defined"). Consumers must import these
// two types directly from lib/teaching-practice-rotation instead.

const NOT_FOUND_TRACK = "מסלול ההתנסות לא נמצא";
const NOT_FOUND_LESSON = "שיעור ההתנסות לא נמצא";
const NOT_FOUND_CHILD = "הילד/ה לא נמצא/ת";
const NOT_FOUND_PARTICIPANT = "החניך/ה בהתנסות לא נמצא/ה";
const NO_ASSIGNMENT_PERMISSION = "אין הרשאה לניהול שיבוצי התנסויות מתחילים";
const NO_HORSE_PERMISSION = "אין הרשאה לניהול סוסים וציוד להתנסויות מתחילים";
const NO_FEEDBACK_PERMISSION = "אין הרשאה לערוך משוב התנסויות מתחילים";
const INVALID_RATING = "דירוג לא תקין - יש לבחור ערך בין 1 ל-5";

const VALID_PRACTICE_TYPES: TeachingPracticeTypeValue[] = ["LUNGE", "BEGINNER_PRIVATE", "BEGINNER_GROUP"];
const VALID_ROLES: TeachingPracticeRoleValue[] = [
  "LEAD_INSTRUCTOR",
  "SECOND_INSTRUCTOR",
  "ASSISTANT_INSTRUCTOR",
  "EVALUATOR",
];

// Defensive parse for both directions: reading back whatever's stored in the
// roleLabelOverrides JSON column, and validating client input before saving.
// Only known TeachingPracticeRoleValue keys with a non-empty trimmed string
// value survive - unknown keys, non-string values, and blank strings (which
// mean "reset to default") are all dropped rather than stored. Returns null
// (not {}) when nothing survives, so an empty override set is stored/read as
// "no override" rather than an empty-but-present JSON object.
function sanitizeRoleLabelOverrides(value: unknown): Partial<Record<TeachingPracticeRoleValue, string>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Partial<Record<TeachingPracticeRoleValue, string>> = {};
  for (const role of VALID_ROLES) {
    const raw = (value as Record<string, unknown>)[role];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed) result[role] = trimmed;
  }
  return Object.keys(result).length > 0 ? result : null;
}

// Students have no NextAuth session in this app, so ownership/permission is
// always re-verified by re-reading the instructor row and its
// canManageTeachingPracticeAssignments flag - same convention as
// upsertRidingLessonNoteAsInstructor. Shared by every "assignments"-gated
// write action below; the two dual-permission actions (track/lesson child
// fields) inline their own check instead, since they also need to inspect
// canManageTeachingPracticeHorses conditionally.
async function getInstructorForAssignmentWrite(instructorId: string) {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canManageTeachingPracticeAssignments) {
    return null;
  }
  return instructor;
}

function horseFieldsChanged(
  prevHorseName: string | null,
  prevEquipmentNotes: string | null,
  nextHorseName: string | null,
  nextEquipmentNotes: string | null
): boolean {
  return prevHorseName !== nextHorseName || prevEquipmentNotes !== nextEquipmentNotes;
}

// ---------------------------------------------------------------------------
// Tracks - read
// ---------------------------------------------------------------------------

export interface TeachingPracticeTrackTraineeRow {
  traineeId: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  rotationOrder: number;
}

export interface TeachingPracticeTrackChildRow {
  // Null means "childless horse/equipment placeholder" (Approach A) - a row
  // that exists only to hold horseName/equipmentNotes before a child is
  // known/chosen yet. At most one such row per track (see the partial
  // unique index in the migration).
  childId: string | null;
  fullName: string | null;
  isActive: boolean;
  horseName: string | null;
  equipmentNotes: string | null;
}

export interface TeachingPracticeTrackSummary {
  id: string;
  practiceType: TeachingPracticeTypeValue;
  groupName: string | null;
  weekday: number | null;
  defaultStartTime: string;
  defaultEndTime: string;
  defaultLocation: string | null;
  defaultResponsibleInstructorId: string | null;
  defaultResponsibleInstructorName: string | null;
  // Only ever set on a BEGINNER_PRIVATE track - the BEGINNER_GROUP track its
  // child eventually joins. The UI derives the linked track's own time (and,
  // for a group track, every private track linking to it) by cross-
  // referencing the already-loaded track list client-side - no extra fields
  // needed here beyond the raw id.
  groupTrackId: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  trainees: TeachingPracticeTrackTraineeRow[];
  children: TeachingPracticeTrackChildRow[];
  lessonCount: number;
}

const TRACK_INCLUDE = {
  defaultResponsibleInstructor: { select: { fullName: true } },
  trainees: {
    orderBy: { rotationOrder: "asc" as const },
    include: { trainee: { select: { fullName: true, groupName: true, subgroupNumber: true } } },
  },
  children: {
    include: { child: { select: { fullName: true, isActive: true } } },
  },
  _count: { select: { lessons: true } },
};

type TrackWithIncludes = Awaited<
  ReturnType<typeof prisma.teachingPracticeTrack.findFirstOrThrow<{ include: typeof TRACK_INCLUDE }>>
>;

function toTrackSummary(track: TrackWithIncludes): TeachingPracticeTrackSummary {
  return {
    id: track.id,
    practiceType: track.practiceType,
    groupName: track.groupName,
    weekday: track.weekday,
    defaultStartTime: track.defaultStartTime,
    defaultEndTime: track.defaultEndTime,
    defaultLocation: track.defaultLocation,
    defaultResponsibleInstructorId: track.defaultResponsibleInstructorId,
    defaultResponsibleInstructorName: track.defaultResponsibleInstructor?.fullName ?? null,
    groupTrackId: track.groupTrackId,
    notes: track.notes,
    isActive: track.isActive,
    createdAt: track.createdAt.toISOString(),
    updatedAt: track.updatedAt.toISOString(),
    trainees: track.trainees.map((t) => ({
      traineeId: t.traineeId,
      fullName: t.trainee.fullName,
      groupName: t.trainee.groupName,
      subgroupNumber: t.trainee.subgroupNumber,
      rotationOrder: t.rotationOrder,
    })),
    children: track.children.map((c) => ({
      childId: c.childId,
      fullName: c.child?.fullName ?? null,
      isActive: c.child?.isActive ?? true,
      horseName: c.horseName,
      equipmentNotes: c.equipmentNotes,
    })),
    lessonCount: track._count.lessons,
  };
}

async function listTeachingPracticeTracksInternal(): Promise<TeachingPracticeTrackSummary[]> {
  const tracks = await prisma.teachingPracticeTrack.findMany({
    include: TRACK_INCLUDE,
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  return tracks.map(toTrackSummary);
}

export async function listTeachingPracticeTracksForAdmin(): Promise<TeachingPracticeTrackSummary[]> {
  await requireAdmin();
  return listTeachingPracticeTracksInternal();
}

// All active instructors can view every track, regardless of permission
// flags - matches "view always unrestricted, edit gated" (e.g.
// getRidingSlotStudentNotes).
export async function listTeachingPracticeTracksForInstructor(
  instructorId: string
): Promise<TeachingPracticeTrackSummary[]> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive) return [];
  return listTeachingPracticeTracksInternal();
}

// ---------------------------------------------------------------------------
// Tracks - create / update / activate
// ---------------------------------------------------------------------------

// The only two real course groups (matches Student.groupName's existing
// values and the same fixed-choice convention already used for group in
// lib/actions/riding-slots.ts's bulkAssignmentInputSchema) - free text was
// replaced with this closed set so the group reliably filters trainee
// options and can't drift from what Student.groupName actually contains.
const VALID_GROUP_NAMES = ["א", "ב"];

export interface TeachingPracticeTrackInput {
  practiceType: TeachingPracticeTypeValue;
  groupName?: string | null;
  weekday?: number | null;
  // No defaultEndTime here - the manager only ever supplies a start time;
  // the end time is always derived server-side (see validateTrackInput),
  // never accepted from the client.
  defaultStartTime: string;
  defaultLocation?: string | null;
  defaultResponsibleInstructorId?: string | null;
  // Only meaningful when practiceType is BEGINNER_PRIVATE - see
  // validateGroupTrackLink. Silently ignored (must be null) for every other
  // practiceType.
  groupTrackId?: string | null;
  notes?: string | null;
}

export interface TeachingPracticeTrackActionResult extends ActionResult {
  trackId?: string;
}

function validateTrackInput(
  input: TeachingPracticeTrackInput
):
  | { error: string }
  | {
      data: {
        practiceType: TeachingPracticeTypeValue;
        groupName: string | null;
        weekday: number | null;
        defaultStartTime: string;
        defaultEndTime: string;
        defaultLocation: string | null;
        notes: string | null;
      };
    } {
  if (!VALID_PRACTICE_TYPES.includes(input.practiceType)) {
    return { error: "סוג התנסות לא תקין" };
  }
  const defaultStartTime = input.defaultStartTime?.trim();
  if (!defaultStartTime) return { error: "יש להזין שעת התחלה" };

  const groupName = input.groupName?.trim() || null;
  if (groupName !== null && !VALID_GROUP_NAMES.includes(groupName)) {
    return { error: "קבוצה לא תקינה - יש לבחור קבוצה א, קבוצה ב, או ללא קבוצה" };
  }

  if (
    input.weekday != null &&
    (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6)
  ) {
    return { error: "יום בשבוע לא תקין" };
  }

  // Duration is fixed per practiceType - always derived here, never taken
  // from the client, so defaultEndTime can never drift from practiceType.
  const defaultEndTime = addMinutesToTimeString(
    defaultStartTime,
    TEACHING_PRACTICE_DURATION_MINUTES[input.practiceType]
  );
  if (!defaultEndTime) return { error: "שעת התחלה לא תקינה" };

  return {
    data: {
      practiceType: input.practiceType,
      groupName,
      weekday: input.weekday ?? null,
      defaultStartTime,
      defaultEndTime,
      defaultLocation: input.defaultLocation?.trim() || null,
      notes: input.notes?.trim() || null,
    },
  };
}

// Re-checked fresh from the DB on every call (never trusted from the input)
// - a responsible instructor must be a real, currently-active Instructor.
async function validateResponsibleInstructor(
  responsibleInstructorId: string | null | undefined
): Promise<{ error: string } | { id: string | null }> {
  if (!responsibleInstructorId) return { id: null };
  const instructor = await prisma.instructor.findUnique({ where: { id: responsibleInstructorId } });
  if (!instructor || !instructor.isActive) {
    return { error: "המדריך/ה האחראי/ת שנבחר/ה לא נמצא/ת או אינו/ה פעיל/ה" };
  }
  return { id: instructor.id };
}

// Re-checked fresh from the DB on every call - groupTrackId may only be set
// on a BEGINNER_PRIVATE track and must point to a real, existing
// BEGINNER_GROUP track, never to itself. A groupName mismatch between the
// two tracks is intentionally NOT rejected here - it's surfaced only as a
// UI-level advisory, since an admin may have a deliberate reason to
// cross-link groups; this stays a hard validation only for practiceType
// and existence/self-link, per product direction.
async function validateGroupTrackLink(
  practiceType: TeachingPracticeTypeValue,
  groupTrackId: string | null | undefined,
  ownTrackId: string | null
): Promise<{ error: string } | { id: string | null }> {
  if (!groupTrackId) return { id: null };

  if (practiceType !== "BEGINNER_PRIVATE") {
    return { error: "שיוך לשיעור קבוצתי אפשרי רק עבור שיעור פרטי מתחילים" };
  }
  if (ownTrackId && groupTrackId === ownTrackId) {
    return { error: "לא ניתן לשייך סלוט לעצמו" };
  }

  const groupTrack = await prisma.teachingPracticeTrack.findUnique({ where: { id: groupTrackId } });
  if (!groupTrack || groupTrack.practiceType !== "BEGINNER_GROUP") {
    return { error: "הסלוט המקושר חייב להיות שיעור קבוצתי מתחילים קיים" };
  }

  return { id: groupTrack.id };
}

async function createTeachingPracticeTrackInternal(
  input: TeachingPracticeTrackInput
): Promise<TeachingPracticeTrackActionResult> {
  const validated = validateTrackInput(input);
  if ("error" in validated) return { success: false, error: validated.error };

  const responsible = await validateResponsibleInstructor(input.defaultResponsibleInstructorId);
  if ("error" in responsible) return { success: false, error: responsible.error };

  const groupTrackLink = await validateGroupTrackLink(input.practiceType, input.groupTrackId, null);
  if ("error" in groupTrackLink) return { success: false, error: groupTrackLink.error };

  const track = await prisma.teachingPracticeTrack.create({
    data: {
      ...validated.data,
      defaultResponsibleInstructorId: responsible.id,
      groupTrackId: groupTrackLink.id,
    },
  });

  return { success: true, trackId: track.id };
}

export async function createTeachingPracticeTrackAsAdmin(
  input: TeachingPracticeTrackInput
): Promise<TeachingPracticeTrackActionResult> {
  await requireAdmin();
  return createTeachingPracticeTrackInternal(input);
}

export async function createTeachingPracticeTrackAsInstructor(
  instructorId: string,
  input: TeachingPracticeTrackInput
): Promise<TeachingPracticeTrackActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return createTeachingPracticeTrackInternal(input);
}

async function updateTeachingPracticeTrackInternal(
  trackId: string,
  input: TeachingPracticeTrackInput
): Promise<ActionResult> {
  const track = await prisma.teachingPracticeTrack.findUnique({ where: { id: trackId } });
  if (!track) return { success: false, error: NOT_FOUND_TRACK };

  const validated = validateTrackInput(input);
  if ("error" in validated) return { success: false, error: validated.error };

  const responsible = await validateResponsibleInstructor(input.defaultResponsibleInstructorId);
  if ("error" in responsible) return { success: false, error: responsible.error };

  const groupTrackLink = await validateGroupTrackLink(input.practiceType, input.groupTrackId, trackId);
  if ("error" in groupTrackLink) return { success: false, error: groupTrackLink.error };

  await prisma.teachingPracticeTrack.update({
    where: { id: trackId },
    data: {
      ...validated.data,
      defaultResponsibleInstructorId: responsible.id,
      groupTrackId: groupTrackLink.id,
    },
  });

  return { success: true };
}

export async function updateTeachingPracticeTrackAsAdmin(
  trackId: string,
  input: TeachingPracticeTrackInput
): Promise<ActionResult> {
  await requireAdmin();
  return updateTeachingPracticeTrackInternal(trackId, input);
}

export async function updateTeachingPracticeTrackAsInstructor(
  instructorId: string,
  trackId: string,
  input: TeachingPracticeTrackInput
): Promise<ActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return updateTeachingPracticeTrackInternal(trackId, input);
}

// ---------------------------------------------------------------------------
// Beginner group block - one BEGINNER_GROUP track + N linked BEGINNER_PRIVATE
// tracks, created together
// ---------------------------------------------------------------------------

const DEFAULT_BEGINNER_GROUP_BLOCK_PRIVATE_COUNT = 3;
const MAX_BEGINNER_GROUP_BLOCK_PRIVATE_COUNT = 6;

export interface TeachingPracticeGroupBlockInput {
  groupName: string;
  weekday?: number | null;
  groupStartTime: string;
  privateStartTime: string;
  defaultLocation?: string | null;
  defaultResponsibleInstructorId?: string | null;
  notes?: string | null;
  privateCount?: number;
}

export interface TeachingPracticeGroupBlockActionResult extends ActionResult {
  groupTrackId?: string;
  privateTrackIds?: string[];
}

// A server action (not client orchestration) precisely because the private
// tracks need the group track's freshly-created id, and because a
// transaction is the only way to avoid a half-created block (group track
// committed, some but not all private tracks committed) if something fails
// partway through - client-side sequential calls could leave exactly that
// inconsistent state on a mid-loop failure. All rows are created in one
// prisma.$transaction: either the whole block exists, or none of it does.
async function createTeachingPracticeGroupBlockInternal(
  input: TeachingPracticeGroupBlockInput
): Promise<TeachingPracticeGroupBlockActionResult> {
  const groupName = input.groupName?.trim() || null;
  if (!groupName || !VALID_GROUP_NAMES.includes(groupName)) {
    return { success: false, error: "יש לבחור קבוצה א או קבוצה ב עבור בלוק שיעור קבוצתי" };
  }

  const privateCount = Math.min(
    MAX_BEGINNER_GROUP_BLOCK_PRIVATE_COUNT,
    Math.max(1, Math.trunc(input.privateCount ?? DEFAULT_BEGINNER_GROUP_BLOCK_PRIVATE_COUNT) || 1)
  );

  const groupValidated = validateTrackInput({
    practiceType: "BEGINNER_GROUP",
    groupName,
    weekday: input.weekday,
    defaultStartTime: input.groupStartTime,
    defaultLocation: input.defaultLocation,
    notes: input.notes,
  });
  if ("error" in groupValidated) return { success: false, error: groupValidated.error };

  const privateValidated = validateTrackInput({
    practiceType: "BEGINNER_PRIVATE",
    groupName,
    weekday: input.weekday,
    defaultStartTime: input.privateStartTime,
    defaultLocation: input.defaultLocation,
    notes: input.notes,
  });
  if ("error" in privateValidated) return { success: false, error: privateValidated.error };

  const responsible = await validateResponsibleInstructor(input.defaultResponsibleInstructorId);
  if ("error" in responsible) return { success: false, error: responsible.error };

  const created = await prisma.$transaction(async (tx) => {
    const groupTrack = await tx.teachingPracticeTrack.create({
      data: { ...groupValidated.data, defaultResponsibleInstructorId: responsible.id },
    });

    const privateTrackIds: string[] = [];
    for (let i = 0; i < privateCount; i++) {
      const privateTrack = await tx.teachingPracticeTrack.create({
        data: {
          ...privateValidated.data,
          defaultResponsibleInstructorId: responsible.id,
          groupTrackId: groupTrack.id,
        },
      });
      privateTrackIds.push(privateTrack.id);
    }

    return { groupTrackId: groupTrack.id, privateTrackIds };
  });

  return { success: true, ...created };
}

export async function createTeachingPracticeGroupBlockAsAdmin(
  input: TeachingPracticeGroupBlockInput
): Promise<TeachingPracticeGroupBlockActionResult> {
  await requireAdmin();
  return createTeachingPracticeGroupBlockInternal(input);
}

export async function createTeachingPracticeGroupBlockAsInstructor(
  instructorId: string,
  input: TeachingPracticeGroupBlockInput
): Promise<TeachingPracticeGroupBlockActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return createTeachingPracticeGroupBlockInternal(input);
}

async function setTeachingPracticeTrackActiveInternal(
  trackId: string,
  isActive: boolean
): Promise<ActionResult> {
  const track = await prisma.teachingPracticeTrack.findUnique({ where: { id: trackId } });
  if (!track) return { success: false, error: NOT_FOUND_TRACK };
  await prisma.teachingPracticeTrack.update({ where: { id: trackId }, data: { isActive } });
  return { success: true };
}

export async function setTeachingPracticeTrackActiveAsAdmin(
  trackId: string,
  isActive: boolean
): Promise<ActionResult> {
  await requireAdmin();
  return setTeachingPracticeTrackActiveInternal(trackId, isActive);
}

export async function setTeachingPracticeTrackActiveAsInstructor(
  instructorId: string,
  trackId: string,
  isActive: boolean
): Promise<ActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return setTeachingPracticeTrackActiveInternal(trackId, isActive);
}

// ---------------------------------------------------------------------------
// Track deletion - only ever allowed when the track is genuinely empty, so
// a delete can never silently destroy real assignment data. Deactivating
// (isActive above) remains the normal way to retire a track that has
// history; delete is only for cleaning up a mistake before anything real
// was attached to it.
// ---------------------------------------------------------------------------

async function deleteTeachingPracticeTrackInternal(trackId: string): Promise<ActionResult> {
  const track = await prisma.teachingPracticeTrack.findUnique({
    where: { id: trackId },
    include: {
      _count: { select: { lessons: true, trainees: true, children: true, feedingPrivateTracks: true } },
    },
  });
  if (!track) return { success: false, error: NOT_FOUND_TRACK };

  if (track._count.lessons > 0) {
    return { success: false, error: "לא ניתן למחוק סלוט שכבר נוצרו ממנו שיעורים" };
  }
  if (track._count.trainees > 0) {
    return { success: false, error: "לא ניתן למחוק סלוט עם צוות חניכים משובץ - יש להסיר את הצוות תחילה" };
  }
  if (track._count.children > 0) {
    return { success: false, error: "לא ניתן למחוק סלוט עם ילדים משובצים - יש להסיר את הילדים תחילה" };
  }
  if (track._count.feedingPrivateTracks > 0) {
    return {
      success: false,
      error:
        "לא ניתן למחוק שיעור קבוצתי שיש לו שיעורים פרטיים משויכים אליו - יש לבטל את השיוך או למחוק אותם תחילה",
    };
  }

  await prisma.teachingPracticeTrack.delete({ where: { id: trackId } });
  return { success: true };
}

export async function deleteTeachingPracticeTrackAsAdmin(trackId: string): Promise<ActionResult> {
  await requireAdmin();
  return deleteTeachingPracticeTrackInternal(trackId);
}

export async function deleteTeachingPracticeTrackAsInstructor(
  instructorId: string,
  trackId: string
): Promise<ActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return deleteTeachingPracticeTrackInternal(trackId);
}

// ---------------------------------------------------------------------------
// Track trainee team management (replace-all)
// ---------------------------------------------------------------------------

async function setTeachingPracticeTrackTraineesInternal(
  trackId: string,
  traineeIdsInRotationOrder: string[]
): Promise<ActionResult> {
  const track = await prisma.teachingPracticeTrack.findUnique({ where: { id: trackId } });
  if (!track) return { success: false, error: NOT_FOUND_TRACK };

  const uniqueIds = new Set(traineeIdsInRotationOrder);
  if (uniqueIds.size !== traineeIdsInRotationOrder.length) {
    return { success: false, error: "לא ניתן לשבץ אותו חניך/ה יותר מפעם אחת בצוות" };
  }

  // Partial teams are allowed here on purpose - the fixed-structure tables
  // assign trainees one role-cell at a time (מדריך ראשון first, מדריך שני
  // later, etc.), so this action must accept 0..expectedSize trainees, not
  // only a complete team. A complete team is only required later, at lesson
  // generation time (generateTeachingPracticeLessonFromTrackInternal), which
  // still enforces the exact size unchanged.
  const expectedSize = TEACHING_PRACTICE_TEAM_SIZE[track.practiceType];
  if (traineeIdsInRotationOrder.length > expectedSize) {
    return {
      success: false,
      error:
        track.practiceType === "BEGINNER_GROUP"
          ? "התנסות מתחילים קבוצתית תומכת בעד 3 חניכים בצוות"
          : "התנסות זו תומכת בעד 2 חניכים בצוות",
    };
  }

  if (traineeIdsInRotationOrder.length > 0) {
    const trainees = await prisma.student.findMany({
      where: { id: { in: traineeIdsInRotationOrder } },
    });
    if (trainees.length !== traineeIdsInRotationOrder.length) {
      return { success: false, error: "אחד או יותר מהחניכים שנבחרו לא נמצאו" };
    }
    if (trainees.some((t) => !t.isActive)) {
      return { success: false, error: "לא ניתן לשבץ חניך/ה שאינו/ה פעיל/ה" };
    }
  }

  await prisma.$transaction([
    prisma.teachingPracticeTrackTrainee.deleteMany({ where: { trackId } }),
    prisma.teachingPracticeTrackTrainee.createMany({
      data: traineeIdsInRotationOrder.map((traineeId, index) => ({
        trackId,
        traineeId,
        rotationOrder: index,
      })),
    }),
  ]);

  if (traineeIdsInRotationOrder.length === expectedSize) {
    await syncTeachingPracticeTrackParticipants(trackId);
  }

  return { success: true };
}

// Fills in participants for lessons that were generated before the track's
// team was complete (or before a prior roster change), now that the team is
// exactly expectedSize. Only called once the roster reaches full size -
// never for a partial team, since rotation math requires an exact count.
//
// A lesson is only touched if none of its current participants are
// isManualOverride - one hand-edited row is enough to skip the whole lesson,
// so a manual fix is never silently clobbered by a later roster change.
// occurrenceIndex is recomputed per lesson from chronological lesson order
// (date, then startTime, then createdAt/id as a stable tiebreaker) rather
// than creation order, since dates can be generated/added out of order and
// the rotation must follow the actual schedule, not the order they were
// entered in.
async function syncTeachingPracticeTrackParticipants(trackId: string): Promise<void> {
  const track = await prisma.teachingPracticeTrack.findUnique({
    where: { id: trackId },
    include: { trainees: { orderBy: { rotationOrder: "asc" } } },
  });
  if (!track) return;

  const expectedSize = TEACHING_PRACTICE_TEAM_SIZE[track.practiceType];
  if (track.trainees.length !== expectedSize) return;

  const traineeInput = track.trainees.map((t) => ({ traineeId: t.traineeId, rotationOrder: t.rotationOrder }));

  const lessons = await prisma.teachingPracticeLesson.findMany({
    where: { trackId },
    orderBy: [{ date: "asc" }, { startTime: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: { participants: { include: { feedback: true } } },
  });

  for (let occurrenceIndex = 0; occurrenceIndex < lessons.length; occurrenceIndex++) {
    const lesson = lessons[occurrenceIndex];
    if (lesson.participants.some((p) => p.isManualOverride)) continue;
    // Same safety rule as the manual participant-edit path: never delete/recreate
    // participants that already have feedback recorded against them.
    if (lesson.participants.some((p) => p.feedback)) continue;

    let roleAssignments: { traineeId: string; role: TeachingPracticeRoleValue }[];
    try {
      roleAssignments = computeTeachingPracticeRotation(track.practiceType, traineeInput, occurrenceIndex);
    } catch {
      continue;
    }

    await prisma.$transaction([
      prisma.teachingPracticeParticipant.deleteMany({ where: { lessonId: lesson.id } }),
      prisma.teachingPracticeParticipant.createMany({
        data: roleAssignments.map((r) => ({
          lessonId: lesson.id,
          traineeId: r.traineeId,
          role: r.role,
          isManualOverride: false,
        })),
      }),
    ]);
  }
}

export async function setTeachingPracticeTrackTraineesAsAdmin(
  trackId: string,
  traineeIdsInRotationOrder: string[]
): Promise<ActionResult> {
  await requireAdmin();
  return setTeachingPracticeTrackTraineesInternal(trackId, traineeIdsInRotationOrder);
}

export async function setTeachingPracticeTrackTraineesAsInstructor(
  instructorId: string,
  trackId: string,
  traineeIdsInRotationOrder: string[]
): Promise<ActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return setTeachingPracticeTrackTraineesInternal(trackId, traineeIdsInRotationOrder);
}

// ---------------------------------------------------------------------------
// Track children / default horse+equipment management (replace-all)
// ---------------------------------------------------------------------------

export interface TeachingPracticeTrackChildInput {
  // Null means "save this row as a childless horse/equipment placeholder" -
  // see TeachingPracticeTrackChildRow.
  childId: string | null;
  horseName?: string | null;
  equipmentNotes?: string | null;
}

async function setTeachingPracticeTrackChildrenInternal(
  trackId: string,
  childrenInput: TeachingPracticeTrackChildInput[]
): Promise<ActionResult> {
  const track = await prisma.teachingPracticeTrack.findUnique({ where: { id: trackId } });
  if (!track) return { success: false, error: NOT_FOUND_TRACK };

  // Defensive normalization (mirrors the same rule enforced client-side in
  // handleInlineEditTrackChildField): a childless row with no horse/
  // equipment text either is a blank row, not a real placeholder - dropped
  // here too so no caller can ever persist a fully empty
  // TeachingPracticeTrackChild row.
  const children = childrenInput.filter(
    (c) => c.childId !== null || (c.horseName?.trim() || "") !== "" || (c.equipmentNotes?.trim() || "") !== ""
  );

  // At most one childless placeholder row per track (matches the DB-level
  // partial unique index) - checked separately from the real-childId dedupe
  // below so the error message is accurate either way.
  const nullChildCount = children.filter((c) => c.childId === null).length;
  if (nullChildCount > 1) {
    return { success: false, error: "ניתן לשמור לכל היותר שורת סוס/ציוד אחת ללא ילד/ה משויך/ת" };
  }

  const realChildIds = children.map((c) => c.childId).filter((id): id is string => id !== null);
  const uniqueChildIds = new Set(realChildIds);
  if (uniqueChildIds.size !== realChildIds.length) {
    return { success: false, error: "לא ניתן לשבץ אותו ילד/ה יותר מפעם אחת" };
  }

  // Childless rows skip the existence/active lookup entirely - there's no
  // childId to validate.
  if (realChildIds.length > 0) {
    const foundChildren = await prisma.teachingPracticeChild.findMany({
      where: { id: { in: realChildIds } },
    });
    if (foundChildren.length !== realChildIds.length) {
      return { success: false, error: "אחד או יותר מהילדים שנבחרו לא נמצאו" };
    }
    if (foundChildren.some((c) => !c.isActive)) {
      return { success: false, error: "לא ניתן לשבץ ילד/ה שאינו/ה פעיל/ה" };
    }
  }

  await prisma.$transaction([
    prisma.teachingPracticeTrackChild.deleteMany({ where: { trackId } }),
    prisma.teachingPracticeTrackChild.createMany({
      data: children.map((c) => ({
        trackId,
        childId: c.childId,
        horseName: c.horseName?.trim() || null,
        equipmentNotes: c.equipmentNotes?.trim() || null,
      })),
    }),
  ]);

  return { success: true };
}

export async function setTeachingPracticeTrackChildrenAsAdmin(
  trackId: string,
  children: TeachingPracticeTrackChildInput[]
): Promise<ActionResult> {
  await requireAdmin();
  return setTeachingPracticeTrackChildrenInternal(trackId, children);
}

// Child linkage itself needs canManageTeachingPracticeAssignments; the
// horseName/equipmentNotes fields specifically need
// canManageTeachingPracticeHorses too - checked by diffing against what's
// currently stored, so an instructor without the horse permission can still
// freely change *which* children are on the track as long as they leave
// every row's horse/equipment values exactly as they were.
export async function setTeachingPracticeTrackChildrenAsInstructor(
  instructorId: string,
  trackId: string,
  children: TeachingPracticeTrackChildInput[]
): Promise<ActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canManageTeachingPracticeAssignments) {
    return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  }

  if (!instructor.canManageTeachingPracticeHorses) {
    const existing = await prisma.teachingPracticeTrackChild.findMany({ where: { trackId } });
    const existingByChildId = new Map(existing.map((e) => [e.childId, e]));
    const changesHorseFields = children.some((c) => {
      const prev = existingByChildId.get(c.childId);
      const nextHorseName = c.horseName?.trim() || null;
      const nextEquipmentNotes = c.equipmentNotes?.trim() || null;
      return horseFieldsChanged(
        prev?.horseName ?? null,
        prev?.equipmentNotes ?? null,
        nextHorseName,
        nextEquipmentNotes
      );
    });
    if (changesHorseFields) return { success: false, error: NO_HORSE_PERMISSION };
  }

  return setTeachingPracticeTrackChildrenInternal(trackId, children);
}

// ---------------------------------------------------------------------------
// External children - CRUD
// ---------------------------------------------------------------------------

// No horse field here on purpose - the "ילדים" registry is identity/contact
// only. Horse/equipment is only ever set where it's actually assigned:
// TeachingPracticeTrackChild / TeachingPracticeChildAssignment.
// TeachingPracticeChild.defaultHorseName still exists in the schema but is
// intentionally left untouched by these actions (unused for now).
export interface TeachingPracticeChildInput {
  firstName: string;
  lastName: string;
  age?: number | null;
  gender?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  notes?: string | null;
}

export interface TeachingPracticeChildRow {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  age: number | null;
  gender: string | null;
  parentName: string | null;
  parentPhone: string | null;
  notes: string | null;
  defaultHorseName: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TeachingPracticeChildActionResult extends ActionResult {
  childId?: string;
}

function toChildRow(child: {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  age: number | null;
  gender: string | null;
  parentName: string | null;
  parentPhone: string | null;
  notes: string | null;
  defaultHorseName: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): TeachingPracticeChildRow {
  return {
    id: child.id,
    firstName: child.firstName,
    lastName: child.lastName,
    fullName: child.fullName,
    age: child.age,
    gender: child.gender,
    parentName: child.parentName,
    parentPhone: child.parentPhone,
    notes: child.notes,
    defaultHorseName: child.defaultHorseName,
    isActive: child.isActive,
    createdAt: child.createdAt.toISOString(),
    updatedAt: child.updatedAt.toISOString(),
  };
}

async function listTeachingPracticeChildrenInternal(): Promise<TeachingPracticeChildRow[]> {
  const children = await prisma.teachingPracticeChild.findMany({ orderBy: { fullName: "asc" } });
  return children.map(toChildRow);
}

export async function listTeachingPracticeChildrenForAdmin(): Promise<TeachingPracticeChildRow[]> {
  await requireAdmin();
  return listTeachingPracticeChildrenInternal();
}

export async function listTeachingPracticeChildrenForInstructor(
  instructorId: string
): Promise<TeachingPracticeChildRow[]> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive) return [];
  return listTeachingPracticeChildrenInternal();
}

function validateChildInput(
  input: TeachingPracticeChildInput
):
  | { error: string }
  | {
      data: {
        firstName: string;
        lastName: string;
        fullName: string;
        age: number | null;
        gender: string | null;
        parentName: string | null;
        parentPhone: string | null;
        notes: string | null;
      };
    } {
  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  if (!firstName) return { error: "יש להזין שם פרטי" };
  if (!lastName) return { error: "יש להזין שם משפחה" };
  if (input.age != null && (!Number.isInteger(input.age) || input.age < 0 || input.age > 120)) {
    return { error: "גיל לא תקין" };
  }

  return {
    data: {
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      age: input.age ?? null,
      gender: input.gender?.trim() || null,
      parentName: input.parentName?.trim() || null,
      parentPhone: input.parentPhone?.trim() || null,
      notes: input.notes?.trim() || null,
    },
  };
}

async function createTeachingPracticeChildInternal(
  input: TeachingPracticeChildInput
): Promise<TeachingPracticeChildActionResult> {
  const validated = validateChildInput(input);
  if ("error" in validated) return { success: false, error: validated.error };
  const child = await prisma.teachingPracticeChild.create({ data: validated.data });
  return { success: true, childId: child.id };
}

export async function createTeachingPracticeChildAsAdmin(
  input: TeachingPracticeChildInput
): Promise<TeachingPracticeChildActionResult> {
  await requireAdmin();
  return createTeachingPracticeChildInternal(input);
}

// Just canManageTeachingPracticeAssignments - child identity/contact fields
// have no horse-related field anymore, so there's nothing left here needing
// canManageTeachingPracticeHorses.
export async function createTeachingPracticeChildAsInstructor(
  instructorId: string,
  input: TeachingPracticeChildInput
): Promise<TeachingPracticeChildActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return createTeachingPracticeChildInternal(input);
}

async function updateTeachingPracticeChildInternal(
  childId: string,
  input: TeachingPracticeChildInput
): Promise<ActionResult> {
  const child = await prisma.teachingPracticeChild.findUnique({ where: { id: childId } });
  if (!child) return { success: false, error: NOT_FOUND_CHILD };

  const validated = validateChildInput(input);
  if ("error" in validated) return { success: false, error: validated.error };

  await prisma.teachingPracticeChild.update({ where: { id: childId }, data: validated.data });
  return { success: true };
}

export async function updateTeachingPracticeChildAsAdmin(
  childId: string,
  input: TeachingPracticeChildInput
): Promise<ActionResult> {
  await requireAdmin();
  return updateTeachingPracticeChildInternal(childId, input);
}

export async function updateTeachingPracticeChildAsInstructor(
  instructorId: string,
  childId: string,
  input: TeachingPracticeChildInput
): Promise<ActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return updateTeachingPracticeChildInternal(childId, input);
}

async function setTeachingPracticeChildActiveInternal(
  childId: string,
  isActive: boolean
): Promise<ActionResult> {
  const child = await prisma.teachingPracticeChild.findUnique({ where: { id: childId } });
  if (!child) return { success: false, error: NOT_FOUND_CHILD };
  await prisma.teachingPracticeChild.update({ where: { id: childId }, data: { isActive } });
  return { success: true };
}

export async function setTeachingPracticeChildActiveAsAdmin(
  childId: string,
  isActive: boolean
): Promise<ActionResult> {
  await requireAdmin();
  return setTeachingPracticeChildActiveInternal(childId, isActive);
}

export async function setTeachingPracticeChildActiveAsInstructor(
  instructorId: string,
  childId: string,
  isActive: boolean
): Promise<ActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return setTeachingPracticeChildActiveInternal(childId, isActive);
}

// ---------------------------------------------------------------------------
// Lessons - read
// ---------------------------------------------------------------------------

export interface TeachingPracticeLessonSummary {
  id: string;
  trackId: string | null;
  practiceType: TeachingPracticeTypeValue;
  date: string;
  startTime: string;
  endTime: string;
  groupName: string | null;
  location: string | null;
  responsibleInstructorId: string | null;
  responsibleInstructorName: string | null;
  notes: string | null;
  isPublished: boolean;
  participantCount: number;
  childCount: number;
  // Display-only per-role label overrides for this lesson's generated-lessons
  // table row (e.g. {"LEAD_INSTRUCTOR": "מדריך 1"}) - never read by
  // rotation/assignment/schedule-check/feedback logic. Missing/null role key
  // means "use the default ROLE_LABELS text" for that role.
  roleLabelOverrides: Partial<Record<TeachingPracticeRoleValue, string>> | null;
}

// Present only once an instructor/admin has actually saved feedback for this
// participant (Stage A - backend/read only, no entry UI yet) - null means no
// feedback recorded, same "missing row = not yet entered" convention as
// RidingLessonNote. updatedByName/updatedAt mirror TeachingPracticeFeedback's
// own columns; no other TeachingPracticeFeedback field is exposed here.
export interface TeachingPracticeParticipantFeedbackData {
  feedback: string | null;
  ratingHalfPoints: number | null;
  updatedByName: string | null;
  updatedAt: string;
}

export interface TeachingPracticeParticipantRow {
  participantId: string;
  traineeId: string;
  traineeName: string;
  role: TeachingPracticeRoleValue;
  isManualOverride: boolean;
  feedback: TeachingPracticeParticipantFeedbackData | null;
}

export interface TeachingPracticeChildAssignmentRow {
  id: string;
  childId: string;
  childFullName: string;
  childAge: number | null;
  childGender: string | null;
  parentName: string | null;
  parentPhone: string | null;
  horseName: string | null;
  equipmentNotes: string | null;
  isAbsent: boolean;
}

export interface TeachingPracticeLessonDetail extends TeachingPracticeLessonSummary {
  participants: TeachingPracticeParticipantRow[];
  childAssignments: TeachingPracticeChildAssignmentRow[];
}

export interface TeachingPracticeLessonFilters {
  dateFrom?: string;
  dateTo?: string;
  groupName?: string;
  practiceType?: TeachingPracticeTypeValue;
  isPublished?: boolean;
}

interface LessonBase {
  id: string;
  trackId: string | null;
  practiceType: TeachingPracticeTypeValue;
  date: Date;
  startTime: string;
  endTime: string;
  groupName: string | null;
  location: string | null;
  responsibleInstructorId: string | null;
  notes: string | null;
  isPublished: boolean;
  roleLabelOverrides: unknown;
}

function toLessonSummary(
  lesson: LessonBase & {
    responsibleInstructor: { fullName: string } | null;
    participantCount: number;
    childCount: number;
  }
): TeachingPracticeLessonSummary {
  return {
    id: lesson.id,
    trackId: lesson.trackId,
    practiceType: lesson.practiceType,
    date: dateKey(lesson.date),
    startTime: lesson.startTime,
    endTime: lesson.endTime,
    groupName: lesson.groupName,
    location: lesson.location,
    responsibleInstructorId: lesson.responsibleInstructorId,
    responsibleInstructorName: lesson.responsibleInstructor?.fullName ?? null,
    notes: lesson.notes,
    isPublished: lesson.isPublished,
    participantCount: lesson.participantCount,
    childCount: lesson.childCount,
    roleLabelOverrides: sanitizeRoleLabelOverrides(lesson.roleLabelOverrides),
  };
}

async function listTeachingPracticeLessonsInternal(
  filters?: TeachingPracticeLessonFilters
): Promise<TeachingPracticeLessonSummary[]> {
  const lessons = await prisma.teachingPracticeLesson.findMany({
    where: {
      ...(filters?.dateFrom || filters?.dateTo
        ? {
            date: {
              ...(filters?.dateFrom ? { gte: parseDateKey(filters.dateFrom) } : {}),
              ...(filters?.dateTo ? { lte: parseDateKey(filters.dateTo) } : {}),
            },
          }
        : {}),
      ...(filters?.groupName ? { groupName: filters.groupName } : {}),
      ...(filters?.practiceType ? { practiceType: filters.practiceType } : {}),
      ...(filters?.isPublished != null ? { isPublished: filters.isPublished } : {}),
    },
    include: {
      responsibleInstructor: { select: { fullName: true } },
      _count: { select: { participants: true, childAssignments: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  return lessons.map((lesson) =>
    toLessonSummary({
      ...lesson,
      participantCount: lesson._count.participants,
      childCount: lesson._count.childAssignments,
    })
  );
}

export async function listTeachingPracticeLessonsForAdmin(
  filters?: TeachingPracticeLessonFilters
): Promise<TeachingPracticeLessonSummary[]> {
  await requireAdmin();
  return listTeachingPracticeLessonsInternal(filters);
}

export async function listTeachingPracticeLessonsForInstructor(
  instructorId: string,
  filters?: TeachingPracticeLessonFilters
): Promise<TeachingPracticeLessonSummary[]> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive) return [];
  return listTeachingPracticeLessonsInternal(filters);
}

const LESSON_DETAIL_INCLUDE = {
  responsibleInstructor: { select: { fullName: true } },
  participants: {
    orderBy: { createdAt: "asc" as const },
    include: {
      trainee: { select: { fullName: true } },
      feedback: { select: { feedback: true, ratingHalfPoints: true, updatedByName: true, updatedAt: true } },
    },
  },
  childAssignments: {
    include: {
      child: { select: { fullName: true, age: true, gender: true, parentName: true, parentPhone: true } },
    },
  },
};

type LessonWithDetailIncludes = Awaited<
  ReturnType<typeof prisma.teachingPracticeLesson.findFirstOrThrow<{ include: typeof LESSON_DETAIL_INCLUDE }>>
>;

function toLessonDetail(lesson: LessonWithDetailIncludes): TeachingPracticeLessonDetail {
  return {
    ...toLessonSummary({
      ...lesson,
      participantCount: lesson.participants.length,
      childCount: lesson.childAssignments.length,
    }),
    participants: lesson.participants.map((p) => ({
      participantId: p.id,
      traineeId: p.traineeId,
      traineeName: p.trainee.fullName,
      role: p.role,
      isManualOverride: p.isManualOverride,
      feedback: p.feedback
        ? {
            feedback: p.feedback.feedback,
            ratingHalfPoints: p.feedback.ratingHalfPoints,
            updatedByName: p.feedback.updatedByName,
            updatedAt: p.feedback.updatedAt.toISOString(),
          }
        : null,
    })),
    childAssignments: lesson.childAssignments.map((c) => ({
      id: c.id,
      childId: c.childId,
      childFullName: c.child.fullName,
      childAge: c.child.age,
      childGender: c.child.gender,
      parentName: c.child.parentName,
      parentPhone: c.child.parentPhone,
      horseName: c.horseName,
      equipmentNotes: c.equipmentNotes,
      isAbsent: c.isAbsent,
    })),
  };
}

async function getTeachingPracticeLessonDetailInternal(
  lessonId: string
): Promise<TeachingPracticeLessonDetail | null> {
  const lesson = await prisma.teachingPracticeLesson.findUnique({
    where: { id: lessonId },
    include: LESSON_DETAIL_INCLUDE,
  });
  return lesson ? toLessonDetail(lesson) : null;
}

export async function getTeachingPracticeLessonDetailForAdmin(
  lessonId: string
): Promise<TeachingPracticeLessonDetail | null> {
  await requireAdmin();
  return getTeachingPracticeLessonDetailInternal(lessonId);
}

export async function getTeachingPracticeLessonDetailForInstructor(
  instructorId: string,
  lessonId: string
): Promise<TeachingPracticeLessonDetail | null> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive) return null;
  return getTeachingPracticeLessonDetailInternal(lessonId);
}

// One day's lessons, with participants/childAssignments already joined -
// used by the scheduled-lessons table view (Stage A), which needs trainee
// and child names up front for every lesson on the selected date rather
// than lazily per row. Scoped to a single date (not a range) so it stays
// cheap even as the lessons table grows.
async function listTeachingPracticeLessonsDetailForDateInternal(
  date: string
): Promise<TeachingPracticeLessonDetail[]> {
  const day = parseDateKey(date);
  const lessons = await prisma.teachingPracticeLesson.findMany({
    where: { date: day },
    include: LESSON_DETAIL_INCLUDE,
    orderBy: [{ startTime: "asc" }],
  });
  return lessons.map(toLessonDetail);
}

export async function listTeachingPracticeLessonsDetailForDateAsAdmin(
  date: string
): Promise<TeachingPracticeLessonDetail[]> {
  await requireAdmin();
  return listTeachingPracticeLessonsDetailForDateInternal(date);
}

export async function listTeachingPracticeLessonsDetailForDateAsInstructor(
  instructorId: string,
  date: string
): Promise<TeachingPracticeLessonDetail[]> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive) return [];
  return listTeachingPracticeLessonsDetailForDateInternal(date);
}

// ---------------------------------------------------------------------------
// Participant feedback (Stage A - actions only, no entry UI yet)
// ---------------------------------------------------------------------------

export interface TeachingPracticeFeedbackInput {
  ratingHalfPoints: number | null;
  feedback: string | null;
}

// One row per TeachingPracticeParticipant (participantId unique on the
// model) - always a full-overwrite upsert, no history, same convention as
// RidingLessonNote/upsertRidingLessonNoteAsInstructor. Never deletes/creates
// participants, lessons, child assignments, or horses - only ever touches
// the TeachingPracticeFeedback row itself.
async function upsertTeachingPracticeFeedbackInternal(
  participantId: string,
  input: TeachingPracticeFeedbackInput,
  updatedByName: string
): Promise<ActionResult> {
  const participant = await prisma.teachingPracticeParticipant.findUnique({ where: { id: participantId } });
  if (!participant) return { success: false, error: NOT_FOUND_PARTICIPANT };

  const ratingHalfPoints = input.ratingHalfPoints ?? null;
  if (
    ratingHalfPoints !== null &&
    (!Number.isInteger(ratingHalfPoints) || ratingHalfPoints < 2 || ratingHalfPoints > 10)
  ) {
    return { success: false, error: INVALID_RATING };
  }

  const feedback = input.feedback?.trim() || null;

  await prisma.teachingPracticeFeedback.upsert({
    where: { participantId },
    update: { feedback, ratingHalfPoints, updatedByName },
    create: { participantId, feedback, ratingHalfPoints, updatedByName },
  });

  return { success: true };
}

export async function upsertTeachingPracticeFeedbackAsAdmin(
  participantId: string,
  input: TeachingPracticeFeedbackInput
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const result = await upsertTeachingPracticeFeedbackInternal(participantId, input, admin.name ?? admin.email);
  if (result.success) revalidatePath("/admin/teaching-practice");
  return result;
}

// Re-fetches the instructor from the DB and checks canEditTeachingPracticeFeedback
// server-side - never trusts a client-supplied permission flag, same pattern
// as upsertRidingLessonNoteAsInstructor's canEditRidingNotes check.
export async function upsertTeachingPracticeFeedbackAsInstructor(
  instructorId: string,
  participantId: string,
  input: TeachingPracticeFeedbackInput
): Promise<ActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditTeachingPracticeFeedback) {
    return { success: false, error: NO_FEEDBACK_PERMISSION };
  }

  const result = await upsertTeachingPracticeFeedbackInternal(participantId, input, instructor.fullName);
  if (result.success) revalidatePath("/instructor");
  return result;
}

// ---------------------------------------------------------------------------
// Generate a lesson occurrence from a track
// ---------------------------------------------------------------------------

export interface TeachingPracticeGenerateLessonResult extends ActionResult {
  lesson?: TeachingPracticeLessonDetail;
}

async function generateTeachingPracticeLessonFromTrackInternal(
  trackId: string,
  dateKeyInput: string
): Promise<TeachingPracticeGenerateLessonResult> {
  const track = await prisma.teachingPracticeTrack.findUnique({
    where: { id: trackId },
    include: {
      trainees: { orderBy: { rotationOrder: "asc" } },
      children: true,
    },
  });
  if (!track) return { success: false, error: NOT_FOUND_TRACK };
  if (!track.isActive) return { success: false, error: "לא ניתן ליצור שיעור ממסלול לא פעיל" };

  const parsedDate = parseDateKey(dateKeyInput);
  if (Number.isNaN(parsedDate.getTime())) {
    return { success: false, error: "תאריך לא תקין" };
  }

  const expectedSize = TEACHING_PRACTICE_TEAM_SIZE[track.practiceType];
  const occurrenceIndex = await prisma.teachingPracticeLesson.count({ where: { trackId } });

  // A dated lesson can be created before the track's trainee team is
  // complete (fixed-schedule dates should not have to wait on assignment) -
  // an incomplete team just means no participants get materialized yet.
  // Rotation math itself only makes sense for a complete team, so it's only
  // invoked once the team is exactly expectedSize; setTeachingPracticeTrackTraineesInternal
  // auto-syncs participants into this lesson once that later happens.
  let roleAssignments: { traineeId: string; role: TeachingPracticeRoleValue }[] = [];
  if (track.trainees.length === expectedSize) {
    try {
      roleAssignments = computeTeachingPracticeRotation(
        track.practiceType,
        track.trainees.map((t) => ({ traineeId: t.traineeId, rotationOrder: t.rotationOrder })),
        occurrenceIndex
      );
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "שגיאה בחישוב חלוקת התפקידים" };
    }
  }

  const createdLessonId = await prisma.$transaction(async (tx) => {
    const created = await tx.teachingPracticeLesson.create({
      data: {
        trackId: track.id,
        practiceType: track.practiceType,
        date: parsedDate,
        startTime: track.defaultStartTime,
        endTime: track.defaultEndTime,
        groupName: track.groupName,
        location: track.defaultLocation,
        responsibleInstructorId: track.defaultResponsibleInstructorId,
        isPublished: false,
      },
    });

    if (roleAssignments.length > 0) {
      await tx.teachingPracticeParticipant.createMany({
        data: roleAssignments.map((r) => ({
          lessonId: created.id,
          traineeId: r.traineeId,
          role: r.role,
        })),
      });
    }

    // Childless horse/equipment placeholder rows (Approach A) have nothing
    // to materialize onto the lesson yet - TeachingPracticeChildAssignment.
    // childId stays required/NOT NULL, so these are skipped here rather than
    // attempted (which would fail the insert) or crashing generation.
    const childrenWithChild = track.children.filter(
      (c): c is typeof c & { childId: string } => c.childId !== null
    );
    if (childrenWithChild.length > 0) {
      await tx.teachingPracticeChildAssignment.createMany({
        data: childrenWithChild.map((c) => ({
          lessonId: created.id,
          childId: c.childId,
          horseName: c.horseName,
          equipmentNotes: c.equipmentNotes,
        })),
      });
    }

    return created.id;
  });

  const lesson = await getTeachingPracticeLessonDetailInternal(createdLessonId);
  return { success: true, lesson: lesson ?? undefined };
}

export async function generateTeachingPracticeLessonFromTrackAsAdmin(
  trackId: string,
  date: string
): Promise<TeachingPracticeGenerateLessonResult> {
  await requireAdmin();
  return generateTeachingPracticeLessonFromTrackInternal(trackId, date);
}

export async function generateTeachingPracticeLessonFromTrackAsInstructor(
  instructorId: string,
  trackId: string,
  date: string
): Promise<TeachingPracticeGenerateLessonResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return generateTeachingPracticeLessonFromTrackInternal(trackId, date);
}

// ---------------------------------------------------------------------------
// Generate dates for a whole fixed-schedule block in one call - resolves a
// header/group (lunge group, beginner-private group, beginner-group-lesson
// group, or a single track) to its member track ids, then generates only
// the lessons that don't already exist for each track+date pair. Purely
// additive: reuses generateTeachingPracticeLessonFromTrackInternal per
// track/date (so it inherits the same "works without trainees assigned
// yet" behavior), and never touches a lesson that already exists for that
// track+date - there is no DB unique constraint on (trackId, date), so
// existence is always checked with a query before create.
//
// Beginner dates are deliberately resolved by (practiceType, groupName) -
// the same group/type level as lunge - not by an individual
// BEGINNER_GROUP track's groupTrackId. The product need is "set dates for
// all of קבוצה א's private lessons" / "...group lessons" in one action, not
// per individual beginner block.
// ---------------------------------------------------------------------------

export type TeachingPracticeDateBlockType =
  | "LUNGE_GROUP"
  | "BEGINNER_PRIVATE_GROUP"
  | "BEGINNER_GROUP_LESSONS_GROUP"
  | "SINGLE_TRACK";

export interface TeachingPracticeDatesForBlockInput {
  blockType: TeachingPracticeDateBlockType;
  groupName?: string | null;
  trackId?: string;
  dates: string[];
}

export interface TeachingPracticeDatesForBlockResult extends ActionResult {
  createdCount?: number;
  skippedExistingCount?: number;
  warnings?: string[];
}

const DATE_BLOCK_PRACTICE_TYPE: Partial<Record<TeachingPracticeDateBlockType, TeachingPracticeTypeValue>> = {
  LUNGE_GROUP: "LUNGE",
  BEGINNER_PRIVATE_GROUP: "BEGINNER_PRIVATE",
  BEGINNER_GROUP_LESSONS_GROUP: "BEGINNER_GROUP",
};

const DATE_BLOCK_EMPTY_ERROR: Partial<Record<TeachingPracticeDateBlockType, string>> = {
  LUNGE_GROUP: "לא נמצאו סלוטים פעילים בקבוצת הלונג׳ הזו",
  BEGINNER_PRIVATE_GROUP: "לא נמצאו סלוטים פרטניים פעילים בקבוצה זו",
  BEGINNER_GROUP_LESSONS_GROUP: "לא נמצאו סלוטים קבוצתיים פעילים בקבוצה זו",
};

async function resolveTeachingPracticeDateBlockTrackIds(
  input: TeachingPracticeDatesForBlockInput
): Promise<{ trackIds: string[] } | { error: string }> {
  if (input.blockType === "SINGLE_TRACK") {
    if (!input.trackId) return { error: "יש לבחור מסלול" };
    const track = await prisma.teachingPracticeTrack.findUnique({ where: { id: input.trackId } });
    if (!track) return { error: NOT_FOUND_TRACK };
    if (!track.isActive) return { error: "לא ניתן ליצור שיעורים ממסלול לא פעיל" };
    return { trackIds: [track.id] };
  }

  // LUNGE_GROUP / BEGINNER_PRIVATE_GROUP / BEGINNER_GROUP_LESSONS_GROUP all
  // resolve the same way - every active track of the block's fixed
  // practiceType sharing this groupName.
  const practiceType = DATE_BLOCK_PRACTICE_TYPE[input.blockType];
  if (!practiceType) return { error: "סוג בלוק לא תקין" };

  const groupName = input.groupName ?? null;
  const tracks = await prisma.teachingPracticeTrack.findMany({
    where: { practiceType, groupName, isActive: true },
    select: { id: true },
  });
  if (tracks.length === 0) {
    return { error: DATE_BLOCK_EMPTY_ERROR[input.blockType] ?? "לא נמצאו סלוטים פעילים בקבוצה זו" };
  }
  return { trackIds: tracks.map((t) => t.id) };
}

async function setTeachingPracticeDatesForBlockInternal(
  input: TeachingPracticeDatesForBlockInput
): Promise<TeachingPracticeDatesForBlockResult> {
  if (!Array.isArray(input.dates) || input.dates.length === 0) {
    return { success: false, error: "יש לבחור לפחות תאריך אחד" };
  }

  const uniqueDateKeys = Array.from(new Set(input.dates));
  const parsedDates: { key: string; date: Date }[] = [];
  for (const key of uniqueDateKeys) {
    const parsed = parseDateKey(key);
    if (Number.isNaN(parsed.getTime())) {
      return { success: false, error: `תאריך לא תקין: ${key}` };
    }
    parsedDates.push({ key, date: parsed });
  }

  const resolved = await resolveTeachingPracticeDateBlockTrackIds(input);
  if ("error" in resolved) return { success: false, error: resolved.error };

  let createdCount = 0;
  let skippedExistingCount = 0;
  const warnings: string[] = [];

  // Sequential on purpose (never Promise.all) - each generated lesson's
  // role-rotation depends on that same track's prior lesson count already
  // being committed, same reasoning as the per-track "generate lessons"
  // loop in the UI.
  for (const trackId of resolved.trackIds) {
    for (const { key, date } of parsedDates) {
      const existing = await prisma.teachingPracticeLesson.findFirst({
        where: { trackId, date },
        select: { id: true },
      });
      if (existing) {
        skippedExistingCount += 1;
        continue;
      }

      const result = await generateTeachingPracticeLessonFromTrackInternal(trackId, key);
      if (!result.success) {
        warnings.push(`שגיאה ביצירת שיעור לתאריך ${key} (מסלול ${trackId}): ${result.error ?? "אירעה שגיאה"}`);
        continue;
      }
      createdCount += 1;
    }
  }

  return { success: true, createdCount, skippedExistingCount, warnings };
}

export async function setTeachingPracticeDatesForBlockAsAdmin(
  input: TeachingPracticeDatesForBlockInput
): Promise<TeachingPracticeDatesForBlockResult> {
  await requireAdmin();
  return setTeachingPracticeDatesForBlockInternal(input);
}

// ---------------------------------------------------------------------------
// Lesson publish/unpublish
// ---------------------------------------------------------------------------

async function setTeachingPracticeLessonPublishedInternal(
  lessonId: string,
  isPublished: boolean
): Promise<ActionResult> {
  const lesson = await prisma.teachingPracticeLesson.findUnique({ where: { id: lessonId } });
  if (!lesson) return { success: false, error: NOT_FOUND_LESSON };
  await prisma.teachingPracticeLesson.update({ where: { id: lessonId }, data: { isPublished } });
  return { success: true };
}

export async function setTeachingPracticeLessonPublishedAsAdmin(
  lessonId: string,
  isPublished: boolean
): Promise<ActionResult> {
  await requireAdmin();
  return setTeachingPracticeLessonPublishedInternal(lessonId, isPublished);
}

export async function setTeachingPracticeLessonPublishedAsInstructor(
  instructorId: string,
  lessonId: string,
  isPublished: boolean
): Promise<ActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return setTeachingPracticeLessonPublishedInternal(lessonId, isPublished);
}

// ---------------------------------------------------------------------------
// Lesson basic-field override (date/time/responsible instructor/location/notes)
// ---------------------------------------------------------------------------

export interface TeachingPracticeLessonInput {
  date: string;
  startTime: string;
  responsibleInstructorId?: string | null;
  location?: string | null;
  notes?: string | null;
  // Display-only role label overrides for the generated-lessons table; a
  // missing/blank value for a role resets that role back to the default
  // ROLE_LABELS text. Omit the field entirely to leave overrides untouched.
  roleLabelOverrides?: Partial<Record<TeachingPracticeRoleValue, string>> | null;
}

// v1 keeps a single responsible instructor per lesson (overriding the
// track's default, same as generation time) - not a list. If an occasional
// second instructor is involved, that belongs in notes for now; supporting
// several responsible instructors would need a real schema addition (a
// join table), deferred until it's a confirmed need.
async function updateTeachingPracticeLessonInternal(
  lessonId: string,
  input: TeachingPracticeLessonInput
): Promise<ActionResult> {
  const lesson = await prisma.teachingPracticeLesson.findUnique({ where: { id: lessonId } });
  if (!lesson) return { success: false, error: NOT_FOUND_LESSON };

  const startTime = input.startTime?.trim();
  if (!startTime) return { success: false, error: "יש להזין שעת התחלה" };

  const parsedDate = parseDateKey(input.date);
  if (Number.isNaN(parsedDate.getTime())) {
    return { success: false, error: "תאריך לא תקין" };
  }

  // Duration is fixed per the lesson's own practiceType (set once at
  // generation, never edited here) - endTime is always re-derived, never
  // accepted from the client.
  const endTime = addMinutesToTimeString(startTime, TEACHING_PRACTICE_DURATION_MINUTES[lesson.practiceType]);
  if (!endTime) return { success: false, error: "שעת התחלה לא תקינה" };

  const responsible = await validateResponsibleInstructor(input.responsibleInstructorId);
  if ("error" in responsible) return { success: false, error: responsible.error };

  // roleLabelOverrides is only touched when the caller explicitly sends the
  // key (present in `input`, even as null/{} to clear it) - callers that
  // don't know about this field (e.g. any older client) leave existing
  // overrides untouched instead of silently wiping them.
  const updatesRoleLabels = "roleLabelOverrides" in input;
  const sanitizedRoleLabelOverrides = updatesRoleLabels
    ? sanitizeRoleLabelOverrides(input.roleLabelOverrides)
    : undefined;

  await prisma.teachingPracticeLesson.update({
    where: { id: lessonId },
    data: {
      date: parsedDate,
      startTime,
      endTime,
      responsibleInstructorId: responsible.id,
      location: input.location?.trim() || null,
      notes: input.notes?.trim() || null,
      ...(updatesRoleLabels
        ? { roleLabelOverrides: sanitizedRoleLabelOverrides ?? Prisma.JsonNull }
        : {}),
    },
  });

  return { success: true };
}

export async function updateTeachingPracticeLessonAsAdmin(
  lessonId: string,
  input: TeachingPracticeLessonInput
): Promise<ActionResult> {
  await requireAdmin();
  return updateTeachingPracticeLessonInternal(lessonId, input);
}

export async function updateTeachingPracticeLessonAsInstructor(
  instructorId: string,
  lessonId: string,
  input: TeachingPracticeLessonInput
): Promise<ActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return updateTeachingPracticeLessonInternal(lessonId, input);
}

// ---------------------------------------------------------------------------
// Lesson participant override (manual role changes)
// ---------------------------------------------------------------------------

export interface TeachingPracticeParticipantInput {
  traineeId: string;
  role: TeachingPracticeRoleValue;
}

async function setTeachingPracticeLessonParticipantsInternal(
  lessonId: string,
  participantRows: TeachingPracticeParticipantInput[]
): Promise<ActionResult> {
  const lesson = await prisma.teachingPracticeLesson.findUnique({
    where: { id: lessonId },
    include: { participants: { include: { feedback: true } } },
  });
  if (!lesson) return { success: false, error: NOT_FOUND_LESSON };

  const uniqueTraineeIds = new Set(participantRows.map((p) => p.traineeId));
  if (uniqueTraineeIds.size !== participantRows.length) {
    return { success: false, error: "לא ניתן לשבץ אותו חניך/ה יותר מפעם אחת בשיעור" };
  }
  if (participantRows.some((p) => !VALID_ROLES.includes(p.role))) {
    return { success: false, error: "תפקיד לא תקין" };
  }

  if (participantRows.length > 0) {
    const trainees = await prisma.student.findMany({
      where: { id: { in: participantRows.map((p) => p.traineeId) } },
    });
    if (trainees.length !== participantRows.length) {
      return { success: false, error: "אחד או יותר מהחניכים שנבחרו לא נמצאו" };
    }
    if (trainees.some((t) => !t.isActive)) {
      return { success: false, error: "לא ניתן לשבץ חניך/ה שאינו/ה פעיל/ה" };
    }
  }

  // Safe-by-default: refuse to drop a participant that already has teaching
  // feedback recorded against them, rather than silently cascading that
  // feedback away. The caller must remove the feedback first (a later-stage
  // action) if they really intend to replace that trainee's role entirely.
  const nextTraineeIds = new Set(participantRows.map((p) => p.traineeId));
  const droppedWithFeedback = lesson.participants.filter(
    (p) => !nextTraineeIds.has(p.traineeId) && p.feedback
  );
  if (droppedWithFeedback.length > 0) {
    return {
      success: false,
      error: "לא ניתן להסיר חניך/ה שכבר נכתב עבורו/ה משוב הדרכה. יש למחוק את המשוב תחילה.",
    };
  }

  const existingByTraineeId = new Map(lesson.participants.map((p) => [p.traineeId, p]));

  await prisma.$transaction(async (tx) => {
    const toDeleteIds = lesson.participants
      .filter((p) => !nextTraineeIds.has(p.traineeId))
      .map((p) => p.id);
    if (toDeleteIds.length > 0) {
      await tx.teachingPracticeParticipant.deleteMany({ where: { id: { in: toDeleteIds } } });
    }

    for (const row of participantRows) {
      const existing = existingByTraineeId.get(row.traineeId);
      if (existing) {
        if (existing.role !== row.role) {
          await tx.teachingPracticeParticipant.update({
            where: { id: existing.id },
            data: { role: row.role, isManualOverride: true },
          });
        }
      } else {
        await tx.teachingPracticeParticipant.create({
          data: { lessonId, traineeId: row.traineeId, role: row.role, isManualOverride: true },
        });
      }
    }
  });

  return { success: true };
}

export async function setTeachingPracticeLessonParticipantsAsAdmin(
  lessonId: string,
  participantRows: TeachingPracticeParticipantInput[]
): Promise<ActionResult> {
  await requireAdmin();
  return setTeachingPracticeLessonParticipantsInternal(lessonId, participantRows);
}

export async function setTeachingPracticeLessonParticipantsAsInstructor(
  instructorId: string,
  lessonId: string,
  participantRows: TeachingPracticeParticipantInput[]
): Promise<ActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return setTeachingPracticeLessonParticipantsInternal(lessonId, participantRows);
}

// ---------------------------------------------------------------------------
// Lesson child assignment overrides
// ---------------------------------------------------------------------------

export interface TeachingPracticeChildAssignmentInput {
  childId: string;
  horseName?: string | null;
  equipmentNotes?: string | null;
  isAbsent?: boolean;
}

async function setTeachingPracticeLessonChildAssignmentsInternal(
  lessonId: string,
  rows: TeachingPracticeChildAssignmentInput[]
): Promise<ActionResult> {
  const lesson = await prisma.teachingPracticeLesson.findUnique({ where: { id: lessonId } });
  if (!lesson) return { success: false, error: NOT_FOUND_LESSON };

  const uniqueChildIds = new Set(rows.map((r) => r.childId));
  if (uniqueChildIds.size !== rows.length) {
    return { success: false, error: "לא ניתן לשבץ אותו ילד/ה יותר מפעם אחת בשיעור" };
  }

  if (rows.length > 0) {
    const children = await prisma.teachingPracticeChild.findMany({
      where: { id: { in: rows.map((r) => r.childId) } },
    });
    if (children.length !== rows.length) {
      return { success: false, error: "אחד או יותר מהילדים שנבחרו לא נמצאו" };
    }
    if (children.some((c) => !c.isActive)) {
      return { success: false, error: "לא ניתן לשבץ ילד/ה שאינו/ה פעיל/ה" };
    }
  }

  // No feedback dependency here (unlike participants) - feedback is keyed
  // to TeachingPracticeParticipant, never to a child assignment - so a full
  // replace-all is safe with no extra guard needed.
  await prisma.$transaction([
    prisma.teachingPracticeChildAssignment.deleteMany({ where: { lessonId } }),
    prisma.teachingPracticeChildAssignment.createMany({
      data: rows.map((r) => ({
        lessonId,
        childId: r.childId,
        horseName: r.horseName?.trim() || null,
        equipmentNotes: r.equipmentNotes?.trim() || null,
        isAbsent: r.isAbsent ?? false,
      })),
    }),
  ]);

  return { success: true };
}

export async function setTeachingPracticeLessonChildAssignmentsAsAdmin(
  lessonId: string,
  rows: TeachingPracticeChildAssignmentInput[]
): Promise<ActionResult> {
  await requireAdmin();
  return setTeachingPracticeLessonChildAssignmentsInternal(lessonId, rows);
}

// Same dual-permission split as setTeachingPracticeTrackChildrenAsInstructor:
// childId/isAbsent need canManageTeachingPracticeAssignments,
// horseName/equipmentNotes additionally need canManageTeachingPracticeHorses,
// enforced by diffing against what's currently stored for this lesson.
export async function setTeachingPracticeLessonChildAssignmentsAsInstructor(
  instructorId: string,
  lessonId: string,
  rows: TeachingPracticeChildAssignmentInput[]
): Promise<ActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canManageTeachingPracticeAssignments) {
    return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  }

  if (!instructor.canManageTeachingPracticeHorses) {
    const existing = await prisma.teachingPracticeChildAssignment.findMany({ where: { lessonId } });
    const existingByChildId = new Map(existing.map((e) => [e.childId, e]));
    const changesHorseFields = rows.some((r) => {
      const prev = existingByChildId.get(r.childId);
      const nextHorseName = r.horseName?.trim() || null;
      const nextEquipmentNotes = r.equipmentNotes?.trim() || null;
      return horseFieldsChanged(
        prev?.horseName ?? null,
        prev?.equipmentNotes ?? null,
        nextHorseName,
        nextEquipmentNotes
      );
    });
    if (changesHorseFields) return { success: false, error: NO_HORSE_PERMISSION };
  }

  return setTeachingPracticeLessonChildAssignmentsInternal(lessonId, rows);
}

// ---------------------------------------------------------------------------
// Schedule quality check ("בדיקת שיבוץ") - read-only, trainee timeline only
// (Stage 1). Deliberately merges all three practiceType values into one
// per-trainee timeline instead of checking each type separately, since the
// actual risk is a lunge slot overlapping a beginner private/group slot, not
// just conflicts within one type. Deliberately includes lessons regardless
// of isPublished - this check exists specifically to catch problems before
// publishing, so filtering out drafts would defeat the point. Advisory only:
// never blocks any save/write action.
// ---------------------------------------------------------------------------

export interface TeachingPracticeScheduleCheckEntry {
  lessonId: string;
  date: string;
  practiceType: TeachingPracticeTypeValue;
  role: TeachingPracticeRoleValue;
  startTime: string;
  endTime: string;
  warnings: TeachingPracticeScheduleWarning[];
}

export interface TeachingPracticeTraineeScheduleCheck {
  traineeId: string;
  traineeName: string;
  timeline: TeachingPracticeScheduleCheckEntry[];
}

// Stage 2 - horse timeline. horseName is free text (TeachingPracticeChildAssignment.horseName,
// not a FK), so two different spellings of the same real horse show up as two
// separate entries here - deliberately not normalized/merged in this stage
// (see report). Grouped by the raw stored string as-is.
export interface TeachingPracticeHorseScheduleCheckEntry {
  lessonId: string;
  date: string;
  practiceType: TeachingPracticeTypeValue;
  childFullName: string | null;
  startTime: string;
  endTime: string;
  warnings: TeachingPracticeScheduleWarning[];
}

export interface TeachingPracticeHorseScheduleCheck {
  horseName: string;
  timeline: TeachingPracticeHorseScheduleCheckEntry[];
}

export interface TeachingPracticeScheduleCheckResult {
  trainees: TeachingPracticeTraineeScheduleCheck[];
  horses: TeachingPracticeHorseScheduleCheck[];
}

export async function getTeachingPracticeScheduleCheckForAdmin(): Promise<
  TeachingPracticeScheduleCheckResult
> {
  await requireAdmin();

  const [participants, childAssignments] = await Promise.all([
    prisma.teachingPracticeParticipant.findMany({
      include: {
        trainee: { select: { fullName: true } },
        lesson: { select: { id: true, date: true, startTime: true, endTime: true, practiceType: true } },
      },
    }),
    // No isAbsent/horseName filter in the where clause here - horseName can't
    // be filtered for "non-empty" in one Prisma clause (only null-ness), so
    // both are checked in JS below alongside the isAbsent check for a single
    // consistent guard.
    prisma.teachingPracticeChildAssignment.findMany({
      include: {
        child: { select: { fullName: true } },
        lesson: { select: { id: true, date: true, startTime: true, endTime: true, practiceType: true } },
      },
    }),
  ]);

  const entriesByTrainee = new Map<
    string,
    {
      traineeName: string;
      entries: {
        lessonId: string;
        date: string;
        startTime: string;
        endTime: string;
        practiceType: TeachingPracticeTypeValue;
        role: TeachingPracticeRoleValue;
      }[];
    }
  >();

  for (const p of participants) {
    const entry = {
      lessonId: p.lesson.id,
      date: dateKey(p.lesson.date),
      startTime: p.lesson.startTime,
      endTime: p.lesson.endTime,
      practiceType: p.lesson.practiceType,
      role: p.role,
    };
    const existing = entriesByTrainee.get(p.traineeId);
    if (existing) {
      existing.entries.push(entry);
    } else {
      entriesByTrainee.set(p.traineeId, { traineeName: p.trainee.fullName, entries: [entry] });
    }
  }

  const trainees: TeachingPracticeTraineeScheduleCheck[] = [];
  for (const [traineeId, { traineeName, entries }] of entriesByTrainee) {
    trainees.push({ traineeId, traineeName, timeline: attachTeachingPracticeScheduleWarnings(entries) });
  }
  trainees.sort((a, b) => a.traineeName.localeCompare(b.traineeName, "he"));

  const entriesByHorse = new Map<
    string,
    {
      lessonId: string;
      date: string;
      startTime: string;
      endTime: string;
      practiceType: TeachingPracticeTypeValue;
      childFullName: string | null;
    }[]
  >();

  for (const ca of childAssignments) {
    if (ca.isAbsent) continue;
    const horseName = ca.horseName?.trim();
    if (!horseName) continue;

    const entry = {
      lessonId: ca.lesson.id,
      date: dateKey(ca.lesson.date),
      startTime: ca.lesson.startTime,
      endTime: ca.lesson.endTime,
      practiceType: ca.lesson.practiceType,
      childFullName: ca.child.fullName,
    };
    const existing = entriesByHorse.get(horseName);
    if (existing) {
      existing.push(entry);
    } else {
      entriesByHorse.set(horseName, [entry]);
    }
  }

  const horses: TeachingPracticeHorseScheduleCheck[] = [];
  for (const [horseName, entries] of entriesByHorse) {
    horses.push({ horseName, timeline: attachTeachingPracticeScheduleWarnings(entries) });
  }
  horses.sort((a, b) => a.horseName.localeCompare(b.horseName, "he"));

  return { trainees, horses };
}
