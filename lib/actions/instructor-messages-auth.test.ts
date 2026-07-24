/**
 * L2-FANOUT-AUTH - focused tests for the session-bound INSTRUCTOR MESSAGE
 * orchestration (lib/actions/instructor-messages-auth.ts).
 *
 * Two halves, both DB-free and session-free:
 *
 *  1. BEHAVIOURAL - the pure dependency-injected orchestration exercised with
 *     plain fakes. This locks: server-derived identity only, canSendMessages for
 *     the send, identity-only for the read, "no delegate invoked before
 *     authorization" (which is what proves no recipient read, no message write
 *     and no push fanout happens on a denial), the exact unchanged Hebrew
 *     denial string, and error propagation.
 *
 *  2. STRUCTURAL - source assertions over the wired production file
 *     (messages.ts) and over the orchestration module itself. A behavioural test
 *     cannot prove that a Server Action *file* stopped trusting its
 *     client-supplied instructorId, so these pin the wiring itself.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/instructor-messages-auth.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  sendInstructorMessageTaskWithDeps,
  loadInstructorMessageTaskViewWithDeps,
  type InstructorMessageSendActor,
  type InstructorMessageSendDeps,
  type InstructorMessageViewDeps,
} from "./instructor-messages-auth";
import type { CreateMessageTaskInput, InstructorMessageTaskView } from "./messages";
import type { ActionResult } from "./students";

// --- fixtures ---------------------------------------------------------------

/** The exact, unchanged UI-visible denial string the send path must preserve. */
const NO_SEND_PERMISSION_ERROR = "אין הרשאה לשליחת הודעות ומשימות";

/** The id an attacker would put in the client-supplied `instructorId` argument. */
const OTHER_INSTRUCTOR_ID = "some-other-instructor";

const SESSION_INSTRUCTOR_NAME = "מדריכה מהסשן החתום";
const OTHER_INSTRUCTOR_NAME = "מדריכה אחרת";

function sendActor(
  overrides: Partial<InstructorMessageSendActor> = {},
): InstructorMessageSendActor {
  return {
    canSendMessages: overrides.canSendMessages ?? true,
    fullName: overrides.fullName ?? SESSION_INSTRUCTOR_NAME,
  };
}

function sendInput(): CreateMessageTaskInput {
  return { type: "MESSAGE", title: "כותרת", body: "תוכן", audience: "ALL" };
}

// A minimal sentinel view row - the shape is irrelevant to the gate under test,
// only object identity is asserted, so the full DTO is cast rather than filled.
function sentinelRows(tag: string): InstructorMessageTaskView[] {
  return [{ id: tag } as unknown as InstructorMessageTaskView];
}

/**
 * A createMessageTask delegate that MUST NOT be called (denial paths): invoking
 * it fails the test. Because this single delegate is what resolves the audience,
 * reads recipient rows, writes the MessageTask and fans out the push, proving it
 * is never invoked proves that NONE of those four happen on a denial.
 */
function creatorThatMustNotBeCalled(): InstructorMessageSendDeps["createMessageTask"] {
  return async () => {
    throw new Error(
      "createMessageTask must not be called after a denial - no recipient read, write or push may occur",
    );
  };
}

/** A readItems delegate that MUST NOT be called (denial paths). */
function readerThatMustNotBeCalled(): InstructorMessageViewDeps["readItems"] {
  return async () => {
    throw new Error("readItems must not be called after a denial - no message or recipient may be read");
  };
}

/** Records every createMessageTask invocation so call count and authorship can be asserted. */
function recordingCreator(result: ActionResult = { success: true }): {
  delegate: InstructorMessageSendDeps["createMessageTask"];
  calls: Array<{ input: CreateMessageTaskInput; createdByName: string }>;
} {
  const calls: Array<{ input: CreateMessageTaskInput; createdByName: string }> = [];
  return {
    calls,
    delegate: async (input, createdByName) => {
      calls.push({ input, createdByName });
      return result;
    },
  };
}

// ===========================================================================
// PART 1 - BEHAVIOURAL: send
// ===========================================================================

test("send: a null actor returns the exact existing Hebrew denial", async () => {
  const result = await sendInstructorMessageTaskWithDeps(
    { getCurrentInstructor: async () => null, createMessageTask: creatorThatMustNotBeCalled() },
    sendInput(),
  );

  assert.deepEqual(result, { success: false, error: NO_SEND_PERMISSION_ERROR });
});

test("send: a null actor never invokes createMessageTask (no recipient read, write or push)", async () => {
  let creatorCalls = 0;
  const result = await sendInstructorMessageTaskWithDeps(
    {
      getCurrentInstructor: async () => null,
      createMessageTask: async () => {
        creatorCalls++;
        return { success: true };
      },
    },
    sendInput(),
  );

  assert.equal(result.success, false);
  assert.equal(creatorCalls, 0, "the creator - and therefore every recipient read, write and push - must not run");
});

