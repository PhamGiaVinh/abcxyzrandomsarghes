import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseSeriesClubLivePulseV1,
  SERIES_CLUB_PULSE_METRIC_DEFINITIONS,
  type SeriesClubPulseMetricKey,
} from "@/lib/series-intelligence/seriesClubLivePulseV1";
import { SERIES_CLUB_PULSE_DEMO_CLUB_ID } from "@/lib/series-intelligence/seriesClubPulseDemoV1";
import { ClubPulsePanel } from "./ClubPulsePanel";

vi.mock("@/lib/series-intelligence/seriesClubLivePulseRpc", () => ({ getSeriesClubLivePulseV1: vi.fn() }));

vi.mock("@/hooks/useOperatorClubs", () => ({
  useOperatorClubs: () => ({
    loading: false,
    clubs: [{ id: "11111111-1111-4111-8111-111111111111", name: "VinPoker Test" }],
    scope: [{ club_id: "11111111-1111-4111-8111-111111111111", can_owner: true, can_cashier: false, can_floor: false }],
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const AS_OF = "2026-08-09T12:34:56.789Z";
const CLUB_ID = "11111111-1111-4111-8111-111111111111";

function metric(key: SeriesClubPulseMetricKey, value: number, availability: "exact" | "partial" = "exact") {
  return {
    ...SERIES_CLUB_PULSE_METRIC_DEFINITIONS[key],
    value,
    unit: "count",
    availability,
    privacyState: value > 0 && value < 5 ? "small_cohort_suppressed" : "safe",
    asOf: AS_OF,
  };
}

function pulse({ timezoneUnavailable = false } = {}) {
  const unavailable = (key: "uniquePlayersToday" | "entriesToday") => ({
    ...SERIES_CLUB_PULSE_METRIC_DEFINITIONS[key],
    value: null,
    unit: "count",
    availability: "unavailable",
    privacyState: "not_exportable",
    asOf: AS_OF,
    unavailableReason: "CLUB_TIMEZONE_UNAVAILABLE",
  });
  return parseSeriesClubLivePulseV1({
    version: "series-club-live-pulse-v1",
    clubId: CLUB_ID,
    asOf: AS_OF,
    clubLocalDate: timezoneUnavailable ? null : "2026-08-09",
    timezone: timezoneUnavailable ? null : "Asia/Ho_Chi_Minh",
    clubMemberProfiles: metric("clubMemberProfiles", 12),
    uniquePlayersToday: timezoneUnavailable ? unavailable("uniquePlayersToday") : metric("uniquePlayersToday", 3, "partial"),
    entriesToday: timezoneUnavailable ? unavailable("entriesToday") : metric("entriesToday", 7),
    playersPlayingNow: metric("playersPlayingNow", 2, "partial"),
    runningEvents: metric("runningEvents", 0),
    openTables: metric("openTables", 4),
    dealersOnDuty: metric("dealersOnDuty", 5),
    dataQuality: {
      unavailableMetricIds: timezoneUnavailable ? ["entries_today", "unique_players_today"] : [],
      partialMetricIds: timezoneUnavailable ? ["players_playing_now"] : ["players_playing_now", "unique_players_today"],
      staleMetricIds: [],
    },
  });
}

describe("ClubPulsePanel", () => {
  it("renders seven owner metrics, partial state, and genuine zero distinctly", async () => {
    const load = vi.fn().mockResolvedValue({ ok: true, value: pulse() });
    render(<ClubPulsePanel enabled load={load} />);

    expect(await screen.findByText("Tình hình CLB hôm nay")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^club-pulse-(?!panel$)/)).toHaveLength(7);
    expect(within(screen.getByTestId("club-pulse-running_events")).getByText("0")).toBeInTheDocument();
    expect(within(screen.getByTestId("club-pulse-unique_players_today")).getByText("Dữ liệu một phần")).toBeInTheDocument();
    expect(screen.getByText("Entry hôm nay")).toBeInTheDocument();
    expect(screen.getByText("Player unique hôm nay")).toBeInTheDocument();
  });

  it("shows timezone-unavailable values as dashes rather than fabricated zero", async () => {
    const load = vi.fn().mockResolvedValue({ ok: true, value: pulse({ timezoneUnavailable: true }) });
    render(<ClubPulsePanel enabled load={load} />);

    const unique = await screen.findByTestId("club-pulse-unique_players_today");
    expect(within(unique).getByText("—")).toBeInTheDocument();
    expect(within(unique).getByText("Chưa có dữ liệu")).toBeInTheDocument();
    expect(within(screen.getByTestId("club-pulse-running_events")).getByText("0")).toBeInTheDocument();
  });

  it("supports manual refresh without polling", async () => {
    const load = vi.fn().mockResolvedValue({ ok: true, value: pulse() });
    render(<ClubPulsePanel enabled load={load} />);
    await screen.findByTestId("club-pulse-entries_today");
    expect(load).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Làm mới" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("keeps RPC and cross-club failures unavailable", async () => {
    const load = vi.fn().mockResolvedValue({ ok: false, error: "forbidden", retryable: false });
    render(<ClubPulsePanel enabled load={load} />);
    expect(await screen.findByText("Chưa đọc được tình hình CLB")).toBeInTheDocument();
    expect(screen.queryByTestId(/^club-pulse-(?!panel$)/)).toBeNull();
  });

  it("shows a clearly labelled seven-metric demo pulse and returns to live data", async () => {
    const load = vi.fn().mockResolvedValue({ ok: true, value: pulse() });
    const onPulseChange = vi.fn();
    function Harness() {
      const [demoMode, setDemoMode] = useState(false);
      return <ClubPulsePanel enabled load={load} demoMode={demoMode} onDemoModeChange={setDemoMode} onPulseChange={onPulseChange} />;
    }
    render(<Harness />);
    await screen.findByTestId("club-pulse-entries_today");

    fireEvent.click(screen.getByRole("button", { name: "Dùng dữ liệu mẫu" }));

    expect(await screen.findByText("Đang trình diễn dữ liệu mẫu.")).toBeInTheDocument();
    expect(screen.getByText(/VinPoker Test · Dữ liệu mẫu · Cập nhật/)).toBeInTheDocument();
    expect(screen.getAllByTestId(/^club-pulse-(?!panel$)/)).toHaveLength(7);
    expect(within(screen.getByTestId("club-pulse-club_member_profiles")).getByText("1.248")).toBeInTheDocument();
    expect(within(screen.getByTestId("club-pulse-players_playing_now")).getByText("52")).toBeInTheDocument();
    expect(onPulseChange).toHaveBeenLastCalledWith(expect.objectContaining({
      clubId: SERIES_CLUB_PULSE_DEMO_CLUB_ID,
      entriesToday: expect.objectContaining({ value: 143 }),
    }));

    fireEvent.click(screen.getByRole("button", { name: "Về dữ liệu thật" }));
    await waitFor(() => expect(screen.queryByText("Đang trình diễn dữ liệu mẫu.")).toBeNull());
    await waitFor(() => expect(onPulseChange).toHaveBeenLastCalledWith(expect.objectContaining({
      entriesToday: expect.objectContaining({ value: 7 }),
    })));
  });
});
