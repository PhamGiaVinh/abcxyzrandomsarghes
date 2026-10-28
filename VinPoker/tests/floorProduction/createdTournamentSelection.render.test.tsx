import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCallback, useMemo, useState } from "react";

type ListQuery = {
  select: () => ListQuery; is: () => ListQuery; in: () => ListQuery; order: () => ListQuery;
  abortSignal: (signal: AbortSignal) => ListQuery;
  then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise<unknown>;
};
const state = vi.hoisted(() => ({ reads: vi.fn(), rpc: vi.fn(), channels: vi.fn(), removed: vi.fn(), pick: "new-tour" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => {
    const query: ListQuery = { select: () => query, is: () => query, in: () => query, order: () => query,
      abortSignal: () => query,
      then: (resolve, reject) => Promise.resolve().then(() => state.reads()).then(resolve, reject) };
    return query;
  },
  rpc: state.rpc,
  channel: (name: string) => { state.channels(name); const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: state.removed,
} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/components/floor/FloorTournamentsLanding", () => ({
  FloorTournamentsLanding: ({ onSelect }: { onSelect: (id: string) => void }) =>
    <button onClick={() => onSelect(state.pick)}>Vào tour TEST vừa tạo</button>,
}));
vi.mock("@/components/cashier/tournament-live/FloorTableMapPanel", () => ({
  FloorTableMapPanel: ({ tournament }: { tournament: { id: string } }) => <div>Bàn của {tournament.id}</div>,
}));
vi.mock("@/components/cashier/tournament-live/TrackerFloorAlertLane", () => ({ TrackerFloorAlertLane: () => null }));
vi.mock("@/components/cashier/tournament-live/CloseReportDialog", () => ({ default: () => null }));
import TournamentLivePanel from "@/components/cashier/TournamentLivePanel";

const scope = ["club"];
const clubs = [{ id: "club", name: "TEST" }];
const oldTour = { id: "old-tour", club_id: "club", name: "Old TEST", status: "live" };
const newTour = { id: "new-tour", club_id: "club", name: "New TEST", status: "active" };
beforeEach(() => {
  state.reads.mockReset(); state.channels.mockReset(); state.removed.mockReset(); state.pick = "new-tour";
  state.rpc.mockReset().mockImplementation((name: string, args: { p_tournament_id: string }) =>
    Promise.resolve(name === "get_tournament_participation_counts_v1" ? { data: {
      tournament_id: args.p_tournament_id, average_stack: 0,
      counts: { total_entries: 0, re_entries: 0, remaining: 0, seated: 0, waiting: 0, busted: 0,
        anomaly_entries: 0, anomaly_seats: 0, live_entry_stack: 0, seated_stack: 0, waiting_stack: 0 },
    }, error: null } : { data: null, error: { message: "Unexpected fixture RPC" } }));
});
afterEach(cleanup);

describe("Floor resolves a newly created tournament against the canonical server list", () => {
  it("keeps the real panel's list read and subscription stable during parent selection updates", async () => {
    state.pick = "old-tour";
    state.reads.mockResolvedValue({ data: [oldTour], error: null });
    function Parent() {
      const [selected, setSelected] = useState<string | null>(null);
      const stableScope = useMemo(() => clubs.map((club) => club.id), []);
      const onSelection = useCallback((id: string | null) => setSelected(id), []);
      return <><span data-testid="parent-selection">{selected}</span><TournamentLivePanel clubIds={stableScope} clubs={clubs} mode="floor" onSelectedTournamentChange={onSelection} /></>;
    }
    render(<Parent />);
    await waitFor(() => expect(state.reads).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Vào tour TEST vừa tạo" }));
    expect(await screen.findByText("Bàn của old-tour")).toBeVisible();
    expect(screen.getByTestId("parent-selection")).toHaveTextContent("old-tour");
    expect(state.reads).toHaveBeenCalledTimes(1);
    expect(state.channels).toHaveBeenCalledTimes(1);
    expect(state.channels).toHaveBeenCalledWith("tournament-live:old-tour");
    expect(state.removed).not.toHaveBeenCalled();
  });

  it("refreshes a missing selection and opens its operational tabs without reloading the page", async () => {
    state.reads.mockResolvedValueOnce({ data: [oldTour], error: null });
    let finish!: (value: unknown) => void;
    state.reads.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<TournamentLivePanel clubIds={scope} clubs={clubs} mode="floor" />);
    await waitFor(() => expect(state.reads).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Vào tour TEST vừa tạo" }));
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải giải đã chọn");
    await waitFor(() => expect(state.reads).toHaveBeenCalledTimes(2));
    await act(async () => { finish({ data: [newTour, oldTour], error: null }); });
    expect(await screen.findByText("Bàn của new-tour")).toBeVisible();
    expect(state.reads).toHaveBeenCalledTimes(2);
  });

  it("does not add a duplicate read for an already loaded tournament", async () => {
    state.pick = "old-tour";
    state.reads.mockResolvedValue({ data: [oldTour], error: null });
    render(<TournamentLivePanel clubIds={scope} clubs={clubs} mode="floor" />);
    await waitFor(() => expect(state.reads).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Vào tour TEST vừa tạo" }));
    expect(await screen.findByText("Bàn của old-tour")).toBeVisible();
    expect(state.reads).toHaveBeenCalledTimes(1);
  });

  it("shows an explicit read failure and retries the same selection", async () => {
    state.reads.mockResolvedValueOnce({ data: [oldTour], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "503 TEST" } })
      .mockResolvedValueOnce({ data: [newTour, oldTour], error: null });
    render(<TournamentLivePanel clubIds={scope} clubs={clubs} mode="floor" />);
    await waitFor(() => expect(state.reads).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Vào tour TEST vừa tạo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được giải đã chọn");
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Bàn của new-tour")).toBeVisible();
  });
});
