import { AlertTriangle, LockKeyhole, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildFloorSeatRoster,
  type FloorRosterSeat,
  type FloorRosterSeatLock,
} from "./floorTablePresentation";

export function FloorSeatRoster({
  seats,
  onSeatTap,
  onEmptySeatTap,
  maxSeats = 9,
  seatLocks = [],
  onLockedSeatTap,
  className,
}: {
  seats: readonly FloorRosterSeat[];
  onSeatTap?: (seatNumber: number) => void;
  onEmptySeatTap?: (seatNumber: number) => void;
  maxSeats?: 8 | 9;
  seatLocks?: readonly FloorRosterSeatLock[];
  onLockedSeatTap?: (seatNumber: number) => void;
  className?: string;
}) {
  const roster = buildFloorSeatRoster(seats, maxSeats);
  const lockBySeat = new Map(seatLocks.map((lock) => [lock.seatNumber, lock]));
  const hasIntegrityIssue = (
    roster.duplicateSeatNumbers.length > 0
    || roster.outOfRangeSeatNumbers.length > 0
  );
  const occupiedCount = roster.slots.filter((slot) => slot.seat != null).length;

  return (
    <section className={cn("operations-typography min-w-0", className)} aria-labelledby="floor-seat-roster-heading">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 id="floor-seat-roster-heading" className="text-sm font-semibold text-foreground">
            Danh sách người chơi
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {occupiedCount}/{maxSeats} ghế · chạm một ghế để thao tác
          </p>
        </div>
        <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 font-mono text-xs text-primary">
          {maxSeats} ghế
        </span>
      </div>

      {hasIntegrityIssue && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {roster.duplicateSeatNumbers.length > 0
              ? `Trùng dữ liệu ghế ${roster.duplicateSeatNumbers.join(", ")}. `
              : ""}
            {roster.outOfRangeSeatNumbers.length > 0
              ? `Có ghế ngoài phạm vi 1–${maxSeats}: ${roster.outOfRangeSeatNumbers.join(", ")}. `
              : ""}
            Hãy tải lại và không thao tác cho tới khi dữ liệu được kiểm tra.
          </span>
        </div>
      )}

      <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/55">
        {roster.slots.map(({ seatNumber, seat }) => {
          const seatLock = lockBySeat.get(seatNumber);
          const dataIssue = seat?.integrityStatus === "missing_entry" || seat?.integrityStatus === "invalid_participation";
          const interactive = seat
            ? Boolean(onSeatTap) && !dataIssue
            : seatLock
              ? Boolean(onLockedSeatTap)
              : Boolean(onEmptySeatTap);
          return (
            <button
              key={seatNumber}
              type="button"
              data-ops-action="floor.tables.select_seat"
              data-testid={`floor-seat-row-${seatNumber}`}
              disabled={!interactive || hasIntegrityIssue}
              onClick={() => {
                if (seat) onSeatTap?.(seatNumber);
                else if (seatLock) onLockedSeatTap?.(seatNumber);
                else onEmptySeatTap?.(seatNumber);
              }}
              className={cn(
                "flex min-h-[52px] w-full items-center gap-2.5 border-b border-border/70 px-3 py-2 text-left last:border-b-0 sm:min-h-[58px] sm:gap-3 sm:py-2.5",
                interactive && "transition hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/45",
                !interactive && "cursor-default",
              )}
              aria-label={seat
                ? dataIssue
                  ? `Ghế ${seatNumber}, cần sửa dữ liệu`
                  : `Ghế ${seatNumber}, ${seat.playerName}`
                : seatLock
                  ? `Ghế ${seatNumber}, đang khóa, ${seatLock.reason}`
                  : `Ghế ${seatNumber}, trống`}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-background/80 font-mono text-sm text-muted-foreground">
                {seatNumber}
              </span>

              {seat ? (
                <>
                  <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary min-[390px]:grid" aria-hidden="true">
                    {playerInitials(seat.playerName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {seat.playerName}
                    </span>
                    {dataIssue ? (
                      <span className="mt-0.5 block text-xs font-medium text-destructive">
                        {seat.integrityStatus === "invalid_participation"
                          ? "Cần sửa dữ liệu · thông tin chưa khớp"
                          : "Cần sửa dữ liệu · thiếu hồ sơ dự giải"}
                      </span>
                    ) : (
                      <span className="mt-0.5 block truncate font-mono text-xs text-primary">
                        {seat.chipsLabel}
                        {seat.entryNumber != null ? ` · Lần tham gia ${seat.entryNumber}` : ""}
                      </span>
                    )}
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{dataIssue ? "Khóa thao tác" : "Đang ngồi"}</span>
                </>
              ) : seatLock ? (
                <>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-400/10 text-amber-300" aria-hidden="true">
                    <LockKeyhole className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-amber-100">Ghế đang khóa</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{seatLock.reason}</span>
                  </span>
                  {onLockedSeatTap && <span className="shrink-0 text-xs font-medium text-amber-300">Mở khóa</span>}
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium italic text-muted-foreground">Ghế trống</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground/75">Ghế trống</span>
                  </span>
                  {onEmptySeatTap && (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                      <Plus className="h-3.5 w-3.5" /> Thêm người
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function playerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(-2).map((part) => part.charAt(0).toUpperCase()).join("");
}
