/**
 * Pure session-token cryptography (Stage 0A-1a).
 *
 * PURITY CONTRACT — this module MUST remain free of runtime/environment coupling.
 * It MUST NOT import "server-only", next/headers, cookies, Prisma, process.env,
 * or any application action/component, and MUST NOT read a secret from the
 * environment or at module load. The secret is always supplied explicitly as a
 * Uint8Array parameter.
 *
 * Only pure signing + verification functions are exported. Tokens are signed
 * with HS256 via `jose`. The signed payload is a fresh, explicitly whitelisted
 * object; caller input is never spread into the JWT. Verification fails closed
 * (returns null) for every invalid/tampered/expired/wrong-audience/wrong-secret
 * /malformed/unsupported-version/missing-claim case. Token contents and secrets
 * are never logged.
 *
 * See COURSE-ARCHITECTURE-HANDOFF.md — Stage 0A / AUTH-BLOCKER-1/2.
 */

import { SignJWT, jwtVerify } from "jose";
import type {
  SessionAudience,
  SessionSigningInput,
  VerifiedSession,
} from "./session-types";

/** The only supported session-token version. */
export const SESSION_TOKEN_VERSION = 1 as const;

/** Recognized audience values the verifier will accept. */
const ALLOWED_AUDIENCES: readonly SessionAudience[] = [
  "instructor",
  "trainee",
  "tablet",
];

/**
 * Audiences that may actually be issued a token. Deliberately narrower than
 * {@link ALLOWED_AUDIENCES}: `tablet` is a reserved verifier-only namespace and
 * is never signed. Enforced at runtime in {@link signSessionToken} so a caller
 * that bypasses the TypeScript contract (e.g. via a cast) still cannot mint a
 * token for an unsupported audience.
 */
const ISSUABLE_AUDIENCES: readonly SessionAudience[] = ["instructor", "trainee"];

/**
 * Sign a session token.
 *
 * Builds a FRESH, explicitly whitelisted payload — the caller's input object is
 * never spread into the JWT. The signed payload contains ONLY: aud, sub, iat,
 * exp, sid, ver (ver is always {@link SESSION_TOKEN_VERSION}). It can never
 * carry identityNumber, any can* permission, courseType, courseOfferingId,
 * groupName, or any other authorization/capability data.
 *
 * @param input  Narrow signing input (audience/subject/timestamps/sessionId).
 * @param secret HMAC secret as a Uint8Array (supplied explicitly by the caller).
 */
export async function signSessionToken(
  input: SessionSigningInput,
  secret: Uint8Array,
): Promise<string> {
  // Runtime issuance guard: even if a caller bypasses the TypeScript contract
  // (e.g. `{ audience: "tablet" } as unknown as SessionSigningInput`), refuse to
  // sign any audience outside the issuable set BEFORE any signing work. This is
  // an internal, secret-holding caller path, so a bad audience is a programming
  // error that must be loud (throw), not a silently returned null. The error
  // message intentionally omits the secret, token, and full input.
  if (!ISSUABLE_AUDIENCES.includes(input.audience as SessionAudience)) {
    throw new Error("unsupported audience");
  }

  // Whitelist: seed ONLY the non-standard claims here; standard claims (aud,
  // sub, iat, exp) are set below via the builder. Never spread `input`.
  const payload = {
    ver: SESSION_TOKEN_VERSION,
    sid: input.sessionId,
  };

  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience(input.audience)
    .setSubject(input.subject)
    .setIssuedAt(input.issuedAt)
    .setExpirationTime(input.expiresAt)
    .sign(secret);
}

/**
 * Verify a session token. Returns the verified claims on success, or null for
 * ANY failure. Never throws; never logs token contents or secrets.
 *
 * Fails closed for: invalid signature, tampered token, wrong audience, expired
 * token, wrong secret, malformed token, missing required claims, unsupported
 * version, empty subject, empty session id, non-finite timestamps, and exp not
 * greater than iat. jose enforces the signature + expiry; explicit manual
 * checks below turn every remaining failure mode into a null return.
 *
 * @param token            The compact JWS token string.
 * @param expectedAudience The audience this token must have been issued for.
 * @param secret           HMAC secret as a Uint8Array (supplied explicitly).
 */
export async function verifySessionToken(
  token: string,
  expectedAudience: SessionAudience,
  secret: Uint8Array,
): Promise<VerifiedSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      audience: expectedAudience,
    });

    // Audience: must be a single recognized value equal to the expected one.
    const aud = payload.aud;
    if (typeof aud !== "string") {
      return null;
    }
    if (!ALLOWED_AUDIENCES.includes(aud as SessionAudience)) {
      return null;
    }
    if (aud !== expectedAudience) {
      return null;
    }

    // Version: must be exactly the supported version.
    if (payload.ver !== SESSION_TOKEN_VERSION) {
      return null;
    }

    // Subject: non-empty string.
    const sub = payload.sub;
    if (typeof sub !== "string" || sub.length === 0) {
      return null;
    }

    // Session id: non-empty string.
    const sid = payload.sid;
    if (typeof sid !== "string" || sid.length === 0) {
      return null;
    }

    // Timestamps: finite numbers with exp strictly after iat.
    const iat = payload.iat;
    const exp = payload.exp;
    if (typeof iat !== "number" || !Number.isFinite(iat)) {
      return null;
    }
    if (typeof exp !== "number" || !Number.isFinite(exp)) {
      return null;
    }
    if (exp <= iat) {
      return null;
    }

    return {
      audience: aud as SessionAudience,
      subject: sub,
      issuedAt: iat,
      expiresAt: exp,
      sessionId: sid,
    };
  } catch {
    // Any jose failure (bad signature, expired, wrong audience, malformed, ...)
    // is a verification failure. Do not surface details.
    return null;
  }
}
