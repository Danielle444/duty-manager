// Pure, dependency-free decision helper for which "צפייה בחניכים" tab an
// instructor lands on when opening a riding session.
//
// "complex" -> the existing "לפי שיבוץ הרכיבה" schedule tab.
// Everything else (simple, "none"/"error", a missing map entry = undefined,
// null, or any unexpected runtime value) -> the existing flat trainee-list
// tab, matching the component's own useState default.
//
// Deliberately has NO React, Prisma, server-action, auth, env, cookie, clock,
// or DB dependency: it only reads the value it is handed and returns a string
// literal. It never mutates or stores its argument, so it is safe to call on
// every openStudents without any side effect.
export type InitialStudentsTab = "list" | "schedule";

// Accepts `unknown` rather than the caller's InstructorSlotMode union so a
// missing modeByRidingSlotId entry (undefined), a null, or any unexpected
// runtime value all fall through to the same safe "list" default without the
// caller needing a pre-check. A single strict-equality check against the
// "complex" literal is the entire decision - deterministic and side-effect
// free.
export function resolveInitialStudentsTab(mode: unknown): InitialStudentsTab {
  return mode === "complex" ? "schedule" : "list";
}
