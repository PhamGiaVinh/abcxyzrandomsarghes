import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc } }));
vi.mock("@/hooks/useLiveClock", () => ({ useLiveClock: () => 0 }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { tvLayoutEditorV1: true } }));
import { useTvDisplayState } from "./useTvDisplayState";

beforeEach(() => {
  vi.useFakeTimers();
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ data: { status: "invalid" }, error: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("paired display transport recovery", () => {
  it("surfaces initial fetch rejection then continues the bounded poll loop", async () => {
    state.rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useTvDisplayState("synthetic-display-token"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state).toBe("error");
    expect(result.current.offline).toBe(true);
    expect(state.rpc).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
    expect(state.rpc).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(state.rpc).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("invalid");
    expect(result.current.offline).toBe(false);
  });
});
