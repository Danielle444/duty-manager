// Tests for the "return this riding session to a normal session" recovery,
// available to an admin OR an authorized instructor (canReturnComplexPlanToNormal
// - the same admin-or-editable-instructor capability as unpublish). Two parts,
// both DB-free:
//   (1) pure unit tests of the decideReturnToNormal / canDelete... core, and
//   (2) source-CONTRACT assertions over RidingComplexPlanEditor.tsx that pin the
//       wiring the approved scope requires (view-independent capability-gated
//       control, reuse of the existing server actions routed by actor, delete
//       only on explicit confirm, block-until-unpublished), so a future refactor
//       cannot silently regress it back into a hidden or first-click-destructive
//       action, nor into an actor.type-only gate.
//
// Run: npx tsx --test lib/riding-complex-schedule-board/return-to-normal.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  decideReturnToNormal,
  canDeleteFromReturnToNormalDecision,
} from "./return-to-normal";

// -------------------------------------------------------------------------
// (1) Pure decision core
// -------------------------------------------------------------------------

test("unknown publication status (null) fails closed - never deletable", () => {
  assert.equal(decideReturnToNormal(null, 0).kind, "blocked-unknown");
  assert.equal(decideReturnToNormal(null, 5).kind, "blocked-unknown");
  assert.equal(canDeleteFromReturnToNormalDecision(decideReturnToNormal(null, 5)), false);
});

test("a currently-published plan (CURRENT or STALE) is blocked, regardless of content", () => {
  for (const status of ["CURRENT", "STALE"] as const) {
    for (const blocks of [0, 1, 9]) {
      const d = decideReturnToNormal(status, blocks);
      assert.equal(d.kind, "blocked-published", `${status}/${blocks}`);
      assert.equal(canDeleteFromReturnToNormalDecision(d), false, `${status}/${blocks} not deletable`);
    }
  }
});

test("an UNPUBLISHED empty plan is deletable via the confirm-empty path", () => {
  const d = decideReturnToNormal("UNPUBLISHED", 0);
  assert.equal(d.kind, "confirm-empty");
  assert.equal(canDeleteFromReturnToNormalDecision(d), true);
});

test("an UNPUBLISHED plan with content is deletable via the confirm-draft path", () => {
  const d = decideReturnToNormal("UNPUBLISHED", 3);
  assert.equal(d.kind, "confirm-draft");
  assert.equal(canDeleteFromReturnToNormalDecision(d), true);
});

test("only the two confirm-* decisions are ever deletable", () => {
  assert.equal(canDeleteFromReturnToNormalDecision({ kind: "confirm-empty" }), true);
  assert.equal(canDeleteFromReturnToNormalDecision({ kind: "confirm-draft" }), true);
  assert.equal(canDeleteFromReturnToNormalDecision({ kind: "blocked-published" }), false);
  assert.equal(canDeleteFromReturnToNormalDecision({ kind: "blocked-unknown" }), false);
});

// -------------------------------------------------------------------------
// (2) Component wiring contract (source-level, no render)
// -------------------------------------------------------------------------

const editorRaw = readFileSync(
  fileURLToPath(new URL("../components/RidingComplexPlanEditor.tsx", import.meta.url)),
  "utf8"
);
// Strip comments so code-only invariants are never satisfied (or broken) by a
// mention inside a comment. Naive strip is safe here: no `//` lives inside a
// string/regex literal in the slices we inspect.
const editorSrc = editorRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

function region(startMarker: string, endMarker: string): string {
  const start = editorSrc.indexOf(startMarker);
  assert.ok(start > -1, `start marker not found: ${startMarker}`);
  const end = editorSrc.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `end marker not found: ${endMarker}`);
  return editorSrc.slice(start, end);
}

test("recovery control uses the approved outcome-focused Hebrew copy", () => {
  assert.ok(editorSrc.includes("החזרת הרכיבה למצב רגיל"), "main action label present");
  assert.ok(
    editorSrc.includes("פעולה זו תמחק את התכנון המורכב של הרכיבה."),
    "explanation copy present"
  );
});

