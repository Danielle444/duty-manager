import { NextResponse } from "next/server";
import {
  buildVersionResponseBody,
  VERSION_RESPONSE_NO_STORE_HEADERS,
} from "@/lib/version-gate/compatibility-version";

/**
 * GET /api/version — client version AWARENESS preflight (Stage 0B-1).
 *
 * Returns ONLY the manually-declared compatibility epoch. It performs no
 * authentication, no database access, no cookie access, resolves no identity,
 * and reads no secrets. It is deliberately un-cached (`no-store`) so a stale
 * client can always observe the currently-served epoch.
 *
 * This is awareness only — it is NOT authorization and it does NOT gate any
 * Server Action (see COURSE-ARCHITECTURE-HANDOFF.md RO-4/RO-5).
 */

// This response depends on nothing request-specific, but force-dynamic keeps it
// from ever being statically cached, reinforcing the `no-store` guarantee.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(buildVersionResponseBody(), {
    headers: VERSION_RESPONSE_NO_STORE_HEADERS,
  });
}
