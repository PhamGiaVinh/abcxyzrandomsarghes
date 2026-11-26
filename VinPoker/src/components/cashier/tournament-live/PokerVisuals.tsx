import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/featureFlags";
import { useTrackerCardStyle } from "@/components/tracker/TrackerCardStyle";

// ── xCards face deck (trackerCardFaces) ──────────────────────────────────────
// Map an internal card string ("As", "Th", "2c", or glyph-suited "A♠") to the
// xCards face filename (rank + suit, both uppercase; ten = "T"). Returns null for
// anything unrecognized so the caller keeps the built-in text face.
const XCARDS_SUIT: Record<string, string> = {
  s: "S", h: "H", d: "D", c: "C",
  "♠": "S", "♥": "H", "♦": "D", "♣": "C",
};
const XCARDS_RANKS = new Set(["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"]);
const FOUR_COLOR_BACKGROUNDS: Record<string, string> = { S: '#303339', H: '#BB242D', D: '#2452BE', C: '#177341' };
function xcardsFaceFile(card: string): string | null {
  if (!card || card.length < 2) return null;
  let rank = card.slice(0, -1).toUpperCase();
  if (rank === "10") rank = "T";
  const last = card.slice(-1);
  const suit = XCARDS_SUIT[last] ?? XCARDS_SUIT[last.toLowerCase()];
  if (!suit || !XCARDS_RANKS.has(rank)) return null;
  return `${rank}${suit}.svg`;
}

/** Face-up xCards image with a hard fallback to the built-in text face if the SVG
 *  fails to load (missing asset → never a blank card). Own state so the fallback
 *  survives re-render; the whole card box's rounding/size/mute come from the caller. */
