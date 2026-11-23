import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getDecisionEventState = vi.hoisted(() => vi.fn());
const createDecisionPacket = vi.hoisted(() => vi.fn());
const fixtureEvents = vi.hoisted(() => ({ rows: [{ id: "event-1", name: "Main Event", club_id: "club-1", start_time: "2026-08-08T03:00:00.000Z", status: "scheduled" }] }));
const originalEvents = fixtureEvents.rows;
const snapshots = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("@/lib/series-intelligence/decisionPacketRpc", () => ({
  createDecisionPacket,
  freezeDecisionPacket: vi.fn(),
  getDecisionEventState,
  promoteNativeEventActual: vi.fn(),
  reconcileEventActual: vi.fn(),
  recordEventActual: vi.fn(),
}));

vi.mock("@/lib/series-intelligence/useSeriesCapture", () => ({
  useSeriesCapture: () => ({
    loading: false,
    saving: false,
    clubs: [{ id: "club-1", name: "Club test" }],
    clubId: "club-1",
    setClubId: vi.fn(),
    events: fixtureEvents.rows,
    snapshots,
    decisions: [],
    campaigns: [],
    registrations: [],
    reload: vi.fn(),
    insertForecast: vi.fn(),
    insertDecision: vi.fn(),
    updateDecision: vi.fn(),
    insertCampaign: vi.fn(),
    updateCampaign: vi.fn(),
    insertRegistration: vi.fn(),
  }),
}));

import { DecisionRoomV1 } from "./DecisionRoomV1";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  snapshots.length = 0;
  fixtureEvents.rows = originalEvents;
});

const state = {
  version: "series-decision-event-state-v1" as const,
  event: { eventId: "event-1", clubId: "club-1", status: "scheduled", targetEventTs: "2026-08-08T03:00:00.000Z" },
  decisionPackets: [],
  actualTruth: { state: "unavailable" as const, reason: "no_revision" as const },
  scoring: { candidatePacketId: null, candidateActualRevisionId: null, targetMetric: null, eligibility: "blocked" as const, blockReasons: ["no_actual_revision"] },
  dataQuality: { legacyActualCacheAvailable: false, d2aRevisionAvailable: false, unresolvedMismatch: false, missingFields: [], unsupportedDerivationWarnings: [] },
};

