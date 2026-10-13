import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LiquidButton } from "@/components/kokonutui/liquid-glass-card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ExternalLink, Lock, UserPlus } from "lucide-react";
import { formatStack } from "@/lib/format";
import { FEATURES } from "@/lib/featureFlags";
import { OpenTableDialog } from "./OpenTableDialog";
import { AddPlayerDialog } from "./AddPlayerDialog";
import { CloseTableDialog } from "./CloseTableDialog";
import { FloorTableControlModeControl } from "@/components/ops/shared/FloorTableControlMode";
import { FloorSeatRoster } from "@/components/ops/shared/FloorSeatRoster";
import { FIXED_FLOOR_TABLE_SEATS } from "@/components/ops/shared/floorTablePresentation";
import type { FloorTableControlMode } from "@/lib/floorTableControlMode";
import { OpenHandInputConsoleButton } from "./handinput/OpenHandInputConsoleButton";

export interface MapSeat {
  seat_id: string;
  player_id: string;
  player_name: string;
  entry_number: number;
  table_id: string;
  table_name: string;
  seat_number: number;
  chip_count: number;
  is_active: boolean;
  integrity_status?: "valid" | "missing_entry";
}

export interface MapTable {
  tt_id: string;
  table_id: string;
  table_number: number | null;
  table_name: string;
  max_seats: number;
  status: string;
  floor_control_mode: FloorTableControlMode;
  floor_control_revision: number;
  /** Canonical incarnation; legacy readers must not fabricate this context. */
  table_session_id?: string;
  control_epoch?: number;
}

const TABLE_OPS_LIVE = FEATURES.floorTableOps;

/**
 * Responsive table detail: always presents the full operational nine-seat
 * roster. Empty rows stay actionable, while all writes continue through the
 * existing server-authoritative Floor RPCs.
 */
