"use server";

// Stage A - read-only diagnostic report comparing the Teaching Practice
// ("התנסויות מתחילים") fixed structure (TeachingPracticeTrack /
// TeachingPracticeTrackTrainee / TeachingPracticeTrackChild) against already-
// generated lessons (TeachingPracticeLesson / TeachingPracticeParticipant /
// TeachingPracticeChildAssignment), to show the מנהלת exactly where and why
// a generated lesson doesn't reflect the current fixed-structure data.
//
// Strictly read-only: every Prisma call in this file is a find/count. There
// is no create/update/delete/upsert anywhere here, and no revalidatePath -
// this file cannot write to the database even by accident, since it never
// imports a mutating Prisma method at all.
//
// This is a new, separate file rather than an addition to
// lib/actions/teaching-practice.ts, matching the same convention already
// established for lib/actions/teaching-practice-suggestions.ts: a read-only
// diagnostic/preview concern is kept out of the main CRUD/write-action
// module so that file's own "do not touch" scope (generation, sync, manual-
// override handling) stays undisturbed and easy to audit in isolation.
//
// Context (see prior audit report): most fixed-structure fields are
// deliberately materialized once, at generation time, and never resynced -
// that's expected, documented behavior, not a bug. Trainees get a narrow,
// conditional resync path (syncTeachingPracticeTrackParticipants, triggered
// only when a track's roster is saved at exactly its full team size).
// Children have no resync path at all - confirmed by inspection, not
// inferred. BEGINNER_GROUP tracks have a further, structural mismatch: the
// fixed-structure UI's Beginners-block view never exposes an inline editor
// for a BEGINNER_GROUP track's own roster (only for its linked
// BEGINNER_PRIVATE rows), while lesson generation reads only that
// BEGINNER_GROUP track's own TeachingPracticeTrackTrainee/TrackChild rows -
// never anything derived from the linked private rows. This file surfaces
// all of the above as data, not as a fix.

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { TEACHING_PRACTICE_TEAM_SIZE, type TeachingPracticeTypeValue } from "@/lib/teaching-practice-rotation";

export interface TeachingPracticeBeginnerGroupDiagnostic {
  // Trainees
  ownRosterEmpty: boolean;
  linkedPrivateTrackCount: number;
  linkedPrivateTracksHaveTrainees: boolean;
  // True exactly when the UI's Beginners-block display would show a
  // non-empty derived roster (from linked private rows' own slot-0) while
  // the group track's own roster - the thing generation actually reads - is
  // empty. This is the concrete "UI/generation mismatch" condition.
  mismatchDetected: boolean;
  // Children - same shape, for the equivalent child-side mismatch.
  ownChildRosterEmpty: boolean;
  linkedPrivateTracksHaveChildren: boolean;
  childMismatchDetected: boolean;
}

export interface TeachingPracticeTrackDiagnostic {
  trackId: string;
  practiceType: TeachingPracticeTypeValue;
  groupName: string | null;
  weekday: number | null;
  defaultStartTime: string;
  defaultEndTime: string;
  defaultLocation: string | null;

  generatedLessonCount: number;

  fixedTraineeCount: number;
  expectedTeamSize: number;
  isTraineeRosterComplete: boolean;

  // Aggregate participant stats across this track's generated lessons.
  // "fewer than expected" deliberately excludes zero (see the two counted
  // separately) so the two buckets never overlap/double-count.
  lessonsWithZeroParticipants: number;
  lessonsWithFewerParticipantsThanExpected: number;
  // Counts every lesson where syncTeachingPracticeTrackParticipants' own
  // skip condition would apply - i.e. would never touch it even if a resync
  // ran right now - regardless of whether that lesson's participant count
  // currently looks "stale". This mirrors the real skip logic exactly, not
  // an approximation.
  lessonsProtectedByManualOverride: number;
  lessonsProtectedByFeedback: number;

  // Fixed-structure child count excludes the null-childId horse/equipment
  // placeholder row (see TeachingPracticeTrackChild.childId doc) - that row
  // was never meant to materialize onto a lesson at all.
  fixedChildCount: number;
  lessonsWithZeroChildren: number;
  // Only meaningful (and only ever counted) when fixedChildCount > 0 - a
  // track with no real children configured has nothing to be "missing".
  lessonsWithFewerChildrenThanFixedStructure: number;

