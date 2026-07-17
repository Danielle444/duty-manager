/**
 * Executable tests for the pure session-token crypto layer (Stage 0A-1a).
 *
 * Uses the existing `tsx` runner with Node built-ins `node:test` and
 * `node:assert/strict`. No test framework is installed. Run with:
 *   npx tsx --test lib/auth/session-crypto.test.ts
 *
 * Adversarial tokens (unsupported version, missing/empty claims, exp<=iat) are
 * constructed directly with jose's SignJWT so the pure signer's whitelist does
 * not sanitize them away.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT, UnsecuredJWT, decodeJwt } from "jose";
import {
  signSessionToken,
  verifySessionToken,
  SESSION_TOKEN_VERSION,
} from "./session-crypto";
import type { SessionSigningInput } from "./session-types";

// HS256 requires a key of at least 256 bits (32 bytes); both are longer.
const secret = new TextEncoder().encode(
  "stage-0a-1a-primary-session-test-secret-00",
);
const wrongSecret = new TextEncoder().encode(
  "stage-0a-1a-DIFFERENT-session-test-secret-0",
);

const nowSec = () => Math.floor(Date.now() / 1000);

function baseInput(
  overrides: Partial<SessionSigningInput> = {},
): SessionSigningInput {
  const iat = nowSec();
  return {
    audience: "instructor",
    subject: "instructor-123",
    issuedAt: iat,
    expiresAt: iat + 3600,
    sessionId: "sess-abc",
    ...overrides,
  };
}

// 1. valid instructor round trip
test("valid instructor token round trips", async () => {
  const token = await signSessionToken(baseInput(), secret);
  const result = await verifySessionToken(token, "instructor", secret);
  assert.ok(result);
  assert.equal(result.audience, "instructor");
  assert.equal(result.subject, "instructor-123");
  assert.equal(result.sessionId, "sess-abc");
  assert.equal(typeof result.issuedAt, "number");
  assert.equal(result.expiresAt, result.issuedAt + 3600);
});

// 2. valid trainee round trip
test("valid trainee token round trips", async () => {
  const input = baseInput({ audience: "trainee", subject: "student-789" });
  const token = await signSessionToken(input, secret);
  const result = await verifySessionToken(token, "trainee", secret);
  assert.ok(result);
  assert.equal(result.audience, "trainee");
  assert.equal(result.subject, "student-789");
});

// 3. tampered token rejection
test("tampered token is rejected", async () => {
  const token = await signSessionToken(baseInput(), secret);
  const parts = token.split(".");
  // Mutate the signature segment so it no longer matches the payload.
  parts[2] = parts[2].endsWith("AA")
    ? `${parts[2].slice(0, -2)}BB`
    : `${parts[2].slice(0, -2)}AA`;
  const tampered = parts.join(".");
  assert.equal(await verifySessionToken(tampered, "instructor", secret), null);
});

// 4. instructor token rejected when expected audience is trainee
test("instructor token is rejected when trainee audience is expected", async () => {
  const token = await signSessionToken(
    baseInput({ audience: "instructor" }),
    secret,
  );
  assert.equal(await verifySessionToken(token, "trainee", secret), null);
});

// 5. trainee token rejected when expected audience is instructor
test("trainee token is rejected when instructor audience is expected", async () => {
  const token = await signSessionToken(
    baseInput({ audience: "trainee", subject: "student-789" }),
    secret,
  );
  assert.equal(await verifySessionToken(token, "instructor", secret), null);
});

// 6. expired token rejection
test("expired token is rejected", async () => {
  const iat = nowSec() - 7200;
  const token = await signSessionToken(
    baseInput({ issuedAt: iat, expiresAt: iat + 3600 }),
    secret,
  );
  assert.equal(await verifySessionToken(token, "instructor", secret), null);
});

// 7. wrong-secret rejection
test("token verified with the wrong secret is rejected", async () => {
  const token = await signSessionToken(baseInput(), secret);
  assert.equal(
    await verifySessionToken(token, "instructor", wrongSecret),
    null,
  );
});

// 8. malformed token rejection
test("malformed tokens are rejected", async () => {
  assert.equal(await verifySessionToken("", "instructor", secret), null);
  assert.equal(await verifySessionToken("not-a-jwt", "instructor", secret), null);
  assert.equal(await verifySessionToken("a.b", "instructor", secret), null);
  assert.equal(
    await verifySessionToken("a.b.c.d", "instructor", secret),
    null,
  );
});

// 9. unsupported ver rejection
test("token with an unsupported version is rejected", async () => {
  const iat = nowSec();
  const token = await new SignJWT({ ver: 2, sid: "sess-x" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("instructor")
    .setSubject("instructor-123")
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(secret);
  assert.equal(await verifySessionToken(token, "instructor", secret), null);
});

// 10. missing/invalid required claim rejection
test("token missing the sid claim is rejected", async () => {
  const iat = nowSec();
  const token = await new SignJWT({ ver: SESSION_TOKEN_VERSION })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("instructor")
    .setSubject("instructor-123")
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(secret);
  assert.equal(await verifySessionToken(token, "instructor", secret), null);
});

test("token with an empty subject is rejected", async () => {
  const iat = nowSec();
  const token = await new SignJWT({ ver: SESSION_TOKEN_VERSION, sid: "sess-x" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("instructor")
    .setSubject("")
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(secret);
  assert.equal(await verifySessionToken(token, "instructor", secret), null);
});

test("token missing the iat claim is rejected", async () => {
  const iat = nowSec();
  // No setIssuedAt() call → no iat claim.
  const token = await new SignJWT({ ver: SESSION_TOKEN_VERSION, sid: "sess-x" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("instructor")
    .setSubject("instructor-123")
    .setExpirationTime(iat + 3600)
    .sign(secret);
  assert.equal(await verifySessionToken(token, "instructor", secret), null);
});

// 11. exp <= iat rejection
test("token with exp not greater than iat is rejected", async () => {
  // Both timestamps in the future so jose's own expiry check passes; the
  // explicit exp <= iat check must still reject it.
  const future = nowSec() + 3600;
  const token = await new SignJWT({ ver: SESSION_TOKEN_VERSION, sid: "sess-x" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("instructor")
    .setSubject("instructor-123")
    .setIssuedAt(future)
    .setExpirationTime(future)
    .sign(secret);
  assert.equal(await verifySessionToken(token, "instructor", secret), null);
});

// 12. payload whitelist: runtime-extra fields must never reach the JWT payload
test("signed payload contains only whitelisted claims", async () => {
  const iat = nowSec();
  // Cast through unknown to bypass TS excess-property checking and simulate a
  // caller passing forbidden authorization/capability data at runtime.
  const pollutedInput = {
    audience: "instructor",
    subject: "instructor-123",
    issuedAt: iat,
    expiresAt: iat + 3600,
    sessionId: "sess-abc",
    identityNumber: "302040506",
    canEditAttendance: true,
    courseOfferingId: "offering-1",
    courseType: "LEVEL_1",
    groupName: "A",
  } as unknown as SessionSigningInput;

  const token = await signSessionToken(pollutedInput, secret);

  // Decode the raw JWT payload (not TS types) to PROVE what was signed.
  const decoded = decodeJwt(token) as Record<string, unknown>;

  for (const forbidden of [
    "identityNumber",
    "canEditAttendance",
    "courseOfferingId",
    "courseType",
    "groupName",
  ]) {
    assert.equal(
      forbidden in decoded,
      false,
      `payload must not contain ${forbidden}`,
    );
  }

  // The payload keys are exactly the whitelist.
  assert.deepEqual(
    Object.keys(decoded).sort(),
    ["aud", "exp", "iat", "sid", "sub", "ver"].sort(),
  );
  assert.equal(decoded.ver, SESSION_TOKEN_VERSION);

  // And the (clean) token still verifies.
  const result = await verifySessionToken(token, "instructor", secret);
  assert.ok(result);
  assert.equal(result.subject, "instructor-123");
});

// 13. runtime issuance guard: tablet audience (via cast) must be rejected
test("signSessionToken rejects a runtime-cast tablet audience", async () => {
  const iat = nowSec();
  // Bypass the TypeScript contract exactly as an unsafe runtime caller would.
  const tabletInput = {
    audience: "tablet",
    subject: "device-1",
    issuedAt: iat,
    expiresAt: iat + 3600,
    sessionId: "sess-tablet",
  } as unknown as SessionSigningInput;

  await assert.rejects(() => signSessionToken(tabletInput, secret));
});

// 14. runtime issuance guard: any other unsupported audience must be rejected
test("signSessionToken rejects unsupported runtime audiences", async () => {
  const iat = nowSec();
  const adminInput = {
    audience: "admin",
    subject: "admin-1",
    issuedAt: iat,
    expiresAt: iat + 3600,
    sessionId: "sess-admin",
  } as unknown as SessionSigningInput;
  await assert.rejects(() => signSessionToken(adminInput, secret));

  const emptyInput = {
    audience: "",
    subject: "x-1",
    issuedAt: iat,
    expiresAt: iat + 3600,
    sessionId: "sess-empty",
  } as unknown as SessionSigningInput;
  await assert.rejects(() => signSessionToken(emptyInput, secret));
});

// 15. algorithm confusion: an alg=none / unsecured token must be rejected
test("an unsecured (alg=none) token is rejected", async () => {
  const iat = nowSec();
  // UnsecuredJWT produces a JWS with "alg":"none" and no signature. The HS256
  // allowlist in verifySessionToken must reject it regardless of claim shape.
  const unsecured = new UnsecuredJWT({
    ver: SESSION_TOKEN_VERSION,
    sid: "sess-x",
  })
    .setAudience("instructor")
    .setSubject("instructor-123")
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .encode();
  assert.equal(await verifySessionToken(unsecured, "instructor", secret), null);
});

// 16. correctly signed (right secret) token missing exp is rejected
test("a correctly signed token missing exp is rejected", async () => {
  const iat = nowSec();
  // Signed with the CORRECT secret and correct-shaped claims but NO exp, so the
  // rejection proves claim validation rather than a signature failure.
  const token = await new SignJWT({ ver: SESSION_TOKEN_VERSION, sid: "sess-x" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("instructor")
    .setSubject("instructor-123")
    .setIssuedAt(iat)
    .sign(secret);
  assert.equal(await verifySessionToken(token, "instructor", secret), null);
});

// 17. correctly signed (right secret) token missing sub is rejected
test("a correctly signed token missing sub is rejected", async () => {
  const iat = nowSec();
  const token = await new SignJWT({ ver: SESSION_TOKEN_VERSION, sid: "sess-x" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("instructor")
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(secret);
  assert.equal(await verifySessionToken(token, "instructor", secret), null);
});

// 18. correctly signed (right secret) token with empty sid is rejected
test("a correctly signed token with an empty sid is rejected", async () => {
  const iat = nowSec();
  const token = await new SignJWT({ ver: SESSION_TOKEN_VERSION, sid: "" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("instructor")
    .setSubject("instructor-123")
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(secret);
  assert.equal(await verifySessionToken(token, "instructor", secret), null);
});