describe("DecisionRoomV1", () => {
  it("renders an honest no-data state without fabricating a score or outcome", async () => {
    getDecisionEventState.mockResolvedValue({ ok: true, value: state });
    render(<DecisionRoomV1 />);

    await waitFor(() => expect(screen.getByTestId("decision-room-v1")).toBeInTheDocument());
    expect(screen.getByText("Chưa có kết quả")).toBeInTheDocument();
    expect(screen.getByText(/Chưa có bản ghi kết quả thật/)).toBeInTheDocument();
    expect(screen.getByText(/Chưa có điểm đối chiếu/)).toBeInTheDocument();
    expect(screen.queryByText(/probability|khuyến nghị|tối ưu/i)).toBeNull();
  });

  it("attaches a matching forecast that was saved before the event and skips a backdated import", async () => {
    const valid = {
      id: "forecast-valid", club_id: "club-1", event_id: "event-1", horizon: "T-7",
      target_event_ts: "2026-08-08T03:00:00.000Z",
      as_of_ts: "2026-08-01T02:00:00.000Z",
      forecast_issued_at: "2026-08-01T02:01:00.000Z",
      created_at: "2026-08-01T02:02:00.000Z",
      forecast_identity_eligible: true, provenance_completeness: "complete",
    };
    snapshots.push({ ...valid, id: "late", created_at: "2026-08-09T03:00:00.000Z" });
    snapshots.push({ ...valid, id: "wrong-club", club_id: "club-2" }, valid);
    getDecisionEventState.mockResolvedValue({ ok: true, value: state });
    createDecisionPacket.mockResolvedValue({ ok: true, value: { id: "draft" } });
    render(<DecisionRoomV1 />);
    fireEvent.click(await screen.findByTestId("decision-room-create-packet"));
    await waitFor(() => expect(createDecisionPacket).toHaveBeenCalledWith(expect.objectContaining({
      forecastSnapshotId: valid.id,
      forecastState: "forecast_identity_eligible",
      sourceCutoff: valid.as_of_ts,
    })));
  });
  it("keeps the current event result when an earlier response arrives late", async () => {
    let finishOld!: (response: unknown) => void;
    const oldRequest = new Promise((resolve) => { finishOld = resolve; });
    getDecisionEventState.mockImplementation((id) => id === "event-1" ? oldRequest : Promise.resolve({
      ok: true,
      value: { ...state, event: { ...state.event, eventId: "event-2" }, scoring: {
        ...state.scoring, blockReasons: ["actual_scope_mismatch"],
      } },
    }));
    const page = render(<DecisionRoomV1 />);
    await waitFor(() => expect(getDecisionEventState).toHaveBeenCalledWith("event-1"));
    fixtureEvents.rows = [{ ...fixtureEvents.rows[0], id: "event-2", name: "Next Event" }];
    page.rerender(<DecisionRoomV1 />);
    const current = await screen.findByText(/Phạm vi kết quả không phải toàn giải/);
    await act(async () => finishOld({ ok: true, value: state }));
    expect(current).toBeInTheDocument();
  });
  it("shows error only for the matched frozen forecast and server-selected actual", async () => {
    snapshots.push({
      id: "scoring-snapshot", club_id: "club-1", event_id: "event-1",
      as_of_ts: "2026-08-01T02:00:00.000Z", forecast_issued_at: "2026-08-01T03:00:00.000Z",
      forecast_identity_eligible: true, provenance_completeness: "complete",
      forecast_base: 33, forecast_low: 23, forecast_high: 43,
      provenance_kind: "engine", engine_version: "v1", predictor_id: "predictor",
    });
    getDecisionEventState.mockResolvedValue({ ok: true, value: {
      ...state,
      decisionPackets: [{
        packetId: "packet", packetState: "frozen", forecastSnapshotId: "scoring-snapshot",
        horizon: "T-7", targetMetric: "entries", forecastState: "forecast_identity_eligible",
        asOfTs: "2026-08-01T03:01:00.000Z", sourceCutoff: "2026-08-01T02:00:00.000Z",
        frozenAt: "2026-08-01T03:02:00.000Z", contentHash: "packet-hash", supersedesPacketId: null,
      }],
      actualTruth: { state: "current", chosenRevision: {
        revisionId: "result", scope: "event_total", finality: "final", sourceKind: "native_tournament_system",
        sourceTimestampState: "exact", sourceTimestamp: "2026-08-09T00:00:00.000Z",
        capturedAt: "2026-08-09T00:01:00.000Z", contentHash: "actual-hash", correctionReason: null,
        reconciliationStatus: "auto_only", metrics: { entries: { value: 35, availability: "present" } },
      } },
      scoring: { candidatePacketId: "packet", candidateActualRevisionId: "result", targetMetric: "entries",
        eligibility: "eligible", blockReasons: [] },
    } });
    render(<DecisionRoomV1 />);
    const evaluation = await screen.findByTestId("decision-room-evaluation");
    expect(evaluation).toHaveTextContent("Dự báo lượt mua33");
    expect(evaluation).toHaveTextContent("Kết quả đã đối chiếu35");
    expect(evaluation).toHaveTextContent("Sai số tuyệt đối2");
  });
  it("exposes an append-only correction flow and labels superseded packets", async () => {
    const frozenPacket = {
      packetId: "packet-frozen",
      horizon: "T-7" as const,
      targetMetric: "entries" as const,
      packetState: "frozen" as const,
      asOfTs: "2026-08-07T00:00:00.000Z",
      sourceCutoff: "2026-08-06T23:59:59.000Z",
      forecastSnapshotId: "forecast-locked",
      forecastState: "forecast_identity_eligible" as const,
      contentHash: "hash-frozen",
      frozenAt: "2026-08-07T00:00:01.000Z",
      supersedesPacketId: null,
    };
    const currentFrozen = {
      ...frozenPacket,
      packetId: "packet-current",
      contentHash: "hash-current",
      frozenAt: "2026-08-07T00:00:02.000Z",
      supersedesPacketId: "packet-frozen",
    };
    getDecisionEventState.mockResolvedValue({ ok: true, value: { ...state, decisionPackets: [frozenPacket, currentFrozen] } });
    createDecisionPacket.mockResolvedValue({ ok: true, value: { id: "packet-correction", schema_version: "series-decision-packet-v1" } });
    render(<DecisionRoomV1 />);

    await waitFor(() => expect(screen.getByTestId("decision-room-correction")).toBeInTheDocument());
    expect(screen.getByText("Đã được thay thế")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("decision-room-correction"));
    fireEvent.change(screen.getByTestId("decision-room-correction-reason"), { target: { value: "Sửa lại thông tin đã chốt." } });
    fireEvent.click(screen.getByTestId("decision-room-create-packet"));

    await waitFor(() => expect(createDecisionPacket).toHaveBeenCalledWith(expect.objectContaining({
      supersedesPacketId: "packet-current",
      forecastSnapshotId: "forecast-locked",
      asOfTs: currentFrozen.asOfTs,
      sourceCutoff: currentFrozen.sourceCutoff,
      correctionReason: "Sửa lại thông tin đã chốt.",
      horizon: "T-7",
    })));
  });
});