  // Present only for practiceType === "BEGINNER_GROUP".
  beginnerGroup: TeachingPracticeBeginnerGroupDiagnostic | null;

  // Per-track summary flags - true only when the CURRENT fixed structure
  // actually has data that isn't reflected in already-generated lessons.
  // Deliberately false when the fixed structure itself is incomplete/empty,
  // since "fewer participants than an incomplete roster's own size" is
  // expected, not stale.
  hasStaleOrMissingTrainees: boolean;
  hasStaleOrMissingChildren: boolean;
}

export interface TeachingPracticeSyncDiagnosticsResult {
  generatedAt: string;
  tracks: TeachingPracticeTrackDiagnostic[];
  summary: {
    totalActiveTracks: number;
    totalGeneratedLessonsChecked: number;
    tracksWithStaleOrMissingTrainees: number;
    tracksWithStaleOrMissingChildren: number;
    beginnerGroupMismatchTracks: number;
    // Union count (never double-counted) of lessons that a resync would
    // skip today for any reason (manual override and/or feedback), across
    // every track.
    protectedLessonsCount: number;
    // Always false - a fixed, informational marker (not derived from any
    // query) confirming the known gap: no child-assignment sync path exists
    // anywhere in the codebase today, so every "fewer/zero children" number
    // above will only ever grow over time until one is built.
    childSyncPathExists: false;
  };
}

