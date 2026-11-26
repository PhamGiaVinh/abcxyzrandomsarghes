import type {
  DecisionPacketHorizon,
  DecisionTargetMetric,
  EventActualFinality,
  EventActualReconciliationStatus,
  EventActualRevision,
  EventActualSourceKind,
  EventOutcomeScope,
} from "./decisionPacketV1";
import type {
  ForecastActualScoringBlockReason,
  RuntimeDecisionPacket,
  RuntimeForecastSnapshot,
} from "./decisionPacketReadModel";

export const FORECAST_EVALUATION_CONTRACT_VERSION = "series-forecast-evaluation-v1" as const;
export const POINT_ESTIMATE_SEMANTICS = "base_estimate" as const;
export const SCORING_ELIGIBILITY_CONTRACT_VERSION = "d2b-scoring-eligibility-v1" as const;

export type ExactCountInput = number | string | bigint;
export type ForecastBandSemantics = "descriptive_range" | "scenario_band" | "probabilistic_quantiles" | "unknown";
export type ForecastEvaluationDirection = "over" | "under" | "exact";
export type ForecastEvaluationLifecycle = "current" | "superseded" | "stale" | "blocked";
export type ForecastEvaluationSampleGate =
  | "descriptive_only_small_sample"
  | "descriptive_only"
  | "evaluation_summary_available";

export type ForecastEvaluationBlockReason =
  | ForecastActualScoringBlockReason
  | "forecast_point_missing"
  | "invalid_forecast_value"
  | "invalid_forecast_band"
  | "forecast_engine_identity_missing"
  | "actual_identity_mismatch";

export interface ForecastEvaluationForecastInput extends RuntimeForecastSnapshot {
  readonly pointEstimate: ExactCountInput | null;
  readonly low: ExactCountInput | null;
  readonly high: ExactCountInput | null;
  readonly engineId: string | null;
  readonly engineVersion: string | null;
  readonly predictorId: string | null;
  readonly bandSemantics: ForecastBandSemantics | null;
}

export interface ForecastEvaluationPacketInput extends RuntimeDecisionPacket {
  readonly packetId: string;
}

export interface ForecastEvaluationInput {
  readonly packet: ForecastEvaluationPacketInput | null;
  readonly forecast: ForecastEvaluationForecastInput | null;
  readonly revisions: readonly EventActualRevision[];
  readonly scoringEligibilityContractVersion?: string;
}

export interface ForecastEvaluationBandV1 {
  readonly available: boolean;
  readonly semantics: ForecastBandSemantics | null;
  readonly low: string | null;
  readonly high: string | null;
  readonly width: string | null;
  readonly actualInsideBand: boolean | null;
  readonly belowBandBy: string | null;
  readonly aboveBandBy: string | null;
  readonly unavailableReason: "missing_bound" | "semantics_unknown" | null;
}

export interface SeriesForecastEvaluationV1 {
  readonly kind: "evaluation";
  readonly lifecycle: "current";
  readonly evaluationId: string;
  readonly contractVersion: typeof FORECAST_EVALUATION_CONTRACT_VERSION;
  readonly scoringEligibilityContractVersion: string;
  readonly clubId: string;
  readonly eventId: string;
  readonly scope: EventOutcomeScope;
  readonly targetMetric: DecisionTargetMetric;
  readonly horizon: DecisionPacketHorizon;
  readonly packetId: string;
  readonly packetContentHash: string;
  readonly forecastSnapshotId: string;
  readonly actualRevisionId: string;
  readonly actualContentHash: string;
  readonly actualFinality: EventActualFinality;
  readonly actualSourceKind: EventActualSourceKind;
  readonly actualReconciliationStatus: EventActualReconciliationStatus;
  readonly actualSourceTimestamp: string;
  readonly actual: string;
  readonly pointEstimateSemantics: typeof POINT_ESTIMATE_SEMANTICS;
  readonly pointEstimate: string;
  readonly engineId: string;
  readonly engineVersion: string;
  readonly predictorId: string;
  readonly forecastIssuedAt: string;
  readonly asOfTs: string;
  readonly signedError: string;
  readonly absoluteError: string;
  readonly squaredError: string;
  readonly direction: ForecastEvaluationDirection;
  readonly band: ForecastEvaluationBandV1;
}

export interface SeriesForecastEvaluationBlockedV1 {
  readonly kind: "blocked";
  readonly lifecycle: "blocked";
  readonly evaluationId: null;
  readonly contractVersion: typeof FORECAST_EVALUATION_CONTRACT_VERSION;
  readonly scoringEligibilityContractVersion: string;
  readonly clubId: string | null;
  readonly eventId: string | null;
  readonly packetId: string | null;
  readonly targetMetric: DecisionTargetMetric | null;
  readonly horizon: DecisionPacketHorizon | null;
  readonly blockReasons: readonly ForecastEvaluationBlockReason[];
  readonly sourceState: "d2b" | "kernel";
}

export type SeriesForecastEvaluationResult = SeriesForecastEvaluationV1 | SeriesForecastEvaluationBlockedV1;

export interface ForecastEvaluationCurrentPointers {
  readonly packetId: string | null;
  readonly forecastSnapshotId: string | null;
  readonly actualRevisionId: string | null;
  readonly actualResolution: "current" | "needs_reconciliation" | "conflict" | "unavailable";
}

export interface ExactRational {
  readonly numerator: string;
  readonly denominator: number;
}

export interface ForecastEvaluationAggregateV1 {
  readonly contractVersion: typeof FORECAST_EVALUATION_CONTRACT_VERSION;
  readonly clubId: string;
  readonly targetMetric: DecisionTargetMetric;
  readonly horizon: DecisionPacketHorizon;
  readonly engineId: string;
  readonly engineVersion: string;
  readonly bandSemantics: ForecastBandSemantics | null;
  readonly n: number;
  readonly sumSignedError: string;
  readonly sumAbsoluteError: string;
  readonly meanSignedError: ExactRational;
  readonly mae: ExactRational;
  /** Sum of absolute errors divided by the sum of actual entries. */
  readonly wape: { readonly numerator: string; readonly denominator: string } | null;
  readonly exactCount: number;
  readonly overCount: number;
  readonly underCount: number;
  readonly bandEligibleN: number;
  readonly insideBandCount: number;
  readonly insideForecastBandRate: ExactRational | null;
  readonly sampleGate: ForecastEvaluationSampleGate;
}
