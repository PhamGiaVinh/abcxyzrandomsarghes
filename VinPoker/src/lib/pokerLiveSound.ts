import { FEATURES } from "@/lib/featureFlags";

export type PokerLiveSound =
  | "deal_one"
  | "deal"
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "all_in"
  | "post_sb"
  | "post_bb"
  | "post_ante"
  // liveTableFx enriched kinds — synth-only (no MP3); called ONLY when the flag is on,
  // so flag-OFF audio is byte-identical to today.
  | "deal_flop"
  | "deal_turn"
  | "deal_river"
  | "showdown"
  | "hand_ranking"
  | "fold_muck"
  | "chip"
  // C4 (trackerActionSounds) — chips gathered into the pot on a street change /
  // hand end. Only ever fired by flag-gated callers.
  | "pot_collect"
  /** Ascending chip accent when one verified Main/Side Pot reaches its winner(s). */
  | "pot_award";

const MP3_BY_KIND: Partial<Record<PokerLiveSound, string>> = {
  deal: "/sounds/poker/deal-card.mp3",
  call: "/sounds/poker/poker-bet.mp3",
  bet: "/sounds/poker/poker-bet.mp3",
  raise: "/sounds/poker/poker-bet.mp3",
  all_in: "/sounds/poker/poker-bet.mp3",
  post_sb: "/sounds/poker/poker-bet.mp3",
  post_bb: "/sounds/poker/poker-bet.mp3",
  post_ante: "/sounds/poker/poker-bet.mp3",
};

// C4 — the owner's recorded clips (public/sounds/tracker/, provenance in LICENSES.md
// there). Consulted ONLY when FEATURES.trackerActionSounds is on, so flag-OFF
// resolution is byte-identical to MP3_BY_KIND above. bet/call/raise/all_in are
// deliberately absent (they keep poker-bet.mp3 — owner decision).
const TRACKER_MP3_BY_KIND: Partial<Record<PokerLiveSound, string>> = {
  deal_one: "/sounds/tracker/deal-one.mp3",
  post_sb: "/sounds/tracker/post-chip.mp3",
  post_bb: "/sounds/tracker/post-chip.mp3",
  post_ante: "/sounds/tracker/post-chip.mp3",
  check: "/sounds/tracker/check.mp3",
  fold: "/sounds/tracker/fold.mp3",
  fold_muck: "/sounds/tracker/fold.mp3",
  deal_flop: "/sounds/tracker/deal-flop-2534.mp3",
  deal_turn: "/sounds/tracker/deal-turn-river-2535.mp3",
  deal_river: "/sounds/tracker/deal-turn-river-2535.mp3",
  pot_collect: "/sounds/tracker/pot-collect.mp3",
  pot_award: "/sounds/tracker/pot-award-2531.mp3",
  showdown: "/sounds/tracker/showdown-2533.mp3",
  hand_ranking: "/sounds/tracker/hand-ranking-2536.mp3",
};

/** MP3 source a kind resolves to (exported so tests can pin flag-OFF byte-identity). */
export function mp3SrcFor(kind: PokerLiveSound): string | undefined {
  return (FEATURES.trackerActionSounds ? TRACKER_MP3_BY_KIND[kind] : undefined) ?? MP3_BY_KIND[kind];
}

let audioContext: AudioContext | null = null;
let userGestureSeen = false;
let listenersAttached = false;
let trackerGestureEnabled = false;
const lastPlayedAt = new Map<PokerLiveSound, number>();

// ── mute (player preference, persisted) ──────────────────────────────────────
const MUTE_KEY = "vinpoker:poker:sound-muted";
let muted = (() => {
  try { return typeof localStorage !== "undefined" && localStorage.getItem(MUTE_KEY) === "1"; }
  catch { return false; }
})();

/** Is poker sound currently muted by the player? */
export function isPokerSoundMuted(): boolean {
  return muted;
}

