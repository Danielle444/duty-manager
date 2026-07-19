// Narrow, dependency-free types shared across the instructor riding surface.
//
// Extracted out of InstructorRidingSlotsSection so the now-shared
// RidingStudentsModalController - mounted by InstructorClient, a parent of the
// riding section - no longer needs a type-only import back down into a child
// section. Deliberately contains NO runtime imports and NO React, Prisma,
// server-action, or broader domain abstraction: only plain structural types.

// Per-RidingSlot horse-planning mode. "loading" is represented by absence
// from the modeByRidingSlotId map (an undefined lookup), never a fifth enum
// value here - the server/database remains the sole source of truth for mode.
export type InstructorSlotMode = "none" | "simple" | "complex" | "error";

// Minimal trainee option the riding-students editor needs (taught-students
// picker + switch scope). Structurally a subset of InstructorClient's own
// StudentOption, so the same array flows through unchanged.
export interface RidingStudentOption {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
}
