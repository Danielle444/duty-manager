/**
 * Executable tests for the client version AWARENESS layer (Stage 0B-1).
 *
 * Uses the existing `tsx` runner with Node built-ins `node:test` and
 * `node:assert/strict`. No test framework is installed. Run with:
 *   npx tsx --test lib/version-gate/*.test.ts
 *
 * These tests exercise the PURE decision/parse helpers and the pure route
 * body/header builders directly (no DOM, no next/server). The React hook's
 * awareness-only guarantees (never clears identity/localStorage, never reads
 * cookies, never logs out) and the route's no-DB/no-auth/no-cookie guarantees
 * are asserted by scanning the module sources.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  APP_COMPATIBILITY_VERSION,
  buildVersionResponseBody,
  VERSION_RESPONSE_NO_STORE_HEADERS,
} from "./compatibility-version";
import {
  decideVersionGateStatus,
  parseServerVersion,
  VERSION_GATE_RELOAD_MARKER_KEY,
} from "./useVersionGate";

// Identity/auth keys this awareness layer must NEVER touch.
const INSTRUCTOR_IDENTITY_KEY = "duty-manager-instructor-v2";
const TRAINEE_IDENTITY_KEY = "duty-manager-student";

function readSibling(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

// Strips block and line comments so source scans assert on actual CODE, not on
// explanatory prose (these modules describe in comments the very things they
// must not do). Neither scanned module contains a "//" inside a string literal.
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// 1. equal epoch → normal app (ok)
test("equal epoch resolves to ok (normal app)", () => {
  assert.equal(
    decideVersionGateStatus({
      clientVersion: 3,
      serverVersion: 3,
      reloadAttemptedForVersion: null,
    }),
    "ok",
  );
});

// 2. served epoch strictly greater → update-required
test("served epoch ahead of the running bundle → update-required", () => {
  assert.equal(
    decideVersionGateStatus({
      clientVersion: 3,
      serverVersion: 4,
      reloadAttemptedForVersion: null,
    }),
    "update-required",
  );
});

// 3. a served epoch BEHIND the running bundle is not a mismatch → fail open
test("served epoch behind the running bundle fails open to ok", () => {
  assert.equal(
    decideVersionGateStatus({
      clientVersion: 5,
      serverVersion: 4,
      reloadAttemptedForVersion: null,
    }),
    "ok",
  );
});

// 4. unreachable endpoint (serverVersion null) → fail open
test("unreachable endpoint (null served epoch) fails open to ok", () => {
  assert.equal(
    decideVersionGateStatus({
      clientVersion: 3,
      serverVersion: null,
      reloadAttemptedForVersion: null,
    }),
    "ok",
  );
});

// 5. malformed responses parse to null (→ fail open via decide)
test("malformed /api/version bodies parse to null", () => {
  assert.equal(parseServerVersion(null), null);
  assert.equal(parseServerVersion(undefined), null);
  assert.equal(parseServerVersion("nope"), null);
  assert.equal(parseServerVersion(42), null);
  assert.equal(parseServerVersion({}), null);
  assert.equal(parseServerVersion({ version: "4" }), null);
  assert.equal(parseServerVersion({ version: Number.NaN }), null);
  assert.equal(parseServerVersion({ version: Infinity }), null);
  // A well-formed body parses to the numeric epoch.
  assert.equal(parseServerVersion({ version: 7 }), 7);
});

// 6. one reload attempt only: after a guarded reload for the served epoch, a
//    persistent mismatch resolves to the static fallback (never re-offers the
//    same reload).
test("one reload attempt only → persistent mismatch becomes reload-failed", () => {
  assert.equal(
    decideVersionGateStatus({
      clientVersion: 3,
      serverVersion: 4,
      reloadAttemptedForVersion: 4,
    }),
    "reload-failed",
  );
});

// 7. the loop guard is per served epoch: a marker for an OLDER epoch does not
//    suppress the update prompt for a newer served epoch.
test("loop guard is scoped to the exact served epoch", () => {
  assert.equal(
    decideVersionGateStatus({
      clientVersion: 3,
      serverVersion: 5,
      reloadAttemptedForVersion: 4,
    }),
    "update-required",
  );
});

// 8. the exported compatibility source constant is a finite number and is what
//    the route body returns.
test("route body returns only the source constant", () => {
  assert.equal(typeof APP_COMPATIBILITY_VERSION, "number");
  assert.ok(Number.isFinite(APP_COMPATIBILITY_VERSION));
  const body = buildVersionResponseBody();
  assert.deepEqual(body, { version: APP_COMPATIBILITY_VERSION });
  assert.deepEqual(Object.keys(body), ["version"]);
});

// 9. the route sets no-store and nothing else.
test("route headers are exactly no-store", () => {
  assert.equal(VERSION_RESPONSE_NO_STORE_HEADERS["Cache-Control"], "no-store");
  assert.deepEqual(Object.keys(VERSION_RESPONSE_NO_STORE_HEADERS), [
    "Cache-Control",
  ]);
});

// 10. the reload-guard key is dedicated and never collides with identity keys.
test("reload marker key is distinct from identity keys", () => {
  assert.notEqual(VERSION_GATE_RELOAD_MARKER_KEY, INSTRUCTOR_IDENTITY_KEY);
  assert.notEqual(VERSION_GATE_RELOAD_MARKER_KEY, TRAINEE_IDENTITY_KEY);
});

// 11. the hook module never clears identity/localStorage, never reads cookies,
//     and never logs out (awareness-only guarantee, verified by source scan).
test("hook never touches identity/localStorage/cookies/logout", () => {
  const source = codeOnly(readSibling("./useVersionGate.ts"));
  assert.equal(source.includes(INSTRUCTOR_IDENTITY_KEY), false);
  assert.equal(source.includes(TRAINEE_IDENTITY_KEY), false);
  assert.equal(source.includes("localStorage"), false);
  assert.equal(source.includes("document.cookie"), false);
  assert.equal(source.includes("logout"), false);
  // The only storage removal permitted is the hook's own reload-guard marker.
  const removalMatches = source.match(/removeItem\(([^)]*)\)/g) ?? [];
  for (const call of removalMatches) {
    assert.ok(
      call.includes("VERSION_GATE_RELOAD_MARKER_KEY"),
      `unexpected removeItem target: ${call}`,
    );
  }
});

// 12. the route module performs no DB, no auth, and no cookie access (verified
//     by source scan) — awareness only.
test("route does no DB / auth / cookie access", () => {
  const source = codeOnly(readSibling("../../app/api/version/route.ts"));
  assert.equal(source.includes("prisma"), false);
  assert.equal(source.includes("requireAdmin"), false);
  assert.equal(source.includes("next-auth"), false);
  assert.equal(source.includes("cookies"), false);
  assert.equal(source.includes("headers("), false);
  // It must return the pure builder body and the no-store headers.
  assert.ok(source.includes("buildVersionResponseBody"));
  assert.ok(source.includes("VERSION_RESPONSE_NO_STORE_HEADERS"));
});
