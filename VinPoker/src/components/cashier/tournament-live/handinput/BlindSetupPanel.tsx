// Dedicated BLIND SETUP phase for Tracker Engine Mode (Phase 1, Layer 1).
//
// This is shown INSTEAD of the ActionDock while a preflop hand still owes its
// blinds, so blind posting is never routed through the normal-action pipeline
// (which is what surfaced "Người chơi đã all-in..." during setup). It reads the
// Floor blind level (snapshotted by the parent) and lets the operator post
// SB/BB and confirm. Presentational only — posting/confirm are parent callbacks.
//
// Frozen BB-ante hands confirm the complete server-owned batch in one action.

import { Input } from "@/components/ui/input";
import { formatStack } from "./format";

export interface BlindSetupPlayer {
  player_id: string;
  seat_number: number;
  display_name: string;
  current_stack: number;
}

interface BlindSetupPanelProps {
  buttonSeat: number;
  sbSeat: number | null;
  bbSeat: number | null;
  /** First voluntary actor after blinds (UTG / heads-up button-SB) — display hint. */
  firstActorSeat: number | null;
  isHeadsUp: boolean;
  players: BlindSetupPlayer[];
  levelNumber: number | null;
  ante: number;
  /** No blind level from Floor → show a manual-override warning. */
  levelMissing: boolean;
  /** New hands use the Floor level frozen by the canonical Start Hand writer. */
  lockedAmounts?: boolean;
  atomicBlinds?: boolean;
  sbAmount: number;
  bbAmount: number;
  onSbAmountChange: (n: number) => void;
  onBbAmountChange: (n: number) => void;
  sbPosted: boolean;
  bbPosted: boolean;
  onPost: (type: "post_sb" | "post_bb", playerId: string, amount: number) => void;
  onConfirm: () => void;
  disabled?: boolean;
  /**
   * P2-3 dead small blind (OPTIONAL — only the engine standalone console passes
   * these; the old embedded tab omits them and keeps the SB always required).
   * When `deadSb`, the SB is skipped and confirm needs only the BB.
   */
  deadSb?: boolean;
  onToggleDeadSb?: () => void;
  /**
   * A1 (trackerBlindAutoSeed) — both ADDITIVE; absent → render byte-identical.
   * `provenance`: preformatted source line ("SB 300 · BB 600 · lấy 14:05") shown next
   * to the Level header so the operator sees WHERE the auto-filled amounts came from.
   * `onPostBoth`: one-tap "post SB + BB & confirm" assist — shown only while nothing
   * is posted yet and the on-screen amounts are valid (never posts a 0 blind).
   */
  provenance?: string | null;
  onPostBoth?: (() => void) | null;
  /**
   * trackerWorkflowAids — "Lấy blind mới ngay": pull the live clock level on demand (the
   * 25s auto-poll may be stale after a level change) and re-seed the unposted SB/BB.
   * Absent → not rendered (byte-identical).
   */
  onRefreshLevel?: (() => void) | null;
}

function seatLabel(players: BlindSetupPlayer[], seat: number | null): string {
  if (seat == null) return "—";
  const p = players.find((x) => x.seat_number === seat);
  return p ? `Ghế ${seat} · ${p.display_name}` : `Ghế ${seat}`;
}

function BlindRow({
  role,
  seat,
  player,
  amount,
  onAmountChange,
  posted,
  onPost,
  disabled,
  lockedAmounts,
  batchOnly,
}: {
  role: "post_sb" | "post_bb";
  seat: number | null;
  player: BlindSetupPlayer | undefined;
  amount: number;
  onAmountChange: (n: number) => void;
  posted: boolean;
  onPost: (type: "post_sb" | "post_bb", playerId: string, amount: number) => void;
  disabled?: boolean;
  lockedAmounts?: boolean;
  batchOnly?: boolean;
}) {
  const label = role === "post_sb" ? "Small Blind" : "Big Blind";
  const isAllIn = !!player && amount >= player.current_stack && player.current_stack > 0;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/50 p-2">
      <div className="w-24 shrink-0">
        <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-300">{label}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {player ? `Ghế ${player.seat_number} · ${player.display_name}` : seat != null ? `Ghế ${seat}` : "—"}
        </div>
      </div>
      <Input
        type="number"
        className="h-8 w-24 text-sm font-mono text-right"
        value={amount}
        disabled={disabled || posted || lockedAmounts}
        onChange={(e) => onAmountChange(Number(e.target.value) || 0)}
      />
      <div className="flex-1 text-[10px] text-muted-foreground">
        {player ? <>Stack {formatStack(player.current_stack)}</> : null}
        {isAllIn && <span className="ml-1 font-bold text-red-400">(All-in)</span>}
      </div>
      {posted ? (
        <span className="text-[11px] font-bold text-emerald-400">✓ Đã post</span>
      ) : batchOnly ? (
        <span className="text-[11px] text-muted-foreground">Chờ xác nhận</span>
      ) : (
        <button
          type="button"
          disabled={disabled || !player || amount <= 0}
          onClick={() => player && onPost(role, player.player_id, amount)}
          className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-bold text-black transition active:scale-[0.98] disabled:opacity-40"
        >
          Post {role === "post_sb" ? "SB" : "BB"}
        </button>
      )}
    </div>
  );
}

