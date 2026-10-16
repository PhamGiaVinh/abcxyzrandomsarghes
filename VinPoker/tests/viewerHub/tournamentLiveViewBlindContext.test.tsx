import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ hand: true, staff: false }));
const realtime = vi.hoisted(() => ({
  listeners: [] as { filter: Record<string, string>; callback: () => void }[],
  reads: vi.fn(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "vi" } }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isStaffOps: fixture.staff, isClubAdmin: false }) }));
vi.mock("@/components/tracker/useTournamentTableAppearance", () => ({ useTournamentTableAppearance: () => ({ data: undefined }) }));
vi.mock("@/components/td-ai/TdAiAssistantPanel", () => ({ TdAiAssistantPanel: () => null }));
vi.mock("@/lib/tournamentParticipation", () => ({
  parseTournamentParticipation: () => ({ seats: [] }),
  parseParticipationSummary: () => ({ counts: { remaining: 0 }, averageStack: 0 }),
}));
vi.mock("@/components/cashier/tournament-live/loadLatestLiveHand", () => ({ loadLatestLiveHand: async () => { realtime.reads(); return ({ data: fixture.hand ? [{
  id: "frozen-hand", hand_number: 16, status: "completed", tracker_small_blind: 100000,
  tracker_big_blind: 200000, tracker_bba: 25000, tracker_level_number: 1, pot_size: 0,
}] : [], error: null }); } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: async (name: string) => ({ data: name === "get_tournament_clock" ? {
    is_running: false, remaining_seconds: 600,
    current_level: { level_number: 1, small_blind: 100, big_blind: 100, ante: 0 },
  } : null, error: null }),
  from: () => {
    type Method = "select" | "eq" | "order" | "in" | "single" | "limit";
    type Query = Promise<{ data: unknown[]; error: null }> & Record<Method, () => Query>;
    const query = Promise.resolve({ data: [], error: null }) as Query;
    for (const method of ["select", "eq", "order", "in", "single", "limit"] as const) query[method] = () => query;
    return query;
  },
  channel: () => { const channel = {
    on: (_event: string, filter: Record<string, string>, callback: () => void) => {
      realtime.listeners.push({ filter, callback }); return channel;
    },
    subscribe: () => channel,
  }; return channel; },
  removeChannel: vi.fn(),
} }));

import { TournamentLiveView } from "@/components/cashier/tournament-live/TournamentLiveView";

beforeEach(() => { fixture.staff = false; realtime.listeners = []; realtime.reads.mockClear(); vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
}); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("TournamentLiveView clock source labels", () => {
  it("refreshes legacy live data on exact-hand actions and ignores callbacks after cleanup", async () => {
    fixture.hand = true;
    const view = render(<TournamentLiveView tournamentId="test-tournament" />);
    await screen.findByText("Hand #16");
    const listener = realtime.listeners.find(({ filter }) => filter.table === "hand_actions");
    expect(listener?.filter.filter).toBe("hand_id=eq.frozen-hand");
    const before = realtime.reads.mock.calls.length;
    await act(async () => { listener!.callback(); });
    await waitFor(() => expect(realtime.reads.mock.calls.length).toBeGreaterThan(before));
    view.unmount();
    const after = realtime.reads.mock.calls.length;
    await act(async () => { listener!.callback(); });
    expect(realtime.reads).toHaveBeenCalledTimes(after);
  });

  it("lets the operator statistics row wrap without removing values or controls", async () => {
    fixture.hand = true;
    fixture.staff = true;
    render(<TournamentLiveView tournamentId="test-tournament" />);
    await screen.findByText("tournamentLive.liveView.currentTournamentClock");
    const statistics = screen.getByText(/AVG:/).parentElement;
    expect(statistics).toHaveClass("flex-wrap", "min-w-0");
    expect(screen.getByRole("button", { name: "tdAi.entry" })).toBeInTheDocument();
    expect(screen.getByText("Hand #16")).toBeInTheDocument();
    expect(screen.getByText(/100k\/200k/)).toBeInTheDocument();
  });
  it.each([true, false])("identifies current tournament clock independently of frozen hand (hand=%s)", async hand => {
    fixture.hand = hand;
    render(<TournamentLiveView tournamentId="test-tournament" />);
    await screen.findByText("tournamentLive.liveView.tableStats");
    expect(screen.getByText("tournamentLive.liveView.currentTournamentClock")).toBeInTheDocument();
    expect(screen.getByText("100/100")).toBeInTheDocument();
    if (hand) {
      expect(screen.getByText("tournamentLive.liveView.handBlindsContext")).toBeInTheDocument();
      expect(screen.getByText(/100k\/200k/)).toBeInTheDocument();
    } else {
      expect(screen.queryByText("tournamentLive.liveView.handBlindsContext")).not.toBeInTheDocument();
    }
  });
});
