/**
 * SECURITY / LEVEL 2 SLICE L2-C3 - focused tests for TRAINEE MESSAGES, TASKS
 * and DUTIES containment.
 *
 * Two halves, both DB-free:
 *
 *  1. BEHAVIOURAL - the committed pure containment core
 *     (@/lib/course/trainee-module-containment-core) exercised with the
 *     MESSAGES and DUTIES capability keys and with the REAL production
 *     capability maps of the Level 1 and Level 2 offerings, against plain
 *     fakes. This locks: session-derived identity, positive-ENABLED gating,
 *     "no data touched before authorization", uniform denials, and error
 *     propagation.
 *
 *  2. STRUCTURAL - source assertions over the three wired production files
 *     (messages.ts, student-schedule.ts, completion.ts). A behavioural test
 *     cannot prove that a Server Action *file* stopped trusting its
 *     client-supplied studentId, so these pin the wiring itself: every trainee
 *     action routes through the gate with the right key, the client id is
 *     explicitly discarded and never used as identity, and the admin /
 *     instructor actions in the same files are untouched.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/trainee-messages-duties-containment.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  authorizeTraineeModuleWithDeps,
  isTraineeCapabilityEnabled,
  loadAuthorizedTraineeModuleRowsWithDeps,
  type TraineeModuleContextDeps,
} from "@/lib/course/trainee-module-containment-core";
import {
  AmbiguousTraineeCourseOfferingError,
  NoTraineeCourseOfferingError,
} from "@/lib/course/actor-course-offering-core";
import { UnauthenticatedActorError } from "@/lib/auth/actor-types";
import { CAPABILITY_KEYS, type CapabilityKey } from "@/lib/course/capabilities/capability-keys";
import type { EffectiveCapabilityStatus } from "@/lib/course/capabilities/effective-capability-core";

// The two REAL production offering ids, so the Level 1 / Level 2 cases below
// describe the actual launch state rather than invented placeholders.
const LEVEL_1_OFFERING_ID = "cmrqngqhn00017gcndjixzrh0";
const LEVEL_2_OFFERING_ID = "cmrxk58vc0000lscnfm54bpze";

const SESSION_TRAINEE_ID = "trainee-from-signed-session";
/** The id an attacker would put in the client-supplied `studentId` argument. */
const OTHER_TRAINEE_ID = "some-other-trainee";

/** The two capability keys this slice enforces. */
const MESSAGES_KEY: CapabilityKey = "MESSAGES";
const DUTIES_KEY: CapabilityKey = "DUTIES";
const L2C3_KEYS: CapabilityKey[] = [MESSAGES_KEY, DUTIES_KEY];

type CapabilityMap = Record<CapabilityKey, EffectiveCapabilityStatus>;

/**
 * A full, exhaustive capability map with every key DISABLED except overrides.
 *
 * Derived from the canonical CAPABILITY_KEYS tuple rather than written out by
 * hand, so adding a capability key cannot silently leave this map partial (a
 * partial map DENIES, which would make these tests pass for the wrong reason)
 * and cannot break this file at all.
 */
function capabilities(overrides: Partial<CapabilityMap> = {}): CapabilityMap {
  const base = Object.fromEntries(
    CAPABILITY_KEYS.map((key) => [key, "DISABLED" as EffectiveCapabilityStatus]),
  ) as CapabilityMap;
  return { ...base, ...overrides };
}

/**
 * The REAL Level 1 production ROWS (read-only verified against production):
 * each of these capabilities has an ENABLED row on the Level 1 offering,
 * MESSAGES and DUTIES included. This is the regression baseline - existing
 * trainee behaviour must survive.
 *
 * Deliberately expressed as the exact set of rows that EXIST rather than as
 * "everything is ENABLED": a capability key added to the code later has no
 * production row until an operator creates one, and this constant must keep
 * describing the database, not the code.
 */
