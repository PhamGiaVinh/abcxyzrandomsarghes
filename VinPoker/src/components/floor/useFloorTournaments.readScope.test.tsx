import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ read: vi.fn(), metaRead: vi.fn(), multiDay: false, actor: "owner", loading: false, invoke: vi.fn(), rpc: vi.fn(), error: vi.fn(), events: [] as Array<() => void> }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.actor ? { id: state.actor } : null, loading: state.loading }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (s: string) => s }) }));
vi.mock("sonner", () => ({ toast: { error: state.error, success: vi.fn() } }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { get multiDayTournaments() { return state.multiDay; } } }));
vi.mock("./TournamentManagerShared", () => ({ flightEntrants: vi.fn(), qualifierTarget: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    let clubs: string[] = [];
    const query = { select: () => query, is: () => query,
      in: (_key: string, values: string[]) => { clubs = values; return query; },
      eq: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => state.metaRead(table, clubs).then(resolve, reject),
      order: () => state.read(clubs) };
    return query;
  },
  channel: () => { const channel = { on: (_event: string, _filter: unknown, callback: () => void) => {
    state.events.push(callback); return channel;
  }, subscribe: () => channel }; return channel; },
  removeChannel: vi.fn(),
  functions: { invoke: state.invoke }, rpc: state.rpc,
} }));
import { useFloorTournaments } from "./useFloorTournaments";
afterEach(cleanup);
beforeEach(() => {
  state.read.mockReset(); state.actor = "owner"; state.loading = false;
  state.invoke.mockReset(); state.rpc.mockReset(); state.error.mockReset();
  state.events = [];
  state.multiDay = false; state.metaRead.mockReset();
});

it("publishes metadata only for its own scope and exact list, including same-scope refresh", async () => {
  state.multiDay = true;
  const pending: Array<{ ids: string[]; resolve: (value: unknown) => void }> = [];
  state.metaRead.mockImplementation((_table: string, ids: string[]) => new Promise(resolve => { pending.push({ ids, resolve }); }));
  state.read.mockImplementation((clubs: string[]) => Promise.resolve({ data: [{ id: `tour-${clubs[0]}`, club_id: clubs[0], event_id: `event-${clubs[0]}` }], error: null }));
  const { result, rerender } = renderHook(({ clubs }) => useFloorTournaments(clubs), { initialProps: { clubs: ["a"] } });
  await waitFor(() => expect(pending).toHaveLength(1));
  rerender({ clubs: ["b"] });
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(result.current.eventMeta).toEqual({});
  await act(async () => pending[1].resolve({ data: [{ id: "event-b", name: "B", itm_percent: 10 }], error: null }));
  await waitFor(() => expect(result.current.eventMeta["event-b"]?.name).toBe("B"));
  await act(async () => pending[0].resolve({ data: [{ id: "event-a", name: "A", itm_percent: 20 }], error: null }));
  expect(result.current.eventMeta["event-a"]).toBeUndefined();
  await act(async () => { await result.current.reload(); });
  await waitFor(() => expect(pending).toHaveLength(3));
  expect(result.current.eventMeta).toEqual({});
  await act(async () => pending[2].resolve({ data: [{ id: "event-b", name: "Fresh B", itm_percent: 15 }], error: null }));
  await waitFor(() => expect(result.current.eventMeta["event-b"]?.name).toBe("Fresh B"));
});

it("does not publish guessed readiness when a metadata read fails", async () => {
  state.multiDay = true;
  state.read.mockResolvedValue({ data: [{ id: "tour-a", club_id: "a", event_id: "event-a" }], error: null });
  state.metaRead.mockResolvedValue({ data: null, error: { message: "503" } });
  const { result } = renderHook(() => useFloorTournaments(["a"]));
  await waitFor(() => expect(state.metaRead).toHaveBeenCalled());
  expect(result.current.eventMeta).toEqual({});
  expect(result.current.flightMeta).toEqual({});
});

it("does not replace club B's list with a late club A response", async () => {
  let resolveA!: (value: unknown) => void;
  state.read.mockImplementation((clubs: string[]) => clubs[0] === "a"
    ? new Promise(resolve => { resolveA = resolve; })
    : Promise.resolve({ data: [{ id: "tour-b", club_id: "b" }], error: null }));
  const { result, rerender } = renderHook(({ clubs }) => useFloorTournaments(clubs), { initialProps: { clubs: ["a"] } });
  await waitFor(() => expect(resolveA).toBeTypeOf("function"));
  rerender({ clubs: ["b"] });
  await waitFor(() => expect(result.current.tours.map(tour => tour.id)).toEqual(["tour-b"]));
  await act(async () => resolveA({ data: [{ id: "tour-a", club_id: "a" }], error: null }));
  expect(result.current.tours.map(tour => tour.id)).toEqual(["tour-b"]);
});

it("does not restore a club list after scope is cleared", async () => {
  let resolveA!: (value: unknown) => void;
  state.read.mockImplementation(() => new Promise(resolve => { resolveA = resolve; }));
  const { result, rerender } = renderHook(({ clubs }) => useFloorTournaments(clubs), { initialProps: { clubs: ["a"] } });
  await waitFor(() => expect(resolveA).toBeTypeOf("function"));
  rerender({ clubs: [] });
  await act(async () => resolveA({ data: [{ id: "tour-a", club_id: "a" }], error: null }));
  expect(result.current.tours).toEqual([]);
});

