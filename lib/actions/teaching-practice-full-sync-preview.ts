"use server";

// Stage C1 (safe version) - read-only, group-scoped dry-run preview of what
// a future full fixed-structure -> generated-lessons sync would change for
// Teaching Practice ("התנסויות מתחילים"). This file performs NO writes:
// no create/update/delete/upsert, no deleteMany/createMany, no
// $transaction, no revalidatePath. It only reads current state and computes
// what a future apply-time sync would do, for review before that apply
// action is ever built/run.
//
// Business rule being previewed (not yet applied): the fixed structure
// (TeachingPracticeTrack / TeachingPracticeTrackTrainee / TeachingPracticeTrackChild)
// is the source of truth, and a future sync may overwrite a manually-edited
// generated lesson's participants/children/time/location/instructor, as
// long as that lesson has no feedback and isn't in the past. Manual
// overrides are reported here for visibility but never treated as a block.
//
// Scope: group-scoped only (groupName required, "א"/"ב" only) - mirrors the
// convention in lib/actions/teaching-practice.ts (VALID_GROUP_NAMES is not
// exported from there, so it's replicated here, same as
// lib/teaching-practice-trainee-suggestions.ts already does for the same
// reason).
//
// Never read-written here: TeachingPracticeFeedback (only ever checked for
// presence), lesson existence (no create/delete), practiceType (excluded
// from the previewed-fields list by design), and generation/date-creation
// logic (nothing here calls it).

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseDateKey, todayDateKey } from "@/lib/dates";
import {
  computeTeachingPracticeRotation,
  TEACHING_PRACTICE_TEAM_SIZE,
  type TeachingPracticeRoleValue,
  type TeachingPracticeTypeValue,
} from "@/lib/teaching-practice-rotation";
import { hasMeaningfulTeachingPracticeFeedback } from "@/lib/teaching-practice-feedback";

// Mirrors VALID_GROUP_NAMES in lib/actions/teaching-practice.ts (not
// exported from there) - same small, deliberate, self-contained duplication
// already used in lib/teaching-practice-trainee-suggestions.ts and
// lib/actions/teaching-practice-full-sync.ts for the same reason.
const VALID_GROUP_NAMES = ["א", "ב"] as const;

export interface TeachingPracticeFullSyncPreviewError {
  trackId: string;
  lessonId?: string;
  message: string;
}

export interface TeachingPracticePreviewParticipant {
  traineeId: string;
  role: TeachingPracticeRoleValue;
  isManualOverride?: boolean;
}

export interface TeachingPracticePreviewChildAssignment {
  childId: string;
  horseName: string | null;
  equipmentNotes: string | null;
  isAbsent?: boolean;
}

export interface TeachingPracticePreviewLessonFields {
  startTime: string;
  endTime: string;
  location: string | null;
  responsibleInstructorId: string | null;
  groupName: string | null;
}

export type TeachingPracticeChangeCategory = "participants" | "childAssignments" | "lessonFields";

export interface TeachingPracticeLessonPreviewChange {
  lessonId: string;
  date: string; // date-key (YYYY-MM-DD)
  trackId: string;
  practiceType: TeachingPracticeTypeValue;
  groupName: string | null;
  currentParticipants: TeachingPracticePreviewParticipant[];
  targetParticipants: TeachingPracticePreviewParticipant[];
  currentChildAssignments: TeachingPracticePreviewChildAssignment[];
  targetChildAssignments: TeachingPracticePreviewChildAssignment[];
  currentFields: TeachingPracticePreviewLessonFields;
  targetFields: TeachingPracticePreviewLessonFields;
  changeCategories: TeachingPracticeChangeCategory[];
  hasManualOverride: boolean;
}

export interface TeachingPracticeFullSyncPreviewResult {
  groupName: string;
  tracksChecked: number;
  tracksSkippedNoLessons: number;
  tracksSkippedIncompleteFixedStructure: number;
  beginnerGroupDerivationsPreviewed: number;
  beginnerGroupDerivationsSkipped: number;
  lessonsChecked: number;
  lessonsWouldSync: number;
  lessonsUnchanged: number;
  lessonsSkippedFeedback: number;
  lessonsSkippedPastDate: number;
  lessonsWithManualOverrides: number;
  participants: { wouldCreate: number; wouldDelete: number; wouldUpdate: number; unchanged: number };
  childAssignments: { wouldCreate: number; wouldDelete: number; wouldUpdate: number; unchanged: number };
  lessonFields: { wouldUpdate: number; unchanged: number };
  errors: TeachingPracticeFullSyncPreviewError[];
  changes: TeachingPracticeLessonPreviewChange[];
}

