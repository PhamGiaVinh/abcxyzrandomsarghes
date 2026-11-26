import { describe, expect, it } from "vitest";
import { buildDecisionPacketContent, buildEventActualRevision, type EventActualRevisionInput } from "./decisionPacketV1";
import { evaluateForecastActualV1 } from "./forecastEvaluationV1";
import { aggregateForecastEvaluationsV1 } from "./forecastEvaluationAggregate";
import type { ForecastEvaluationForecastInput, ForecastEvaluationPacketInput, SeriesForecastEvaluationV1 } from "./forecastEvaluationTypes";

const CLUB = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT = "33333333-3333-4333-8333-333333333333";
const PACKET = "44444444-4444-4444-8444-444444444444";

const count = (value: number) => ({ availability: value === 0 ? "explicit_zero" as const : "present" as const, value });
const money = (amountMinor: string) => ({ availability: amountMinor === "0" ? "explicit_zero" as const : "present" as const, amountMinor, currency: "VND", scale: 0 });

async function makeEvaluation(index: number, pointEstimate: number, options: { horizon?: "T-21" | "T-7" | "T-1" | "T-0"; engineVersion?: string; bandSemantics?: "descriptive_range" | "scenario_band" | "probabilistic_quantiles" | "unknown"; stale?: boolean } = {}): Promise<Omit<SeriesForecastEvaluationV1, "lifecycle"> & { readonly lifecycle: "current" | "stale" }> {
  const revisionId = `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const content = await buildDecisionPacketContent({
    clubId: CLUB, eventId: EVENT, horizon: options.horizon ?? "T-7", targetMetric: "entries", asOfTs: "2026-08-01T03:00:00Z", sourceCutoff: "2026-08-01T02:00:00Z", targetEventTs: "2026-08-08T03:00:00Z", forecastSnapshotId: SNAPSHOT, forecastState: "forecast_identity_eligible", manualExpectation: null, publicEvidence: [], registrationSlice: null, campaignSlice: null, knownInformation: { registrationsObserved: index }, recommendedAction: null, ownerDecision: null, publicAction: null, decisionReason: null, alternatives: [], assumptions: [], uncertaintyNotes: null, supersedesPacketId: null, correctionReason: null,
  });
  const packet: ForecastEvaluationPacketInput = { packetId: `${PACKET.slice(0, -1)}${index}`, packet: content, packetState: "frozen", frozenAt: "2026-08-01T03:01:00Z" };
  const forecast: ForecastEvaluationForecastInput = { snapshotId: SNAPSHOT, clubId: CLUB, eventId: EVENT, targetMetric: "entries", forecastIssuedAt: "2026-08-01T02:30:00Z", asOfTs: "2026-08-01T03:00:00Z", provenanceCompleteness: "complete", forecastIdentityEligible: true, pointEstimate, low: 90, high: 110, engineId: "turnout-ridge", engineVersion: options.engineVersion ?? "v1", predictorId: "predictor-1", bandSemantics: options.bandSemantics ?? "descriptive_range" };
  const actual = await buildEventActualRevision({ revisionId, clubId: CLUB, eventId: EVENT, scope: "event_total", finality: "final", sourceKind: "native_tournament_system", sourceTimestampState: "exact", sourceTimestamp: "2026-08-09T00:00:00Z", capturedAt: "2026-08-09T00:01:00Z", reconciliationStatus: "auto_only", metrics: { entries: count(100), uniquePlayers: count(70), totalBullets: count(100), reentries: count(30), registrationRecords: count(100), paidPlaces: count(15), prizePool: money("600000000"), overlay: money("0") }, supersedesRevisionId: null, reconcilesAutoRevisionId: null, reconcilesManualRevisionId: null, idempotencyKey: `aggregate:${index}`, correctionReason: null });
  const result = await evaluateForecastActualV1({ packet, forecast, revisions: [actual] });
  if (result.kind !== "evaluation") throw new Error("fixture did not produce evaluation");
  if (options.stale) {
    return { ...result, lifecycle: "stale" };
  }
  return result;
}

describe("D2D-A aggregate forecast evaluation", () => {
  it("computes exact BigInt sums, rational mean/MAE and direction counts", async () => {
    const result = aggregateForecastEvaluationsV1([await makeEvaluation(1, 110), await makeEvaluation(2, 90), await makeEvaluation(3, 100)]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ n: 3, sumSignedError: "0", sumAbsoluteError: "20", meanSignedError: { numerator: "0", denominator: 3 }, mae: { numerator: "20", denominator: 3 }, exactCount: 1, overCount: 1, underCount: 1, bandEligibleN: 3, insideBandCount: 3, insideForecastBandRate: { numerator: "3", denominator: 3 }, sampleGate: "descriptive_only_small_sample" });
  });

  it("groups by horizon, engine version and band semantics", async () => {
    const result = aggregateForecastEvaluationsV1([
      await makeEvaluation(1, 100),
      await makeEvaluation(2, 100, { engineVersion: "v2" }),
      await makeEvaluation(3, 100, { horizon: "T-1" }),
      await makeEvaluation(4, 100, { bandSemantics: "scenario_band" }),
    ]);
    expect(result).toHaveLength(4);
  });

  it("keeps club metrics separate and leaves WAPE unavailable at zero actual entries", async () => {
    const first = await makeEvaluation(1, 110);
    const zero = { ...first, clubId: "other-club", actual: "0", absoluteError: "110" };
    const result = aggregateForecastEvaluationsV1([first, zero]);
    expect(result).toHaveLength(2);
    expect(result.find(row => row.clubId === CLUB)?.wape).toEqual({ numerator: "10", denominator: "100" });
    expect(result.find(row => row.clubId === "other-club")?.wape).toBeNull();
    expect(aggregateForecastEvaluationsV1([])).toEqual([]);
  });

  it("excludes stale evaluations and keeps no-money output", async () => {
    const result = aggregateForecastEvaluationsV1([await makeEvaluation(1, 100), await makeEvaluation(2, 105, { stale: true })]);
    expect(result[0].n).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/money|gtd|overlay|profit|recommendation/i);
  });

  it("uses descriptive sample gates at 1, 5 and 20 evaluations", async () => {
    expect(aggregateForecastEvaluationsV1([await makeEvaluation(1, 100)])[0].sampleGate).toBe("descriptive_only_small_sample");
    expect(aggregateForecastEvaluationsV1(await Promise.all(Array.from({ length: 5 }, (_, index) => makeEvaluation(index + 1, 100))))[0].sampleGate).toBe("descriptive_only");
    expect(aggregateForecastEvaluationsV1(await Promise.all(Array.from({ length: 20 }, (_, index) => makeEvaluation(index + 1, 100))))[0].sampleGate).toBe("evaluation_summary_available");
  });

  it("returns immutable and deterministic groups", async () => {
    const values = [await makeEvaluation(1, 110), await makeEvaluation(2, 90)];
    const first = aggregateForecastEvaluationsV1(values);
    const second = aggregateForecastEvaluationsV1([...values].reverse());
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
  });
});