const LEVEL_1_PRODUCTION_CAPABILITIES: Partial<CapabilityMap> = {
  SCHEDULE: "ENABLED",
  CONTACTS: "ENABLED",
  MESSAGES: "ENABLED",
  ATTENDANCE: "ENABLED",
  DUTIES: "ENABLED",
  RIDING: "ENABLED",
  PROGRESS_RIDING: "ENABLED",
  RIDING_HORSE_ASSIGNMENTS: "ENABLED",
  ADVANCED_INSTRUCTION: "ENABLED",
  TEACHING_PRACTICE: "ENABLED",
};

/**
 * The REAL Level 2 production rows (read-only verified against production):
 * ONLY SCHEDULE and CONTACTS exist. MESSAGES and DUTIES are row-absent, which
 * under CAP-1 means effective DISABLED - deliberately a PARTIAL map here, since
 * that is exactly the shape the effective-capability reader is fed from.
 */
const LEVEL_2_PRODUCTION_CAPABILITIES: Partial<CapabilityMap> = {
  SCHEDULE: "ENABLED",
  CONTACTS: "ENABLED",
};

interface DepsSpy {
  deps: TraineeModuleContextDeps;
  calls: string[];
}

function makeDeps(options: {
  traineeId?: string;
  requireTraineeIdError?: unknown;
  offeringId?: string;
  resolveOfferingError?: unknown;
  capabilityMap?: Partial<CapabilityMap> | null;
  capabilityError?: unknown;
}): DepsSpy {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      requireTraineeId: async () => {
        calls.push("actor");
        if (options.requireTraineeIdError !== undefined) throw options.requireTraineeIdError;
        return options.traineeId ?? SESSION_TRAINEE_ID;
      },
      resolveTraineeCourseOffering: async () => {
        calls.push("offering");
        if (options.resolveOfferingError !== undefined) throw options.resolveOfferingError;
        return { id: options.offeringId ?? LEVEL_1_OFFERING_ID };
      },
      getEffectiveCapabilities: async (courseOfferingId: string) => {
        calls.push(`capabilities:${courseOfferingId}`);
        if (options.capabilityError !== undefined) throw options.capabilityError;
        return (options.capabilityMap ?? capabilities()) as CapabilityMap;
      },
    },
  };
}

/**
 * A stand-in for the real Prisma read OR write, recording whether it ran at all
 * and with which context. On the write side this stands for "the recipient /
 * assignment row was fetched and then updated" - neither may happen for an
 * unauthorized caller.
 */
function makeDataAccess<TRow>(rows: TRow[]) {
  const seen: { traineeId: string; courseOfferingId: string }[] = [];
  return {
    seen,
    run: async (context: { traineeId: string; courseOfferingId: string }) => {
      seen.push(context);
      return rows;
    },
  };
}

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * Source with block and line comments removed.
 *
 * The forbidden-identifier assertions below must test what each module actually
 * DOES, not what its documentation is allowed to mention: every file explains at
 * length why the client-supplied studentId is not identity and why
 * resolveCurrentCourseOffering is excluded, and naming those in prose must not
 * be mistaken for using them. A real reference in code still fails these checks.
 */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// ===========================================================================
// PART 1 - BEHAVIOURAL: the containment contract for MESSAGES and DUTIES
// ===========================================================================

// ---------------------------------------------------------------------------
// Capability predicate, per key
// ---------------------------------------------------------------------------

for (const key of L2C3_KEYS) {
  test(`${key}: only a positively ENABLED capability authorizes the module`, () => {
    assert.equal(isTraineeCapabilityEnabled(key, capabilities({ [key]: "ENABLED" })), true);

    // READ_ONLY is NOT enough - this module family has writes, and the reads
    // are denied with it too (a single gate covers both, by design).
    assert.equal(isTraineeCapabilityEnabled(key, capabilities({ [key]: "READ_ONLY" })), false);
    assert.equal(isTraineeCapabilityEnabled(key, capabilities({ [key]: "DISABLED" })), false);

    // Row-absent / partial / empty / malformed / nullish maps all deny.
    assert.equal(isTraineeCapabilityEnabled(key, {}), false);
    assert.equal(isTraineeCapabilityEnabled(key, null), false);
    assert.equal(isTraineeCapabilityEnabled(key, undefined), false);
    assert.equal(
      isTraineeCapabilityEnabled(key, { [key]: "enabled" as unknown as EffectiveCapabilityStatus }),
      false,
    );
    assert.equal(
      isTraineeCapabilityEnabled(key, { [key]: true as unknown as EffectiveCapabilityStatus }),
      false,
    );

    // Another key being ENABLED never authorizes this one - notably the two
    // capabilities the Level 2 narrow launch DOES enable.
    assert.equal(
      isTraineeCapabilityEnabled(key, { SCHEDULE: "ENABLED", CONTACTS: "ENABLED" }),
      false,
    );
  });
}

