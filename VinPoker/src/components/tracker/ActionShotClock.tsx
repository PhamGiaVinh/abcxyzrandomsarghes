import { useEffect, useRef, useState } from "react";

const TURN_MS = 30_000;
const SETTINGS_KEY = "tracker-shot-clock-swipes";
const durations = [10, 15, 20, 25, 30, 45, 60];
type SwipeSettings = { left: number; right: number };

function readSwipeSettings(): SwipeSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
    return {
      left: durations.includes(saved?.left) ? saved.left : 30,
      right: durations.includes(saved?.right) ? saved.right : 30,
    };
  } catch {
    return { left: 30, right: 30 };
  }
}

export function ActionShotClock({ playerLabel }: { playerLabel?: string }) {
  const [deadline, setDeadline] = useState<number | null>(() => performance.now() + TURN_MS);
  const [remaining, setRemaining] = useState(TURN_MS);
  const [swipes, setSwipes] = useState(readSwipeSettings);
  const gesture = useRef<{ id: number; x: number; y: number } | null>(null);
  const moved = useRef(false);

  function updateSwipe(direction: keyof SwipeSettings, seconds: number) {
    const next = { ...swipes, [direction]: seconds };
    setSwipes(next);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch {
      // The active clock can still use these settings when browser storage is unavailable.
    }
  }

  useEffect(() => {
    if (deadline === null) return;
    const tick = () => setRemaining(Math.max(0, deadline - performance.now()));
    tick();
    const intervalId = window.setInterval(tick, 150);
    return () => window.clearInterval(intervalId);
  }, [deadline]);

  const seconds = Math.ceil(remaining / 1000);
  const display = [Math.floor(seconds / 60), seconds % 60]
    .map((value) => String(value).padStart(2, "0")).join(":");
  const buttonClass = "min-h-11 rounded-lg border border-white/25 bg-black/40 px-2 text-xs text-white focus-visible:ring-2 focus-visible:ring-amber-300";
  const togglePause = () => {
    const now = performance.now();
    if (deadline === null) {
      setDeadline(now + remaining);
    } else {
      setRemaining(Math.max(0, deadline - now));
      setDeadline(null);
    }
  };

  return (
    <div className="action-shot-clock mx-auto my-2 flex max-w-full flex-wrap items-start justify-center gap-2 px-2 font-sans">
      <button
        data-clock-face="" type="button"
        aria-label={deadline === null ? "Tiếp tục" : "Tạm dừng"}
        onClick={(event) => {
          if (event.detail === 0 || !moved.current) togglePause();
        }}
        className="flex min-h-11 touch-pan-y select-none items-center gap-1 rounded-lg border border-amber-300/30 bg-black/40 px-2"
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          moved.current = false;
          gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { gesture.current = null; moved.current = true; }}
        onPointerUp={(event) => {
          const start = gesture.current;
          gesture.current = null;
          if (!start || start.id !== event.pointerId) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          moved.current = Math.hypot(dx, dy) > 10;
          if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          const duration = swipes[dx < 0 ? "left" : "right"] * 1000;
          setRemaining(duration);
          setDeadline(performance.now() + duration);
        }}
      >
        <span role="timer" aria-label="Thời gian hành động" className="min-w-12 font-mono font-bold tabular-nums text-amber-300">
          {display}
        </span>
        <span className="timer-toggle-label">{deadline === null ? "Tiếp tục" : "Tạm dừng"}</span>
      </button>
      <button type="button" className={buttonClass} onClick={() => {
        setRemaining(TURN_MS);
        setDeadline(performance.now() + TURN_MS);
      }}>
        Reset
      </button>
      <details className="relative">
        <summary className={`${buttonClass} flex cursor-pointer list-none items-center`}>Cài đặt</summary>
        <div className="mt-2 w-44 max-w-full space-y-2 rounded-lg border border-white/25 bg-[#101b17] p-3 text-left text-xs text-white">
          {(["left", "right"] as const).map((direction) => (
            <label key={direction} className="flex items-center justify-between gap-2">
              {direction === "left" ? "Vuốt trái" : "Vuốt phải"}
              <select
                className="min-h-11 rounded bg-black/40 px-2"
                value={swipes[direction]}
                onChange={(event) => updateSwipe(direction, Number(event.target.value))}
              >
                {durations.map((value) => <option key={value} value={value}>{value} giây</option>)}
              </select>
            </label>
          ))}
        </div>
      </details>
      {playerLabel && <span className="timer-player" title={playerLabel}>{playerLabel}</span>}
      <span role="status" className="sr-only">{seconds === 0 ? "Hết giờ hành động" : ""}</span>
    </div>
  );
}
