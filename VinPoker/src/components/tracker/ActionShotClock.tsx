import { useEffect, useState } from "react";

const TURN_MS = 30_000;

export function ActionShotClock() {
  const [deadline, setDeadline] = useState<number | null>(() => performance.now() + TURN_MS);
  const [remaining, setRemaining] = useState(TURN_MS);

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

  return (
    <div className="relative z-10 mt-1 flex items-center justify-center gap-1.5">
      <span role="timer" aria-label="Thời gian hành động" className="min-w-12 font-mono font-bold tabular-nums text-amber-300">
        {display}
      </span>
      <button type="button" className={buttonClass} onClick={() => {
        const now = performance.now();
        if (deadline === null) {
          setDeadline(now + remaining);
        } else {
          setRemaining(Math.max(0, deadline - now));
          setDeadline(null);
        }
      }}>
        {deadline === null ? "Tiếp tục" : "Tạm dừng"}
      </button>
      <button type="button" className={buttonClass} onClick={() => {
        if (deadline === null) {
          setRemaining((value) => value + TURN_MS);
        } else {
          setDeadline(Math.max(deadline, performance.now()) + TURN_MS);
        }
      }}>
        +30 giây
      </button>
      <span role="status" className="sr-only">{seconds === 0 ? "Hết giờ hành động" : ""}</span>
    </div>
  );
}
