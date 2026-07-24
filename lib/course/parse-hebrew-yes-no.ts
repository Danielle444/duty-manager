/**
 * Combined Participation Slice 1 - PURE parser for the Excel "משולב" cell.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * next/*, no React. It maps ONE raw cell value to a tri-state boolean plus a
 * "malformed" marker, so both the server writers and the preview clients can
 * agree on exactly what "כן" / "לא" / blank / garbage mean.
 *
 * Rules (exact, no prefixes, no fuzzy matching):
 *   - null / undefined / non-string / empty / whitespace-only -> value null,
 *     malformed false (a blank cell is a legitimate "no restriction");
 *   - trimmed value exactly "כן"                               -> value true;
 *   - trimmed value exactly "לא"                               -> value false;
 *   - any OTHER non-empty trimmed value ("כן משהו", "לא אולי",
 *     "x", "yes", ...)                                          -> value null,
 *     malformed TRUE (the caller must block it, never silently coerce).
 *
 * Only surrounding whitespace is trimmed; the interior is never normalized, so
 * "כן משהו" is a malformed value, never a lenient "כן".
 */
export interface HebrewYesNoResult {
  /** true = כן, false = לא, null = blank OR unparseable (see `malformed`). */
  readonly value: boolean | null;
  /** true only when the cell had a non-empty value that was neither כן nor לא. */
  readonly malformed: boolean;
}

export function parseHebrewYesNo(cell: unknown): HebrewYesNoResult {
  if (typeof cell !== "string") {
    return { value: null, malformed: false };
  }
  const trimmed = cell.trim();
  if (trimmed === "") {
    return { value: null, malformed: false };
  }
  if (trimmed === "כן") {
    return { value: true, malformed: false };
  }
  if (trimmed === "לא") {
    return { value: false, malformed: false };
  }
  return { value: null, malformed: true };
}
