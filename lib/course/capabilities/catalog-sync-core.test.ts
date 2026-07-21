/**
 * W0-CAP-3 — executable tests for the PURE catalog synchronization planner and
 * drift validator.
 *
 * Run with: npx tsx --test lib/course/capabilities/catalog-sync-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env.
 * Every "snapshot" below is a plain array fixture — nothing reads a database.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { CAPABILITY_KEYS } from "./capability-keys";
import { INITIAL_CAPABILITY_LABELS } from "./capability-labels";
import {
  formatCatalogWrites,
  planCatalogSync,
  validateCatalogState,
  type CatalogRowInput,
} from "./catalog-sync-core";

/** The exact snapshot a correct catalog-sync converges to. */
function synchronizedSnapshot(): CatalogRowInput[] {
  return CAPABILITY_KEYS.map((key) => ({
    key,
    label: INITIAL_CAPABILITY_LABELS[key],
    isActive: true,
  }));
}

// --- State: empty catalog ----------------------------------------------------

test("empty catalog plans exactly ten inserts with the exact initial labels", () => {
  const plan = planCatalogSync([]);
  assert.equal(plan.blocked, false);
  assert.equal(plan.writes.length, 10);
  assert.equal(plan.counts.inserts, 10);
  assert.equal(plan.counts.retirements, 0);
  assert.equal(plan.counts.reactivations, 0);

  for (const write of plan.writes) {
    assert.equal(write.kind, "insert");
    if (write.kind !== "insert") continue;
    assert.equal(write.label, INITIAL_CAPABILITY_LABELS[write.key]);
  }
  assert.deepEqual(
    plan.writes.map((w) => w.key).sort(),
    [...CAPABILITY_KEYS].sort(),
  );
});

// --- State: synchronized -----------------------------------------------------

test("fully synchronized active catalog produces no changes", () => {
  const plan = planCatalogSync(synchronizedSnapshot());
  assert.equal(plan.blocked, false);
  assert.equal(plan.writes.length, 0);
  assert.equal(plan.isNoOp, true);
  assert.deepEqual([...plan.findings], []);
});

test("rerun on the expected synchronized snapshot is a no-op and validates clean", () => {
  const snapshot = synchronizedSnapshot();
  const first = planCatalogSync(snapshot);
  const second = planCatalogSync(snapshot);
  assert.deepEqual(first, second);
  assert.equal(second.isNoOp, true);

  const validation = validateCatalogState(snapshot);
  assert.equal(validation.ok, true);
  assert.equal(validation.repairable.length, 0);
  assert.equal(validation.blockers.length, 0);
});

test("applying the empty-catalog plan logically yields the synchronized state", () => {
  const applied: CatalogRowInput[] = planCatalogSync([]).writes.flatMap((w) =>
    w.kind === "insert" ? [{ key: w.key, label: w.label, isActive: true }] : [],
  );
  assert.equal(planCatalogSync(applied).isNoOp, true);
});

// --- obsolete keys -----------------------------------------------------------

test("active obsolete key plans retirement, never a delete", () => {
  const plan = planCatalogSync([
    ...synchronizedSnapshot(),
    { key: "LEGACY_EXAMS", label: "מבחנים", isActive: true },
  ]);
  assert.equal(plan.blocked, false);
  assert.equal(plan.writes.length, 1);
  assert.deepEqual(plan.writes[0], { kind: "retire", key: "LEGACY_EXAMS" });
  assert.equal(plan.counts.retirements, 1);
  assert.ok(
    plan.findings.some((f) => f.code === "OBSOLETE_ACTIVE_KEY" && f.key === "LEGACY_EXAMS"),
  );
});

test("inactive obsolete key stays unchanged (informational no-op)", () => {
  const plan = planCatalogSync([
    ...synchronizedSnapshot(),
    { key: "LEGACY_EXAMS", label: "מבחנים", isActive: false },
  ]);
  assert.equal(plan.blocked, false);
  assert.equal(plan.writes.length, 0);
  assert.equal(plan.isNoOp, true);
  const f = plan.findings.find((x) => x.key === "LEGACY_EXAMS");
  assert.equal(f?.code, "OBSOLETE_INACTIVE_KEY");
  assert.equal(f?.severity, "INFO");
});

// --- inactive canonical key --------------------------------------------------

function snapshotWithInactive(key: string): CatalogRowInput[] {
  return synchronizedSnapshot().map((r) =>
    r.key === key ? { ...r, isActive: false } : r,
  );
}

