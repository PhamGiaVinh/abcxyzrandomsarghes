import type { CSSProperties } from "react";

// RPT-style committed-bet CHIP STACK shown on the felt in front of a seat (toward the
// pot). A fixed 3-disc pile of LIGHT single-gradient discs (the .tracker-chip-push
// recipe — NOT the heavy ChipDisc, which would cost a conic-mask ×9 seats) + the amount
// label below. all-in → red pile + white-on-red label; regular → gold pile + emerald-on-
// dark label. Pure presentation: the i18n'd `label` + the responsive `sizeStyle` (disc
// `width` + label `fontSize` as clamp()) are computed by LiveFelt so this stays geometry-
// agnostic. Decorative discs are aria-hidden; the amount label is real, high-contrast text.

const RED = "radial-gradient(circle at 35% 30%, #ff8a8a, #d33 55%, #7a1111 100%)";
const GOLD = "radial-gradient(circle at 35% 30%, #ffe7a8, #f5b340 60%, #9a6418 100%)";
const DISCS = 3;
const STEP = 0.34; // each chip sits this fraction-of-a-diameter above the one below
const CENTER_CHIPS = [
  "radial-gradient(circle at 35% 28%, #fff2ae, #e5a22c 58%, #72400b 100%)",
  "radial-gradient(circle at 35% 28%, #d5b8ff, #7c3fc7 58%, #311353 100%)",
  "radial-gradient(circle at 35% 28%, #91f5bc, #15995b 58%, #073e25 100%)",
  "radial-gradient(circle at 35% 28%, #ff9b9b, #cf3030 58%, #5d1010 100%)",
  "radial-gradient(circle at 35% 28%, #d6d6da, #53545b 58%, #17181c 100%)",
];

/** Low, dense center-pot cluster inspired by televised poker tables. */
export function CenterPotStack({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div data-testid="felt-center-pot-stack" className="flex flex-col items-center gap-1">
      <div className="flex h-6 items-end justify-center gap-[2px]" aria-hidden="true">
        {CENTER_CHIPS.map((background, column) => (
          <span key={column} className="relative block w-3" style={{ height: `${14 + (column % 3) * 3}px` }}>
            {Array.from({ length: compact ? 2 : 3 }).map((_, chip) => (
              <span
                key={chip}
                className="absolute left-0 h-[7px] w-3 rounded-full border border-black/45"
                style={{ bottom: `${chip * 5}px`, background, boxShadow: "0 1px 2px rgba(0,0,0,.55), inset 0 1px rgba(255,255,255,.22)" }}
              />
            ))}
          </span>
        ))}
      </div>
      <div className="tracker-num whitespace-nowrap rounded-md border border-[hsl(var(--poker-gold)/0.58)] bg-black/75 px-3 py-1.5 text-base font-black leading-none text-[hsl(var(--poker-gold))] shadow-[0_4px_14px_rgba(0,0,0,.5)] sm:text-lg">
        {label}
      </div>
    </div>
  );
}

export function ChipStack({
  label,
  allIn = false,
  sizeStyle,
}: {
  label: string;
  allIn?: boolean;
  sizeStyle?: CSSProperties;
}) {
  const w = (sizeStyle?.width as string) ?? "14px";
  const fontSize = (sizeStyle?.fontSize as string) ?? "8px";
  const disc = allIn ? RED : GOLD;
  return (
    <div className="tracker-bet-pulse flex flex-col items-center" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,.55))" }}>
      <div className="tracker-chip-column relative" data-all-in={allIn || undefined} style={{ width: w, aspectRatio: `1 / ${1 + (DISCS - 1) * STEP}` }}>
        {Array.from({ length: DISCS }).map((_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="absolute left-0 rounded-full"
            style={{
              width: w,
              aspectRatio: "1",
              background: disc,
              boxShadow: "0 0 0 1px rgba(0,0,0,.45)",
              bottom: `calc(${i} * ${w} * ${STEP})`,
              zIndex: i,
            }}
          />
        ))}
      </div>
      <div
        className="tracker-num mt-0.5 whitespace-nowrap font-bold leading-none"
        style={
          allIn
            ? { fontSize, background: "rgb(184,31,31)", border: "0.8px solid rgba(255,150,150,0.9)", color: "#fff", borderRadius: "9999px", padding: "1px 5px" }
            : { fontSize, background: "rgba(0,0,0,0.65)", border: "1px solid hsl(146 62% 56% / 0.45)", color: "hsl(146 62% 56%)", borderRadius: "6px", padding: "1px 5px" }
        }
      >
        {label}
      </div>
    </div>
  );
}
