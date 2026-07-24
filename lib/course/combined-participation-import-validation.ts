/**
 * Combined Participation Slice 1 - PURE, DB-free validation helpers shared by
 * the two schedule-import preview clients (and available to the server writers).
 *
 * PURE by construction: no Prisma, no DB, no clock, no next/*, no React. These
 * only inspect the `combinedParticipationMalformed` marker that the Excel parser
 * attaches to each preview row, so the preview UIs and the authoritative server
 * gate answer "is any משולב value unparseable?" the same way.
 *
 * The marker is UX-only plumbing: it never reaches a Prisma payload. The server
 * writers re-derive malformedness authoritatively (they never trust the client
 * gate), so these helpers exist to SURFACE and BLOCK in the preview, not to
 * authorize a write.
 */

/** The minimal shape these helpers read: only the malformed marker and a key. */
export interface CombinedParticipationMarker {
  readonly key?: string;
  readonly combinedParticipationMalformed?: unknown;
}

/** True iff this single row carries an unresolved malformed משולב value. */
export function isCombinedParticipationMalformed(
  item: CombinedParticipationMarker,
): boolean {
  return item.combinedParticipationMalformed === true;
}

/** The keys of every row with an unresolved malformed משולב value. */
export function malformedCombinedParticipationKeys(
  items: readonly CombinedParticipationMarker[],
): string[] {
  const keys: string[] = [];
  for (const item of items) {
    if (isCombinedParticipationMalformed(item) && typeof item.key === "string") {
      keys.push(item.key);
    }
  }
  return keys;
}

/** True iff ANY row still has an unresolved malformed משולב value. */
export function hasUnresolvedMalformedCombinedParticipation(
  items: readonly CombinedParticipationMarker[],
): boolean {
  return items.some(isCombinedParticipationMalformed);
}