test("send: canSendMessages=false returns the same denial", async () => {
  const result = await sendInstructorMessageTaskWithDeps(
    {
      getCurrentInstructor: async () => sendActor({ canSendMessages: false }),
      createMessageTask: creatorThatMustNotBeCalled(),
    },
    sendInput(),
  );

  assert.deepEqual(
    result,
    { success: false, error: NO_SEND_PERMISSION_ERROR },
    "an authenticated instructor without send permission is indistinguishable from an anonymous one",
  );
});

test("send: canSendMessages=false never invokes createMessageTask", async () => {
  let creatorCalls = 0;
  await sendInstructorMessageTaskWithDeps(
    {
      getCurrentInstructor: async () => sendActor({ canSendMessages: false }),
      createMessageTask: async () => {
        creatorCalls++;
        return { success: true };
      },
    },
    sendInput(),
  );

  assert.equal(creatorCalls, 0);
});

test("send: a non-boolean-true canSendMessages is denied (fail closed)", async () => {
  // Only a positive `true` authorizes: a truthy-but-not-true value from a
  // widened/legacy shape must never pass.
  for (const value of [undefined, null, 1, "true"]) {
    const result = await sendInstructorMessageTaskWithDeps(
      {
        getCurrentInstructor: async () =>
          ({ canSendMessages: value, fullName: SESSION_INSTRUCTOR_NAME }) as unknown as InstructorMessageSendActor,
        createMessageTask: creatorThatMustNotBeCalled(),
      },
      sendInput(),
    );
    assert.deepEqual(result, { success: false, error: NO_SEND_PERMISSION_ERROR });
  }
});

test("send: an authorized actor invokes createMessageTask exactly once, unchanged", async () => {
  const creator = recordingCreator({ success: true });
  const input = sendInput();

  const result = await sendInstructorMessageTaskWithDeps(
    { getCurrentInstructor: async () => sendActor(), createMessageTask: creator.delegate },
    input,
  );

  assert.equal(creator.calls.length, 1, "exactly one send");
  assert.equal(creator.calls[0].input, input, "the payload is passed through unchanged");
  assert.deepEqual(result, { success: true }, "the delegate result is returned unchanged");
});

test("send: createdByName is the server-derived actor's fullName", async () => {
  const creator = recordingCreator();

  await sendInstructorMessageTaskWithDeps(
    { getCurrentInstructor: async () => sendActor(), createMessageTask: creator.delegate },
    sendInput(),
  );

  assert.equal(creator.calls[0].createdByName, SESSION_INSTRUCTOR_NAME);
});

test("send: nothing client-supplied can influence authorship or identity", async () => {
  // The orchestration takes NO instructor id at all, so the only way a client
  // value could reach authorship is via the payload. Send an input carrying an
  // attacker's id/name in every field it has and assert authorship is still the
  // session actor's name - and that the session actor, not the payload, decided
  // permission.
  const creator = recordingCreator();
  const hostileInput = {
    ...sendInput(),
    title: OTHER_INSTRUCTOR_ID,
    body: OTHER_INSTRUCTOR_NAME,
    audience: "SPECIFIC",
    studentIds: [OTHER_INSTRUCTOR_ID],
  } as unknown as CreateMessageTaskInput;

  await sendInstructorMessageTaskWithDeps(
    { getCurrentInstructor: async () => sendActor(), createMessageTask: creator.delegate },
    hostileInput,
  );

  assert.equal(
    creator.calls[0].createdByName,
    SESSION_INSTRUCTOR_NAME,
    "authorship comes from the signed session, never from client input",
  );
  assert.notEqual(creator.calls[0].createdByName, OTHER_INSTRUCTOR_NAME);
  assert.equal(
    sendInstructorMessageTaskWithDeps.length,
    2,
    "the orchestration accepts only (deps, input) - there is no instructor id parameter",
  );
});

// ===========================================================================
// PART 1 - BEHAVIOURAL: read
// ===========================================================================

test("read: a null actor returns an empty list", async () => {
  const result = await loadInstructorMessageTaskViewWithDeps({
    getCurrentInstructor: async () => null,
    readItems: readerThatMustNotBeCalled(),
  });

  assert.deepEqual(result, [], "an anonymous/invalid/expired/inactive caller sees nothing");
});