test("inactive canonical key blocks ordinary sync and plans zero writes", () => {
  const plan = planCatalogSync(snapshotWithInactive("RIDING"));
  assert.equal(plan.blocked, true);
  assert.equal(plan.writes.length, 0);
  assert.equal(plan.counts.inserts, 0);
  const blocker = plan.blockers.find((b) => b.key === "RIDING");
  assert.equal(blocker?.code, "INACTIVE_CANONICAL_KEY");
  assert.equal(blocker?.severity, "DECISION_REQUIRED");
});

test("inactive canonical key never reactivates implicitly", () => {
  const plan = planCatalogSync(snapshotWithInactive("RIDING"));
  assert.ok(!plan.writes.some((w) => w.kind === "reactivate"));
});

test("validateCatalogState is fail-closed on an inactive canonical key", () => {
  const v = validateCatalogState(snapshotWithInactive("DUTIES"));
  assert.equal(v.ok, false);
  assert.equal(v.blockers.length, 1);
});

// --- explicit reactivation ---------------------------------------------------

test("explicit valid reactivation plans only the reactivation and preserves the label", () => {
  const rows = snapshotWithInactive("RIDING").map((r) =>
    r.key === "RIDING" ? { ...r, label: "רכיבות (שם ערוך)" } : r,
  );
  const plan = planCatalogSync(rows, { reactivate: ["RIDING"] });

  assert.equal(plan.blocked, false);
  assert.equal(plan.writes.length, 1);
  assert.deepEqual(plan.writes[0], { kind: "reactivate", key: "RIDING" });
  assert.equal(plan.counts.reactivations, 1);
  // The write vocabulary carries no label, so the stored label cannot be touched.
  assert.ok(!("label" in plan.writes[0]));
  assert.ok(
    plan.findings.some((f) => f.code === "LABEL_DIFFERS_FROM_INITIAL" && f.key === "RIDING"),
  );
});

test("reactivating an unknown key is fatal and blocks all writes", () => {
  const plan = planCatalogSync([], { reactivate: ["NOT_A_CAPABILITY"] });
  assert.equal(plan.blocked, true);
  assert.equal(plan.writes.length, 0);
  assert.ok(plan.blockers.some((b) => b.code === "UNKNOWN_REACTIVATION_KEY"));
});

test("reactivating an already-active canonical key is fatal", () => {
  const plan = planCatalogSync(synchronizedSnapshot(), { reactivate: ["RIDING"] });
  assert.equal(plan.blocked, true);
  assert.equal(plan.writes.length, 0);
  assert.ok(
    plan.blockers.some(
      (b) => b.code === "REACTIVATION_TARGET_NOT_INACTIVE" && b.key === "RIDING",
    ),
  );
});

test("reactivating a canonical key that has no row at all is fatal", () => {
  const rows = synchronizedSnapshot().filter((r) => r.key !== "RIDING");
  const plan = planCatalogSync(rows, { reactivate: ["RIDING"] });
  assert.equal(plan.blocked, true);
  assert.equal(plan.writes.length, 0);
  assert.ok(plan.blockers.some((b) => b.code === "REACTIVATION_TARGET_NOT_INACTIVE"));
});

test("a valid reactivation does not unblock an unrelated fatal problem", () => {
  const rows = [
    ...snapshotWithInactive("RIDING"),
    { key: "  ", label: "x", isActive: true },
  ];
  const plan = planCatalogSync(rows, { reactivate: ["RIDING"] });
  assert.equal(plan.blocked, true);
  assert.equal(plan.writes.length, 0);
});

// --- labels are never rewritten ----------------------------------------------

test("an edited label is preserved and reported informationally, never updated", () => {
  const rows = synchronizedSnapshot().map((r) =>
    r.key === "DUTIES" ? { ...r, label: "תורנויות (עודכן ידנית)" } : r,
  );
  const plan = planCatalogSync(rows);

  assert.equal(plan.blocked, false);
  assert.equal(plan.writes.length, 0, "a label difference must plan no write");
  const f = plan.findings.find((x) => x.key === "DUTIES");
  assert.equal(f?.code, "LABEL_DIFFERS_FROM_INITIAL");
  assert.equal(f?.severity, "INFO");
  // Informational only: validation still passes.
  assert.equal(validateCatalogState(rows).ok, true);
});

