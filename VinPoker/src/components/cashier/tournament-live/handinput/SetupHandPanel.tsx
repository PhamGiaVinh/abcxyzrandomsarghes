// Setup step (engine mode) — the FIRST guided panel of a hand. Extracted from the
// inline start-hand JSX so the engine wizard can own it; the manual branch keeps
// its own inline copy byte-identical. Operator sets the hand number, taps the
// dealer-button seat for the first hand or an explicit reset, then starts the hand.

import type { ReactNode } from "react";
import { Play, RotateCcw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LiquidButton, LiquidGlassCard } from "@/components/kokonutui/liquid-glass-card";
import { Input } from "@/components/ui/input";
import { SeatRail, type RailSeat } from "./SeatRail";

interface SetupHandPanelProps {
  handNumber: number | "";
  onHandNumberChange: (value: number | "") => void;
  seats: RailSeat[];
  positions: Map<number, string>;
  buttonSeat: number;
  buttonConfirmed: boolean;
  onTapSeat: (seat: RailSeat) => void;
  onResetButton?: () => void;
  onStartHand: () => void;
  submitting: boolean;
  startDisabledReason?: string | null;
  lastHandId: string | null;
  onVoid: () => void;
  /**
   * A2 (trackerNextHandExpress) — ADDITIVE; absent → button reads "Bắt đầu Hand"
   * byte-identical. When set (a hand was just recorded + number/button pre-seeded),
   * the start button becomes the express CTA (e.g. "⚡ Ván tiếp theo — Hand #12").
   */
  expressLabel?: string | null;
  /**
   * A3 (trackerChipQuickEdit) — ADDITIVE; absent → panel byte-identical. When set,
   * rendered below the seat rail — this is the ONLY place chip quick-edit can be
   * slotted, so it inherits the "between hands, no orphan" gate for free (this panel
   * only mounts when `!handStarted && !orphanHand`).
   */
  chipEditor?: ReactNode;
}

export function SetupHandPanel({
  handNumber,
  onHandNumberChange,
  seats,
  positions,
  buttonSeat,
  buttonConfirmed,
  onTapSeat,
  onResetButton,
  onStartHand,
  submitting,
  startDisabledReason,
  lastHandId,
  onVoid,
  expressLabel,
  chipEditor,
}: SetupHandPanelProps) {
  return (
    <LiquidGlassCard
      className="border-dashed"
      contentClassName="space-y-4 text-center"
    >
      <div className="flex items-center gap-3 justify-center">
        <label className="text-xs font-medium text-muted-foreground">Hand Number</label>
        <Input
          className="w-24"
          type="number"
          value={handNumber}
          onChange={(e) => onHandNumberChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
      </div>
      {seats.length > 0 && (
        <div className="text-left max-w-xl mx-auto">
          <SeatRail
            seats={seats}
            positions={positions}
            buttonSeat={buttonSeat}
            toActId={null}
            selectedActorId={null}
            setupMode={!buttonConfirmed}
            selectionDisabled={buttonConfirmed || submitting}
            onTapSeat={onTapSeat}
          />
          <div className="mt-2 flex items-center justify-between gap-3 text-xs">
            <span className={buttonConfirmed ? "text-emerald-300" : "text-amber-300"}>
              {buttonConfirmed ? `BTN Ghế ${buttonSeat} · tự chuyển sau khi kết thúc ván` : "Chọn ghế BTN để bắt đầu ván."}
            </span>
            {buttonConfirmed && onResetButton && (
              <Button type="button" size="sm" variant="outline" onClick={onResetButton} disabled={submitting}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> Đặt lại button
              </Button>
            )}
          </div>
        </div>
      )}
      <LiquidButton
        onClick={onStartHand}
        disabled={submitting || !!startDisabledReason || !handNumber || !buttonConfirmed}
        className={
          expressLabel
            ? "bg-emerald-500 hover:bg-emerald-600 text-black font-bold shadow-lg shadow-emerald-500/20"
            : "bg-amber-500 hover:bg-amber-600 text-black font-bold shadow-lg shadow-amber-500/20"
        }
      >
        <Play className="w-4 h-4 mr-2" /> {expressLabel || "Bắt đầu Hand"}
      </LiquidButton>
      {startDisabledReason && <p role="status" className="text-sm text-muted-foreground">{startDisabledReason}</p>}
      {lastHandId && (
        <div className="pt-2">
          <Button size="sm" variant="destructive" onClick={onVoid} disabled={submitting}>
            <Undo2 className="w-3.5 h-3.5 mr-1" /> Void Last Hand ({lastHandId.slice(0, 8)})
          </Button>
        </div>
      )}
      {chipEditor && <div className="pt-1 text-left">{chipEditor}</div>}
    </LiquidGlassCard>
  );
}