test("read: a null actor never invokes readItems (no message or recipient name read)", async () => {
  let readCalls = 0;
  await loadInstructorMessageTaskViewWithDeps({
    getCurrentInstructor: async () => null,
    readItems: async () => {
      readCalls++;
      return sentinelRows("leak");
    },
  });

  assert.equal(readCalls, 0, "not a single MessageTask or recipient name may be read for a denied caller");
});

test("read: an authenticated actor WITHOUT canSendMessages still reads (identity-only)", async () => {
  // The read boundary is identity-only by design: canSendMessages gates sending
  // only, so this preserves today's behaviour for every active instructor.
  const rows = sentinelRows("identity-only");
  const result = await loadInstructorMessageTaskViewWithDeps({
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    readItems: async () => rows,
  });

  assert.equal(result, rows);
});

test("read: an authorized read invokes readItems once and returns its rows unchanged", async () => {
  const rows = sentinelRows("ok");
  let readCalls = 0;

  const result = await loadInstructorMessageTaskViewWithDeps({
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    readItems: async () => {
      readCalls++;
      return rows;
    },
  });

  assert.equal(readCalls, 1, "exactly one read");
  assert.equal(result, rows, "rows are returned by identity, not reshaped or filtered");
  assert.equal(
    loadInstructorMessageTaskViewWithDeps.length,
    1,
    "the orchestration accepts only (deps) - nothing client-supplied participates",
  );
});

// ===========================================================================
// PART 1 - BEHAVIOURAL: error propagation (never swallowed into a denial)
// ===========================================================================

test("infrastructure failures from getCurrentInstructor propagate on both paths", async () => {
  const boom = new Error("session/db infrastructure failure");

  await assert.rejects(
    () =>
      sendInstructorMessageTaskWithDeps(
        {
          getCurrentInstructor: async () => {
            throw boom;
          },
          createMessageTask: creatorThatMustNotBeCalled(),
        },
        sendInput(),
      ),
    boom,
    "a resolver failure must never be converted into a permission denial",
  );

  await assert.rejects(
    () =>
      loadInstructorMessageTaskViewWithDeps({
        getCurrentInstructor: async () => {
          throw boom;
        },
        readItems: readerThatMustNotBeCalled(),
      }),
    boom,
    "a resolver failure must never be converted into an empty list",
  );
});

test("infrastructure failures from the delegates propagate on both paths", async () => {
  const boom = new Error("prisma failure");

  await assert.rejects(
    () =>
      sendInstructorMessageTaskWithDeps(
        {
          getCurrentInstructor: async () => sendActor(),
          createMessageTask: async () => {
            throw boom;
          },
        },
        sendInput(),
      ),
    boom,
  );

  await assert.rejects(
    () =>
      loadInstructorMessageTaskViewWithDeps({
        getCurrentInstructor: async () => ({ id: "instructor-1" }),
        readItems: async () => {
          throw boom;
        },
      }),
    boom,
  );
});

// ===========================================================================
// PART 2 - STRUCTURAL
// ===========================================================================

const AUTH_MODULE_FILE = "./instructor-messages-auth.ts";
const MESSAGES_FILE = "./messages.ts";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * Source with block and line comments removed.
 *
 * The assertions below must test what each module actually DOES, not what its
 * documentation is allowed to mention: both files explain at length why the
 * client-supplied instructorId is not identity and what the old vulnerable
 * lookup was, and naming those in prose must not be mistaken for using them.
 */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The source of one exported function, from its declaration up to the next
 * TOP-LEVEL declaration of any kind. Cutting at every top-level declaration, not
 * just the next exported function, keeps a private helper that merely FOLLOWS an
 * action from being folded into that action's body and quietly satisfying an
 * assertion about it.
 */
const NEXT_TOP_LEVEL_DECLARATION =
  /\n(?:export )?(?:async function|function|const|interface|type|enum|class) /;