async function getTeachingPracticeSyncDiagnosticsInternal(): Promise<TeachingPracticeSyncDiagnosticsResult> {
  const tracks = await prisma.teachingPracticeTrack.findMany({
    where: { isActive: true },
    select: {
      id: true,
      practiceType: true,
      groupName: true,
      weekday: true,
      defaultStartTime: true,
      defaultEndTime: true,
      defaultLocation: true,
      groupTrackId: true,
      trainees: { select: { id: true } },
      children: { select: { childId: true } },
      lessons: {
        select: {
          id: true,
          participants: {
            select: {
              isManualOverride: true,
              feedback: { select: { id: true } },
            },
          },
          childAssignments: { select: { id: true } },
        },
      },
    },
  });

  const groupTrackIds = tracks.filter((t) => t.practiceType === "BEGINNER_GROUP").map((t) => t.id);
  const linkedPrivateTracks = groupTrackIds.length
    ? await prisma.teachingPracticeTrack.findMany({
        where: { practiceType: "BEGINNER_PRIVATE", groupTrackId: { in: groupTrackIds } },
        select: {
          groupTrackId: true,
          trainees: { select: { id: true } },
          children: { select: { childId: true } },
        },
      })
    : [];
  const linkedPrivateByGroupTrackId = new Map<string, typeof linkedPrivateTracks>();
  for (const p of linkedPrivateTracks) {
    if (!p.groupTrackId) continue;
    const list = linkedPrivateByGroupTrackId.get(p.groupTrackId) ?? [];
    list.push(p);
    linkedPrivateByGroupTrackId.set(p.groupTrackId, list);
  }

  let totalGeneratedLessonsChecked = 0;
  let tracksWithStaleOrMissingTrainees = 0;
  let tracksWithStaleOrMissingChildren = 0;
  let beginnerGroupMismatchTracks = 0;
  let protectedLessonsCount = 0;

  const trackDiagnostics: TeachingPracticeTrackDiagnostic[] = tracks.map((track) => {
    const expectedTeamSize = TEACHING_PRACTICE_TEAM_SIZE[track.practiceType];
    const fixedTraineeCount = track.trainees.length;
    const isTraineeRosterComplete = fixedTraineeCount === expectedTeamSize;
    const fixedChildCount = track.children.filter((c) => c.childId !== null).length;

    totalGeneratedLessonsChecked += track.lessons.length;

    let lessonsWithZeroParticipants = 0;
    let lessonsWithFewerParticipantsThanExpected = 0;
    let lessonsProtectedByManualOverride = 0;
    let lessonsProtectedByFeedback = 0;
    let lessonsWithZeroChildren = 0;
    let lessonsWithFewerChildrenThanFixedStructure = 0;

    for (const lesson of track.lessons) {
      const participantCount = lesson.participants.length;
      if (participantCount === 0) lessonsWithZeroParticipants += 1;
      else if (participantCount < expectedTeamSize) lessonsWithFewerParticipantsThanExpected += 1;

      const isManualProtected = lesson.participants.some((p) => p.isManualOverride);
      const isFeedbackProtected = lesson.participants.some((p) => p.feedback);
      if (isManualProtected) lessonsProtectedByManualOverride += 1;
      if (isFeedbackProtected) lessonsProtectedByFeedback += 1;
      if (isManualProtected || isFeedbackProtected) protectedLessonsCount += 1;

      const childCount = lesson.childAssignments.length;
      if (childCount === 0) lessonsWithZeroChildren += 1;
      else if (fixedChildCount > 0 && childCount < fixedChildCount) lessonsWithFewerChildrenThanFixedStructure += 1;
    }

    const hasStaleOrMissingTrainees =
      isTraineeRosterComplete && (lessonsWithZeroParticipants > 0 || lessonsWithFewerParticipantsThanExpected > 0);
    const hasStaleOrMissingChildren =
      fixedChildCount > 0 && (lessonsWithZeroChildren > 0 || lessonsWithFewerChildrenThanFixedStructure > 0);

    if (hasStaleOrMissingTrainees) tracksWithStaleOrMissingTrainees += 1;
    if (hasStaleOrMissingChildren) tracksWithStaleOrMissingChildren += 1;

    let beginnerGroup: TeachingPracticeBeginnerGroupDiagnostic | null = null;
    if (track.practiceType === "BEGINNER_GROUP") {
      const linked = linkedPrivateByGroupTrackId.get(track.id) ?? [];
      const ownRosterEmpty = fixedTraineeCount === 0;
      const linkedPrivateTracksHaveTrainees = linked.some((p) => p.trainees.length > 0);
      const ownChildRosterEmpty = fixedChildCount === 0;
      const linkedPrivateTracksHaveChildren = linked.some((p) => p.children.some((c) => c.childId !== null));

      const mismatchDetected = ownRosterEmpty && linkedPrivateTracksHaveTrainees;
      const childMismatchDetected = ownChildRosterEmpty && linkedPrivateTracksHaveChildren;

      beginnerGroup = {
        ownRosterEmpty,
        linkedPrivateTrackCount: linked.length,
        linkedPrivateTracksHaveTrainees,
        mismatchDetected,
        ownChildRosterEmpty,
        linkedPrivateTracksHaveChildren,
        childMismatchDetected,
      };
      if (mismatchDetected || childMismatchDetected) beginnerGroupMismatchTracks += 1;
    }

    return {
      trackId: track.id,
      practiceType: track.practiceType,
      groupName: track.groupName,
      weekday: track.weekday,
      defaultStartTime: track.defaultStartTime,
      defaultEndTime: track.defaultEndTime,
      defaultLocation: track.defaultLocation,
      generatedLessonCount: track.lessons.length,
      fixedTraineeCount,
      expectedTeamSize,
      isTraineeRosterComplete,
      lessonsWithZeroParticipants,
      lessonsWithFewerParticipantsThanExpected,
      lessonsProtectedByManualOverride,
      lessonsProtectedByFeedback,
      fixedChildCount,
      lessonsWithZeroChildren,
      lessonsWithFewerChildrenThanFixedStructure,
      beginnerGroup,
      hasStaleOrMissingTrainees,
      hasStaleOrMissingChildren,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    tracks: trackDiagnostics,
    summary: {
      totalActiveTracks: tracks.length,
      totalGeneratedLessonsChecked,
      tracksWithStaleOrMissingTrainees,
      tracksWithStaleOrMissingChildren,
      beginnerGroupMismatchTracks,
      protectedLessonsCount,
      childSyncPathExists: false,
    },
  };
}

export async function getTeachingPracticeSyncDiagnosticsForAdmin(): Promise<TeachingPracticeSyncDiagnosticsResult> {
  await requireAdmin();
  return getTeachingPracticeSyncDiagnosticsInternal();
}
