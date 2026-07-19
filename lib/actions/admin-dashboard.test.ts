/**
 * MULTI-COURSE W8A-8D - executable tests for the PURE (DI) orchestrator behind
 * the admin dashboard's "students without horse" attention statistic.
 *
 * Run with: npx tsx --test lib/actions/admin-dashboard.test.ts
 * No Prisma, no DB, no clock: both dependencies are injected fakes, so this
 * exercises only the known-error -> null / unexpected-error -> rethrow contract
 * and the id-passthrough behavior.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveStudentsWithoutHorseCount } from "./admin-dashboard";
import {
  NoCurrentCourseOfferingError,
  AmbiguousCourseOfferingError,
  IncompleteCourseOfferingError,
} from "@/lib/course/current-offering";

/** A count dep that must never be called; fails loudly if it is. */
function countMustNotBeCalled(): (id: string) => Promise<number> {
  return () => {
    throw new Error("countActiveEnrollmentsMissingHorse must not be called");
  };
}

test("no-current-offering error degrades the statistic to null", async () => {
  const result = await resolveStudentsWithoutHorseCount({
    resolveCurrentCourseOffering: async () => {
      throw new NoCurrentCourseOfferingError();
    },
    countActiveEnrollmentsMissingHorse: countMustNotBeCalled(),
  });
  assert.equal(result, null);
});

test("ambiguous-current-offering error degrades the statistic to null", async () => {
  const result = await resolveStudentsWithoutHorseCount({
    resolveCurrentCourseOffering: async () => {
      throw new AmbiguousCourseOfferingError(["offer-1", "offer-2"]);
    },
    countActiveEnrollmentsMissingHorse: countMustNotBeCalled(),
  });
  assert.equal(result, null);
});

test("incomplete-current-offering error degrades the statistic to null", async () => {
  const result = await resolveStudentsWithoutHorseCount({
    resolveCurrentCourseOffering: async () => {
      throw new IncompleteCourseOfferingError("offer-1");
    },
    countActiveEnrollmentsMissingHorse: countMustNotBeCalled(),
  });
  assert.equal(result, null);
});

test("an unexpected resolver error rethrows (fail loud)", async () => {
  const boom = new Error("unexpected DB outage");
  await assert.rejects(
    resolveStudentsWithoutHorseCount({
      resolveCurrentCourseOffering: async () => {
        throw boom;
      },
      countActiveEnrollmentsMissingHorse: countMustNotBeCalled(),
    }),
    (err: unknown) => err === boom,
  );
});

test("success: count receives the exact resolved offering id and its number passes through", async () => {
  let seenId: string | null = null;
  const result = await resolveStudentsWithoutHorseCount({
    resolveCurrentCourseOffering: async () => ({ id: "offer-current" }),
    countActiveEnrollmentsMissingHorse: async (courseOfferingId) => {
      seenId = courseOfferingId;
      return 7;
    },
  });
  assert.equal(seenId, "offer-current");
  assert.equal(result, 7);
});

test("a count error rethrows (never absorbed as a null offering result)", async () => {
  const boom = new Error("count query failed");
  await assert.rejects(
    resolveStudentsWithoutHorseCount({
      resolveCurrentCourseOffering: async () => ({ id: "offer-current" }),
      countActiveEnrollmentsMissingHorse: async () => {
        throw boom;
      },
    }),
    (err: unknown) => err === boom,
  );
});

test("count is not invoked when offering resolution fails structurally", async () => {
  let called = false;
  const result = await resolveStudentsWithoutHorseCount({
    resolveCurrentCourseOffering: async () => {
      throw new NoCurrentCourseOfferingError();
    },
    countActiveEnrollmentsMissingHorse: async () => {
      called = true;
      return 0;
    },
  });
  assert.equal(result, null);
  assert.equal(called, false);
});