it("does not read again for an equivalent club array", async () => {
  state.read.mockResolvedValue({ data: [{ id: "tour-a", club_id: "a" }], error: null });
  const { result, rerender } = renderHook(({ clubs }) => useFloorTournaments(clubs), { initialProps: { clubs: ["a"] } });
  await waitFor(() => expect(result.current.tours).toHaveLength(1));
  rerender({ clubs: ["a"] });
  expect(state.read).toHaveBeenCalledTimes(1);
});

it("hides data on logout and rejects saved old mutation callbacks", async () => {
  const clubs = ["a"];
  state.read.mockResolvedValue({ data: [{ id: "tour-a", club_id: "a" }], error: null });
  const { result, rerender } = renderHook(() => useFloorTournaments(clubs));
  await waitFor(() => expect(result.current.tours).toHaveLength(1));
  const oldStart = result.current.startTournament;
  const oldDelete = result.current.deleteTour;
  state.actor = "";
  rerender();
  expect(result.current.tours).toEqual([]);
  await act(async () => { await oldStart("tour-a"); await oldDelete("tour-a"); });
  expect(state.invoke).not.toHaveBeenCalled();
  expect(state.rpc).not.toHaveBeenCalled();
  expect(state.read).toHaveBeenCalledTimes(1);
});

it("discards old errors without showing a false error for the new club", async () => {
  let resolveA!: (value: unknown) => void;
  state.read.mockImplementation((clubs: string[]) => clubs[0] === "a" ? new Promise(resolve => { resolveA = resolve; })
    : Promise.resolve({ data: [{ id: "tour-b", club_id: "b" }], error: null }));
  const { result, rerender } = renderHook(({ clubs }) => useFloorTournaments(clubs), { initialProps: { clubs: ["a"] } });
  rerender({ clubs: ["b"] });
  await waitFor(() => expect(result.current.tours).toHaveLength(1));
  await act(async () => resolveA({ data: null, error: { message: "503" } }));
  expect(result.current.error).toBeNull();
  expect(state.error).not.toHaveBeenCalled();
});

it("rejects rows from an unexpected club instead of exposing them", async () => {
  const clubs = ["a"];
  state.read.mockResolvedValue({ data: [{ id: "foreign-tour", club_id: "b" }], error: null });
  const { result } = renderHook(() => useFloorTournaments(clubs));
  await waitFor(() => expect(result.current.error).toBe("invalid_floor_tournament_scope"));
  expect(result.current.tours).toEqual([]);
  expect(result.current.loading).toBe(false);
});

it("still starts a verified current tournament through the canonical Edge", async () => {
  const clubs = ["a"];
  state.read.mockResolvedValue({ data: [{ id: "tour-a", club_id: "a" }], error: null });
  state.invoke.mockResolvedValue({ data: { ok: true }, error: null });
  const { result } = renderHook(() => useFloorTournaments(clubs));
  await waitFor(() => expect(result.current.tours).toHaveLength(1));
  await act(async () => { await result.current.startTournament("tour-a"); });
  expect(state.invoke).toHaveBeenCalledWith("tournament-live-clock", {
    body: { tournament_id: "tour-a", action: "start", current_level: 1 },
  });
});

it("does not resurrect the first A request after A-B-A navigation", async () => {
  let resolveFirstA!: (value: unknown) => void;
  let callsA = 0;
  state.read.mockImplementation((clubs: string[]) => {
    if (clubs[0] === "a" && ++callsA === 1) return new Promise(resolve => { resolveFirstA = resolve; });
    return Promise.resolve({ data: [{ id: `new-${clubs[0]}`, club_id: clubs[0] }], error: null });
  });
  const { result, rerender } = renderHook(({ clubs }) => useFloorTournaments(clubs), { initialProps: { clubs: ["a"] } });
  rerender({ clubs: ["b"] });
  rerender({ clubs: ["a"] });
  await waitFor(() => expect(result.current.tours.map(tour => tour.id)).toEqual(["new-a"]));
  await act(async () => resolveFirstA({ data: [{ id: "old-a", club_id: "a" }], error: null }));
  expect(result.current.tours.map(tour => tour.id)).toEqual(["new-a"]);
});

it("coalesces a Realtime burst to one active read and one trailing refresh", async () => {
  const clubs = ["a"];
  const resolvers: Array<(value: unknown) => void> = [];
  state.read.mockImplementation(() => new Promise(resolve => { resolvers.push(resolve); }));
  const { result } = renderHook(() => useFloorTournaments(clubs));
  await waitFor(() => expect(state.read).toHaveBeenCalledTimes(1));
  await act(async () => { for (let i = 0; i < 20; i++) state.events[0](); });
  expect(state.read).toHaveBeenCalledTimes(1);
  await act(async () => resolvers[0]({ data: [{ id: "first-a", club_id: "a" }], error: null }));
  await waitFor(() => expect(state.read).toHaveBeenCalledTimes(2));
  await act(async () => resolvers[1]({ data: [{ id: "latest-a", club_id: "a" }], error: null }));
  expect(result.current.tours.map(tour => tour.id)).toEqual(["latest-a"]);
  expect(state.read).toHaveBeenCalledTimes(2);
});
