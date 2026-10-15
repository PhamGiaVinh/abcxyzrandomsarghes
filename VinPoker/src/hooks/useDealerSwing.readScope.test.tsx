import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: { id: "actor-a" } as { id: string } | null, read: vi.fn(), callbacks: [] as Array<() => void> }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => {
    let ids: string[] = [];
    const query = {
      select: () => query, eq: () => query, is: () => query,
      in: (_column: string, values: string[]) => { ids = values; return query; },
      order: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(state.read(ids)).then(resolve, reject),
    };
    return query;
  },
  channel: () => {
    const channel = {
      on: (_kind: string, _filter: unknown, callback: () => void) => { state.callbacks.push(callback); return channel; },
      subscribe: () => channel,
    };
    return channel;
  },
  removeChannel: vi.fn(),
} }));

import { useCheckedInDealers, useSwingConfigs } from "./useDealerSwing";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}
function rows(id: string) {
  return { data: [{ id, dealer_id: id, check_in_time: "2026-10-10T00:00:00Z" }], error: null };
}

describe("Dealer production read scope", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  beforeEach(() => {
    state.user = { id: "actor-a" };
    state.read.mockReset();
    state.callbacks = [];
    state.read.mockImplementation((ids: string[]) => rows(ids[0]));
  });

  it("reports a config refresh failure without silently replacing known config with defaults", async () => {
    const hook = renderHook(() => useSwingConfigs(["club-a"]));
    await waitFor(() => expect(hook.result.current.data?.[0]?.id).toBe("club-a"));
    state.read.mockResolvedValue({ data: null, error: { message: "503 config" } });
    await act(async () => { await hook.result.current.refetch(); });
    expect(hook.result.current.error).toBe("503 config");
    expect(hook.result.current.data?.[0]?.id).toBe("club-a");
    expect(hook.result.current.loading).toBe(false);
  });

  it("ignores an old config response after changing clubs", async () => {
    const old = deferred<unknown>();
    state.read.mockImplementationOnce(() => old.promise);
    const hook = renderHook(({ ids }) => useSwingConfigs(ids), { initialProps: { ids: ["club-a"] } });
    await waitFor(() => expect(state.read).toHaveBeenCalledOnce());
    hook.rerender({ ids: ["club-b"] });
    await waitFor(() => expect(hook.result.current.data?.[0]?.id).toBe("club-b"));
    await act(async () => { old.resolve(rows("obsolete-a")); });
    expect(hook.result.current.data?.[0]?.id).toBe("club-b");
  });

  it("hides config across actor changes and clears it on logout", async () => {
    const hook = renderHook(() => useSwingConfigs(["club-a"]));
    await waitFor(() => expect(hook.result.current.data?.[0]?.id).toBe("club-a"));
    const next = deferred<unknown>();
    state.read.mockImplementation(() => next.promise);
    state.user = { id: "actor-b" };
    hook.rerender();
    expect(hook.result.current.data).toEqual([]);
    expect(hook.result.current.loading).toBe(true);
    await act(async () => { next.resolve(rows("actor-b-config")); });
    expect(hook.result.current.data[0]?.id).toBe("actor-b-config");
    const count = state.read.mock.calls.length;
    state.user = null;
    hook.rerender();
    expect(hook.result.current.data).toEqual([]);
    expect(hook.result.current.loading).toBe(false);
    expect(state.read).toHaveBeenCalledTimes(count);
  });

  it("keeps config reads on demand without creating subscriptions or polling", async () => {
    renderHook(() => useSwingConfigs(["club-a"]));
    await waitFor(() => expect(state.read).toHaveBeenCalledOnce());
    expect(state.callbacks).toEqual([]);
    vi.useFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(state.read).toHaveBeenCalledOnce();
  });

  it("hides a prior actor snapshot even when the club selection is unchanged", async () => {
    const pending = deferred<unknown>();
    const hook = renderHook(() => useCheckedInDealers(["club-a"]));
    await waitFor(() => expect(hook.result.current.data).toHaveLength(1));
    state.read.mockImplementation(() => pending.promise);
    state.user = { id: "actor-b" };
    hook.rerender();
    expect(hook.result.current.data).toEqual([]);
    expect(hook.result.current.loading).toBe(true);
    await act(async () => { pending.resolve(rows("actor-b")); });
    expect(hook.result.current.data[0]?.id).toBe("actor-b");
  });

  it("hides club A rows while club B is awaiting its authoritative snapshot", async () => {
    const pending = deferred<unknown>();
    const hook = renderHook(({ ids }) => useCheckedInDealers(ids), { initialProps: { ids: ["club-a"] } });
    await waitFor(() => expect(hook.result.current.data[0]?.id).toBe("club-a"));
    state.read.mockImplementation(() => pending.promise);
    hook.rerender({ ids: ["club-b"] });
    expect(hook.result.current.data).toEqual([]);
    expect(hook.result.current.loading).toBe(true);
    await act(async () => { pending.resolve(rows("club-b")); });
    expect(hook.result.current.data[0]?.id).toBe("club-b");
  });

  it("keeps a same-club snapshot and error on a failed refresh", async () => {
    const hook = renderHook(() => useCheckedInDealers(["club-a"]));
    await waitFor(() => expect(hook.result.current.data[0]?.id).toBe("club-a"));
    state.read.mockResolvedValue({ data: null, error: { message: "503 TEST" } });
    await act(async () => { await hook.result.current.refetch(); });
    expect(hook.result.current.data[0]?.id).toBe("club-a");
    expect(hook.result.current.error).toBe("503 TEST");
    expect(hook.result.current.loading).toBe(false);
  });

  it("does not turn a verified same-scope background refresh into initial loading", async () => {
    const hook = renderHook(() => useCheckedInDealers(["club-a"]));
    await waitFor(() => expect(hook.result.current.data).toHaveLength(1));
    const pending = deferred<unknown>();
    state.read.mockImplementation(() => pending.promise);
    act(() => { hook.result.current.refetch(); });
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.data[0]?.id).toBe("club-a");
    await act(async () => { pending.resolve(rows("club-a")); });
  });

  it("does not refetch from a removed subscription after unmount", async () => {
    const hook = renderHook(() => useCheckedInDealers(["club-a"]));
    await waitFor(() => expect(hook.result.current.data).toHaveLength(1));
    const callback = state.callbacks[0];
    const count = state.read.mock.calls.length;
    hook.unmount();
    await act(async () => { callback(); });
    expect(state.read).toHaveBeenCalledTimes(count);
  });

  it("rejects a late snapshot across club A to B to A incarnations", async () => {
    const old = deferred<unknown>();
    state.read.mockImplementationOnce(() => old.promise);
    const hook = renderHook(({ ids }) => useCheckedInDealers(ids), { initialProps: { ids: ["club-a"] } });
    await waitFor(() => expect(state.read).toHaveBeenCalledOnce());
    hook.rerender({ ids: ["club-b"] });
    await waitFor(() => expect(hook.result.current.data[0]?.id).toBe("club-b"));
    hook.rerender({ ids: ["club-a"] });
    await waitFor(() => expect(hook.result.current.data[0]?.id).toBe("club-a"));
    await act(async () => { old.resolve(rows("obsolete-a")); });
    expect(hook.result.current.data[0]?.id).toBe("club-a");
  });

  it("clears data and ignores old subscription events after logout", async () => {
    const hook = renderHook(() => useCheckedInDealers(["club-a"]));
    await waitFor(() => expect(hook.result.current.data).toHaveLength(1));
    const callback = state.callbacks[0];
    const count = state.read.mock.calls.length;
    state.user = null;
    hook.rerender();
    expect(hook.result.current.data).toEqual([]);
    expect(hook.result.current.loading).toBe(false);
    await act(async () => { callback(); });
    expect(state.read).toHaveBeenCalledTimes(count);
  });

  it("rejects the first StrictMode lifetime read after the replacement lifetime loads", async () => {
    const old = deferred<unknown>();
    state.read.mockImplementationOnce(() => old.promise);
    const hook = renderHook(() => useCheckedInDealers(["club-a"]), {
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    });
    await waitFor(() => expect(hook.result.current.data[0]?.id).toBe("club-a"));
    await act(async () => { old.resolve(rows("obsolete-lifetime")); });
    expect(hook.result.current.data[0]?.id).toBe("club-a");
    expect(hook.result.current.loading).toBe(false);
  });

  it("settles a pending read after unmount without enabling its old event callback", async () => {
    const pending = deferred<unknown>();
    state.read.mockImplementation(() => pending.promise);
    const hook = renderHook(() => useCheckedInDealers(["club-a"]));
    await waitFor(() => expect(state.read).toHaveBeenCalledOnce());
    const callback = state.callbacks[0];
    hook.unmount();
    await act(async () => { pending.resolve(rows("after-unmount")); callback(); });
    expect(state.read).toHaveBeenCalledOnce();
  });

  it("coalesces a burst of Realtime invalidations into one trailing authoritative read", async () => {
    const hook = renderHook(() => useCheckedInDealers(["club-a"]));
    await waitFor(() => expect(hook.result.current.data).toHaveLength(1));
    state.read.mockImplementation(() => rows("after-burst"));
    await act(async () => { for (let index = 0; index < 10; index += 1) state.callbacks[0](); });
    await waitFor(() => expect(hook.result.current.data[0]?.id).toBe("after-burst"));
    expect(state.read).toHaveBeenCalledTimes(2);
  });

  it("pauses fallback polling while hidden and refreshes once when visible again", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("visible");
    const hook = renderHook(() => useCheckedInDealers(["club-a"]));
    await waitFor(() => expect(hook.result.current.data).toHaveLength(1));
    vi.useFakeTimers();
    // Recreate this subscription with the timer clock controlled by the test.
    hook.unmount();
    state.read.mockClear();
    const current = renderHook(() => useCheckedInDealers(["club-a"]));
    await act(async () => { await Promise.resolve(); });
    expect(state.read).toHaveBeenCalledOnce();
    visibility.mockReturnValue("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(120_000); });
    expect(state.read).toHaveBeenCalledOnce();
    visibility.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(150); });
    expect(state.read).toHaveBeenCalledTimes(2);
    current.unmount();
  });

  it("pauses background reads offline and coalesces online resume events", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.useFakeTimers();
    const hook = renderHook(() => useCheckedInDealers(["club-a"]));
    await act(async () => { await Promise.resolve(); });
    expect(state.read).toHaveBeenCalledOnce();
    online.mockReturnValue(false);
    await act(async () => { state.callbacks[0](); await vi.advanceTimersByTimeAsync(120_000); });
    expect(state.read).toHaveBeenCalledOnce();
    online.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(state.read).toHaveBeenCalledTimes(2);
    hook.unmount();
    await act(async () => { window.dispatchEvent(new Event("online")); await vi.advanceTimersByTimeAsync(150); });
    expect(state.read).toHaveBeenCalledTimes(2);
  });
});
