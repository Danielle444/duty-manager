/**
 * Client version AWARENESS source of truth (Stage 0B-1).
 *
 * This is intentionally the ONLY place the compatibility epoch is declared: a
 * single, manually-bumped source-code constant. There is no automatic build id,
 * no git SHA, no Vercel deployment id, and no environment variable involved.
 *
 * IMPORTANT — this is awareness only, NOT authorization. It exists so an open
 * instructor/trainee bundle can notice it is older than the currently-served
 * bundle and offer a guarded full reload. It never blocks a Server Action, never
 * inspects a session, never reads a cookie, and is never sufficient for the
 * one-way auth cutover (Stage 0A) or offering-aware authorization (later waves).
 *
 * To declare a new incompatible client epoch, bump this integer by one. Equal
 * epochs are compatible; a served epoch strictly greater than the running
 * bundle's epoch is a confirmed mismatch (the running bundle is behind). A
 * served epoch that is missing, malformed, or not strictly greater is treated
 * as "no mismatch" and FAILS OPEN.
 *
 * See COURSE-ARCHITECTURE-HANDOFF.md — RO-2…RO-5 / Part 27 (client version =
 * compatibility metadata only, never authorization).
 */

export const APP_COMPATIBILITY_VERSION = 1;

/**
 * The exact, only body the GET /api/version route returns. Kept here as a pure
 * builder so the route stays a thin wrapper and the "returns only { version }"
 * contract is directly testable without importing next/server.
 */
export function buildVersionResponseBody(): { version: number } {
  return { version: APP_COMPATIBILITY_VERSION };
}

/**
 * The exact headers the GET /api/version route sets. `no-store` guarantees a
 * stale intermediary/browser cache can never mask a real epoch bump.
 */
export const VERSION_RESPONSE_NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;
