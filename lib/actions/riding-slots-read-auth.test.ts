/**
 * RS-SEC-1IR - focused behavioral tests for the session-bound instructor riding
 * READ orchestration (lib/actions/riding-slots-read-auth.ts).
 *
 * These exercise the dependency-injected orchestration with plain fakes, so no
 * Next.js cookies and no live Prisma are needed. They lock the RS-SEC-1IR
 * contract for all three previously-unauthenticated instructor riding readers:
 *  - each read is gated on a server-derived instructor actor; an unauthenticated
 *    (null) actor - or a thrown actor resolution - fails closed (list readers ->
 *    [], history reader -> null) and never runs the underlying reader;
 *  - identity comes ONLY from the injected actor resolver - none of the three
 *    orchestrations has an instructor-id parameter a client could supply;
 *  - viewing does NOT require canEditRidingNotes (the actor carries no such flag
 *    in these gates);
 *  - the authorized read preserves attendance-derived note data and riding
 *    history exactly;
 *  - denial happens strictly before the reader/Prisma dependency is invoked.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/riding-slots-read-auth.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  loadInstructorRidingSlotsWithDeps,
  loadRidingSlotStudentNotesWithDeps,
  loadStudentRidingHistoryForInstructorWithDeps,
  type InstructorRidingSlotsReadDeps,
  type RidingSlotStudentNotesReadDeps,
  type StudentRidingHistoryForInstructorReadDeps,
} from "./riding-slots-read-auth";
import type {
  WeeklyRidingDay,
  RidingSlotStudentRow,
  StudentRidingHistoryResult,
} from "./riding-slots";

// --- fixtures ---------------------------------------------------------------

// Minimal sentinel results - shape is irrelevant to the gate under test, only
// object identity / a couple of fields are asserted, so the DTOs are cast.
function sentinelDays(tag: string): WeeklyRidingDay[] {
  return [{ dateKey: tag, activities: [] } as unknown as WeeklyRidingDay];
}

// A per-student notes row carrying an attendance-derived field, to document that
// the authorized read passes attendance-derived data through unchanged.
function sentinelNotes(tag: string): RidingSlotStudentRow[] {
  return [
    {
      studentId: tag,
      attendanceStatus: "ABSENT",
      attendanceNotes: "att-" + tag,
    } as unknown as RidingSlotStudentRow,
  ];
}

function sentinelHistory(tag: string): StudentRidingHistoryResult {
  return {
    student: { id: tag },
    rows: [{ ridingSlotId: "slot-" + tag }],
  } as unknown as StudentRidingHistoryResult;
}

// ===========================================================================
// getInstructorRidingSlots orchestration
// ===========================================================================

test("slots: authorized active instructor gets the same result, args forwarded", async () => {
  const days = sentinelDays("ok");
  let seen: [string, string] | null = null;
  const deps: InstructorRidingSlotsReadDeps = {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    readSlots: async (a, b) => {
      seen = [a, b];
      return days;
    },
  };
  const result = await loadInstructorRidingSlotsWithDeps(deps, "2026-07-01", "2026-07-07");
  assert.equal(result, days, "authorized read returns the reader's exact result");
  assert.deepEqual(seen, ["2026-07-01", "2026-07-07"], "date range forwarded unchanged");
});

test("slots: unauthenticated (null actor) fails closed to [] and never reads", async () => {
  let calls = 0;
  const deps: InstructorRidingSlotsReadDeps = {
    getCurrentInstructor: async () => null,
    readSlots: async () => {
      calls++;
      return sentinelDays("nope");
    },
  };
  const result = await loadInstructorRidingSlotsWithDeps(deps, "a", "b");
  assert.deepEqual(result, []);
  assert.equal(calls, 0, "reader must NOT run for a null actor");
});

test("slots: trainee/wrong-role/inactive/missing actor (null) -> [] and never reads", async () => {
  // getCurrentInstructor returns null for every such case (wrong audience,
  // inactive/missing row, subject mismatch); one null case proves the class.
  let calls = 0;
  const deps: InstructorRidingSlotsReadDeps = {
    getCurrentInstructor: async () => null,
    readSlots: async () => {
      calls++;
      return sentinelDays("nope");
    },
  };
  assert.deepEqual(await loadInstructorRidingSlotsWithDeps(deps, "a", "b"), []);
  assert.equal(calls, 0);
});

test("slots: actor-resolution rejection fails closed to [] and never reads", async () => {
  let calls = 0;
  const deps: InstructorRidingSlotsReadDeps = {
    getCurrentInstructor: async () => {
      throw new Error("session/infra failure");
    },
    readSlots: async () => {
      calls++;
      return sentinelDays("nope");
    },
  };
  assert.deepEqual(await loadInstructorRidingSlotsWithDeps(deps, "a", "b"), []);
  assert.equal(calls, 0, "reader must NOT run when actor resolution throws");
});

test("slots: a genuine reader error still propagates (only actor resolution is caught)", async () => {
  const deps: InstructorRidingSlotsReadDeps = {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    readSlots: async () => {
      throw new Error("db read failed");
    },
  };
  await assert.rejects(
    () => loadInstructorRidingSlotsWithDeps(deps, "a", "b"),
    /db read failed/
  );
});

// ===========================================================================
// getRidingSlotStudentNotes orchestration
// ===========================================================================

test("notes: authorized instructor gets the same rows incl. attendance-derived fields", async () => {
  const rows = sentinelNotes("s1");
  let seenSlot: string | null = null;
  const deps: RidingSlotStudentNotesReadDeps = {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    readNotes: async (slotId) => {
      seenSlot = slotId;
      return rows;
    },
  };
  const result = await loadRidingSlotStudentNotesWithDeps(deps, "slot-9");
  assert.equal(result, rows);
  assert.equal(seenSlot, "slot-9", "ridingSlotId forwarded as a record selector only");
  assert.equal(result[0].attendanceStatus, "ABSENT");
  assert.equal(result[0].attendanceNotes, "att-s1");
});

test("notes: unauthenticated (null actor) -> [] and no query runs", async () => {
  let calls = 0;
  const deps: RidingSlotStudentNotesReadDeps = {
    getCurrentInstructor: async () => null,
    readNotes: async () => {
      calls++;
      return sentinelNotes("nope");
    },
  };
  assert.deepEqual(await loadRidingSlotStudentNotesWithDeps(deps, "slot"), []);
  assert.equal(calls, 0, "no Prisma/attendance query may run for a null actor");
});

test("notes: actor-resolution rejection -> [] and no query runs", async () => {
  let calls = 0;
  const deps: RidingSlotStudentNotesReadDeps = {
    getCurrentInstructor: async () => {
      throw new Error("infra");
    },
    readNotes: async () => {
      calls++;
      return sentinelNotes("nope");
    },
  };
  assert.deepEqual(await loadRidingSlotStudentNotesWithDeps(deps, "slot"), []);
  assert.equal(calls, 0);
});

test("notes: a genuine reader error still propagates", async () => {
  const deps: RidingSlotStudentNotesReadDeps = {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    readNotes: async () => {
      throw new Error("notes read failed");
    },
  };
  await assert.rejects(() => loadRidingSlotStudentNotesWithDeps(deps, "slot"), /notes read failed/);
});

// ===========================================================================
// getStudentRidingHistoryForInstructor orchestration (empty result = null)
// ===========================================================================

test("history: authorized instructor gets the same history, studentId forwarded as target", async () => {
  const hist = sentinelHistory("stud-1");
  let seen: string | null = null;
  const deps: StudentRidingHistoryForInstructorReadDeps = {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    readHistory: async (studentId) => {
      seen = studentId;
      return hist;
    },
  };
  const result = await loadStudentRidingHistoryForInstructorWithDeps(deps, "stud-1");
  assert.equal(result, hist);
  assert.equal(seen, "stud-1", "studentId forwarded as the TARGET selector, not actor identity");
});

test("history: unauthenticated (null actor) -> null and never reads", async () => {
  let calls = 0;
  const deps: StudentRidingHistoryForInstructorReadDeps = {
    getCurrentInstructor: async () => null,
    readHistory: async () => {
      calls++;
      return sentinelHistory("nope");
    },
  };
  assert.equal(await loadStudentRidingHistoryForInstructorWithDeps(deps, "stud"), null);
  assert.equal(calls, 0, "history builder must NOT run for a null actor");
});

test("history: trainee/wrong-role/inactive/missing actor (null) -> null and never reads", async () => {
  let calls = 0;
  const deps: StudentRidingHistoryForInstructorReadDeps = {
    getCurrentInstructor: async () => null,
    readHistory: async () => {
      calls++;
      return sentinelHistory("nope");
    },
  };
  assert.equal(await loadStudentRidingHistoryForInstructorWithDeps(deps, "stud"), null);
  assert.equal(calls, 0);
});

test("history: actor-resolution rejection -> null and never reads", async () => {
  let calls = 0;
  const deps: StudentRidingHistoryForInstructorReadDeps = {
    getCurrentInstructor: async () => {
      throw new Error("infra");
    },
    readHistory: async () => {
      calls++;
      return sentinelHistory("nope");
    },
  };
  assert.equal(await loadStudentRidingHistoryForInstructorWithDeps(deps, "stud"), null);
  assert.equal(calls, 0);
});

test("history: authorized history content is preserved unchanged", async () => {
  const hist = sentinelHistory("stud-7");
  const deps: StudentRidingHistoryForInstructorReadDeps = {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    readHistory: async () => hist,
  };
  const result = await loadStudentRidingHistoryForInstructorWithDeps(deps, "stud-7");
  assert.equal(result?.student.id, "stud-7");
  assert.equal(result?.rows[0].ridingSlotId, "slot-stud-7");
});

test("history: a genuine builder error still propagates", async () => {
  const deps: StudentRidingHistoryForInstructorReadDeps = {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    readHistory: async () => {
      throw new Error("history build failed");
    },
  };
  await assert.rejects(
    () => loadStudentRidingHistoryForInstructorWithDeps(deps, "stud"),
    /history build failed/
  );
});

// ===========================================================================
// Contract: no client-supplied actor identity; viewing needs no permission flag
// ===========================================================================

test("no orchestration accepts an instructor-id / actor-identity parameter", () => {
  // Arity guard (secondary evidence): each read takes its deps object plus its
  // own record selector(s) - no positional instructor-id slot on any of them.
  assert.equal(loadInstructorRidingSlotsWithDeps.length, 3, "deps + startDateKey + endDateKey");
  assert.equal(loadRidingSlotStudentNotesWithDeps.length, 2, "deps + ridingSlotId");
  assert.equal(loadStudentRidingHistoryForInstructorWithDeps.length, 2, "deps + studentId");
});

test("viewing requires no canEditRidingNotes flag (actor shape carries only id)", async () => {
  // The gate authorizes on presence of an actor { id }, never on a permission
  // flag - an actor with no can* fields at all is fully authorized to read.
  const idOnlyActor = async () => ({ id: "instructor-1" });
  assert.equal(
    (await loadInstructorRidingSlotsWithDeps(
      { getCurrentInstructor: idOnlyActor, readSlots: async () => sentinelDays("ok") },
      "a",
      "b"
    )).length,
    1
  );
  assert.equal(
    (await loadRidingSlotStudentNotesWithDeps(
      { getCurrentInstructor: idOnlyActor, readNotes: async () => sentinelNotes("ok") },
      "slot"
    )).length,
    1
  );
  assert.notEqual(
    await loadStudentRidingHistoryForInstructorWithDeps(
      { getCurrentInstructor: idOnlyActor, readHistory: async () => sentinelHistory("ok") },
      "stud"
    ),
    null
  );
});

test("riding-slots-read-auth is a pure orchestration (no prisma / next / use-server)", () => {
  const src = readFileSync(fileURLToPath(new URL("./riding-slots-read-auth.ts", import.meta.url)), "utf8");
  assert.ok(!/^\s*["']use server["']\s*;?\s*$/m.test(src), "must not be a Server Action module");
  assert.ok(!/from ["']@\/lib\/prisma["']/.test(src), "must not import prisma");
  assert.ok(!/from ["']next\/(headers|cache)["']/.test(src), "must not import next/headers or next/cache");
});

// ===========================================================================
// Wiring assertion (SECONDARY evidence).
// The behavioral DI tests above are the primary proof. This source check only
// confirms the public "use server" actions are wired to that contract (they
// can't be imported here - they transitively pull in Prisma / next). Same
// convention as attendance-write-auth.test.ts's source assertion.
// ===========================================================================

test("wiring: the three readers delegate to the session-bound orchestration", () => {
  const src = readFileSync(fileURLToPath(new URL("./riding-slots.ts", import.meta.url)), "utf8");
  assert.match(src, /loadInstructorRidingSlotsWithDeps/, "slots reader delegates to the gate");
  assert.match(src, /loadRidingSlotStudentNotesWithDeps/, "notes reader delegates to the gate");
  assert.match(src, /loadStudentRidingHistoryForInstructorWithDeps/, "history reader delegates to the gate");
  // The signatures still take no instructor id (record selectors only).
  assert.match(
    src,
    /export async function getInstructorRidingSlots\(\s*startDateKey: string,\s*endDateKey: string\s*\)/,
    "getInstructorRidingSlots signature preserved (no actor id)"
  );
  assert.match(
    src,
    /export async function getRidingSlotStudentNotes\(\s*ridingSlotId: string\s*\)/,
    "getRidingSlotStudentNotes signature preserved (no actor id)"
  );
  assert.match(
    src,
    /export async function getStudentRidingHistoryForInstructor\(\s*studentId: string\s*\)/,
    "getStudentRidingHistoryForInstructor signature preserved (no actor id)"
  );
});
