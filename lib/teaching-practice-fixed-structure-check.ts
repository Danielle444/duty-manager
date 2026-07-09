// Stage D1 - pure, DB-free comparison logic for the fixed-structure
// assignment check ("בדוק שיבוץ" on the fixed structure itself, as opposed
// to the existing generated-lesson-only "בדיקת שיבוץ" in
// lib/teaching-practice-schedule-check.ts). No DB access, no "use server" -
// same convention as lib/teaching-practice-rotation.ts and
// lib/teaching-practice-schedule-check.ts.
//
// Business rule: this check is always scoped to exactly one real group
// ("א"/"ב"). Both blocks of a given group always happen on the same
// logical day, so overlap comparisons are done purely on time-of-day
// windows (defaultStartTime/defaultEndTime) - weekday is never read here at
// all, matching the same deliberate choice already made in
// lib/teaching-practice-trainee-suggestions.ts's tracksMayOverlap.

import { parseTimeToMinutes } from "@/lib/teaching-practice-schedule-check";
import { TEACHING_PRACTICE_TEAM_SIZE, type TeachingPracticeTypeValue } from "@/lib/teaching-practice-rotation";

export type TeachingPracticeIssueSeverity = "error" | "warning" | "info";

export interface TeachingPracticeFixedStructureIssue {
  kind: string;
  severity: TeachingPracticeIssueSeverity;
  message: string;
  trackId?: string;
  traineeId?: string;
  childId?: string;
  relatedTrackIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface TeachingPracticeFixedStructureCheckResult {
  groupName: string;
  summary: {
    errorCount: number;
    warningCount: number;
    infoCount: number;
    tracksChecked: number;
    traineesChecked: number;
    childrenChecked: number;
  };
  errors: TeachingPracticeFixedStructureIssue[];
  warnings: TeachingPracticeFixedStructureIssue[];
  info: TeachingPracticeFixedStructureIssue[];
  perTrack: { trackId: string; issues: TeachingPracticeFixedStructureIssue[] }[];
  perTrainee: { traineeId: string; traineeName: string; issues: TeachingPracticeFixedStructureIssue[] }[];
}

export interface FixedStructureCheckTrainee {
  traineeId: string;
  fullName: string;
  rotationOrder: number;
  isActive: boolean;
  studentGroupName: string | null; // the trainee's own Student.groupName
}

export interface FixedStructureCheckChild {
  childId: string | null; // null = childless horse/equipment placeholder row
  isActive: boolean; // true when childId is null (nothing to be inactive)
  fullName: string | null;
}

export interface FixedStructureCheckTrack {
  trackId: string;
  practiceType: TeachingPracticeTypeValue;
  groupName: string | null;
  defaultStartTime: string;
  defaultEndTime: string;
  createdAt: Date;
  groupTrackId: string | null; // set only on BEGINNER_PRIVATE, points at its BEGINNER_GROUP track
  trainees: FixedStructureCheckTrainee[];
  children: FixedStructureCheckChild[];
}

export interface CheckTeachingPracticeFixedStructureInput {
  groupName: string;
  // All active tracks belonging to this group (fetch convention matches
  // lib/actions/teaching-practice-full-sync.ts / -preview.ts: linked
  // BEGINNER_PRIVATE tracks share their BEGINNER_GROUP track's groupName in
  // practice, so no separate cross-group fetch is needed here).
  tracks: FixedStructureCheckTrack[];
}

// Same ordering the fixed-structure UI already uses for linked private rows
// (compareLinkedPrivateRows in TeachingPracticeManager.tsx), replicated here
// (not imported - that comparator lives in a client component) exactly like
// lib/actions/teaching-practice-full-sync.ts and -preview.ts already do.
function compareLinkedPrivateTracks(
  a: { defaultStartTime: string; createdAt: Date; trackId: string },
  b: { defaultStartTime: string; createdAt: Date; trackId: string }
): number {
  return (
    a.defaultStartTime.localeCompare(b.defaultStartTime) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.trackId.localeCompare(b.trackId)
  );
}

// Time-window-only comparison - weekday is deliberately never read. Two
// tracks in the same group are always treated as the same logical day (see
// file header), so any time-of-day overlap is a real conflict.
function timeWindowsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// Business rule (broadened): a trainee appearing in BOTH a BEGINNER_PRIVATE
// slot and a BEGINNER_GROUP slot within the same group is always expected/
// allowed, even when the two tracks are not directly linked via
// groupTrackId - the beginner private/group flow is understood to run
// alongside itself by design. Used ONLY for trainee-overlap suppression
// (see the overlap loop below) - practiceType combination is the only thing
// that matters here, unlike the stricter, groupTrackId-checked
// isExpectedLinkedBeginnerPair below (still used for the child-duplicate
// check, where the exemption must stay scoped to the actual linked pair,
// not any private/group pair in the group).
function isBeginnerPrivateGroupPair(
  a: { practiceType: TeachingPracticeTypeValue },
  b: { practiceType: TeachingPracticeTypeValue }
): boolean {
  return (
    (a.practiceType === "BEGINNER_PRIVATE" && b.practiceType === "BEGINNER_GROUP") ||
    (a.practiceType === "BEGINNER_GROUP" && b.practiceType === "BEGINNER_PRIVATE")
  );
}

// Business rule: a BEGINNER_PRIVATE track and its OWN linked BEGINNER_GROUP
// track are expected to share children (the group's own children rows are
// derived from its linked private tracks) - this is normal, not a
// duplicate, and must never be flagged. Any other pairing (two unrelated
// tracks, two LUNGE tracks, a private/group pair that are NOT linked to
// each other, etc.) is still a genuine potential duplicate. Used ONLY for
// the child-duplicate-across-group check below - deliberately stricter
// than isBeginnerPrivateGroupPair above (which is used for trainee-overlap
// suppression and does not require an actual groupTrackId link).
function isExpectedLinkedBeginnerPair(
  a: { trackId: string; practiceType: TeachingPracticeTypeValue; groupTrackId: string | null },
  b: { trackId: string; practiceType: TeachingPracticeTypeValue; groupTrackId: string | null }
): boolean {
  if (!isBeginnerPrivateGroupPair(a, b)) return false;
  const privateSide = a.practiceType === "BEGINNER_PRIVATE" ? a : b;
  const groupSide = a.practiceType === "BEGINNER_GROUP" ? a : b;
  return privateSide.groupTrackId === groupSide.trackId;
}

function emptySummary(): TeachingPracticeFixedStructureCheckResult["summary"] {
  return { errorCount: 0, warningCount: 0, infoCount: 0, tracksChecked: 0, traineesChecked: 0, childrenChecked: 0 };
}

export function checkTeachingPracticeFixedStructure(
  input: CheckTeachingPracticeFixedStructureInput
): TeachingPracticeFixedStructureCheckResult {
  const { groupName, tracks } = input;

  const allIssues: TeachingPracticeFixedStructureIssue[] = [];
  const perTrackMap = new Map<string, TeachingPracticeFixedStructureIssue[]>();
  const traineeNameById = new Map<string, string>();
  const perTraineeMap = new Map<string, TeachingPracticeFixedStructureIssue[]>();

  function addIssue(issue: TeachingPracticeFixedStructureIssue) {
    allIssues.push(issue);
    if (issue.trackId) {
      const list = perTrackMap.get(issue.trackId) ?? [];
      list.push(issue);
      perTrackMap.set(issue.trackId, list);
    }
    if (issue.relatedTrackIds) {
      for (const relatedId of issue.relatedTrackIds) {
        const list = perTrackMap.get(relatedId) ?? [];
        list.push(issue);
        perTrackMap.set(relatedId, list);
      }
    }
    if (issue.traineeId) {
      const list = perTraineeMap.get(issue.traineeId) ?? [];
      list.push(issue);
      perTraineeMap.set(issue.traineeId, list);
    }
  }

  const childNameById = new Map<string, string>();
  for (const track of tracks) {
    for (const t of track.trainees) traineeNameById.set(t.traineeId, t.fullName);
    for (const c of track.children) {
      if (c.childId) childNameById.set(c.childId, c.fullName ?? c.childId);
    }
  }

  // -------------------------------------------------------------------
  // 1. Required trainee slots (per track)
  // -------------------------------------------------------------------
  for (const track of tracks) {
    const teamSize = TEACHING_PRACTICE_TEAM_SIZE[track.practiceType];

    if (track.practiceType === "LUNGE") {
      if (track.trainees.length < teamSize) {
        addIssue({
          kind: "missing_required_slot",
          severity: "error",
          message: `מסלול לונג' חסר חניכים - משובצים ${track.trainees.length} מתוך ${teamSize} נדרשים`,
          trackId: track.trackId,
        });
      }
    } else if (track.practiceType === "BEGINNER_PRIVATE") {
      const slot0 = track.trainees.find((t) => t.rotationOrder === 0);
      if (!slot0) {
        addIssue({
          kind: "missing_required_slot",
          severity: "error",
          message: "מסלול פרטני חסר מדריך/ה ראשי/ת (רוטציה 0)",
          trackId: track.trackId,
        });
      }
      const slot1 = track.trainees.find((t) => t.rotationOrder === 1);
      if (!slot1) {
        addIssue({
          kind: "missing_secondary_slot",
          severity: "info",
          message: "מסלול פרטני ללא מדריך/ה משני/ה (רוטציה 1) - סלוט משני, לא חובה",
          trackId: track.trackId,
        });
      }
    } else if (track.practiceType === "BEGINNER_GROUP") {
      // Deliberately never a hard error for the group track's own
      // incomplete roster - the important signal here is drift/mismatch
      // against the linked BEGINNER_PRIVATE rows, not the group track's own
      // seat count.
      const expectedGroupSize = TEACHING_PRACTICE_TEAM_SIZE.BEGINNER_GROUP;
      const linked = tracks
        .filter((t) => t.practiceType === "BEGINNER_PRIVATE" && t.groupTrackId === track.trackId)
        .slice()
        .sort(compareLinkedPrivateTracks);

      if (linked.length !== expectedGroupSize) {
        addIssue({
          kind: "beginner_group_linked_incomplete",
          severity: "warning",
          message: `לשיעור הקבוצתי מקושרים ${linked.length} מסלולים פרטניים מתוך ${expectedGroupSize} נדרשים - לא ניתן לגזור צוות קבוצתי מלא`,
          trackId: track.trackId,
          relatedTrackIds: linked.map((l) => l.trackId),
        });
      } else {
        const slot0Ids = linked.map((p) => p.trainees.find((t) => t.rotationOrder === 0)?.traineeId ?? null);
        if (slot0Ids.some((id) => id === null)) {
          addIssue({
            kind: "beginner_group_linked_missing_required_slot",
            severity: "warning",
            message: "לא ניתן לגזור צוות לשיעור הקבוצתי - חסר מדריך/ה ראשי/ת באחד המסלולים הפרטניים המקושרים",
            trackId: track.trackId,
            relatedTrackIds: linked.map((l) => l.trackId),
          });
        } else {
          const derivedIds = slot0Ids as string[]; // linked[i] -> group rotationOrder i
          const persistedIds = [...track.trainees].sort((a, b) => a.rotationOrder - b.rotationOrder).map((t) => t.traineeId);
          const driftDetected = derivedIds.length !== persistedIds.length || derivedIds.some((id, i) => id !== persistedIds[i]);
          if (driftDetected) {
            addIssue({
              kind: "beginner_group_roster_drift",
              severity: "warning",
              message: "הצוות השמור בשיעור הקבוצתי שונה מהצוות שהיה נגזר כעת מהמסלולים הפרטניים המקושרים - יעודכן בסנכרון הבא",
              trackId: track.trackId,
              relatedTrackIds: linked.map((l) => l.trackId),
              metadata: { derivedTraineeIds: derivedIds, persistedTraineeIds: persistedIds },
            });
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------
  // 2. Duplicate trainee in a required slot, within this group
  // -------------------------------------------------------------------
  const lungeAppearances = new Map<string, string[]>(); // traineeId -> trackIds
  const privateRequiredAppearances = new Map<string, string[]>();
  const groupRequiredAppearances = new Map<string, string[]>();

  for (const track of tracks) {
    if (track.practiceType === "LUNGE") {
      for (const t of track.trainees) {
        const list = lungeAppearances.get(t.traineeId) ?? [];
        list.push(track.trackId);
        lungeAppearances.set(t.traineeId, list);
      }
    } else if (track.practiceType === "BEGINNER_PRIVATE") {
      const slot0 = track.trainees.find((t) => t.rotationOrder === 0);
      if (slot0) {
        const list = privateRequiredAppearances.get(slot0.traineeId) ?? [];
        list.push(track.trackId);
        privateRequiredAppearances.set(slot0.traineeId, list);
      }
    } else if (track.practiceType === "BEGINNER_GROUP") {
      const slot0 = track.trainees.find((t) => t.rotationOrder === 0);
      if (slot0) {
        const list = groupRequiredAppearances.get(slot0.traineeId) ?? [];
        list.push(track.trackId);
        groupRequiredAppearances.set(slot0.traineeId, list);
      }
    }
  }

  for (const [traineeId, trackIds] of lungeAppearances) {
    if (trackIds.length > 1) {
      addIssue({
        kind: "duplicate_trainee_lunge",
        severity: "error",
        message: `${traineeNameById.get(traineeId) ?? traineeId} משובץ/ת ביותר ממסלול לונג' אחד בקבוצה`,
        traineeId,
        relatedTrackIds: trackIds,
      });
    }
  }
  for (const [traineeId, trackIds] of privateRequiredAppearances) {
    if (trackIds.length > 1) {
      addIssue({
        kind: "duplicate_trainee_private_required",
        severity: "error",
        message: `${traineeNameById.get(traineeId) ?? traineeId} משובץ/ת כמדריך/ה ראשי/ת ביותר ממסלול פרטני אחד בקבוצה`,
        traineeId,
        relatedTrackIds: trackIds,
      });
    }
  }
  for (const [traineeId, trackIds] of groupRequiredAppearances) {
    if (trackIds.length > 1) {
      addIssue({
        kind: "duplicate_trainee_group_required",
        severity: "error",
        message: `${traineeNameById.get(traineeId) ?? traineeId} משובץ/ת כמדריך/ה ראשי/ת ביותר משיעור קבוצתי אחד בקבוצה`,
        traineeId,
        relatedTrackIds: trackIds,
      });
    }
  }

  // -------------------------------------------------------------------
  // 3. Overlap checks, per trainee - time-of-day only, never weekday.
  //    Required appearances: LUNGE (any rotationOrder), BEGINNER_PRIVATE
  //    rotationOrder 0. Informational appearances: BEGINNER_PRIVATE
  //    rotationOrder 1, every BEGINNER_GROUP slot - matches the stated
  //    business rule that these never create noisy required-seat issues.
  //    ANY BEGINNER_PRIVATE <-> BEGINNER_GROUP pair for the same trainee is
  //    EXPECTED (see isBeginnerPrivateGroupPair) - skipped entirely, never
  //    reported at any severity, even when the two tracks aren't directly
  //    linked via groupTrackId (broadened business rule).
  // -------------------------------------------------------------------
  interface Appearance {
    trackId: string;
    practiceType: TeachingPracticeTypeValue;
    startTime: string;
    endTime: string;
    required: boolean;
  }
  const appearancesByTrainee = new Map<string, Appearance[]>();
  const tracksWithUnusableTime = new Set<string>();

  for (const track of tracks) {
    const startMin = parseTimeToMinutes(track.defaultStartTime);
    const endMin = parseTimeToMinutes(track.defaultEndTime);
    if (startMin == null || endMin == null) {
      tracksWithUnusableTime.add(track.trackId);
      continue;
    }
    for (const t of track.trainees) {
      const required =
        track.practiceType === "LUNGE" || (track.practiceType === "BEGINNER_PRIVATE" && t.rotationOrder === 0);
      const list = appearancesByTrainee.get(t.traineeId) ?? [];
      list.push({
        trackId: track.trackId,
        practiceType: track.practiceType,
        startTime: track.defaultStartTime,
        endTime: track.defaultEndTime,
        required,
      });
      appearancesByTrainee.set(t.traineeId, list);
    }
  }

  if (tracksWithUnusableTime.size > 0) {
    addIssue({
      kind: "missing_or_invalid_time_data",
      severity: "warning",
      message: `ל-${tracksWithUnusableTime.size} מסלולים קבועים בקבוצה אין שעת התחלה/סיום תקינה - לא ניתן לבדוק עבורם חפיפות זמנים`,
      relatedTrackIds: [...tracksWithUnusableTime],
    });
  }

  for (const [traineeId, appearances] of appearancesByTrainee) {
    for (let i = 0; i < appearances.length; i++) {
      for (let j = i + 1; j < appearances.length; j++) {
        const a = appearances[i];
        const b = appearances[j];
        const aStart = parseTimeToMinutes(a.startTime);
        const aEnd = parseTimeToMinutes(a.endTime);
        const bStart = parseTimeToMinutes(b.startTime);
        const bEnd = parseTimeToMinutes(b.endTime);
        if (aStart == null || aEnd == null || bStart == null || bEnd == null) continue; // already covered above
        if (!timeWindowsOverlap(aStart, aEnd, bStart, bEnd)) continue;
        // Expected: any BEGINNER_PRIVATE <-> BEGINNER_GROUP overlap for the
        // same trainee is normal, not a conflict - even when the two tracks
        // aren't directly linked via groupTrackId (broadened business rule).
        if (isBeginnerPrivateGroupPair(a, b)) continue;

        const bothRequired = a.required && b.required;
        addIssue({
          kind: bothRequired ? "overlap_required_required" : "overlap_informational",
          severity: bothRequired ? "error" : "warning",
          message: `${traineeNameById.get(traineeId) ?? traineeId} משובץ/ת בשני מסלולים קבועים חופפים בזמן בקבוצה (${a.startTime}-${a.endTime} / ${b.startTime}-${b.endTime})`,
          traineeId,
          relatedTrackIds: [a.trackId, b.trackId],
        });
      }
    }
  }

  // -------------------------------------------------------------------
  // 4. Group mismatch + 5. Inactive trainee
  // -------------------------------------------------------------------
  for (const track of tracks) {
    for (const t of track.trainees) {
      if (t.studentGroupName !== groupName) {
        addIssue({
          kind: "group_mismatch",
          severity: "error",
          message: `${t.fullName} משובץ/ת למסלול של קבוצה ${groupName} אך שייך/ת לקבוצה ${t.studentGroupName ?? "לא מוגדרת"}`,
          trackId: track.trackId,
          traineeId: t.traineeId,
        });
      }
      if (!t.isActive) {
        addIssue({
          kind: "inactive_trainee",
          severity: "error",
          message: `${t.fullName} משובץ/ת למסלול פעיל אך אינו/ה חניך/ה פעיל/ה`,
          trackId: track.trackId,
          traineeId: t.traineeId,
        });
      }
    }
  }

  // -------------------------------------------------------------------
  // 6. Children (minimal for D1)
  // -------------------------------------------------------------------
  const childrenCheckedSet = new Set<string>();
  for (const track of tracks) {
    const realChildren = track.children.filter((c): c is FixedStructureCheckChild & { childId: string } => c.childId !== null);

    const byChildId = new Map<string, number>();
    for (const c of realChildren) byChildId.set(c.childId, (byChildId.get(c.childId) ?? 0) + 1);
    for (const [childId, count] of byChildId) {
      if (count > 1) {
        addIssue({
          kind: "duplicate_child_in_track",
          severity: "error",
          message: "אותו ילד/ה משויך/ת יותר מפעם אחת לאותו מסלול",
          trackId: track.trackId,
          childId,
        });
      }
    }

    for (const c of realChildren) {
      childrenCheckedSet.add(c.childId);
      if (!c.isActive) {
        addIssue({
          kind: "inactive_child",
          severity: "warning",
          message: `${c.fullName ?? "ילד/ה"} משויך/ת למסלול פעיל אך אינו/ה פעיל/ה`,
          trackId: track.trackId,
          childId: c.childId,
        });
      }
    }

    if (realChildren.length === 0) {
      addIssue({
        kind: "no_children_assigned",
        severity: "info",
        message: "למסלול זה אין ילד/ה משויך/ת",
        trackId: track.trackId,
      });
    }
  }

  // Duplicate child ACROSS the group (not just within one track, above) -
  // same childId appearing on more than one active track in this group.
  // Expected exception: a BEGINNER_PRIVATE track and its own linked
  // BEGINNER_GROUP track are supposed to share children (the group's own
  // children rows are derived from its linked private tracks) - that
  // specific pairing is never flagged, same exemption as the trainee
  // overlap check above (isExpectedLinkedBeginnerPair). Any other repeat
  // (two unrelated tracks, two private tracks, etc.) is a genuine problem.
  const childAppearances = new Map<
    string,
    { trackId: string; practiceType: TeachingPracticeTypeValue; groupTrackId: string | null }[]
  >();
  for (const track of tracks) {
    for (const c of track.children) {
      if (c.childId === null) continue;
      const list = childAppearances.get(c.childId) ?? [];
      list.push({ trackId: track.trackId, practiceType: track.practiceType, groupTrackId: track.groupTrackId });
      childAppearances.set(c.childId, list);
    }
  }
  for (const [childId, appearances] of childAppearances) {
    if (appearances.length < 2) continue;
    let hasGenuineDuplicate = false;
    for (let i = 0; i < appearances.length && !hasGenuineDuplicate; i++) {
      for (let j = i + 1; j < appearances.length; j++) {
        if (!isExpectedLinkedBeginnerPair(appearances[i], appearances[j])) {
          hasGenuineDuplicate = true;
          break;
        }
      }
    }
    if (hasGenuineDuplicate) {
      addIssue({
        kind: "duplicate_child_across_group",
        severity: "error",
        message: `הילד/ה ${childNameById.get(childId) ?? childId} משובץ/ת ביותר ממקום אחד במבנה הקבוע.`,
        childId,
        relatedTrackIds: appearances.map((a) => a.trackId),
      });
    }
  }

  // -------------------------------------------------------------------
  // Assemble result
  // -------------------------------------------------------------------
  const summary = emptySummary();
  summary.tracksChecked = tracks.length;
  summary.traineesChecked = new Set(tracks.flatMap((t) => t.trainees.map((tt) => tt.traineeId))).size;
  summary.childrenChecked = childrenCheckedSet.size;

  const errors = allIssues.filter((i) => i.severity === "error");
  const warnings = allIssues.filter((i) => i.severity === "warning");
  const info = allIssues.filter((i) => i.severity === "info");
  summary.errorCount = errors.length;
  summary.warningCount = warnings.length;
  summary.infoCount = info.length;

  const perTrack = [...perTrackMap.entries()].map(([trackId, issues]) => ({ trackId, issues }));
  const perTrainee = [...perTraineeMap.entries()].map(([traineeId, issues]) => ({
    traineeId,
    traineeName: traineeNameById.get(traineeId) ?? traineeId,
    issues,
  }));

  return { groupName, summary, errors, warnings, info, perTrack, perTrainee };
}
