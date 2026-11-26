// Lightweight Web Audio click / success / error sounds.
// Synthesized — no audio files, no network, no API keys.

let ctx: AudioContext | null = null;
let unlocked = false;
let acUnlocked = false;
let lastClickAt = 0;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    return ctx;
  } catch {
    return null;
  }
}

/** Force-unlock AudioContext on iOS/Android: must be called inside a user gesture.
 *  Plays a 1-sample silent buffer + resume(). Idempotent. */
function unlockAudio() {
  const ac = getCtx();
  if (!ac) return;
  try {
    if (ac.state === "suspended") {
      // Fire & forget — Safari needs this called synchronously inside gesture.
      void ac.resume();
    }
    if (!acUnlocked) {
      const buf = ac.createBuffer(1, 1, 22050);
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(ac.destination);
      src.start(0);
      acUnlocked = true;
    }
  } catch {
    // ignore
  }
}

function tone(freq: number, duration: number, type: OscillatorType = "sine", gain = 0.06, when = 0) {
  const ac = getCtx();
  if (!ac) return;
  const t0 = ac.currentTime + when;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g);
  g.connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** Warm marimba/wood-tap click (Material-style). */
function playClick() {
  const ac = getCtx();
  if (!ac) return;
  if (ac.state === "suspended") {
    try { void ac.resume(); } catch { /* ignore */ }
  }
  const t0 = ac.currentTime;
  const dur = 0.09;

  const osc1 = ac.createOscillator();
  osc1.type = "triangle";
  osc1.frequency.setValueAtTime(1200, t0);
  osc1.frequency.exponentialRampToValueAtTime(1020, t0 + dur);
  const g1 = ac.createGain();
  g1.gain.setValueAtTime(0.0001, t0);
  g1.gain.exponentialRampToValueAtTime(0.09, t0 + 0.003);
  g1.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc1.connect(g1).connect(ac.destination);
  osc1.start(t0);
  osc1.stop(t0 + dur + 0.02);

  const osc2 = ac.createOscillator();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(3600, t0);
  osc2.frequency.exponentialRampToValueAtTime(3060, t0 + dur * 0.7);
  const g2 = ac.createGain();
  g2.gain.setValueAtTime(0.0001, t0);
  g2.gain.exponentialRampToValueAtTime(0.022, t0 + 0.002);
  g2.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.6);
  osc2.connect(g2).connect(ac.destination);
  osc2.start(t0);
  osc2.stop(t0 + dur + 0.02);
}

export function playSuccess() {
  tone(523.25, 0.12, "sine", 0.07, 0);
  tone(659.25, 0.12, "sine", 0.07, 0.09);
  tone(783.99, 0.18, "sine", 0.08, 0.18);
}

export function playError() {
  tone(220, 0.18, "square", 0.05, 0);
  tone(165, 0.22, "square", 0.05, 0.1);
}

const CLICK_SELECTOR =
  "button, a[href], [role='button'], [role='tab'], [role='link'], [role='menuitem'], [role='option'], [role='switch'], [role='checkbox'], [role='radio'], [data-sound]";

const FORM_INPUTS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Attach a single delegated listener for clicks on any interactive element. */
export function initButtonSounds() {
  if (typeof window === "undefined" || unlocked) return;
  unlocked = true;

  // Global one-time unlock on the very first user gesture (covers iOS/Android).
  // We listen on touchstart/pointerdown/keydown so even non-button gestures unlock.
  const firstGestureUnlock = () => {
    unlockAudio();
  };
  window.addEventListener("touchstart", firstGestureUnlock, { capture: true, passive: true });
  window.addEventListener("pointerdown", firstGestureUnlock, { capture: true, passive: true });
  window.addEventListener("keydown", firstGestureUnlock, { capture: true });

  // Resume AC when tab becomes visible again (mobile auto-suspends).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ctx?.state === "suspended") {
      try { void ctx.resume(); } catch { /* ignore */ }
    }
  });

  const handler = (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (!target || !(target instanceof Element)) return;

    if (FORM_INPUTS.has(target.tagName)) return;

    let el = target.closest(CLICK_SELECTOR) as HTMLElement | null;

    if (!el) {
      let cur: HTMLElement | null = target as HTMLElement;
      for (let i = 0; i < 4 && cur; i++) {
        try {
          if (window.getComputedStyle(cur).cursor === "pointer") {
            el = cur;
            break;
          }
        } catch {
          // ignore
        }
        cur = cur.parentElement;
      }
    }
    if (!el) return;

    if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return;
    if (el.dataset.silent === "true" || el.closest("[data-silent='true']")) return;

    const now = performance.now();
    if (now - lastClickAt < 60) return;
    lastClickAt = now;

    // Ensure AC is unlocked + running — must happen synchronously in this gesture.
    unlockAudio();
    playClick();
  };

  // Use both pointerdown and touchstart for max mobile coverage.
  window.addEventListener("pointerdown", handler, { capture: true, passive: true });
}

/** TV audio is unlocked by the operator's explicit button gesture. */
export async function enableTvLevelAudio(): Promise<boolean> {
  const ac = getCtx();
  if (!ac) return false;
  unlockAudio();
  try {
    if (ac.state !== 'running') await ac.resume();
    return ac.state === 'running';
  } catch { return false; }
}

const tvOscillators = new Set<OscillatorNode>();
let tvAudioEpoch = 0;

export function stopTvLevelAudio() {
  tvAudioEpoch += 1;
  for (const oscillator of tvOscillators) {
    try { oscillator.stop(); } catch { /* Already ended. */ }
  }
}

function scheduleTvTone(ac: AudioContext, frequency: number, start: number, duration: number, peak: number, type: OscillatorType = 'sine') {
  const oscillator = ac.createOscillator();
  const gain = ac.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.008);
  if (duration > 0.5) gain.gain.setValueAtTime(peak, start + duration - 0.15);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(ac.destination);
  tvOscillators.add(oscillator);
  oscillator.onended = () => {
    tvOscillators.delete(oscillator);
    oscillator.disconnect();
    gain.disconnect();
  };
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

/** One audible warning per server-clock second; the final tone also works at 00:00. */
export async function playTvCountdownTone(final = false, delaySeconds = 0): Promise<boolean> {
  const epoch = tvAudioEpoch;
  if (!await enableTvLevelAudio() || epoch !== tvAudioEpoch) return false;
  const ac = getCtx();
  if (!ac) return false;
  try {
    scheduleTvTone(ac, final ? 660 : 1320, ac.currentTime + delaySeconds,
      final ? 0.75 : 0.18, final ? 0.22 : 0.32, final ? 'triangle' : 'sine');
    return true;
  } catch { return false; }
}

export async function playTvLevelChime() {
  const epoch = tvAudioEpoch;
  if (!await enableTvLevelAudio() || epoch !== tvAudioEpoch) return;
  const ac = getCtx();
  if (!ac) return;
  try {
    [660, 880, 1100].forEach((frequency, index) => {
      const start = ac.currentTime + index * 0.22;
      scheduleTvTone(ac, frequency, start, 0.65, 0.18);
    });
  } catch { /* A TV without audio still displays the authoritative clock. */ }
}
