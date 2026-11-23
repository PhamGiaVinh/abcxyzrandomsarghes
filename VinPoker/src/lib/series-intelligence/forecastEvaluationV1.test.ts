import { describe, expect, it } from "vitest";
import {
  buildDecisionPacketContent,
  buildEventActualRevision,
  type DecisionPacketContentInput,
  type EventActualMetricsInput,
  type EventActualRevision,
  type EventActualRevisionInput,
} from "./decisionPacketV1";
import {
  classifyForecastEvaluationLifecycleV1,
  evaluateDecisionEventStateV1,
  evaluateForecastActualV1,
} from "./forecastEvaluationV1";
import type {
  ForecastEvaluationForecastInput,
  ForecastEvaluationInput,
  ForecastEvaluationPacketInput,
  SeriesForecastEvaluationV1,
} from "./forecastEvaluationTypes";

const CLUB = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT = "33333333-3333-4333-8333-333333333333";
const PACKET = "44444444-4444-4444-8444-444444444444";
const REVISION = "50000000-0000-4000-8000-000000000001";

const count = (value: number) => ({
  availability: value === 0 ? "explicit_zero" as const : "present" as const,
  value,
});
const missingCount = () => ({ availability: "missing" as const, value: null });
const money = (amountMinor: string) => ({
  availability: amountMinor === "0" ? "explicit_zero" as const : "present" as const,
  amountMinor,
  currency: "VND",
  scale: 0,
});

function metrics(): EventActualMetricsInput {
  return {
    entries: count(100),
    uniquePlayers: count(70),
    totalBullets: count(100),
    reentries: count(30),
    registrationRecords: count(100),
    paidPlaces: count(15),
    prizePool: money("600000000"),
    overlay: money("0"),
  };
}

async function actual(
  revisionId = REVISION,
  overrides: Partial<EventActualRevisionInput> = {},
): Promise<EventActualRevision> {
  return buildEventActualRevision({
    revisionId,
    clubId: CLUB,
    eventId: EVENT,
    scope: "event_total",
    finality: "final",
    sourceKind: "native_tournament_system",
    sourceTimestampState: "exact",
    sourceTimestamp: "2026-08-09T00:00:00Z",
    capturedAt: "2026-08-09T00:01:00Z",
    reconciliationStatus: "auto_only",
    metrics: metrics(),
    supersedesRevisionId: null,
    reconcilesAutoRevisionId: null,
    reconcilesManualRevisionId: null,
    idempotencyKey: `actual:${revisionId}`,
    correctionReason: null,
    ...overrides,
  });
}

async function packet(
  overrides: Partial<DecisionPacketContentInput> = {},
  packetState: "draft" | "frozen" = "frozen",
): Promise<ForecastEvaluationPacketInput> {
  const content = await buildDecisionPacketContent({
    clubId: CLUB,
    eventId: EVENT,
    horizon: "T-7",
    targetMetric: "entries",
    asOfTs: "2026-08-01T03:00:00Z",
    sourceCutoff: "2026-08-01T02:00:00Z",
    targetEventTs: "2026-08-08T03:00:00Z",
    forecastSnapshotId: SNAPSHOT,
    forecastState: "forecast_identity_eligible",
    manualExpectation: null,
    publicEvidence: [],
    registrationSlice: null,
    campaignSlice: null,
    knownInformation: { registrationsObserved: 4 },
    recommendedAction: null,
    ownerDecision: null,
    publicAction: null,
    decisionReason: null,
    alternatives: [],
    assumptions: [],
    uncertaintyNotes: null,
    supersedesPacketId: null,
    correctionReason: null,
    ...overrides,
  });
  return {
    packetId: PACKET,
    packet: content,
    packetState,
    frozenAt: packetState === "frozen" ? "2026-08-01T03:01:00Z" : null,
  };
}

