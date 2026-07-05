// Display-only formatting for DutyType.description - never mutates the
// stored string, never written back anywhere. Source descriptions sometimes
// pack multiple items onto one line separated by bullet characters (e.g.
// "•") with no real line break, which reads as one unreadable run-on line -
// this splits on those separators (and on any real newlines already
// present) purely for rendering, into an ordered list of trimmed,
// non-empty segments. Plain sentence punctuation (periods, commas, hyphens)
// is intentionally left alone so normal prose isn't chopped up.
const BULLET_SEPARATOR_REGEX = /[•●▪‣∙◦]|\r\n|\r|\n/g;

export function formatDutyDescriptionForDisplay(
  description: string | null | undefined
): string[] {
  if (!description) return [];
  return description
    .split(BULLET_SEPARATOR_REGEX)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
