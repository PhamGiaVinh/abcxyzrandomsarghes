import { UtensilsCrossed, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import { FEATURES } from "@/lib/featureFlags";
import type { SeriesDateWindow } from "@/lib/series-intelligence/commandCenter";
import type { FnbReport } from "@/hooks/useFnbReport";
import { InsightLabelBadge } from "./InsightLabelBadge";
import { ExplainHint } from "./ExplainHint";
import { EmptyExplainer } from "./EmptyExplainer";

const countFmt = new Intl.NumberFormat("vi-VN");

/**
 * "F&B toàn CLB (trong kỳ series)" — the honest way to bring F&B into Series Intelligence.
 *
 * F&B orders carry only club_id + paid_at (NO tournament_id), so F&B revenue CANNOT be split per
 * tournament. This card therefore shows a CLUB-LEVEL total over the series' calendar window, read from
 * the live read-only `fnb_get_report` RPC — explicitly labeled "toàn CLB, không chia theo giải" and
 * NEVER folded into the per-event contribution margin. Revenue here IS real club revenue (unlike
 * buy-in); rev − COGS = contribution (still excludes staff/marketing/rent — not profit).
 */
export function FnbClubContributionCard({
  window,
  report,
  loading,
  error,
}: {
  window: SeriesDateWindow;
  report: FnbReport | null | undefined;
  loading: boolean;
  error: boolean;
}) {
  const hasData = !!report && (
    report.orderCount > 0 || report.revenue !== 0 || report.cogs !== 0 ||
    report.compCount > 0 || report.compCogs !== 0 ||
    report.dailyTrend.length > 0 || Object.values(report.statusCounts).some((count) => count > 0)
  );
  const contribution = report ? report.revenue - report.cogs - report.compCogs : 0;

  return (
    <Card className="p-4 gradient-card border-primary/40 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-base flex items-center gap-2">
          <UtensilsCrossed className="h-4 w-4 text-primary" /> F&B toàn CLB
          <span className="text-[10px] font-sans font-normal text-muted-foreground">(trong kỳ series)</span>
        </h3>
        <InsightLabelBadge label="Observed Pattern" />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Doanh thu − giá vốn (COGS) − chi phí món tặng của quầy F&B <strong>toàn CLB</strong>, từ {window.fromLabel} đến{" "}
        {window.toLabel}. <strong>KHÔNG chia theo từng giải</strong> — F&B bán ở quầy chung, dữ liệu không gắn
        với giải cụ thể, nên không cộng vào biên đóng góp mỗi giải ở trên.
      </p>

      {loading ? (
        <div className="h-16 animate-pulse rounded-md bg-muted/40" aria-busy />
      ) : error ? (
        <p className="text-[11px] text-warning flex items-start gap-1 border border-warning/40 bg-warning/5 rounded-md p-2">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Chưa đọc được dữ liệu F&B. Có thể CLB chưa bật
          F&B hoặc chưa cấp quyền — thử lại sau.
        </p>
      ) : !hasData ? (
        FEATURES.seriesEmptyExplainer ? (
          <EmptyExplainer
            what="Doanh thu F&B toàn CLB trong kỳ"
            why="báo cáo trả tổng ròng bằng 0 và không có chi tiết phát sinh trong kỳ."
            how="Bán F&B qua quầy/QR trong kỳ — đơn đã thanh toán sẽ tự vào đây (toàn CLB, không chia theo giải)."
          />
        ) : (
          <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3">
            Báo cáo trả tổng ròng bằng 0 và không có chi tiết phát sinh trong kỳ.
          </p>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile label="Doanh thu F&B" value={formatVndShort(report!.revenue)} accent />
            <Tile label="Giá vốn (COGS)" value={formatVndShort(report!.cogs)} muted />
            <Tile
              label="Biên đóng góp F&B"
              value={`${contribution >= 0 ? "+" : "−"}${formatVndShort(Math.abs(contribution))}`}
              strong
              danger={contribution < 0}
            />
            {(report!.compCount > 0 || report!.compCogs !== 0) && (
              <Tile label="Chi phí món tặng" value={formatVndShort(report!.compCogs)} muted />
            )}
            <Tile label="Số đơn" value={countFmt.format(report!.orderCount)} muted />
          </div>
          <ExplainHint term="biên đóng góp F&B">
            Biên đóng góp của quầy F&B bằng <b>doanh thu − giá vốn nguyên liệu (COGS) − chi phí món tặng</b>. Đây là doanh thu
            THẬT của CLB (khác buy-in là tiền chạy qua). Nhưng vẫn <b>chưa trừ</b> lương nhân sự, marketing,
            mặt bằng — nên chưa phải lợi nhuận. Con số gộp cho cả CLB trong kỳ, không tách theo giải vì đơn
            F&B không gắn với giải nào.
          </ExplainHint>
        </>
      )}
    </Card>
  );
}

function Tile({
  label,
  value,
  accent,
  strong,
  muted,
  danger,
}: {
  label: string;
  value: string;
  accent?: boolean;
  strong?: boolean;
  muted?: boolean;
  danger?: boolean;
}) {
  return (
    <div className={cn("rounded-md border p-2", danger ? "border-destructive/40 bg-destructive/5" : "border-border/60 bg-card/40")}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-display tabular-nums",
          strong ? "text-lg" : "text-base",
          danger ? "text-destructive" : accent || strong ? "text-primary" : muted ? "text-muted-foreground" : "",
        )}
      >
        {value}
      </div>
    </div>
  );
}
