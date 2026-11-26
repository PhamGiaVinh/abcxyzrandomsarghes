// C4 — tracker action sounds (flag trackerActionSounds). Pins:
//  • mp3SrcFor flag OFF is byte-identical to today's MP3_BY_KIND for EVERY kind
//    (the owner clips are never consulted; operator/viewer audio unchanged).
//  • flag ON: check/fold/deal_*/pot_collect resolve to the owner clips under
//    /sounds/tracker/, while bet/call/raise/all_in keep poker-bet.mp3 (owner decision).
//  • shouldPlayOnce dedupes by the (handId, street, kind) tuple (owner P0).
//  • TrackerSoundToggle: flag OFF renders NOTHING (console header byte-identical);
//    flag ON toggles the shared `tracker_sound_muted` localStorage key.
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { mp3SrcFor, type PokerLiveSound } from "@/lib/pokerLiveSound";
import {
  shouldPlayOnce,
  isTrackerSoundMuted,
  setTrackerSoundMuted,
  TRACKER_SOUND_MUTE_KEY,
} from "@/lib/trackerSound";
import { TrackerSoundToggle } from "@/components/cashier/tournament-live/handinput/TrackerSoundToggle";
import { FEATURES } from "@/lib/featureFlags";

const ALL_KINDS: PokerLiveSound[] = [
  "deal", "fold", "check", "call", "bet", "raise", "all_in",
  "post_sb", "post_bb", "post_ante",
  "deal_flop", "deal_turn", "deal_river", "fold_muck", "chip", "pot_collect", "pot_award",
];

// Today's mapping, spelled out (a copy, NOT a re-import — so a regression in the
// module can't silently update the expectation).
const LEGACY_MP3: Partial<Record<PokerLiveSound, string>> = {
  deal: "/sounds/poker/deal-card.mp3",
  call: "/sounds/poker/poker-bet.mp3",
  bet: "/sounds/poker/poker-bet.mp3",
  raise: "/sounds/poker/poker-bet.mp3",
  all_in: "/sounds/poker/poker-bet.mp3",
  post_sb: "/sounds/poker/poker-bet.mp3",
  post_bb: "/sounds/poker/poker-bet.mp3",
  post_ante: "/sounds/poker/poker-bet.mp3",
};

afterEach(() => {
  (FEATURES as Record<string, unknown>).trackerActionSounds = false;
  cleanup();
});

describe("mp3SrcFor (C4)", () => {
  it("flag OFF: byte-identical to today's map for every kind (synth kinds stay undefined)", () => {
    // Explicit OFF — the flag now ships ON, so this "OFF" case sets it rather than
    // relying on the module default (afterEach restores OFF for the rest).
    (FEATURES as Record<string, unknown>).trackerActionSounds = false;
    for (const kind of ALL_KINDS) {
      expect(mp3SrcFor(kind), kind).toBe(LEGACY_MP3[kind]);
    }
  });

  it("flag ON: owner clips for check/fold/deal/pot_collect; bet family keeps poker-bet.mp3", () => {
    (FEATURES as Record<string, unknown>).trackerActionSounds = true;
    expect(mp3SrcFor("check")).toBe("/sounds/tracker/check.mp3");
    expect(mp3SrcFor("fold")).toBe("/sounds/tracker/fold.mp3");
    expect(mp3SrcFor("fold_muck")).toBe("/sounds/tracker/fold.mp3");
    expect(mp3SrcFor("deal_flop")).toBe("/sounds/tracker/deal-flop-2534.mp3");
    expect(mp3SrcFor("deal_turn")).toBe("/sounds/tracker/deal-turn-river-2535.mp3");
    expect(mp3SrcFor("deal_river")).toBe("/sounds/tracker/deal-turn-river-2535.mp3");
    expect(mp3SrcFor("pot_collect")).toBe("/sounds/tracker/pot-collect.mp3");
    expect(mp3SrcFor("pot_award")).toBe("/sounds/tracker/pot-award-2531.mp3");
    expect(mp3SrcFor("deal_one")).toBe("/sounds/tracker/deal-one.mp3");
    for (const kind of ["post_sb", "post_bb", "post_ante"] as const) expect(mp3SrcFor(kind)).toBe("/sounds/tracker/post-chip.mp3");
    for (const kind of ["bet", "call", "raise", "all_in"] as const) {
      expect(mp3SrcFor(kind), kind).toBe("/sounds/poker/poker-bet.mp3");
    }
    // The plain viewer deal is untouched by the flag.
    expect(mp3SrcFor("deal")).toBe("/sounds/poker/deal-card.mp3");
  });
});

describe("shouldPlayOnce dedupe (owner P0: one play per handId+street+kind)", () => {
  it("same tuple plays once; different street / kind / hand play again", () => {
    const seen = new Set<string>();
    expect(shouldPlayOnce(seen, "hand-1", "flop", "pot_collect")).toBe(true);
    expect(shouldPlayOnce(seen, "hand-1", "flop", "pot_collect")).toBe(false); // replayed state
    expect(shouldPlayOnce(seen, "hand-1", "flop", "deal_flop")).toBe(true); // other kind OK
    expect(shouldPlayOnce(seen, "hand-1", "turn", "pot_collect")).toBe(true); // next street OK
    expect(shouldPlayOnce(seen, "hand-2", "flop", "pot_collect")).toBe(true); // next hand OK
  });

  it("null handId buckets under one key (still deduped)", () => {
    const seen = new Set<string>();
    expect(shouldPlayOnce(seen, null, "flop", "deal_flop")).toBe(true);
    expect(shouldPlayOnce(seen, null, "flop", "deal_flop")).toBe(false);
  });
});

describe("mute persistence (shared tracker_sound_muted key)", () => {
  beforeEach(() => localStorage.removeItem(TRACKER_SOUND_MUTE_KEY));

  it("roundtrips with the viewer's '1' = muted convention", () => {
    expect(isTrackerSoundMuted()).toBe(false);
    setTrackerSoundMuted(true);
    expect(localStorage.getItem(TRACKER_SOUND_MUTE_KEY)).toBe("1");
    expect(isTrackerSoundMuted()).toBe(true);
    setTrackerSoundMuted(false);
    expect(localStorage.getItem(TRACKER_SOUND_MUTE_KEY)).toBe("0");
    expect(isTrackerSoundMuted()).toBe(false);
  });
});

describe("TrackerSoundToggle", () => {
  beforeEach(() => localStorage.removeItem(TRACKER_SOUND_MUTE_KEY));

  it("flag OFF renders nothing (console header byte-identical)", () => {
    const { container } = render(<TrackerSoundToggle />);
    expect(container.innerHTML).toBe("");
  });

  it("flag ON: unmuted by default, click mutes (persists '1'), click again unmutes", () => {
    (FEATURES as Record<string, unknown>).trackerActionSounds = true;
    render(<TrackerSoundToggle />);
    const btn = screen.getByRole("button", { name: "Tắt âm thanh thao tác" });
    fireEvent.click(btn);
    expect(localStorage.getItem(TRACKER_SOUND_MUTE_KEY)).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Bật âm thanh thao tác" }));
    expect(localStorage.getItem(TRACKER_SOUND_MUTE_KEY)).toBe("0");
    expect(screen.getByRole("button", { name: "Tắt âm thanh thao tác" })).toBeTruthy();
  });
});
