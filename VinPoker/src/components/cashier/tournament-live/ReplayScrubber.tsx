// Replay transport for a completed hand: street tabs, a timeline slider, play /
// pause / step / speed controls, and a clickable action list. Self-contained —
// owns step/play/speed state, builds frames from the hand, and pushes the
// current frame to the parent via onFrame so the existing <LiveFelt> renders it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, SkipBack, SkipForward, RotateCcw, ChevronsRight } from "lucide-react";
import {
  buildReplayFrames,
  streetFrameIndex,
  detectBigBlind,
  type ReplayFrame,
  type ReplayHand,
} from "@/lib/tracker-poker/replayEngine";
import {
  resolveVerifiedPayoutPresentation,
  selectVerifiedPotLayerPresentation,
  type VerifiedShowdownPresentation,
} from "@/lib/tracker-poker/replayBestFiveFocus";
import {
  createReplayRunoutPresentation,
  nextReplayRunoutPresentation,
  replayRunoutPhaseDuration,
  replayRunoutShowsSummary,
  type ReplayRunoutPresentation,
} from "@/lib/tracker-poker/replayRunoutTimeline";
import { formatActionLabel, formatStack, type ActionLog } from "./LiveFelt";
import { formatViewerBBOrUnavailable, formatViewerChipAndBB, formatViewerSignedChipAndBB } from "@/lib/tracker-poker/viewerAmounts";
import { markPokerSoundGesture, stopTrackerPokerSounds } from "@/lib/pokerLiveSound";

const SPEEDS = [0.5, 1, 2, 4, 8];
const STREET_LABELS: Record<string, string> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

export type ReplayFrameSource = "playback" | "scrub" | "jump";

interface ReplayScrubberProps {
  hand: ReplayHand;
  onFrame: (frame: ReplayFrame, source: ReplayFrameSource) => void;
  /**
   * B1 (liveReplayHud, viewer-only) — ADDITIVE; absent → render byte-identical.
   * Adds the RPT-style HUD: a BB/ANTE + POT (±BB) strip, a jump-to-end button, and
   * TÓM TẮT | HÀNH ĐỘNG tabs (winner rows ±BB + hand-summary bullets). All amounts use
   * the HAND's OWN blind (detectBigBlind), never the current clock level.
   */
  hud?: boolean;
  /**
   * UAT wave 2 (liveFeltCompact, viewer-only) — ADDITIVE; absent → frames are
   * byte-identical to today's. Frame seats additionally carry `current_bet` (chips
   * this street) + `total_committed` (ALL-IN pill amount) for the felt chip layer.
   */
  trackBets?: boolean;
  onSpeedChange?: (speed: number) => void;
  /** The sole verified winner/rank model shared with the felt. */
  showdownPresentation?: VerifiedShowdownPresentation | null;
  /** Ephemeral playback-only state; never changes the replay frame or settlement. */
  onRunoutPresentation?: (presentation: ReplayRunoutPresentation | null) => void;
  selectedPotIndex?: number;
  onSelectedPotIndexChange?: (potIndex: number) => void;
}

