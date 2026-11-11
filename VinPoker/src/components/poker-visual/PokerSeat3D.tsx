import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatBuyInShort, formatStack } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PokerCard3D, type PokerCardViewModel } from "./PokerCard3D";

/**
 * PokerSeat3D — one player pod around the table (visual prototype).
 *
 * Dumb presentational component. The table derives `isActive` / `isDealer` /
 * `isWinner` from its own props and passes them down; combined with
 * `seat.status` they resolve to a single effective status used purely for
 * visuals. No gameplay / money / state logic.
 */

export interface PokerSeatViewModel {
  seatNumber: number;
  playerName?: string;
  stack?: number;
  avatarUrl?: string;
  status?: "empty" | "active" | "folded" | "all_in" | "winner" | "sitting_out";
  cards?: PokerCardViewModel[];
}

type EffectiveStatus = "empty" | "seated" | "active" | "folded" | "all_in" | "winner" | "sitting_out";

interface PokerSeat3DProps {
  seat?: PokerSeatViewModel;
  /** Physical seat number for this slot (always rendered, even when empty). */
  seatNumber: number;
  isActive?: boolean;
  isDealer?: boolean;
  isWinner?: boolean;
  compact?: boolean;
}

const STATUS_LABEL: Partial<Record<EffectiveStatus, string>> = {
  active: "ACTIVE",
  all_in: "ALL-IN",
  folded: "FOLD",
  winner: "WIN",
  sitting_out: "OUT",
};

const STATUS_BADGE_CLASS: Partial<Record<EffectiveStatus, string>> = {
  active: "border-amber-400/40 bg-amber-400/15 text-amber-200",
  all_in: "border-red-400/50 bg-red-500/20 text-red-200",
  folded: "border-zinc-500/40 bg-zinc-600/30 text-zinc-300",
  winner: "border-amber-200/60 bg-amber-300/20 text-amber-100",
  sitting_out: "border-zinc-600/40 bg-zinc-700/30 text-zinc-400",
};

function getInitials(name: string | undefined, seatNumber: number): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
    const out = (first + last).toUpperCase();
    if (out) return out;
  }
  return String(seatNumber);
}

function resolveStatus(
  seat: PokerSeatViewModel | undefined,
  isActive: boolean | undefined,
  isWinner: boolean | undefined,
): EffectiveStatus {
  const s = seat?.status;
  // Precedence: winner > all_in > folded > sitting_out > active > seated > empty
  if (isWinner || s === "winner") return "winner";
  if (s === "all_in") return "all_in";
  if (s === "folded") return "folded";
  if (s === "sitting_out") return "sitting_out";
  if (isActive || s === "active") return "active";
  if (!seat || s === "empty") return "empty";
  return "seated";
}

export function PokerSeat3D({ seat, seatNumber, isActive, isDealer, isWinner, compact = false }: PokerSeat3DProps) {
  const status = resolveStatus(seat, isActive, isWinner);
  const isEmpty = status === "empty";

  const name = seat?.playerName?.trim() ? seat.playerName.trim() : `Seat ${seatNumber}`;
  const hasStack = seat?.stack != null && Number.isFinite(seat.stack);
  const stackText = hasStack ? (compact ? formatBuyInShort(seat!.stack as number) : formatStack(seat!.stack as number)) : null;
  const cards = seat?.cards ?? [];

  const podWidth = compact ? "w-[64px]" : "w-[88px]";
  const avatarSize = compact ? "h-7 w-7 text-[10px]" : "h-10 w-10 text-xs";
  const nameClass = compact ? "max-w-[58px] text-[10px]" : "max-w-[84px] text-xs";
  const cardSize = compact ? "xs" : "sm";

  const ariaLabel = isEmpty
    ? `Seat ${seatNumber}, empty`
    : `Seat ${seatNumber}, ${name}${STATUS_LABEL[status] ? `, ${STATUS_LABEL[status].toLowerCase()}` : ""}${
        stackText ? `, ${stackText}` : ""
      }`;

  // ── Empty seat: muted glass placeholder, still occupies its fixed slot ──
  if (isEmpty) {
    return (
      <div
        role="group"
        aria-label={ariaLabel}
        className={cn(
          "flex flex-col items-center gap-1 rounded-xl border border-dashed border-amber-200/15 bg-black/30 px-2 py-2 text-center opacity-70 backdrop-blur-[1px]",
          podWidth,
        )}
      >
        <div className={cn("flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-amber-200/40", avatarSize)}>
          {seatNumber}
        </div>
        <span className="text-[9px] uppercase tracking-widest text-amber-200/35">Empty</span>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "relative flex flex-col items-center gap-1 rounded-xl border bg-[#16121a]/85 px-2 py-2 text-center shadow-lg shadow-black/40 backdrop-blur-sm transition-colors",
        "border-white/10",
        status === "active" && "border-amber-300/60 ring-1 ring-amber-300/70 pv-active",
        status === "winner" && "border-amber-200/80 ring-2 ring-amber-200 pv-winner",
        status === "all_in" && "border-red-400/60 ring-1 ring-red-400/50",
        status === "folded" && "opacity-50 grayscale",
        status === "sitting_out" && "opacity-65",
        podWidth,
      )}
    >
      {/* Dealer button */}
      {isDealer && (
        <div
          aria-label="dealer button"
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-amber-200/70 bg-gradient-to-br from-amber-100 to-amber-400 text-[10px] font-black text-amber-950 shadow-md shadow-black/50"
        >
          D
        </div>
      )}

      <Avatar className={cn("border border-amber-200/20", avatarSize)}>
        {seat?.avatarUrl ? <AvatarImage src={seat.avatarUrl} alt={name} /> : null}
        <AvatarFallback className="bg-[#221a26] font-semibold text-amber-100">
          {getInitials(seat?.playerName, seatNumber)}
        </AvatarFallback>
      </Avatar>

      <span className={cn("truncate font-semibold text-amber-50", nameClass)} title={name}>
        {name}
      </span>

      {stackText && (
        <span className="font-mono text-[10px] tabular-nums text-emerald-300/90" title={hasStack ? formatStack(seat!.stack as number) : undefined}>
          {stackText}
        </span>
      )}

      {STATUS_LABEL[status] && (
        <span
          className={cn(
            "rounded-full border px-1.5 py-px text-[8px] font-bold uppercase leading-none tracking-wider",
            STATUS_BADGE_CLASS[status],
          )}
        >
          {STATUS_LABEL[status]}
        </span>
      )}

      {cards.length > 0 && (
        <div className="pv-reveal mt-0.5 flex items-center justify-center gap-0.5">
          {cards.map((card, i) => (
            <PokerCard3D key={i} card={card} size={cardSize} muted={status === "folded"} />
          ))}
        </div>
      )}
    </div>
  );
}
