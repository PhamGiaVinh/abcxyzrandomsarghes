import { useState } from "react";
import { useAttentionQueue, type AttentionItem as AttentionItemData } from "@/hooks/useAttentionQueue";
import type { DealerAssignment, DealerAttendance, NextDealerPrediction } from "@/hooks/useDealerSwing";
import type { RotationTableSlots } from "@/hooks/useRotationSchedule";
import { cn } from "@/lib/utils";
import { dealerTableCoverage } from "@/lib/dealerTableCoverage";
import AttentionItem from "./AttentionItem";

interface Props {
  assignments: DealerAssignment[];
  tables: any[];
  dealers: DealerAttendance[];
  tableAssignmentMap: Record<string, DealerAssignment | null>;
  timelineByTableId: Record<string, { minutesLeft: number; showNextDealerSoon: boolean; isOverdue: boolean }>;
  nextDealerMap: Record<string, NextDealerPrediction> | null;
  scheduleByTableId?: Record<string, RotationTableSlots> | null;
  nowMs: number;
  autoSwingEnabled: boolean;
  /** Lane mode: full-width horizontal card grid (V3 Priority Lane on top). */
  horizontal?: boolean;
  onSwing: (tableId: string) => void;
  onAssign: (tableId: string) => void;
  onPlanNext?: (tableId: string) => void;
  onSendToBreak: (attendanceId: string) => void;
  onFocusTable?: (tableId: string) => void;
}

export default function AttentionQueue({
  assignments, tables, dealers, tableAssignmentMap,
  timelineByTableId, nextDealerMap, scheduleByTableId, nowMs, autoSwingEnabled, horizontal,
  onSwing, onAssign, onPlanNext, onSendToBreak, onFocusTable,
}: Props) {
  const { criticalItems, warningItems, totalCount } = useAttentionQueue({
    assignments, tables, dealers, tableAssignmentMap,
    timelineByTableId, nextDealerMap, scheduleByTableId, nowMs,
  });
  const [expanded, setExpanded] = useState(false);
  const { activeTables, assignedTables } = dealerTableCoverage(tables ?? [], assignments);
  const overdueTables = (tables ?? []).filter(table => table.status === "active"
    && !!table.table_session_id
    && dealerTableCoverage([table], assignments).assignedTables === 1
    && timelineByTableId[table.id]?.isOverdue);

  const renderItem = (item: AttentionItemData) => (
    <AttentionItem
      key={item.id}
      item={item}
      onSwing={onSwing}
      onAssign={onAssign}
      onPlanNext={onPlanNext}
      onSendToBreak={onSendToBreak}
      onFocusTable={onFocusTable}
    />
  );

  // Missing predictions must never turn a known overdue session into green health.
  // Overdue is a warning, not authority to create an OT/payroll marker.
  if (totalCount === 0 && overdueTables.length > 0) return (
    <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
      {overdueTables.length} bàn quá hạn — cần kiểm tra đổi dealer.
      <div className="mt-1 text-xs text-muted-foreground">
        {overdueTables.map(table => table.table_name ?? "Bàn").join(", ")}. Chưa có cảnh báo đổi người đầy đủ; không xem là sàn ổn định.
      </div>
    </div>
  );

  // ══════════════════════ LANE MODE (full-width top) ══════════════════════
  if (horizontal) {
    if (totalCount === 0) {
      const otZero = !assignments.some((a) => a.status === "assigned" && a.overtime_started_at);
      return (
        <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3 shadow-card">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/20 text-base font-bold text-success">✓</span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-foreground">Sàn đang ổn định</div>
            <div className="text-xs text-muted-foreground">
              {assignedTables}/{activeTables} bàn có dealer
              {autoSwingEnabled && " · Auto-Swing đang chạy"}
              {otZero && " · Không có OT"}
            </div>
          </div>
        </div>
      );
    }
    const all = [...criticalItems, ...warningItems];
    const COLLAPSED_N = 4;
    const visible = expanded ? all : all.slice(0, COLLAPSED_N);
    const hidden = all.length - visible.length;
    return (
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">⚡ Làn ưu tiên</span>
          <span className="rounded-full bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{totalCount} việc</span>
          {expanded && all.length > COLLAPSED_N && (
            <button onClick={() => setExpanded(false)} className="ml-auto text-[11px] font-medium text-muted-foreground hover:text-foreground">
              Thu gọn ▴
            </button>
          )}
        </div>
        <div className={cn("grid grid-cols-1 items-start gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", expanded && "max-h-[15.5rem] overflow-y-auto pr-1")}>
          {visible.map(renderItem)}
        </div>
        {!expanded && hidden > 0 && (
          <button
            onClick={() => setExpanded(true)}
            className="mt-2 w-full rounded-lg border border-border bg-card/60 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            + {hidden} việc nữa ▾
          </button>
        )}
      </div>
    );
  }

  // ══════════════════════ COMPACT MODE (legacy right-rail) ══════════════════════
  if (totalCount === 0) {
    const otZero = !assignments.some((a) => a.status === "assigned" && a.overtime_started_at);
    return (
      <div className="border border-success/30 bg-success/10 rounded-sm px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-sm">✅</span>
          <span className="text-[11px] font-semibold text-success">Hệ thống ổn định</span>
        </div>
        <div className="text-[10px] text-muted-foreground space-y-0.5">
          <div>{assignedTables}/{activeTables} bàn có dealer</div>
          {autoSwingEnabled && <div>Auto-Swing đang hoạt động</div>}
          {otZero && <div>Không có OT</div>}
        </div>
      </div>
    );
  }

  const renderGroup = (items: AttentionItemData[], label: string, icon: string, textColor: string) => {
    if (items.length === 0) return null;
    return (
      <div>
        <div className={`flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${textColor}`}>
          <span>{icon}</span>
          <span>{label}</span>
          <span className="ml-auto font-mono text-[9px] opacity-60">{items.length}</span>
        </div>
        <div className="space-y-1.5">{items.map(renderItem)}</div>
      </div>
    );
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 px-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cần xử lý</span>
        <span className="text-[9px] font-mono text-muted-foreground bg-muted/20 px-1 py-0.5">{totalCount}</span>
      </div>
      {renderGroup(criticalItems, "Cần xử lý ngay", "🔴", "text-destructive")}
      {renderGroup(warningItems, "Cảnh báo", "⚠️", "text-warning")}
    </div>
  );
}
