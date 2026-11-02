import { parseSeriesClubLivePulseV1, SERIES_CLUB_PULSE_METRIC_DEFINITIONS, SERIES_CLUB_PULSE_METRIC_KEYS } from "@/lib/series-intelligence/seriesClubLivePulseV1";
import { describe, expect, it } from "vitest";
import { buildOpsIntelligenceOverviewV1, sourceTarget, type OverviewInputV1 } from "./opsIntelligenceOverviewV1";
import type { TournamentContextV1 } from "./opsIntelligenceContextV1";

const child = (tournamentId: string): TournamentContextV1 => ({ tournamentId, name: tournamentId, status: "scheduled", startTime: null, buyIn: null, gtd: 2_000_000_000, phase: "flight", flightLabel: null });
const input = (): OverviewInputV1 => ({
  clubId: "club", scope: { kind: "club" }, contextReason: null,
  context: { observedAt: "2026-09-10T00:00:01.000Z", value: { version: "ops-intelligence-context-v1", clubId: "club", asOf: "2026-09-10T00:00:00.000Z", dailyTournaments: [], festivals: [{ festivalId: "festival", name: "Festival", status: "scheduled", finalTournamentId: null, tournaments: [child("flight-a"), child("flight-b")] }] } },
  pulse: null, registration: { observedAt: "2026-09-10T00:00:01.000Z", value: { version: "ops-registration-observed-q0", clubId: "club", asOf: "2026-09-10T00:00:00.000Z", window: { from: "2026-09-09T00:00:00.000Z", to: "2026-09-11T00:00:00.000Z" }, events: [] } }, sepay: null,
  operations: { asOf: null, observedAt: "", availability: "unavailable", reasonCode: "READ_FAILED", rows: [], runningTournamentIds: [], openTableCount: null, configuredTableCount: null, operationalTableCount: null, dealersOnDutyCount: null, countComparisonEligible: false },
});
describe("Wave 2 overview truth", () => {
  it.each([
    ["registration", "health", "Mở Data Health"],
    ["sepay", "health", "Mở Data Health"],
    ["operations", "live", "Mở Live Ops"],
    ["context", "overview", "Đọc lại phạm vi"],
  ])("routes unavailable %s to its actual owner", (source, tab, label) => {
    const value = { ...input(), context: null, registration: null };
    expect(sourceTarget(source)).toMatchObject({ tab, label });
    const action = buildOpsIntelligenceOverviewV1(value).actions.find((row) => row.id === source);
    expect(action).toMatchObject({ tab, scope: value.scope });
    expect(action?.retryContext === true).toBe(source === "context");
  });
  it("does not offer history or unknown sources false remediation", () => {
    expect(sourceTarget("history")).toBeNull();
    expect(sourceTarget("unknown")).toBeNull();
    expect(buildOpsIntelligenceOverviewV1(input()).actions.some((row) => row.source === "history")).toBe(false);
  });
  it("keeps structural context gaps at their exact scope without a retry action", () => {
    const actions = buildOpsIntelligenceOverviewV1(input()).actions;
    expect(actions.find((row) => row.reason === "FINAL_TOURNAMENT_MISSING")).toMatchObject({ tab: "overview", scope: { kind: "festival", festivalId: "festival" } });
    expect(actions.find((row) => row.reason === "FINAL_TOURNAMENT_MISSING")?.retryContext).toBeUndefined();
  });
  it("remains useful without Q0-window events without fabricating zero observations", () => {
    const model = buildOpsIntelligenceOverviewV1(input());
    expect(model.noWindowEvents).toBe(true);
    expect(model.metrics.every((row) => row.value === null)).toBe(true);
    expect(model.festivals).toHaveLength(1);
    expect(model.sources.find((row) => row.id === "registration")?.availability).toBe("exact");
    expect(model.sources.find((row) => row.id === "history")?.reason).toBe("HISTORY_NOT_MOUNTED");
    expect(model.actions.some((row) => row.reason === "FINAL_TOURNAMENT_MISSING")).toBe(true);
    expect(model.actions.some((row) => row.reason === "PHASE_UNSPECIFIED")).toBe(false);
  });
  it("does not turn unavailable Operations into zero allocated tables", () => {
    const value = input();
    value.scope = { kind: "flight", festivalId: "festival", tournamentId: "flight-a" };
    expect(buildOpsIntelligenceOverviewV1(value).metrics.find((row) => row.id === "selected-tables")?.value).toBeNull();
    value.operations = { ...value.operations, availability: "exact", observedAt: "2026-09-10T00:00:01.000Z" };
    const exact = buildOpsIntelligenceOverviewV1(value);
    expect(exact.metrics.find((row) => row.id === "selected-tables")?.value).toBe(0);
    expect(exact.metrics.find((row) => row.id === "selected-dealers")?.value).toBe(0);
  });
  it("never aggregates flight entries, unique players, shared GTD or final counts as festival truth", () => {
    const value = input();
    value.scope = { kind: "festival", festivalId: "festival" };
    value.operations = { ...value.operations, availability: "exact" };
    const model = buildOpsIntelligenceOverviewV1(value);
    expect(model.metrics.filter((row) => row.id.startsWith("selected-")).every((row) => row.value === null && row.availability === "unavailable")).toBe(true);
    expect(model.resolved.tournamentId).toBeNull();
    expect(model).not.toHaveProperty("gtd");
    expect(model.festivals[0].tournaments.map((row) => row.gtd)).toEqual([2_000_000_000, 2_000_000_000]);
  });
  it("does not change missing requested identities and keeps last-read semantics source-owned", () => {
    const value = input();
    value.scope = { kind: "daily", tournamentId: "removed" };
    const first = buildOpsIntelligenceOverviewV1(value);
    const second = buildOpsIntelligenceOverviewV1(value);
    expect(first).toEqual(second);
    expect(first.resolved.valid).toBe(false);
    expect(first.actions.find((row) => row.id === "scope")?.scope).toEqual(value.scope);
    expect(first.sources.find((row) => row.id === "operations")?.observedAt).toBeNull();
  });
});

