import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ readTour: vi.fn(), readOrdered: vi.fn(), rpc: vi.fn(), client: {} as any }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => state.client }));
vi.mock("@/hooks/useLiveClock", () => ({ useLiveClock: () => 0 }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { tvLayoutEditorV1: false } }));
import { useTournamentTvDataCore } from "./useTournamentTvDataCore";
const a = "f7280000-0000-4000-8000-000000000003";
const b = "f7280000-0000-4000-8000-000000000004";
const counts = { total_entries: 8, re_entries: 2, remaining: 6, seated: 4, waiting: 2, busted: 2,
  anomaly_entries: 0, anomaly_seats: 0, live_entry_stack: 120000, seated_stack: 80000, waiting_stack: 40000 };
const tourRow = (id: string) => ({ data: { name: id, status: "live", players_remaining: 99, average_stack: 123,
  prize_pool: 0, starting_stack: 20000, guarantee_amount: 0, buy_in: 0, rake_amount: 0, club: null }, error: null });
beforeEach(() => {
  vi.clearAllMocks();
  state.readTour.mockImplementation((id: string) => Promise.resolve(tourRow(id)));
  state.readOrdered.mockImplementation(() => Promise.resolve({ data: [], error: null }));
  state.rpc.mockImplementation((name: string, args: { p_tournament_id: string }) => Promise.resolve(name === "get_tournament_clock"
    ? { data: { remaining_seconds: 600, is_running: false }, error: null }
    : { data: { tournament_id: args.p_tournament_id, counts, average_stack: 20000 }, error: null }));
  state.client = {
    rpc: state.rpc,
    from: (table: string) => {
      let id = ""; let columns = "";
      const chain: any = { select: (c: string) => { columns = c; return chain; },
        eq: (key: string, value: string) => { if (key === "id" || key === "tournament_id") id = value; return chain; },
        order: () => state.readOrdered(table, id),
        maybeSingle: () => columns === "satellite_payout" ? Promise.resolve({ data: null, error: null }) : state.readTour(id),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
      if (table === "tournament_seats") throw new Error("TV must not count seat history");
      return chain;
    },
    channel: () => { const channel: any = { on: () => channel, subscribe: () => channel }; return channel; },
    removeChannel: vi.fn(),
  };
});
afterEach(cleanup);
describe("TV canonical participation and scope", () => {
  it("uses entry aggregates rather than stored counters/seat history", async () => {
    const { result } = renderHook(() => useTournamentTvDataCore(a, { userId: "owner", authLoading: false }));
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(state.rpc).toHaveBeenCalledWith("get_tournament_participation_counts_v1", { p_tournament_id: a });
    expect(JSON.stringify(result.current.data)).not.toContain('"playersRemaining":99');
    expect(result.current.data?.totalEntries).toBe(8);
    expect(result.current.data?.reEntries).toBe(2);
    expect(result.current.data?.totalChips).toBe(120000);
  });
  it("does not report ready when participation read fails", async () => {
    state.rpc.mockImplementation((name: string) => Promise.resolve(name === "get_tournament_clock"
      ? { data: { remaining_seconds: 600 }, error: null } : { data: null, error: { message: "503" } }));
    const { result } = renderHook(() => useTournamentTvDataCore(a, { userId: "owner", authLoading: false }));
    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.data).toBeNull();
  });
  it.each(["tournament_levels", "tournament_prizes"])("does not turn a failed %s read into an empty ready display", async (failedTable) => {
    state.readOrdered.mockImplementation((table: string) => Promise.resolve(table === failedTable
      ? { data: null, error: { message: "503 temporary read failure" } }
      : { data: [], error: null }));
    const { result } = renderHook(() => useTournamentTvDataCore(a, { userId: "owner", authLoading: false }));
    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.data).toBeNull();
    // Successful empty is valid; only unavailable must be distinguished.
    state.readOrdered.mockImplementation(() => Promise.resolve({ data: [], error: null }));
    await act(async () => result.current.refetch());
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.data?.totalChips).toBe(120000);
    expect(result.current.data?.playersRemaining).toBe(6);
    state.readOrdered.mockImplementation((table: string) => Promise.resolve(table === failedTable
      ? { data: null, error: { message: "refresh unavailable" } } : { data: [], error: null }));
    await act(async () => result.current.refetch());
    expect(result.current.state).toBe("error");
    // Last-good data belongs to the same scope, never a fabricated zero.
    expect(result.current.data?.totalChips).toBe(120000);
    state.readOrdered.mockImplementation(() => Promise.resolve({ data: [], error: null }));
    await act(async () => result.current.refetch());
    expect(result.current.state).toBe("ready");
  });
  it("ignores delayed old tournament response", async () => {
    let resolveA!: (v: unknown) => void;
    state.readTour.mockImplementation((id: string) => id === a ? new Promise((resolve) => { resolveA = resolve; }) : Promise.resolve(tourRow(id)));
    const { result, rerender } = renderHook(({ id }) => useTournamentTvDataCore(id, { userId: "owner", authLoading: false }), { initialProps: { id: a } });
    await waitFor(() => expect(state.readTour).toHaveBeenCalledWith(a));
    rerender({ id: b });
    await waitFor(() => expect(result.current.state).toBe("ready"));
    await act(async () => resolveA(tourRow(a)));
    expect(result.current.data?.tournamentName).toBe(b);
  });
  it("discards a response from the previous signed-in account in the same tour", async () => {
    let resolveOld!: (v: unknown) => void;
    state.readTour.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { result, rerender } = renderHook(({ userId }) => useTournamentTvDataCore(a, { userId, authLoading: false }),
      { initialProps: { userId: "owner-a" } });
    await waitFor(() => expect(state.readTour).toHaveBeenCalledOnce());
    rerender({ userId: "owner-b" });
    await waitFor(() => expect(result.current.state).toBe("ready"));
    await act(async () => resolveOld({ ...tourRow(a), data: { ...tourRow(a).data, name: "OLD ACCOUNT" } }));
    expect(result.current.data?.tournamentName).toBe(a);
  });
});