test("MESSAGES and DUTIES are independent gates", () => {
  const messagesOnly = capabilities({ MESSAGES: "ENABLED" });
  assert.equal(isTraineeCapabilityEnabled(MESSAGES_KEY, messagesOnly), true);
  assert.equal(isTraineeCapabilityEnabled(DUTIES_KEY, messagesOnly), false);

  const dutiesOnly = capabilities({ DUTIES: "ENABLED" });
  assert.equal(isTraineeCapabilityEnabled(DUTIES_KEY, dutiesOnly), true);
  assert.equal(isTraineeCapabilityEnabled(MESSAGES_KEY, dutiesOnly), false);
});

// ---------------------------------------------------------------------------
// The REAL production launch state
// ---------------------------------------------------------------------------

for (const key of L2C3_KEYS) {
  test(`Level 1 production capabilities keep ${key} ENABLED (regression baseline)`, () => {
    assert.equal(isTraineeCapabilityEnabled(key, LEVEL_1_PRODUCTION_CAPABILITIES), true);
  });

  test(`Level 2 production capabilities have no ${key} row -> effective DISABLED`, () => {
    assert.equal(key in LEVEL_2_PRODUCTION_CAPABILITIES, false, "the row must be absent");
    assert.equal(isTraineeCapabilityEnabled(key, LEVEL_2_PRODUCTION_CAPABILITIES), false);
  });
}

for (const key of L2C3_KEYS) {
  test(`Level 2 trainee: ${key} module denied before any data operation`, async () => {
    const { deps } = makeDeps({
      offeringId: LEVEL_2_OFFERING_ID,
      capabilityMap: LEVEL_2_PRODUCTION_CAPABILITIES,
    });
    const data = makeDataAccess([{ id: "another-trainees-row" }]);

    const rows = await loadAuthorizedTraineeModuleRowsWithDeps(key, deps, data.run);
    assert.deepEqual(rows, [], "a Level 2 read must return the existing empty result");
    assert.equal(data.seen.length, 0, "no row may be read or written when denied");

    const authorization = await authorizeTraineeModuleWithDeps(key, deps);
    assert.deepEqual(authorization, { authorized: false }, "the write gate must deny too");
  });

  test(`Level 1 trainee: ${key} module preserved end to end`, async () => {
    const rows = [{ id: "row-1" }, { id: "row-2" }];
    const { deps } = makeDeps({
      offeringId: LEVEL_1_OFFERING_ID,
      capabilityMap: LEVEL_1_PRODUCTION_CAPABILITIES,
    });
    const data = makeDataAccess(rows);

    const result = await loadAuthorizedTraineeModuleRowsWithDeps(key, deps, data.run);
    assert.deepEqual(result, rows, "an authorized Level 1 trainee still sees the same data");
    assert.deepEqual(data.seen[0], {
      traineeId: SESSION_TRAINEE_ID,
      courseOfferingId: LEVEL_1_OFFERING_ID,
    });

    const authorization = await authorizeTraineeModuleWithDeps(key, deps);
    assert.equal(authorization.authorized, true, "the write gate must still allow Level 1");
  });
}

// ---------------------------------------------------------------------------
// Every denial - same result, nothing read, nothing mutated
// ---------------------------------------------------------------------------