function emptyResult(groupName: string): TeachingPracticeFullSyncPreviewResult {
  return {
    groupName,
    tracksChecked: 0,
    tracksSkippedNoLessons: 0,
    tracksSkippedIncompleteFixedStructure: 0,
    beginnerGroupDerivationsPreviewed: 0,
    beginnerGroupDerivationsSkipped: 0,
    lessonsChecked: 0,
    lessonsWouldSync: 0,
    lessonsUnchanged: 0,
    lessonsSkippedFeedback: 0,
    lessonsSkippedPastDate: 0,
    lessonsWithManualOverrides: 0,
    participants: { wouldCreate: 0, wouldDelete: 0, wouldUpdate: 0, unchanged: 0 },
    childAssignments: { wouldCreate: 0, wouldDelete: 0, wouldUpdate: 0, unchanged: 0 },
    lessonFields: { wouldUpdate: 0, unchanged: 0 },
    errors: [],
    changes: [],
  };
}

// Same ordering the fixed-structure UI already uses for linked private rows
// (compareLinkedPrivateRows in TeachingPracticeManager.tsx) - replicated
// here rather than imported, since that comparator lives in a client
// component file this server module can't import from. Byte-for-byte
// equivalent: defaultStartTime, then createdAt, then id. Same replication
// already used in lib/actions/teaching-practice-full-sync.ts.
function compareLinkedPrivateTracks(
  a: { defaultStartTime: string; createdAt: Date; id: string },
  b: { defaultStartTime: string; createdAt: Date; id: string }
): number {
  return (
    a.defaultStartTime.localeCompare(b.defaultStartTime) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

interface FixedTrack {
  id: string;
  practiceType: TeachingPracticeTypeValue;
  groupName: string | null;
  defaultStartTime: string;
  defaultEndTime: string;
  defaultLocation: string | null;
  defaultResponsibleInstructorId: string | null;
  groupTrackId: string | null;
  createdAt: Date;
  trainees: { traineeId: string; rotationOrder: number }[];
  children: { childId: string | null; horseName: string | null; equipmentNotes: string | null }[];
  _count: { lessons: number };
}

// Internal, read-only computation - module-private. Even though it never
// writes anything, it returns sensitive Teaching Practice data (חניכים,
// ילדים, lesson/assignment details), so the only way to reach it from
// outside this file is through the requireAdmin()-gated wrapper below.
async function previewTeachingPracticeFixedStructureSyncInternal(
  groupName: string
): Promise<TeachingPracticeFullSyncPreviewResult> {
  if (!VALID_GROUP_NAMES.includes(groupName as "א" | "ב")) {
    throw new Error("קבוצה לא תקינה - יש לבחור קבוצה א או קבוצה ב");
  }

  const result = emptyResult(groupName);

  const tracks: FixedTrack[] = await prisma.teachingPracticeTrack.findMany({
    where: { groupName, isActive: true },
    select: {
      id: true,
      practiceType: true,
      groupName: true,
      defaultStartTime: true,
      defaultEndTime: true,
      defaultLocation: true,
      defaultResponsibleInstructorId: true,
      groupTrackId: true,
      createdAt: true,
      trainees: { select: { traineeId: true, rotationOrder: true } },
      children: { select: { childId: true, horseName: true, equipmentNotes: true } },
      _count: { select: { lessons: true } },
    },
  });

  // Batched: every BEGINNER_PRIVATE track linked to any BEGINNER_GROUP track
  // in this group, fetched once, not per-track.
  const groupTrackIds = tracks.filter((t) => t.practiceType === "BEGINNER_GROUP").map((t) => t.id);
  const linkedPrivateTracks = groupTrackIds.length
    ? await prisma.teachingPracticeTrack.findMany({
        where: { practiceType: "BEGINNER_PRIVATE", groupTrackId: { in: groupTrackIds } },
        select: {
          id: true,
          groupTrackId: true,
          defaultStartTime: true,
          createdAt: true,
          trainees: { select: { traineeId: true, rotationOrder: true } },
          children: { select: { childId: true, horseName: true, equipmentNotes: true } },
        },
      })
    : [];
  const linkedByGroupTrackId = new Map<string, typeof linkedPrivateTracks>();
  for (const p of linkedPrivateTracks) {
    if (!p.groupTrackId) continue;
    const list = linkedByGroupTrackId.get(p.groupTrackId) ?? [];
    list.push(p);
    linkedByGroupTrackId.set(p.groupTrackId, list);
  }

  const todayUtc = parseDateKey(todayDateKey());

  for (const track of tracks) {
    result.tracksChecked += 1;

    if (track._count.lessons === 0) {
      result.tracksSkippedNoLessons += 1;
      continue;
    }

    // Effective trainees/children for this preview - normally the track's
    // own rows, but for BEGINNER_GROUP, derive (never persist) them from the
    // linked BEGINNER_PRIVATE rows, same "do not guess when incomplete"
    // fallback used by the (unimplemented-yet) real sync: any failure to
    // derive cleanly falls back to whatever the group track's own rows
    // already are, reported as skipped, never blocks the rest of the preview.
    let effectiveTrainees = track.trainees;
    let effectiveChildren = track.children;

    if (track.practiceType === "BEGINNER_GROUP") {
      const expectedGroupSize = TEACHING_PRACTICE_TEAM_SIZE.BEGINNER_GROUP;
      const linked = (linkedByGroupTrackId.get(track.id) ?? []).slice().sort(compareLinkedPrivateTracks);

      if (linked.length !== expectedGroupSize) {
        result.beginnerGroupDerivationsSkipped += 1;
      } else {
        const slot0Trainees = linked.map((p) => p.trainees.find((t) => t.rotationOrder === 0)?.traineeId ?? null);
        if (slot0Trainees.some((id) => id === null)) {
          result.beginnerGroupDerivationsSkipped += 1;
        } else {
          const derivedTraineeIds = slot0Trainees as string[]; // linked[i] -> group rotationOrder i
          result.beginnerGroupDerivationsPreviewed += 1;
          effectiveTrainees = derivedTraineeIds.map((traineeId, rotationOrder) => ({ traineeId, rotationOrder }));

          // Children: union of every linked private track's real children,
          // deduped by childId (first occurrence, in the same stable link
          // order, wins if horse/equipment notes ever differ between them).
          const derivedChildrenMap = new Map<string, { childId: string; horseName: string | null; equipmentNotes: string | null }>();
          for (const p of linked) {
            for (const c of p.children) {
              if (c.childId && !derivedChildrenMap.has(c.childId)) {
                derivedChildrenMap.set(c.childId, { childId: c.childId, horseName: c.horseName, equipmentNotes: c.equipmentNotes });
              }
            }
          }
          effectiveChildren = Array.from(derivedChildrenMap.values());
        }
      }
    }

    const expectedTeamSize = TEACHING_PRACTICE_TEAM_SIZE[track.practiceType];
    if (effectiveTrainees.length !== expectedTeamSize) {
      result.tracksSkippedIncompleteFixedStructure += 1;
      continue;
    }

    const traineeInput = [...effectiveTrainees].sort((a, b) => a.rotationOrder - b.rotationOrder);
    const targetChildAssignments: TeachingPracticePreviewChildAssignment[] = effectiveChildren
      .filter((c): c is { childId: string; horseName: string | null; equipmentNotes: string | null } => c.childId !== null)
      .map((c) => ({ childId: c.childId, horseName: c.horseName, equipmentNotes: c.equipmentNotes }));

    const targetFields: TeachingPracticePreviewLessonFields = {
      startTime: track.defaultStartTime,
      endTime: track.defaultEndTime,
      location: track.defaultLocation,
      responsibleInstructorId: track.defaultResponsibleInstructorId,
      groupName: track.groupName,
    };

    // Fetched in full chronological order (not date-filtered) so each
    // lesson's occurrenceIndex - needed for the rotation formula - reflects
    // its true position among ALL of this track's lessons, matching the
    // existing generation convention. Eligibility (past-date/feedback) is
    // applied per lesson below, after occurrenceIndex is known.
    const lessons = await prisma.teachingPracticeLesson.findMany({
      where: { trackId: track.id },
      orderBy: [{ date: "asc" }, { startTime: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      include: {
        participants: {
          select: {
            id: true,
            traineeId: true,
            role: true,
            isManualOverride: true,
            feedback: { select: { feedback: true, ratingHalfPoints: true } },
          },
        },
        childAssignments: { select: { id: true, childId: true, horseName: true, equipmentNotes: true, isAbsent: true } },
      },
    });

    for (let occurrenceIndex = 0; occurrenceIndex < lessons.length; occurrenceIndex++) {
      const lesson = lessons[occurrenceIndex];
      result.lessonsChecked += 1;

      const hasManualOverride = lesson.participants.some((p) => p.isManualOverride);
      if (hasManualOverride) result.lessonsWithManualOverrides += 1;

      if (lesson.date.getTime() < todayUtc.getTime()) {
        result.lessonsSkippedPastDate += 1;
        continue;
      }
      if (lesson.participants.some((p) => hasMeaningfulTeachingPracticeFeedback(p.feedback))) {
        result.lessonsSkippedFeedback += 1;
        continue;
      }

      try {
        let roleAssignments: { traineeId: string; role: TeachingPracticeRoleValue }[];
        try {
          roleAssignments = computeTeachingPracticeRotation(track.practiceType, traineeInput, occurrenceIndex);
        } catch (err) {
          result.errors.push({
            trackId: track.id,
            lessonId: lesson.id,
            message: err instanceof Error ? err.message : "שגיאה בחישוב חלוקת התפקידים",
          });
          continue;
        }

        // ---- Participants: per-trainee diff (create/delete/update/unchanged) ----
        const currentByTrainee = new Map(lesson.participants.map((p) => [p.traineeId, p]));
        const targetByTrainee = new Map(roleAssignments.map((r) => [r.traineeId, r.role]));
        let participantsChanged = false;
        for (const [traineeId, current] of currentByTrainee) {
          const targetRole = targetByTrainee.get(traineeId);
          if (targetRole === undefined) {
            result.participants.wouldDelete += 1;
            participantsChanged = true;
          } else if (targetRole !== current.role) {
            result.participants.wouldUpdate += 1;
            participantsChanged = true;
          } else {
            result.participants.unchanged += 1;
          }
        }
        for (const traineeId of targetByTrainee.keys()) {
          if (!currentByTrainee.has(traineeId)) {
            result.participants.wouldCreate += 1;
            participantsChanged = true;
          }
        }

        // ---- Child assignments: per-child diff (create/delete/update/unchanged) ----
        const currentByChild = new Map(lesson.childAssignments.map((c) => [c.childId, c]));
        const targetByChild = new Map(targetChildAssignments.map((c) => [c.childId, c]));
        let childrenChanged = false;
        for (const [childId, current] of currentByChild) {
          const target = targetByChild.get(childId);
          if (!target) {
            result.childAssignments.wouldDelete += 1;
            childrenChanged = true;
          } else if (current.horseName !== target.horseName || current.equipmentNotes !== target.equipmentNotes) {
            result.childAssignments.wouldUpdate += 1;
            childrenChanged = true;
          } else {
            result.childAssignments.unchanged += 1;
          }
        }
        for (const childId of targetByChild.keys()) {
          if (!currentByChild.has(childId)) {
            result.childAssignments.wouldCreate += 1;
            childrenChanged = true;
          }
        }

        // ---- Lesson fields: startTime/endTime/location/instructor/groupName ----
        const currentFields: TeachingPracticePreviewLessonFields = {
          startTime: lesson.startTime,
          endTime: lesson.endTime,
          location: lesson.location,
          responsibleInstructorId: lesson.responsibleInstructorId,
          groupName: lesson.groupName,
        };
        const fieldsMatch =
          currentFields.startTime === targetFields.startTime &&
          currentFields.endTime === targetFields.endTime &&
          currentFields.location === targetFields.location &&
          currentFields.responsibleInstructorId === targetFields.responsibleInstructorId &&
          currentFields.groupName === targetFields.groupName;
        if (fieldsMatch) result.lessonFields.unchanged += 1;
        else result.lessonFields.wouldUpdate += 1;

        const changeCategories: TeachingPracticeChangeCategory[] = [];
        if (participantsChanged) changeCategories.push("participants");
        if (childrenChanged) changeCategories.push("childAssignments");
        if (!fieldsMatch) changeCategories.push("lessonFields");

        if (changeCategories.length === 0) {
          result.lessonsUnchanged += 1;
          continue;
        }

        result.lessonsWouldSync += 1;
        result.changes.push({
          lessonId: lesson.id,
          date: lesson.date.toISOString().slice(0, 10),
          trackId: track.id,
          practiceType: track.practiceType,
          groupName: lesson.groupName,
          currentParticipants: lesson.participants.map((p) => ({ traineeId: p.traineeId, role: p.role, isManualOverride: p.isManualOverride })),
          targetParticipants: roleAssignments.map((r) => ({ traineeId: r.traineeId, role: r.role })),
          currentChildAssignments: lesson.childAssignments.map((c) => ({
            childId: c.childId,
            horseName: c.horseName,
            equipmentNotes: c.equipmentNotes,
            isAbsent: c.isAbsent,
          })),
          targetChildAssignments,
          currentFields,
          targetFields,
          changeCategories,
          hasManualOverride,
        });
      } catch (err) {
        result.errors.push({
          trackId: track.id,
          lessonId: lesson.id,
          message: err instanceof Error ? err.message : "אירעה שגיאה בתצוגה המקדימה של הסנכרון",
        });
      }
    }
  }

  return result;
}

export async function previewTeachingPracticeFixedStructureSyncForAdmin(
  groupName: string
): Promise<TeachingPracticeFullSyncPreviewResult> {
  await requireAdmin();
  return previewTeachingPracticeFixedStructureSyncInternal(groupName);
}
