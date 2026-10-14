/**
 * DealerSwingSummaryStrip — "Sức khoẻ sàn" header for the Dealer Swing operator
 * console (V3 redesign). One scannable bar: big coverage number + a coverage
 * meter, then a row of large stat readouts (mở / có dealer / trống / quá hạn /
 * cảnh báo / nghỉ / dự kiến) + the stability %.
 *
 * PRESENTATION ONLY: receives already-derived counts/metrics as props (computed
 * in SwingPanel from existing data — no new query). Fully token-driven
 * (primary/warning/destructive/--ds-* + gradient-card/shadow-neon) so it
 * auto-recolours in the warm theme.
 */

import { cn } from "@/lib/utils";

export interface DealerSwingSummaryStripProps {
  activeTables: number;
  assignedTables: number;
  /**
   * Assignments still flagged 'assigned' but on a closed/inactive table
   * (ghosts). Operator/admin diagnostic only — pass 0 for non-admins to hide.
   */
  ghostAssignments?: number;
  onBreak: number;
  predictedPending: number;
  overdue: number;
  warnings: number;
  /** Successful-swing rate %, or null when there are no swings today. */
  stabilityPct: number | null;
  /** "Thiếu dealer sớm nhất" — HH:mm label, or null when no shortage forecast. */
  earliestShortageLabel: string | null;
  /** Live clock ms — drives the "cập nhật HH:MM:SS" freshness label. */
  nowMs: number;
}

interface Readout {
  label: string;
  value: string | number;
  color: string;
}

export default function DealerSwingSummaryStrip({
  activeTables, assignedTables, ghostAssignments = 0, onBreak, predictedPending, overdue, warnings,
  stabilityPct, earliestShortageLabel, nowMs,
}: DealerSwingSummaryStripProps) {
  const allAssigned = assignedTables === activeTables && activeTables > 0;
  const emptyTables = Math.max(0, activeTables - assignedTables);
  const covPct = activeTables > 0 ? Math.round((assignedTables / activeTables) * 100) : 0;

  const readouts: Readout[] = [
    { label: "Bàn mở", value: activeTables, color: "text-foreground" },
    { label: "Có dealer", value: assignedTables, color: allAssigned ? "text-primary" : "text-warning" },
    { label: "Bàn trống", value: emptyTables, color: emptyTables > 0 ? "text-warning" : "text-muted-foreground" },
    { label: "Quá hạn", value: overdue, color: overdue > 0 ? "text-destructive" : "text-muted-foreground" },
    { label: "Cảnh báo", value: warnings, color: warnings > 0 ? "text-warning" : "text-muted-foreground" },
    { label: "Đang nghỉ", value: onBreak, color: onBreak > 0 ? "text-[hsl(var(--ds-active))]" : "text-muted-foreground" },
    { label: "Dự kiến", value: predictedPending, color: predictedPending > 0 ? "text-[hsl(var(--ds-preassign))]" : "text-muted-foreground" },
    { label: "Ổn định", value: stabilityPct != null ? `${stabilityPct}%` : "—", color: stabilityPct != null && stabilityPct >= 90 ? "text-primary" : stabilityPct != null ? "text-warning" : "text-muted-foreground" },
  ];

  const hhmmss = new Date(nowMs).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  return (
    <div className="mb-4">
      <div className="rounded-xl border border-primary/20 bg-gradient-card shadow-card px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
          {/* Coverage block */}
          <div className="min-w-[260px] flex-1">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="font-display text-[11px] uppercase tracking-wider text-muted-foreground">Sức khoẻ sàn</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                Trực tiếp · {hhmmss}
              </span>
            </div>
            <div className="mb-2 flex items-baseline gap-2">
              <span className={cn("text-3xl font-bold leading-none tabular-nums", allAssigned ? "text-primary" : "text-foreground")}>
                {assignedTables}/{activeTables}
              </span>
              <span className="text-xs text-muted-foreground">
                bàn có dealer{emptyTables > 0 ? ` · ${emptyTables} trống` : ""}{overdue > 0 ? ` · ${overdue} quá hạn` : ""}
              </span>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-full border border-border bg-muted/40">
              <div className={cn("h-full rounded-full transition-all", allAssigned ? "bg-primary shadow-neon" : "bg-primary")} style={{ width: `${covPct}%` }} />
            </div>
          </div>

          {/* Stat readouts */}
          <div className="flex items-stretch">
            {readouts.map((r, i) => (
              <div key={r.label} className={cn("px-3.5", i > 0 && "border-l border-border/40")}>
                <div className={cn("text-2xl font-bold leading-none tabular-nums", r.color)}>{r.value}</div>
                <div className="mt-1.5 text-[10px] leading-tight text-muted-foreground">{r.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {ghostAssignments > 0 && (
        <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
          <span aria-hidden="true">⚠️</span>
          Phát hiện {ghostAssignments} assignment trên bàn đã đóng (cần dọn).
        </div>
      )}
    </div>
  );
}
