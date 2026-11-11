import type { CSSProperties } from "react";
import { formatBuyInShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PokerCard3D, type PokerCardViewModel } from "./PokerCard3D";
import { PokerSeat3D, type PokerSeatViewModel } from "./PokerSeat3D";

/**
 * PokerTable3D — premium CSS-only pseudo-3D casino poker table (visual prototype).
 *
 * The "3D" look is a CSS gradient/shadow/transform illusion — NOT WebGL, NOT a
 * game engine, NOT gameplay. It renders mock view models only.
 *
 * Security invariant: PokerTable3D is a dumb renderer. It must never infer or
 * reveal hidden cards. It renders whatever `faceDown` flag each card carries;
 * deciding which cards are hidden is the caller's / server's responsibility.
 *
 * Seats are positioned by `seatNumber` (never array index): slot s shows seat
 * number s+1, looked up in a Map of the provided seats. Missing seat numbers
 * render a muted placeholder at their fixed coordinate.
 */

type MaxSeats = 2 | 6 | 9 | 10;
type Variant = "casino-red" | "dark-red" | "minimal";
type Size = "mobile" | "desktop" | "responsive";

export interface PokerTable3DProps {
  seats: PokerSeatViewModel[];
  communityCards?: PokerCardViewModel[];
  potAmount?: number;
  dealerSeatNumber?: number;
  activeSeatNumber?: number;
  winnerSeatNumbers?: number[];
  maxSeats?: MaxSeats;
  tableLabel?: string;
  variant?: Variant;
  size?: Size;
  className?: string;
}

interface SeatPos {
  left: number;
  top: number;
}

/** Static, hand-tuned seat coordinates (% of the table box). Slot index → seat number = slot + 1.
 *  Orientation: seat 1 = bottom-center (hero), proceeding clockwise. Horizontal values are kept
 *  within [8, 92] so edge pods stay inside the table padding (no horizontal scroll). */
const SEAT_LAYOUTS: Record<MaxSeats, SeatPos[]> = {
  2: [
    { left: 50, top: 90 },
    { left: 50, top: 10 },
  ],
  6: [
    { left: 50, top: 92 },
    { left: 13, top: 68 },
    { left: 13, top: 28 },
    { left: 50, top: 8 },
    { left: 87, top: 28 },
    { left: 87, top: 68 },
  ],
  9: [
    { left: 50, top: 92 },
    { left: 22, top: 86 },
    { left: 8, top: 60 },
    { left: 10, top: 28 },
    { left: 32, top: 9 },
    { left: 68, top: 9 },
    { left: 90, top: 28 },
    { left: 92, top: 60 },
    { left: 78, top: 86 },
  ],
  10: [
    { left: 50, top: 93 },
    { left: 24, top: 89 },
    { left: 8, top: 67 },
    { left: 8, top: 38 },
    { left: 26, top: 12 },
    { left: 50, top: 7 },
    { left: 74, top: 12 },
    { left: 92, top: 38 },
    { left: 92, top: 67 },
    { left: 76, top: 89 },
  ],
};

/** Deterministic fallback for any off-spec maxSeats: seat 1 (slot 0) at bottom-center, clockwise. */
function formulaPos(slot: number, total: number): SeatPos {
  const safeTotal = Math.max(total, 1);
  const angle = (90 + (slot * 360) / safeTotal) * (Math.PI / 180);
  const left = 50 + 44 * Math.cos(angle);
  const top = 50 + 40 * Math.sin(angle);
  return {
    left: Math.min(92, Math.max(8, Math.round(left))),
    top: Math.min(93, Math.max(7, Math.round(top))),
  };
}

function seatPos(slot: number, maxSeats: MaxSeats): SeatPos {
  const layout = SEAT_LAYOUTS[maxSeats];
  return layout?.[slot] ?? formulaPos(slot, maxSeats);
}

const VARIANT_FELT: Record<Variant, string> = {
  "casino-red": "pv-felt pv-felt--casino-red pv-rim",
  "dark-red": "pv-felt pv-felt--dark-red pv-rim",
  minimal: "pv-felt pv-felt--minimal pv-rim--minimal",
};

const VARIANT_TILT: Record<Variant, number> = {
  "casino-red": 6,
  "dark-red": 7,
  minimal: 0,
};

const SIZE_MAX_WIDTH: Record<Size, string> = {
  mobile: "420px",
  desktop: "760px",
  responsive: "min(94vw, 560px)",
};

