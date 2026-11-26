import { afterEach, expect, it, vi } from "vitest";
import { createLivePresentationQueue, type LivePresentationSnapshot } from "./livePresentationQueue";

afterEach(() => vi.useRealTimers());

function snapshot(overrides: Partial<LivePresentationSnapshot> = {}): LivePresentationSnapshot {
  return {
    handId: "hand-1", actionKeys: ["sb", "bb", "ante", "all-in", "call"],
    blindCount: 3, blindsReady: true, seatCount: 8, inProgress: true,
    present: vi.fn(), deal: vi.fn(), ...overrides,
  };
}

it("joins the current hand silently then deals a new hand before any betting action", () => {
  vi.useFakeTimers();
  const queue = createLivePresentationQueue();
  const first = snapshot();
  queue.submit(first);
  expect(first.present).toHaveBeenCalledExactlyOnceWith(5, false);
  expect(first.deal).not.toHaveBeenCalled();
  const next = snapshot({ handId: "hand-2" });
  queue.submit(next);
  expect(next.present).toHaveBeenNthCalledWith(1, 0, true);
  vi.advanceTimersByTime(2100);
  expect(next.deal).toHaveBeenCalledTimes(1);
  expect(next.present).not.toHaveBeenCalledWith(4, false);
  vi.advanceTimersByTime(3499);
  expect(next.present).not.toHaveBeenCalledWith(4, false);
  vi.advanceTimersByTime(1);
  expect(next.present).toHaveBeenLastCalledWith(4, false);
  vi.advanceTimersByTime(700);
  expect(next.present).toHaveBeenLastCalledWith(5, false);
  queue.reset();
});

it("waits for the big blind and deduplicates repeated snapshots during the deal", () => {
  vi.useFakeTimers();
  const queue = createLivePresentationQueue();
  queue.submit(snapshot({ handId: null, actionKeys: [] }));
  queue.submit(snapshot({ actionKeys: ["sb"], blindCount: 1, blindsReady: false }));
  vi.advanceTimersByTime(1000);
  const ready = snapshot({ actionKeys: ["sb", "bb"], blindCount: 2 });
  queue.submit(ready);
  vi.advanceTimersByTime(700);
  expect(ready.deal).toHaveBeenCalledTimes(1);
  const repeated = snapshot({ actionKeys: ["sb", "bb"], blindCount: 2 });
  queue.submit(repeated);
  vi.advanceTimersByTime(3500);
  expect(repeated.deal).not.toHaveBeenCalled();
  expect(repeated.present).toHaveBeenLastCalledWith(2, false);
  queue.reset();
});

it("cancels every queued frame on scope reset and accepts an undo as a new baseline", () => {
  vi.useFakeTimers();
  const queue = createLivePresentationQueue();
  queue.submit(snapshot({ handId: null, actionKeys: [] }));
  const pending = snapshot();
  queue.submit(pending);
  queue.reset();
  vi.clearAllMocks();
  vi.runAllTimers();
  expect(pending.present).not.toHaveBeenCalled();
  expect(pending.deal).not.toHaveBeenCalled();
  queue.submit(snapshot());
  const undo = snapshot({ actionKeys: ["sb", "bb"] });
  queue.submit(undo);
  expect(undo.present).toHaveBeenCalledExactlyOnceWith(2, false);
  expect(undo.deal).not.toHaveBeenCalled();
  queue.reset();
});

it("keeps actions arriving during a deal behind the last card and presents them once", () => {
  vi.useFakeTimers();
  const queue = createLivePresentationQueue();
  queue.submit(snapshot({ handId: null, actionKeys: [] }));
  const blinds = snapshot({ actionKeys: ["sb", "bb", "ante"] });
  queue.submit(blinds);
  vi.advanceTimersByTime(2100);
  const allIn = snapshot({ actionKeys: ["sb", "bb", "ante", "all-in"] });
  queue.submit(allIn);
  const call = snapshot();
  queue.submit(call);
  vi.advanceTimersByTime(3499);
  expect(allIn.present).not.toHaveBeenCalled();
  expect(call.present).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(allIn.present).toHaveBeenCalledExactlyOnceWith(4, false);
  vi.advanceTimersByTime(700);
  expect(call.present).toHaveBeenCalledExactlyOnceWith(5, false);
  expect(call.deal).not.toHaveBeenCalled();
  queue.reset();
});
