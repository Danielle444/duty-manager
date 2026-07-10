// Safety fix (post Stage E2): this file is deliberately NOT a "use server"
// module. lib/actions/teaching-practice-full-sync.ts (a real Server Action
// module) used to export syncTeachingPracticeFixedStructureTracksToGeneratedLessonsInternal
// directly - but in Next.js, EVERY exported function from a "use server"
// file becomes a client-callable Server Action endpoint, regardless of
// whether the function has its own auth check. A write-capable helper with
// no requireAdmin()/permission guard of its own must never be exported from
// such a file, no matter how "internal" its name sounds or how trusted its
// current callers are. Moving the reusable sync core here removes that
// exposure entirely: this module has no "use server" directive, so nothing
// in it is ever bundled as a callable action, no matter what's exported -
// it's just a normal, server-only TypeScript module, importable freely by
// other server-side code (Server Actions, Route Handlers, etc.) but never
// reachable directly from the client. (The `server-only` package, which
// would add a build-time guard against accidentally importing this from
// client code, is not currently a dependency of this project and no other
// file uses that pattern - not added here to avoid introducing a new
// dependency without discussion; every import path into this module today
// is already server-only by construction, since both callers are
// "use server" action files.)
//
// Stage C2 - group-scoped full fixed-structure -> generated-lessons sync
// (real apply) for Teaching Practice ("התנסויות מתחילים"). Business rule:
// the fixed structure (TeachingPracticeTrack / TeachingPracticeTrackTrainee /
// TeachingPracticeTrackChild) is the source of truth - this logic is
// allowed to overwrite a manually-edited generated lesson's
// participants/children/time/location/instructor, as long as that lesson
// has no feedback and isn't in the past.
//
// Fixed-structure model correction: the fixed structure is a MASTER
// TEMPLATE and every eligible future lesson is an INSTANCE of it - so an
// incomplete fixed structure (fewer trainees/children than the practiceType
// expects) is never a reason to skip syncing a track's lessons. "Do not
// guess" means never inventing a trainee/child for a slot nothing currently
// fills and never shifting a later rotationOrder into an earlier empty
// one's position - it does NOT mean preserving stale generated
// participants/children/fields just because the structure is incomplete.
// processTrackForSync below always fully overwrites every eligible lesson's
// fields, and replaces participants/children with exactly whatever the
// fixed structure currently has (which may be fewer than expected, or
// zero) - see its own comments for exactly how.
//
// This mirrors the comparison logic in
// lib/actions/teaching-practice-full-sync-preview.ts (the read-only dry
// run), but that file's computation helper is intentionally module-private
// (it returns sensitive Teaching Practice data and must stay unreachable
// without going through its own requireAdmin()-gated wrapper - see that
// file's header), so it isn't imported here; the same comparison shape is
// re-implemented directly against the write path below.
//
// This file does NOT modify lib/actions/teaching-practice.ts, and does NOT
// call setTeachingPracticeTrackTraineesAsAdmin / setTeachingPracticeTrackChildrenAsAdmin
// for BEGINNER_GROUP derivation (safety audit finding, see below) - the one
// reusable primitive this sync needs - the rotation formula
// (computePartialTeachingPracticeRotation, a partial-roster-safe variant of
// computeTeachingPracticeRotation - see both functions' headers in
// lib/teaching-practice-rotation.ts) - already lives in its own module and
// is imported directly.
//
// Safety audit finding (fixed): setTeachingPracticeTrackTraineesAsAdmin's
// internal implementation auto-triggers the OLD syncTeachingPracticeTrackParticipants
// side effect whenever the new roster reaches the track's exact expected
// size - which BEGINNER_GROUP derivation always does (always exactly 3
// trainees). That old sync has no past-date filter at all (would silently
// rewrite PAST lessons' participants) and skips isManualOverride lessons
// (the opposite of this file's "manual overrides never block" business
// rule). Calling it here would let a BEGINNER_GROUP roster derivation
// silently mutate lessons outside this file's own eligibility rules, before
// this file's own per-lesson loop even runs. To avoid that, BEGINNER_GROUP
// roster/children derivation is persisted below via two small,
// module-private helpers (replaceTeachingPracticeTrackTraineesForSync /
// replaceTeachingPracticeTrackChildrenForSync) that do nothing but replace
// TeachingPracticeTrackTrainee/TeachingPracticeTrackChild rows for one
// track - no generated-lesson writes, no revalidatePath, no call into any
// exported admin action. All generated-lesson writes in this file remain
// fully controlled by this file's own eligibility logic below.
//
// setTeachingPracticeTrackChildrenAsAdmin, by contrast, has no such side
// effect (confirmed by reading it: it only replaces TeachingPracticeTrackChild
// rows, no generated-lesson writes, no revalidatePath) - but it's still not
// reused here, so that BOTH derivation writes go through the same
// dedicated, minimal, fully-audited path rather than one going through an
// exported admin action and the other not.
//
// Stage E1 - the per-track processing (BEGINNER_GROUP derivation, per-lesson
// comparison/write) is shared between two entry points exported from this
// module:
//   - syncTeachingPracticeFixedStructureToGeneratedLessonsInternal(groupName) -
//     group-scoped, called only from the admin-gated
//     syncTeachingPracticeFixedStructureToGeneratedLessonsAsAdmin in
//     lib/actions/teaching-practice-full-sync.ts.
//   - syncTeachingPracticeFixedStructureTracksToGeneratedLessonsInternal(trackIds) -
//     track-scoped (Stage E1 prep, Stage E2 first real caller: called from
//     setTeachingPracticeTrackChildrenInternal in lib/actions/teaching-practice.ts
//     after a successful child/horse/equipment save). Fetches only active
//     tracks whose id is in trackIds; for any BEGINNER_GROUP track among
//     them, still fetches its linked BEGINNER_PRIVATE rows for derivation
//     (regardless of whether those private tracks are themselves in
//     trackIds) - but for a BEGINNER_PRIVATE track, does NOT automatically
//     pull in its linked BEGINNER_GROUP track; the caller must pass both ids
//     explicitly if both should be synced together.
//
// Neither exported function here has its own auth check - both are meant to
// be called only from within an already-authenticated caller (a "use server"
// action that has already run requireAdmin() or an equivalent instructor
// permission check). That is exactly why this module must never itself
// carry a "use server" directive.
//
// Scope: the group-scoped entry point is group-scoped only (groupName
// required, "א"/"ב" only) - never system-wide. The track-scoped entry point
// is scoped to exactly the track ids given - never system-wide, never
// group-wide.
//
// Eligibility (per lesson): date >= today, and no MEANINGFUL feedback
// recorded on any participant - see lib/teaching-practice-feedback.ts: an
// empty TeachingPracticeFeedback row (created merely by opening/closing the
// feedback modal without entering anything) must never block this sync. A
// lesson failing either check is left completely untouched - not one
// field, not participants, not children.
//
// Never touched, anywhere in this file: TeachingPracticeFeedback (never
// read-modified or deleted), lesson existence (no create/delete), practiceType
// (deliberately excluded from the syncable-fields list), and generation/
// date-creation logic (nothing here calls it).

