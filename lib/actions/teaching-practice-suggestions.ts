"use server";

// Stage 0 - read-only data-fetch + calculation wrapper around the pure
// engine in lib/teaching-practice-trainee-suggestions.ts.
//
// Stage 2 (revised) additionally adds one small, dedicated write action -
// applyTeachingPracticeTrackTraineeSlotSuggestionsAsAdmin - for applying
// selected suggestions at their exact rotationOrder without compacting/
// shifting any other slot. This is a deliberate departure from reusing
// setTeachingPracticeTrackTraineesAsAdmin (lib/actions/teaching-practice.ts):
// that action always replaces a track's entire roster from a plain array
// (array index == rotationOrder), so a hole before the target slot silently
// shifts everything after it. TeachingPracticeTrackTrainee has no schema
// constraint requiring contiguous rotationOrder values (only
// @@unique([trackId, traineeId]) and @@unique([trackId, rotationOrder]) -
// see prisma/schema.prisma), so a single explicit create at the exact
// rotationOrder is both valid and the correct fix. That existing action
// itself is NOT modified here, and nothing else in this file calls it.

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { ActionResult } from "@/lib/actions/students";
import { TEACHING_PRACTICE_TEAM_SIZE } from "@/lib/teaching-practice-rotation";
import {
  computeTeachingPracticeTraineeSuggestions,
  computeTeachingPracticeTraineeSchedule,
  TEACHING_PRACTICE_SUGGESTION_GROUP_NAMES,
  type ComputeTraineeSuggestionsInput,
  type ComputeTraineeSuggestionsResult,
  type ComputeTraineeScheduleInput,
  type ComputeTraineeScheduleResult,
  type TraineeSuggestionInputParticipantHistory,
  type TraineeSuggestionInputTrackTrainee,
  type TraineeSuggestionInputTrainee,
} from "@/lib/teaching-practice-trainee-suggestions";

