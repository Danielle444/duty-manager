"use client";

import { useMemo, type ReactNode } from "react";
import { buildTimeGridLayout } from "@/lib/schedule-timegrid";
import type { GroupableScheduleItem } from "@/lib/schedule-grouping";

// Layout-only: renders a day's schedule items as a real timetable - fixed
// time-slot rows and group א / group ב columns, with "שתי הקבוצות" items
// spanning both group columns. No CSS grid auto/minmax rows, no grid gap
// between rows or columns (adjacent cells are separated only by their own
// card borders plus a small inset padding on each card - never by moving
// the underlying time-proportional grid lines), and no floating/absolute
// positioning that could let one item cover another. Content is entirely up
// to the caller via renderCard, so each role (student/instructor/admin)
// keeps full control of title shortening, instructor-name visibility,
// "active now" styling, etc.
export function ScheduleTimeGrid<T extends GroupableScheduleItem>({
  items,
  renderCard,
  slotMinutes = 15,
}: {
  items: T[];
  renderCard: (item: T) => ReactNode;
  slotMinutes?: number;
}) {
  const { totalSlots, positions } = useMemo(
    () => buildTimeGridLayout(items, slotMinutes),
    [items, slotMinutes]
  );

  if (positions.length === 0) return null;

  return (
    <div
      // --slot-px sets the fixed per-slot height via a CSS custom property
      // instead of a hardcoded JS constant, so the browser (not JS/window
      // measurement) can pick a different value per breakpoint - larger on
      // mobile, where the narrow columns force more text-wrapping and short
      // activities need more room to stay readable; unchanged on desktop/
      // tablet (sm: and up), where the current approved layout stays as-is.
      // Still a single fixed value at any given width, so every proportional
      // guarantee (rowSpan math, no gap, exact duration ratios) holds at
      // both sizes independently - only the overall scale differs.
      className="grid [--slot-px:44px] sm:[--slot-px:32px]"
      style={{
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: `repeat(${totalSlots}, var(--slot-px))`,
      }}
    >
      {positions.map(({ items: cellItems, column, startSlotIndex, rowSpan }) => {
        const key = cellItems.map((i) => i.id).join("+");
        return (
          <div
            key={key}
            className="flex h-full flex-col overflow-hidden"
            style={{
              gridColumn: column === "a" ? 1 : column === "b" ? 2 : "1 / span 2",
              gridRow: `${startSlotIndex + 1} / span ${rowSpan}`,
            }}
          >
            {cellItems.map((item) => (
              // renderCard returns a plain block element with no height of
              // its own (sized to its text content), so left alone it would
              // under-fill this cell instead of visually spanning the full
              // scheduled duration. [&>*]:h-full forces that one returned
              // element to stretch to 100% of its slice of the cell, without
              // needing to change any role's own card renderer. The p-0.5
              // insets the card slightly within the wrapper's own box - the
              // wrapper's outer size (and thus the grid line positions) is
              // untouched, so this only adds visual breathing room between
              // adjacent cards, never a real time gap.
              <div
                key={item.id}
                className="min-h-0 flex-1 overflow-hidden p-0.5 [&>*]:h-full"
              >
                {renderCard(item)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