export function BlindSetupPanel({
  buttonSeat,
  sbSeat,
  bbSeat,
  firstActorSeat,
  isHeadsUp,
  players,
  levelNumber,
  ante,
  levelMissing,
  lockedAmounts,
  atomicBlinds = false,
  sbAmount,
  bbAmount,
  onSbAmountChange,
  onBbAmountChange,
  sbPosted,
  bbPosted,
  onPost,
  onConfirm,
  disabled,
  deadSb,
  onToggleDeadSb,
  provenance,
  onPostBoth,
  onRefreshLevel,
}: BlindSetupPanelProps) {
  const sbPlayer = players.find((p) => p.seat_number === sbSeat);
  const bbPlayer = players.find((p) => p.seat_number === bbSeat);
  const canConfirm = bbPosted && (deadSb || sbPosted);
  // One-tap eligibility: nothing posted yet + valid on-screen amounts (0 never posts).
  const canPostBoth =
    !!onPostBoth && !sbPosted && !bbPosted && !!bbPlayer && bbAmount > 0 && (deadSb || (!!sbPlayer && sbAmount > 0));

  return (
    <div className="space-y-3 rounded-2xl border border-amber-500/40 bg-card p-3.5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-amber-300">Thiết lập blind</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {onRefreshLevel && !sbPosted && !bbPosted && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRefreshLevel()}
              className="rounded-md border border-amber-500/40 px-2 py-1 text-[11px] font-semibold text-amber-300 transition-colors hover:border-amber-400/70 disabled:opacity-40"
            >
              ↻ Lấy blind mới
            </button>
          )}
          <span>
            {levelNumber != null ? `Level ${levelNumber}` : "Manual"}
            {ante > 0 && <span className="ml-2">· Ante {formatStack(ante)}</span>}
          </span>
        </div>
      </div>

      {provenance && (
        <div className="text-[10px] text-muted-foreground">
          {lockedAmounts ? "Chốt từ blind structure Floor khi Start Hand" : "Tự lấy từ clock giải"}: <span className="text-emerald-300">{provenance}</span>
        </div>
      )}

      {canPostBoth && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onPostBoth?.()}
          className="w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-black transition active:scale-[0.99] disabled:opacity-40"
        >
          {atomicBlinds ? `Đặt blind và ante — SB ${deadSb ? "—" : formatStack(sbAmount)} / BB ${formatStack(bbAmount)} / ante tối đa ${formatStack(ante)}`
            : `⚡ Đăng blind & xác nhận (1 chạm${deadSb ? " · SB chết" : ""}) — SB ${deadSb ? "—" : formatStack(sbAmount)} / BB ${formatStack(bbAmount)}`}
        </button>
      )}

      {levelMissing && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          ⚠ Chưa có level/blind từ Floor — nhập tay tạm thời (manual override). Cần setup blind structure ở Floor để tự lấy SB/BB.
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>Button: <strong className="text-foreground">{seatLabel(players, buttonSeat)}</strong></span>
        <span>SB: <strong className="text-emerald-300">{seatLabel(players, sbSeat)}</strong></span>
        <span>BB: <strong className="text-emerald-300">{seatLabel(players, bbSeat)}</strong></span>
      </div>

      <div className="space-y-1.5">
        {deadSb ? (
          <div className="flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px]">
            <span className="font-bold uppercase tracking-wide text-amber-300">Small Blind — DEAD (bỏ qua)</span>
            <span className="text-muted-foreground">{seatLabel(players, sbSeat)}</span>
          </div>
        ) : (
          <BlindRow role="post_sb" seat={sbSeat} player={sbPlayer} amount={sbAmount} onAmountChange={onSbAmountChange} posted={sbPosted} onPost={onPost} disabled={disabled} lockedAmounts={lockedAmounts} batchOnly={atomicBlinds} />
        )}
        <BlindRow role="post_bb" seat={bbSeat} player={bbPlayer} amount={bbAmount} onAmountChange={onBbAmountChange} posted={bbPosted} onPost={onPost} disabled={disabled} lockedAmounts={lockedAmounts} batchOnly={atomicBlinds} />
      </div>

      {onToggleDeadSb && !atomicBlinds && (
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!deadSb}
            disabled={disabled || sbPosted}
            onChange={onToggleDeadSb}
            className="h-3.5 w-3.5 accent-amber-500"
          />
          SB chết (dead SB) — ván này không có Small Blind
        </label>
      )}

      {ante > 0 && (
        <div className="text-[10px] text-muted-foreground">
          {atomicBlinds ? `BB đóng ante tối đa ${formatStack(ante)}, ưu tiên blind khi thiếu chip.`
            : `Ante hiển thị theo level (${formatStack(ante)}); thao tác post ante sẽ bổ sung sau.`}
        </div>
      )}

      <div className="text-[11px] text-emerald-300/90">
        {isHeadsUp
          ? "Heads-up: Button là Small Blind và hành động trước preflop."
          : firstActorSeat != null
            ? `Sau khi xác nhận: UTG (ghế ${firstActorSeat}) hành động trước.`
            : "Sau khi xác nhận: UTG hành động trước."}
      </div>

      <button
        type="button"
        disabled={disabled || !canConfirm}
        onClick={onConfirm}
        className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black transition active:scale-[0.99] disabled:opacity-40"
      >
        Xác nhận blind
      </button>
    </div>
  );
}