async function computeTeachingPracticeTraineeSuggestionsForGroupInternal(
  groupName: string
): Promise<ComputeTraineeSuggestionsResult> {
  if (!TEACHING_PRACTICE_SUGGESTION_GROUP_NAMES.includes(groupName as "א" | "ב")) {
    throw new Error("קבוצה לא תקינה - יש לבחור קבוצה א או קבוצה ב");
  }

  const tracks = await prisma.teachingPracticeTrack.findMany({
    where: { groupName, isActive: true },
    orderBy: [
      { practiceType: "asc" },
      { weekday: "asc" },
      { defaultStartTime: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      practiceType: true,
      groupName: true,
      weekday: true,
      defaultStartTime: true,
      defaultEndTime: true,
      groupTrackId: true,
    },
  });
  const trackIds = tracks.map((t) => t.id);

  const trackTraineeRows = trackIds.length
    ? await prisma.teachingPracticeTrackTrainee.findMany({
        where: { trackId: { in: trackIds } },
        orderBy: [
          { trackId: "asc" },
          { rotationOrder: "asc" },
          { id: "asc" },
        ],
        select: {
          trackId: true,
          traineeId: true,
          rotationOrder: true,
          trainee: { select: { id: true, fullName: true, groupName: true, isActive: true } },
        },
      })
    : [];

  const activeGroupTrainees = await prisma.student.findMany({
    where: { groupName, isActive: true },
    orderBy: [
      { fullName: "asc" },
      { id: "asc" },
    ],
    select: { id: true, fullName: true, groupName: true, isActive: true },
  });

  // Directory must include every trainee referenced by trackTraineeRows too,
  // even if inactive or from a different group - needed to name a mismatched
  // current occupant, not just this group's own active roster (see the input
  // contract documented on ComputeTraineeSuggestionsInput).
  const traineeDirectory = new Map<string, TraineeSuggestionInputTrainee>();
  for (const t of activeGroupTrainees) traineeDirectory.set(t.id, t);
  for (const row of trackTraineeRows) {
    if (!traineeDirectory.has(row.trainee.id)) traineeDirectory.set(row.trainee.id, row.trainee);
  }
  const traineeIds = Array.from(traineeDirectory.keys());

  // Full history for every referenced trainee, regardless of which track it
  // came from - a חניך's lifetime bucket counts must not be scoped only to
  // this group's current tracks (see file header of the pure engine).
  const participantRows = traineeIds.length
    ? await prisma.teachingPracticeParticipant.findMany({
        where: { traineeId: { in: traineeIds } },
        orderBy: [
          { lesson: { date: "asc" } },
          { lesson: { startTime: "asc" } },
          { lesson: { trackId: "asc" } },
          { lessonId: "asc" },
          { id: "asc" },
        ],
        select: {
          traineeId: true,
          role: true,
          lesson: { select: { trackId: true, practiceType: true } },
        },
      })
    : [];

  const trackTrainees: TraineeSuggestionInputTrackTrainee[] = trackTraineeRows.map((r) => ({
    trackId: r.trackId,
    traineeId: r.traineeId,
    rotationOrder: r.rotationOrder,
  }));

  const participantHistory: TraineeSuggestionInputParticipantHistory[] = participantRows.map((p) => ({
    traineeId: p.traineeId,
    trackId: p.lesson.trackId,
    practiceType: p.lesson.practiceType,
    role: p.role,
  }));

  const input: ComputeTraineeSuggestionsInput = {
    groupName,
    trainees: Array.from(traineeDirectory.values()),
    tracks: tracks.map((t) => ({
      id: t.id,
      practiceType: t.practiceType,
      groupName: t.groupName,
      weekday: t.weekday,
      defaultStartTime: t.defaultStartTime,
      defaultEndTime: t.defaultEndTime,
      groupTrackId: t.groupTrackId,
    })),
    trackTrainees,
    participantHistory,
  };

  return computeTeachingPracticeTraineeSuggestions(input);
}

// Admin-only for Stage 0 (no UI/instructor entry point exists yet). Mirrors
// the requireAdmin-gated read pattern used throughout
// lib/actions/teaching-practice.ts (e.g. listTeachingPracticeTracksForAdmin).
// An instructor-facing variant can be added later the same way
// listTeachingPracticeTracksForInstructor mirrors its admin counterpart, once
// a UI actually needs it.
export async function getTeachingPracticeTraineeSuggestionsForAdmin(
  groupName: string
): Promise<ComputeTraineeSuggestionsResult> {
  await requireAdmin();
  return computeTeachingPracticeTraineeSuggestionsForGroupInternal(groupName);
}

// ---------------------------------------------------------------------------
// Stage B - trainee schedule overview ("לו״ז חניכים"). Read-only, fixed-
// structure only. Deliberately a narrower fetch than the suggestions one
// above: no participantHistory (this view has no notion of realized
// generated-lesson history at all - see ComputeTraineeScheduleInput's own
// comment), and no cross-group trainee-directory merge (unlike the
// suggestions fetch, this view only ever displays this group's own active
// trainees - a trainee mismatched into this group's fixed structure from
// another group is already surfaced elsewhere, by "בדוק שיבוץ"'s
// group_mismatch check, and is out of scope for this read-only overview).
async function computeTeachingPracticeTraineeScheduleForGroupInternal(
  groupName: string
): Promise<ComputeTraineeScheduleResult> {
  if (!TEACHING_PRACTICE_SUGGESTION_GROUP_NAMES.includes(groupName as "א" | "ב")) {
    throw new Error("קבוצה לא תקינה - יש לבחור קבוצה א או קבוצה ב");
  }

  const tracks = await prisma.teachingPracticeTrack.findMany({
    where: { groupName, isActive: true },
    orderBy: [
      { practiceType: "asc" },
      { weekday: "asc" },
      { defaultStartTime: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      practiceType: true,
      groupName: true,
      weekday: true,
      defaultStartTime: true,
      defaultEndTime: true,
      groupTrackId: true,
    },
  });
  const trackIds = tracks.map((t) => t.id);

  const trackTraineeRows = trackIds.length
    ? await prisma.teachingPracticeTrackTrainee.findMany({
        where: { trackId: { in: trackIds } },
        orderBy: [
          { trackId: "asc" },
          { rotationOrder: "asc" },
          { id: "asc" },
        ],
        select: { trackId: true, traineeId: true, rotationOrder: true },
      })
    : [];

  const activeGroupTrainees = await prisma.student.findMany({
    where: { groupName, isActive: true },
    orderBy: [
      { fullName: "asc" },
      { id: "asc" },
    ],
    select: { id: true, fullName: true, groupName: true, isActive: true },
  });

  const trackTrainees: TraineeSuggestionInputTrackTrainee[] = trackTraineeRows.map((r) => ({
    trackId: r.trackId,
    traineeId: r.traineeId,
    rotationOrder: r.rotationOrder,
  }));

  const input: ComputeTraineeScheduleInput = {
    groupName,
    trainees: activeGroupTrainees,
    tracks: tracks.map((t) => ({
      id: t.id,
      practiceType: t.practiceType,
      groupName: t.groupName,
      weekday: t.weekday,
      defaultStartTime: t.defaultStartTime,
      defaultEndTime: t.defaultEndTime,
      groupTrackId: t.groupTrackId,
    })),
    trackTrainees,
  };

  return computeTeachingPracticeTraineeSchedule(input);
}

export async function getTeachingPracticeFixedStructureTraineeScheduleForAdmin(
  groupName: string
): Promise<ComputeTraineeScheduleResult> {
  await requireAdmin();
  return computeTeachingPracticeTraineeScheduleForGroupInternal(groupName);
}

// ---------------------------------------------------------------------------
// Stage 2 (revised) - apply selected suggestions at their exact rotationOrder
// ---------------------------------------------------------------------------

const SLOT_NOT_FOUND_TRACK = "מסלול ההתנסות לא נמצא";

export interface TeachingPracticeTrackTraineeSlotAssignment {
  trackId: string;
  rotationOrder: number;
  traineeId: string;
}

export interface ApplyTeachingPracticeTrackTraineeSlotSuggestionsResult extends ActionResult {
  appliedCount?: number;
}

// All-or-nothing: every assignment is validated against a fresh DB read
// before anything is written, and only if every single one passes are they
// all created together inside one prisma.$transaction. If any assignment
// fails validation, nothing in the batch is written - this is a stricter,
// simpler guarantee than "stop at the first failure, keep whatever already
// committed" (the old per-track roster-replace approach), and is possible
// here specifically because every assignment in a batch is an independent
// single-row create, not a whole-track replace depending on the others.
//
// Preserves holes by construction: this only ever creates the exact rows
// passed in, at their exact rotationOrder - it never reads "the whole
// roster" and never deletes/recreates anything, so a track with rotationOrder
// 0 empty and rotationOrder 1 newly assigned ends with exactly one row
// (rotationOrder: 1) and nothing at rotationOrder 0, exactly as intended.
async function applyTeachingPracticeTrackTraineeSlotSuggestionsInternal(
  assignments: TeachingPracticeTrackTraineeSlotAssignment[]
): Promise<ApplyTeachingPracticeTrackTraineeSlotSuggestionsResult> {
  if (assignments.length === 0) return { success: true, appliedCount: 0 };

  // Reject internally-contradictory input before any DB read - two
  // assignments can never target the same (trackId, rotationOrder), and the
  // same trainee can never be asked for two different slots on the same
  // track in one call (mirrors the two @@unique constraints on
  // TeachingPracticeTrackTrainee this write must respect).
  const slotSeen = new Set<string>();
  const traineeTrackSeen = new Set<string>();
  for (const a of assignments) {
    const slotSeenKey = `${a.trackId}:${a.rotationOrder}`;
    const traineeTrackKey = `${a.trackId}:${a.traineeId}`;
    if (slotSeen.has(slotSeenKey)) {
      return { success: false, error: "לא ניתן לשבץ פעמיים לאותו סלוט באותה קריאה" };
    }
    if (traineeTrackSeen.has(traineeTrackKey)) {
      return { success: false, error: "לא ניתן לשבץ אותו חניך/ה ליותר מתפקיד אחד באותו מסלול באותה קריאה" };
    }
    slotSeen.add(slotSeenKey);
    traineeTrackSeen.add(traineeTrackKey);
  }

  const trackIds = Array.from(new Set(assignments.map((a) => a.trackId)));
  const traineeIds = Array.from(new Set(assignments.map((a) => a.traineeId)));

  const [tracks, trainees, existingRows] = await Promise.all([
    prisma.teachingPracticeTrack.findMany({ where: { id: { in: trackIds } } }),
    prisma.student.findMany({ where: { id: { in: traineeIds } } }),
    prisma.teachingPracticeTrackTrainee.findMany({ where: { trackId: { in: trackIds } } }),
  ]);
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const traineeById = new Map(trainees.map((t) => [t.id, t]));
  const existingByTrackId = new Map<string, typeof existingRows>();
  for (const row of existingRows) {
    const list = existingByTrackId.get(row.trackId) ?? [];
    list.push(row);
    existingByTrackId.set(row.trackId, list);
  }

  for (const a of assignments) {
    const track = trackById.get(a.trackId);
    if (!track) return { success: false, error: SLOT_NOT_FOUND_TRACK };

    // Stage B - server-side safety net, independent of whatever the client
    // already filtered (TeachingPracticeManager.tsx's isTraineeSuggestionSlotSelectable
    // already keeps a BEGINNER_GROUP slot's checkbox from ever appearing,
    // and its apply handler re-checks defensively before calling this
    // action) - this is the one place that's not optional: a BEGINNER_GROUP
    // track's own TeachingPracticeTrackTrainee rows are re-derived from its
    // linked BEGINNER_PRIVATE tracks' slot-0 trainees on every
    // fixed-structure sync (see processTrackForSync in
    // lib/teaching-practice-full-sync-core.ts), so writing here directly
    // would just be silently overwritten by the next sync - reject the
    // whole batch rather than silently dropping this one assignment, same
    // all-or-nothing guarantee as every other validation in this loop.
    if (track.practiceType === "BEGINNER_GROUP") {
      return {
        success: false,
        error: "לא ניתן להחיל הצעה ישירות על שיעור קבוצתי - הצוות נגזר מהמסלולים הפרטניים המקושרים",
      };
    }

    const trainee = traineeById.get(a.traineeId);
    if (!trainee) return { success: false, error: "אחד או יותר מהחניכים שנבחרו לא נמצאו" };
    if (!trainee.isActive) return { success: false, error: `לא ניתן לשבץ את ${trainee.fullName} - אינו/ה פעיל/ה` };
    if ((trainee.groupName ?? null) !== (track.groupName ?? null)) {
      return { success: false, error: `${trainee.fullName} אינו/ה שייך/ת לקבוצת הסלוט המבוקש` };
    }

    const expectedSize = TEACHING_PRACTICE_TEAM_SIZE[track.practiceType];
    if (!Number.isInteger(a.rotationOrder) || a.rotationOrder < 0 || a.rotationOrder >= expectedSize) {
      return { success: false, error: "מספר תפקיד לא תקין עבור סוג ההתנסות" };
    }

    const existingForTrack = existingByTrackId.get(a.trackId) ?? [];
    if (existingForTrack.some((row) => row.rotationOrder === a.rotationOrder)) {
      return {
        success: false,
        error: "הסלוט המבוקש כבר משובץ - החלפת שיבוץ קיים אינה נתמכת בשלב זה",
      };
    }
    if (existingForTrack.some((row) => row.traineeId === a.traineeId)) {
      return { success: false, error: `${trainee.fullName} כבר משובץ/ת בתפקיד אחר במסלול זה` };
    }
  }

  // createMany (not $transaction([...create()])) - matches the exact write
  // primitive setTeachingPracticeTrackTraineesInternal already uses for this
  // same model (lib/actions/teaching-practice.ts), and its input type has
  // only the scalar-FK shape (trackId/traineeId), no relation-connect
  // variant to resolve at all. A single multi-row INSERT is also already
  // atomic at the DB level, so no extra $transaction wrapper is needed here.
  await prisma.teachingPracticeTrackTrainee.createMany({
    data: assignments.map((a) => ({
      trackId: a.trackId,
      traineeId: a.traineeId,
      rotationOrder: a.rotationOrder,
    })),
  });

  return { success: true, appliedCount: assignments.length };
}

export async function applyTeachingPracticeTrackTraineeSlotSuggestionsAsAdmin(
  assignments: TeachingPracticeTrackTraineeSlotAssignment[]
): Promise<ApplyTeachingPracticeTrackTraineeSlotSuggestionsResult> {
  await requireAdmin();
  return applyTeachingPracticeTrackTraineeSlotSuggestionsInternal(assignments);
}