import { prisma } from "@/lib/prisma";
import { parseDateKey, todayDateKey } from "@/lib/dates";
import {
  computePartialTeachingPracticeRotation,
  TEACHING_PRACTICE_TEAM_SIZE,
  type TeachingPracticeRoleValue,
  type TeachingPracticeTypeValue,
} from "@/lib/teaching-practice-rotation";
import { hasMeaningfulTeachingPracticeFeedback } from "@/lib/teaching-practice-feedback";

// Mirrors VALID_GROUP_NAMES in lib/actions/teaching-practice.ts (not
// exported from there) - same small, deliberate, self-contained duplication
// already used in lib/teaching-practice-trainee-suggestions.ts and
// lib/actions/teaching-practice-full-sync-preview.ts for the same reason.
const VALID_GROUP_NAMES = ["א", "ב"] as const;

export interface TeachingPracticeFullSyncApplyError {
  trackId: string;
  lessonId?: string;
  message: string;
}

export interface TeachingPracticeFullSyncApplyResult {
  groupName: string;
  tracksChecked: number;
  tracksSkippedNoLessons: number;
  tracksSkippedIncompleteFixedStructure: number;
  beginnerGroupRostersDerived: number;
  beginnerGroupRostersSkipped: number;
  lessonsChecked: number;
  lessonsSynced: number;
  lessonsUnchanged: number;
  lessonsSkippedFeedback: number;
  lessonsSkippedPastDate: number;
  participants: { created: number; deleted: number; unchanged: number };
  childAssignments: { created: number; deleted: number; unchanged: number };
  lessonFields: { updated: number; unchanged: number };
  errors: TeachingPracticeFullSyncApplyError[];
}

