import { StrictMode, type PropsWithChildren } from "react";
import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTrackerRunoutSounds } from "@/lib/tracker-poker/useTrackerRunoutSounds";
import { createReplayRunoutPresentation as phase, type ReplayRunoutPhase } from "@/lib/tracker-poker/replayRunoutTimeline";
import { playPokerLiveSound, trackerSoundCancellationToken } from "@/lib/pokerLiveSound";

vi.mock("@/lib/pokerLiveSound", () => ({ playPokerLiveSound: vi.fn(), trackerSoundCancellationToken: vi.fn(() => 0), cancelPendingTrackerPokerSounds: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); vi.mocked(trackerSoundCancellationToken).mockReturnValue(0); });
const kinds = () => vi.mocked(playPokerLiveSound).mock.calls.map(call => call[0]);

describe("Tracker street and award cues", () => {
  it("keeps a newly mounted award phase silent while paused and plays it once on resume", () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(({ playing }) =>
      useTrackerRunoutSounds(phase("paused-hand", "pot_award", 0), true, false, true, playing),
    { initialProps: { playing: false } });
    act(() => vi.advanceTimersByTime(1000));
    expect(kinds()).toEqual([]);
    rerender({ playing: true });
    expect(kinds()).toEqual(["hand_ranking"]);
    act(() => vi.advanceTimersByTime(420));
    expect(kinds()).toEqual(["hand_ranking", "pot_award"]);
    rerender({ playing: false });
    rerender({ playing: true });
    act(() => vi.advanceTimersByTime(1000));
    expect(kinds()).toEqual(["hand_ranking", "pot_award"]);
  });
  it("pause cancels a delayed award even when the presentation and source stay unchanged", () => {
    vi.useFakeTimers();
    renderHook(() => useTrackerRunoutSounds(phase("hand", "pot_award", 0), true, false, false));
    act(() => vi.advanceTimersByTime(200));
    vi.mocked(trackerSoundCancellationToken).mockReturnValue(1);
    act(() => vi.advanceTimersByTime(220));
    expect(kinds()).toEqual([]);
  });
  it("sounds every visible street once, including all-in runout at the same frame index", () => {
    const { rerender } = renderHook(({ street }: { street: ReplayRunoutPhase }) =>
      useTrackerRunoutSounds(phase("old-hand", street), true, false, true), { initialProps: { street: "hole_hold" as ReplayRunoutPhase } });
    for (const street of ["flop", "turn", "river", "pot_collect"] as const) {
      rerender({ street }); rerender({ street });
    }
    expect(kinds()).toEqual(["showdown", "deal_flop", "deal_turn", "deal_river", "pot_collect"]);
  });

  it("plays ranking then award at chip arrival, once per pot even in StrictMode", () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
    const { rerender } = renderHook(({ pot }) => useTrackerRunoutSounds(phase("hand", "pot_award", pot), true, false, true), { initialProps: { pot: 0 }, wrapper });
    expect(kinds()).toEqual(["hand_ranking"]);
    act(() => vi.advanceTimersByTime(419));
    expect(kinds()).toEqual(["hand_ranking"]);
    act(() => vi.advanceTimersByTime(1));
    rerender({ pot: 0 });
    expect(kinds()).toEqual(["hand_ranking", "pot_award"]);
    rerender({ pot: 1 });
    act(() => vi.advanceTimersByTime(420));
    expect(kinds()).toEqual(["hand_ranking", "pot_award", "hand_ranking", "pot_award"]);
  });

  it("cancels pending awards on mute or hand change; static/seek never sounds", () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(({ hand, muted, enabled }) =>
      useTrackerRunoutSounds(hand ? phase(hand, "pot_award", 0) : null, enabled, muted, false),
    { initialProps: { hand: "a", muted: false, enabled: true } });
    rerender({ hand: "a", muted: true, enabled: true });
    act(() => vi.advanceTimersByTime(500));
    rerender({ hand: "a", muted: false, enabled: true });
    act(() => vi.advanceTimersByTime(500));
    expect(kinds()).toEqual([]);
    rerender({ hand: "b", muted: false, enabled: true });
    rerender({ hand: "", muted: false, enabled: true });
    act(() => vi.advanceTimersByTime(500));
    rerender({ hand: "c", muted: false, enabled: false });
    act(() => vi.advanceTimersByTime(500));
    renderHook(() => useTrackerRunoutSounds(phase("static", "static", 0), true, false, true));
    expect(kinds()).toEqual([]);
  });
});
