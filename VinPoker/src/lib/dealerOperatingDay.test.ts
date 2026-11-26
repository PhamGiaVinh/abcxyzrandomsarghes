import { describe, expect, it } from "vitest";
import type { DealerAttendance } from "@/hooks/useDealerSwing";
import { matchesDealerOperatingDay } from "./dealerOperatingDay";

const now = Date.parse("2026-11-23T04:41:00+07:00");
const daytime = {
  club_id: "center-point", start_time: "14:12:00", end_time: "22:12:00", closed_at: null, archived_at: null,
};
const attendance: DealerAttendance = {
  id: "attendance", dealer_id: "dealer", shift_date: "2026-11-22", status: "checked_in",
  check_in_time: "2026-11-22T19:21:00+07:00", check_out_time: null,
  overtime_minutes: 0, current_state: "available", worked_minutes_since_last_break: 0,
  priority_break_flag: false, last_released_at: null,
  dealers: { full_name: "TEST dealer", tier: "B", club_id: "center-point", status: "active" },
  dealer_shifts: daytime,
};

describe("dealer roster operating day", () => {
  it("excludes a prior-day daytime shift even when its attendance still says available", () => {
    expect(matchesDealerOperatingDay(attendance, now)).toBe(false);
  });

  it("keeps an overnight shift eligible until the exact local end boundary", () => {
    const overnight = { ...attendance, dealer_shifts: { ...daytime, start_time: "22:00:00", end_time: "06:00:00" } };
    expect(matchesDealerOperatingDay(overnight, now)).toBe(true);
    expect(matchesDealerOperatingDay(overnight, Date.parse("2026-11-23T06:00:00+07:00"))).toBe(false);
  });

  it("uses the current operating date and refuses ambiguous or unverifiable attendance", () => {
    const current = { ...attendance, shift_date: "2026-11-23", check_in_time: "2026-11-23T02:00:00+07:00" };
    expect(matchesDealerOperatingDay(current, now)).toBe(true);
    expect(matchesDealerOperatingDay({ ...current, duplicate_active_attendance: true }, now)).toBe(false);
    expect(matchesDealerOperatingDay({ ...current, dealer_shifts: null }, now)).toBe(false);
    expect(matchesDealerOperatingDay({ ...current, dealer_shifts: { ...daytime, club_id: "other" } }, now)).toBe(false);
  });
});