function functionSource(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} must still be an exported action`);
  const rest = src.slice(start + 1);
  const next = rest.search(NEXT_TOP_LEVEL_DECLARATION);
  return next >= 0 ? rest.slice(0, next) : rest;
}

test("the orchestration module is pure (no use-server / prisma / next)", () => {
  const src = readSource(AUTH_MODULE_FILE);
  // Match the actual directive / imports, not prose that merely mentions them
  // in a comment.
  const hasUseServerDirective = src
    .split("\n")
    .some((line) => /^\s*["']use server["'];?\s*$/.test(line));
  assert.ok(!hasUseServerDirective, "must NOT be a Server Action module");
  assert.ok(!/from\s+["']@\/lib\/prisma["']/.test(src), "must not import Prisma");
  assert.ok(!/from\s+["']next\/headers["']/.test(src), "must not import next/headers");
  assert.ok(!/from\s+["']next\/cache["']/.test(src), "must not import next/cache");

  const code = readCode(AUTH_MODULE_FILE);
  assert.ok(!/\bprisma\./.test(code), "must not reference Prisma at all");
  // Both edges back to the action modules must be type-only, so no runtime
  // circular import (and no transitive Prisma/next pull-in) is created.
  for (const target of ["./messages", "./students"]) {
    assert.ok(
      new RegExp(`import type \\{[^}]*\\} from "${target}";`).test(code),
      `the ${target} edge must be an erased type-only import`,
    );
  }
});

test("the orchestration resolves the actor BEFORE touching either delegate", () => {
  const code = readCode(AUTH_MODULE_FILE);
  for (const delegate of ["deps.createMessageTask(", "deps.readItems("]) {
    const actorAt = code.indexOf("await deps.getCurrentInstructor()");
    const delegateAt = code.indexOf(delegate);
    assert.ok(actorAt >= 0, "the actor resolver must be awaited");
    assert.ok(delegateAt >= 0, `${delegate} must still be the single data-touching call`);
    assert.ok(
      actorAt < delegateAt,
      `${delegate} must not be reachable before the actor is resolved`,
    );
  }
});

test("the two wired actions contain no data access of their own", () => {
  // Combined with the test above, this is the full source-order proof: the
  // exported actions perform NO Prisma access themselves, and the only
  // data-touching call in the whole path - the injected delegate - is provably
  // ordered after the actor gate inside the orchestration.
  const code = readCode(MESSAGES_FILE);
  for (const name of ["createMessageTaskAsInstructor", "getMessageTasksForInstructorView"]) {
    const body = functionSource(code, name);
    assert.ok(
      !/\bprisma\./.test(body),
      `${name} must not read or write the database before (or after) the gate`,
    );
    assert.ok(
      body.includes("getCurrentInstructor"),
      `${name} must derive identity from the canonical Actor DAL`,
    );
    assert.ok(
      !body.includes("requireCurrentInstructor"),
      `${name} must not throw across the action boundary - the clients expect a value`,
    );
  }
});

test("the send action discards the client-supplied instructorId", () => {
  const body = functionSource(readCode(MESSAGES_FILE), "createMessageTaskAsInstructor");
  assert.ok(body.includes("void instructorId;"), "the client id must be explicitly discarded");
  assert.ok(
    !body.includes("prisma.instructor.findUnique"),
    "the client-id actor lookup that authorized nothing must be gone",
  );
  // The parameter may appear ONLY in the signature and in the discard - never in
  // a lookup, comparison, filter or authorship field.
  const uses = [...body.matchAll(/\binstructorId\b/g)].length;
  assert.equal(uses, 2, "instructorId may appear only as the parameter and the discard");
});

test("the instructor-view reader is private and gate-only reachable", () => {
  const code = readCode(MESSAGES_FILE);
  assert.ok(
    code.includes("async function readMessageTasksForInstructorView()"),
    "the reader must still exist",
  );
  assert.ok(
    !code.includes("export async function readMessageTasksForInstructorView"),
    "the reader must NOT be exported - it would be an ungated Server Action",
  );
  assert.ok(
    functionSource(code, "getMessageTasksForInstructorView").includes(
      "readItems: readMessageTasksForInstructorView",
    ),
    "the reader must be reachable only as the gate's delegate",
  );
});

test("both exported client signatures are unchanged", () => {
  const src = readSource(MESSAGES_FILE);
  assert.ok(
    /export async function createMessageTaskAsInstructor\(\s*instructorId: string,\s*input: CreateMessageTaskInput\s*\): Promise<ActionResult> \{/.test(
      src,
    ),
    "createMessageTaskAsInstructor(instructorId, input) must be byte-identical",
  );
  assert.ok(
    /export async function getMessageTasksForInstructorView\(\): Promise<InstructorMessageTaskView\[\]> \{/.test(
      src,
    ),
    "getMessageTasksForInstructorView() must stay parameterless",
  );
});

test("this slice changed no fan-out, capability or course-scoping behaviour", () => {
  const code = readCode(MESSAGES_FILE);
  // resolveRecipientIds and createMessageTaskInternal are untouched, and no
  // course/capability concept entered either instructor action.
  assert.ok(code.includes("async function resolveRecipientIds("), "fan-out resolver must still exist");
  assert.ok(
    code.includes("async function createMessageTaskInternal("),
    "the shared creator must still exist",
  );
  for (const name of ["createMessageTaskAsInstructor", "getMessageTasksForInstructorView"]) {
    const body = functionSource(code, name);
    for (const token of ["courseOfferingId", "Capability", "CAPABILITY", "resolveCurrent"]) {
      assert.ok(!body.includes(token), `${name} must not introduce ${token}`);
    }
  }
});
