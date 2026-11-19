import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getDecisionEventState = vi.hoisted(() => vi.fn());
const createDecisionPacket = vi.hoisted(() => vi.fn());

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
    events: [{ id: "event-1", name: "Main Event", club_id: "club-1", start_time: "2026-08-08T03:00:00.000Z", status: "scheduled" }],
    snapshots: [],
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
  it("does not display scoring from a different club's response", async () => {
    getDecisionEventState.mockResolvedValue({ ok: true, value: {
      ...state, event: { ...state.event, clubId: "another-club" },
    } });
    render(<DecisionRoomV1 />);

    await waitFor(() => expect(getDecisionEventState).toHaveBeenCalledWith("event-1"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByTestId("decision-room-scoring")).not.toBeInTheDocument();
  });

  it("renders an honest no-data state without fabricating a score or outcome", async () => {
    getDecisionEventState.mockResolvedValue({ ok: true, value: state });
    render(<DecisionRoomV1 />);

    await waitFor(() => expect(screen.getByTestId("decision-room-v1")).toBeInTheDocument());
    expect(screen.getByText("Chưa có kết quả")).toBeInTheDocument();
    expect(screen.getByText(/Chưa có bản ghi kết quả thật/)).toBeInTheDocument();
    expect(screen.getByText(/Room không tự tính điểm/)).toBeInTheDocument();
    expect(screen.queryByText(/probability|khuyến nghị|tối ưu/i)).toBeNull();
  });

  it("exposes an append-only correction flow and labels superseded packets", async () => {
    const frozenPacket = {
      packetId: "packet-frozen",
      horizon: "T-7" as const,
      targetMetric: "entries" as const,
      packetState: "frozen" as const,
      asOfTs: "2026-08-07T00:00:00.000Z",
      sourceCutoff: "2026-08-06T23:59:59.000Z",
      forecastSnapshotId: null,
      forecastState: "no_forecast_available" as const,
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
      correctionReason: "Sửa lại thông tin đã chốt.",
      horizon: "T-7",
    })));
  });
});
