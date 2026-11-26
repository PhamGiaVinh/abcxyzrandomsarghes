import type { DecisionEventStateResponse } from "./decisionPacketRuntimeTypes";
import type { SeriesEvent } from "./nativeData";

export const TRUSTED_FORECAST_HISTORY_VERSION = "series-trusted-forecast-history-v1" as const;

export type TrustedForecastHistoryExclusionCode =
  | "target_event_excluded"
  | "non_native_event"
  | "actual_state_unavailable"
  | "event_identity_mismatch"
  | "actual_not_current"
  | "chosen_revision_missing"
  | "event_not_completed"
  | "finality_not_final"
  | "scope_not_event_total"
  | "source_timestamp_not_exact"
  | "source_timestamp_after_as_of"
  | "revision_captured_at_invalid"
  | "revision_captured_after_as_of"
  | "event_date_unavailable"
  | "event_not_before_as_of"
  | "unresolved_reconciliation"
  | "untrusted_source_state"
  | "untrusted_source_kind"
  | "untrusted_reconciliation"
  | "target_metric_incompatible"
  | "target_metric_unavailable";

export interface TrustedForecastHistoryExclusion {
  readonly eventId: string;
  readonly code: TrustedForecastHistoryExclusionCode;
}

export interface TrustedForecastHistoryResult {
  readonly version: typeof TRUSTED_FORECAST_HISTORY_VERSION;
  readonly asOfTs: string;
  readonly events: readonly SeriesEvent[];
  readonly exclusions: readonly TrustedForecastHistoryExclusion[];
}

export interface TrustedForecastHistoryInput {
  readonly asOfTs: string;
  readonly targetEventId?: string;
  readonly events: readonly SeriesEvent[];
  readonly statesByEventId: Readonly<Record<string, DecisionEventStateResponse | null | undefined>>;
}

const TRUSTED_SOURCE_KINDS = new Set(["native_tournament_system", "reconciled"]);
const TRUSTED_SOURCE_STATES = new Set(["auto_only", "reconciled"]);
const TRUSTED_RECONCILIATION = new Set(["auto_only", "matching", "manually_reconciled"]);

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function instant(value: string, label: string): { readonly iso: string; readonly ms: number } {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error(`${label} must be an ISO instant.`);
  return { iso: new Date(ms).toISOString(), ms };
}

function exclusion(eventId: string, code: TrustedForecastHistoryExclusionCode): TrustedForecastHistoryExclusion {
  return { eventId, code };
}

function trustedHistoryEvent(event: SeriesEvent, availableAt: string, entries: number): SeriesEvent {
  return {
    ...event,
    // The native adapter may expose a live/current count. D2B actual truth is the only count used here.
    total_entries: entries,
    unique_entries: null,
    reentries: null,
    prize_pool_actual: null,
    outcome_available_at: availableAt,
    missingFields: event.missingFields.filter((field) => field !== "total_entries"),
  };
}

