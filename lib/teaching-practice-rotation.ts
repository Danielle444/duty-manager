// Pure rotation math for Teaching Practice lesson generation - no DB access,
// no "use server". Kept separate from lib/actions/teaching-practice.ts so
// the formula itself is easy to read/verify on its own.

export type TeachingPracticeTypeValue = "LUNGE" | "BEGINNER_PRIVATE" | "BEGINNER_GROUP";

export type TeachingPracticeRoleValue =
  | "LEAD_INSTRUCTOR"
  | "SECOND_INSTRUCTOR"
  | "ASSISTANT_INSTRUCTOR"
  | "EVALUATOR";

// LUNGE/BEGINNER_PRIVATE always need exactly 2 trainees, BEGINNER_GROUP
// always needs exactly 3 - the sizes computeTeachingPracticeRotation and its
// callers both validate against.
export const TEACHING_PRACTICE_TEAM_SIZE: Record<TeachingPracticeTypeValue, number> = {
  LUNGE: 2,
  BEGINNER_PRIVATE: 2,
  BEGINNER_GROUP: 3,
};

// Default display text for each role - shared by the client-side manager
// (as a fallback when a lesson has no roleLabelOverrides entry for a role)
// and the server-side Excel export, so both agree on the same wording
// without duplicating this map.
export const ROLE_LABELS: Record<TeachingPracticeRoleValue, string> = {
  LEAD_INSTRUCTOR: "מדריך ראשון",
  SECOND_INSTRUCTOR: "מדריך שני",
  ASSISTANT_INSTRUCTOR: "עוזר מדריך",
  EVALUATOR: "ממשב",
};

const TWO_ROLE_ROTATION: TeachingPracticeRoleValue[] = ["LEAD_INSTRUCTOR", "ASSISTANT_INSTRUCTOR"];
const THREE_ROLE_ROTATION: TeachingPracticeRoleValue[] = [
  "LEAD_INSTRUCTOR",
  "SECOND_INSTRUCTOR",
  "EVALUATOR",
];

export interface TeachingPracticeRotationTrainee {
  traineeId: string;
  rotationOrder: number;
}

export interface TeachingPracticeRotationResult {
  traineeId: string;
  role: TeachingPracticeRoleValue;
}

// occurrenceIndex is 0-based ("how many lessons this track has generated
// already"): 0 = the first lesson, 1 = the second, etc.
//
// Both team sizes use one formula: the trainee at rotationOrder i gets
// roleList[((i - occurrenceIndex) % size + size) % size], where roleList is
// [LEAD, ASSISTANT] for a 2-person team or [LEAD, SECOND, EVALUATOR] for a
// 3-person team. Verified against the product spec's own worked examples -
// see the self-check in the Stage 2 report.
//
// Throws if the trainee count doesn't match what practiceType requires -
// callers are expected to validate team size themselves first (this is a
// safety net, not the primary validation path).
export function computeTeachingPracticeRotation(
  practiceType: TeachingPracticeTypeValue,
  trainees: TeachingPracticeRotationTrainee[],
  occurrenceIndex: number
): TeachingPracticeRotationResult[] {
  const roles = practiceType === "BEGINNER_GROUP" ? THREE_ROLE_ROTATION : TWO_ROLE_ROTATION;
  const expectedSize = TEACHING_PRACTICE_TEAM_SIZE[practiceType];

  if (trainees.length !== expectedSize) {
    throw new Error(
      practiceType === "BEGINNER_GROUP"
        ? "התנסות מתחילים קבוצתית דורשת בדיוק 3 חניכים בצוות"
        : "התנסות זו דורשת בדיוק 2 חניכים בצוות"
    );
  }

  const sorted = [...trainees].sort((a, b) => a.rotationOrder - b.rotationOrder);
  return sorted.map((trainee, i) => {
    const roleIndex = (((i - occurrenceIndex) % expectedSize) + expectedSize) % expectedSize;
    return { traineeId: trainee.traineeId, role: roles[roleIndex] };
  });
}

// Partial-roster-safe variant, used only by the fixed-structure ->
// generated-lesson sync (lib/teaching-practice-full-sync-core.ts) - that
// sync's business rule is "fully overwrite eligible lessons from whatever
// the fixed structure currently has," even when the structure isn't (yet)
// a complete team, so it can never call computeTeachingPracticeRotation
// above (which requires an exact team size and would either throw or,
// worse, need array-index-based sorting that silently shifts a later slot
// into an earlier empty one's position - exactly the compaction bug fixed
// elsewhere in this codebase for trainee-slot edits).
//
// Same role formula as above, but keyed directly off each trainee's own
// rotationOrder value instead of its position in a sorted/filtered array -
// so a lone trainee at rotationOrder 1 (rotationOrder 0 empty) keeps
// rotating through rotationOrder 1's own role sequence, never rotationOrder
// 0's. Never invents a trainee for a missing rotationOrder: the result
// simply has fewer entries than expectedSize when the roster is incomplete.
// For a complete, dense roster (rotationOrder 0..expectedSize-1 all
// present), this produces byte-for-byte the same result as
// computeTeachingPracticeRotation, since rotationOrder and sorted-array
// index coincide in that case - this is a strict generalization, not a
// different formula. Never throws.
export function computePartialTeachingPracticeRotation(
  practiceType: TeachingPracticeTypeValue,
  trainees: TeachingPracticeRotationTrainee[],
  occurrenceIndex: number
): TeachingPracticeRotationResult[] {
  const roles = practiceType === "BEGINNER_GROUP" ? THREE_ROLE_ROTATION : TWO_ROLE_ROTATION;
  const expectedSize = TEACHING_PRACTICE_TEAM_SIZE[practiceType];

  return trainees.map((trainee) => {
    const roleIndex = (((trainee.rotationOrder - occurrenceIndex) % expectedSize) + expectedSize) % expectedSize;
    return { traineeId: trainee.traineeId, role: roles[roleIndex] };
  });
}

// Manager enters only a start time; duration is fixed per practiceType, not
// user-editable - end time is always derived from these two, both here (for
// the UI's live preview) and, authoritatively, server-side in
// lib/actions/teaching-practice.ts (never trusting a client-submitted end
// time).
export const TEACHING_PRACTICE_DURATION_MINUTES: Record<TeachingPracticeTypeValue, number> = {
  LUNGE: 30,
  BEGINNER_PRIVATE: 30,
  BEGINNER_GROUP: 60,
};

// Pure "HH:MM" arithmetic - no Date object involved, so it can't be skewed
// by timezone. Wraps past midnight (e.g. "23:45" + 30 -> "00:15") rather
// than throwing, since a lesson time is just a time-of-day, not a real
// instant. Returns null for an unparsable input so callers can show/reject
// a clear "invalid time" state instead of silently producing "NaN:NaN".
export function addMinutesToTimeString(time: string, minutesToAdd: number): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  const totalMinutes = (((hours * 60 + minutes + minutesToAdd) % 1440) + 1440) % 1440;
  const resultHours = Math.floor(totalMinutes / 60);
  const resultMinutes = totalMinutes % 60;
  return `${String(resultHours).padStart(2, "0")}:${String(resultMinutes).padStart(2, "0")}`;
}