// The server already deduplicates members/players across flights. Keep its
// observation separate from entry count, scoped entries and SePay actions.
describe("Overview unique-player source linkage", () => {
  function value(availability: "exact" | "partial" | "stale" | "unavailable" = "exact", count: number | null = 8) {
    const result = input();
    result.clubId = "10000000-0000-4000-8000-000000000001";
    result.context = { ...result.context!, value: { ...result.context!.value, clubId: result.clubId } };
    result.pulse = { observedAt: "2026-09-10T00:00:01.000Z", value: parseSeriesClubLivePulseV1({
      version: "series-club-live-pulse-v1", clubId: result.clubId, asOf: "2026-09-10T00:00:00.000Z", clubLocalDate: "2026-09-10", timezone: "Asia/Ho_Chi_Minh",
      ...Object.fromEntries(SERIES_CLUB_PULSE_METRIC_KEYS.map((key) => [key, { ...SERIES_CLUB_PULSE_METRIC_DEFINITIONS[key],
        unit: "count", value: key === "uniquePlayersToday" ? count : key === "entriesToday" ? 17 : 0,
        availability: key === "uniquePlayersToday" ? availability : "exact", privacyState: key === "uniquePlayersToday" && availability === "unavailable" ? "not_exportable" : "safe", asOf: "2026-09-10T00:00:00.000Z",
        ...(key === "uniquePlayersToday" && availability === "unavailable" ? { unavailableReason: "SOURCE_UNAVAILABLE" } : {}),
      }])), dataQuality: { unavailableMetricIds: availability === "unavailable" ? ["unique_players_today"] : [], partialMetricIds: availability === "partial" ? ["unique_players_today"] : [], staleMetricIds: availability === "stale" ? ["unique_players_today"] : [] },
    }) };
    return result;
  }
  it("shows 8 canonical unique players beside 17 entries without manufacturing a SePay alert", () => {
    const model = buildOpsIntelligenceOverviewV1(value());
    expect(model.metrics.find((m) => m.id === "unique_players_today")).toMatchObject({ value: 8, grain: "TOÀN CLB", availability: "exact", asOf: "2026-09-10T00:00:00.000Z", observedAt: "2026-09-10T00:00:01.000Z" });
    expect(model.metrics.find((m) => m.id === "entries_today")?.value).toBe(17);
    expect(model.metrics).toHaveLength(6);
    expect(model.actions.some((a) => a.id === "sepay-actionable")).toBe(false);
  });
  it.each(["partial", "stale", "unavailable"] as const)("does not display %s unique observation as exact or fabricate zero", (availability) => {
    const model = buildOpsIntelligenceOverviewV1(value(availability, availability === "unavailable" ? null : 8));
    expect(model.metrics.find((m) => m.id === "unique_players_today")).toMatchObject({ value: null, availability });
  });
  it("keeps exact zero distinct from a missing pulse", () => {
    expect(buildOpsIntelligenceOverviewV1(value("exact", 0)).metrics.find((m) => m.id === "unique_players_today")?.value).toBe(0);
    expect(buildOpsIntelligenceOverviewV1(input()).metrics.find((m) => m.id === "unique_players_today")?.value).toBeNull();
  });
  it("keeps club unique players at club grain when a festival has no deduplicated scope aggregate", () => {
    const v = value(); v.scope = { kind: "festival", festivalId: "festival" };
    const m = buildOpsIntelligenceOverviewV1(v);
    expect(m.metrics.find((row) => row.id === "unique_players_today")).toMatchObject({ value: 8, grain: "TOÀN CLB" });
    expect(m.metrics.find((row) => row.id === "selected-entries")?.value).toBeNull();
  });
});