function forecast(
  overrides: Partial<ForecastEvaluationForecastInput> = {},
): ForecastEvaluationForecastInput {
  return {
    snapshotId: SNAPSHOT,
    clubId: CLUB,
    eventId: EVENT,
    targetMetric: "entries",
    forecastIssuedAt: "2026-08-01T02:30:00Z",
    asOfTs: "2026-08-01T03:00:00Z",
    provenanceCompleteness: "complete",
    forecastIdentityEligible: true,
    pointEstimate: 100,
    low: 90,
    high: 110,
    engineId: "turnout-ridge",
    engineVersion: "v1",
    predictorId: "predictor-1",
    bandSemantics: "descriptive_range",
    ...overrides,
  };
}

async function evaluation(
  forecastOverrides: Partial<ForecastEvaluationForecastInput> = {},
  actualOverrides: Partial<EventActualRevisionInput> = {},
  packetOverrides: Partial<DecisionPacketContentInput> = {},
): Promise<SeriesForecastEvaluationV1> {
  const result = await evaluateForecastActualV1({
    packet: await packet(packetOverrides),
    forecast: forecast(forecastOverrides),
    revisions: [await actual(REVISION, actualOverrides)],
  });
  expect(result.kind).toBe("evaluation");
  return result as SeriesForecastEvaluationV1;
}