/** Mute / unmute poker sound (persisted to localStorage). */
export function setPokerSoundMuted(v: boolean): void {
  muted = v;
  try { localStorage.setItem(MUTE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
}

function ensureGestureListeners() {
  if (listenersAttached || typeof window === "undefined") return;
  listenersAttached = true;

  const markGesture = () => {
    markPokerSoundGesture(trackerGestureEnabled ? "tracker" : "legacy");
  };

  window.addEventListener("pointerdown", markGesture, { passive: true });
  window.addEventListener("keydown", markGesture);
  window.addEventListener("touchstart", markGesture, { passive: true });
  // iOS may require touchend, and may suspend again after backgrounding.
  window.addEventListener("touchend", markGesture, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopTrackerPokerSounds();
  });
}

function canPlay(kind: PokerLiveSound, bypassStoredMute = false) {
  if (muted && !bypassStoredMute) return false;
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  ensureGestureListeners();
  if (!userGestureSeen) return false;
  const now = Date.now();
  // Throttle is PER-KIND (Map keyed by kind), so deal_flop / deal_turn / deal_river
  // never throttle each other — a turn dealt <180ms after the flop still sounds.
  const throttleMs = kind === "deal_one" ? 0 : kind.startsWith("deal") ? 150 : 70;
  if (now - (lastPlayedAt.get(kind) ?? 0) < throttleMs) return false;
  lastPlayedAt.set(kind, now);
  return true;
}

export type PokerLiveSoundProfile = "legacy" | "tracker";

type PokerLiveSoundOptions = {
  /** Tracker owns a separate mute preference from the Online Poker table. */
  bypassStoredMute?: boolean;
  /** Keeps replay loudness normalization scoped to the Tracker. */
  profile?: PokerLiveSoundProfile;
};

function playbackRateFor(kind: PokerLiveSound) {
  if (kind === "raise") return 1.05;
  if (kind === "all_in") return 1.12;
  if (kind === "call") return 0.96;
  return 1;
}

/** Normalizes the supplied library clips to a consistent Tracker replay level. */
export function pokerSoundVolumeFor(kind: PokerLiveSound, profile: PokerLiveSoundProfile = "legacy"): number {
  // Other Poker surfaces retain their existing source levels. Tracker explicitly
  // opts into this profile because its recorded clips have a much lower master.
  if (profile !== "tracker") return kind === "deal" ? 0.32 : 0.4;
  switch (kind) {
    case "deal": return 0.7;
    case "deal_one": return 0.9;
    case "call": return 0.34;
    case "bet": return 0.36;
    case "raise": return 0.4;
    case "all_in": return 0.44;
    case "post_sb":
    case "post_bb":
    case "post_ante": return 0.29;
    case "check": return 1;
    case "fold":
    case "fold_muck": return 0.9;
    case "deal_flop": return 1;
    case "deal_turn":
    case "deal_river": return 1;
    case "pot_collect": return 0.95;
    case "pot_award": return 1;
    case "showdown":
    case "hand_ranking": return 1;
    default: return 0.4;
  }
}

// Kinds with a synth voice to fall back to when an MP3 fails to load/play. The
// enriched kinds only reach playMp3 via the flag-gated tracker map, so flag-OFF
// behavior is unchanged (fold/check keep their legacy fallback).
const SYNTH_FALLBACK_KINDS = new Set<PokerLiveSound>([
  "fold", "check", "deal_flop", "deal_turn", "deal_river", "showdown", "hand_ranking", "fold_muck", "chip", "pot_collect", "pot_award",
]);

const activeTrackerSounds = new Set<HTMLAudioElement>();
const trackerBuffers = new Map<string, Promise<AudioBuffer>>();
const trackerSources = new Set<AudioBufferSourceNode>();
let trackerSoundGeneration = 0;

/** Scheduled presentation cues must capture this before waiting, including pause. */
export function trackerSoundCancellationToken(): number { return trackerSoundGeneration; }
export function cancelPendingTrackerPokerSounds(): void { trackerSoundGeneration++; }

function loadTrackerBuffer(ctx: AudioContext, src: string): Promise<AudioBuffer> {
  const cached = trackerBuffers.get(src);
  if (cached) return cached;
  const pending = fetch(src).then(response => {
    if (!response.ok) throw new Error("Tracker sound unavailable");
    return response.arrayBuffer();
  }).then(bytes => ctx.decodeAudioData(bytes)).catch(error => {
    trackerBuffers.delete(src);
    throw error;
  });
  trackerBuffers.set(src, pending);
  return pending;
}

/** Delayed cues share the context unlocked by Play/unmute, including on iOS. */
function playTrackerBuffer(kind: PokerLiveSound, src: string, ctx: AudioContext) {
  const generation = trackerSoundGeneration;
  const requestedAt = Date.now();
  void loadTrackerBuffer(ctx, src).then(buffer => {
    // A late download must not replay audio from a previous hand or street.
    if (generation !== trackerSoundGeneration || document.hidden || Date.now() - requestedAt > 750 || ctx.state !== "running") return;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackRateFor(kind);
    gain.gain.value = pokerSoundVolumeFor(kind, "tracker");
    source.connect(gain);
    gain.connect(ctx.destination);
    trackerSources.add(source);
    source.onended = () => { trackerSources.delete(source); source.disconnect(); gain.disconnect(); };
    source.start();
    if (kind === "all_in") playSynthOnContext(ctx, kind);
  }).catch(() => {
    if (generation === trackerSoundGeneration && !document.hidden && Date.now() - requestedAt <= 750 && ctx.state === "running" && SYNTH_FALLBACK_KINDS.has(kind)) {
      playSynthOnContext(ctx, kind);
    }
  });
}

/** Cancel the previous hand's recorded cues without affecting Online Poker. */
export function stopTrackerPokerSounds(): void {
  cancelPendingTrackerPokerSounds();
  for (const source of trackerSources) { source.stop(); }
  trackerSources.clear();
  for (const sound of activeTrackerSounds) { sound.pause(); sound.currentTime = 0; }
  activeTrackerSounds.clear();
}

function playMp3(kind: PokerLiveSound, src: string, profile: PokerLiveSoundProfile) {
  if (profile === "tracker") {
    const ctx = ensureCtx();
    if (ctx) { playTrackerBuffer(kind, src, ctx); return; }
  }
  const audio = new Audio(src);
  if (profile === "tracker") {
    activeTrackerSounds.add(audio);
    audio.onended = () => { activeTrackerSounds.delete(audio); };
  }
  audio.volume = pokerSoundVolumeFor(kind, profile);
  audio.playbackRate = playbackRateFor(kind);
  void audio.play().catch(() => {
    if (profile === "tracker" && !activeTrackerSounds.delete(audio)) return;
    if (SYNTH_FALLBACK_KINDS.has(kind)) playSynth(kind);
  });
  // The base bet clip is intentionally reused for action consistency. A quiet
  // semantic accent differentiates raise/all-in without adding an asset/runtime.
  if (kind === "raise" || kind === "all_in") playSynth(kind);
}

/** Single lazy AudioContext (never create a second one). */
function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return null;
  audioContext ??= new AudioCtor();
  return audioContext;
}

