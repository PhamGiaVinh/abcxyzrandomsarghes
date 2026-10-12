import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

type QueryFixture = {
  select: () => QueryFixture; is: () => QueryFixture; in: () => QueryFixture; order: () => QueryFixture;
  then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
};
type ChannelFixture = {
  on: (event: string, filter: { table: string }, callback: () => void) => ChannelFixture;
  subscribe: () => ChannelFixture;
};

const db = vi.hoisted(() => ({ rpc: vi.fn(), actor: "owner", status: "live", liveStatus: null as string | null,
  callbacks: new Map<string, () => void>() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: db.actor } }) }));
vi.mock("react-i18next", async () => {
  const { default: viLocale } = await import("@/i18n/locales/vi.json");
  return { useTranslation: () => ({ t: (key: string) => key.startsWith("tournamentLive.statusLabels.")
    ? viLocale.tournamentLive.statusLabels[key.split(".").at(-1) as keyof typeof viLocale.tournamentLive.statusLabels] : key }) };
});
vi.mock("@/lib/featureFlags", () => ({ FEATURES: {} }));
vi.mock("@/components/tracker/TableAppearanceEditor", () => ({ TableAppearanceEditor: () => null }));
vi.mock("./tournament-live/ClockPanel", () => ({ ClockPanel: () => null }));
vi.mock("./tournament-live/handinput/unified/TrackerHandInputBoundary", () => ({ TrackerHandInputBoundary: () => null }));
vi.mock("./tournament-live/LeaderboardPanel", () => ({ LeaderboardPanel: () => null }));
vi.mock("./tournament-live/PlayersGroupedPanel", () => ({ PlayersGroupedPanel: () => null }));
vi.mock("./tournament-live/BlindEditorPanel", () => ({ BlindEditorPanel: () => null }));
vi.mock("./tournament-live/FloorTableMapPanel", () => ({ FloorTableMapPanel: () => null }));
vi.mock("./tournament-live/PrizesTab", () => ({ PrizesTab: () => null }));
vi.mock("./tournament-live/TournamentLiveView", () => ({ TournamentLiveView: () => null }));
vi.mock("./tournament-live/HandHistoryPanel", () => ({ HandHistoryPanel: () => null }));
vi.mock("./tournament-live/RegistrationQueuePanel", () => ({ RegistrationQueuePanel: () => null }));
vi.mock("./tournament-live/TrackerFloorAlertLane", () => ({ TrackerFloorAlertLane: () => null }));
vi.mock("./tournament-live/TvDisplaysPanel", () => ({ TvDisplaysPanel: () => null }));
vi.mock("@/components/td-ai/TdAiTabPanel", () => ({ TdAiTabPanel: () => null }));
vi.mock("./tournament-live/CloseReportDialog", () => ({ default: () => null }));
vi.mock("@/components/floor/FloorTournamentsLanding", () => ({ FloorTournamentsLanding: ({ onSelect }: { onSelect: (id: string) => void }) =>
  <button onClick={() => onSelect("a")}>select-a</button> }));
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const Context = React.createContext<(id: string) => void>(() => {});
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Select: ({ children, onValueChange }: { children?: ReactNode; onValueChange: (id: string) => void }) => <Context.Provider value={onValueChange}>{children}</Context.Provider>,
    SelectContent: Wrapper, SelectTrigger: Wrapper, SelectValue: Wrapper,
    SelectItem: ({ children, value }: { children?: ReactNode; value: string }) => {
      const select = React.useContext(Context);
      return <button onClick={() => select(value)}>{children}</button>;
    } };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: db.rpc,
  from: () => {
    const query: QueryFixture = { select: () => query, is: () => query, in: () => query,
      order: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: ["a", "b"].map((id) => ({ id, name: `Tour ${id}`, club_id: "club",
        status: db.status, live_status: db.liveStatus, players_remaining: 99, average_stack: 123 })), error: null }).then(resolve) };
    return query;
  },
  channel: () => {
    const channel: ChannelFixture = { on: (_event: string, filter: { table: string }, callback: () => void) => {
      db.callbacks.set(filter.table, callback); return channel;
    }, subscribe: () => channel };
    return channel;
  }, removeChannel: vi.fn(),
} }));
import TournamentLivePanel from "./TournamentLivePanel";
const payload = (id: string, remaining = 8) => ({ tournament_id: id, average_stack: 9750000,
  counts: { total_entries: 11, re_entries: 0, remaining, seated: 8, waiting: 0, busted: 3,
    anomaly_entries: 0, anomaly_seats: 0, live_entry_stack: 78000000, seated_stack: 78000000, waiting_stack: 0 } });
