// Pure, DB-free, JSX-free time-block coloring helper for Teaching Practice
// tables - shared by the admin/instructor screen
// (lib/components/TeachingPracticeManager.tsx) and the trainee-facing
// screen (app/student/StudentTeachingPracticeSection.tsx) so both surfaces
// color the same actual time the same way, with one palette to maintain
// instead of two that could silently drift apart.
//
// Soft, mutually-distinguishable row backgrounds (visual scan aid only) -
// mirrors the rotating-pastel-per-block convention the Excel export already
// uses (BLOCK_FILL_COLORS in
// lib/exports/build-teaching-practice-fixed-structure-workbook.ts), just
// with real Tailwind classes instead of ARGB fills, so the on-screen tables
// and the exported sheet group time blocks the same visual way without
// sharing any code (the export intentionally keeps its own palette - see
// that file's header). Static literal class names only (no template-
// string/computed class name) so Tailwind's build-time scanner always picks
// them up. Every entry is a light *-100 shade - readable dark text over all
// of them, and adjacent hues (amber/sky/emerald/rose/violet/cyan/orange/
// teal) are deliberately spread around the color wheel rather than
// clustered, so two neighboring blocks are never a close hue.
export const TRACK_TIME_BLOCK_PALETTE = [
  "bg-amber-100",
  "bg-sky-100",
  "bg-emerald-100",
  "bg-rose-100",
  "bg-violet-100",
  "bg-cyan-100",
  "bg-orange-100",
  "bg-teal-100",
] as const;

// Assigns one palette class per input key, in order - a "block" is a run of
// consecutive equal keys (matching how these tables are already sorted by
// time), and the palette rotates by one entry every time the key changes,
// so two adjacent blocks are guaranteed never to share a color (wrapping
// back to the start of the palette only after 8 blocks in a row). A null/
// empty key (e.g. a track with no time set) still gets a color like any
// other distinct key - this is a display-only aid, never a data check.
export function timeBlockColorClasses(keys: (string | null | undefined)[]): string[] {
  const classes: string[] = [];
  let blockIndex = -1;
  let previousKey: string | null | undefined;
  let hasPrevious = false;
  for (const key of keys) {
    if (!hasPrevious || key !== previousKey) {
      blockIndex += 1;
      previousKey = key;
      hasPrevious = true;
    }
    classes.push(TRACK_TIME_BLOCK_PALETTE[blockIndex % TRACK_TIME_BLOCK_PALETTE.length]);
  }
  return classes;
}
