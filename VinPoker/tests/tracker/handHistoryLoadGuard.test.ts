import { afterEach, describe, expect, it, vi } from "vitest";
import { createHandHistoryLoadGuard } from "@/components/cashier/tournament-live/handHistoryLoadGuard";

describe("hand-history load guard", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("invalidates a timed-out read before reporting the timeout", () => {
    vi.useFakeTimers();
    const guard = createHandHistoryLoadGuard();
    let request = 0;
    const timeout = vi.fn(() => expect(guard.isCurrent(request)).toBe(false));
    request = guard.begin(timeout);
    vi.advanceTimersByTime(19_999);
    expect(timeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(timeout).toHaveBeenCalledOnce();
  });

  it("clears completed and superseded read deadlines", () => {
    vi.useFakeTimers();
    const guard = createHandHistoryLoadGuard();
    const oldTimeout = vi.fn(), currentTimeout = vi.fn();
    const old = guard.begin(oldTimeout);
    const current = guard.begin(currentTimeout);
    guard.finish(old);
    vi.advanceTimersByTime(20_000);
    expect(oldTimeout).not.toHaveBeenCalled();
    expect(currentTimeout).toHaveBeenCalledOnce();
    const done = guard.begin(oldTimeout);
    guard.finish(done);
    vi.advanceTimersByTime(20_000);
    expect(oldTimeout).not.toHaveBeenCalled();
    expect(guard.isCurrent(current)).toBe(false);
    expect(guard.isCurrent(done)).toBe(true);
  });

  it("unmount cleanup clears the deadline without reporting an error", () => {
    vi.useFakeTimers();
    const guard = createHandHistoryLoadGuard(), timeout = vi.fn();
    guard.begin(timeout);
    guard.invalidate();
    vi.advanceTimersByTime(20_000);
    expect(timeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects a late response from the previous table after a new selection starts", () => {
    const guard = createHandHistoryLoadGuard();
    const tableA = guard.begin();
    const tableB = guard.begin();

    expect(guard.isCurrent(tableA)).toBe(false);
    expect(guard.isCurrent(tableB)).toBe(true);
  });

  it("invalidates an in-flight response when the panel unmounts", () => {
    const guard = createHandHistoryLoadGuard();
    const request = guard.begin();
    guard.invalidate();

    expect(guard.isCurrent(request)).toBe(false);
  });
});