const props = { clubIds: ["club"], clubs: [{ id: "club", name: "Club" }], mode: "floor" as const };
beforeEach(() => { db.rpc.mockReset(); db.callbacks.clear(); db.actor = "owner"; db.status = "live"; db.liveStatus = null;
  db.rpc.mockImplementation((_name, args) => Promise.resolve({ data: payload(args.p_tournament_id), error: null })); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Floor selected-tour canonical summary integration", () => {
  it("displays registering from the server rather than treating catalog active as playing", async () => {
    db.status = "active"; db.liveStatus = "registering";
    render(<TournamentLivePanel {...props} />);
    await screen.findByRole("button", { name: /Tour a.*Đang đăng ký/ });
    fireEvent.click(screen.getByRole("button", { name: "select-a" }));
    await waitFor(() => expect(screen.getByText(/playersRemaining.*8/)).toBeInTheDocument());
    expect(screen.getAllByText(/Đang đăng ký/)).toHaveLength(3);
    expect(screen.queryByText("Đang chơi")).not.toBeInTheDocument();
    expect(db.rpc.mock.calls.every(([name]) => name === "get_tournament_participation_counts_v1")).toBe(true);
  });
  it.each([
    ["active", "playing", "Đang chơi"],
    ["active", "paused", "Tạm dừng"],
    ["active", null, "Đang hoạt động"],
    ["active", "", "Chưa xác định"],
    ["completed", "playing", "Đã kết thúc"],
    ["cancelled", "playing", "Đã hủy"],
  ])("renders catalog=%s/live=%s honestly", async (status, liveStatus, label) => {
    db.status = status!; db.liveStatus = liveStatus;
    render(<TournamentLivePanel {...props} />);
    await screen.findByRole("button", { name: new RegExp(`Tour a.*${label}`) });
    fireEvent.click(screen.getByRole("button", { name: "select-a" }));
    await waitFor(() => expect(screen.getByText(/playersRemaining.*8/)).toBeInTheDocument());
    expect(screen.getAllByText(new RegExp(label!))).toHaveLength(3);
  });
  it("uses canonical participation on Tracker selection cards rather than stored tournament counters", async () => {
    render(<TournamentLivePanel {...props} mode="tracker" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Tour a.*8.*9.750.000/ })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Tour a.*99.*123/ })).not.toBeInTheDocument();
  });
  it("never substitutes stored counters when an overview read fails and clears cards outside the current club", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "503" } });
    const { rerender } = render(<TournamentLivePanel {...props} mode="tracker" />);
    await waitFor(() => expect(screen.getAllByRole("status").filter((node) => node.textContent === "common.participationUnavailable")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: /Tour a.*99.*123/ })).not.toBeInTheDocument();
    await act(async () => rerender(<TournamentLivePanel {...props} mode="tracker" clubIds={["other"]} />));
    expect(screen.queryByRole("button", { name: /Tour a.*common.participationUnavailable/ })).not.toBeInTheDocument();
  });
  it("renders canonical counts and never stale counters after picker/club changes", async () => {
    const { rerender } = render(<TournamentLivePanel {...props} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "select-a" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "select-a" }));
    await waitFor(() => expect(screen.getByText(/playersRemaining.*8/)).toBeInTheDocument());
    expect(screen.queryByText(/playersRemaining.*99/)).not.toBeInTheDocument();
    let resolveB!: (value: unknown) => void;
    db.rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: /Tour b/ }));
    expect(screen.queryByText(/playersRemaining.*8/)).not.toBeInTheDocument();
    await act(async () => resolveB({ data: payload("b", 2), error: null }));
    await waitFor(() => expect(screen.getByText(/playersRemaining.*2/)).toBeInTheDocument());
    await act(async () => { rerender(<TournamentLivePanel {...props} clubIds={["other"]} />); });
    expect(screen.queryByText(/playersRemaining.*2/)).not.toBeInTheDocument();
  });
  it("coalesces entry events and exposes failed refresh without cached fallback", async () => {
    render(<TournamentLivePanel {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "select-a" }));
    await waitFor(() => expect(screen.getByText(/playersRemaining.*8/)).toBeInTheDocument());
    db.rpc.mockResolvedValue({ data: null, error: { message: "503" } });
    const before = db.rpc.mock.calls.length;
    act(() => { for (let i = 0; i < 20; i++) db.callbacks.get("tournament_entries")!(); });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("common.participationUnavailable"));
    expect(db.rpc.mock.calls.length).toBe(before + 1);
    expect(screen.queryByText(/playersRemaining.*8/)).not.toBeInTheDocument();
    expect(screen.queryByText(/playersRemaining.*99/)).not.toBeInTheDocument();
  });
  it("does not postpone refresh indefinitely under a continuous event stream", async () => {
    render(<TournamentLivePanel {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "select-a" }));
    await waitFor(() => expect(screen.getByText(/playersRemaining.*8/)).toBeInTheDocument());
    const before = db.rpc.mock.calls.length;
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        db.callbacks.get("tournament_entries")!();
        await vi.advanceTimersByTimeAsync(90);
      });
    }
    expect(db.rpc.mock.calls.length).toBeGreaterThanOrEqual(before + 2);
    expect(screen.getByText(/playersRemaining.*8/)).toBeInTheDocument();
  });
});
