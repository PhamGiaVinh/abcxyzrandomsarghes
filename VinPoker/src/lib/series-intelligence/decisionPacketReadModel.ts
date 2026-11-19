import type {
  DecisionPacketContent,
  DecisionTargetMetric,
  EventActualResolution,
  EventActualRevision,
} from "./decisionPacketV1";
import { resolveEventActualTruth } from "./decisionPacketV1";

export type ForecastActualScoringBlockReason =
  | "packet_not_frozen"
  | "no_forecast"
  | "manual_expectation_only"
  | "forecast_provenance_incomplete"
  | "forecast_not_identity_eligible"
  | "no_actual_revision"
  | "actual_not_final"
  | "actual_scope_mismatch"
  | "actual_metric_missing"
  | "actual_conflict"
  | "reconciliation_required"
  | "stale_reconciliation"
  | "outcome_precedes_forecast"
  | "target_metric_mismatch";

export interface RuntimeDecisionPacket {
  readonly packet: DecisionPacketContent;
  readonly packetState: "draft" | "frozen";
  readonly frozenAt: string | null;
}

export interface RuntimeForecastSnapshot {
  readonly snapshotId: string;
  readonly clubId: string;
  readonly eventId: string;
  readonly targetMetric: DecisionTargetMetric;
  readonly forecastIssuedAt: string | null;
  readonly asOfTs: string | null;
  readonly provenanceCompleteness: "complete" | "missing_code_sha" | "manual" | "legacy" | null;
  readonly forecastIdentityEligible: boolean;
}

export interface ResolvedSeriesActualTruth {
  readonly resolution: EventActualResolution;
  readonly activeRevision: EventActualRevision | null;
}

export interface ForecastActualScoringPair {
  readonly eligibility: "eligible" | "blocked";
  readonly blockReasons: readonly ForecastActualScoringBlockReason[];
  readonly packet: RuntimeDecisionPacket | null;
  readonly forecast: RuntimeForecastSnapshot | null;
  readonly actual: EventActualRevision | null;
}

function once(reasons: readonly ForecastActualScoringBlockReason[]): readonly ForecastActualScoringBlockReason[] {
  return [...new Set(reasons)];
}

function isFinal(actual: EventActualRevision): boolean {
  return actual.finality === "final" || actual.finality === "corrected";
}

function metricForTarget(actual: EventActualRevision, target: DecisionTargetMetric) {
  if (target === "entries") return actual.metrics.entries;
  if (target === "unique_players") return actual.metrics.uniquePlayers;
  return actual.metrics.totalBullets;
}

export async function resolveSeriesEventActualTruthV1(revisions: readonly EventActualRevision[]): Promise<ResolvedSeriesActualTruth> {
  const first = revisions[0];
  if (!first) return { activeRevision: null, resolution: { state: "unavailable", reason: "no_revision" } };
  const resolution = await resolveEventActualTruth(revisions, first.eventId, "event_total");
  return { activeRevision: resolution.state === "current" ? resolution.revision : null, resolution };
}

export async function resolveForecastActualScoringPairV1(input: {
  readonly packet: RuntimeDecisionPacket | null;
  readonly forecast: RuntimeForecastSnapshot | null;
  readonly revisions: readonly EventActualRevision[];
}): Promise<ForecastActualScoringPair> {
  const truth = await resolveSeriesEventActualTruthV1(input.revisions);
  const reasons: ForecastActualScoringBlockReason[] = [];
  const packet = input.packet;
  const forecast = input.forecast;
  const actual = truth.activeRevision;

  if (!packet || packet.packetState !== "frozen") reasons.push("packet_not_frozen");
  if (!packet || packet.packet.forecastSnapshotId === null) reasons.push("no_forecast");
  if (packet?.packet.forecastState === "manual_expectation") reasons.push("manual_expectation_only");
  if (packet?.packet.forecastState === "forecast_provenance_incomplete") reasons.push("forecast_provenance_incomplete");
  if (packet?.packet.forecastState === "forecast_not_identity_eligible") reasons.push("forecast_not_identity_eligible");
  if (packet?.packet.forecastState === "forecast_identity_eligible" && !forecast) reasons.push("no_forecast");
  if (forecast && forecast.provenanceCompleteness !== "complete") reasons.push("forecast_provenance_incomplete");
  if (forecast && !forecast.forecastIdentityEligible) reasons.push("forecast_not_identity_eligible");
  if (packet && forecast && (packet.packet.clubId !== forecast.clubId || packet.packet.eventId !== forecast.eventId || packet.packet.targetMetric !== forecast.targetMetric || packet.packet.forecastSnapshotId !== forecast.snapshotId)) reasons.push("target_metric_mismatch");
  const packetCutoff = Date.parse(packet?.packet.asOfTs ?? "");
  if (forecast && (!Number.isFinite(Date.parse(forecast.asOfTs ?? ""))
      || !(Date.parse(forecast.forecastIssuedAt ?? "") <= packetCutoff))) reasons.push("outcome_precedes_forecast");

  if (truth.resolution.state === "needs_reconciliation") reasons.push("reconciliation_required");
  if (truth.resolution.state === "conflict") reasons.push(truth.resolution.reason === "stale_reconciliation" ? "stale_reconciliation" : "actual_conflict");
  if (truth.resolution.state === "unavailable") {
    const hasDifferentScope = packet !== null && input.revisions.some((revision) => revision.eventId === packet.packet.eventId && revision.scope !== "event_total");
    reasons.push(hasDifferentScope ? "actual_scope_mismatch" : "no_actual_revision");
  }
  if (actual && actual.scope !== "event_total") reasons.push("actual_scope_mismatch");
  if (actual && !isFinal(actual)) reasons.push("actual_not_final");
  if (actual && (actual.sourceTimestampState !== "exact" || !actual.sourceTimestamp)) reasons.push("outcome_precedes_forecast");
  if (actual && packet && !(Date.parse(actual.sourceTimestamp ?? "") > packetCutoff)) reasons.push("outcome_precedes_forecast");
  if (actual && packet) {
    const metric = metricForTarget(actual, packet.packet.targetMetric);
    if (!(["present", "explicit_zero"] as const).includes(metric.availability as "present" | "explicit_zero")) reasons.push("actual_metric_missing");
  }

  const blockReasons = once(reasons);
  return { eligibility: blockReasons.length === 0 ? "eligible" : "blocked", blockReasons, packet, forecast, actual };
}
