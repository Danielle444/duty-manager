// Subtle background tint per group, purely visual - helps distinguish which
// group a schedule/lesson activity belongs to at a glance in the timetable
// (student/instructor/admin views). Separate from lib/duty-colors.ts, which
// colors duty *types* for the admin duty-assignment grid/Excel export - this
// is a fixed 3-way mapping for schedule group membership, used only for
// plain CSS class rendering (no Excel/hex-color needs here).
export function getScheduleGroupColorClass(groupName: string | null): string {
  if (groupName === "א") return "bg-sky-50";
  if (groupName === "ב") return "bg-violet-50";
  return "bg-emerald-50"; // null / empty / "שתי הקבוצות"
}