export function buildTrustedForecastHistoryV1(input: TrustedForecastHistoryInput): TrustedForecastHistoryResult {
  const asOf = instant(input.asOfTs, "asOfTs");
  const events: SeriesEvent[] = [];
  const exclusions: TrustedForecastHistoryExclusion[] = [];

  const sorted = [...input.events].sort((a, b) => {
    const aMs = Date.parse(a.event_date ?? "");
    const bMs = Date.parse(b.event_date ?? "");
    return (Number.isFinite(aMs) ? aMs : Number.MAX_SAFE_INTEGER) - (Number.isFinite(bMs) ? bMs : Number.MAX_SAFE_INTEGER)
      || a.event_id.localeCompare(b.event_id);
  });

  for (const event of sorted) {
    if (input.targetEventId === event.event_id) {
      exclusions.push(exclusion(event.event_id, "target_event_excluded"));
      continue;
    }
    if (event.source !== "native") {
      exclusions.push(exclusion(event.event_id, "non_native_event"));
      continue;
    }

    const state = input.statesByEventId[event.event_id];
    if (!state) {
      exclusions.push(exclusion(event.event_id, "actual_state_unavailable"));
      continue;
    }
    if (state.event.eventId !== event.event_id) {
      exclusions.push(exclusion(event.event_id, "event_identity_mismatch"));
      continue;
    }
    if (state.actualTruth.state !== "current") {
      exclusions.push(exclusion(event.event_id, "actual_not_current"));
      continue;
    }
    const revision = state.actualTruth.chosenRevision;
    if (!revision) {
      exclusions.push(exclusion(event.event_id, "chosen_revision_missing"));
      continue;
    }
    if (state.event.status !== "completed") {
      exclusions.push(exclusion(event.event_id, "event_not_completed"));
      continue;
    }
    if (revision.finality !== "final" && revision.finality !== "corrected") {
      exclusions.push(exclusion(event.event_id, "finality_not_final"));
      continue;
    }
    if (revision.scope !== "event_total") {
      exclusions.push(exclusion(event.event_id, "scope_not_event_total"));
      continue;
    }
    if (revision.sourceTimestampState !== "exact" || revision.sourceTimestamp === null) {
      exclusions.push(exclusion(event.event_id, "source_timestamp_not_exact"));
      continue;
    }
    let sourceTimestamp: { readonly iso: string; readonly ms: number };
    try {
      sourceTimestamp = instant(revision.sourceTimestamp, "sourceTimestamp");
    } catch {
      exclusions.push(exclusion(event.event_id, "source_timestamp_not_exact"));
      continue;
    }
    if (sourceTimestamp.ms > asOf.ms) {
      exclusions.push(exclusion(event.event_id, "source_timestamp_after_as_of"));
      continue;
    }
    let capturedAt: { readonly iso: string; readonly ms: number };
    try {
      if (typeof revision.capturedAt !== "string") throw new Error("capturedAt must be a string.");
      capturedAt = instant(revision.capturedAt, "capturedAt");
    } catch {
      exclusions.push(exclusion(event.event_id, "revision_captured_at_invalid"));
      continue;
    }
    if (capturedAt.ms > asOf.ms) {
      exclusions.push(exclusion(event.event_id, "revision_captured_after_as_of"));
      continue;
    }
    if (!event.event_date) {
      exclusions.push(exclusion(event.event_id, "event_date_unavailable"));
      continue;
    }
    let eventDate: { readonly iso: string; readonly ms: number };
    try {
      eventDate = instant(event.event_date, "event.event_date");
    } catch {
      exclusions.push(exclusion(event.event_id, "event_date_unavailable"));
      continue;
    }
    if (eventDate.ms >= asOf.ms) {
      exclusions.push(exclusion(event.event_id, "event_not_before_as_of"));
      continue;
    }
    if (state.dataQuality.unresolvedMismatch) {
      exclusions.push(exclusion(event.event_id, "unresolved_reconciliation"));
      continue;
    }
    if (state.actualTruth.sourceState && !TRUSTED_SOURCE_STATES.has(state.actualTruth.sourceState)) {
      exclusions.push(exclusion(event.event_id, "untrusted_source_state"));
      continue;
    }
    if (!TRUSTED_SOURCE_KINDS.has(revision.sourceKind)) {
      exclusions.push(exclusion(event.event_id, "untrusted_source_kind"));
      continue;
    }
    if (!TRUSTED_RECONCILIATION.has(revision.reconciliationStatus)) {
      exclusions.push(exclusion(event.event_id, "untrusted_reconciliation"));
      continue;
    }
    if (state.scoring.targetMetric !== null && state.scoring.targetMetric !== "entries") {
      exclusions.push(exclusion(event.event_id, "target_metric_incompatible"));
      continue;
    }
    const entriesMetric = revision.metrics.entries;
    if ((entriesMetric.availability !== "present" && entriesMetric.availability !== "explicit_zero")
      || entriesMetric.value === null || !Number.isSafeInteger(entriesMetric.value) || entriesMetric.value < 0) {
      exclusions.push(exclusion(event.event_id, "target_metric_unavailable"));
      continue;
    }

    // A historical fact became usable once both the source event and its capture existed.
    const availableAt = capturedAt.ms > sourceTimestamp.ms ? capturedAt.iso : sourceTimestamp.iso;
    events.push(trustedHistoryEvent(event, availableAt, entriesMetric.value));
  }

  return freezeDeep({
    version: TRUSTED_FORECAST_HISTORY_VERSION,
    asOfTs: asOf.iso,
    events,
    exclusions,
  });
}