const DENIAL_CASES: Array<[string, Parameters<typeof makeDeps>[0]]> = [
  ["anonymous caller", { requireTraineeIdError: new UnauthenticatedActorError() }],
  [
    "expired session",
    { requireTraineeIdError: new UnauthenticatedActorError("No authenticated trainee") },
  ],
  [
    "wrong audience / inactive trainee",
    { requireTraineeIdError: new UnauthenticatedActorError("No authenticated trainee") },
  ],
  ["no eligible offering", { resolveOfferingError: new NoTraineeCourseOfferingError("s1") }],
  [
    "ambiguous offering",
    { resolveOfferingError: new AmbiguousTraineeCourseOfferingError("s1", ["a", "b"]) },
  ],
  [
    "Level 2: capability row absent",
    { offeringId: LEVEL_2_OFFERING_ID, capabilityMap: LEVEL_2_PRODUCTION_CAPABILITIES },
  ],
  ["capability DISABLED", { capabilityMap: capabilities() }],
  [
    "capability READ_ONLY",
    { capabilityMap: capabilities({ MESSAGES: "READ_ONLY", DUTIES: "READ_ONLY" }) },
  ],
  ["malformed / empty capability map", { capabilityMap: {} }],
  ["null capability map", { capabilityMap: null }],
];

for (const key of L2C3_KEYS) {
  for (const [label, options] of DENIAL_CASES) {
    test(`${key} denied: ${label} -> empty result, no read, no write`, async () => {
      const { deps } = makeDeps(options);
      const data = makeDataAccess([{ id: "another-trainees-row" }]);

      const rows = await loadAuthorizedTraineeModuleRowsWithDeps(key, deps, data.run);
      assert.deepEqual(rows, []);
      assert.equal(data.seen.length, 0);

      // The write path uses the same gate, so the same denial covers it.
      const authorization = await authorizeTraineeModuleWithDeps(key, deps);
      assert.deepEqual(authorization, { authorized: false });
    });
  }
}

test("every denial is indistinguishable from every other denial", async () => {
  for (const key of L2C3_KEYS) {
    const results = await Promise.all(
      DENIAL_CASES.map(async ([, options]) =>
        loadAuthorizedTraineeModuleRowsWithDeps(key, makeDeps(options).deps, makeDataAccess([{ id: "x" }]).run),
      ),
    );
    for (const rows of results) assert.deepEqual(rows, []);
  }
});

// ---------------------------------------------------------------------------
// Gate ORDER and session-derived identity
// ---------------------------------------------------------------------------

for (const key of L2C3_KEYS) {
  test(`${key}: order is actor -> offering -> capability -> data`, async () => {
    const { deps, calls } = makeDeps({ capabilityMap: capabilities({ [key]: "ENABLED" }) });
    await loadAuthorizedTraineeModuleRowsWithDeps(key, deps, makeDataAccess([]).run);
    assert.deepEqual(calls, ["actor", "offering", `capabilities:${LEVEL_1_OFFERING_ID}`]);
  });

  test(`${key}: an anonymous caller stops at the actor gate`, async () => {
    const { deps, calls } = makeDeps({ requireTraineeIdError: new UnauthenticatedActorError() });
    await loadAuthorizedTraineeModuleRowsWithDeps(key, deps, makeDataAccess([]).run);
    assert.deepEqual(calls, ["actor"], "no course or capability read for an anonymous caller");
  });

  test(`${key}: capabilities are read for the RESOLVED offering only - no Level 1 fallback`, async () => {
    const { deps, calls } = makeDeps({
      offeringId: LEVEL_2_OFFERING_ID,
      capabilityMap: LEVEL_2_PRODUCTION_CAPABILITIES,
    });
    await loadAuthorizedTraineeModuleRowsWithDeps(key, deps, makeDataAccess([]).run);
    assert.ok(calls.includes(`capabilities:${LEVEL_2_OFFERING_ID}`));
    assert.ok(!calls.includes(`capabilities:${LEVEL_1_OFFERING_ID}`), "no Level 1 fallback");
  });

  test(`${key}: the data step receives the SESSION-derived trainee id`, async () => {
    const { deps } = makeDeps({
      traineeId: SESSION_TRAINEE_ID,
      capabilityMap: capabilities({ [key]: "ENABLED" }),
    });
    const data = makeDataAccess([]);
    await loadAuthorizedTraineeModuleRowsWithDeps(key, deps, data.run);
    assert.equal(data.seen[0].traineeId, SESSION_TRAINEE_ID);
    assert.notEqual(
      data.seen[0].traineeId,
      OTHER_TRAINEE_ID,
      "self-specific filtering and ownership must never use a client-supplied id",
    );

    const authorization = await authorizeTraineeModuleWithDeps(key, deps);
    assert.equal(authorization.authorized && authorization.context.traineeId, SESSION_TRAINEE_ID);
  });
}

