/**
 * Session-token type contract for the pure crypto layer (Stage 0A-1a).
 *
 * These types describe ONLY what the pure signing/verification layer needs.
 * They intentionally contain no cookie, DAL, Prisma, or environment concepts.
 * Authorization/capability data (identityNumber, can* flags, courseType,
 * courseOfferingId, groupName, etc.) must NEVER appear here or in a token.
 *
 * See COURSE-ARCHITECTURE-HANDOFF.md — Stage 0A (identity hardening) and
 * AUTH-BLOCKER-1/2. Session isolation distinguishes instructor / trainee /
 * tablet audiences; `tablet` is RESERVED for future use only.
 */

/**
 * All session audiences. Session isolation is enforced by audience.
 *
 * `tablet` is a RESERVED member only — Stage 0A-1a issues no tablet tokens and
 * defines no tablet issuance/cookie/DAL behavior. It exists so the verifier can
 * recognize the audience namespace as complete.
 */
export type SessionAudience = "instructor" | "trainee" | "tablet";

/**
 * Audiences Stage 0A-1a is permitted to issue tokens for. Deliberately narrower
 * than {@link SessionAudience}: no function issues a `tablet` token.
 */
export type IssuableSessionAudience = "instructor" | "trainee";

/**
 * Narrow signing input for the pure signer. This is NOT arbitrary JWT claims —
 * it is the minimal, explicit contract the crypto layer accepts.
 *
 * Timestamps are Unix epoch seconds.
 */
export interface SessionSigningInput {
  /** Session audience (isolation boundary). Only issuable audiences allowed. */
  audience: IssuableSessionAudience;
  /** Opaque subject identifier for the session (non-empty). */
  subject: string;
  /** Issued-at time, Unix epoch seconds. */
  issuedAt: number;
  /** Expiry time, Unix epoch seconds; must be greater than {@link issuedAt}. */
  expiresAt: number;
  /** Opaque session identifier (non-empty). */
  sessionId: string;
}

/**
 * The verified claims returned by the verifier on success. Contains ONLY
 * identity + lifecycle data — never authorization/capability data.
 */
export interface VerifiedSession {
  /** Verified audience (one of the recognized {@link SessionAudience} values). */
  audience: SessionAudience;
  /** Verified subject identifier. */
  subject: string;
  /** Issued-at time, Unix epoch seconds. */
  issuedAt: number;
  /** Expiry time, Unix epoch seconds. */
  expiresAt: number;
  /** Verified session identifier. */
  sessionId: string;
}
