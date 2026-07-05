import type { AttendanceDayCell, AttendanceTrackingRow } from "@/lib/actions/attendance";

// Pure helper kept out of lib/actions/attendance.ts because a "use server"
// module may only export async functions - this derives a compact per-cell
// shape for a future week-view pivot grid from an already-fetched row.
export function toAttendanceDayCell(row: AttendanceTrackingRow): AttendanceDayCell {
  return {
    dateKey: row.dateKey,
    status: row.attendance?.status ?? null,
    hasWarnings: row.warnings.length > 0,
  };
}