test("no plan can express a label update or a delete", () => {
  const messy: CatalogRowInput[] = [
    ...synchronizedSnapshot().map((r) =>
      r.key === "MESSAGES" ? { ...r, label: "שונה" } : r,
    ),
    { key: "OLD_ONE", label: "ישן", isActive: true },
    { key: "OLD_TWO", label: "ישן", isActive: false },
  ];
  const plan = planCatalogSync(messy);
  const kinds = new Set(plan.writes.map((w) => w.kind));
  for (const kind of kinds) {
    assert.ok(["insert", "retire", "reactivate"].includes(kind), `unexpected kind ${kind}`);
  }
  assert.ok(!kinds.has("delete" as never));
  assert.ok(!kinds.has("update-label" as never));
});

// --- impossible input --------------------------------------------------------

test("duplicate input rows are fatal and produce zero writes", () => {
  const rows = [
    ...synchronizedSnapshot(),
    { key: "RIDING", label: "רכיבות", isActive: true },
  ];
  const plan = planCatalogSync(rows);
  assert.equal(plan.blocked, true);
  assert.equal(plan.writes.length, 0);
  const b = plan.blockers.find((x) => x.code === "DUPLICATE_INPUT_ROW");
  assert.equal(b?.key, "RIDING");
  assert.equal(b?.severity, "FATAL");
});

test("malformed rows (blank key, untrimmed key, blank label) are fatal", () => {
  for (const bad of [
    { key: "", label: "x", isActive: true },
    { key: " RIDING ", label: "x", isActive: true },
    { key: "SOMETHING", label: "   ", isActive: true },
  ] satisfies CatalogRowInput[]) {
    const plan = planCatalogSync([bad]);
    assert.equal(plan.blocked, true, `expected blocked for ${JSON.stringify(bad)}`);
    assert.equal(plan.writes.length, 0);
    assert.ok(plan.blockers.some((f) => f.code === "MALFORMED_INPUT_ROW"));
  }
});

test("all blockers are reported in one pass, not just the first", () => {
  const rows: CatalogRowInput[] = [
    ...snapshotWithInactive("RIDING").map((r) =>
      r.key === "DUTIES" ? { ...r, isActive: false } : r,
    ),
    { key: "", label: "x", isActive: true },
    { key: "LEGACY_EXAMS", label: "מבחנים", isActive: true },
    { key: "LEGACY_EXAMS", label: "מבחנים", isActive: true },
  ];
  const plan = planCatalogSync(rows);
  const codes = new Set(plan.blockers.map((b) => b.code));
  assert.ok(codes.has("INACTIVE_CANONICAL_KEY"));
  assert.ok(codes.has("MALFORMED_INPUT_ROW"));
  assert.ok(codes.has("DUPLICATE_INPUT_ROW"));
  assert.equal(
    plan.blockers.filter((b) => b.code === "INACTIVE_CANONICAL_KEY").length,
    2,
    "both inactive canonical keys must be reported",
  );
  assert.equal(plan.writes.length, 0);
});

// --- determinism -------------------------------------------------------------

test("shuffled input produces identical, sorted output", () => {
  const base: CatalogRowInput[] = [
    ...synchronizedSnapshot().filter(
      (r) => r.key !== "RIDING" && r.key !== "SCHEDULE",
    ),
    { key: "ZZ_OLD", label: "ישן", isActive: true },
    { key: "AA_OLD", label: "ישן", isActive: true },
  ];
  const shuffled = [...base].reverse();

  const planA = planCatalogSync(base);
  const planB = planCatalogSync(shuffled);
  assert.deepEqual(planA, planB);

  // Writes: inserts first (sorted), then retirements (sorted).
  assert.deepEqual(formatCatalogWrites(planA.writes).length, 4);
  assert.deepEqual(
    planA.writes.map((w) => `${w.kind}:${w.key}`),
    ["insert:RIDING", "insert:SCHEDULE", "retire:AA_OLD", "retire:ZZ_OLD"],
  );
  // Findings are sorted by key, then code.
  const keys = planA.findings.map((f) => f.key);
  assert.deepEqual(keys, [...keys].sort());
});

test("a mixed repairable snapshot plans inserts and retirements together", () => {
  const rows: CatalogRowInput[] = [
    ...synchronizedSnapshot().filter((r) => r.key !== "TEACHING_PRACTICE"),
    { key: "OLD_MODULE", label: "ישן", isActive: true },
  ];
  const plan = planCatalogSync(rows);
  assert.equal(plan.blocked, false);
  assert.equal(plan.counts.inserts, 1);
  assert.equal(plan.counts.retirements, 1);
  assert.equal(validateCatalogState(rows).ok, false);
  assert.equal(validateCatalogState(rows).repairable.length, 2);
});
