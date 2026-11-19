import type {
  DecisionForecastState,
  DecisionPacketHorizon,
  DecisionTargetMetric,
  EventActualFinality,
  EventActualMetrics,
  EventActualReconciliationStatus,
  EventActualSourceKind,
  EventOutcomeScope,
  MetricAvailability,
  SourceTimestampState,
} from "./decisionPacketV1";

export const DECISION_EVENT_STATE_RESPONSE_VERSION = "series-decision-event-state-v1" as const;

export type DecisionEventStateBackendError =
  | "backend_unavailable"
  | "malformed_response"
  | "rpc_error";

export type ActualTruthState = "unavailable" | "current" | "needs_reconciliation" | "conflict";

export interface DecisionEventStateActualRevision {
  readonly revisionId: string;
  readonly scope: EventOutcomeScope;
  readonly finality: EventActualFinality;
  readonly sourceKind: EventActualSourceKind;
  readonly sourceTimestampState: SourceTimestampState;
  readonly sourceTimestamp: string | null;
  readonly capturedAt: string;
  readonly reconciliationStatus: EventActualReconciliationStatus;
  readonly metrics: EventActualMetrics;
  readonly supersedesRevisionId: string | null;
  readonly reconcilesAutoRevisionId: string | null;
  readonly reconcilesManualRevisionId: string | null;
  readonly contentHash: string;
  readonly correctionReason: string | null;
}

export interface DecisionEventStatePacket {
  readonly packetId: string;
  readonly horizon: DecisionPacketHorizon;
  readonly targetMetric: DecisionTargetMetric;
  readonly packetState: "draft" | "frozen";
  readonly asOfTs: string;
  readonly sourceCutoff: string;
  readonly forecastSnapshotId: string | null;
  readonly forecastState: DecisionForecastState;
  readonly contentHash: string;
  readonly frozenAt: string | null;
  readonly supersedesPacketId: string | null;
}

export interface DecisionEventStateResponse {
  readonly version: typeof DECISION_EVENT_STATE_RESPONSE_VERSION;
  readonly event: {
    readonly eventId: string;
    readonly clubId: string;
    readonly status: string;
    readonly targetEventTs: string | null;
  };
  readonly decisionPackets: readonly DecisionEventStatePacket[];
  readonly actualTruth: {
    readonly state: ActualTruthState;
    readonly reason?: string;
    readonly sourceState?: "auto_only" | "manual_only" | "reconciled";
    readonly chosenRevision?: DecisionEventStateActualRevision;
    readonly autoHead?: DecisionEventStateActualRevision;
    readonly manualHead?: DecisionEventStateActualRevision;
    readonly reconciledHead?: DecisionEventStateActualRevision;
  };
  readonly scoring: {
    readonly candidatePacketId: string | null;
    readonly candidateActualRevisionId: string | null;
    readonly targetMetric: DecisionTargetMetric | null;
    readonly eligibility: "eligible" | "blocked";
    readonly blockReasons: readonly string[];
  };
  readonly dataQuality: {
    readonly legacyActualCacheAvailable: boolean;
    readonly d2aRevisionAvailable: boolean;
    readonly unresolvedMismatch: boolean;
    readonly missingFields: readonly string[];
    readonly unsupportedDerivationWarnings: readonly string[];
  };
}

export type DecisionEventStateParseResult =
  | { readonly ok: true; readonly value: DecisionEventStateResponse }
  | { readonly ok: false; readonly error: DecisionEventStateBackendError };

