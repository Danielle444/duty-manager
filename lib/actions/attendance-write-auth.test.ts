/**
 * ATT-SEC-2 - focused tests for the session-bound instructor attendance WRITE
 * orchestration (lib/actions/attendance-write-auth.ts).
 *
 * These exercise the dependency-injected orchestration with plain fakes, so no
 * Next.js cookies and no live Prisma are needed. They lock the ATT-SEC-2
 * contract:
 *  - both writes are gated on a server-derived instructor actor that holds
 *    canEditAttendance; identity comes ONLY from the injected resolver, so there
 *    is NO instructorId parameter a client could supply to select/impersonate
 *    another instructor;
 *  - a null actor (unauthenticated / invalid / inactive / wrong-audience) is
 *    rejected and the mutator is NEVER invoked (no DB write / delete);
 *  - an authenticated instructor with canEditAttendance === false is rejected
 *    and the mutator is NEVER invoked;
 *  - on the upsert path authorship (updatedByName) is the SERVER-derived actor's
 *    own fullName, never a client-supplied value;
 *  - on success the target/payload reach the mutator unchanged and its result is
 *    returned verbatim.
 *
 * A structural guard also asserts the public server actions in ./attendance no
 * longer expose an instructorId parameter and that this module stays a pure,
 * side-effect-free orchestration (no prisma / next / use-server).
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/attendance-write-auth.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  upsertInstructorAttendanceWithDeps,
  clearInstructorAttendanceWithDeps,
  type InstructorAttendanceUpsertDeps,
  type InstructorAttendanceClearDeps,
} from "./attendance-write-auth";
import type { AttendanceInput, AttendanceActionResult } from "./attendance";
import type { AttendanceCapabilityAccess } from "@/lib/course/capabilities/attendance-capability-policy-core";

// --- fixtures ---------------------------------------------------------------

const SAMPLE_INPUT: AttendanceInput = {
  studentId: "student-1",
  dateKey: "2026-07-03",
  status: "ABSENT",
  arrivalTime: "",
  departureTime: "",
  notes: "away",
};

const NO_PERMISSION_ERROR = "אין הרשאה לערוך נוכחות";

// A sentinel success result the fake mutator returns, so tests can assert the
// orchestration passes it back verbatim.
function sentinelUpsertResult(): AttendanceActionResult {
  return { success: true, row: undefined };
}

// --- ATT-3W capability access fixtures --------------------------------------
// The exact shapes the ATT-1 policy / ATT-2 resolver produce, so the DI tests
// exercise the real AttendanceCapabilityAccess contract (not an ad-hoc stub).

function enabledAccess(): AttendanceCapabilityAccess {
  return { status: "ENABLED", canView: true, canRead: true, canWrite: true, reason: "ENABLED" };
}

function readOnlyAccess(): AttendanceCapabilityAccess {
  return { status: "READ_ONLY", canView: true, canRead: true, canWrite: false, reason: "READ_ONLY" };
}

function disabledAccess(): AttendanceCapabilityAccess {
  return { status: "DISABLED", canView: false, canRead: false, canWrite: false, reason: "DISABLED" };
}

function deniedMissingContextAccess(): AttendanceCapabilityAccess {
  return { status: null, canView: false, canRead: false, canWrite: false, reason: "DENIED_MISSING_CONTEXT" };
}

function deniedUnknownStatusAccess(): AttendanceCapabilityAccess {
  return { status: null, canView: false, canRead: false, canWrite: false, reason: "DENIED_UNKNOWN_STATUS" };
}

// A resolveAttendanceAccess that MUST NOT be called (actor-level denial paths):
// invoking it fails the test, proving the capability layer is never consulted
// for a missing/invalid actor or an actor lacking canEditAttendance.
function accessResolverThatMustNotBeCalled(): () => Promise<AttendanceCapabilityAccess> {
  return async () => {
    throw new Error("resolveAttendanceAccess must not be called after an actor-level denial");
  };
}

// ===========================================================================
// upsertInstructorAttendanceWithDeps
// ===========================================================================

test("upsert: authenticated active instructor with canEditAttendance + ENABLED performs the same mutation", async () => {
  let mutatorArgs: [AttendanceInput, string] | null = null;
  let accessCalls = 0;
  const sentinel = sentinelUpsertResult();
  const deps: InstructorAttendanceUpsertDeps = {
    getCurrentInstructor: async () => ({ canEditAttendance: true, fullName: "Dana Instructor" }),
    resolveAttendanceAccess: async () => {
      accessCalls++;
      return enabledAccess();
    },
    upsertRecord: async (input, updatedByName) => {
      mutatorArgs = [input, updatedByName];
      return sentinel;
    },
  };

  const result = await upsertInstructorAttendanceWithDeps(deps, SAMPLE_INPUT);

  assert.equal(result, sentinel, "returns the mutator's result unchanged");
  assert.equal(accessCalls, 1, "the capability resolver is called exactly once for an authorized actor");
  assert.ok(mutatorArgs, "mutator was invoked");
  assert.equal(mutatorArgs![0], SAMPLE_INPUT, "the exact attendance target/payload is forwarded");
  // Authorship is the SERVER-derived actor's fullName - never a client value.
  assert.equal(mutatorArgs![1], "Dana Instructor", "authorship is the server-derived actor's fullName");
});

test("upsert: authorized actor + READ_ONLY capability denies the write, mutator not called", async () => {
  let mutatorCalled = false;
  const deps: InstructorAttendanceUpsertDeps = {
    getCurrentInstructor: async () => ({ canEditAttendance: true, fullName: "Dana Instructor" }),
    resolveAttendanceAccess: async () => readOnlyAccess(),
    upsertRecord: async () => {
      mutatorCalled = true;
      return sentinelUpsertResult();
    },
  };

  const result = await upsertInstructorAttendanceWithDeps(deps, SAMPLE_INPUT);

  assert.deepEqual(result, { success: false, error: NO_PERMISSION_ERROR }, "safe permission denial returned");
  assert.equal(mutatorCalled, false, "READ_ONLY blocks the write through this offering");
});

test("upsert: authorized actor + DISABLED capability denies the write, mutator not called", async () => {
  let mutatorCalled = false;
  const deps: InstructorAttendanceUpsertDeps = {
    getCurrentInstructor: async () => ({ canEditAttendance: true, fullName: "Dana Instructor" }),
    resolveAttendanceAccess: async () => disabledAccess(),
    upsertRecord: async () => {
      mutatorCalled = true;
      return sentinelUpsertResult();
    },
  };

  const result = await upsertInstructorAttendanceWithDeps(deps, SAMPLE_INPUT);

  assert.deepEqual(result, { success: false, error: NO_PERMISSION_ERROR }, "safe permission denial returned");
  assert.equal(mutatorCalled, false);
});

test("upsert: a denied capability result (DENIED_MISSING_CONTEXT / DENIED_UNKNOWN_STATUS) denies the write", async () => {
  for (const access of [deniedMissingContextAccess(), deniedUnknownStatusAccess()]) {
    let mutatorCalled = false;
    const deps: InstructorAttendanceUpsertDeps = {
      getCurrentInstructor: async () => ({ canEditAttendance: true, fullName: "Dana Instructor" }),
      resolveAttendanceAccess: async () => access,
      upsertRecord: async () => {
        mutatorCalled = true;
        return sentinelUpsertResult();
      },
    };

    const result = await upsertInstructorAttendanceWithDeps(deps, SAMPLE_INPUT);

    assert.deepEqual(result, { success: false, error: NO_PERMISSION_ERROR }, `${access.reason} yields a safe denial`);
    assert.equal(mutatorCalled, false, `${access.reason} never reaches the mutator`);
  }
});

test("upsert: a rejecting capability resolver propagates and the mutator is not called (no permissive fall-through)", async () => {
  let mutatorCalled = false;
  const boom = new Error("capability loader / offering resolution failed");
  const deps: InstructorAttendanceUpsertDeps = {
    getCurrentInstructor: async () => ({ canEditAttendance: true, fullName: "Dana Instructor" }),
    resolveAttendanceAccess: async () => {
      throw boom;
    },
    upsertRecord: async () => {
      mutatorCalled = true;
      return sentinelUpsertResult();
    },
  };

  await assert.rejects(
    () => upsertInstructorAttendanceWithDeps(deps, SAMPLE_INPUT),
    (err) => err === boom,
    "the resolver rejection propagates unchanged - never converted into allowed access",
  );
  assert.equal(mutatorCalled, false, "an infrastructure failure never opens the write");
});

test("upsert: mutation errors after full authorization follow existing behavior (propagate)", async () => {
  const boom = new Error("db upsert failed");
  const deps: InstructorAttendanceUpsertDeps = {
    getCurrentInstructor: async () => ({ canEditAttendance: true, fullName: "Dana Instructor" }),
    resolveAttendanceAccess: async () => enabledAccess(),
    upsertRecord: async () => {
      throw boom;
    },
  };

  await assert.rejects(
    () => upsertInstructorAttendanceWithDeps(deps, SAMPLE_INPUT),
    (err) => err === boom,
    "once fully authorized, a mutator error is unchanged by ATT-3W",
  );
});

test("upsert: unauthenticated access is rejected, no DB write, capability resolver not called", async () => {
  let mutatorCalled = false;
  const deps: InstructorAttendanceUpsertDeps = {
    getCurrentInstructor: async () => null,
    // Proves the capability layer is never consulted for a missing actor.
    resolveAttendanceAccess: accessResolverThatMustNotBeCalled(),
    upsertRecord: async () => {
      mutatorCalled = true;
      return sentinelUpsertResult();
    },
  };

  const result = await upsertInstructorAttendanceWithDeps(deps, SAMPLE_INPUT);

  assert.deepEqual(result, { success: false, error: NO_PERMISSION_ERROR });
  assert.equal(mutatorCalled, false, "the mutator (and its DB write) is never invoked");
});

test("upsert: inactive/invalid instructor (canonical null actor) fails closed", async () => {
  // getCurrentInstructor returns null for an inactive/invalid/wrong-audience/
  // subject-mismatched session (proven by actor-core tests: deriveInstructorActor
  // requires isActive===true and a subject-binding + audience match). The
  // orchestration must treat that null exactly like an unauthenticated caller.
  let mutatorCalled = false;
  const deps: InstructorAttendanceUpsertDeps = {
    getCurrentInstructor: async () => null,
    resolveAttendanceAccess: accessResolverThatMustNotBeCalled(),
    upsertRecord: async () => {
      mutatorCalled = true;
      return sentinelUpsertResult();
    },
  };

  const result = await upsertInstructorAttendanceWithDeps(deps, SAMPLE_INPUT);

  assert.deepEqual(result, { success: false, error: NO_PERMISSION_ERROR });
  assert.equal(mutatorCalled, false);
});

test("upsert: authenticated instructor with canEditAttendance=false is rejected, no DB write, capability not called", async () => {
  let mutatorCalled = false;
  const deps: InstructorAttendanceUpsertDeps = {
    getCurrentInstructor: async () => ({ canEditAttendance: false, fullName: "No Perm" }),
    // A capability that WOULD permit writes must not rescue an actor-level denial.
    resolveAttendanceAccess: accessResolverThatMustNotBeCalled(),
    upsertRecord: async () => {
      mutatorCalled = true;
      return sentinelUpsertResult();
    },
  };

  const result = await upsertInstructorAttendanceWithDeps(deps, SAMPLE_INPUT);

  assert.deepEqual(result, { success: false, error: NO_PERMISSION_ERROR });
  assert.equal(mutatorCalled, false, "no mutation for an instructor lacking canEditAttendance");
});

test("upsert: even malformed input never reaches the mutator when unauthorized", async () => {
  // Validation lives inside the mutator (upsertAttendanceRecord). Because the
  // authorization gate runs first and rejects before delegating, an unauthorized
  // caller can never trigger even the validation/DB path.
  let mutatorCalled = false;
  const deps: InstructorAttendanceUpsertDeps = {
    getCurrentInstructor: async () => null,
    resolveAttendanceAccess: accessResolverThatMustNotBeCalled(),
    upsertRecord: async () => {
      mutatorCalled = true;
      return sentinelUpsertResult();
    },
  };
  const malformed = { ...SAMPLE_INPUT, studentId: "", dateKey: "not-a-date" } as AttendanceInput;

  await upsertInstructorAttendanceWithDeps(deps, malformed);

  assert.equal(mutatorCalled, false);
});

test("upsert: caller cannot select or impersonate another instructor (no id parameter)", async () => {
  // The orchestration exposes NO instructor-id parameter; authorship + permission
  // come solely from the resolved actor, regardless of anything in the payload.
  let observedAuthor: string | null = null;
  const deps: InstructorAttendanceUpsertDeps = {
    getCurrentInstructor: async () => ({ canEditAttendance: true, fullName: "real-actor" }),
    resolveAttendanceAccess: async () => enabledAccess(),
    upsertRecord: async (_input, updatedByName) => {
      observedAuthor = updatedByName;
      return sentinelUpsertResult();
    },
  };

  // A payload cannot carry an instructor identity: even a bogus extra field is ignored.
  await upsertInstructorAttendanceWithDeps(
    deps,
    { ...SAMPLE_INPUT, instructorId: "victim-instructor" } as unknown as AttendanceInput,
  );

  assert.equal(observedAuthor, "real-actor", "authorship is always the resolved actor");
  // Compile-time + runtime guarantee: arity is (deps, input) - no instructorId arg.
  assert.equal(upsertInstructorAttendanceWithDeps.length, 2);
});

// ===========================================================================
// clearInstructorAttendanceWithDeps
// ===========================================================================

test("clear: authenticated active instructor with canEditAttendance + ENABLED clears as before", async () => {
  let clearArgs: [string, string] | null = null;
  let accessCalls = 0;
  const sentinel = { success: true } as const;
  const deps: InstructorAttendanceClearDeps = {
    getCurrentInstructor: async () => ({ canEditAttendance: true }),
    resolveAttendanceAccess: async () => {
      accessCalls++;
      return enabledAccess();
    },
    clearRecord: async (studentId, dateKeyStr) => {
      clearArgs = [studentId, dateKeyStr];
      return sentinel;
    },
  };

  const result = await clearInstructorAttendanceWithDeps(deps, "student-9", "2026-07-05");

  assert.equal(result, sentinel, "returns the mutator's result unchanged");
  assert.equal(accessCalls, 1, "the capability resolver is called exactly once for an authorized actor");
  assert.deepEqual(clearArgs, ["student-9", "2026-07-05"], "the exact target + date reach the mutator unchanged");
});

test("clear: authorized actor + READ_ONLY capability denies the clear, mutator not called", async () => {
  let clearCalled = false;
  const deps: InstructorAttendanceClearDeps = {
    getCurrentInstructor: async () => ({ canEditAttendance: true }),
    resolveAttendanceAccess: async () => readOnlyAccess(),
    clearRecord: async () => {
      clearCalled = true;
      return { success: true };
    },
  };

  const result = await clearInstructorAttendanceWithDeps(deps, "student-9", "2026-07-05");

  assert.deepEqual(result, { success: false, error: NO_PERMISSION_ERROR }, "safe permission denial returned");
  assert.equal(clearCalled, false);
});

test("clear: authorized actor + DISABLED capability denies the clear, mutator not called", async () => {
  let clearCalled = false;
  const deps: InstructorAttendanceClearDeps = {
    getCurrentInstructor: async () => ({ canEditAttendance: true }),
    resolveAttendanceAccess: async () => disabledAccess(),
    clearRecord: async () => {
      clearCalled = true;
      return { success: true };
    },
  };

  const result = await clearInstructorAttendanceWithDeps(deps, "student-9", "2026-07-05");

  assert.deepEqual(result, { success: false, error: NO_PERMISSION_ERROR }, "safe permission denial returned");
  assert.equal(clearCalled, false);
});

test("clear: a denied capability result (DENIED_MISSING_CONTEXT / DENIED_UNKNOWN_STATUS) denies the clear", async () => {
  for (const access of [deniedMissingContextAccess(), deniedUnknownStatusAccess()]) {
    let clearCalled = false;
    const deps: InstructorAttendanceClearDeps = {
      getCurrentInstructor: async () => ({ canEditAttendance: true }),
      resolveAttendanceAccess: async () => access,
      clearRecord: async () => {
        clearCalled = true;
        return { success: true };
      },
    };

    const result = await clearInstructorAttendanceWithDeps(deps, "student-9", "2026-07-05");

    assert.deepEqual(result, { success: false, error: NO_PERMISSION_ERROR }, `${access.reason} yields a safe denial`);
    assert.equal(clearCalled, false, `${access.reason} never reaches the mutator`);
  }
});

test("clear: a rejecting capability resolver propagates and the mutator is not called (no permissive fall-through)", async () => {
  let clearCalled = false;
  const boom = new Error("capability loader / offering resolution failed");
  const deps: InstructorAttendanceClearDeps = {
    getCurrentInstructor: async () => ({ canEditAttendance: true }),
    resolveAttendanceAccess: async () => {
      throw boom;
    },
    clearRecord: async () => {
      clearCalled = true;
      return { success: true };
    },
  };

  await assert.rejects(
    () => clearInstructorAttendanceWithDeps(deps, "student-9", "2026-07-05"),
    (err) => err === boom,
    "the resolver rejection propagates unchanged - never converted into allowed access",
  );
  assert.equal(clearCalled, false, "an infrastructure failure never opens the delete");
});

test("clear: mutation errors after full authorization follow existing behavior (propagate)", async () => {
  const boom = new Error("db delete failed");
  const deps: InstructorAttendanceClearDeps = {
    getCurrentInstructor: async () => ({ canEditAttendance: true }),
    resolveAttendanceAccess: async () => enabledAccess(),
    clearRecord: async () => {
      throw boom;
    },
  };

  await assert.rejects(
    () => clearInstructorAttendanceWithDeps(deps, "student-9", "2026-07-05"),
    (err) => err === boom,
    "once fully authorized, a mutator error is unchanged by ATT-3W",
  );
});

test("clear: unauthenticated access is rejected with no DB delete, capability resolver not called", async () => {
  let clearCalled = false;
  const deps: InstructorAttendanceClearDeps = {
    getCurrentInstructor: async () => null,
    resolveAttendanceAccess: accessResolverThatMustNotBeCalled(),
    clearRecord: async () => {
      clearCalled = true;
      return { success: true };
    },
  };

  const result = await clearInstructorAttendanceWithDeps(deps, "student-9", "2026-07-05");

  assert.deepEqual(result, { success: false, error: NO_PERMISSION_ERROR });
  assert.equal(clearCalled, false, "the delete mutator is never invoked");
});

test("clear: canEditAttendance=false is rejected with no DB delete, capability not called", async () => {
  let clearCalled = false;
  const deps: InstructorAttendanceClearDeps = {
    getCurrentInstructor: async () => ({ canEditAttendance: false }),
    resolveAttendanceAccess: accessResolverThatMustNotBeCalled(),
    clearRecord: async () => {
      clearCalled = true;
      return { success: true };
    },
  };

  const result = await clearInstructorAttendanceWithDeps(deps, "student-9", "2026-07-05");

  assert.deepEqual(result, { success: false, error: NO_PERMISSION_ERROR });
  assert.equal(clearCalled, false);
});

test("clear: caller cannot select or impersonate another instructor (no id parameter)", async () => {
  let observedTarget: string | null = null;
  const deps: InstructorAttendanceClearDeps = {
    getCurrentInstructor: async () => ({ canEditAttendance: true }),
    resolveAttendanceAccess: async () => enabledAccess(),
    clearRecord: async (studentId) => {
      observedTarget = studentId;
      return { success: true };
    },
  };

  await clearInstructorAttendanceWithDeps(deps, "target-student", "2026-07-05");

  assert.equal(observedTarget, "target-student", "only the resolved actor authorizes; target is the client studentId");
  // Compile-time + runtime guarantee: arity is (deps, studentId, dateKeyStr) - no instructorId.
  assert.equal(clearInstructorAttendanceWithDeps.length, 3);
});

// ===========================================================================
// Structural guards
// ===========================================================================

test("public instructor write actions no longer accept an instructorId parameter", async () => {
  const src = readFileSync(
    fileURLToPath(new URL("./attendance.ts", import.meta.url)),
    "utf8",
  );

  function paramList(fnName: string): string {
    const marker = `export async function ${fnName}(`;
    const start = src.indexOf(marker);
    assert.ok(start !== -1, `${fnName} must exist`);
    const open = start + marker.length - 1;
    const close = src.indexOf(")", open);
    return src.slice(open + 1, close);
  }

  const upsertParams = paramList("upsertAttendanceAsInstructor");
  const clearParams = paramList("clearAttendanceAsInstructor");

  assert.ok(!/instructorId/.test(upsertParams), "upsertAttendanceAsInstructor must not take instructorId");
  assert.ok(!/instructorId/.test(clearParams), "clearAttendanceAsInstructor must not take instructorId");
  // Both must still derive identity from the canonical resolver.
  assert.ok(/getCurrentInstructor/.test(src), "attendance.ts must use getCurrentInstructor for instructor writes");
});

test("attendance-write-auth is a pure orchestration (no prisma / next / use-server)", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./attendance-write-auth.ts", import.meta.url)),
    "utf8",
  );
  const hasUseServerDirective = src
    .split("\n")
    .some((line) => /^\s*["']use server["'];?\s*$/.test(line));
  assert.ok(!hasUseServerDirective, "must NOT be a Server Action module");
  assert.ok(!/from\s+["']@\/lib\/prisma["']/.test(src), "must not import Prisma");
  assert.ok(!/from\s+["']next\/headers["']/.test(src), "must not import next/headers");
  assert.ok(!/from\s+["']next\/cache["']/.test(src), "must not import next/cache");
});