export function FloorTableDetailSheet({
  open,
  onOpenChange,
  table,
  seats,
  onSeatTap,
  tournamentId,
  tournamentName,
  tournamentDate,
  unlinkedActiveSeatCount = 0,
  canManageTableControl = false,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  table: MapTable | null;
  seats: MapSeat[];
  onSeatTap: (seat: MapSeat) => void;
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string | null;
  unlinkedActiveSeatCount?: number;
  canManageTableControl?: boolean;
  onChanged: () => void;
}) {
  const [dialog, setDialog] = useState<null | "open" | "add" | "close">(null);
  const { user } = useAuth();
  const [defaultAddSeat, setDefaultAddSeat] = useState<number | null>(null);

  if (!table) return null;

  const occupiedSeatNumbers = seats.map((seat) => seat.seat_number);
  const operationalSeatCount = seats.filter(
    (seat) => seat.seat_number >= 1 && seat.seat_number <= FIXED_FLOOR_TABLE_SEATS,
  ).length;
  const rosterSeats = seats.map((seat) => ({
    seatNumber: seat.seat_number,
    playerName: seat.player_name || seat.player_id.slice(0, 6),
    integrityStatus: seat.integrity_status,
    chipsLabel: formatStack(seat.chip_count),
    entryNumber: seat.entry_number,
  }));

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="operations-typography h-[100dvh] w-full overflow-y-auto overscroll-contain border-white/10 bg-[#0d0913] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:max-w-3xl lg:max-w-4xl"
        >
          <SheetHeader>
            <SheetTitle className="flex min-w-0 flex-wrap items-center gap-2 break-words pr-8 text-[#f2ece6]">
              {table.table_name}
              <span className="rounded-full border border-primary/35 bg-primary/10 px-2.5 py-1 font-mono text-xs text-primary">
                {operationalSeatCount}/{FIXED_FLOOR_TABLE_SEATS}
              </span>
            </SheetTitle>
          </SheetHeader>

          <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
            <FloorSeatRoster
              seats={rosterSeats}
              onSeatTap={(seatNumber) => {
                const seat = seats.find((candidate) => candidate.seat_number === seatNumber);
                if (seat) onSeatTap(seat);
              }}
              onEmptySeatTap={TABLE_OPS_LIVE
                ? (seatNumber) => {
                  setDefaultAddSeat(seatNumber);
                  setDialog("add");
                }
                : undefined}
            />

            <div className="min-w-0 lg:self-start">
              {canManageTableControl ? (
                <FloorTableControlModeControl actorId={user?.id ?? null}
                  tournamentId={tournamentId}
                  table={table}
                  onChanged={onChanged}
                />
              ) : (
                <p className="rounded-xl border border-border bg-card/50 p-3 text-xs text-muted-foreground">
                  Chế độ kiểm soát chip: {table.floor_control_mode === "tracker" ? "Live Tracker" : "Manual Floor"}
                </p>
              )}

              <div className="mt-4 space-y-2">
                {FEATURES.trackerUnifiedOpsFlow && (
                  <OpenHandInputConsoleButton
                    tournamentId={tournamentId}
                    tournamentTableId={table.tt_id}
                  />
                )}
                <div className="text-xs text-muted-foreground">Thao tác bàn</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
                  <ActionButton icon={ExternalLink} label="Mở bàn khác" onClick={() => setDialog("open")} />
                  <ActionButton
                    icon={UserPlus}
                    label="Thêm người"
                    onClick={() => {
                      setDefaultAddSeat(null);
                      setDialog("add");
                    }}
                  />
                  <ActionButton
                    icon={Lock}
                    label="Đóng bàn"
                    danger
                    disabled={unlinkedActiveSeatCount > 0}
                    disabledReason="Có ghế đang chơi chưa gắn entry - cần sửa dữ liệu ghế trước khi đóng bàn."
                    onClick={() => setDialog("close")}
                  />
                </div>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  Chạm người chơi để Chuyển ghế / Sửa chip / Phiếu / Loại. Chạm Empty để thêm người vào đúng ghế.
                </p>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {TABLE_OPS_LIVE && (
        <>
          <OpenTableDialog
            open={dialog === "open"}
            onOpenChange={(value) => { if (!value) setDialog(null); }}
            tournamentId={tournamentId}
            onDone={onChanged}
          />
          <AddPlayerDialog
            open={dialog === "add"}
            onOpenChange={(value) => { if (!value) setDialog(null); }}
            tournamentId={tournamentId}
            tournamentName={tournamentName}
            tournamentDate={tournamentDate}
            tableTtId={table.tt_id}
            actorId={user?.id ?? null}
            tableSessionId={table.table_session_id ?? null}
            expectedRevision={table.floor_control_revision}
            expectedControlEpoch={table.control_epoch ?? null}
            maxSeats={table.max_seats}
            occupiedSeats={occupiedSeatNumbers}
            defaultSeatNumber={defaultAddSeat}
            onDone={onChanged}
          />
          <CloseTableDialog
            tournamentId={tournamentId}
            actorId={user?.id ?? null}
            open={dialog === "close"}
            onOpenChange={(value) => { if (!value) setDialog(null); }}
            tournamentName={tournamentName}
            tournamentDate={tournamentDate}
            tableTtId={table.tt_id}
            tableNumber={table.table_number}
            occupiedCount={seats.length}
            unlinkedActiveSeatCount={unlinkedActiveSeatCount}
            onDone={onChanged}
          />
        </>
      )}
    </>
  );
}

function ActionButton({
  icon: Icon,
  label,
  danger,
  disabled = false,
  disabledReason,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  if (!TABLE_OPS_LIVE) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block">
              <LiquidButton
                variant="outline"
                disabled
                className={`h-11 w-full justify-start ${danger ? "text-destructive" : ""}`}
              >
                <Icon className="mr-1.5 h-4 w-4" /> {label}
                <span className="ml-auto rounded-full border border-warning/40 px-1.5 py-0.5 text-[10px] text-warning">
                  Cần bật RPC
                </span>
              </LiquidButton>
            </span>
          </TooltipTrigger>
          <TooltipContent>Bật cờ floorTableOps để dùng sau UAT</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (disabled) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block">
              <LiquidButton
                variant="outline"
                disabled
                className={`h-11 w-full justify-start ${danger ? "text-destructive" : ""}`}
              >
                <Icon className="mr-1.5 h-4 w-4" /> {label}
              </LiquidButton>
            </span>
          </TooltipTrigger>
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <LiquidButton
      variant="outline"
      onClick={onClick}
      className={`h-11 w-full justify-start ${danger ? "text-destructive" : ""}`}
    >
      <Icon className="mr-1.5 h-4 w-4" /> {label}
    </LiquidButton>
  );
}
