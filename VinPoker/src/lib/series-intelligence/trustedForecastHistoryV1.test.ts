import { describe, expect, it } from "vitest";
import type { DecisionEventStateResponse } from "./decisionPacketRuntimeTypes";
import type { SeriesEvent } from "./nativeData";
import { buildTrustedForecastHistoryV1 } from "./trustedForecastHistoryV1";

const AS_OF = "2026-08-01T00:00:00.000Z";

function count(value: number | null) {
  return { availability: value === null ? "missing" as const : value === 0 ? "explicit_zero" as const : "present" as const, value };
}

function state(eventId: string, overrides: Partial<{
  status: string;
  actualState: "unavailable" | "current" | "needs_reconciliation" | "conflict";
  sourceState: "auto_only" | "manual_only" | "reconciled";
  finality: "partial" | "provisional" | "final" | "corrected" | "conflicting" | "void";
  scope: "event_total" | "flight_only" | "day_total" | "series_total" | "partial_result" | "unknown";
  sourceTimestamp: string | null;
  sourceTimestampState: "exact" | "not_reported";
  capturedAt: string;
  reconciliationStatus: "auto_only" | "manual_only" | "matching" | "mismatch" | "manually_reconciled" | "blocked_conflict";
  entries: number | null;
  sourceKind: "native_tournament_system" | "auto_capture" | "owner_manual" | "reconciled" | "legacy_decision_log" | "import_verified";
  targetMetric: "entries" | "unique_players" | "total_bullets" | null;
  unresolvedMismatch: boolean;
}> = {}): DecisionEventStateResponse {
  const sourceTimestamp = overrides.sourceTimestamp === undefined ? "2026-07-02T00:00:00.000Z" : overrides.sourceTimestamp;
  return {
    version: "series-decision-event-state-v1",
    event: { eventId, clubId: "club-1", status: overrides.status ?? "completed", targetEventTs: "2026-07-01T00:00:00.000Z" },
    decisionPackets: [],
    actualTruth: {
      state: overrides.actualState ?? "current",
      sourceState: overrides.sourceState ?? "auto_only",
      chosenRevision: {
        revisionId: `${eventId}-revision`,
        scope: overrides.scope ?? "event_total",
        finality: overrides.finality ?? "final",
        sourceKind: overrides.sourceKind ?? "native_tournament_system",
        sourceTimestampState: overrides.sourceTimestampState ?? "exact",
        sourceTimestamp,
        capturedAt: overrides.capturedAt ?? "2026-07-02T00:01:00.000Z",
        reconciliationStatus: overrides.reconciliationStatus ?? "auto_only",
        metrics: {
          entries: count(overrides.entries === undefined ? 120 : overrides.entries),
          uniquePlayers: count(90),
          totalBullets: count(120),
          reentries: count(30),
          registrationRecords: count(120),
          paidPlaces: count(18),
          prizePool: { availability: "missing", amountMinor: null, currency: null, scale: null },
          overlay: { availability: "missing", amountMinor: null, currency: null, scale: null },
        },
        supersedesRevisionId: null,
        reconcilesAutoRevisionId: null,
        reconcilesManualRevisionId: null,
        contentHash: `${eventId}-content`,
        correctionReason: null,
      },
    },
    scoring: {
      candidatePacketId: null,
      candidateActualRevisionId: null,
      targetMetric: overrides.targetMetric === undefined ? "entries" : overrides.targetMetric,
      eligibility: "blocked",
      blockReasons: [],
    },
    dataQuality: {
      legacyActualCacheAvailable: false,
      d2aRevisionAvailable: true,
      unresolvedMismatch: overrides.unresolvedMismatch ?? false,
      missingFields: [],
      unsupportedDerivationWarnings: [],
    },
  };
}

function event(eventId: string, overrides: Partial<SeriesEvent> = {}): SeriesEvent {
  return {
    event_id: eventId,
    event_name: "Main Event",
    event_date: "2026-07-01T00:00:00.000Z",
    buy_in: 1_000_000,
    fee: 100_000,
    serviceFeeAmount: 0,
    gtd: 10_000_000,
    prize_pool_actual: 99_000_000,
    total_entries: 999,
    unique_entries: 800,
    reentries: 199,
    source: "native",
    clubId: "club-1",
    missingFields: [],
    ...overrides,
  };
}

