/**
 * Pure self-acting authorization check (Stage 0A first wiring).
 *
 * PURE by construction: no next/headers, no Prisma, no environment access, no
 * logging, never throws. It decides ONE thing — whether a client-supplied id may
 * be honored for a self-acting request — by comparing it against an already
 * server-derived actor id. It performs no permission (can*) allow/deny decision.
 *
 * The client-supplied id is NEVER treated as authority. The only value a caller
 * may act on is the returned `actorId`, which is always the server-derived id
 * (never the raw client value), so an ownership filter or write built from it is
 * bound to the authenticated actor even when the two happen to be equal.
 *
 * Fails closed (authorized: false) for a missing/empty server actor id (no,
 * invalid, wrong-audience, or inactive-actor session already collapsed to null
 * upstream) and for any mismatch between the server actor id and the
 * client-supplied id. The result carries no reason detail — callers translate a
 * denial into their own generic failure so nothing internal is exposed.
 *
 * See COURSE-ARCHITECTURE-HANDOFF.md — Stage 0A / AUTH-BLOCKER-1/2.
 */

/** Outcome of {@link authorizeSelfActingClientId}. */
export type SelfActorAuthorization =
  | { authorized: true; actorId: string }
  | { authorized: false };

/**
 * Decide whether a self-acting request bearing `clientSuppliedId` may proceed.
 *
 * Returns `{ authorized: true, actorId }` — with `actorId` set to the
 * server-derived id — ONLY when a non-empty server actor id is present AND it
 * exactly equals the client-supplied id. Otherwise returns
 * `{ authorized: false }`.
 *
 * @param actorId          The server-derived actor id (e.g. getCurrentInstructor
 *                         /getCurrentTrainee .id), or null/undefined when no
 *                         trustworthy actor exists.
 * @param clientSuppliedId The id the client sent; compared only, never trusted.
 */
export function authorizeSelfActingClientId(
  actorId: string | null | undefined,
  clientSuppliedId: string,
): SelfActorAuthorization {
  if (actorId === null || actorId === undefined || actorId === "") {
    return { authorized: false };
  }
  if (actorId !== clientSuppliedId) {
    return { authorized: false };
  }
  return { authorized: true, actorId };
}
