import type { DealerAttendance } from "@/hooks/useDealerSwing";

const clubClock = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// Mirrors the operating-date fence in dealer_pool_attendance_matches_v1.
// Break, fatigue and reservations are checked separately by the assignment server.
export function matchesDealerOperatingDay(attendance: DealerAttendance, nowMs: number): boolean {
  const shift = attendance.dealer_shifts;
  const checkIn = attendance.check_in_time ? Date.parse(attendance.check_in_time) : NaN;
  if (!shift || shift.club_id !== attendance.dealers?.club_id
    || shift.closed_at !== null || shift.archived_at !== null
    || attendance.dealers?.status !== "active"
    || attendance.status !== "checked_in" || attendance.duplicate_active_attendance
    || attendance.check_out_time || !Number.isFinite(nowMs) || !Number.isFinite(checkIn) || checkIn > nowMs) {
    return false;
  }

  const [today, time] = clubClock.format(nowMs).split(" ");
  const start = shift.start_time.slice(0, 8);
  const end = shift.end_time.slice(0, 8);
  const overnight = end <= start && time < end;
  const operatingDay = overnight
    ? new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10)
    : today;
  return attendance.shift_date === operatingDay;
}