function emptyResult(groupName: string): TeachingPracticeFullSyncApplyResult {
  return {
    groupName,
    tracksChecked: 0,
    tracksSkippedNoLessons: 0,
    tracksSkippedIncompleteFixedStructure: 0,
    beginnerGroupRostersDerived: 0,
    beginnerGroupRostersSkipped: 0,
    lessonsChecked: 0,
    lessonsSynced: 0,
    lessonsUnchanged: 0,
    lessonsSkippedFeedback: 0,
    lessonsSkippedPastDate: 0,
    participants: { created: 0, deleted: 0, unchanged: 0 },
    childAssignments: { created: 0, deleted: 0, unchanged: 0 },
    lessonFields: { updated: 0, unchanged: 0 },
    errors: [],
  };
}

// Same ordering the fixed-structure UI already uses for linked private rows
// (compareLinkedPrivateRows in TeachingPracticeManager.tsx) - replicated
// here rather than imported, since that comparator lives in a client
// component file this server-only module can't import from. Byte-for-byte
// equivalent: defaultStartTime, then createdAt, then id. Same replication
// already used in lib/actions/teaching-practice-full-sync-preview.ts.
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

interface LinkedPrivateTrack {
  id: string;
  groupTrackId: string | null;
  defaultStartTime: string;
  createdAt: Date;
  trainees: { traineeId: string; rotationOrder: number }[];
  children: { childId: string | null; horseName: string | null; equipmentNotes: string | null }[];
}

// Shared select shape for the main track fetch - used identically by both
// the group-scoped and track-scoped entry points, so their results are
// structurally guaranteed to match FixedTrack.
const TRACK_SELECT = {
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
} as const;

// Shared select shape for the batched linked-BEGINNER_PRIVATE-tracks fetch.
const LINKED_PRIVATE_SELECT = {
  id: true,
  groupTrackId: true,
  defaultStartTime: true,
  createdAt: true,
  trainees: { select: { traineeId: true, rotationOrder: true } },
  children: { select: { childId: true, horseName: true, equipmentNotes: true } },
} as const;

// Replaces ONLY TeachingPracticeTrackTrainee rows for one track - no
// generated-lesson writes, no revalidatePath, no call into any exported
// admin action. Deliberately NOT setTeachingPracticeTrackTraineesInternal:
// that function auto-triggers syncTeachingPracticeTrackParticipants once the
// roster reaches the track's exact expected size (which BEGINNER_GROUP
// derivation always does), and that old sync ignores past-date eligibility
// and skips isManualOverride lessons - both wrong for this file's own rules.
//
// Takes explicit {traineeId, rotationOrder} pairs rather than a plain
// string[] indexed by array position - a BEGINNER_GROUP roster can now be
// derived from a partial set of linked private tracks (see
// processTrackForSync below), so the array may be sparse (e.g. linked
// private #2 of 3 has no slot-0 trainee yet, contributing nothing) and must
// never be compacted/reindexed by array position - each entry's
// rotationOrder is exactly the linked private's own stable link-order
// position, preserved as-is.
async function replaceTeachingPracticeTrackTraineesForSync(
  trackId: string,
  trainees: { traineeId: string; rotationOrder: number }[]
): Promise<void> {
  await prisma.$transaction([
    prisma.teachingPracticeTrackTrainee.deleteMany({ where: { trackId } }),
    prisma.teachingPracticeTrackTrainee.createMany({
      data: trainees.map(({ traineeId, rotationOrder }) => ({ trackId, traineeId, rotationOrder })),
    }),
  ]);
}

// Replaces ONLY TeachingPracticeTrackChild rows for one track - no
// generated-lesson writes, no revalidatePath, no call into any exported
// admin action. children is expected to already be deduped by childId
// (derived from other tracks' own persisted rows); no additional validation
// is performed here, for the same reason as above.
async function replaceTeachingPracticeTrackChildrenForSync(
  trackId: string,
  children: { childId: string; horseName: string | null; equipmentNotes: string | null }[]
): Promise<void> {
  await prisma.$transaction([
    prisma.teachingPracticeTrackChild.deleteMany({ where: { trackId } }),
    prisma.teachingPracticeTrackChild.createMany({
      data: children.map((c) => ({ trackId, childId: c.childId, horseName: c.horseName, equipmentNotes: c.equipmentNotes })),
    }),
  ]);
}