const HORIZONS = new Set<DecisionPacketHorizon>(["T-21", "T-7", "T-1", "T-0"]);
const TARGETS = new Set<DecisionTargetMetric>(["entries", "unique_players", "total_bullets"]);
const FORECAST_STATES = new Set<DecisionForecastState>([
  "no_forecast_available", "manual_expectation", "forecast_provenance_incomplete", "forecast_not_identity_eligible", "forecast_identity_eligible",
]);
const SCOPES = new Set<EventOutcomeScope>(["event_total", "flight_only", "day_total", "series_total", "partial_result", "unknown"]);
const FINALITIES = new Set<EventActualFinality>(["partial", "provisional", "final", "corrected", "conflicting", "void"]);
const SOURCE_KINDS = new Set<EventActualSourceKind>(["native_tournament_system", "auto_capture", "owner_manual", "reconciled", "legacy_decision_log", "import_verified"]);
const RECONCILIATION = new Set<EventActualReconciliationStatus>(["auto_only", "manual_only", "matching", "mismatch", "manually_reconciled", "blocked_conflict"]);
const AVAILABILITY = new Set<MetricAvailability>(["present", "missing", "explicit_zero", "uncertain", "conflicting", "not_applicable"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}
function isText(value: unknown): value is string { return typeof value === "string"; }
function isNullableText(value: unknown): value is string | null { return value === null || typeof value === "string"; }
function isArrayOfText(value: unknown): value is readonly string[] { return Array.isArray(value) && value.every(isText); }
function isIsoInstant(value: unknown, allowNull = false): value is string | null {
  return (allowNull && value === null) || (typeof value === "string" && Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value));
}
function asCountMetric(value: unknown): EventActualMetrics["entries"] | null {
  if (!isObject(value) || !exactKeys(value, ["availability", "value"]) || !isText(value.availability) || !AVAILABILITY.has(value.availability as MetricAvailability)) return null;
  if (value.value !== null && (!Number.isSafeInteger(value.value) || (value.value as number) < 0)) return null;
  if ((value.availability === "present" || value.availability === "explicit_zero") !== (value.value !== null)) return null;
  return { availability: value.availability as MetricAvailability, value: value.value as number | null };
}
function asMoneyMetric(value: unknown): EventActualMetrics["prizePool"] | null {
  if (!isObject(value) || !exactKeys(value, ["amountMinor", "availability", "currency", "scale"]) || !isText(value.availability) || !AVAILABILITY.has(value.availability as MetricAvailability)) return null;
  const populated = typeof value.amountMinor === "string" && /^(0|[1-9][0-9]*)$/.test(value.amountMinor) && typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency) && Number.isInteger(value.scale) && (value.scale as number) >= 0 && (value.scale as number) <= 6;
  if ((value.availability === "present" || value.availability === "explicit_zero") !== populated) return null;
  if (!populated && (value.amountMinor !== null || value.currency !== null || value.scale !== null)) return null;
  return { availability: value.availability as MetricAvailability, amountMinor: value.amountMinor as string | null, currency: value.currency as string | null, scale: value.scale as number | null };
}
function asMetrics(value: unknown): EventActualMetrics | null {
  if (!isObject(value) || !exactKeys(value, ["entries", "overlay", "paidPlaces", "prizePool", "reentries", "registrationRecords", "totalBullets", "uniquePlayers"])) return null;
  const entries = asCountMetric(value.entries); const uniquePlayers = asCountMetric(value.uniquePlayers); const totalBullets = asCountMetric(value.totalBullets); const reentries = asCountMetric(value.reentries); const registrationRecords = asCountMetric(value.registrationRecords); const paidPlaces = asCountMetric(value.paidPlaces); const prizePool = asMoneyMetric(value.prizePool); const overlay = asMoneyMetric(value.overlay);
  return entries && uniquePlayers && totalBullets && reentries && registrationRecords && paidPlaces && prizePool && overlay ? { entries, uniquePlayers, totalBullets, reentries, registrationRecords, paidPlaces, prizePool, overlay } : null;
}
function asRevision(value: unknown): DecisionEventStateActualRevision | null {
  const keys = ["capturedAt", "contentHash", "correctionReason", "finality", "metrics", "reconcilesAutoRevisionId", "reconcilesManualRevisionId", "reconciliationStatus", "revisionId", "scope", "sourceKind", "sourceTimestamp", "sourceTimestampState", "supersedesRevisionId"];
  if (!isObject(value) || !exactKeys(value, keys) || !isText(value.revisionId) || !isText(value.contentHash) || !isNullableText(value.correctionReason) || !isNullableText(value.supersedesRevisionId) || !isNullableText(value.reconcilesAutoRevisionId) || !isNullableText(value.reconcilesManualRevisionId) || !isIsoInstant(value.capturedAt) || !isIsoInstant(value.sourceTimestamp, true) || !isText(value.scope) || !SCOPES.has(value.scope as EventOutcomeScope) || !isText(value.finality) || !FINALITIES.has(value.finality as EventActualFinality) || !isText(value.sourceKind) || !SOURCE_KINDS.has(value.sourceKind as EventActualSourceKind) || !isText(value.sourceTimestampState) || !["exact", "not_reported"].includes(value.sourceTimestampState) || !isText(value.reconciliationStatus) || !RECONCILIATION.has(value.reconciliationStatus as EventActualReconciliationStatus)) return null;
  if ((value.sourceTimestampState === "exact") !== (value.sourceTimestamp !== null)) return null;
  const metrics = asMetrics(value.metrics); if (!metrics) return null;
  return { revisionId: value.revisionId, scope: value.scope as EventOutcomeScope, finality: value.finality as EventActualFinality, sourceKind: value.sourceKind as EventActualSourceKind, sourceTimestampState: value.sourceTimestampState as SourceTimestampState, sourceTimestamp: value.sourceTimestamp as string | null, capturedAt: value.capturedAt as string, reconciliationStatus: value.reconciliationStatus as EventActualReconciliationStatus, metrics, supersedesRevisionId: value.supersedesRevisionId as string | null, reconcilesAutoRevisionId: value.reconcilesAutoRevisionId as string | null, reconcilesManualRevisionId: value.reconcilesManualRevisionId as string | null, contentHash: value.contentHash, correctionReason: value.correctionReason as string | null };
}
function asPacket(value: unknown): DecisionEventStatePacket | null {
  const keys = ["asOfTs", "contentHash", "forecastSnapshotId", "forecastState", "frozenAt", "horizon", "packetId", "packetState", "sourceCutoff", "supersedesPacketId", "targetMetric"];
  if (!isObject(value) || !exactKeys(value, keys) || !isText(value.packetId) || !isText(value.contentHash) || !isNullableText(value.forecastSnapshotId) || !isNullableText(value.frozenAt) || !isNullableText(value.supersedesPacketId) || !isIsoInstant(value.asOfTs) || !isIsoInstant(value.sourceCutoff) || !isIsoInstant(value.frozenAt, true) || !isText(value.horizon) || !HORIZONS.has(value.horizon as DecisionPacketHorizon) || !isText(value.targetMetric) || !TARGETS.has(value.targetMetric as DecisionTargetMetric) || !isText(value.forecastState) || !FORECAST_STATES.has(value.forecastState as DecisionForecastState) || (value.packetState !== "draft" && value.packetState !== "frozen")) return null;
  return {
    packetId: value.packetId, contentHash: value.contentHash,
    forecastSnapshotId: value.forecastSnapshotId as string | null,
    frozenAt: value.frozenAt as string | null, supersedesPacketId: value.supersedesPacketId as string | null,
    asOfTs: value.asOfTs as string, sourceCutoff: value.sourceCutoff as string,
    horizon: value.horizon as DecisionPacketHorizon, targetMetric: value.targetMetric as DecisionTargetMetric,
    forecastState: value.forecastState as DecisionForecastState, packetState: value.packetState,
  };
}

