import { cn } from "@/lib/utils";

/**
 * PokerCard3D — CSS-only pseudo-3D playing card (visual prototype).
 *
 * Security invariant (dumb renderer): this component renders ONLY what the
 * caller passes. It never infers face-up/face-down and never reveals a hidden
 * card — when `faceDown` is true the rank/suit are NOT placed in the DOM at all
 * (no leaking via text or aria attributes). The caller (parent / future server)
 * decides visibility by setting `faceDown: true`.
 *
 * No gameplay / RNG / fairness / wallet logic. Mock-data view model only.
 */

export interface PokerCardViewModel {
  rank?: string;
  suit?: "hearts" | "diamonds" | "clubs" | "spades";
  faceDown?: boolean;
}

type CardSize = "xs" | "sm" | "md" | "lg";

interface PokerCard3DProps {
  card?: PokerCardViewModel;
  size?: CardSize;
  /** Dim the card (e.g. a folded player's hole cards). */
  muted?: boolean;
  className?: string;
}

const SUIT_GLYPH: Record<NonNullable<PokerCardViewModel["suit"]>, string> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
};

const SIZE_CLASS: Record<CardSize, string> = {
  xs: "h-7 w-5 rounded-[3px] text-[9px]",
  sm: "h-11 w-8 rounded-md text-xs",
  md: "h-16 w-12 rounded-lg text-base",
  lg: "h-20 w-14 rounded-xl text-lg",
};

export function PokerCard3D({ card, size = "sm", muted = false, className }: PokerCard3DProps) {
  const sizeClass = SIZE_CLASS[size];

  // ── Face-down: never render rank/suit (hidden-card security invariant) ──
  if (card?.faceDown) {
    return (
      <div
        aria-label="face-down card"
        className={cn(
          "relative shrink-0 overflow-hidden border border-amber-300/40 bg-[radial-gradient(circle_at_35%_25%,#3a1620,#160a10_72%)] shadow-md shadow-black/40",
          sizeClass,
          muted && "opacity-55",
          className,
        )}
      >
        <div className="absolute inset-[3px] rounded-[inherit] border border-amber-200/15" />
        <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-amber-300/80 shadow-[0_0_10px_rgba(251,191,36,0.7)]" />
      </div>
    );
  }

  // ── Empty / undefined slot (no card, or incomplete card data) ──
  if (!card || !card.suit || !card.rank) {
    return (
      <div
        aria-label="empty card slot"
        className={cn(
          "shrink-0 border border-dashed border-amber-200/20 bg-black/25 shadow-inner shadow-black/30",
          sizeClass,
          className,
        )}
      />
    );
  }

  // ── Face-up ──
  const isRed = card.suit === "hearts" || card.suit === "diamonds";
  const glyph = SUIT_GLYPH[card.suit];

  return (
    <div
      aria-label={`${card.rank} of ${card.suit}`}
      className={cn(
        "relative shrink-0 overflow-hidden border border-amber-200/70 bg-[#f7f0df] font-serif font-black leading-none shadow-lg shadow-black/35",
        isRed ? "text-[#b51324]" : "text-[#15191f]",
        muted && "opacity-55 grayscale",
        sizeClass,
        className,
      )}
    >
      <div className="absolute inset-[3px] rounded-[inherit] border border-black/10" />
      <div className="absolute left-1 top-0.5 flex flex-col items-center leading-none">
        <span>{card.rank}</span>
        <span className="text-[0.8em]">{glyph}</span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center text-[1.5em] opacity-90">{glyph}</div>
    </div>
  );
}
