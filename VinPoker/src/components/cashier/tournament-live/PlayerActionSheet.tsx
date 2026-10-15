import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, ArrowRightLeft, Coins, Receipt, UserMinus, Loader2 } from "lucide-react";
import { formatVND } from "@/lib/format";

export interface ActionSeat {
  seat_id: string;
  player_id: string;
  player_name: string;
  entry_number: number;
  table_id: string;
  table_name: string;
  seat_number: number;
  chip_count: number;
}

/**
 * Kholdem-style player action sheet (bottom sheet). Surfaces the 4 primary floor
 * actions as a grid (Chuyển / Sửa chip / Phiếu / Loại), with Thông tin and the
 * player information as a secondary row. All actions wire to EXISTING
 * backend:
 * - Chuyển → move number-stepper (move_player_seat); disabled for non-entry seats
 *   or viewers who aren't owner/cashier.
 * - Sửa chip → update_seats (with chip-conservation warning in the dialog).
 * - Phiếu → seat receipt (view / re-print).
 * - Loại (bust) → update_seats is_active=false (seat inactive only — no fabricated
 *   elimination / hand).
 * - Empty-seat moves use the same Chuyển bàn/ghế action, not a separate waitlist.
 *
 * onEditChips / onReceipt are optional so older callers keep compiling; a row is
 * only shown when its handler is provided.
 */
export function PlayerActionSheet({
  open, onOpenChange, seat, entryId, canMove, busting, onMove, onBust, onEditChips, editDisabledReason, onReceipt, onInfo,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  seat: ActionSeat | null;
  entryId: string | undefined;
  canMove: boolean;
  busting: boolean;
  onMove: () => void;
  onBust: () => void;
  onEditChips?: () => void;
  /** Present when Live Tracker, not Floor, owns this table's stack projection. */
  editDisabledReason?: string;
  onReceipt?: () => void;
  onInfo?: () => void;
}) {
  const [showInfo, setShowInfo] = useState(false);
  if (!seat) return null;
  const moveAllowed = !!entryId && canMove;
  const moveReason = !entryId
    ? "Người chơi chưa có entry/phiếu — không chuyển được"
    : !canMove
      ? "Cần quyền chủ CLB / thu ngân để chuyển ghế"
      : "";
  const editAllowed = !!onEditChips && canMove && !editDisabledReason;
  const editReason = editDisabledReason
    ?? (!onEditChips
      ? "Không khả dụng ở màn này"
      : "Cần quyền chủ CLB / thu ngân");

  const close = (v: boolean) => { if (!v) setShowInfo(false); onOpenChange(v); };
  // Close THIS sheet first, then open the next dialog on the NEXT frame. Opening it
  // in the same commit as the close makes Radix unmount one modal layer and mount
  // another at once — on touch that race leaves the new sheet with
  // pointer-events:none, so its close (X) and content became untappable on mobile.
  const act = (fn?: () => void) => {
    if (!fn) return;
    onOpenChange(false);
    requestAnimationFrame(fn);
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader className="text-center">
          <SheetTitle>
            {seat.table_name} · Ghế {seat.seat_number} — {seat.player_name || seat.player_id.slice(0, 8)}
          </SheetTitle>
        </SheetHeader>

        {/* 4 primary actions */}
        <TooltipProvider>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {/* Chuyển */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="block">
                  <button
                    className="flex w-full items-center gap-3 rounded-xl border border-primary/45 bg-primary/10 p-3.5 text-left text-primary disabled:opacity-50"
                    disabled={!moveAllowed}
                    onClick={() => act(onMove)}
                  >
                    <ArrowRightLeft className="h-6 w-6 shrink-0" />
                    <span><span className="block text-[15px] font-medium leading-tight">Chuyển</span><span className="block text-[11px] opacity-80">bàn / ghế</span></span>
                  </button>
                </span>
              </TooltipTrigger>
              {!moveAllowed && <TooltipContent>{moveReason}</TooltipContent>}
            </Tooltip>

            {/* Sửa chip */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="block">
                  <button
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-left disabled:opacity-50"
                    disabled={!editAllowed}
                    onClick={() => act(onEditChips)}
                  >
                    <Coins className="h-6 w-6 shrink-0 text-amber-400" />
                    <span><span className="block text-[15px] font-medium leading-tight">Sửa chip</span><span className="block text-[11px] text-muted-foreground">điều chỉnh stack</span></span>
                  </button>
                </span>
              </TooltipTrigger>
              {!editAllowed && <TooltipContent>{editReason}</TooltipContent>}
            </Tooltip>

            {/* Phiếu */}
            <button
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-left disabled:opacity-50"
              disabled={!onReceipt}
              onClick={() => act(onReceipt)}
            >
              <Receipt className="h-6 w-6 shrink-0 text-sky-400" />
              <span><span className="block text-[15px] font-medium leading-tight">Phiếu</span><span className="block text-[11px] text-muted-foreground">xem / in lại</span></span>
            </button>

            {/* Loại / Bust */}
            <button
              className="flex w-full items-center gap-3 rounded-xl border border-destructive/45 bg-destructive/10 p-3.5 text-left text-destructive disabled:opacity-50"
              disabled={busting}
              onClick={onBust}
            >
              {busting ? <Loader2 className="h-6 w-6 shrink-0 animate-spin" /> : <UserMinus className="h-6 w-6 shrink-0" />}
              <span><span className="block text-[15px] font-medium leading-tight">Loại</span><span className="block text-[11px] opacity-80">bust out</span></span>
            </button>
          </div>
        </TooltipProvider>

        {/* Secondary rows */}
        <div className="mt-3 divide-y divide-border border-t border-border">
          <button
            className="flex w-full items-center gap-3 py-3.5 text-left"
            onClick={() => { if (onInfo) act(onInfo); else setShowInfo((v) => !v); }}
          >
            <Info className="h-5 w-5 text-muted-foreground" />
            <span className="text-[15px]">Thông tin người chơi</span>
          </button>
          {!onInfo && showInfo && (
            <div className="space-y-1 bg-muted/20 px-3 py-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Bàn / Ghế</span><span>{seat.table_name} · {seat.seat_number}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Chip</span><span className="font-mono">{formatVND(seat.chip_count)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Lượt vào</span><span>#{seat.entry_number}</span></div>
            </div>
          )}

          <SheetDescription className="py-3 text-sm text-muted-foreground">Để chọn ghế trống, dùng Chuyển bàn / ghế. Hàng đợi đăng ký được quản lý riêng.</SheetDescription>
        </div>
      </SheetContent>
    </Sheet>
  );
}