/**
 * One filtered-noise burst (the building block for chip clinks / card swooshes /
 * the muck slide). Noise → bandpass → gain envelope; exponential decay to ~0.001
 * (never to 0); nodes disconnect on `onended` so they don't leak.
 */
function noiseBurst(
  ctx: AudioContext,
  startAt: number,
  dur: number,
  freq: number,
  q: number,
  gain: number,
  sweepTo?: number,
) {
  const frames = Math.max(1, Math.ceil(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(freq, startAt);
  if (sweepTo) bp.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), startAt + dur);
  bp.Q.setValueAtTime(q, startAt);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, startAt);
  g.gain.exponentialRampToValueAtTime(0.001, startAt + dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(ctx.destination);
  src.start(startAt);
  src.stop(startAt + dur);
  src.onended = () => {
    try {
      src.disconnect();
      bp.disconnect();
      g.disconnect();
    } catch {
      /* ignore */
    }
  };
}

function playSynthOnContext(ctx: AudioContext, kind: PokerLiveSound) {
  try {
    const now = ctx.currentTime;
    switch (kind) {
      // Card deal swooshes — flop riffles in (3 staggered), turn/river = one card.
      case "deal_flop":
        noiseBurst(ctx, now, 0.06, 2600, 1.4, 0.2, 1800);
        noiseBurst(ctx, now + 0.06, 0.055, 2500, 1.4, 0.18, 1750);
        noiseBurst(ctx, now + 0.12, 0.05, 2400, 1.4, 0.16, 1700);
        return;
      case "deal_turn":
      case "deal_river":
      case "showdown":
        noiseBurst(ctx, now, 0.06, 2600, 1.4, 0.2, 1800);
        return;
      // Fold = cards mucked away: a longer, lower swoosh sweeping down.
      case "fold_muck":
        noiseBurst(ctx, now, 0.11, 2200, 1.2, 0.16, 900);
        return;
      // Chip clink = 2–3 short high filtered-noise bursts.
      case "chip":
        noiseBurst(ctx, now, 0.012, 4600, 3, 0.13);
        noiseBurst(ctx, now + 0.03, 0.01, 5200, 4, 0.1);
        noiseBurst(ctx, now + 0.058, 0.009, 4900, 3.5, 0.085);
        return;
      // Pot collect = a slide of chip clinks gathering toward the center (lower each
      // clink, like stacks sliding together). Fallback when pot-collect.mp3 fails.
      case "pot_collect":
        noiseBurst(ctx, now, 0.014, 4400, 3, 0.12);
        noiseBurst(ctx, now + 0.05, 0.013, 3900, 3, 0.11);
        noiseBurst(ctx, now + 0.11, 0.012, 3400, 2.5, 0.1);
        noiseBurst(ctx, now + 0.18, 0.05, 2400, 1.5, 0.09, 1400);
        return;
      // A pot award rises rather than gathers. It is intentionally lower than
      // action audio so a Main/Side Pot sequence stays legible instead of noisy.
      case "pot_award":
      case "hand_ranking":
        noiseBurst(ctx, now, 0.012, 3100, 3, 0.1, 3900);
        noiseBurst(ctx, now + 0.055, 0.011, 3900, 3.2, 0.09, 4700);
        noiseBurst(ctx, now + 0.11, 0.014, 4800, 3.4, 0.1, 5600);
        return;
      case "raise":
        noiseBurst(ctx, now, 0.012, 3000, 3, 0.055, 3900);
        noiseBurst(ctx, now + 0.06, 0.012, 4100, 3, 0.06, 5100);
        return;
      case "all_in":
        noiseBurst(ctx, now, 0.013, 2600, 2.8, 0.07, 3500);
        noiseBurst(ctx, now + 0.055, 0.014, 3700, 3, 0.075, 4800);
        noiseBurst(ctx, now + 0.12, 0.018, 4900, 3.2, 0.08, 6100);
        return;
      // Legacy tones (unchanged): fold beep / check tick.
      default: {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = kind === "fold" ? "triangle" : "sine";
        osc.frequency.setValueAtTime(kind === "fold" ? 180 : 520, now);
        gain.gain.setValueAtTime(kind === "fold" ? 0.06 : 0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + (kind === "fold" ? 0.14 : 0.08));
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + (kind === "fold" ? 0.16 : 0.1));
        osc.onended = () => {
          try {
            osc.disconnect();
            gain.disconnect();
          } catch {
            /* ignore */
          }
        };
      }
    }
  } catch {
    // Browser audio can be blocked; the tracker must continue silently.
  }
}

