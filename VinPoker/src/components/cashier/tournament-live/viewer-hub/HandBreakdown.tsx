// Public viewer "Hand Breakdown" — a broadcast-style street-by-street action
// table (PREFLOP / FLOP / TURN / RIVER / SHOWDOWN, present streets only). Each
// column shows CUMULATIVE wagers through that street and the actions on it
// (including uncalled bets; this is not the settled/awarded pot).
// (position badge + avatar/name + action label + amount in big blinds). A
// per-hand positive-net WIN INDICATOR (+x BB) is shown only when both stack
// snapshots are known and valid — never infer missing starting_stack as zero.
//
// Presentational only — no data fetching, no logic beyond pure derivation. Pure
// grouping lives in lib/tracker-poker/handBreakdown.ts. Spectator-only: the
// parent mounts it solely when `spectator === true`, so the operator path is
// unchanged. Theme-aware via semantic tokens (works in dark + vinpoker-warm).

import { useTranslation } from "react-i18next";
import { Trophy } from "lucide-react";
import { deriveHandBreakdown, type BreakdownAction } from "@/lib/tracker-poker/handBreakdown";
import { getHandSeatPositions } from "@/lib/tournament/button";
import { formatViewerBBOrUnavailable } from "@/lib/tracker-poker/viewerAmounts";

export interface HandBreakdownPlayer {
  player_id: string;
  seat_number: number;
  display_name: string;
  avatar_url?: string | null;
  /** Present on completed (replay) hands only → enables the win indicator. */
  starting_stack?: number;
  ending_stack?: number | null;
}

export interface HandBreakdownProps {
  actions: BreakdownAction[];
  players: HandBreakdownPlayer[];
  buttonSeat: number;
  /** 0 → BB columns/suffixes are hidden (chips only). */
  bigBlind: number;
  /** Replay: action_order of the frame's current action → row is highlighted. */
  highlightActionOrder?: number;
  /** Replay-only display state from the pure settlement check. */
  showdownResult?: "winner" | "chop" | "needs_resettle" | null;
}

const STREET_LABELS: Record<string, string> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

function actionClass(type: string): string {
  switch (type) {
    case "all_in":
      return "text-rose-400";
    case "raise":
    case "bet":
      return "text-amber-300";
    case "call":
      return "text-sky-300";
    default:
      return "text-muted-foreground"; // fold / check / posts
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function HandBreakdown({
  actions,
  players,
  buttonSeat,
  bigBlind,
  highlightActionOrder,
  showdownResult = null,
}: HandBreakdownProps) {
  const { t } = useTranslation();
  const streets = deriveHandBreakdown(actions, bigBlind);
  if (streets.length === 0) return null;

  const playerById = new Map(players.map((p) => [p.player_id, p]));
  const posBySeat = getHandSeatPositions(players, buttonSeat, actions);

  // Positive-net winners only (completed hand → ending_stack known). Split pots
  // → several positive nets, each shown. Losers (net ≤ 0) are never shown.
  const winners = showdownResult === 'needs_resettle' ? [] : players
    .map((p) => {
      if (typeof p.starting_stack !== 'number' || !Number.isFinite(p.starting_stack) || p.starting_stack < 0
        || typeof p.ending_stack !== 'number' || !Number.isFinite(p.ending_stack) || p.ending_stack < 0) return null;
      const net = p.ending_stack - p.starting_stack;
      return net > 0 ? { player: p, net } : null;
    })
    .filter((w): w is { player: HandBreakdownPlayer; net: number } => w !== null)
    .sort((a, b) => b.net - a.net);

  const fallbackName = t("liveHub.breakdown.player", "Player");
  const potHint = t("liveHub.breakdown.potHint", "Tổng cược đến street này, chưa trừ cược được hoàn; không phải pot được chia.");

  return (
    <div className="mt-3 space-y-2">
      <div className="tracker-display flex items-center gap-1.5 px-0.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        {t("liveHub.breakdown.title", "Phân tích ván")}
      </div>
      <p className="text-[10px] text-muted-foreground">{potHint}</p>

      {showdownResult && (
        <div className={`w-fit rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
          showdownResult === "chop"
            ? "border-[hsl(var(--viewer-neon)_/_0.5)] bg-[hsl(var(--viewer-neon)_/_0.1)] text-[hsl(var(--viewer-neon))]"
            : showdownResult === "needs_resettle"
              ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
              : "border-[hsl(var(--poker-gold)_/_0.5)] bg-[hsl(var(--poker-gold)_/_0.1)] text-[hsl(var(--poker-gold))]"
        }`}>
          {showdownResult === "chop"
            ? t("liveHub.felt.chopPot", "Chop pot")
            : showdownResult === "needs_resettle"
              ? t("liveHub.felt.needsResettle", "Cần tính lại kết quả")
              : t("liveHub.felt.showdown", "Showdown")}
        </div>
      )}

      {winners.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {winners.map(({ player, net }) => (
            <span
              key={player.player_id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success"
            >
              <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="max-w-[120px] truncate text-foreground">
                {player.display_name || fallbackName}
              </span>
              <span className="tracker-num">
                +{formatViewerBBOrUnavailable(net, bigBlind)}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {streets.map((col) => (
          <div
            key={col.street}
            className="overflow-hidden rounded-xl border border-border/50 bg-card/50 shadow-[0_0_18px_rgba(0,0,0,0.18)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border/40 bg-secondary/30 px-2.5 py-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                {STREET_LABELS[col.street] ?? col.street}
              </span>
              <span className="tracker-num text-[10px] text-muted-foreground" title={potHint}>
                {t("liveHub.breakdown.pot", "Cược lũy kế")} {formatViewerBBOrUnavailable(col.potChips, bigBlind)}
              </span>
            </div>

            <div className="divide-y divide-border/20">
              {col.rows.map((r) => {
                const p = playerById.get(r.player_id);
                const name = p?.display_name || fallbackName;
                const pos = p ? posBySeat.get(p.seat_number) : undefined;
                const highlighted =
                  highlightActionOrder != null && r.action_order === highlightActionOrder;
                return (
                  <div
                    key={r.action_order}
                    className={`flex items-center gap-1.5 px-2 py-1.5 ${
                      highlighted ? "bg-amber-500/15" : ""
                    }`}
                  >
                    {p?.avatar_url ? (
                      <img
                        src={p.avatar_url}
                        alt=""
                        className="h-5 w-5 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-secondary text-[8px] font-bold text-muted-foreground">
                        {initials(name)}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        {pos && (
                          <span className="shrink-0 rounded bg-secondary/70 px-1 text-[8px] font-bold uppercase tracking-wide text-muted-foreground">
                            {pos}
                          </span>
                        )}
                        <span className="truncate text-[11px] font-medium text-foreground">{name}</span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className={`text-[11px] font-semibold ${actionClass(r.action_type)}`}>
                          {r.label}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