describe("trusted D2B forecast history adapter", () => {
  it("uses final exact D2B entries and not the native current count", () => {
    const result = buildTrustedForecastHistoryV1({ asOfTs: AS_OF, events: [event("final")], statesByEventId: { final: state("final", { entries: 123 }) } });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ event_id: "final", total_entries: 123, prize_pool_actual: null, outcome_available_at: "2026-07-02T00:01:00.000Z" });
  });

  it("includes a current corrected revision with compatible reconciliation", () => {
    const result = buildTrustedForecastHistoryV1({
      asOfTs: AS_OF,
      events: [event("corrected")],
      statesByEventId: { corrected: state("corrected", { finality: "corrected", reconciliationStatus: "manually_reconciled", sourceState: "reconciled", sourceKind: "reconciled" }) },
    });
    expect(result.events.map((item) => item.event_id)).toEqual(["corrected"]);
  });

  it("excludes a revision captured after the historical as-of even when its source is older", () => {
    const result = buildTrustedForecastHistoryV1({
      asOfTs: AS_OF,
      events: [event("captured-late")],
      statesByEventId: { "captured-late": state("captured-late", { capturedAt: "2026-08-02T00:00:00.000Z" }) },
    });
    expect(result.events).toEqual([]);
    expect(result.exclusions).toEqual([{ eventId: "captured-late", code: "revision_captured_after_as_of" }]);
  });

  it("accepts a revision captured exactly at the historical as-of", () => {
    const result = buildTrustedForecastHistoryV1({
      asOfTs: AS_OF,
      events: [event("captured-at-cutoff")],
      statesByEventId: { "captured-at-cutoff": state("captured-at-cutoff", { capturedAt: AS_OF }) },
    });
    expect(result.events.map((item) => item.event_id)).toEqual(["captured-at-cutoff"]);
  });

  it("fails closed for malformed or missing capturedAt", () => {
    const malformed = state("malformed-captured", { capturedAt: "not-an-instant" });
    const missing = state("missing-captured");
    delete (missing.actualTruth.chosenRevision as unknown as Record<string, unknown>).capturedAt;
    const result = buildTrustedForecastHistoryV1({
      asOfTs: AS_OF,
      events: [event("malformed-captured"), event("missing-captured")],
      statesByEventId: { "malformed-captured": malformed, "missing-captured": missing },
    });
    expect(result.events).toEqual([]);
    expect(result.exclusions).toEqual([
      { eventId: "malformed-captured", code: "revision_captured_at_invalid" },
      { eventId: "missing-captured", code: "revision_captured_at_invalid" },
    ]);
  });

  it("allows a promoted actual in a future forecast after its capture boundary", () => {
    const result = buildTrustedForecastHistoryV1({
      asOfTs: "2026-08-03T00:00:00.000Z",
      events: [event("future-cutoff")],
      statesByEventId: { "future-cutoff": state("future-cutoff", { capturedAt: "2026-08-02T00:00:00.000Z" }) },
    });
    expect(result.events).toMatchObject([{ event_id: "future-cutoff", outcome_available_at: "2026-08-02T00:00:00.000Z" }]);
  });

  it.each([
    ["missing actual", "missing", state("missing", { actualState: "unavailable" })],
    ["provisional", "provisional", state("provisional", { finality: "provisional" })],
    ["source after as-of", "late", state("late", { sourceTimestamp: "2026-08-02T00:00:00.000Z" })],
    ["partial scope", "partial", state("partial", { scope: "partial_result" })],
    ["unresolved mismatch", "mismatch", state("mismatch", { unresolvedMismatch: true })],
    ["manual-only source", "manual", state("manual", { sourceState: "manual_only", sourceKind: "owner_manual" })],
    ["wrong target metric", "wrong-target", state("wrong-target", { targetMetric: "unique_players" })],
    ["missing entries", "no-entries", state("no-entries", { entries: null })],
  ] as const)("fails closed for %s", (_label, id, actual) => {
    const result = buildTrustedForecastHistoryV1({ asOfTs: AS_OF, events: [event(id)], statesByEventId: { [id]: actual } });
    expect(result.events).toEqual([]);
    expect(result.exclusions[0]?.eventId).toBe(id);
  });

  it("excludes the target event even if native metadata has a past outcome", () => {
    const result = buildTrustedForecastHistoryV1({ asOfTs: AS_OF, targetEventId: "target", events: [event("target")], statesByEventId: { target: state("target") } });
    expect(result.exclusions).toEqual([{ eventId: "target", code: "target_event_excluded" }]);
  });

  it("is deterministic and deeply immutable", () => {
    const input = { asOfTs: AS_OF, events: [event("b"), event("a")], statesByEventId: { a: state("a"), b: state("b") } };
    const first = buildTrustedForecastHistoryV1(input);
    const second = buildTrustedForecastHistoryV1(input);
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.events)).toBe(true);
    expect(Object.isFrozen(first.events[0])).toBe(true);
    expect(() => (first.events as SeriesEvent[]).push(event("forbidden"))).toThrow();
  });
});