// ---------------------------------------------------------------------------
// Real defects PROPAGATE - never silently converted to success or to a denial
// ---------------------------------------------------------------------------

for (const key of L2C3_KEYS) {
  test(`${key}: capability-reader and data failures propagate`, async () => {
    await assert.rejects(
      () =>
        loadAuthorizedTraineeModuleRowsWithDeps(
          key,
          makeDeps({ capabilityError: new Error("capability read failed") }).deps,
          makeDataAccess([]).run,
        ),
      /capability read failed/,
    );

    await assert.rejects(
      () =>
        loadAuthorizedTraineeModuleRowsWithDeps(
          key,
          makeDeps({ capabilityMap: capabilities({ [key]: "ENABLED" }) }).deps,
          async () => {
            throw new Error("prisma connection reset");
          },
        ),
      /prisma connection reset/,
    );

    for (const options of [
      { requireTraineeIdError: new Error("session store unreachable") },
      { resolveOfferingError: new Error("enrollment query failed") },
    ]) {
      await assert.rejects(
        () => authorizeTraineeModuleWithDeps(key, makeDeps(options).deps),
        /session store unreachable|enrollment query failed/,
      );
    }
  });
}

// ===========================================================================
// PART 2 - STRUCTURAL: the wired production files
// ===========================================================================

const MESSAGES_FILE = "./messages.ts";
const STUDENT_SCHEDULE_FILE = "./student-schedule.ts";
const COMPLETION_FILE = "./completion.ts";

/** Every trainee-facing message/task action contained by this slice. */
const TRAINEE_MESSAGE_ACTIONS = [
  "getStudentMessages",
  "markMessageRead",
  "setTaskCompleted",
  "archiveMessageTaskForStudent",
  "unarchiveMessageTaskForStudent",
];

/** Every trainee-facing duty action contained by this slice. */
const TRAINEE_DUTY_ACTIONS: Array<[string, string]> = [
  [STUDENT_SCHEDULE_FILE, "getStudentDutiesForRange"],
  [COMPLETION_FILE, "markDutyCompleted"],
];

/**
 * The source of one function, from its declaration up to the next TOP-LEVEL
 * declaration of any kind (function, const, interface, type - exported or not).
 * Cutting at every top-level declaration, not just the next exported function,
 * is what keeps a private helper or a shared const that merely FOLLOWS an
 * action from being folded into that action's body and quietly satisfying an
 * assertion about it.
 */
const NEXT_TOP_LEVEL_DECLARATION = /\n(?:export )?(?:async function|function|const|interface|type|enum|class) /;

