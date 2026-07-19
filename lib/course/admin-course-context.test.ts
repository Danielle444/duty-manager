/**
 * MULTI-COURSE (dormant foundation, Slice 2) - executable tests for the admin
 * CourseOffering context resolver.
 *
 * Run with: npx tsx --test lib/course/admin-course-context.test.ts
 * DB-FREE: the orchestration is tested through injected fakes; no Prisma, no
 * network, no auth stack, no cookie, no env.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOfferingId, type CourseOfferingView } from "./offering-by-id-core";
import type { CurrentAdmin } from "@/lib/auth/require-admin";
import {
  requireAdminCourseOfferingWithDeps,
  CourseOfferingNotFoundError,
  type AdminCourseContextDeps,
} from "./admin-course-context";

const ADMIN: CurrentAdmin = { email: "admin@example.test", name: "Admin" };

function offering(over: Partial<CourseOfferingView> = {}): CourseOfferingView {
  return {
    id: "off-1",
    activityYearId: "year-1",
    name: "קורס מדריכים ומאמנים – רמה 1",
    level: 1,
    startDate: new Date("2026-07-05T00:00:00.000Z"),
    endDate: new Date("2026-07-31T00:00:00.000Z"),
    status: "PLANNED",
    ...over,
  };
}

/**
 * Build fakes that record the exact call order and the ids the reader received.
 * The reader fake mirrors the REAL Slice 1 reader: it normalizes the id and
 * returns null for empty/whitespace/unknown - so "fail closed" is a property of
 * the same contract production uses, not a hand-tuned stub.
 */
function makeDeps(options: {
  admin?: () => Promise<CurrentAdmin>;
  table?: Map<string, CourseOfferingView>;
}): { deps: AdminCourseContextDeps; calls: string[]; lookedUp: string[] } {
  const calls: string[] = [];
  const lookedUp: string[] = [];
  const table = options.table ?? new Map<string, CourseOfferingView>();

  const deps: AdminCourseContextDeps = {
    requireAdmin:
      options.admin ??
      (async () => {
        calls.push("admin");
        return ADMIN;
      }),
    getCourseOfferingById: async (id: string) => {
      calls.push("lookup");
      lookedUp.push(id);
      const normalized = normalizeOfferingId(id);
      if (normalized === null) {
        return null;
      }
      return table.get(normalized) ?? null;
    },
  };
  return { deps, calls, lookedUp };
}

// --- A. ordering: admin authorization before offering lookup -----------------

test("admin authorization runs before the offering lookup", async () => {
  const table = new Map([["off-1", offering()]]);
  const { deps, calls } = makeDeps({ table });
  await requireAdminCourseOfferingWithDeps("off-1", deps);
  assert.deepEqual(calls, ["admin", "lookup"]);
});

test("a redirecting/unauthorized admin prevents the offering lookup entirely", async () => {
  const lookedUp: string[] = [];
  // Simulate requireAdmin() redirecting: Next.js redirect() throws. The reader
  // must never be reached.
  const deps: AdminCourseContextDeps = {
    requireAdmin: async () => {
      throw new Error("NEXT_REDIRECT");
    },
    getCourseOfferingById: async (id: string) => {
      lookedUp.push(id);
      return offering();
    },
  };
  await assert.rejects(
    () => requireAdminCourseOfferingWithDeps("off-1", deps),
    /NEXT_REDIRECT/,
  );
  assert.deepEqual(lookedUp, [], "offering lookup must not run when admin fails");
});

// --- B. fail-closed on empty / whitespace / missing --------------------------

test("empty id fails closed with the typed not-found error", async () => {
  const { deps, lookedUp } = makeDeps({});
  await assert.rejects(
    () => requireAdminCourseOfferingWithDeps("", deps),
    (err: unknown) => {
      assert.ok(err instanceof CourseOfferingNotFoundError);
      assert.equal(err.requestedId, "");
      assert.equal(err.code, "COURSE_OFFERING_NOT_FOUND");
      return true;
    },
  );
  // Fail-closed still occurs AFTER admin authorization, via the reader contract.
  assert.deepEqual(lookedUp, [""]);
});

