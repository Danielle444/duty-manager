/**
 * Executable tests for the pure self-acting authorization helper
 * (Stage 0A first wiring).
 *
 * Uses the existing `tsx` runner with Node built-ins `node:test` and
 * `node:assert/strict`. No test framework is installed. Run with:
 *   npx tsx --test lib/auth/self-actor-authorization.test.ts
 *
 * These tests are PURE: they exercise only ./self-actor-authorization (no
 * next/headers, no Prisma, no cookies). They cover the NEW security surface this
 * stage adds — that a client-supplied id can never act as authority.
 *
 * The complementary properties the two wired pilot actions rely on are already
 * covered by existing tests and are NOT duplicated here:
 *  - wrong-audience / cross-audience rejection: actor-core.test.ts (#7, #8)
 *  - null / inactive / subject-mismatch → null actor: actor-core.test.ts (#4-6, #9)
 *  - invalid / tampered / expired / wrong-secret session → null: session-crypto.test.ts
 * When getCurrentInstructor()/getCurrentTrainee() return null in any of those
 * cases, `actorId` is undefined here and this helper denies (cases below).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { authorizeSelfActingClientId } from "./self-actor-authorization";

const ACTOR_ID = "actor-123";

// 1. matching id + present actor → authorized, actorId is the SERVER id
test("matching client id yields authorized with the server actor id", () => {
  const result = authorizeSelfActingClientId(ACTOR_ID, ACTOR_ID);
  assert.equal(result.authorized, true);
  // Narrow for TypeScript, then assert the returned id is the server id.
  assert.ok(result.authorized);
  assert.equal(result.actorId, ACTOR_ID);
});

// 2. the returned actorId is always the SERVER value, never the client argument
//    object — even when equal, callers must act on result.actorId.
test("authorized result exposes only { authorized, actorId }", () => {
  const result = authorizeSelfActingClientId(ACTOR_ID, ACTOR_ID);
  assert.ok(result.authorized);
  assert.deepEqual(Object.keys(result).sort(), ["actorId", "authorized"]);
});

// 3. mismatched client id → denied (impersonation blocked)
test("mismatched client id is denied (cannot impersonate another user)", () => {
  const result = authorizeSelfActingClientId(ACTOR_ID, "someone-else");
  assert.equal(result.authorized, false);
  assert.equal("actorId" in result, false);
});

// 4. null actor (no/invalid/wrong-audience/inactive session) → denied
test("null actor id is denied", () => {
  assert.equal(authorizeSelfActingClientId(null, ACTOR_ID).authorized, false);
});

// 5. undefined actor (actor?.id when actor is null) → denied
test("undefined actor id is denied", () => {
  assert.equal(
    authorizeSelfActingClientId(undefined, ACTOR_ID).authorized,
    false,
  );
});

// 6. empty-string actor id → denied (defensive; never authorizes on "")
test("empty-string actor id is denied", () => {
  assert.equal(authorizeSelfActingClientId("", "").authorized, false);
  assert.equal(authorizeSelfActingClientId("", ACTOR_ID).authorized, false);
});

// 7. empty-string client id against a real actor → denied (mismatch)
test("empty client id against a real actor is denied", () => {
  assert.equal(authorizeSelfActingClientId(ACTOR_ID, "").authorized, false);
});

// 8. totality: never throws across representative inputs
test("helper is total (never throws) across representative inputs", () => {
  assert.doesNotThrow(() => authorizeSelfActingClientId(null, ""));
  assert.doesNotThrow(() => authorizeSelfActingClientId(undefined, ACTOR_ID));
  assert.doesNotThrow(() => authorizeSelfActingClientId(ACTOR_ID, ACTOR_ID));
  assert.doesNotThrow(() => authorizeSelfActingClientId(ACTOR_ID, "x"));
});