function functionSource(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} must still be an exported action`);
  const rest = src.slice(start + 1);
  const next = rest.search(NEXT_TOP_LEVEL_DECLARATION);
  return next >= 0 ? rest.slice(0, next) : rest;
}

test("the trainee action inventory is exactly what this slice contains", () => {
  const messages = readSource(MESSAGES_FILE);
  for (const name of TRAINEE_MESSAGE_ACTIONS) {
    assert.ok(
      messages.includes(`export async function ${name}(`),
      `${name} must still exist in messages.ts`,
    );
  }
  // No trainee-facing message/task action may exist outside the known list -
  // a new one added later must be contained in the same change.
  const exported = [...messages.matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]);
  const traineeLike = exported.filter((n) => /Student|ForStudent/.test(n) && n !== "getStudentMessages");
  assert.deepEqual(
    traineeLike.sort(),
    ["archiveMessageTaskForStudent", "unarchiveMessageTaskForStudent"],
    "an unexpected trainee-facing message/task action appeared - contain it too",
  );
});

test("every trainee message/task action routes through the MESSAGES gate", () => {
  const src = readSource(MESSAGES_FILE);
  for (const name of TRAINEE_MESSAGE_ACTIONS) {
    const body = functionSource(src, name);
    assert.ok(
      body.includes("loadAuthorizedTraineeModuleRowsWithDeps") ||
        body.includes("authorizedTraineeMessagesId()"),
      `${name} must route through the containment gate`,
    );
    assert.ok(
      body.includes("TRAINEE_MESSAGES_CAPABILITY_KEY") || body.includes("authorizedTraineeMessagesId()"),
      `${name} must require the MESSAGES capability`,
    );
  }
  // The one place the key and the write gate are defined.
  assert.ok(
    /const TRAINEE_MESSAGES_CAPABILITY_KEY: CapabilityKey = "MESSAGES";/.test(src),
    "the MESSAGES key must be the canonical literal, typed as CapabilityKey",
  );
  assert.ok(
    /authorizeTraineeModuleWithDeps\(\s*TRAINEE_MESSAGES_CAPABILITY_KEY/.test(src),
    "the write gate must use the MESSAGES key",
  );
});

test("every trainee duty action routes through the DUTIES gate", () => {
  for (const [file, name] of TRAINEE_DUTY_ACTIONS) {
    const src = readSource(file);
    const body = functionSource(src, name);
    assert.ok(
      body.includes("loadAuthorizedTraineeModuleRowsWithDeps") ||
        body.includes("authorizeTraineeModuleWithDeps"),
      `${name} must route through the containment gate`,
    );
    assert.ok(
      body.includes("TRAINEE_DUTIES_CAPABILITY_KEY"),
      `${name} must require the DUTIES capability`,
    );
    assert.ok(
      /const TRAINEE_DUTIES_CAPABILITY_KEY: CapabilityKey = "DUTIES";/.test(src),
      `${file} must declare the DUTIES key as the canonical literal, typed as CapabilityKey`,
    );
  }
});

test("the client-supplied studentId is explicitly discarded and never identity", () => {
  const checks: Array<[string, string[]]> = [
    [MESSAGES_FILE, TRAINEE_MESSAGE_ACTIONS],
    [STUDENT_SCHEDULE_FILE, ["getStudentDutiesForRange"]],
    [COMPLETION_FILE, ["markDutyCompleted"]],
  ];
  for (const [file, names] of checks) {
    const src = readCode(file);
    for (const name of names) {
      const body = functionSource(src, name);
      assert.ok(body.includes("void studentId;"), `${name} must explicitly discard studentId`);
      assert.ok(
        !/studentId:\s*studentId|!==\s*studentId|===\s*studentId|\{\s*studentId\s*,|where:\s*\{\s*studentId\s*[,}]/.test(
          body,
        ),
        `${name} must not use the client-supplied studentId as a filter or an identity comparison`,
      );
    }
  }
});

test("ownership comparisons and self-filters use the session-derived id", () => {
  const messages = readCode(MESSAGES_FILE);
  // Every recipient ownership check compares against the session id.
  const ownershipChecks = [...messages.matchAll(/recipient\.studentId !== (\w+)/g)].map((m) => m[1]);
  assert.equal(ownershipChecks.length, 4, "all four recipient writers must check ownership");
  for (const compared of ownershipChecks) {
    assert.equal(compared, "traineeId", "ownership must be compared to the session-derived id");
  }
  assert.ok(
    /where:\s*\{\s*studentId:\s*traineeId,/.test(messages),
    "the trainee message reader must filter by the session-derived id",
  );

  const duties = readCode(STUDENT_SCHEDULE_FILE);
  assert.ok(
    /where:\s*\{\s*studentId:\s*traineeId,/.test(duties),
    "the duty reader must filter by the session-derived id",
  );
  assert.ok(
    /a\.studentId === traineeId/.test(duties),
    "the teammate list must exclude the session-derived trainee, not a client id",
  );

  const completion = readCode(COMPLETION_FILE);
  assert.ok(
    /assignment\.studentId !== traineeId/.test(completion),
    "duty completion ownership must be compared to the session-derived id",
  );
  assert.ok(
    /!assignment\.isPublished/.test(completion),
    "the pre-existing isPublished guard must be preserved",
  );
});

test("no data is read or written before the gate passes", () => {
  const checks: Array<[string, string[]]> = [
    [MESSAGES_FILE, TRAINEE_MESSAGE_ACTIONS],
    [STUDENT_SCHEDULE_FILE, ["getStudentDutiesForRange"]],
    [COMPLETION_FILE, ["markDutyCompleted"]],
  ];
  for (const [file, names] of checks) {
    const src = readCode(file);
    for (const name of names) {
      const body = functionSource(src, name);
      const firstPrisma = body.indexOf("prisma.");
      if (firstPrisma < 0) continue; // the read path delegates to a helper
      const gate = Math.min(
        ...[
          body.indexOf("authorizedTraineeMessagesId()"),
          body.indexOf("authorizeTraineeModuleWithDeps"),
          body.indexOf("loadAuthorizedTraineeModuleRowsWithDeps"),
        ].filter((i) => i >= 0),
      );
      assert.ok(gate >= 0, `${name} must contain a gate call`);
      assert.ok(gate < firstPrisma, `${name} must authorize before touching Prisma`);
    }
  }
});

test("the duty reader no longer authorizes on Student.isActive", () => {
  const src = readCode(STUDENT_SCHEDULE_FILE);
  const body = functionSource(src, "getStudentDutiesForRange");
  assert.ok(
    !body.includes("prisma.student."),
    "the duty reader must not re-read a client-supplied Student row as authentication",
  );
  assert.ok(!body.includes("isActive"), "global Student.isActive is not authorization");
});

test("no trainee action accepts a courseOfferingId or falls back to Level 1", () => {
  for (const file of [MESSAGES_FILE, STUDENT_SCHEDULE_FILE, COMPLETION_FILE]) {
    const src = readCode(file);
    assert.ok(
      !src.includes("resolveCurrentCourseOffering"),
      `${file}: no legacy singleton resolver (it returns Level 1 for the known ACTIVE pair)`,
    );
    assert.ok(
      !/courseOfferingId\s*:\s*string/.test(src),
      `${file}: no courseOfferingId may be accepted from a caller`,
    );
    assert.ok(
      src.includes("resolveTraineeCourseOffering"),
      `${file}: course context must come from the no-argument trainee resolver`,
    );
  }
});

test("the containment binding supplies only server-owned dependencies", () => {
  for (const file of [MESSAGES_FILE, STUDENT_SCHEDULE_FILE, COMPLETION_FILE]) {
    const src = readCode(file);
    assert.ok(
      /requireTraineeId:\s*async \(\) => \(await requireCurrentTrainee\(\)\)\.id,/.test(src),
      `${file}: the trainee id must come from the Actor DAL, not a parameter`,
    );
    assert.ok(
      /resolveTraineeCourseOffering,\s*\n\s*getEffectiveCapabilities,/.test(src),
      `${file}: the offering and capability readers must be the committed server ones`,
    );
  }
});

// ---------------------------------------------------------------------------
// Denial shapes - a denial must be indistinguishable from "not found"
// ---------------------------------------------------------------------------

test("write denials reuse the existing not-found failure shape", () => {
  const messages = readCode(MESSAGES_FILE);
  // Each writer's gate-denial error string must equal the string it already
  // returned for a missing / not-mine row, so record existence stays unprobeable.
  for (const [name, message] of [
    ["markMessageRead", "ההודעה לא נמצאה"],
    ["setTaskCompleted", "המשימה לא נמצאה"],
    ["archiveMessageTaskForStudent", "ההודעה לא נמצאה"],
    ["unarchiveMessageTaskForStudent", "ההודעה לא נמצאה"],
  ] as const) {
    const body = functionSource(messages, name);
    const errors = [...body.matchAll(/success: false, error: "([^"]+)"/g)].map((m) => m[1]);
    assert.ok(errors.length >= 2, `${name} must deny both at the gate and on ownership`);
    assert.equal(errors[0], message, `${name}'s gate denial must reuse its not-found message`);
    assert.equal(errors[1], message, `${name}'s ownership denial must be identical`);
  }

  const completion = readCode(COMPLETION_FILE);
  const dutyErrors = [...functionSource(completion, "markDutyCompleted").matchAll(
    /success: false, error: "([^"]+)"/g,
  )].map((m) => m[1]);
  assert.deepEqual(dutyErrors, ["השיבוץ לא נמצא", "השיבוץ לא נמצא"]);
});

