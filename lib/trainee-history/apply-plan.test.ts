/**
 * Executable tests for the PURE half of the effective-dated write engine
 * (Stage GH2A1): policy-shape / actor-domain / future-date validation, the
 * whole pre-transaction pipeline (which touches NO database), the horse
 * field-policy gate, today-resolution decisions, and placeholder/outcome shape.
 *
 * Run with: npx tsx --test lib/trainee-history/apply-plan.test.ts
 *
 * PURE: these tests never open a transaction. `preparePreTransaction` returns
 * before any DB access, so no Prisma query is ever issued here.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  PLANNER_PLACEHOLDER_ID,
  checkFutureEffectiveDate,
  enforceHorseFieldPolicy,
  preparePreTransaction,
  resolveTodayDecision,
  successOutcome,
  validateActorDomain,
  validatePolicyShape,
  type PublicErrorCode,
  type WritePolicy,
} from "./apply-plan";
import type { IntervalRow } from "./interval-resolver";

// A trusted instant whose Israel-local day (summer, UTC+3) is 2026-07-18.
const NOW = new Date("2026-07-18T09:00:00.000Z");
const CUTOVER = "2026-07-18";

function policy(overrides: Partial<WritePolicy> = {}): WritePolicy {
  return {
    actorKind: "admin",
    allowFutureEffectiveDates: false,
    allowedDomain: "group",
    cutover: CUTOVER,
    ...overrides,
  };
}

const okNormalize = () => ({ ok: true as const, value: { tag: "v" } });

function preCode(result: { ok: boolean; code?: PublicErrorCode }): PublicErrorCode {
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("unreachable");
  }
  return result.code as PublicErrorCode;
}

// ---------------------------------------------------------------------------
// validatePolicyShape
// ---------------------------------------------------------------------------

test("validatePolicyShape: accepts a well-formed policy, rejects malformed", () => {
  assert.equal(validatePolicyShape(policy()), true);
  assert.equal(validatePolicyShape(null), false);
  assert.equal(validatePolicyShape("nope"), false);
  assert.equal(validatePolicyShape({ ...policy(), actorKind: "root" }), false);
  assert.equal(validatePolicyShape({ ...policy(), allowedDomain: "other" }), false);
  assert.equal(validatePolicyShape({ ...policy(), allowFutureEffectiveDates: "yes" }), false);
  assert.equal(validatePolicyShape({ ...policy(), cutover: 20260718 }), false);
  assert.equal(
    validatePolicyShape({ ...policy(), allowedDomain: "horse", allowedHorseFields: ["nope"] }),
    false,
  );
});

// ---------------------------------------------------------------------------
// validateActorDomain
// ---------------------------------------------------------------------------

test("validateActorDomain: domain and trainee rules", () => {
  assert.equal(validateActorDomain(policy({ allowedDomain: "group" }), "group"), null);
  assert.equal(validateActorDomain(policy({ allowedDomain: "group" }), "horse"), "UNAUTHORIZED_ACTOR");
  // trainee is horse-only
  assert.equal(
    validateActorDomain(policy({ actorKind: "trainee", allowedDomain: "group" }), "group"),
    "UNAUTHORIZED_ACTOR",
  );
  // trainee horse but no allowedHorseFields → UNAUTHORIZED_ACTOR
  assert.equal(
    validateActorDomain(policy({ actorKind: "trainee", allowedDomain: "horse" }), "horse"),
    "UNAUTHORIZED_ACTOR",
  );
  // trainee horse with allowedHorseFields → ok
  assert.equal(
    validateActorDomain(
      policy({ actorKind: "trainee", allowedDomain: "horse", allowedHorseFields: ["hasPrivateHorse"] }),
      "horse",
    ),
    null,
  );
});

// ---------------------------------------------------------------------------
// checkFutureEffectiveDate
// ---------------------------------------------------------------------------

test("checkFutureEffectiveDate: non-future always allowed", () => {
  assert.equal(checkFutureEffectiveDate(policy(), "2026-07-18", "2026-07-18"), null);
  assert.equal(checkFutureEffectiveDate(policy(), "2026-07-01", "2026-07-18"), null);
});

test("checkFutureEffectiveDate: admin future allowed only when configured", () => {
  assert.equal(
    checkFutureEffectiveDate(policy({ allowFutureEffectiveDates: true }), "2026-08-01", "2026-07-18"),
    null,
  );
  assert.equal(
    checkFutureEffectiveDate(policy({ allowFutureEffectiveDates: false }), "2026-08-01", "2026-07-18"),
    "UNAUTHORIZED_ACTOR",
  );
});

test("checkFutureEffectiveDate: instructor/trainee future codes", () => {
  assert.equal(
    checkFutureEffectiveDate(policy({ actorKind: "instructor" }), "2026-08-01", "2026-07-18"),
    "INSTRUCTOR_FUTURE_CHANGE",
  );
  assert.equal(
    checkFutureEffectiveDate(
      policy({ actorKind: "trainee", allowedDomain: "horse", allowedHorseFields: [] }),
      "2026-08-01",
      "2026-07-18",
    ),
    "TRAINEE_FUTURE_CHANGE",
  );
});

// ---------------------------------------------------------------------------
// enforceHorseFieldPolicy
// ---------------------------------------------------------------------------

test("enforceHorseFieldPolicy: omitted list means no restriction", () => {
  const locked = { assignedHorseName: "Bella", hasPrivateHorse: false, privateHorseName: null };
  const requested = { assignedHorseName: null, hasPrivateHorse: true, privateHorseName: "Star" };
  assert.equal(enforceHorseFieldPolicy(policy({ allowedDomain: "horse" }), locked, requested), null);
});

test("enforceHorseFieldPolicy: forbidden changed field → UNAUTHORIZED_ACTOR", () => {
  const locked = { assignedHorseName: "Bella", hasPrivateHorse: false, privateHorseName: null };
  const requested = { assignedHorseName: "Rocky", hasPrivateHorse: false, privateHorseName: null };
  const p = policy({ actorKind: "trainee", allowedDomain: "horse", allowedHorseFields: ["hasPrivateHorse"] });
  assert.equal(enforceHorseFieldPolicy(p, locked, requested), "UNAUTHORIZED_ACTOR");
});

test("enforceHorseFieldPolicy: allowed changed field passes; empty list default-denies", () => {
  const locked = { assignedHorseName: null, hasPrivateHorse: false, privateHorseName: null };
  const requested = { assignedHorseName: null, hasPrivateHorse: true, privateHorseName: null };
  const allow = policy({ actorKind: "trainee", allowedDomain: "horse", allowedHorseFields: ["hasPrivateHorse"] });
  assert.equal(enforceHorseFieldPolicy(allow, locked, requested), null);
  const deny = policy({ actorKind: "trainee", allowedDomain: "horse", allowedHorseFields: [] });
  assert.equal(enforceHorseFieldPolicy(deny, locked, requested), "UNAUTHORIZED_ACTOR");
  // no change at all is always fine, even with an empty allow-list
  assert.equal(enforceHorseFieldPolicy(deny, locked, locked), null);
});

// ---------------------------------------------------------------------------
// preparePreTransaction (no DB access on any path)
// ---------------------------------------------------------------------------

test("preparePreTransaction: invalid policy shape → UNAUTHORIZED_ACTOR", () => {
  assert.equal(
    preCode(
      preparePreTransaction({ domain: "group", policy: null, effectiveFrom: CUTOVER, now: NOW, normalize: okNormalize }),
    ),
    "UNAUTHORIZED_ACTOR",
  );
});

test("preparePreTransaction: wrong actor/domain → UNAUTHORIZED_ACTOR", () => {
  assert.equal(
    preCode(
      preparePreTransaction({
        domain: "group",
        policy: policy({ actorKind: "trainee", allowedDomain: "group" }),
        effectiveFrom: CUTOVER,
        now: NOW,
        normalize: okNormalize,
      }),
    ),
    "UNAUTHORIZED_ACTOR",
  );
});

test("preparePreTransaction: malformed cutover → INTERVAL_INVARIANT_FAILURE", () => {
  assert.equal(
    preCode(
      preparePreTransaction({
        domain: "group",
        policy: policy({ cutover: "2026-13-40" }),
        effectiveFrom: "2026-07-20",
        now: NOW,
        normalize: okNormalize,
      }),
    ),
    "INTERVAL_INVARIANT_FAILURE",
  );
});

test("preparePreTransaction: malformed effectiveFrom → INTERVAL_INVARIANT_FAILURE", () => {
  assert.equal(
    preCode(
      preparePreTransaction({
        domain: "group",
        policy: policy(),
        effectiveFrom: "2026-99-99",
        now: NOW,
        normalize: okNormalize,
      }),
    ),
    "INTERVAL_INVARIANT_FAILURE",
  );
});

test("preparePreTransaction: normalization failure propagates", () => {
  assert.equal(
    preCode(
      preparePreTransaction({
        domain: "group",
        policy: policy(),
        effectiveFrom: "2026-07-20",
        now: NOW,
        normalize: () => ({ ok: false as const, code: "INVALID_GROUP" }),
      }),
    ),
    "INVALID_GROUP",
  );
});

test("preparePreTransaction: effectiveFrom before cutover → BEFORE_CUTOVER", () => {
  assert.equal(
    preCode(
      preparePreTransaction({
        domain: "group",
        policy: policy({ cutover: "2026-07-18" }),
        effectiveFrom: "2026-07-01",
        now: NOW,
        normalize: okNormalize,
      }),
    ),
    "BEFORE_CUTOVER",
  );
});

test("preparePreTransaction: admin future disallowed → UNAUTHORIZED_ACTOR", () => {
  assert.equal(
    preCode(
      preparePreTransaction({
        domain: "group",
        policy: policy({ allowFutureEffectiveDates: false }),
        effectiveFrom: "2026-08-01",
        now: NOW,
        normalize: okNormalize,
      }),
    ),
    "UNAUTHORIZED_ACTOR",
  );
});

test("preparePreTransaction: instructor future → INSTRUCTOR_FUTURE_CHANGE", () => {
  assert.equal(
    preCode(
      preparePreTransaction({
        domain: "group",
        policy: policy({ actorKind: "instructor" }),
        effectiveFrom: "2026-08-01",
        now: NOW,
        normalize: okNormalize,
      }),
    ),
    "INSTRUCTOR_FUTURE_CHANGE",
  );
});

test("preparePreTransaction: trainee future → TRAINEE_FUTURE_CHANGE", () => {
  assert.equal(
    preCode(
      preparePreTransaction({
        domain: "horse",
        policy: policy({ actorKind: "trainee", allowedDomain: "horse", allowedHorseFields: ["hasPrivateHorse"] }),
        effectiveFrom: "2026-08-01",
        now: NOW,
        normalize: okNormalize,
      }),
    ),
    "TRAINEE_FUTURE_CHANGE",
  );
});

test("preparePreTransaction: trainee missing allowedHorseFields → UNAUTHORIZED_ACTOR", () => {
  assert.equal(
    preCode(
      preparePreTransaction({
        domain: "horse",
        policy: policy({ actorKind: "trainee", allowedDomain: "horse" }),
        effectiveFrom: "2026-07-18",
        now: NOW,
        normalize: okNormalize,
      }),
    ),
    "UNAUTHORIZED_ACTOR",
  );
});

test("preparePreTransaction: success derives Israel-local today and carries value", () => {
  const result = preparePreTransaction({
    domain: "group",
    policy: policy({ allowFutureEffectiveDates: true }),
    effectiveFrom: "2026-08-01",
    now: NOW,
    normalize: () => ({ ok: true as const, value: { tag: "ok" } }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("unreachable");
  }
  assert.equal(result.today, "2026-07-18");
  assert.equal(result.effectiveFrom, "2026-08-01");
  assert.deepEqual(result.value, { tag: "ok" });
});

// ---------------------------------------------------------------------------
// resolveTodayDecision
// ---------------------------------------------------------------------------

interface Tagged {
  tag: string;
}

const taggedAdapter = {
  emptyValue: { tag: "" } as Tagged,
  valuesEqual: (a: Tagged, b: Tagged) => a.tag === b.tag,
};

const TWO_INTERVAL_ROWS: IntervalRow<Tagged>[] = [
  { id: "1", effectiveFrom: "2026-07-18", effectiveTo: "2026-08-01", value: { tag: "cutoverVal" } },
  { id: "2", effectiveFrom: "2026-08-01", effectiveTo: null, value: { tag: "todayVal" } },
];

test("resolveTodayDecision: resolves at TODAY, not cutover", () => {
  // today 2026-08-15 is covered by row 2 (todayVal), distinct from cutover row.
  const decision = resolveTodayDecision(TWO_INTERVAL_ROWS, "2026-08-15", { tag: "cutoverVal" }, taggedAdapter);
  assert.equal(decision.resolvedValue.tag, "todayVal");
  assert.equal(decision.resolvedTodayChanged, true);
});

test("resolveTodayDecision: a future row leaves today's cache unchanged", () => {
  // today 2026-07-20 is still covered by row 1 (== locked cache), despite the
  // future row 2 existing → no cache change.
  const decision = resolveTodayDecision(TWO_INTERVAL_ROWS, "2026-07-20", { tag: "cutoverVal" }, taggedAdapter);
  assert.equal(decision.resolvedValue.tag, "cutoverVal");
  assert.equal(decision.resolvedTodayChanged, false);
});

// ---------------------------------------------------------------------------
// placeholder id + outcome shape
// ---------------------------------------------------------------------------

test("planner placeholder id never surfaces in the outcome", () => {
  assert.equal(typeof PLANNER_PLACEHOLDER_ID, "string");
  const outcome = successOutcome(true);
  assert.deepEqual(Object.keys(outcome).sort(), ["ok", "resolvedTodayChanged"]);
  assert.equal(JSON.stringify(outcome).includes(PLANNER_PLACEHOLDER_ID), false);
});