test("whitespace-only id fails closed with the typed not-found error", async () => {
  const { deps } = makeDeps({});
  await assert.rejects(
    () => requireAdminCourseOfferingWithDeps("   \t\n ", deps),
    (err: unknown) => {
      assert.ok(err instanceof CourseOfferingNotFoundError);
      return true;
    },
  );
});

test("missing offering throws the typed not-found error", async () => {
  const table = new Map([["off-1", offering()]]);
  const { deps } = makeDeps({ table });
  await assert.rejects(
    () => requireAdminCourseOfferingWithDeps("does-not-exist", deps),
    (err: unknown) => {
      assert.ok(err instanceof CourseOfferingNotFoundError);
      assert.equal(err.requestedId, "does-not-exist");
      return true;
    },
  );
});

test("not-found error keeps a structured requestedId but a generic message (no reflection)", async () => {
  const suppliedId = "PWN'; DROP TABLE offerings;--";
  const { deps } = makeDeps({});
  await assert.rejects(
    () => requireAdminCourseOfferingWithDeps(suppliedId, deps),
    (err: unknown) => {
      assert.ok(err instanceof CourseOfferingNotFoundError);
      // requestedId remains available for server-side diagnostics...
      assert.equal(err.requestedId, suppliedId);
      assert.equal(err.code, "COURSE_OFFERING_NOT_FOUND");
      // ...but the human-readable message is generic and reflects no input.
      assert.equal(err.message, "CourseOffering not found.");
      assert.doesNotMatch(err.message, /DROP TABLE/);
      return true;
    },
  );
});

// --- C. exact offering returned; no fallback ---------------------------------

test("the exact requested offering is returned unchanged as the narrow context", async () => {
  const requested = offering({ id: "off-42", activityYearId: "year-9", level: 3 });
  const table = new Map([
    ["off-42", requested],
    ["off-other", offering({ id: "off-other" })],
  ]);
  const { deps, lookedUp } = makeDeps({ table });

  const ctx = await requireAdminCourseOfferingWithDeps("off-42", deps);

  assert.deepEqual(Object.keys(ctx).sort(), [
    "activityYearId",
    "endDate",
    "id",
    "level",
    "name",
    "startDate",
    "status",
  ]);
  assert.deepEqual(ctx, {
    id: "off-42",
    activityYearId: "year-9",
    name: requested.name,
    level: 3,
    startDate: requested.startDate,
    endDate: requested.endDate,
    status: "PLANNED",
  });
  // Only the exact requested id was looked up - never a second/fallback lookup.
  assert.deepEqual(lookedUp, ["off-42"]);
});

test("returned context is frozen (immutable narrow context)", async () => {
  const table = new Map([["off-1", offering()]]);
  const { deps } = makeDeps({ table });
  const ctx = await requireAdminCourseOfferingWithDeps("off-1", deps);
  assert.ok(Object.isFrozen(ctx));
});

// --- D. read status is never auto-rejected -----------------------------------

test("PLANNED, ACTIVE and ARCHIVED can all be returned for reads", async () => {
  for (const status of ["PLANNED", "ACTIVE", "ARCHIVED"] as const) {
    const table = new Map([["off-1", offering({ status })]]);
    const { deps } = makeDeps({ table });
    const ctx = await requireAdminCourseOfferingWithDeps("off-1", deps);
    assert.equal(ctx.status, status);
  }
});

// --- E. no write policy, no cookie/session selection -------------------------

test("resolver invokes no write policy and reads no cookie/session selection", async () => {
  // The deps interface exposes ONLY requireAdmin + getCourseOfferingById. There
  // is no cookie reader, no current-offering resolver and no write-policy hook to
  // inject, which structurally proves this read-context resolver cannot fall back
  // to another offering, authorize a write, or read a course-selection cookie.
  const table = new Map([["off-1", offering()]]);
  const { deps, calls } = makeDeps({ table });
  await requireAdminCourseOfferingWithDeps("off-1", deps);
  assert.deepEqual(calls, ["admin", "lookup"]);
});