test("recovery control is gated by the admin-or-authorized-instructor capability, not actor.type alone", () => {
  // The render gate is the shared capability predicate (admin OR the server-
  // returned canEdit), never a bare actor.type === "admin" check - so an
  // authorized instructor sees it and a read-only/inactive instructor does not.
  assert.ok(
    editorSrc.includes('canReturnComplexPlanToNormal(actor.type === "admin", canEdit) &&'),
    "recovery control must render on the shared capability, not actor.type alone"
  );
  // ...and it remains available in the default board view AND the legacy list
  // (view-independent), the same gate as the publication toolbar.
  assert.ok(
    editorSrc.includes('(boardView || view.type === "blockList")'),
    "recovery control renders at the root of BOTH the board and legacy list presentations"
  );
  // The old admin-only gate for THIS control must be gone (no other
  // actor.type === "admin" && (boardView ...) block reintroduces it).
  assert.ok(
    !editorSrc.includes('actor.type === "admin" && (boardView || view.type === "blockList")'),
    "the recovery control must no longer be gated by actor.type alone"
  );
});

test("the legacy-list-only delete button was removed (no duplicate recovery control)", () => {
  assert.ok(
    !editorSrc.includes("מחיקת התכנון המורכב"),
    "the old legacy-only 'delete complex plan' button copy must be gone"
  );
});

test("opening the recovery modal performs NO write; delete only fires from the confirm handler", () => {
  const openBody = region("function openRecoverModal()", "function closeRecoverModal()");
  assert.ok(
    !openBody.includes("deleteRidingSlotComplexPlanAsAdmin"),
    "openRecoverModal must not call the delete action"
  );
  assert.ok(openBody.includes("setRecoverModalOpen(true)"), "openRecoverModal only opens the modal");

  const confirmBody = region("function handleConfirmReturnToNormal()", "function goToUnpublishFromRecover()");
  assert.ok(
    confirmBody.includes("deleteComplexPlan(actor, ridingSlotId)"),
    "the confirm handler is the one place that reuses the existing server action, routed by actor"
  );
  // The confirm handler must go through the actor router, never the admin action
  // directly, so an authorized instructor is never sent through the admin-only path.
  assert.ok(
    !confirmBody.includes("deleteRidingSlotComplexPlanAsAdmin"),
    "the confirm handler must not call the admin action directly"
  );
  assert.ok(
    confirmBody.includes("canDeleteFromReturnToNormalDecision(returnToNormalDecision)"),
    "the confirm handler re-checks the fail-closed decision before deleting"
  );
  assert.ok(
    confirmBody.includes('canReturnComplexPlanToNormal(actor.type === "admin", canEdit)'),
    "the confirm handler re-checks the capability, never actor.type alone"
  );
});

test("the deleteComplexPlan router selects the admin action for admin and the instructor action for instructor", () => {
  const routing = region("function deleteComplexPlan(", "type LoadStatus");
  assert.ok(
    routing.includes("deleteRidingSlotComplexPlanAsAdmin(ridingSlotId)"),
    "admin branch must call the admin delete action"
  );
  assert.ok(
    routing.includes("deleteRidingSlotComplexPlanAsInstructor(actor.instructorId, ridingSlotId)"),
    "instructor branch must call the instructor delete action"
  );
});

test("the published state is block-until-unpublished: handoff to the existing unpublish flow, never a hidden delete", () => {
  const handoff = region("function goToUnpublishFromRecover()", "function openPublishModal()");
  assert.ok(handoff.includes("openUnpublishModal()"), "routes to the existing unpublish flow");
  assert.ok(
    !handoff.includes("deleteRidingSlotComplexPlanAsAdmin"),
    "the unpublish handoff must never itself delete the plan"
  );
});
