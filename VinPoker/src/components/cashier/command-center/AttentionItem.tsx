import { Clock, Table2, UserMinus, HelpCircle, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AttentionItem as AttentionItemData } from "@/hooks/useAttentionQueue";

interface Props {
  item: AttentionItemData;
  onSwing?: (tableId: string) => void;
  onAssign?: (tableId: string) => void;
  onPlanNext?: (tableId: string) => void;
  onSendToBreak?: (attendanceId: string) => void;
  onFocusTable?: (tableId: string) => void;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  ot: <Clock className="h-3.5 w-3.5" />,
  empty_table: <Table2 className="h-3.5 w-3.5" />,
  break_due: <UserMinus className="h-3.5 w-3.5" />,
  missing_next_dealer: <HelpCircle className="h-3.5 w-3.5" />,
  shortage: <AlertTriangle className="h-3.5 w-3.5" />,
};

const TAG_MAP: Record<string, string> = {
  ot: "Khẩn cấp · OT",
  empty_table: "Khẩn cấp · Trống",
  break_due: "Tới giờ nghỉ",
  missing_next_dealer: "Thiếu dealer kế",
  shortage: "Thiếu dealer",
};

/**
 * AttentionItem — one priority card in the Dealer Swing alerts lane (V3 redesign).
 * Compact card with a severity left-accent + tag + title and ONE prominent CTA
 * (Swing / Gán / Cho nghỉ) plus a quiet "Xem". PRESENTATION ONLY — every action
 * is the same parent handler as before; tokenized so it recolours in warm.
 */
export default function AttentionItem({ item, onSwing, onAssign, onPlanNext, onSendToBreak, onFocusTable }: Props) {
  const isCritical = item.severity === "critical";
  const accent = isCritical ? "text-destructive" : "text-warning";

  return (
    <div
      className={cn(
        "cursor-pointer rounded-lg border border-l-[3px] p-2.5 transition-colors",
        isCritical
          ? "border-destructive/35 border-l-destructive bg-destructive/5 hover:bg-destructive/10"
          : "border-warning/35 border-l-warning bg-warning/5 hover:bg-warning/10",
      )}
      onClick={() => onFocusTable?.(item.tableId ?? "")}
    >
      <div className="flex items-center gap-2">
        <span className={cn("shrink-0", accent)}>{ICON_MAP[item.type]}</span>
        <span className={cn("text-[10px] font-bold uppercase tracking-wide", accent)}>{TAG_MAP[item.type] ?? "Cần xử lý"}</span>
      </div>

      <div className="mt-1 truncate text-xs font-semibold text-foreground">{item.title}</div>
      {item.subtitle && (
        <div className="truncate text-[10px] text-muted-foreground">{item.subtitle}</div>
      )}

      <div className="mt-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {item.type === "ot" && item.tableId && onSwing && (
          <Button size="sm" className="h-9 flex-1 bg-destructive px-3 text-xs font-bold text-destructive-foreground hover:bg-destructive/90"
            onClick={() => onSwing(item.tableId!)}>
            Chốt khẩn cấp <ChevronRight className="ml-0.5 h-3 w-3" />
          </Button>
        )}
        {item.type === "empty_table" && item.tableId && onAssign && (
          <Button size="sm" className="h-9 flex-1 bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90"
            onClick={() => onAssign(item.tableId!)}>
            Gán dealer <ChevronRight className="ml-0.5 h-3 w-3" />
          </Button>
        )}
        {item.type === "missing_next_dealer" && item.tableId && onPlanNext && (
          <Button size="sm" className="h-9 flex-1 bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90"
            onClick={() => onPlanNext(item.tableId!)}>
            Chọn dealer kế tiếp <ChevronRight className="ml-0.5 h-3 w-3" />
          </Button>
        )}
        {item.type === "break_due" && item.attendanceId && onSendToBreak && (
          <Button size="sm" className="h-9 flex-1 bg-[hsl(var(--ds-active))] px-3 text-xs font-bold text-white hover:opacity-90"
            onClick={() => onSendToBreak(item.attendanceId!)}>
            Cho nghỉ <ChevronRight className="ml-0.5 h-3 w-3" />
          </Button>
        )}
        {item.tableId && onFocusTable && (
          <Button size="sm" variant="ghost" className="h-9 px-3 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onFocusTable(item.tableId!)}>
            Xem
          </Button>
        )}
      </div>
    </div>
  );
}
