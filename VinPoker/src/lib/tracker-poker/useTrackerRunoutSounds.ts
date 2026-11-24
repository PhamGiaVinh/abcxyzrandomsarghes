import { useEffect, useRef } from "react";
import { cancelPendingTrackerPokerSounds, playPokerLiveSound, trackerSoundCancellationToken, type PokerLiveSound } from "@/lib/pokerLiveSound";
import { POT_AWARD_TRAVEL_MS, type ReplayRunoutPresentation } from "./replayRunoutTimeline";

/** Same audible cadence for Live, Replay, and the deterministic preview. */
export function useTrackerRunoutSounds(
  presentation: ReplayRunoutPresentation | null,
  enabled: boolean,
  muted: boolean,
  hasRanking: boolean,
  playing = true,
) {
  const consumed = useRef<{ key: string; startedAt: number; initial: boolean; award: boolean } | null>(null);
  const phase = presentation?.phase;
  const key = presentation ? `${presentation.key}:${phase}:${presentation.potAwardIndex ?? ""}` : null;
  useEffect(() => {
    if (!key || !enabled) {
      if (consumed.current) cancelPendingTrackerPokerSounds();
      consumed.current = null;
      return;
    }
    if (!playing) {
      cancelPendingTrackerPokerSounds();
      return;
    }
    if (consumed.current?.key !== key) {
      // Only a real phase transition invalidates downloads. Effect replay in
      // React StrictMode must not discard a cue that is already being decoded.
      if (consumed.current) cancelPendingTrackerPokerSounds();
      consumed.current = { key, startedAt: Date.now(), initial: false, award: false };
    }
    const cue = consumed.current;
    if (muted) { cancelPendingTrackerPokerSounds(); cue.initial = true; cue.award = true; return; }
    const play = (kind: PokerLiveSound) => playPokerLiveSound(kind, { bypassStoredMute: true, profile: "tracker" });
    if (!cue.initial) {
      cue.initial = true;
      if (phase === "hole_hold") play("showdown");
      if (phase === "flop") play("deal_flop");
      if (phase === "turn") play("deal_turn");
      if (phase === "river") play("deal_river");
      if (phase === "pot_collect") play("pot_collect");
      if (phase === "pot_award" && hasRanking) play("hand_ranking");
    }
    if (phase === "pot_award" && !cue.award) {
      const cancellationToken = trackerSoundCancellationToken();
      const timer = setTimeout(() => {
        cue.award = true;
        if (trackerSoundCancellationToken() === cancellationToken) play("pot_award");
      }, Math.max(0, POT_AWARD_TRAVEL_MS - (Date.now() - cue.startedAt)));
      return () => clearTimeout(timer);
    }
  }, [enabled, hasRanking, key, muted, phase, playing]);
}