test("the duty reader denial reuses the existing empty result shape", () => {
  const src = readSource(STUDENT_SCHEDULE_FILE);
  const body = functionSource(src, "getStudentDutiesForRange");
  // loadAuthorizedTraineeModuleRowsWithDeps returns a fresh [] on denial, which
  // is exactly what the old `if (!student || !student.isActive) return [];`
  // returned - the component's "אין נתונים להצגה" path is unchanged.
  assert.ok(body.includes("loadAuthorizedTraineeModuleRowsWithDeps"));
});

// ---------------------------------------------------------------------------
// Untouched surfaces
// ---------------------------------------------------------------------------

test("admin message/completion actions keep their requireAdmin() gate", () => {
  const messages = readSource(MESSAGES_FILE);
  for (const name of [
    "createMessageTask",
    "updateMessageTask",
    "archiveMessageTask",
    "listMessageTasksForAdmin",
    "getMessageTaskRecipients",
  ]) {
    assert.ok(
      functionSource(messages, name).includes("await requireAdmin();"),
      `${name} must still be admin-gated`,
    );
  }
  assert.ok(
    functionSource(readSource(COMPLETION_FILE), "adminSetCompletion").includes("await requireAdmin();"),
    "adminSetCompletion must still be admin-gated",
  );
});