describe("D2D-A forecast evaluation kernel", () => {
  it("computes exact signed, absolute, squared error and direction", async () => {
    const result = await evaluation({ pointEstimate: 110 });
    expect(result).toMatchObject({ signedError: "10", absoluteError: "10", squaredError: "100", direction: "over" });
  });

  it("computes under and exact directions", async () => {
    expect((await evaluation({ pointEstimate: 90 })).direction).toBe("under");
    expect((await evaluation({ pointEstimate: 100 })).direction).toBe("exact");
  });

  it("accepts canonical bigint-string estimates without number coercion", async () => {
    const result = await evaluation({ pointEstimate: "9007199254740993", low: null, high: null });
    expect(result.pointEstimate).toBe("9007199254740993");
    expect(result.squaredError).toBe("81129638414604898270336566437449");
  });

  it("keeps zero actuals and estimates distinct from missing values", async () => {
    const result = await evaluation({ pointEstimate: 0, low: 0, high: 0 }, { metrics: { ...metrics(), entries: count(0), uniquePlayers: count(0), totalBullets: count(0), reentries: count(0), registrationRecords: count(0), paidPlaces: count(0) } });
    expect(result.actual).toBe("0");
    expect(result.pointEstimate).toBe("0");
    expect(result.direction).toBe("exact");
  });

  it("computes an available descriptive band and containment", async () => {
    const inside = await evaluation({ pointEstimate: 100, low: 90, high: 110 });
    expect(inside.band).toMatchObject({ available: true, width: "20", actualInsideBand: true, belowBandBy: "0", aboveBandBy: "0" });
    const below = await evaluation({ pointEstimate: 100, low: 90, high: 110 }, { metrics: { ...metrics(), entries: count(80) } });
    expect(below.band).toMatchObject({ available: true, actualInsideBand: false, belowBandBy: "10" });
  });

  it("reports an actual above the band without calling it a probability", async () => {
    const result = await evaluation({ pointEstimate: 92, low: 90, high: 95 });
    expect(result.band).toMatchObject({ actualInsideBand: false, aboveBandBy: "5" });
    expect(JSON.stringify(result)).not.toMatch(/probability|calibration|confidence coverage|recommendation/i);
  });

  it("keeps one-sided bands unavailable", async () => {
    const result = await evaluation({ low: 90, high: null });
    expect(result.band).toMatchObject({ available: false, unavailableReason: "missing_bound", low: "90", high: null });
  });

  it("keeps unknown band semantics unavailable even with valid bounds", async () => {
    const result = await evaluation({ bandSemantics: "unknown" });
    expect(result.band).toMatchObject({ available: false, unavailableReason: "semantics_unknown" });
  });

  it("rejects inverted and point-external bands", async () => {
    const inverted = await evaluateForecastActualV1({ packet: await packet(), forecast: forecast({ low: 120, high: 90 }), revisions: [await actual()] });
    const external = await evaluateForecastActualV1({ packet: await packet(), forecast: forecast({ pointEstimate: 80, low: 90, high: 110 }), revisions: [await actual()] });
    expect(inverted).toMatchObject({ kind: "blocked", blockReasons: ["invalid_forecast_band"] });
    expect(external).toMatchObject({ kind: "blocked", blockReasons: ["invalid_forecast_band"] });
  });

  it("blocks absent point estimates and missing engine identity", async () => {
    const missingPoint = await evaluateForecastActualV1({ packet: await packet(), forecast: forecast({ pointEstimate: null }), revisions: [await actual()] });
    const missingEngine = await evaluateForecastActualV1({ packet: await packet(), forecast: forecast({ engineVersion: null }), revisions: [await actual()] });
    expect(missingPoint).toMatchObject({ kind: "blocked", blockReasons: ["forecast_point_missing"] });
    expect(missingEngine).toMatchObject({ kind: "blocked", blockReasons: ["forecast_engine_identity_missing"] });
  });

  it("blocks negative and non-canonical point values", async () => {
    const negative = await evaluateForecastActualV1({ packet: await packet(), forecast: forecast({ pointEstimate: -1 }), revisions: [await actual()] });
    const malformed = await evaluateForecastActualV1({ packet: await packet(), forecast: forecast({ pointEstimate: "01" }), revisions: [await actual()] });
    expect(negative).toMatchObject({ kind: "blocked", blockReasons: ["invalid_forecast_value"] });
    expect(malformed).toMatchObject({ kind: "blocked", blockReasons: ["invalid_forecast_value"] });
  });

  it("rejects an otherwise valid actual belonging to a different event", async () => {
    const otherEvent = await actual(REVISION, { eventId: "22222222-2222-4222-8222-222222222223" });
    const result = await evaluateForecastActualV1({ packet: await packet(), forecast: forecast(), revisions: [otherEvent] });
    expect(result).toMatchObject({ kind: "blocked", blockReasons: ["actual_identity_mismatch"], sourceState: "kernel" });
  });

  it("rejects a valid actual belonging to a different club", async () => {
    const otherClub = await actual(REVISION, { clubId: "11111111-1111-4111-8111-111111111112" });
    const result = await evaluateForecastActualV1({ packet: await packet(), forecast: forecast(), revisions: [otherClub] });
    expect(result).toMatchObject({ kind: "blocked", blockReasons: ["actual_identity_mismatch"], sourceState: "kernel" });
  });

  it.each([
    ["draft packet", async () => ({ packet: await packet({}, "draft"), forecast: forecast(), revisions: [await actual()] }), "packet_not_frozen"],
    ["missing packet", async () => ({ packet: null, forecast: forecast(), revisions: [await actual()] }), "packet_not_frozen"],
    ["no forecast", async () => ({ packet: await packet({ forecastSnapshotId: null, forecastState: "no_forecast_available" }), forecast: null, revisions: [await actual()] }), "no_forecast"],
    ["manual expectation", async () => ({ packet: await packet({ forecastState: "manual_expectation", forecastSnapshotId: null, manualExpectation: 100 }), forecast: null, revisions: [await actual()] }), "manual_expectation_only"],
    ["incomplete provenance", async () => ({ packet: await packet({ forecastState: "forecast_provenance_incomplete" }), forecast: forecast({ provenanceCompleteness: "missing_code_sha" }), revisions: [await actual()] }), "forecast_provenance_incomplete"],
    ["identity ineligible", async () => ({ packet: await packet({ forecastState: "forecast_not_identity_eligible" }), forecast: forecast({ forecastIdentityEligible: false }), revisions: [await actual()] }), "forecast_not_identity_eligible"],
    ["no actual", async () => ({ packet: await packet(), forecast: forecast(), revisions: [] }), "no_actual_revision"],
    ["provisional actual", async () => ({ packet: await packet(), forecast: forecast(), revisions: [await actual(REVISION, { finality: "provisional" })] }), "actual_not_final"],
    ["partial scope", async () => ({ packet: await packet(), forecast: forecast(), revisions: [await actual(REVISION, { scope: "partial_result" })] }), "actual_scope_mismatch"],
    ["missing metric", async () => ({ packet: await packet(), forecast: forecast(), revisions: [await actual(REVISION, { metrics: { ...metrics(), entries: missingCount() } })] }), "actual_metric_missing"],
    ["old actual", async () => ({ packet: await packet(), forecast: forecast(), revisions: [await actual(REVISION, { sourceTimestamp: "2026-08-01T02:59:59Z" })] }), "outcome_precedes_forecast"],
    ["target mismatch", async () => ({ packet: await packet(), forecast: forecast({ targetMetric: "unique_players" }), revisions: [await actual()] }), "target_metric_mismatch"],
    ["forecast issued after packet", async () => ({ packet: await packet(), forecast: forecast({ forecastIssuedAt: "2026-08-01T03:00:01Z" }), revisions: [await actual()] }), "outcome_precedes_forecast"],
    ["forecast cutoff missing", async () => ({ packet: await packet(), forecast: forecast({ asOfTs: null }), revisions: [await actual()] }), "outcome_precedes_forecast"],
    ["snapshot mismatch", async () => ({ packet: await packet(), forecast: forecast({ snapshotId: "33333333-3333-4333-8333-333333333334" }), revisions: [await actual()] }), "target_metric_mismatch"],
    ["club mismatch", async () => ({ packet: await packet(), forecast: forecast({ clubId: "11111111-1111-4111-8111-111111111112" }), revisions: [await actual()] }), "target_metric_mismatch"],
    ["event mismatch", async () => ({ packet: await packet(), forecast: forecast({ eventId: "22222222-2222-4222-8222-222222222223" }), revisions: [await actual()] }), "target_metric_mismatch"],
    ["unknown outcome scope", async () => ({ packet: await packet(), forecast: forecast(), revisions: [await actual(REVISION, { scope: "unknown" })] }), "actual_scope_mismatch"],
    ["unreported actual time", async () => ({ packet: await packet(), forecast: forecast(), revisions: [await actual(REVISION, { sourceTimestampState: "not_reported", sourceTimestamp: null })] }), "outcome_precedes_forecast"],
  ] as const)("blocks %s at the D2B gate", async (_label, inputFactory, reason) => {
    const result = await evaluateForecastActualV1(await inputFactory());
    expect(result.kind).toBe("blocked");
    expect(result).toMatchObject({ blockReasons: expect.arrayContaining([reason]) });
  });

  it("does not weaken the current D2B entries-only forecast contract", async () => {
    await expect(packet({ targetMetric: "unique_players" })).rejects.toThrow("current forecast snapshots can only support the entries target");
    const mismatch = await evaluateForecastActualV1({ packet: await packet(), forecast: forecast({ targetMetric: "total_bullets" }), revisions: [await actual()] });
    expect(mismatch).toMatchObject({ kind: "blocked", blockReasons: ["target_metric_mismatch"] });
  });

  it("binds the evaluation identity to packet, actual, snapshot and forecast output", async () => {
    const base = await evaluation({ pointEstimate: 100 });
    const changedPoint = await evaluation({ pointEstimate: 101 });
    const changedEngine = await evaluation({ engineVersion: "v2" });
    const changedPacket = await evaluation({ pointEstimate: 100 }, {}, { ownerDecision: "different owner decision" });
    const changedActual = await evaluation({ pointEstimate: 100 }, { metrics: { ...metrics(), entries: count(101) } });
    expect(new Set([base.evaluationId, changedPoint.evaluationId, changedEngine.evaluationId, changedPacket.evaluationId, changedActual.evaluationId]).size).toBe(5);
  });

  it("is deterministic and deeply immutable", async () => {
    const input = { packet: await packet(), forecast: forecast(), revisions: [await actual()] } satisfies ForecastEvaluationInput;
    const first = await evaluateForecastActualV1(input);
    const second = await evaluateForecastActualV1(input);
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    if (first.kind === "evaluation") {
      expect(Object.isFrozen(first.band)).toBe(true);
      expect(() => { (first as { pointEstimate: string }).pointEstimate = "1"; }).toThrow();
    }
  });

  it("classifies blocked, stale, superseded and current records without mutation", async () => {
    const current = await evaluation();
    expect(classifyForecastEvaluationLifecycleV1(current, { packetId: PACKET, forecastSnapshotId: SNAPSHOT, actualRevisionId: REVISION, actualResolution: "current" })).toBe("current");
    expect(classifyForecastEvaluationLifecycleV1(current, { packetId: "other", forecastSnapshotId: SNAPSHOT, actualRevisionId: REVISION, actualResolution: "current" })).toBe("superseded");
    expect(classifyForecastEvaluationLifecycleV1(current, { packetId: PACKET, forecastSnapshotId: SNAPSHOT, actualRevisionId: REVISION, actualResolution: "conflict" })).toBe("stale");
    expect(classifyForecastEvaluationLifecycleV1({ kind: "blocked", lifecycle: "blocked", evaluationId: null, contractVersion: "series-forecast-evaluation-v1", scoringEligibilityContractVersion: "d2b-scoring-eligibility-v1", clubId: null, eventId: null, packetId: null, targetMetric: null, horizon: null, blockReasons: ["no_actual_revision"], sourceState: "d2b" }, { packetId: null, forecastSnapshotId: null, actualRevisionId: null, actualResolution: "unavailable" })).toBe("blocked");
  });

  it("does not mutate caller input", async () => {
    const input = { packet: await packet(), forecast: forecast(), revisions: [await actual()] };
    const before = JSON.stringify(input);
    await evaluateForecastActualV1(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("keeps custom scoring contract versions in the result and identity", async () => {
    const input = { packet: await packet(), forecast: forecast(), revisions: [await actual()], scoringEligibilityContractVersion: "d2b-scoring-eligibility-test-v2" };
    const first = await evaluateForecastActualV1(input);
    const second = await evaluateForecastActualV1({ ...input, scoringEligibilityContractVersion: "d2b-scoring-eligibility-test-v3" });
    expect(first).toMatchObject({ scoringEligibilityContractVersion: "d2b-scoring-eligibility-test-v2" });
    expect(second).toMatchObject({ scoringEligibilityContractVersion: "d2b-scoring-eligibility-test-v3" });
    if (first.kind === "evaluation" && second.kind === "evaluation") expect(first.evaluationId).not.toBe(second.evaluationId);
  });

  it("keeps a probabilistic label descriptive until a separate calibration layer exists", async () => {
    const result = await evaluation({ bandSemantics: "probabilistic_quantiles", low: 90, high: 110 });
    expect(result.band).toMatchObject({ available: true, semantics: "probabilistic_quantiles" });
    expect(result).not.toHaveProperty("coverage");
    expect(result).not.toHaveProperty("calibrated");
  });

  it("rejects a negative bound even when the point estimate is valid", async () => {
    const result = await evaluateForecastActualV1({ packet: await packet(), forecast: forecast({ low: -1 }), revisions: [await actual()] });
    expect(result).toMatchObject({ kind: "blocked", blockReasons: ["invalid_forecast_band"] });
  });

  it("blocks competing automatic and manual actual heads until reconciliation", async () => {
    const automatic = await actual(REVISION);
    const manual = await actual("50000000-0000-4000-8000-000000000002", { sourceKind: "owner_manual", reconciliationStatus: "manual_only", idempotencyKey: "actual:manual" });
    const result = await evaluateForecastActualV1({ packet: await packet(), forecast: forecast(), revisions: [automatic, manual] });
    expect(result).toMatchObject({ kind: "blocked", blockReasons: ["reconciliation_required"] });
  });

  it("blocks a conflicting actual head rather than scoring it", async () => {
    const result = await evaluateForecastActualV1({ packet: await packet(), forecast: forecast(), revisions: [await actual(REVISION, { finality: "conflicting" })] });
    expect(result).toMatchObject({ kind: "blocked", blockReasons: ["actual_conflict"] });
  });

  it("does not expose actual outcome values in a blocked result", async () => {
    const result = await evaluateForecastActualV1({ packet: await packet({}, "draft"), forecast: forecast({ pointEstimate: 999 }), revisions: [await actual()] });
    expect(result).toMatchObject({ kind: "blocked" });
    expect(JSON.stringify(result)).not.toContain("100");
  });
});

it("uses only the server's selected revision and the matching prospective snapshot", async () => {
  const frozen = await packet();
  const revision = await actual();
  const state = {
    version: "series-decision-event-state-v1",
    event: { clubId: CLUB, eventId: EVENT, status: "completed", targetEventTs: frozen.packet.targetEventTs },
    decisionPackets: [{ ...frozen.packet, packetId: PACKET, packetState: "frozen", frozenAt: frozen.frozenAt }],
    actualTruth: { state: "current", chosenRevision: revision },
    scoring: { candidatePacketId: PACKET, candidateActualRevisionId: REVISION, targetMetric: "entries", eligibility: "eligible", blockReasons: [] },
    dataQuality: { legacyActualCacheAvailable: false, d2aRevisionAvailable: true, unresolvedMismatch: false, missingFields: [], unsupportedDerivationWarnings: [] },
  } as const;
  const snapshot = forecast({ asOfTs: frozen.packet.sourceCutoff, pointEstimate: 95 });
  await expect(evaluateDecisionEventStateV1(state, snapshot)).resolves.toMatchObject({
    kind: "evaluation", absoluteError: "5", actualRevisionId: REVISION,
  });
  await expect(evaluateDecisionEventStateV1(state, { ...snapshot, eventId: "other-event" })).resolves.toMatchObject({ kind: "blocked" });
  await expect(evaluateDecisionEventStateV1({
    ...state, decisionPackets: [{ ...state.decisionPackets[0], frozenAt: state.event.targetEventTs }],
  }, snapshot)).resolves.toMatchObject({ kind: "blocked" });
  const precise = {
    ...state,
    event: { ...state.event, targetEventTs: "2026-11-21T02:00:00.000005+07:00" },
    decisionPackets: [{ ...state.decisionPackets[0], asOfTs: "2026-11-20T19:00:00.000003Z",
      frozenAt: "2026-11-20T19:00:00.000004Z" }],
    actualTruth: { ...state.actualTruth, chosenRevision: { ...revision, sourceTimestamp: "2026-11-20T19:00:00.000006Z" } },
  };
  const preciseForecast = { ...snapshot, asOfTs: "2026-11-20T19:00:00.000001Z", forecastIssuedAt: "2026-11-20T19:00:00.000002Z" };
  await expect(evaluateDecisionEventStateV1(precise, preciseForecast)).resolves.toMatchObject({ kind: "evaluation" });
  await expect(evaluateDecisionEventStateV1(precise, {
    ...preciseForecast, asOfTs: "2026-11-20T19:00:00.000003Z",
  })).resolves.toMatchObject({ kind: "blocked", blockReasons: ["outcome_precedes_forecast"] });
});
