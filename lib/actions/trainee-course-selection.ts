"use server";

import { listTraineeCourseOptions as listTraineeCourseOptionsInternal } from "@/lib/course/actor-course-offering";
import {
  NoTraineeCourseOfferingError,
  AmbiguousTraineeCourseOfferingError,
} from "@/lib/course/actor-course-offering-core";
import type { TraineeCourseOptionView } from "@/lib/course/trainee-course-selection-core";

// Re-export the option view type for the trainee client. This MUST be a direct
// `export type { ... } from "<module>"` re-export, NOT a bare `export type { X };`
// of the local `import type` binding above: inside a "use server" file Turbopack's
// server-action transform treats a bare local type re-export as a runtime export
// and emits `registerServerReference(TraineeCourseOptionView, ...)`, crashing every
// trainee action module at evaluation with "TraineeCourseOptionView is not defined".
// The `from`-clause form is erased at build time (see instructor-course-options.ts).
export type { TraineeCourseOptionView } from "@/lib/course/trainee-course-selection-core";

/**
 * LEVEL 2 SLICE L2-DUAL - the courses the authenticated trainee may ask for on the
 * SCHEDULE and CONTACTS screens.
 *
 * Takes NO arguments: the trainee comes from the signed session, and a menu is
 * never keyed by what the caller asked for. Options are derived ONLY from that
 * trainee's own ACTIVE CourseEnrollments into ACTIVE CourseOfferings - never from
 * the temporary instructor allow-list, a Level 1 constant, the legacy singleton
 * current-offering resolver, a date window, a course level, an offering name or a
 * cookie.
 *
 * THIS IS A MENU, NOT AN AUTHORIZATION. Appearing here means only "this trainee
 * may ASK for this course context, for those two modules". It unlocks no other
 * trainee module (duties, materials, messages/tasks, weekly feedback and Teaching
 * Practice all keep the committed no-argument resolver and stay fail-closed), and
 * it authorizes no read: getWeeklyScheduleSelectionForTrainee,
 * getScheduleForStudent and getInstructorContacts each independently re-resolve
 * the chosen id against this same enrollment set before reading anything.
 *
 * An unresolvable trainee course context yields [] - the same "nothing to choose"
 * outcome as a trainee with no eligible enrollment at all, so no denial reason is
 * distinguishable. A session fault or any other error propagates: it must never be
 * laundered into "this trainee simply has no courses".
 */
export async function listTraineeCourseOptions(): Promise<TraineeCourseOptionView[]> {
  try {
    return await listTraineeCourseOptionsInternal();
  } catch (error) {
    if (
      error instanceof NoTraineeCourseOfferingError ||
      error instanceof AmbiguousTraineeCourseOfferingError
    ) {
      return [];
    }
    throw error;
  }
}
