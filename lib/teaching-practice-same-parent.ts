// Pure, DB-free, JSX-free helpers for detecting when two different
// Teaching Practice children ("ילדים") share the same parent/contact -
// normalizes parentName/parentPhone the same way everywhere so the admin/
// instructor surface and the trainee-facing surface never disagree about
// what counts as "same parent." This is only ever a "same parent/contact"
// signal, never a confirmed sibling relationship - callers must phrase any
// UI text accordingly (e.g. "אותו הורה", never "אחים").

// trim + collapse duplicate whitespace, so trivially-different spacing in
// the same name still matches.
export function normalizeParentName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

// Strip spaces/dashes/parens/dots, so "050-1234567" and "(050) 1234567" and
// "0501234567" all still match.
export function normalizeParentPhone(phone: string): string {
  return phone.replace(/[\s\-().]/g, "");
}

// Returns null unless BOTH fields are present and non-blank after
// normalization - a child missing either field never gets grouped with
// anyone, rather than guessing a match from a single field (name alone or
// phone alone is deliberately never enough).
export function buildParentKey(
  parentName: string | null | undefined,
  parentPhone: string | null | undefined
): string | null {
  if (!parentName || !parentPhone) return null;
  const normName = normalizeParentName(parentName);
  const normPhone = normalizeParentPhone(parentPhone);
  if (!normName || !normPhone) return null;
  return `${normName}|${normPhone}`;
}

export interface SameParentChildInput {
  id: string;
  displayName: string;
  parentName: string | null | undefined;
  parentPhone: string | null | undefined;
}

// One entry per distinct parent key, listing every child (from the given
// input list) sharing it. Callers decide the input list's scope (e.g. the
// full active child registry for admin/instructor, or only the children
// currently visible in a trainee's own loaded lessons) and whether to
// pre-filter by isActive - this function only groups whatever it's given,
// and expects the list to already be deduplicated by id (a child appearing
// twice in the input would otherwise appear twice in its own group).
export function buildSameParentGroups(children: SameParentChildInput[]): Map<string, SameParentChildInput[]> {
  const groups = new Map<string, SameParentChildInput[]>();
  for (const child of children) {
    const key = buildParentKey(child.parentName, child.parentPhone);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(child);
    else groups.set(key, [child]);
  }
  return groups;
}

// childId -> that child's own parent key (undefined if it has none) - for
// callers that need to check "does this child's parent key match that other
// one" (e.g. a click-to-highlight feature), as opposed to needing the full
// list of other children's names.
export function buildParentKeyByChildId(children: SameParentChildInput[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const child of children) {
    const key = buildParentKey(child.parentName, child.parentPhone);
    if (key) map.set(child.id, key);
  }
  return map;
}

// childId -> display names of every OTHER child (from the given input
// list) sharing its parent key. A child with no match at all is simply
// absent from the map (never an empty-array entry) - this is exactly what
// should drive an always-visible "same parent" badge: only show it when
// this map actually has a non-empty entry for that child.
export function buildSameParentOtherNamesByChildId(children: SameParentChildInput[]): Map<string, string[]> {
  const groups = buildSameParentGroups(children);
  const result = new Map<string, string[]>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const child of group) {
      const otherNames = group.filter((other) => other.id !== child.id).map((other) => other.displayName);
      if (otherNames.length > 0) result.set(child.id, otherNames);
    }
  }
  return result;
}