export function parseDecisionEventStateResponse(value: unknown): DecisionEventStateParseResult {
  const rootKeys = ["actualTruth", "dataQuality", "decisionPackets", "event", "scoring", "version"];
  if (!isObject(value) || !exactKeys(value, rootKeys) || value.version !== DECISION_EVENT_STATE_RESPONSE_VERSION || !isObject(value.event) || !exactKeys(value.event, ["clubId", "eventId", "status", "targetEventTs"]) || !isText(value.event.clubId) || !isText(value.event.eventId) || !isText(value.event.status) || !isIsoInstant(value.event.targetEventTs, true) || !Array.isArray(value.decisionPackets) || !isObject(value.actualTruth) || !isObject(value.scoring) || !isObject(value.dataQuality)) return { ok: false, error: "malformed_response" };
  const packets = value.decisionPackets.map(asPacket); if (packets.some((packet) => packet === null)) return { ok: false, error: "malformed_response" };
  const truth = value.actualTruth; const truthState = truth.state;
  if (!["unavailable", "current", "needs_reconciliation", "conflict"].includes(truthState as string)) return { ok: false, error: "malformed_response" };
  for (const key of Object.keys(truth)) if (!["state", "reason", "sourceState", "chosenRevision", "autoHead", "manualHead", "reconciledHead"].includes(key)) return { ok: false, error: "malformed_response" };
  for (const key of ["chosenRevision", "autoHead", "manualHead", "reconciledHead"] as const) if (truth[key] !== undefined && asRevision(truth[key]) === null) return { ok: false, error: "malformed_response" };
  if (truth.reason !== undefined && !isText(truth.reason)) return { ok: false, error: "malformed_response" };
  if (truth.sourceState !== undefined && !["auto_only", "manual_only", "reconciled"].includes(truth.sourceState as string)) return { ok: false, error: "malformed_response" };
  const scoring = value.scoring;
  if (!exactKeys(scoring, ["blockReasons", "candidateActualRevisionId", "candidatePacketId", "eligibility", "targetMetric"]) || !isNullableText(scoring.candidateActualRevisionId) || !isNullableText(scoring.candidatePacketId) || !(scoring.targetMetric === null || (isText(scoring.targetMetric) && TARGETS.has(scoring.targetMetric as DecisionTargetMetric))) || !isArrayOfText(scoring.blockReasons) || (scoring.eligibility !== "eligible" && scoring.eligibility !== "blocked")) return { ok: false, error: "malformed_response" };
  if (scoring.eligibility === "eligible") {
    const packet = packets.find(candidate => candidate?.packetId === scoring.candidatePacketId);
    const actual = asRevision(truth.chosenRevision);
    if (!packet || packet.packetState !== "frozen" || packet.targetMetric !== scoring.targetMetric
      || truthState !== "current" || !actual || actual.revisionId !== scoring.candidateActualRevisionId
      || scoring.blockReasons.length !== 0) return { ok: false, error: "malformed_response" };
  }
  const quality = value.dataQuality;
  if (!exactKeys(quality, ["d2aRevisionAvailable", "legacyActualCacheAvailable", "missingFields", "unresolvedMismatch", "unsupportedDerivationWarnings"]) || typeof quality.legacyActualCacheAvailable !== "boolean" || typeof quality.d2aRevisionAvailable !== "boolean" || typeof quality.unresolvedMismatch !== "boolean" || !isArrayOfText(quality.missingFields) || !isArrayOfText(quality.unsupportedDerivationWarnings)) return { ok: false, error: "malformed_response" };
  return { ok: true, value: { version: DECISION_EVENT_STATE_RESPONSE_VERSION, event: { eventId: value.event.eventId, clubId: value.event.clubId, status: value.event.status, targetEventTs: value.event.targetEventTs as string | null }, decisionPackets: packets as DecisionEventStatePacket[], actualTruth: { state: truthState as ActualTruthState, ...(truth.reason ? { reason: truth.reason as string } : {}), ...(truth.sourceState ? { sourceState: truth.sourceState as "auto_only" | "manual_only" | "reconciled" } : {}), ...(truth.chosenRevision ? { chosenRevision: asRevision(truth.chosenRevision)! } : {}), ...(truth.autoHead ? { autoHead: asRevision(truth.autoHead)! } : {}), ...(truth.manualHead ? { manualHead: asRevision(truth.manualHead)! } : {}), ...(truth.reconciledHead ? { reconciledHead: asRevision(truth.reconciledHead)! } : {}) }, scoring: { candidatePacketId: scoring.candidatePacketId as string | null, candidateActualRevisionId: scoring.candidateActualRevisionId as string | null, targetMetric: scoring.targetMetric as DecisionTargetMetric | null, eligibility: scoring.eligibility as "eligible" | "blocked", blockReasons: scoring.blockReasons as string[] }, dataQuality: { legacyActualCacheAvailable: quality.legacyActualCacheAvailable, d2aRevisionAvailable: quality.d2aRevisionAvailable, unresolvedMismatch: quality.unresolvedMismatch, missingFields: quality.missingFields as string[], unsupportedDerivationWarnings: quality.unsupportedDerivationWarnings as string[] } } };
}
