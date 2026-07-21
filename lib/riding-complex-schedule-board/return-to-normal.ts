// RIDING-COMPLEX-SCHEDULE-BOARD - decision core for the admin-only "return this
// riding session to a normal (non-complex) session" recovery action. Pure and
// DB-free: it maps the plan's live publication status + block count to exactly
// one of four decisions, and nothing here performs (or is even aware of) the
// actual delete. The component (RidingComplexPlanEditor) renders copy and wires
// the real deleteRidingSlotComplexPlanAsAdmin call to the two *deletable*
// decisions only; this module exists so that mapping is unit-tested in isolation
// rather than buried in JSX.
//
// FAIL-CLOSED is the guiding rule:
//   - A still-published plan (CURRENT or STALE) is NEVER directly deletable -
//     the admin must unpublish first (block-until-unpublished). We deliberately
//     do NOT combine unpublish+delete into one hidden destructive step.
//   - An unknown publication status (null - still loading, or a failed status
//     fetch) is treated as NOT-deletable: without proof the plan is unpublished
//     we must never let a recovery delete a plan trainees might still be seeing.
//   Only a confirmed UNPUBLISHED plan is ever deletable, split by whether it has
//   any content (empty vs draft-with-content) purely so the confirmation copy
//   can be honest about what is (or isn't) being permanently removed.

// The same three labels ComplexRidingPlanPublicationStatus.status carries (see
// lib/actions/riding-slot-complex-publications.ts). Duplicated as a local string
// union rather than imported so this pure module stays free of any "use server"
// action-module dependency.
export type ReturnToNormalStatusLabel = "UNPUBLISHED" | "CURRENT" | "STALE";

export type ReturnToNormalDecision =
  // Publication status could not be determined (null: loading or fetch error) -
  // fail closed, offer no delete, ask the admin to refresh and retry.
  | { kind: "blocked-unknown" }
  // The plan is currently published to trainees (CURRENT or STALE) - block the
  // delete and route the admin to the existing unpublish flow first.
  | { kind: "blocked-published" }
  // Unpublished plan with no time blocks - deletable; copy states there is no
  // complex content and the session simply returns to normal.
  | { kind: "confirm-empty" }
  // Unpublished plan with content - deletable; copy enumerates that blocks,
  // stations, pairs, horses and complex assignments are permanently removed.
  | { kind: "confirm-draft" };

export function decideReturnToNormal(
  publicationStatus: ReturnToNormalStatusLabel | null,
  blockCount: number
): ReturnToNormalDecision {
  if (publicationStatus === null) return { kind: "blocked-unknown" };
  if (publicationStatus !== "UNPUBLISHED") return { kind: "blocked-published" };
  if (blockCount <= 0) return { kind: "confirm-empty" };
  return { kind: "confirm-draft" };
}

// The single authority for "may this decision proceed to the actual delete?".
// The component re-checks this at confirm time (belt-and-suspenders against a
// status that changed while the modal was open), so a delete can only ever fire
// from a confirm-empty / confirm-draft state, never from a blocked one.
export function canDeleteFromReturnToNormalDecision(decision: ReturnToNormalDecision): boolean {
  return decision.kind === "confirm-empty" || decision.kind === "confirm-draft";
}