function PokerTableStyles() {
  return (
    <style>
      {`
        @keyframes pv-active-pulse {
          0%, 100% { box-shadow: 0 0 16px rgba(251,191,36,.30); }
          50% { box-shadow: 0 0 26px rgba(251,191,36,.55); }
        }
        @keyframes pv-winner-halo {
          0%, 100% { box-shadow: 0 0 22px rgba(251,191,36,.5); }
          50% { box-shadow: 0 0 46px rgba(251,191,36,.85); }
        }
        @keyframes pv-card-reveal {
          from { opacity: 0; transform: translateY(-6px) scale(.94); }
          to { opacity: 1; transform: none; }
        }
        .pv-active { animation: pv-active-pulse 1.7s ease-in-out infinite; }
        .pv-winner { animation: pv-winner-halo 1.7s ease-in-out infinite; }
        .pv-reveal { animation: pv-card-reveal .35s cubic-bezier(.2,.7,.2,1) both; }
        .pv-table { border-radius: 44% / 60%; }
        .pv-felt--casino-red {
          background:
            radial-gradient(circle at 50% 38%, rgba(140,32,46,.97), rgba(78,16,26,.98) 52%, rgba(34,9,15,.99) 80%, rgba(14,11,14,1) 100%),
            repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,.04) 0 1px, transparent 1px 7px);
        }
        .pv-felt--dark-red {
          background:
            radial-gradient(circle at 50% 40%, rgba(96,20,30,.97), rgba(48,10,18,.99) 55%, rgba(20,7,12,1) 82%),
            repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,.03) 0 1px, transparent 1px 7px);
        }
        .pv-felt--minimal {
          background: radial-gradient(circle at 50% 42%, rgba(60,14,22,.96), rgba(24,9,14,.99) 70%);
        }
        .pv-rim {
          box-shadow:
            inset 0 0 0 4px rgba(60,28,12,.85),
            inset 0 0 0 11px rgba(245,189,92,.45),
            inset 0 0 0 17px rgba(120,70,28,.6),
            inset 0 0 70px rgba(0,0,0,.6),
            0 30px 70px rgba(0,0,0,.55);
        }
        .pv-rim--minimal {
          box-shadow:
            inset 0 0 0 1px rgba(245,189,92,.4),
            inset 0 0 50px rgba(0,0,0,.55),
            0 16px 44px rgba(0,0,0,.5);
        }
        @media (prefers-reduced-motion: reduce) {
          .pv-active, .pv-winner, .pv-reveal { animation: none !important; }
        }
      `}
    </style>
  );
}

export function PokerTable3D({
  seats,
  communityCards = [],
  potAmount,
  dealerSeatNumber,
  activeSeatNumber,
  winnerSeatNumbers,
  maxSeats = 9,
  tableLabel = "VINPOKER",
  variant = "casino-red",
  size = "responsive",
  className,
}: PokerTable3DProps) {
  const compact = size !== "desktop";
  const seatMap = new Map<number, PokerSeatViewModel>((seats ?? []).map((s) => [s.seatNumber, s]));
  const winnerSet = new Set<number>(winnerSeatNumbers ?? []);
  const showPot = potAmount != null && Number.isFinite(potAmount) && potAmount > 0;
  const slots = Array.from({ length: maxSeats }, (_, i) => i);
  const tilt = VARIANT_TILT[variant];

  const wrapperLabel = `${tableLabel} table, ${maxSeats} seats${
    activeSeatNumber ? `, seat ${activeSeatNumber} to act` : ""
  }${dealerSeatNumber ? `, dealer seat ${dealerSeatNumber}` : ""}${showPot ? `, pot ${formatBuyInShort(potAmount!)}` : ""}`;

  const unitStyle: CSSProperties = tilt
    ? { transform: `rotateX(${tilt}deg)`, transformStyle: "preserve-3d" }
    : {};

  return (
    <div
      role="group"
      aria-label={wrapperLabel}
      className={cn(
        "relative mx-auto w-full overflow-hidden rounded-3xl bg-[radial-gradient(circle_at_50%_-10%,#241016,#0a0608)] p-7 sm:p-9",
        className,
      )}
      style={{ maxWidth: SIZE_MAX_WIDTH[size] }}
    >
      <PokerTableStyles />

      <div className="relative" style={{ perspective: "1100px" }}>
        <div className="relative" style={unitStyle}>
          {/* Felt + brass rim (oval) */}
          <div className={cn("pv-table relative w-full", VARIANT_FELT[variant])} style={{ aspectRatio: "16 / 11" }} />

          {/* Flat overlay: center group + seats (same tilted unit, stays aligned) */}
          <div className="absolute inset-0">
            {/* Center logo watermark */}
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none whitespace-nowrap text-xl font-black uppercase tracking-[0.35em] text-amber-100/10 sm:text-3xl">
              {tableLabel}
            </div>

            {/* Community cards + pot */}
            <div className="absolute left-1/2 top-[46%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
              {communityCards.length > 0 && (
                <div className="pv-reveal flex items-center gap-1">
                  {communityCards.map((card, i) => (
                    <PokerCard3D key={i} card={card} size={compact ? "sm" : "md"} />
                  ))}
                </div>
              )}
              {showPot && (
                <div className="flex items-center gap-2 rounded-full border border-amber-300/40 bg-black/50 px-3 py-1 shadow-lg shadow-black/50 backdrop-blur-sm">
                  <PotChips />
                  <span className="text-[9px] uppercase tracking-widest text-amber-200/70">Pot</span>
                  <span className="font-mono text-sm font-bold tabular-nums text-amber-100">{formatBuyInShort(potAmount!)}</span>
                </div>
              )}
            </div>

            {/* Seats — positioned by seatNumber */}
            {slots.map((slot) => {
              const seatNumber = slot + 1;
              const pos = seatPos(slot, maxSeats);
              return (
                <div
                  key={slot}
                  className="absolute"
                  style={{ left: `${pos.left}%`, top: `${pos.top}%`, transform: "translate(-50%, -50%)" }}
                >
                  <PokerSeat3D
                    seat={seatMap.get(seatNumber)}
                    seatNumber={seatNumber}
                    isActive={activeSeatNumber === seatNumber}
                    isDealer={dealerSeatNumber === seatNumber}
                    isWinner={winnerSet.has(seatNumber)}
                    compact={compact}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Tiny decorative chip stack next to the pot (red / blue / gold discs). */
function PotChips() {
  return (
    <span className="flex -space-x-1" aria-hidden="true">
      <span className="h-3 w-3 rounded-full border border-white/40 bg-red-600 shadow" />
      <span className="h-3 w-3 rounded-full border border-white/40 bg-blue-600 shadow" />
      <span className="h-3 w-3 rounded-full border border-white/40 bg-amber-400 shadow" />
    </span>
  );
}