export function ReplayScrubber({
  hand,
  onFrame,
  hud = false,
  trackBets = false,
  onSpeedChange,
  showdownPresentation = null,
  onRunoutPresentation,
  selectedPotIndex = 0,
  onSelectedPotIndexChange,
}: ReplayScrubberProps) {
  const { t } = useTranslation();
  const frames = useMemo(() => buildReplayFrames(hand, { trackBets }), [hand, trackBets]);
  const streetIdx = useMemo(() => streetFrameIndex(frames), [frames]);
  const lastIndex = frames.length - 1;
  const fullRefund = hand.publicSettlement?.status === "verified"
    && hand.publicSettlement.pots.length === 0 && hand.publicSettlement.refunds.length === 1
    ? hand.publicSettlement.refunds[0] : null;

  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  // The viewer HUD uses a readable 1× cinematic baseline. Legacy/operator replay
  // remains at its previous 2× default.
  const [speed, setSpeed] = useState(() => hud ? 1 : 2);
  const [runoutPresentation, setRunoutPresentation] = useState<ReplayRunoutPresentation | null>(null);
  const [frameSource,setFrameSource] = useState<ReplayFrameSource>("jump");

  useEffect(() => {
    onSpeedChange?.(speed);
  }, [onSpeedChange, speed]);

  const handKey = hand.hand_id ?? `hand-${hand.hand_number}`;
  const settlementFingerprint = useMemo(() => {
    const settlement = hand.publicSettlement;
    if (!settlement) return "none";
    return [
      settlement.schemaVersion,
      settlement.status,
      settlement.players
        .map((player) => `${player.playerId}:${player.potAward}:${player.refund}:${player.netDelta}`)
        .sort()
        .join("|"),
      settlement.pots
        .map((pot) => `${pot.potId}:${pot.amount}:${[...pot.winnerIds].sort().join(",")}:${pot.allocations
          .map((allocation) => `${allocation.winnerId}:${allocation.amount}`)
          .sort()
          .join(",")}`)
        .sort()
        .join("|"),
      settlement.refunds
        .map((refund) => `${refund.playerId}:${refund.amount}:${refund.sourceActionId}`)
        .sort()
        .join("|"),
      settlement.handRanks
        .map((rank) => `${rank.playerId}:${rank.category}:${rank.bestFive.join(",")}:${rank.kickers.join(",")}`)
        .sort()
        .join("|"),
    ].join("/");
  }, [hand.publicSettlement]);
  const runoutKey = `${handKey}:${lastIndex}:${settlementFingerprint}`;
  const sortedActions = useMemo(
    () => [...(hand.actions || [])].sort((a, b) => a.action_order - b.action_order),
    [hand]
  );
  // Scheduling must know the terminal proof BEFORE reaching the terminal frame.
  // The parent's presentation is deliberately disabled on earlier frames so it
  // cannot reveal winners/cards early; using it here skipped the whole payout.
  const terminalPresentation = useMemo(() => hud && frames[lastIndex]
    ? resolveVerifiedPayoutPresentation({
        handId: hand.hand_id ?? `hand-${hand.hand_number}`,
        frame: frames[lastIndex],
        finalFrameIndex: lastIndex,
        settlement: hand.publicSettlement,
      })
    : null, [frames, hand, hud, lastIndex]);
  const hasVerifiedPayoutSequence = hud
    && terminalPresentation?.enabled === true
    && (terminalPresentation?.potLayers.length ?? 0) > 0;
  const hasCinematicAllInRunout = hasVerifiedPayoutSequence
    && frames[lastIndex]?.revealHoleCards === true
    && frames[lastIndex]?.displayCards.filter(Boolean).length === 5
    && sortedActions.some((action) => action.action_type === "all_in");
  const verifiedPotLayerCount = hasVerifiedPayoutSequence ? (terminalPresentation?.potLayers.length ?? 0) : 0;
  const publishRunoutPresentation = useCallback((presentation: ReplayRunoutPresentation | null) => {
    setRunoutPresentation(presentation);
    onRunoutPresentation?.(presentation);
  }, [onRunoutPresentation]);

  // New hand → rewind and pause. The public presentation key prevents a late
  // timer from carrying a previous result into the next hand.
  useEffect(() => {
    setFrameSource("jump");
    setStep(0);
    setIsPlaying(false);
    setSpeed(hud ? 1 : 2);
    publishRunoutPresentation(null);
  }, [hand, hud, publishRunoutPresentation]);

  useEffect(() => () => onRunoutPresentation?.(null), [onRunoutPresentation]);

  // Push the current frame up to the parent felt.
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  useEffect(() => {
    const f = frames[Math.min(step, lastIndex)];
    if (f) onFrameRef.current(f, frameSource);
  }, [step, frames, lastIndex,frameSource]);

  // A cancellable playback timeline replaces the fixed interval. Standard action
  // steps retain their speed behavior; verified payouts always get the pot award
  // cadence, while all-in hands also receive the staged board runout. Scrub,
  // jump, and hand changes clear this effect.
  useEffect(() => {
    if (!isPlaying) return;
    if (step < lastIndex) {
      const enteringVerifiedPayout = step === lastIndex - 1 && hasVerifiedPayoutSequence;
      const timer = window.setTimeout(() => {
        setFrameSource("playback");
        if (enteringVerifiedPayout) {
          const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
          const lastPotIndex = Math.max(0, verifiedPotLayerCount - 1);
          publishRunoutPresentation(createReplayRunoutPresentation(
            runoutKey,
            reducedMotion ? "static" : hasCinematicAllInRunout ? "hole_hold" : "pot_collect",
            reducedMotion ? lastPotIndex : null,
          ));
        }
        setStep((currentStep) => Math.min(lastIndex, currentStep + 1));
      }, 1000 / speed);
      return () => window.clearTimeout(timer);
    }

    if (!runoutPresentation || runoutPresentation.key !== runoutKey) {
      setIsPlaying(false);
      return;
    }
    const nextPresentation = nextReplayRunoutPresentation(runoutPresentation, verifiedPotLayerCount);
    if (!nextPresentation) {
      setIsPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      publishRunoutPresentation(nextPresentation);
      if (nextPresentation.phase === "static") setIsPlaying(false);
    }, replayRunoutPhaseDuration(runoutPresentation.phase, speed));
    return () => window.clearTimeout(timer);
  }, [hasCinematicAllInRunout, hasVerifiedPayoutSequence, isPlaying, lastIndex, publishRunoutPresentation, runoutKey, runoutPresentation, speed, step, verifiedPotLayerCount]);

  const pauseTo = (nextStep: number) => {
    if (hud) stopTrackerPokerSounds();
    markPokerSoundGesture("tracker");
    setFrameSource("scrub");
    const entersVerifiedPayout = nextStep === lastIndex && hasVerifiedPayoutSequence;
    const reducedMotion = entersVerifiedPayout
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const lastPotIndex = Math.max(0, verifiedPotLayerCount - 1);
    publishRunoutPresentation(entersVerifiedPayout
      ? reducedMotion
        ? createReplayRunoutPresentation(runoutKey, "static", lastPotIndex)
        : createReplayRunoutPresentation(runoutKey, "pot_collect")
      : null);
    setIsPlaying(entersVerifiedPayout && !reducedMotion);
    setStep(Math.max(0, Math.min(lastIndex, nextStep)));
  };

  const togglePlay = () => {
    markPokerSoundGesture("tracker");
    if (hud && isPlaying) stopTrackerPokerSounds();
    if (runoutPresentation && runoutPresentation.phase !== "static") {
      setIsPlaying(playing => !playing);
      return;
    }
    if (step >= lastIndex) {
      setFrameSource("jump");
      publishRunoutPresentation(null);
      setStep(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((p) => !p);
    }
  };

  const presentStreets = useMemo(
    () => Object.keys(STREET_LABELS).filter((s) => s in streetIdx),
    [streetIdx]
  );

  const currentStreet = frames[Math.min(step, lastIndex)]?.currentStreet;
  const current = frames[Math.min(step, lastIndex)];
  const currentPresentation = showdownPresentation?.enabled
    && showdownPresentation.handId === hand.hand_id
    && showdownPresentation.frameIndex === current?.index
    ? showdownPresentation
    : null;
  const potScopedPresentation = runoutPresentation?.key === runoutKey && runoutPresentation.potAwardIndex != null
    ? selectVerifiedPotLayerPresentation(currentPresentation, runoutPresentation.potAwardIndex)
    : null;
  const directMainPotPresentation = hasVerifiedPayoutSequence && !runoutPresentation
    ? selectVerifiedPotLayerPresentation(currentPresentation, selectedPotIndex)
    : null;
  const visiblePresentation = potScopedPresentation?.enabled
    ? potScopedPresentation
    : directMainPotPresentation?.enabled
      ? directMainPotPresentation
      : hasVerifiedPayoutSequence && runoutPresentation
        ? null
        : currentPresentation;
  const summaryVisible = visiblePresentation != null
    && (!runoutPresentation || (runoutPresentation.key === runoutKey && replayRunoutShowsSummary(runoutPresentation.phase)));
  const publicName = (name: string | null | undefined, playerId: string): string => {
    const trimmed = name?.trim() || "";
    const rawPrefix = playerId.slice(0, 6).toLowerCase();
    return trimmed && trimmed.toLowerCase() !== rawPrefix && !/^[a-f0-9]{6}$/i.test(trimmed)
      ? trimmed
      : t("liveHub.replay.unknownPlayer", "Người chơi");
  };

  // ── B1 HUD derivations (hud-only; all from the HAND's own data, never the clock) ──
  const [hudTab, setHudTab] = useState<"summary" | "actions">("summary");
  const bb = useMemo(() => (hud ? detectBigBlind(hand) : 0), [hud, hand]);
  const ante = useMemo(
    () => (hud ? Math.max(0, ...sortedActions.filter((a) => a.action_type === "post_ante").map((a) => a.action_amount), 0) : 0),
    [hud, sortedActions]
  );
  const amountForHud = (n: number): string => formatViewerBBOrUnavailable(n, bb);
  // Hand-summary bullets reveal only actions reached by the current replay frame.
  const bullets = (() => {
    if (!hud) return [];
    const out: string[] = [];
    const nameOf = (pid: string) => publicName(hand.players.find((p) => p.player_id === pid)?.display_name, pid);
    for (const a of sortedActions.slice(0, current?.index ?? 0)) {
      if (a.action_type === "all_in") {
        out.push(t("liveHub.replay.allInSummary", "{{name}} all-in {{amount}}", {
          name: nameOf(a.player_id),
          amount: amountForHud(a.action_amount),
        }));
      }
    }
    return out.slice(0, 6);
  })();

  return (
    <div
      data-testid={hud ? "replay-action-rail" : undefined}
      className={hud
        ? "min-w-0 space-y-3 rounded-2xl border border-[hsl(var(--viewer-neon)_/_0.3)] bg-card/75 p-3.5 shadow-[0_18px_48px_hsl(var(--background)_/_0.35)] sm:p-4"
        : "mt-3 bg-card border border-amber-500/25 rounded-xl p-3 space-y-3"}
    >
      {/* B1 HUD strip — the RPT-style BB/ANTE + POT bar (hand's own blind, not the clock) */}
      {hud && (
        <div data-testid="replay-hud-bar" className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-background/45 px-3 py-2 text-[11px]">
          <span className="tracker-num font-bold text-[hsl(var(--viewer-neon))]">
            BB{ante > 0 ? "/ANTE" : ""} {bb > 0 ? formatStack(bb) : "—"}
            {ante > 0 ? ` / ${formatStack(ante)}` : ""}
          </span>
          <span className="tracker-num font-bold text-success">
            POT {amountForHud(current?.potSize ?? 0)}
          </span>
          {current?.showdownResult && (
            <span className={`rounded-md border px-1.5 py-1 text-[9px] font-black uppercase tracking-wider ${
              current.showdownResult === "chop"
                ? "border-[hsl(var(--viewer-neon)_/_0.5)] text-[hsl(var(--viewer-neon))]"
                : current.showdownResult === "needs_resettle"
                  ? "border-amber-500/50 text-amber-300"
                  : "border-[hsl(var(--poker-gold)_/_0.5)] text-[hsl(var(--poker-gold))]"
            }`}>
              {current.showdownResult === "chop"
                ? t("liveHub.felt.chopPot", "Chop pot")
                : current.showdownResult === "needs_resettle"
                  ? t("liveHub.felt.needsResettle", "Cần tính lại")
                  : t("liveHub.felt.showdown", "Showdown")}
            </span>
          )}
          {bb <= 0 && <span className="w-full text-[10px] text-amber-300">{t("liveHub.replay.missingBlind", "Chưa có blind của hand")}</span>}
        </div>
      )}
      {/* Street tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {presentStreets.map((s) => (
          <button
            key={s}
            onClick={() => pauseTo(streetIdx[s])}
            className={`${hud ? "min-h-11 rounded-xl px-3 py-1.5" : "px-2.5 py-1 rounded-md"} text-[11px] font-bold uppercase tracking-wider border transition-colors ${
              currentStreet === s
                ? hud
                  ? "bg-[hsl(var(--viewer-neon)_/_0.14)] text-[hsl(var(--viewer-neon))] border-[hsl(var(--viewer-neon)_/_0.45)]"
                  : "bg-amber-500/20 text-amber-300 border-amber-500/40"
                : hud
                  ? "text-muted-foreground border-border hover:border-[hsl(var(--viewer-neon)_/_0.4)]"
                  : "text-muted-foreground border-border hover:border-amber-500/40"
            }`}
          >
            {STREET_LABELS[s]}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground font-mono">
          {step}/{lastIndex}
        </span>
      </div>

      {/* Timeline slider */}
      <Slider
        value={[Math.min(step, lastIndex)]}
        min={0}
        max={Math.max(lastIndex, 1)}
        step={1}
        onValueChange={(v) => pauseTo(v[0])}
        aria-label={hud ? t("liveHub.replay.scrub", "Tua lại ván") : "Tua lại hand"}
        className={hud ? "py-2" : undefined}
      />

      {/* Transport + speed */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className={hud ? "flex items-center gap-1.5" : "flex items-center gap-1.5"}>
          <button
            onClick={() => pauseTo(0)}
            title={hud ? t("liveHub.replay.rewind", "Về đầu") : "Về đầu"}
            className={hud ? "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-[hsl(var(--viewer-neon)_/_0.4)] hover:text-[hsl(var(--viewer-neon))]" : "p-1.5 rounded-md border border-border text-muted-foreground hover:border-amber-500/40 hover:text-amber-300 transition-colors"}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => pauseTo(step - 1)}
            title={hud ? t("liveHub.replay.previous", "Lùi 1 bước") : "Lùi 1 bước"}
            className={hud ? "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-[hsl(var(--viewer-neon)_/_0.4)] hover:text-[hsl(var(--viewer-neon))]" : "p-1.5 rounded-md border border-border text-muted-foreground hover:border-amber-500/40 hover:text-amber-300 transition-colors"}
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={togglePlay}
            title={hud
              ? isPlaying ? t("liveHub.replay.pause", "Tạm dừng") : t("liveHub.replay.play", "Phát")
              : isPlaying ? "Tạm dừng" : "Phát"}
            className={hud ? "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-[hsl(var(--viewer-neon))] text-[hsl(var(--viewer-neon-ink))] font-bold transition hover:bg-[hsl(var(--viewer-neon-bright))]" : "p-2 rounded-md bg-amber-500/90 hover:bg-amber-400 text-black font-bold transition-colors"}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            onClick={() => pauseTo(step + 1)}
            title={hud ? t("liveHub.replay.next", "Tiến 1 bước") : "Tiến 1 bước"}
            className={hud ? "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-[hsl(var(--viewer-neon)_/_0.4)] hover:text-[hsl(var(--viewer-neon))]" : "p-1.5 rounded-md border border-border text-muted-foreground hover:border-amber-500/40 hover:text-amber-300 transition-colors"}
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
          {hud && (
            <button
            onClick={() => pauseTo(lastIndex)}
              title={t("liveHub.replay.toEnd", "Tới cuối (showdown)")}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-[hsl(var(--viewer-neon)_/_0.4)] hover:text-[hsl(var(--viewer-neon))]"
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className={hud ? "flex max-w-full items-center gap-1 overflow-x-auto" : "flex items-center gap-1"}>
          <span className="text-[10px] text-muted-foreground mr-1">{hud ? t("liveHub.replay.speed", "Tốc độ") : "Tốc độ"}</span>
          {SPEEDS.map((sp) => (
            <button
              key={sp}
              onClick={() => setSpeed(sp)}
              className={`${hud ? "min-h-11 min-w-11 rounded-xl px-2 py-1" : "px-1.5 py-0.5 rounded"} text-[10px] font-mono font-bold border transition-colors ${
                speed === sp
                  ? hud
                    ? "bg-[hsl(var(--viewer-neon)_/_0.15)] text-[hsl(var(--viewer-neon))] border-[hsl(var(--viewer-neon)_/_0.4)]"
                    : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  : hud
                    ? "text-muted-foreground border-border hover:border-[hsl(var(--viewer-neon)_/_0.4)]"
                    : "text-muted-foreground border-border hover:border-emerald-500/40"
              }`}
            >
              {sp}×
            </button>
          ))}
        </div>
      </div>

      {/* B1: TÓM TẮT | HÀNH ĐỘNG tabs (hud only; !hud renders the list exactly as today) */}
      {hud && (
        <div className="grid grid-cols-2 gap-1.5 border-t border-border/20 pt-3">
          {(["summary", "actions"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setHudTab(tab)}
              className={`min-h-11 rounded-xl border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                hudTab === tab
                  ? "bg-[hsl(var(--viewer-neon)_/_0.14)] text-[hsl(var(--viewer-neon))] border-[hsl(var(--viewer-neon)_/_0.45)]"
                  : "text-muted-foreground border-border hover:border-[hsl(var(--viewer-neon)_/_0.4)]"
              }`}
            >
              {tab === "summary" ? t("liveHub.replay.summary", "Tóm tắt") : t("liveHub.replay.actions", "Hành động")}
            </button>
          ))}
        </div>
      )}

      {hud && hudTab === "summary" && (
        <div data-testid="replay-hud-summary" aria-live="polite" className="space-y-2">
          {summaryVisible && (currentPresentation?.potLayers.length ?? 0) > 1 && (
            <div className="flex max-w-full gap-1.5 overflow-x-auto pb-0.5" aria-label={t("liveHub.replay.choosePot", "Chọn pot") }>
              {currentPresentation!.potLayers.map((pot, potIndex) => (
                <button
                  key={pot.potId}
                  type="button"
                  data-testid={`replay-pot-selector-${potIndex}`}
                  onClick={() => {
                    stopTrackerPokerSounds();
                    setIsPlaying(false);
                    publishRunoutPresentation(null);
                    onSelectedPotIndexChange?.(potIndex);
                  }}
                  className={`min-h-11 shrink-0 rounded-xl border px-3 text-[10px] font-black uppercase tracking-wider ${(runoutPresentation?.potAwardIndex ?? selectedPotIndex) === potIndex ? "border-[hsl(var(--poker-gold)/.68)] bg-[hsl(var(--poker-gold)/.12)] text-[hsl(var(--poker-gold))]" : "border-border text-muted-foreground"}`}
                >
                  {pot.kind === "main" ? t("liveHub.felt.mainPot", "Main Pot") : t("liveHub.felt.sidePot", "Side Pot")} · {amountForHud(pot.amount)}
                </button>
              ))}
            </div>
          )}
          {summaryVisible && visiblePresentation.isChop && (
            <div data-testid="replay-hud-chop" className="rounded-xl border border-[hsl(var(--viewer-neon)_/_0.35)] bg-[hsl(var(--viewer-neon)_/_0.08)] px-3 py-2 text-xs font-semibold text-[hsl(var(--viewer-neon))]">
              {t("liveHub.felt.chopPot", "Chop pot")}
            </div>
          )}
          {current?.showdownResult === "needs_resettle" && (
            <div data-testid="replay-hud-needs-resettle" className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200">
              {t("liveHub.felt.needsResettle", "Cần tính lại kết quả")}
            </div>
          )}
          {summaryVisible && visiblePresentation.winners.length > 0 && (
            <div className="space-y-1">
              {visiblePresentation.winners.map((winner) => (
                <div
                  key={winner.playerId}
                  data-testid={`replay-hud-winner-${winner.playerId}`}
                  className="tracker-showdown-result min-h-11 rounded-xl border border-[hsl(var(--viewer-neon)_/_0.18)] bg-[linear-gradient(135deg,hsl(var(--viewer-neon)_/_0.08),hsl(var(--background)_/_0.58))] px-3 py-2.5 text-xs"
                >
                  <span className="sr-only">{t("liveHub.replay.verifiedWinner", "Người thắng đã được xác minh")}: </span>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-foreground">
                    {publicName(winner.playerName, winner.playerId)}
                    {winner.seatNumber > 0 && (
                      <span className="font-normal text-muted-foreground">
                        {" — "}{t("liveHub.seat", "Ghế {{n}}", { n: winner.seatNumber })}
                      </span>
                    )}
                    </div>
                    <div data-testid={`replay-hud-ranking-${winner.playerId}`} className="mt-0.5 truncate text-[11px] font-medium text-[hsl(var(--poker-gold))]">
                      {winner.rankingText}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {step === lastIndex && current?.showdownResult !== "needs_resettle" && !currentPresentation && !runoutPresentation && hand.publicHistoryResult?.status === "verified" && (
            <div data-testid="replay-history-verified-result" className="space-y-1 rounded-xl border border-border/60 bg-background/35 px-3 py-2 text-xs">
              <div className="font-bold text-[hsl(var(--viewer-neon))]">{t("liveHub.replay.historyVerifiedResult", "Kết quả History đã xác minh")}</div>
              {hand.publicHistoryResult.recipients.map((recipient, index) => (
                <div key={`${recipient.playerId}:${index}`} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{publicName(recipient.name, recipient.playerId)}{recipient.seatNumber ? ` · ${t("liveHub.seat", "Ghế {{n}}", { n: recipient.seatNumber })}` : ""}</span>
                  <span className="tracker-num shrink-0 font-semibold">{formatViewerSignedChipAndBB(recipient.netDelta, bb)}</span>
                </div>
              ))}
            </div>
          )}
          {step === lastIndex && current?.showdownResult !== "needs_resettle" && fullRefund && (
            <div data-testid="replay-full-refund" className="rounded-xl border border-border/60 bg-background/35 px-3 py-2 text-xs text-muted-foreground">
              <div className="font-semibold">{t("liveHub.replay.fullRefund", "Đã xác minh: hoàn trả toàn bộ cược chưa được theo.")}</div>
              <div>{publicName(hand.players.find((player) => player.player_id === fullRefund.playerId)?.display_name, fullRefund.playerId)} · {formatViewerChipAndBB(fullRefund.amount, bb)}</div>
            </div>
          )}
          {current?.showdownResult !== "needs_resettle" && !currentPresentation && !runoutPresentation && !(step === lastIndex && (hand.publicHistoryResult?.status === "verified" || fullRefund)) && (
            <div className="text-[11px] text-muted-foreground">{t("liveHub.replay.noResult", "Chưa có kết quả — xem tab Hành động.")}</div>
          )}
          {bullets.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-muted-foreground">
              {bullets.map((b, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-amber-400/70">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Current action + action list */}
      {(!hud || hudTab === "actions") && current?.latestAction && (
        <div className={hud ? "border-t border-border/20 pt-3 text-xs text-foreground" : "text-xs text-amber-100 border-t border-border/20 pt-2"}>
          {(!hud || current.latestAction.seat_number > 0) && <span className={hud ? "text-muted-foreground" : "text-amber-300/70"}>{hud ? t("liveHub.seat", "Ghế {{n}}", { n: current.latestAction.seat_number }) : `Ghế ${current.latestAction.seat_number}`} · </span>}
          <span className={hud ? "font-semibold text-[hsl(var(--viewer-neon))]" : "font-semibold text-emerald-300"}>{hud ? publicName(current.latestAction.display_name, current.latestAction.player_id) : current.latestAction.display_name}</span>{" "}
          {formatActionLabel(current.latestAction, hud ? amountForHud : formatStack)}
        </div>
      )}

      {(!hud || hudTab === "actions") && (
      <div className={hud ? "max-h-[min(42vh,460px)] space-y-1 overflow-y-auto pr-1" : "max-h-40 overflow-y-auto space-y-0.5 pr-1"}>
        {sortedActions.map((a, i) => {
          const label = formatActionLabel({
            street: a.street,
            display_name: "",
            seat_number: 0,
            action_type: a.action_type,
            action_amount: a.action_amount,
            action_order: a.action_order,
          } as ActionLog, hud ? amountForHud : formatStack);
          const rawName = hand.players.find((p) => p.player_id === a.player_id)?.display_name;
          const name = hud ? publicName(rawName, a.player_id) : rawName || a.player_id.slice(0, 6);
          const active = step === i + 1;
          return (
            <button
              key={a.action_order}
              onClick={() => pauseTo(i + 1)}
              className={hud
                ? `min-h-11 w-full flex justify-between items-center rounded-xl border border-border/35 px-3 py-2 text-left text-xs transition-colors ${active ? "bg-[hsl(var(--viewer-neon)_/_0.14)] text-[hsl(var(--viewer-neon))]" : "hover:bg-secondary/40"}`
                : `w-full flex justify-between items-center px-1.5 py-1 rounded text-xs border-b border-border/10 last:border-0 transition-colors ${active ? "bg-amber-500/15 text-amber-200" : "hover:bg-secondary/40"}`}
            >
              <span className="text-muted-foreground">
                <span className={hud ? "text-[9px] uppercase tracking-wider text-[hsl(var(--viewer-neon)_/_0.7)] mr-1.5" : "text-[9px] uppercase tracking-wider text-amber-400/60 mr-1.5"}>
                  {STREET_LABELS[a.street]?.slice(0, 2) || a.street.slice(0, 2)}
                </span>
                <span className={hud ? "text-[hsl(var(--viewer-neon-bright))] font-semibold" : "text-emerald-400 font-semibold"}>{name}</span>
              </span>
              <span
                className={`font-semibold ${a.action_amount > 0 ? (hud ? "text-[hsl(var(--viewer-neon-bright))]" : "text-amber-400") : "text-muted-foreground"}`}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}
