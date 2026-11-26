import { describe, expect, it } from "vitest";
import { buildDecisionPacketContent, buildEventActualRevision, type EventActualRevisionInput } from "./decisionPacketV1";
import { resolveForecastActualScoringPairV1, resolveSeriesEventActualTruthV1 } from "./decisionPacketReadModel";

const CLUB = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT = "33333333-3333-4333-8333-333333333333";
const REVISION = "50000000-0000-4000-8000-000000000001";

const count = (value: number) => ({ availability: value === 0 ? "explicit_zero" as const : "present" as const, value });
const money = (amountMinor: string) => ({ availability: amountMinor === "0" ? "explicit_zero" as const : "present" as const, amountMinor, currency: "VND", scale: 0 });

async function packet(state: "draft" | "frozen" = "frozen") {
  const content = await buildDecisionPacketContent({
    clubId: CLUB, eventId: EVENT, horizon: "T-7", targetMetric: "entries", asOfTs: "2026-08-01T03:00:00Z", sourceCutoff: "2026-08-01T02:00:00Z", targetEventTs: "2026-08-08T03:00:00Z",
    forecastSnapshotId: SNAPSHOT, forecastState: "forecast_identity_eligible", manualExpectation: null, publicEvidence: [], registrationSlice: null, campaignSlice: null, knownInformation: { registrationsObserved: 4 }, recommendedAction: null, ownerDecision: null, publicAction: null, decisionReason: null, alternatives: [], assumptions: [], uncertaintyNotes: null, supersedesPacketId: null, correctionReason: null,
  });
  return { packet: content, packetState: state, frozenAt: state === "frozen" ? "2026-08-01T03:01:00Z" : null } as const;
}

async function actual(overrides: Partial<EventActualRevisionInput> = {}) {
  return buildEventActualRevision({
    revisionId: REVISION, clubId: CLUB, eventId: EVENT, scope: "event_total", finality: "final", sourceKind: "native_tournament_system", sourceTimestampState: "exact", sourceTimestamp: "2026-08-09T00:00:00Z", capturedAt: "2026-08-09T00:01:00Z", reconciliationStatus: "auto_only",
    metrics: { entries: count(100), uniquePlayers: count(70), totalBullets: count(100), reentries: count(30), registrationRecords: count(100), paidPlaces: { availability: "missing", value: null }, prizePool: money("600000000"), overlay: money("0") }, supersedesRevisionId: null, reconcilesAutoRevisionId: null, reconcilesManualRevisionId: null, idempotencyKey: "actual:one", correctionReason: null,
    ...overrides,
  });
}

const forecast = () => ({ snapshotId: SNAPSHOT, clubId: CLUB, eventId: EVENT, targetMetric: "entries" as const, forecastIssuedAt: "2026-08-01T02:30:00Z", asOfTs: "2026-08-01T03:00:00Z", provenanceCompleteness: "complete" as const, forecastIdentityEligible: true });

describe("D2B scoring eligibility", () => {
  it("allows only a frozen identity-eligible entries packet with a final event-total actual after the cutoff", async () => {
    const result = await resolveForecastActualScoringPairV1({ packet: await packet(), forecast: forecast(), revisions: [await actual()] });
    expect(result).toMatchObject({ eligibility: "eligible", blockReasons: [] });
  });

  it("keeps draft, partial, scope, missing metric, timestamp and target failures distinct", async () => {
    const current = await actual();
    expect((await resolveForecastActualScoringPairV1({ packet: await packet("draft"), forecast: forecast(), revisions: [current] })).blockReasons).toContain("packet_not_frozen");
    expect((await resolveForecastActualScoringPairV1({ packet: await packet(), forecast: forecast(), revisions: [await actual({ finality: "provisional" })] })).blockReasons).toContain("actual_not_final");
    expect((await resolveForecastActualScoringPairV1({ packet: await packet(), forecast: forecast(), revisions: [await actual({ scope: "flight_only" })] })).blockReasons).toContain("actual_scope_mismatch");
    expect((await resolveForecastActualScoringPairV1({ packet: await packet(), forecast: forecast(), revisions: [await actual({ metrics: { ...current.metrics, entries: { availability: "missing", value: null } } })] })).blockReasons).toContain("actual_metric_missing");
    expect((await resolveForecastActualScoringPairV1({ packet: await packet(), forecast: forecast(), revisions: [await actual({ sourceTimestamp: "2026-08-01T02:59:59Z" })] })).blockReasons).toContain("outcome_precedes_forecast");
    expect((await resolveForecastActualScoringPairV1({ packet: await packet(), forecast: { ...forecast(), targetMetric: "unique_players" }, revisions: [current] })).blockReasons).toContain("target_metric_mismatch");
  });

  it("detects unreconciled auto/manual heads without choosing by timestamp", async () => {
    const auto = await actual();
    const manual = await actual({ revisionId: "50000000-0000-4000-8000-000000000002", sourceKind: "owner_manual", reconciliationStatus: "manual_only", idempotencyKey: "actual:two" });
    const truth = await resolveSeriesEventActualTruthV1([auto, manual]);
    expect(truth.resolution.state).toBe("needs_reconciliation");
    expect((await resolveForecastActualScoringPairV1({ packet: await packet(), forecast: forecast(), revisions: [auto, manual] })).blockReasons).toContain("reconciliation_required");
  });

  it.each(["forecastIssuedAt", "asOfTs"] as const)("blocks a malformed forecast %s", async (field) => {
    const result = await resolveForecastActualScoringPairV1({
      packet: await packet(), forecast: { ...forecast(), [field]: "invalid" }, revisions: [await actual()],
    });
    expect(result).toMatchObject({ eligibility: "blocked", blockReasons: ["outcome_precedes_forecast"] });
  });
});
