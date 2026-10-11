import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTournamentParticipationSummary } from "./useTournamentParticipationSummary";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
const payload = (tour: string, remaining = 8) => ({ tournament_id: tour, average_stack: 9750000,
  counts: { total_entries: 11, re_entries: 0, remaining, seated: 8, waiting: 0, busted: 3,
    anomaly_entries: 0, anomaly_seats: 0, live_entry_stack: 78000000, seated_stack: 78000000, waiting_stack: 0 } });

describe("canonical operator participation summary", () => {
  beforeEach(() => { mocks.rpc.mockReset(); });
  it("reads exact canonical scope, including zero, not tournament counters", async () => {
    mocks.rpc.mockResolvedValue({ data: payload("tour", 0), error: null });
    const { result } = renderHook(() => useTournamentParticipationSummary("owner", "club", "tour", 0));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data?.counts.remaining).toBe(0);
    expect(mocks.rpc).toHaveBeenCalledWith("get_tournament_participation_counts_v1", { p_tournament_id: "tour" });
  });
  it("does not expose old account or tournament response after scope change", async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValue({ data: payload("new", 2), error: null });
    const { result, rerender } = renderHook(({ actor, tour }) =>
      useTournamentParticipationSummary(actor, "club", tour, 0), { initialProps: { actor: "old", tour: "old" } });
    rerender({ actor: "new", tour: "new" });
    await waitFor(() => expect(result.current.data?.counts.remaining).toBe(2));
    await act(async () => resolveOld({ data: payload("old", 99), error: null }));
    expect(result.current.data?.counts.remaining).toBe(2);
  });
  it("rejects malformed scope and clears ready data on refresh failure", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: payload("tour"), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "503" } })
      .mockResolvedValue({ data: payload("other"), error: null });
    const { result, rerender } = renderHook(({ refresh }) =>
      useTournamentParticipationSummary("owner", "club", "tour", refresh), { initialProps: { refresh: 0 } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ refresh: 1 });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeUndefined();
    rerender({ refresh: 2 });
    await waitFor(() => expect(result.current.status).toBe("error"));
  });
  it("does not call authenticated RPC without actor", () => {
    renderHook(() => useTournamentParticipationSummary(undefined, "club", "tour", 0));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps one in-flight read and one trailing refresh during sustained events", async () => {
    const resolvers: ((value: unknown) => void)[] = [];
    mocks.rpc.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    const { result, rerender } = renderHook(({ refresh }) =>
      useTournamentParticipationSummary("owner", "club", "tour", refresh), { initialProps: { refresh: 0 } });
    for (let refresh = 1; refresh <= 20; refresh++) rerender({ refresh });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    await act(async () => resolvers[0]({ data: payload("tour", 8), error: null }));
    expect(result.current.data?.counts.remaining).toBe(8);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    await act(async () => resolvers[1]({ data: payload("tour", 7), error: null }));
    expect(result.current.data?.counts.remaining).toBe(7);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it("hides ready data immediately on logout or club change", async () => {
    mocks.rpc.mockResolvedValue({ data: payload("tour"), error: null });
    const { result, rerender } = renderHook(({ actor, club }) =>
      useTournamentParticipationSummary(actor, club, "tour", 0),
      { initialProps: { actor: "owner" as string | undefined, club: "club" } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ actor: undefined, club: "club" });
    expect(result.current.data).toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    rerender({ actor: "owner", club: "other-club" });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
  });
});
