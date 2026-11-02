import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({
  useSupabaseClient: () => client,
}));
const client = { rpc: (...args: unknown[]) => {
  const promise = mocks.rpc(...args);
  return Object.assign(promise, { abortSignal: () => promise });
} };
import { useTournamentRedrawTv } from "./useTournamentRedrawTv";

const batch = { batch_id: "a", redraw_revision: 1, tournament_name: "A", target_max_seats: 8,
  applied_at: "2026-10-17T00:00:00Z", moves: [] };
const ok = (data: unknown = batch) => ({ data, error: null });
function deferred() {
  let resolve!: (value: ReturnType<typeof ok>) => void;
  const promise = new Promise<ReturnType<typeof ok>>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  mocks.rpc.mockResolvedValue(ok());
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("redraw TV read lifecycle", () => {
  it('reports malformed absence as error, not an authoritative ended hold',async()=>{
    mocks.rpc.mockResolvedValue(ok({}));
    const {result}=renderHook(()=>useTournamentRedrawTv('A',true));
    await act(async()=>{});
    expect(result.current.state).toBe('error');expect(result.current.data).toBeNull();
    mocks.rpc.mockResolvedValueOnce(ok({batch_id:null,moves:[]}));
    await act(async()=>{await result.current.refresh();});
    expect(result.current.state).toBe('empty');
  });
  it("accepts a five-second response without overlapping four-second polls", async () => {
    mocks.rpc.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(ok()), 5000)));
    const { result } = renderHook(() => useTournamentRedrawTv("A", true));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.state).toBe("ready");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("coalesces manual and visibility refresh while a request is pending", async () => {
    const pending = deferred(); mocks.rpc.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useTournamentRedrawTv("A", true));
    await act(async () => {
      void result.current.refresh(); void result.current.refresh();
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(ok()); });
    expect(result.current.state).toBe("ready");
  });

  it("clears a disabled scope and ignores a late completion from the prior tournament", async () => {
    const pending = deferred(); mocks.rpc.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ id, enabled }) => useTournamentRedrawTv(id, enabled),
      { initialProps: { id: "A", enabled: true } });
    await act(async () => {});
    expect(mocks.rpc).toHaveBeenCalledWith("get_public_tournament_redraw_v1", { p_tournament_id: "A" });
    rerender({ id: "B", enabled: true });
    await act(async () => {});
    expect(result.current.data?.batchId).toBe("a");
    await act(async () => { pending.resolve(ok({ ...batch, batch_id: "old" })); });
    expect(result.current.data?.batchId).toBe("a");
    rerender({ id: "B", enabled: false });
    expect(result.current.data).toBeNull();
    expect(result.current.state).toBe("empty");
  });

  it("does not retain an old last-good marker after an authoritative empty response", async () => {
    const { result } = renderHook(() => useTournamentRedrawTv("A", true));
    await act(async () => {});
    mocks.rpc.mockResolvedValueOnce(ok({ batch_id: null, moves: [] }));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.state).toBe("empty");
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "503" } });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.state).toBe("error");
    expect(result.current.data).toBeNull();
  });

  it("bounds a hung request, recovers and ignores its later result", async () => {
    const pending = deferred(); mocks.rpc.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useTournamentRedrawTv("A", true));
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(result.current.state).toBe("error");
    await act(async () => { await result.current.refresh(); });
    expect(result.current.state).toBe("ready");
    await act(async () => { pending.resolve(ok({ ...batch, batch_id: "expired" })); });
    expect(result.current.data?.batchId).toBe("a");
  });

  it("skips hidden/offline polls and refreshes on reconnect", async () => {
    const { result } = renderHook(() => useTournamentRedrawTv("A", true));
    await act(async () => {});
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("ready");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("keeps same-scope data stale on rejection and recovers after a synchronous client failure", async () => {
    const { result } = renderHook(() => useTournamentRedrawTv("A", true));
    await act(async () => {});
    mocks.rpc.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.state).toBe("stale");
    expect(result.current.data?.batchId).toBe("a");
    mocks.rpc.mockImplementationOnce(() => { throw new Error("client failed"); });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.state).toBe("stale");
    await act(async () => { await result.current.refresh(); });
    expect(result.current.state).toBe("ready");
  });

  it("cancels the fetch signal on unmount without scheduling another poll", async () => {
    let signal: AbortSignal | undefined;
    const pending = deferred();
    const abort = vi.spyOn(client, "rpc").mockReturnValue({
      abortSignal: (value: AbortSignal) => { signal = value; return pending.promise; },
    } as ReturnType<typeof client.rpc>);
    const { unmount } = renderHook(() => useTournamentRedrawTv("A", true));
    await act(async () => {});
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve(ok()); await vi.advanceTimersByTimeAsync(20000); });
    expect(abort).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
