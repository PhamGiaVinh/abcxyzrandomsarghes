import { RadioTower, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FloorTableControlMode } from "@/lib/floorTableControlMode";

export type FloorTableRosterIndexStatus = "open" | "running" | "paused" | "closed";

export interface FloorTableRosterIndexItem {
  id: string;
  tableNumber: number | null;
  tableName: string;
  occupiedSeatNumbers: readonly number[];
  maxSeats: number;
  status: FloorTableRosterIndexStatus;
  controlMode: FloorTableControlMode;
}

const STATUS_META: Record<FloorTableRosterIndexStatus, { label: string; className: string }> = {
  open: { label: "Mở / trống", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" },
  running: { label: "Đang chạy", className: "border-sky-400/30 bg-sky-400/10 text-sky-200" },
  paused: { label: "Tạm dừng", className: "border-amber-400/30 bg-amber-400/10 text-amber-200" },
  closed: { label: "Đã đóng", className: "border-white/10 bg-white/5 text-muted-foreground" },
};

/**
 * A responsive index for Floor tables. It deliberately does not use the old
 * oval table-map glyph: each card exposes its number, control mode and its canonical
 * seat positions before the operator opens the full roster.
 */
export function FloorTableRosterIndex({
  tables,
  onOpen,
  className,
}: {
  tables: readonly FloorTableRosterIndexItem[];
  onOpen: (tableId: string) => void;
  className?: string;
}) {
  return (
    <section className={className} aria-label="Danh sách bàn Floor">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {tables.map((table) => {
          const status = STATUS_META[table.status];
          const maxSeats = Math.min(table.maxSeats, 9);
          const occupied = new Set(table.occupiedSeatNumbers.filter((seat) => seat >= 1 && seat <= maxSeats));
          const occupiedCount = occupied.size;
          const tableLabel = table.tableNumber == null ? table.tableName : `Bàn ${table.tableNumber}`;
          const modeLabel = table.controlMode === "tracker" ? "Live Tracker" : "Manual Floor";

          return (
            <button
              key={table.id}
              type="button"
              data-ops-action="floor.tables.open_roster"
              data-testid="floor-table-roster-card"
              data-floor-table-number={table.tableNumber ?? undefined}
              onClick={() => onOpen(table.id)}
              className="group min-h-[132px] rounded-2xl border border-border bg-card/60 p-3 text-left transition hover:border-primary/55 hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              aria-label={`${tableLabel}, ${occupiedCount}/${maxSeats} ghế, ${modeLabel}, ${status.label}. Mở danh sách ghế.`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="block truncate text-base font-semibold text-foreground">{tableLabel}</span>
                  {table.tableName !== tableLabel && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{table.tableName}</span>
                  )}
                </div>
                <span className="shrink-0 font-mono text-sm font-semibold text-foreground">
                  {occupiedCount}/{maxSeats}
                </span>
              </div>

              <div className="mt-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${maxSeats}, minmax(0, 1fr))` }} aria-hidden="true">
                {Array.from({ length: maxSeats }, (_, index) => {
                  const seat = index + 1;
                  return (
                    <span
                      key={seat}
                      className={cn(
                        "h-2 rounded-full border",
                        occupied.has(seat)
                          ? "border-primary bg-primary"
                          : "border-border bg-background/60",
                      )}
                    />
                  );
                })}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  {table.controlMode === "tracker" ? <RadioTower className="h-3.5 w-3.5 shrink-0" /> : <UsersRound className="h-3.5 w-3.5 shrink-0" />}
                  <span className="truncate">{modeLabel}</span>
                </span>
                <span className={cn("shrink-0 rounded-full border px-2 py-0.5", status.className)}>{status.label}</span>
              </div>

              <span className="mt-2 block text-xs font-medium text-primary opacity-85 group-hover:opacity-100">
                Mở danh sách {maxSeats} ghế
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