function XCardImageFace({
  file,
  deck,
  cardCode,
  muted,
  sizeClass,
  className,
  style,
  fallback,
}: {
  file: string;
  deck: "xcards" | "four-color";
  cardCode: string;
  muted: boolean;
  sizeClass: string;
  className?: string;
  style?: CSSProperties;
  fallback: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  // object-CONTAIN (not cover): the xCards art already has its own rounded corners +
  // corner indices, and its aspect (0.716) is slightly narrower than the card box
  // (~0.75). object-cover would scale-to-fill and CROP the top/bottom edges → the
  // rounded corners + rank indices get clipped. contain shows the whole card; we drop
  // the container's own rounding/overflow/white-bg so the card's corners read cleanly
  // against the felt (a real card shows the background at its rounded corners). The
  // drop-shadow hugs the card's alpha shape so it still lifts off the felt.
  return (
    <div
      data-card-code={cardCode}
      className={cn(
        "tracker-card-reveal relative shrink-0",
        muted && "opacity-55 grayscale",
        sizeClass,
        className,
      )}
      style={style}
    >
      <img
        src={`/cards/${deck}/${file}`}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="h-full w-full object-fill drop-shadow-[0_3px_6px_rgba(0,0,0,0.45)]"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

/** Sakura petal (owner's card-back design, vinpoker-card-back.html) — a 5-petal flower
 *  is 5 of these rotated 72° apart. Base path spans r≈7→42; scale at use site. */
const SAKURA_PETAL =
  "M0 -7.0 C -15.0 -21.0, -10.5 -42.0, -2.4 -34.9 L 0 -31.4 L 2.4 -34.9 C 10.5 -42.0, 15.0 -21.0, 0 -7.0 Z";

function SakuraFlower({ scale, fill, opacity = 0.92 }: { scale: number; fill: string; opacity?: number }) {
  return (
    <g fill={fill} fillOpacity={opacity} transform={`scale(${scale})`}>
      {[0, 72, 144, 216, 288].map((r) => (
        <path key={r} d={SAKURA_PETAL} transform={`rotate(${r})`} />
      ))}
    </g>
  );
}

const SUIT_SYMBOL: Record<string, string> = {
  s: "\u2660",
  h: "\u2665",
  d: "\u2666",
  c: "\u2663",
  "\u2660": "\u2660",
  "\u2665": "\u2665",
  "\u2666": "\u2666",
  "\u2663": "\u2663",
};

export function getOvalSeatStyle(
  index: number,
  total: number,
  radiusX = 43,
  radiusY = 34
): CSSProperties {
  const safeTotal = Math.max(total, 1);
  const angle = -90 + (index * 360) / safeTotal;
  const rad = (angle * Math.PI) / 180;

  return {
    left: `${50 + radiusX * Math.cos(rad)}%`,
    top: `${50 + radiusY * Math.sin(rad)}%`,
    transform: "translate(-50%, -50%)",
  };
}

export function isPokerCardRed(card?: string | null) {
  if (!card) return false;
  const suit = card.slice(-1);
  return suit === "h" || suit === "d" || suit === "\u2665" || suit === "\u2666";
}

export function pokerCardText(card?: string | null) {
  if (!card) return "";
  const rank = card.slice(0, -1);
  const suit = SUIT_SYMBOL[card.slice(-1)] || card.slice(-1);
  return `${rank}${suit}`;
}

export function PokerCard({
  card,
  hidden = false,
  size = "md",
  muted = false,
  className,
  style,
}: {
  card?: string | null;
  hidden?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
  muted?: boolean;
  className?: string;
  /** Optional inline style (e.g. animationDelay for a staggered board reveal). */
  style?: CSSProperties;
}) {
  const trackerStyle = useTrackerCardStyle()?.style;
  const red = isPokerCardRed(card);
  const sizeClass = {
    xs: "h-8 w-6 rounded-md text-[10px]",
    sm: "h-11 w-8 rounded-md text-xs",
    md: "h-16 w-12 rounded-lg text-base",
    lg: "h-20 w-14 rounded-xl text-lg",
  }[size];

  if (hidden) {
    return (
      <div
        className={cn(
          "relative shrink-0 overflow-hidden border border-amber-300/50 bg-[radial-gradient(circle_at_35%_25%,#245043,#0b1720_72%)] shadow-lg shadow-black/35",
          sizeClass,
          className
        )}
        style={style}
      >
        <div className="absolute inset-1 rounded-[inherit] border border-emerald-300/20" />
        <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-emerald-300 shadow-[0_0_14px_rgba(16,185,129,0.9)]" />
      </div>
    );
  }

  if (!card) {
    return (
      <div
        className={cn(
          "shrink-0 border border-dashed border-amber-200/25 bg-black/25 shadow-inner shadow-black/30",
          sizeClass,
          className
        )}
        style={style}
      />
    );
  }

  const rank = card.slice(0, -1);
  const suit = SUIT_SYMBOL[card.slice(-1)] || card.slice(-1);

  const mappedFile = xcardsFaceFile(card);
  const fallbackStyle = trackerStyle === 'four-color' ? {
    ...style,
    backgroundColor: FOUR_COLOR_BACKGROUNDS[mappedFile?.[1] ?? 'S'],
    color: '#fff',
    fontFamily: 'Arial, sans-serif',
  } : style;

  // Today's built-in text face — also the fallback when an xCards asset fails to load.
  const textFace = (
    <div
      data-card-code={card}
      className={cn(
        "tracker-card-reveal relative shrink-0 overflow-hidden border border-amber-200/70 bg-[#f7f0df] font-serif font-black leading-none shadow-xl shadow-black/35",
        red ? "text-[#b51324]" : "text-[#111827]",
        muted && "opacity-55 grayscale",
        sizeClass,
        className
      )}
      style={fallbackStyle}
    >
      <div className="absolute inset-1 rounded-[inherit] border border-black/10" />
      <div className="absolute inset-0 flex items-center justify-center gap-0.5 text-[1.35em]">
        <span>{rank}</span>
        <span className="text-[0.9em]">{suit}</span>
      </div>
    </div>
  );

  // trackerCardFaces: swap the text face for the owner-chosen xCards vector deck.
  // Only reached for a REVEALED card (the hidden/empty branches returned above), so
  // no card value is exposed that wasn't already shown as text today.
  const faceFile = trackerStyle || FEATURES.trackerCardFaces ? mappedFile : null;
  if (faceFile) {
    return (
      <XCardImageFace
        key={`${trackerStyle}:${faceFile}`}
        file={faceFile}
        deck={trackerStyle === 'four-color' ? 'four-color' : 'xcards'}
        cardCode={card}
        muted={muted}
        sizeClass={sizeClass}
        className={className}
        style={style}
        fallback={textFace}
      />
    );
  }
  return textFace;
}

/**
 * Face-DOWN poker card — burgundy + gold, driven by the --poker-felt/--poker-gold
 * tokens so it stays a poker card in every theme. Separate from PokerCard on
 * purpose: PokerCard(null) keeps its empty-slot behavior (used by the board/replay).
 * Used by the viewer when a seat's hole cards are not revealed (privacy-safe — no
 * value is ever shown). Sizes mirror PokerCard so face-up/face-down line up.
 */
/**
 * Royal Guilloché card back — premium SVG (rosette linework + V medallion + double
 * border + corner ornaments). All colors come from --poker-card-* tokens so it
 * auto-switches dark↔warm (the warm set is intentionally brighter). Keeps the same
 * API (size / muted / className) and data-testid so existing callers + tests work.
 * xs/sm render a lighter "compact" density (fewer lines) for tiny hole cards.
 */
export function CardBack({
  size = "xs",
  muted = false,
  className,
  style,
}: {
  size?: "xs" | "sm" | "md" | "lg";
  muted?: boolean;
  className?: string;
  /** Optional inline style (e.g. clamp width/height for the responsive viewer felt). */
  style?: CSSProperties;
}) {
  const sizeClass = {
    xs: "h-8 w-6 rounded-md",
    sm: "h-11 w-8 rounded-md",
    md: "h-16 w-12 rounded-lg",
    lg: "h-20 w-14 rounded-xl",
  }[size];
  const uid = useId().replace(/:/g, "");
  // Same lighter pattern on EVERY card (board backs match the player hole-card
  // backs) — owner wants less guilloché on the board.
  const compact = true;
  const rosetteCount = compact ? 10 : 30;
  const innerCount = compact ? 0 : 16;
  const rRx = compact ? 17 : 24;
  const rRy = compact ? 37 : 53;
  const medR = compact ? 13 : 17;
  const vSize = compact ? 19 : 26;

  // trackerFeltV2 — the owner's SAKURA card back (gold 5-petal medallion on a wine
  // 45° lattice, from vinpoker-card-back.html), translated to the 100×140 viewBox and
  // parametrized with the SAME --poker-card-* tokens so dark↔warm still auto-switch.
  // Tiny sizes (xs/sm) drop the corner flowers + radial ticks for legibility.
  // Flag OFF → the guilloché design below renders byte-identical.
  if (FEATURES.trackerFeltV2) {
    const tiny = size === "xs" || size === "sm";
    return (
      <div
        aria-hidden="true"
        data-testid="card-back"
        className={cn(
          "relative shrink-0 overflow-hidden border shadow-md shadow-black/40",
          muted && "opacity-55 grayscale",
          sizeClass,
          className
        )}
        style={{ borderColor: "var(--poker-card-border)", ...style }}
      >
        <svg viewBox="0 0 100 140" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id={`${uid}sbg`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--poker-card-bg-soft)" />
              <stop offset="100%" stopColor="var(--poker-card-bg-deep)" />
            </linearGradient>
            <pattern id={`${uid}slat`} width="6.4" height="6.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <path d="M0 0V6.4M3.2 0V6.4" stroke="var(--poker-card-line)" strokeOpacity="0.14" strokeWidth="0.4" />
            </pattern>
          </defs>

          <rect width="100" height="140" fill={`url(#${uid}sbg)`} />
          <rect x="6" y="6" width="88" height="128" rx="3.5" fill={`url(#${uid}slat)`} />

          {/* Double gold border (same framing as v1). */}
          <rect x="4" y="4" width="92" height="132" rx="5" fill="none" stroke="var(--poker-card-border)" strokeWidth="1.4" opacity="0.92" />
          <rect x="6.5" y="6.5" width="87" height="127" rx="3.5" fill="none" stroke="var(--poker-card-border)" strokeWidth="0.5" opacity="0.5" />

          {/* Corner mini-sakura (md/lg only). */}
          {!tiny &&
            (
              [
                [16, 16, 135],
                [84, 16, 225],
                [16, 124, 45],
                [84, 124, 315],
              ] as const
            ).map(([x, y, r]) => (
              <g key={`${x}-${y}`} transform={`translate(${x} ${y}) rotate(${r})`}>
                <SakuraFlower scale={0.34} fill="var(--poker-card-border)" />
              </g>
            ))}

          {/* Center medallion: dark disc + rings + radial ticks + the gold sakura. */}
          <g transform="translate(50 70)">
            <circle r="24" fill="var(--poker-card-bg-deep)" fillOpacity="0.55" />
            <circle r="24" fill="none" stroke="var(--poker-card-border)" strokeWidth="0.7" opacity="0.55" />
            <circle r="20.4" fill="none" stroke="var(--poker-card-line)" strokeWidth="0.4" opacity="0.32" />
            {!tiny && (
              <g stroke="var(--poker-card-line)" strokeOpacity="0.5" strokeWidth="0.45" strokeLinecap="round">
                {Array.from({ length: 24 }).map((_, i) => {
                  const a = (i * 15 * Math.PI) / 180;
                  const x1 = 20.8 * Math.cos(a);
                  const y1 = 20.8 * Math.sin(a);
                  const x2 = 23.2 * Math.cos(a);
                  const y2 = 23.2 * Math.sin(a);
                  return <line key={i} x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)} />;
                })}
              </g>
            )}
            <SakuraFlower scale={tiny ? 0.5 : 0.44} fill="var(--poker-card-border)" />
            <circle r="2.6" fill="var(--poker-card-medallion)" stroke="var(--poker-card-border)" strokeWidth="0.55" />
          </g>
        </svg>
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      data-testid="card-back"
      className={cn(
        "relative shrink-0 overflow-hidden border shadow-md shadow-black/40",
        muted && "opacity-55 grayscale",
        sizeClass,
        className
      )}
      style={{ borderColor: "var(--poker-card-border)", ...style }}
    >
      <svg viewBox="0 0 100 140" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id={`${uid}bg`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--poker-card-bg-soft)" />
            <stop offset="42%" stopColor="var(--poker-card-bg)" />
            <stop offset="100%" stopColor="var(--poker-card-bg-deep)" />
          </linearGradient>
          <radialGradient id={`${uid}glow`} cx="50%" cy="40%" r="65%">
            <stop offset="0%" stopColor="rgba(255,232,171,0.16)" />
            <stop offset="55%" stopColor="rgba(255,232,171,0.03)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
          <radialGradient id={`${uid}vig`} cx="50%" cy="50%" r="72%">
            <stop offset="60%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.30)" />
          </radialGradient>
        </defs>

        <rect width="100" height="140" fill={`url(#${uid}bg)`} />
        <rect width="100" height="140" fill={`url(#${uid}glow)`} />
        <rect width="100" height="140" fill={`url(#${uid}vig)`} />

        {/* Double border. */}
        <rect x="4" y="4" width="92" height="132" rx="9" fill="none" stroke="var(--poker-card-border)" strokeWidth="1.6" opacity="0.95" />
        <rect x="8" y="8" width="84" height="124" rx="6" fill="none" stroke="var(--poker-card-border)" strokeWidth="0.9" opacity="0.55" />

        {/* Guilloché rosette. */}
        <g transform="translate(50 70)">
          {Array.from({ length: rosetteCount }).map((_, i) => (
            <ellipse
              key={`o${i}`}
              rx={rRx}
              ry={rRy}
              transform={`rotate(${(360 / rosetteCount) * i})`}
              fill="none"
              stroke="var(--poker-card-line)"
              strokeWidth={compact ? 0.5 : 0.6}
              opacity={compact ? 0.4 : 0.6}
            />
          ))}
          {Array.from({ length: innerCount }).map((_, i) => (
            <ellipse
              key={`i${i}`}
              rx={16}
              ry={37}
              transform={`rotate(${(360 / innerCount) * i + 5})`}
              fill="none"
              stroke="var(--poker-card-line)"
              strokeWidth={0.5}
              opacity={0.55}
            />
          ))}
          {!compact && (
            <>
              <circle r="33" fill="none" stroke="var(--poker-card-line)" strokeWidth="0.6" opacity="0.32" />
              <circle r="25" fill="none" stroke="var(--poker-card-line)" strokeWidth="0.5" opacity="0.32" />
            </>
          )}
        </g>

        {/* Medallion + V monogram. */}
        <circle cx="50" cy="70" r={medR + (compact ? 3 : 4)} fill="none" stroke="var(--poker-card-border)" strokeWidth="0.8" opacity="0.6" />
        <circle cx="50" cy="70" r={medR} fill="var(--poker-card-medallion)" stroke="var(--poker-card-border)" strokeWidth="1.1" />
        {!compact && (
          <path d="M45 54 L48 59 L50 52 L52 59 L55 54 L54 61 L46 61 Z" fill="var(--poker-card-border)" opacity="0.7" />
        )}
        <text
          x="50"
          y={compact ? 71 : 72}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--poker-card-text)"
          fontSize={vSize}
          fontWeight="700"
          fontFamily="Georgia, 'Times New Roman', serif"
        >
          V
        </text>
      </svg>
    </div>
  );
}

export function TrackerVisualStyles() {
  return (
    <style>
      {`
        @keyframes tracker-card-reveal {
          from { opacity: 0; transform: translateY(-12px) rotate(-3deg) scale(.92); }
          to { opacity: 1; transform: translateY(0) rotate(0deg) scale(1); }
        }
        @keyframes tracker-runout-board-reveal {
          from { opacity: 0; transform: perspective(600px) translateY(8px) rotateY(85deg) scale(.94); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes tracker-hole-flip {
          from { opacity: 0; transform: perspective(600px) rotateY(85deg); }
          to { opacity: 1; transform: perspective(600px) rotateY(0); }
        }
        .tracker-unified .tracker-seat-cards .tracker-card-reveal {
          animation-name: tracker-hole-flip;
          animation-duration: 360ms;
        }
        .tracker-unified [data-testid="board-cards"] .tracker-card-reveal:not(.tracker-runout-board-card) {
          animation-name: tracker-runout-board-reveal;
          animation-duration: 300ms;
        }
        @keyframes tracker-seat-pop {
          0% { transform: translate(-50%, -50%) scale(.94); opacity: .7; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
        /* Subtle breathing — depth via a soft drop shadow, NOT a neon outer glow. */
        @keyframes tracker-pot-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 1px 6px rgba(0, 0, 0, .4); }
          50% { transform: scale(1.03); box-shadow: 0 2px 12px rgba(0, 0, 0, .5); }
        }
        /* One-shot chip pulse when a seat commits chips this street (Live Action Engine, cosmetic). */
        @keyframes tracker-bet-pulse {
          0% { transform: scale(.7); opacity: 0; }
          50% { transform: scale(1.12); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes tracker-glow-sweep {
          from { transform: translateX(-110%) skewX(-18deg); opacity: .12; }
          to { transform: translateX(210%) skewX(-18deg); opacity: .28; }
        }
        /* liveTableFx: a chip flies from a seat to the pot — anticipation pop-in, a
           lifted arc apex (55%), ease-out landing. left/top travel = container-% path. */
        @keyframes tracker-chip-push {
          0%   { left: var(--cp-fx); top: var(--cp-fy); transform: translate(-50%,-50%) scale(.6); opacity: 0; }
          12%  { left: var(--cp-fx); top: var(--cp-fy); transform: translate(-50%,-50%) scale(1.05); opacity: 1; }
          55%  { left: calc((var(--cp-fx) + var(--cp-tx)) / 2);
                 top:  calc((var(--cp-fy) + var(--cp-ty)) / 2 - 6%);
                 transform: translate(-50%,-50%) scale(1); opacity: 1; }
          100% { left: var(--cp-tx); top: var(--cp-ty); transform: translate(-50%,-50%) scale(.92); opacity: 0; }
        }
        /* liveTableFx showdown winner: a soft gold halo + ring fades in (ease-out)
           to a STEADY glow (RPT-style, no pulse). The class carries the end state so
           reduced-motion keeps the glow without the entrance. */
        @keyframes tracker-win-glow {
          from { box-shadow: 0 0 0 0 hsl(var(--poker-gold) / 0); }
          to   { box-shadow: 0 0 24px 3px hsl(var(--poker-gold) / 0.58), 0 0 0 2px hsl(var(--poker-gold) / 0.78); }
        }
        @keyframes tracker-showdown-result {
          from { transform: translateY(6px) scale(.985); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes tracker-motion-deal {
          from { transform: translate(0, 0) rotate(-5deg) scale(.82); opacity: 0; }
          18% { opacity: 1; }
          to { transform: translate(var(--tm-dx), var(--tm-dy)) rotate(0) scale(.72); opacity: 0; }
        }
        @keyframes tracker-motion-fold {
          from { transform: translate(0, 0) rotate(-7deg) scale(.82); opacity: .95; }
          to { transform: translate(var(--tm-dx), var(--tm-dy)) rotate(14deg) scale(.42); opacity: 0; }
        }
        @keyframes tracker-motion-board {
          from { transform: translate(0, 0) rotateY(0deg) scale(.76); opacity: 0; }
          22% { opacity: 1; }
          to { transform: translate(var(--tm-dx), var(--tm-dy)) rotateY(180deg) scale(.74); opacity: 0; }
        }
        @keyframes tracker-motion-showdown {
          from { transform: translate(-50%, -50%) rotateY(90deg) scale(.82); opacity: 0; }
          to { transform: translate(-50%, -50%) rotateY(0deg) scale(1); opacity: 0; }
        }
        @keyframes tracker-motion-award {
          from { transform: translate(0, 0) scale(.7); opacity: 0; }
          16% { opacity: 1; }
          to { transform: translate(var(--tm-dx), var(--tm-dy)) scale(.9); opacity: 0; }
        }
        @keyframes tracker-settlement-collect {
          from { transform: translate(-50%, -50%) scale(.82); opacity: 1; }
          65% { opacity: 1; }
          to { transform: translate(-50%, -50%) translate(var(--sp-dx), var(--sp-dy)) scale(.72); opacity: 0; }
        }
        @keyframes tracker-settlement-award {
          from { transform: translate(-50%, -50%) scale(.72); opacity: 0; }
          18% { opacity: 1; }
          to { transform: translate(-50%, -50%) translate(var(--sp-dx), var(--sp-dy)) scale(.96); opacity: 0; }
        }
        @keyframes tracker-settlement-stack-collect {
          from { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          70% { opacity: 1; }
          to { transform: translate(-50%, -50%) translate(var(--sp-dx), var(--sp-dy)) scale(.82); opacity: 0; }
        }
        @keyframes tracker-settlement-award-label {
          from { transform: translate(-50%, -32%) scale(.86); opacity: 0; }
          to { transform: translate(-50%, -90%) scale(1); opacity: 1; }
        }
        @keyframes tracker-seat-award-label {
          from { transform: translateY(4px) scale(.96); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        .tracker-card-reveal { animation: tracker-card-reveal .36s cubic-bezier(.2,.7,.2,1) both; }
        .tracker-seat-pop { animation: tracker-seat-pop .22s ease-out both; }
        .tracker-pot-pulse { animation: tracker-pot-pulse 1.4s ease-in-out infinite; }
        .tracker-bet-pulse { animation: tracker-bet-pulse .42s ease-out both; }
        .tracker-chip-push {
          position: absolute; left: var(--cp-fx); top: var(--cp-fy);
          width: 14px; height: 14px; border-radius: 9999px;
          /* --chip-color set per action (all_in=red, call=green, blinds=amber, bet/raise=gold);
             absent (operator/TV, or no kind) → the gold default → byte-identical. */
          background: var(--chip-color, radial-gradient(circle at 35% 30%, #ffe7a8, #f5b340 60%, #9a6418 100%));
          box-shadow: 0 0 0 1.5px rgba(154,100,24,.85), 0 2px 6px rgba(0,0,0,.5);
          animation: tracker-chip-push 520ms cubic-bezier(.22,.61,.36,1) both;
          pointer-events: none;
        }
        .tracker-win-glow {
          box-shadow: 0 0 24px 3px hsl(var(--poker-gold) / 0.58), 0 0 0 2px hsl(var(--poker-gold) / 0.78);
          animation: tracker-win-glow .26s cubic-bezier(.22,1,.36,1) both;
        }
        .tracker-best-five-focus-active .tracker-best-five-card {
          opacity: 1 !important;
          filter: none !important;
          transition: opacity 180ms ease-out, filter 180ms ease-out, box-shadow 180ms ease-out, outline-color 180ms ease-out;
        }
        .tracker-best-five-focus-dim .tracker-best-five-card {
          outline: 0 solid transparent;
          box-shadow: none;
        }
        .tracker-best-five-focus-glow .tracker-best-five-card,
        .tracker-best-five-focus-static .tracker-best-five-card {
          outline: none;
          box-shadow: none;
          /* Alpha-following light: no rectangular plate behind the SVG card. */
          filter: drop-shadow(0 0 4px rgba(255, 210, 80, .85)) drop-shadow(0 0 9px rgba(255, 180, 40, .55)) brightness(1.08) !important;
        }
        .tracker-best-five-focus-active .tracker-non-best-five-card {
          opacity: .64 !important;
          filter: grayscale(.24) saturate(.58) brightness(.88) !important;
          transition: opacity 180ms ease-out, filter 180ms ease-out;
        }
        .tracker-runout-board-card {
          animation-name: tracker-runout-board-reveal;
          animation-timing-function: cubic-bezier(.22,1,.36,1);
        }
        .tracker-runout-board-flop { animation-duration: .27s; }
        .tracker-runout-board-turn { animation-duration: .3s; }
        .tracker-runout-board-river { animation-duration: .5s; }
        .tracker-showdown-result { animation: tracker-showdown-result .24s cubic-bezier(.22,1,.36,1) both; }
        .tracker-motion-card {
          position: absolute;
          left: 50%; top: 50%;
          width: clamp(12px, 3.5cqi, 22px); aspect-ratio: 5 / 7;
          border-radius: 4px;
          border: 1px solid hsl(var(--poker-gold) / .65);
          background: radial-gradient(circle at 35% 25%, #244b3d, #07110f 72%);
          box-shadow: 0 2px 7px rgba(0,0,0,.55), inset 0 0 0 2px rgba(255,255,255,.06);
          transform-style: preserve-3d;
          animation-fill-mode: both;
          animation-timing-function: cubic-bezier(.22,1,.36,1);
        }
        .tracker-motion-deal { left: 50%; top: var(--tm-pot-top, 46%); animation-name: tracker-motion-deal; }
        .tracker-motion-fold { animation-name: tracker-motion-fold; animation-timing-function: cubic-bezier(.4,0,1,1); }
        .tracker-motion-board { animation-name: tracker-motion-board; }
        .tracker-motion-showdown {
          position: absolute; width: clamp(42px, 12cqi, 72px); aspect-ratio: 1;
          border-radius: 9999px; border: 2px solid hsl(var(--viewer-neon) / .72);
          box-shadow: 0 0 18px hsl(var(--viewer-neon) / .4);
          animation-name: tracker-motion-showdown; animation-fill-mode: both;
          animation-timing-function: cubic-bezier(.22,1,.36,1);
        }
        .tracker-motion-chip {
          position: absolute; left: 50%; top: var(--tm-pot-top, 46%);
          width: clamp(7px, 2cqi, 13px); aspect-ratio: 1; border-radius: 9999px;
          display: inline-flex;
          animation-name: tracker-motion-award; animation-fill-mode: both;
          animation-timing-function: cubic-bezier(.22,1,.36,1);
        }
        .tracker-settlement-chip {
          position: absolute;
          width: clamp(8px, 2.2cqi, 15px);
          aspect-ratio: 1;
          border-radius: 9999px;
          display: inline-flex;
          pointer-events: none;
          animation-fill-mode: both;
          animation-timing-function: cubic-bezier(.22,.82,.28,1);
        }
        .tracker-settlement-chip-collect { animation-name: tracker-settlement-collect; animation-duration: 420ms; }
        .tracker-settlement-chip-award { animation-name: tracker-settlement-award; animation-duration: 420ms; }
        .tracker-settlement-stack-collect {
          animation: tracker-settlement-stack-collect 420ms cubic-bezier(.22,.82,.28,1) both;
          pointer-events: none;
        }
        .tracker-settlement-award-label {
          border: 1px solid hsl(var(--viewer-neon) / .75);
          border-radius: 9999px;
          background: rgba(2,12,8,.88);
          box-shadow: 0 0 14px hsl(var(--viewer-neon) / .3);
          color: hsl(var(--viewer-neon));
          font-family: var(--font-display, ui-monospace, monospace);
          font-size: clamp(11px, 1.65cqi, 15px);
          font-weight: 900;
          line-height: 1;
          padding: 3px 6px;
          white-space: nowrap;
          animation: tracker-seat-award-label 220ms cubic-bezier(.22,1,.36,1) both;
        }
        .tracker-settlement-award-announcement {
          width: min(82cqi, 260px);
          border: 1px solid hsl(var(--poker-gold) / .7);
          border-radius: 12px;
          background: linear-gradient(145deg, rgba(30, 23, 7, .96), rgba(3, 19, 12, .94));
          box-shadow: 0 0 0 1px rgba(0,0,0,.44), 0 0 22px hsl(var(--poker-gold) / .28), inset 0 1px rgba(255,255,255,.1);
          color: hsl(var(--viewer-neon));
          font-family: var(--font-display, ui-monospace, monospace);
          padding: 7px 9px;
          text-align: center;
          animation: tracker-settlement-award-label 220ms cubic-bezier(.22,1,.36,1) both;
        }
        .tracker-settlement-award-title {
          color: hsl(var(--poker-gold));
          font-size: clamp(8px, 1.45cqi, 11px);
          font-weight: 900;
          letter-spacing: .1em;
          line-height: 1.1;
          text-transform: uppercase;
        }
        .tracker-settlement-award-recipients {
          display: grid;
          gap: 3px;
          margin-top: 4px;
        }
        .tracker-settlement-award-recipient {
          align-items: center;
          display: flex;
          font-size: clamp(9px, 1.7cqi, 13px);
          font-weight: 900;
          gap: 7px;
          justify-content: space-between;
          line-height: 1.15;
          min-width: 0;
        }
        .tracker-felt {
          background:
            radial-gradient(circle at 50% 38%, rgba(88, 23, 35, .96), rgba(43, 11, 19, .98) 58%, rgba(12, 13, 16, .98) 100%),
            repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,.055) 0 1px, transparent 1px 6px);
        }
        .tracker-brass-ring {
          box-shadow:
            inset 0 0 0 10px rgba(245, 179, 64, .34),
            inset 0 0 0 17px rgba(112, 63, 26, .58),
            inset 0 0 58px rgba(0,0,0,.52),
            0 34px 90px rgba(0,0,0,.42);
        }
        .tracker-shine::before {
          content: "";
          position: absolute;
          inset: 0;
          width: 42%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,.14), transparent);
          animation: tracker-glow-sweep 3.8s ease-in-out infinite;
          pointer-events: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .tracker-card-reveal,
          .tracker-seat-pop,
          .tracker-pot-pulse,
          .tracker-bet-pulse,
          .tracker-chip-push,
          .tracker-win-glow,
          .tracker-best-five-card,
          .tracker-non-best-five-card,
          .tracker-runout-board-card,
          .tracker-showdown-result,
          .tracker-motion-card,
          .tracker-motion-showdown,
          .tracker-motion-chip,
          .tracker-settlement-chip,
          .tracker-settlement-stack-collect,
          .tracker-settlement-award-label,
          .tracker-settlement-award-announcement,
          .tracker-shine::before {
            animation: none !important;
            transition: none !important;
          }
        }
      `}
    </style>
  );
}

export function TrackerStat({
  label,
  value,
  children,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-amber-200/15 bg-black/30 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200/60">{label}</div>
      <div className="mt-1 font-mono text-sm font-bold text-amber-100">{value}</div>
      {children}
    </div>
  );
}