function playSynth(kind: PokerLiveSound) {
  const ctx = ensureCtx();
  if (!ctx || ctx.state === "closed") return;
  if (ctx.state === "suspended") {
    void ctx.resume().then(() => playSynthOnContext(ctx, kind)).catch(() => {
      // Browser audio can be blocked; the tracker must continue silently.
    });
    return;
  }
  playSynthOnContext(ctx, kind);
}

export function markPokerSoundGesture(profile: PokerLiveSoundProfile = "legacy") {
  if (profile === "tracker") trackerGestureEnabled = true;
  userGestureSeen = true;
  ensureGestureListeners();
  const ctx = ensureCtx();
  if (!ctx || ctx.state === "closed") return;
  if (ctx.state !== "running") void ctx.resume().catch(() => {});
  // Start a silent buffer synchronously within the touch/click handler. Merely
  // remembering a gesture does not unlock future HTMLAudio elements on mobile.
  const unlock = ctx.createBufferSource();
  unlock.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  unlock.connect(ctx.destination);
  unlock.onended = () => unlock.disconnect();
  unlock.start();
  if (profile !== "tracker") return;
  for (const src of new Set([...Object.values(TRACKER_MP3_BY_KIND), ...Object.values(MP3_BY_KIND)])) {
    if (src) void loadTrackerBuffer(ctx, src).catch(() => {});
  }
}

export function playPokerLiveSound(kind: PokerLiveSound, options?: PokerLiveSoundOptions) {
  if (options?.profile === "tracker" && typeof document !== "undefined" && document.hidden) return;
  if (!canPlay(kind, options?.bypassStoredMute === true)) return;
  const src = mp3SrcFor(kind);
  if (src) {
    playMp3(kind, src, options?.profile ?? "legacy");
    return;
  }
  if (options?.profile === "tracker") {
    const ctx = ensureCtx();
    if (ctx?.state === "running") playSynthOnContext(ctx, kind);
    return;
  }
  playSynth(kind);
}
