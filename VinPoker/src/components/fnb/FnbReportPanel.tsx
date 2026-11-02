import { useEffect, useState } from "react";
import { useFnbReport } from "@/hooks/useFnbReport";
import { formatVND } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Loader2, TrendingUp, AlertTriangle } from "lucide-react";
import { assertFinanceCalendarRange, financeBusinessToday } from "@/lib/financeSummaryRead";

import {startLiveReportRefresh} from '@/lib/liveReportRefresh';

const todayISO = () => financeBusinessToday();
const rangeStartISO = (days: number) => {
  return financeBusinessToday(new Date(Date.now() - (days-1) * 86_400_000));
};
const monthStartISO = () => {
  return `${financeBusinessToday().slice(0, 7)}-01`;
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-mono font-semibold" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  );
}

/**
 * F&B report (A2) — the first F&B report screen: date range + summary + "F&B theo bàn" / "F&B theo
 * người chơi" (from `fnb_get_report`'s byTable/byPlayer) + top items + low stock. Comps are already
 * excluded from revenue/cogs/byTable/byPlayer — they surface separately as a compCount/compCogs line.
 * Parent (FnbAdmin's "Báo cáo" tab) only renders this when FEATURES.fnbTableLink is on.
 */
export function FnbReportPanel({ clubId }: { clubId: string }) {
  const [from, setFrom] = useState(monthStartISO());
  const [to, setTo] = useState(todayISO());
  const [relativeRange,setRelativeRange]=useState<7|30|'month'|null>('month');
  useEffect(()=>{
    if(relativeRange===null)return;
    return startLiveReportRefresh(async()=>{
      setFrom(relativeRange==='month'?monthStartISO():rangeStartISO(relativeRange));
      setTo(todayISO());
    });
  },[relativeRange]);
  let validRange = true;
  try { assertFinanceCalendarRange(from, to); } catch { validRange = false; }
  // fnb_get_report uses inclusive BETWEEN, and Postgres timestamps retain microseconds.
  const { data, isLoading, isPaused, error } = useFnbReport(validRange ? clubId : undefined,
    `${from}T00:00:00+07:00`, `${to}T23:59:59.999999+07:00`);

  return (
    <div className="space-y-4">
      <Card className="p-3 gradient-card border-primary/20">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Từ ngày</Label>
            <Input type="date" value={from} onChange={(e) => {setRelativeRange(null);setFrom(e.target.value);}} className="h-9 w-[150px]" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Đến ngày</Label>
            <Input type="date" value={to} onChange={(e) => {setRelativeRange(null);setTo(e.target.value);}} className="h-9 w-[150px]" />
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-9" onClick={() => {setRelativeRange(7); setFrom(rangeStartISO(7)); setTo(todayISO()); }}>7 ngày</Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => {setRelativeRange(30); setFrom(rangeStartISO(30)); setTo(todayISO()); }}>30 ngày</Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => {setRelativeRange('month'); setFrom(monthStartISO()); setTo(todayISO()); }}>Tháng này</Button>
          </div>
        </div>
      </Card>

      {!validRange && <p role="alert" className="text-sm text-destructive">Chọn khoảng ngày hợp lệ; ngày bắt đầu không được sau ngày kết thúc.</p>}
      {validRange && isPaused && (
        <p role="status" className="text-sm text-muted-foreground py-4">
          Mất kết nối — báo cáo F&B sẽ tự cập nhật khi có mạng trở lại.
        </p>
      )}
      {validRange && isLoading && !isPaused && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Đang tải báo cáo…
        </div>
      )}
      {validRange && !!error && !isLoading && !isPaused && (
        <div className="text-sm text-destructive py-4">Không tải được báo cáo — thử lại sau.</div>
      )}

      {validRange && data && !error && !isLoading && !isPaused && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Doanh thu (sau hoàn)" value={formatVND(data.revenue)} />
            <Stat label="Giá vốn (COGS)" value={formatVND(data.cogs)} tone="#f0997b" />
            <Stat label="Lãi gộp" value={formatVND(data.grossProfit)} tone="#00ff88" />
            <Stat label="Số đơn" value={String(data.orderCount)} />
          </div>

          {data.compCount > 0 && (
            <div className="rounded-lg border border-border/60 bg-card/40 p-3 text-xs text-muted-foreground flex flex-wrap items-center gap-2">
              <Badge variant="outline">Comp</Badge>
              Đã tặng miễn phí {data.compCount} đơn · Giá vốn comp:{" "}
              <span className="font-mono text-foreground">{formatVND(data.compCogs)}</span>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-4">
              <div className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4" /> F&amp;B theo bàn
              </div>
              {data.byTable.length === 0 ? (
                <div className="text-xs text-muted-foreground py-4 text-center">Chưa có dữ liệu.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bàn</TableHead>
                      <TableHead className="text-right">Doanh thu</TableHead>
                      <TableHead className="text-right">Giá vốn</TableHead>
                      <TableHead className="text-right">Đơn</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byTable.map((r, i) => (
                      <TableRow key={r.tableRef ?? `walkin-${i}`}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-right font-mono">{formatVND(r.revenue)}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{formatVND(r.cogs)}</TableCell>
                        <TableCell className="text-right font-mono">{r.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>

            <Card className="p-4">
              <div className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4" /> F&amp;B theo người chơi
              </div>
              {data.byPlayer.length === 0 ? (
                <div className="text-xs text-muted-foreground py-4 text-center">Chưa có dữ liệu.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Người chơi</TableHead>
                      <TableHead className="text-right">Doanh thu</TableHead>
                      <TableHead className="text-right">Giá vốn</TableHead>
                      <TableHead className="text-right">Đơn</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byPlayer.map((r, i) => (
                      <TableRow key={r.playerRef ?? `walkin-${i}`}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-right font-mono">{formatVND(r.revenue)}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{formatVND(r.cogs)}</TableCell>
                        <TableCell className="text-right font-mono">{r.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-4">
              <div className="text-sm font-semibold mb-2">Top món bán chạy</div>
              {data.topItems.length === 0 ? (
                <div className="text-xs text-muted-foreground py-4 text-center">Chưa có dữ liệu.</div>
              ) : (
                <div className="space-y-1.5">
                  {data.topItems.map((it) => (
                    <div key={it.menuItemId} className="flex items-center justify-between text-sm gap-2">
                      <span className="truncate">
                        {it.name} <span className="text-muted-foreground text-xs">×{it.qty}</span>
                      </span>
                      <span className="font-mono shrink-0">{formatVND(it.revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-4">
              <div className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-warning" /> Sắp hết hàng
              </div>
              {data.lowStock.length === 0 ? (
                <div className="text-xs text-muted-foreground py-4 text-center">Không có nguyên liệu nào sắp hết.</div>
              ) : (
                <div className="space-y-1.5">
                  {data.lowStock.map((s) => (
                    <div key={s.ingredientId} className="flex items-center justify-between text-sm gap-2">
                      <span className="truncate">{s.name}</span>
                      <span className="font-mono text-warning shrink-0">{s.onHand} / {s.threshold} {s.unit}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
