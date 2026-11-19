import { describe, expect, it } from "vitest";
import { parseDecisionEventStateResponse } from "./decisionPacketRuntimeTypes";

const revision = {
  revisionId: "50000000-0000-4000-8000-000000000001", scope: "event_total", finality: "final", sourceKind: "native_tournament_system", sourceTimestampState: "exact", sourceTimestamp: "2026-08-09T00:00:00.000Z", capturedAt: "2026-08-09T00:01:00.000Z", reconciliationStatus: "auto_only", supersedesRevisionId: null, reconcilesAutoRevisionId: null, reconcilesManualRevisionId: null, contentHash: "a".repeat(64), correctionReason: null,
  metrics: {
    entries: { availability: "present", value: 100 }, uniquePlayers: { availability: "present", value: 70 }, totalBullets: { availability: "present", value: 100 }, reentries: { availability: "present", value: 30 }, registrationRecords: { availability: "present", value: 100 }, paidPlaces: { availability: "missing", value: null }, prizePool: { availability: "present", amountMinor: "600000000", currency: "VND", scale: 0 }, overlay: { availability: "explicit_zero", amountMinor: "0", currency: "VND", scale: 0 },
  },
};

const response = () => ({
  version: "series-decision-event-state-v1", event: { eventId: "22222222-2222-4222-8222-222222222222", clubId: "11111111-1111-4111-8111-111111111111", status: "completed", targetEventTs: "2026-08-08T03:00:00.000Z" },
  decisionPackets: [{ packetId: "44444444-4444-4444-8444-444444444444", horizon: "T-7", targetMetric: "entries", packetState: "frozen", asOfTs: "2026-08-01T03:00:00.000Z", sourceCutoff: "2026-08-01T02:00:00.000Z", forecastSnapshotId: "33333333-3333-4333-8333-333333333333", forecastState: "forecast_identity_eligible", contentHash: "b".repeat(64), frozenAt: "2026-08-01T03:01:00.000Z", supersedesPacketId: null }],
  actualTruth: { state: "current", sourceState: "auto_only", chosenRevision: structuredClone(revision) },
  scoring: { candidatePacketId: "44444444-4444-4444-8444-444444444444", candidateActualRevisionId: revision.revisionId, targetMetric: "entries", eligibility: "eligible", blockReasons: [] },
  dataQuality: { legacyActualCacheAvailable: false, d2aRevisionAvailable: true, unresolvedMismatch: false, missingFields: ["paidPlaces"], unsupportedDerivationWarnings: ["legacy_cache_not_promoted"] },
});

describe("D2B runtime response parser", () => {
  it("accepts the exact versioned safe event-state response", () => {
    expect(parseDecisionEventStateResponse(response())).toMatchObject({ ok: true, value: { version: "series-decision-event-state-v1", actualTruth: { state: "current" } } });
  });
  it("fails closed for unknown fields, invalid money and malformed timestamps", () => {
    expect(parseDecisionEventStateResponse({ ...response(), leaked: "private" })).toEqual({ ok: false, error: "malformed_response" });
    const badMoney = response(); badMoney.actualTruth.chosenRevision.metrics.prizePool.amountMinor = "1.5";
    expect(parseDecisionEventStateResponse(badMoney)).toEqual({ ok: false, error: "malformed_response" });
    const badTime = response(); badTime.event.targetEventTs = "2026-08-08";
    expect(parseDecisionEventStateResponse(badTime)).toEqual({ ok: false, error: "malformed_response" });
  });
  it("keeps missing distinct from zero", () => {
    const missing = response(); missing.actualTruth.chosenRevision.metrics.entries = { availability: "missing", value: null };
    const zero = response(); zero.actualTruth.chosenRevision.metrics.entries = { availability: "explicit_zero", value: 0 };
    expect(parseDecisionEventStateResponse(missing)).toMatchObject({ ok: true });
    expect(parseDecisionEventStateResponse(zero)).toMatchObject({ ok: true });
  });
  it("rejects eligibility attached to a different decision or actual revision", () => {
    const valid = response();
    for (const scoring of [
      { ...valid.scoring, candidatePacketId: "another-packet" },
      { ...valid.scoring, candidateActualRevisionId: "another-revision" },
      { ...valid.scoring, targetMetric: "unique_players" },
    ]) {
      expect(parseDecisionEventStateResponse({ ...valid, scoring })).toEqual({ ok: false, error: "malformed_response" });
    }
  });
});