test("the instructor message actions are unchanged by this slice", () => {
  const src = readSource(MESSAGES_FILE);
  const asInstructor = functionSource(src, "createMessageTaskAsInstructor");
  assert.ok(
    asInstructor.includes("prisma.instructor.findUnique"),
    "instructor send permission must still be re-read from the DB",
  );
  assert.ok(
    !asInstructor.includes("TRAINEE_MESSAGES_CAPABILITY_KEY"),
    "the instructor path must not be routed through the trainee gate",
  );
  assert.ok(
    !functionSource(src, "getMessageTasksForInstructorView").includes("TRAINEE_MESSAGES_CAPABILITY_KEY"),
    "the instructor view must not be routed through the trainee gate",
  );
});

test("the S1A schedule reader is untouched", () => {
  const body = functionSource(readSource(STUDENT_SCHEDULE_FILE), "getScheduleForStudent");
  assert.ok(
    body.includes("authorizeTraineeWeekReadWithDeps"),
    "getScheduleForStudent must still use the S1A week gate",
  );
  assert.ok(
    !body.includes("TRAINEE_DUTIES_CAPABILITY_KEY"),
    "the schedule reader must not be re-gated on DUTIES by this slice",
  );
});

test("the trainee UI still calls every contained action unchanged", () => {
  // L2-C3 is server-side only: the signatures were preserved precisely so these
  // client components need no edit. If a future slice drops the studentId
  // parameter, those components must change in the same slice.
  const messagesUi = readSource("../../app/student/StudentMessagesSection.tsx");
  for (const name of TRAINEE_MESSAGE_ACTIONS) {
    assert.ok(messagesUi.includes(name), `${name} must still be called by the trainee UI`);
  }
  assert.ok(
    /markMessageRead\(recipientId, studentId\)/.test(messagesUi),
    "the UI call shape must be unchanged",
  );

  const dutiesUi = readSource("../../app/student/DutiesSection.tsx");
  assert.ok(/getStudentDutiesForRange\(studentId, startDateKey, endDateKey\)/.test(dutiesUi));
  assert.ok(/markDutyCompleted\(assignmentId, studentId\)/.test(dutiesUi));
});
