import { cleanScheduleTitle } from "@/lib/schedule-title";

// Shared by the instructor and student schedule views: any schedule item
// with at least these fields can be grouped by same-time-slot group pairs.
export interface GroupableScheduleItem {
  id: string;
  startTime: string;
  endTime: string;
  title: string;
  groupName: string | null;
  instructorName: string | null;
  location: string | null;
  description: string | null;
}

export type ScheduleSlot<T extends GroupableScheduleItem> =
  | { kind: "single"; item: T }
  | { kind: "merged"; item: T }
  | { kind: "pair"; items: [T, T] };

function mergeUnique(a: string | null, b: string | null): string | null {
  const values = Array.from(
    new Set([a, b].filter((v): v is string => !!v && v.trim().length > 0))
  );
  return values.length > 0 ? values.join(" / ") : null;
}

// Combines two same-time, opposite-group items (א + ב) into one synthetic
// "שתי הקבוצות" item (groupName: null already renders that way) - display
// only, nothing is written back to the DB.
function mergeSameActivityItems<T extends GroupableScheduleItem>(a: T, b: T): T {
  return {
    ...a,
    id: `${a.id}+${b.id}`,
    groupName: null,
    instructorName: mergeUnique(a.instructorName, b.instructorName),
    location: mergeUnique(a.location, b.location),
    description: mergeUnique(a.description, b.description),
  };
}

// Groups same-time-slot, opposite-group (א/ב) items: identical activity ->
// one merged "שתי הקבוצות" card; different activity -> two cards meant to
// be shown side by side so it's clear at a glance the groups split for that
// slot. Everything else is returned as-is, one card per item.
export function buildScheduleSlots<T extends GroupableScheduleItem>(items: T[]): ScheduleSlot<T>[] {
  const slots: ScheduleSlot<T>[] = [];
  const consumed = new Set<string>();

  for (const item of items) {
    if (consumed.has(item.id)) continue;

    if (item.groupName === "א" || item.groupName === "ב") {
      const otherGroup = item.groupName === "א" ? "ב" : "א";
      const partner = items.find(
        (other) =>
          !consumed.has(other.id) &&
          other.id !== item.id &&
          other.startTime === item.startTime &&
          other.endTime === item.endTime &&
          other.groupName === otherGroup
      );
      if (partner) {
        consumed.add(item.id);
        consumed.add(partner.id);
        const sameActivity =
          cleanScheduleTitle(item.title) === cleanScheduleTitle(partner.title);
        if (sameActivity) {
          slots.push({ kind: "merged", item: mergeSameActivityItems(item, partner) });
        } else {
          const [groupA, groupB] = item.groupName === "א" ? [item, partner] : [partner, item];
          slots.push({ kind: "pair", items: [groupA, groupB] });
        }
        continue;
      }
    }

    consumed.add(item.id);
    slots.push({ kind: "single", item });
  }

  return slots;
}