// Stage E1 extraction - everything that used to be the body of the
// group-scoped sync's per-track for-loop, now shared by both entry points.
// Mutates `result` in place (same convention the original loop already
// used). Byte-for-byte identical logic to before the refactor - only
// lifted out of its enclosing loop/function so a second caller (the
// track-scoped helper) can invoke it without duplicating any of it.
async function processTrackForSync(
  track: FixedTrack,
  linkedByGroupTrackId: Map<string, LinkedPrivateTrack[]>,
  todayUtc: Date,
  result: TeachingPracticeFullSyncApplyResult
): Promise<void> {
  result.tracksChecked += 1;

  if (track._count.lessons === 0) {
    result.tracksSkippedNoLessons += 1;
    return;
  }

  // Effective trainees/children for this run - normally the track's own
  // rows, but for BEGINNER_GROUP, always attempt to derive+persist them from
  // however many linked BEGINNER_PRIVATE rows currently exist (see file
  // header). "Do not guess" means never inventing a trainee/child for a
  // slot nothing currently fills - it does NOT mean skipping the derivation
  // (or the rest of this track's sync) just because fewer than the expected
  // 3 are linked. A partial derivation still fully replaces this track's own
  // TeachingPracticeTrackTrainee/TeachingPracticeTrackChild rows with
  // whatever it could actually derive - the fixed structure is the source of
  // truth even when it's incomplete, so a departed private/trainee/child
  // must disappear from here (and, below, from eligible generated lessons)
  // rather than linger.
  let effectiveTrainees = track.trainees;
  let effectiveChildren = track.children;

  if (track.practiceType === "BEGINNER_GROUP") {
    const expectedGroupSize = TEACHING_PRACTICE_TEAM_SIZE.BEGINNER_GROUP;
    // Bounded to the first expectedGroupSize (stable link order) so a rare
    // data anomaly (more than 3 privates ever linked to one group) can't
    // produce a rotationOrder >= expectedGroupSize - every real linked
    // private still gets read for the children union below regardless.
    const linked = (linkedByGroupTrackId.get(track.id) ?? []).slice().sort(compareLinkedPrivateTracks);
    const linkedForRoster = linked.slice(0, expectedGroupSize);

    if (linked.length !== expectedGroupSize) {
      result.beginnerGroupRostersSkipped += 1;
    }

    // Each linked private's slot-0 trainee maps to group rotationOrder =
    // its own stable link-order position - a private with no slot-0
    // trainee yet simply contributes no row (never a placeholder), so the
    // resulting array can be sparse/shorter than expectedGroupSize without
    // ever shifting a later private's trainee into an earlier position.
    const derivedTrainees: { traineeId: string; rotationOrder: number }[] = [];
    linkedForRoster.forEach((p, rotationOrder) => {
      const slot0TraineeId = p.trainees.find((t) => t.rotationOrder === 0)?.traineeId;
      if (slot0TraineeId) derivedTrainees.push({ traineeId: slot0TraineeId, rotationOrder });
    });

    try {
      await replaceTeachingPracticeTrackTraineesForSync(track.id, derivedTrainees);
      result.beginnerGroupRostersDerived += 1;
      effectiveTrainees = derivedTrainees;
    } catch (err) {
      result.errors.push({
        trackId: track.id,
        message: `דירוג צוות לשיעור הקבוצתי נכשל: ${err instanceof Error ? err.message : "אירעה שגיאה"}`,
      });
      // Derivation write failed - fall back to whatever this group's own
      // rows already are (set at the top of this function) rather than an
      // empty roster, so a transient DB error can't wipe a lesson's
      // participants down to nothing.
    }

    // Children: union of every currently linked private track's real
    // children, deduped by childId (first occurrence, in the same stable
    // link order, wins if horse/equipment notes ever differ between them) -
    // unaffected by the expectedGroupSize bound above, since children have
    // no rotationOrder/slot concept to misalign.
    const derivedChildrenMap = new Map<string, { childId: string; horseName: string | null; equipmentNotes: string | null }>();
    for (const p of linked) {
      for (const c of p.children) {
        if (c.childId && !derivedChildrenMap.has(c.childId)) {
          derivedChildrenMap.set(c.childId, { childId: c.childId, horseName: c.horseName, equipmentNotes: c.equipmentNotes });
        }
      }
    }
    const derivedChildren = Array.from(derivedChildrenMap.values());
    try {
      await replaceTeachingPracticeTrackChildrenForSync(track.id, derivedChildren);
      effectiveChildren = derivedChildren.map((c) => ({ childId: c.childId, horseName: c.horseName, equipmentNotes: c.equipmentNotes }));
    } catch (err) {
      result.errors.push({
        trackId: track.id,
        message: `דירוג ילדים לשיעור הקבוצתי נכשל: ${err instanceof Error ? err.message : "אירעה שגיאה"}`,
      });
    }
  }

  // Reported for visibility only (e.g. "מבנה קבוע לא שלם" in the sync
  // results panel) - no longer gates anything below. A track whose
  // currently-known trainees don't add up to the full expected team size
  // (0, 1, or 2 of 2; 0, 1, or 2 of 3) still has every eligible lesson's
  // fields/children/participants fully synced from whatever IS known -
  // missing slots are simply absent from the generated lesson, never
  // invented, never backfilled with stale data.
  const expectedTeamSize = TEACHING_PRACTICE_TEAM_SIZE[track.practiceType];
  if (effectiveTrainees.length !== expectedTeamSize) {
    result.tracksSkippedIncompleteFixedStructure += 1;
  }

  const traineeInput = [...effectiveTrainees].sort((a, b) => a.rotationOrder - b.rotationOrder);
  const targetChildAssignments = effectiveChildren
    .filter((c): c is { childId: string; horseName: string | null; equipmentNotes: string | null } => c.childId !== null)
    .map((c) => ({ childId: c.childId, horseName: c.horseName, equipmentNotes: c.equipmentNotes }));

  // Fetched in full chronological order (not date-filtered) so each
  // lesson's occurrenceIndex - needed for the rotation formula - reflects
  // its true position among ALL of this track's lessons, exactly matching
  // the existing generation/sync convention. Eligibility (past-date/
  // feedback) is applied per lesson below, after occurrenceIndex is known,
  // never by excluding a lesson from this list up front.
  const lessons = await prisma.teachingPracticeLesson.findMany({
    where: { trackId: track.id },
    orderBy: [{ date: "asc" }, { startTime: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      participants: {
        select: {
          id: true,
          traineeId: true,
          role: true,
          feedback: { select: { feedback: true, ratingHalfPoints: true } },
        },
      },
      childAssignments: { select: { id: true, childId: true, horseName: true, equipmentNotes: true, isAbsent: true } },
    },
  });

  for (let occurrenceIndex = 0; occurrenceIndex < lessons.length; occurrenceIndex++) {
    const lesson = lessons[occurrenceIndex];
    result.lessonsChecked += 1;

    if (lesson.date.getTime() < todayUtc.getTime()) {
      result.lessonsSkippedPastDate += 1;
      continue;
    }
    if (lesson.participants.some((p) => hasMeaningfulTeachingPracticeFeedback(p.feedback))) {
      result.lessonsSkippedFeedback += 1;
      continue;
    }

    try {
      // Partial-roster-safe: never throws, and never invents/shifts a
      // trainee into a rotationOrder slot nothing currently fills - see
      // computePartialTeachingPracticeRotation's own header in
      // lib/teaching-practice-rotation.ts. For a complete/dense roster this
      // produces exactly what computeTeachingPracticeRotation would.
      const roleAssignments: { traineeId: string; role: TeachingPracticeRoleValue }[] =
        computePartialTeachingPracticeRotation(track.practiceType, traineeInput, occurrenceIndex);

      // ---- Participants: compare current vs. target (traineeId+role pairs) ----
      const currentParticipantKey = new Set(lesson.participants.map((p) => `${p.traineeId}:${p.role}`));
      const targetParticipantKey = new Set(roleAssignments.map((r) => `${r.traineeId}:${r.role}`));
      const participantsMatch =
        currentParticipantKey.size === targetParticipantKey.size &&
        [...currentParticipantKey].every((k) => targetParticipantKey.has(k));

      // ---- Child assignments: compare current vs. target (childId + horse/equipment) ----
      const currentChildByChildId = new Map(lesson.childAssignments.map((c) => [c.childId, c]));
      const targetChildByChildId = new Map(targetChildAssignments.map((c) => [c.childId, c]));
      const childrenMatch =
        currentChildByChildId.size === targetChildByChildId.size &&
        [...targetChildByChildId.entries()].every(([childId, target]) => {
          const current = currentChildByChildId.get(childId);
          return current != null && current.horseName === target.horseName && current.equipmentNotes === target.equipmentNotes;
        });

      // ---- Lesson fields: startTime/endTime/location/instructor/groupName ----
      const fieldsMatch =
        lesson.startTime === track.defaultStartTime &&
        lesson.endTime === track.defaultEndTime &&
        lesson.location === track.defaultLocation &&
        lesson.responsibleInstructorId === track.defaultResponsibleInstructorId &&
        lesson.groupName === track.groupName;

      if (participantsMatch && childrenMatch && fieldsMatch) {
        result.lessonsUnchanged += 1;
        result.participants.unchanged += lesson.participants.length;
        result.childAssignments.unchanged += lesson.childAssignments.length;
        result.lessonFields.unchanged += 1;
        continue;
      }

      const writes = [];

      if (!participantsMatch) {
        writes.push(prisma.teachingPracticeParticipant.deleteMany({ where: { lessonId: lesson.id } }));
        writes.push(
          prisma.teachingPracticeParticipant.createMany({
            data: roleAssignments.map((r) => ({
              lessonId: lesson.id,
              traineeId: r.traineeId,
              role: r.role,
              isManualOverride: false,
            })),
          })
        );
      }

      if (!childrenMatch) {
        // Preserve each surviving child's isAbsent - a genuine per-
        // occurrence fact the fixed structure has no equivalent field for,
        // never something this sync should reset to false.
        writes.push(prisma.teachingPracticeChildAssignment.deleteMany({ where: { lessonId: lesson.id } }));
        writes.push(
          prisma.teachingPracticeChildAssignment.createMany({
            data: targetChildAssignments.map((c) => ({
              lessonId: lesson.id,
              childId: c.childId,
              horseName: c.horseName,
              equipmentNotes: c.equipmentNotes,
              isAbsent: currentChildByChildId.get(c.childId)?.isAbsent ?? false,
            })),
          })
        );
      }

      if (!fieldsMatch) {
        writes.push(
          prisma.teachingPracticeLesson.update({
            where: { id: lesson.id },
            data: {
              startTime: track.defaultStartTime,
              endTime: track.defaultEndTime,
              location: track.defaultLocation,
              responsibleInstructorId: track.defaultResponsibleInstructorId,
              groupName: track.groupName,
            },
          })
        );
      }

      await prisma.$transaction(writes);

      if (!participantsMatch) {
        result.participants.deleted += lesson.participants.length;
        result.participants.created += roleAssignments.length;
      } else {
        result.participants.unchanged += lesson.participants.length;
      }
      if (!childrenMatch) {
        result.childAssignments.deleted += lesson.childAssignments.length;
        result.childAssignments.created += targetChildAssignments.length;
      } else {
        result.childAssignments.unchanged += lesson.childAssignments.length;
      }
      if (!fieldsMatch) result.lessonFields.updated += 1;
      else result.lessonFields.unchanged += 1;

      result.lessonsSynced += 1;
    } catch (err) {
      result.errors.push({
        trackId: track.id,
        lessonId: lesson.id,
        message: err instanceof Error ? err.message : "אירעה שגיאה בסנכרון השיעור",
      });
    }
  }
}

// Stage E1 extraction - shared orchestration for both entry points: given
// an already-fetched list of tracks (however they were selected) and a
// label for the result's groupName field, batches the linked-private-tracks
// fetch (needed for any BEGINNER_GROUP track among them) and runs
// processTrackForSync over every track. Neither entry point below
// duplicates this logic.
async function syncTracksInternal(
  tracks: FixedTrack[],
  resultGroupName: string
): Promise<TeachingPracticeFullSyncApplyResult> {
  const result = emptyResult(resultGroupName);

  // Batched: every BEGINNER_PRIVATE track linked to any BEGINNER_GROUP track
  // among the tracks being processed, fetched once, not per-track. This
  // runs regardless of whether those linked private tracks are themselves
  // part of `tracks` - a BEGINNER_GROUP track always needs its linked rows
  // for derivation, whether it was reached via the group-scoped fetch (where
  // its linked privates are also naturally in `tracks`) or the track-scoped
  // one (where they might not be).
  const groupTrackIds = tracks.filter((t) => t.practiceType === "BEGINNER_GROUP").map((t) => t.id);
  const linkedPrivateTracks: LinkedPrivateTrack[] = groupTrackIds.length
    ? await prisma.teachingPracticeTrack.findMany({
        where: { practiceType: "BEGINNER_PRIVATE", groupTrackId: { in: groupTrackIds } },
        select: LINKED_PRIVATE_SELECT,
      })
    : [];
  const linkedByGroupTrackId = new Map<string, LinkedPrivateTrack[]>();
  for (const p of linkedPrivateTracks) {
    if (!p.groupTrackId) continue;
    const list = linkedByGroupTrackId.get(p.groupTrackId) ?? [];
    list.push(p);
    linkedByGroupTrackId.set(p.groupTrackId, list);
  }

  const todayUtc = parseDateKey(todayDateKey());

  for (const track of tracks) {
    await processTrackForSync(track, linkedByGroupTrackId, todayUtc, result);
  }

  return result;
}

// Group-scoped entry point - called only from the admin-gated
// syncTeachingPracticeFixedStructureToGeneratedLessonsAsAdmin in
// lib/actions/teaching-practice-full-sync.ts. Unchanged behavior from
// before this file was split out: group-scoped only, "א"/"ב" required.
export async function syncTeachingPracticeFixedStructureToGeneratedLessonsInternal(
  groupName: string
): Promise<TeachingPracticeFullSyncApplyResult> {
  if (!VALID_GROUP_NAMES.includes(groupName as "א" | "ב")) {
    throw new Error("קבוצה לא תקינה - יש לבחור קבוצה א או קבוצה ב");
  }

  const tracks: FixedTrack[] = await prisma.teachingPracticeTrack.findMany({
    where: { groupName, isActive: true },
    select: TRACK_SELECT,
  });

  return syncTracksInternal(tracks, groupName);
}

// Track-scoped entry point (Stage E1 prep, Stage E2 first real caller) -
// called from setTeachingPracticeTrackChildrenInternal in
// lib/actions/teaching-practice.ts after a successful child/horse/equipment
// save. Fetches only active tracks whose id is in trackIds - never
// group-wide, never system-wide. For a BEGINNER_PRIVATE track in trackIds,
// does NOT automatically also sync its linked BEGINNER_GROUP track (or vice
// versa) - the caller must include both ids explicitly if both should be
// synced together.
//
// resultGroupName is derived from whichever tracks were actually found
// (all expected to share one real group in practice) rather than accepted
// as a parameter, since track-scoped callers don't necessarily know it
// upfront - falls back to "" if no tracks matched (e.g. all ids were
// inactive or nonexistent), never throws for that case.
export async function syncTeachingPracticeFixedStructureTracksToGeneratedLessonsInternal(
  trackIds: string[]
): Promise<TeachingPracticeFullSyncApplyResult> {
  const tracks: FixedTrack[] = await prisma.teachingPracticeTrack.findMany({
    where: { id: { in: trackIds }, isActive: true },
    select: TRACK_SELECT,
  });

  const resultGroupName = tracks[0]?.groupName ?? "";
  return syncTracksInternal(tracks, resultGroupName);
}

// Stage E4 fix, now superseded (kept, see below) - originally written for
// exactly one scenario: a BEGINNER_PRIVATE track moved off of (or unlinked
// from) this BEGINNER_GROUP track while the group's own derivation still
// required exactly 3 linked privates to run at all, so an incomplete link
// count left the group's fixed structure/lessons stuck with the departed
// trainee/child. processTrackForSync above no longer has that limitation -
// it now derives (and syncs) from however many linked privates currently
// exist, 0..N, so calling the normal track-scoped sync with this group's id
// already removes a departed private's trainee/child on its own.
//
// This function is therefore redundant in practice today (its own DB reads
// will simply find nothing stale to remove, since the main sync already
// fixed it) but is left in place rather than removed, since removing it
// wasn't part of the requested fix - see the report for this stage. It
// remains fully correct and harmless to call: it never invents a
// replacement for a vacated slot, never creates/deletes a lesson, never
// touches practiceType, and applies the exact same per-lesson eligibility
// rules as the main sync (future dated lessons only, skips any lesson with
// MEANINGFUL feedback on any participant).
//
// Returns null if trackId isn't an existing, active BEGINNER_GROUP track, or
// if it currently has 3+ linked private tracks again (nothing to clean up).
export async function cleanupDepartedLinkedPrivateFromGroupInternal(
  groupTrackId: string
): Promise<{ traineesRemoved: number; childrenRemoved: number; lessonsUpdated: number } | null> {
  const group = await prisma.teachingPracticeTrack.findUnique({
    where: { id: groupTrackId },
    select: {
      id: true,
      practiceType: true,
      isActive: true,
      trainees: { select: { traineeId: true } },
      children: { select: { childId: true } },
    },
  });
  if (!group || !group.isActive || group.practiceType !== "BEGINNER_GROUP") return null;

  // Same query processTrackForSync/syncTracksInternal uses to find a
  // group's linked private tracks - deliberately not isActive-filtered, to
  // match that existing behavior exactly (an inactive-but-still-linked
  // private track counts the same way here as it does there).
  const linked = await prisma.teachingPracticeTrack.findMany({
    where: { practiceType: "BEGINNER_PRIVATE", groupTrackId },
    select: LINKED_PRIVATE_SELECT,
  });
  if (linked.length >= TEACHING_PRACTICE_TEAM_SIZE.BEGINNER_GROUP) {
    return { traineesRemoved: 0, childrenRemoved: 0, lessonsUpdated: 0 };
  }

  const sortedLinked = linked.slice().sort(compareLinkedPrivateTracks);
  const validTraineeIds = new Set(
    sortedLinked
      .map((p) => p.trainees.find((t) => t.rotationOrder === 0)?.traineeId)
      .filter((id): id is string => !!id)
  );
  const validChildIds = new Set(
    sortedLinked.flatMap((p) => p.children.map((c) => c.childId)).filter((id): id is string => !!id)
  );

  const staleTraineeIds = group.trainees.map((t) => t.traineeId).filter((id) => !validTraineeIds.has(id));
  const staleChildIds = group.children.map((c) => c.childId).filter((id): id is string => !!id && !validChildIds.has(id));

  if (staleTraineeIds.length) {
    await prisma.teachingPracticeTrackTrainee.deleteMany({
      where: { trackId: groupTrackId, traineeId: { in: staleTraineeIds } },
    });
  }
  if (staleChildIds.length) {
    await prisma.teachingPracticeTrackChild.deleteMany({
      where: { trackId: groupTrackId, childId: { in: staleChildIds } },
    });
  }

  const todayUtc = parseDateKey(todayDateKey());
  const lessons = await prisma.teachingPracticeLesson.findMany({
    where: { trackId: groupTrackId, date: { gte: todayUtc } },
    select: {
      id: true,
      participants: {
        select: { id: true, traineeId: true, feedback: { select: { feedback: true, ratingHalfPoints: true } } },
      },
      childAssignments: { select: { id: true, childId: true } },
    },
  });

  let lessonsUpdated = 0;
  for (const lesson of lessons) {
    if (lesson.participants.some((p) => hasMeaningfulTeachingPracticeFeedback(p.feedback))) continue;

    const staleParticipantIds = lesson.participants.filter((p) => !validTraineeIds.has(p.traineeId)).map((p) => p.id);
    const staleChildAssignmentIds = lesson.childAssignments
      .filter((c) => !validChildIds.has(c.childId))
      .map((c) => c.id);
    if (!staleParticipantIds.length && !staleChildAssignmentIds.length) continue;

    await prisma.$transaction([
      ...(staleParticipantIds.length
        ? [prisma.teachingPracticeParticipant.deleteMany({ where: { id: { in: staleParticipantIds } } })]
        : []),
      ...(staleChildAssignmentIds.length
        ? [prisma.teachingPracticeChildAssignment.deleteMany({ where: { id: { in: staleChildAssignmentIds } } })]
        : []),
    ]);
    lessonsUpdated += 1;
  }

  return { traineesRemoved: staleTraineeIds.length, childrenRemoved: staleChildIds.length, lessonsUpdated };
}
