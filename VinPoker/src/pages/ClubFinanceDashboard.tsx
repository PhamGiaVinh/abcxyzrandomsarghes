import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { formatVND } from "@/lib/format";
import { exportToExcel } from "@/lib/exportExcel";
import { useClubFinanceSummary } from "@/hooks/useClubFinanceSummary";
import {financeBusinessToday} from '@/lib/financeSummaryRead';
import {startLiveReportRefresh} from '@/lib/liveReportRefresh';
import {
  PAYROLL_STATUS_META, AGING_BUCKETS, margin, formatPct, formatVndShort,
  type PayrollStatusKey,
} from "@/lib/clubFinance";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter,
} from "@/components/ui/table";
import {
  Coins, Users, TrendingUp, Clock, ShieldCheck, Download, RefreshCw,
  Building2, PieChart as PieChartIcon, AlertCircle, Trophy,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";

const todayISO = () => financeBusinessToday();
const rangeStartISO = (days: number) => financeBusinessToday(new Date(Date.now()-(days-1)*86400000));
const monthStartISO = () => todayISO().slice(0,7)+'-01';

const REV_COLORS = { staking: "#00ff88", payout: "#1D9E75", rake: "#97C459", fnb: "#A06BE0" };

const tooltipStyle = {
  background: "#16191c",
  border: "1px solid #2a2f36",
  borderRadius: 8,
  fontSize: 12,
  color: "#e6e8eb",
} as const;

const ClubFinanceDashboard = () => {
  const { isAdmin, isClubAdmin, isClubOwner } = useAuth();
  const [from, setFrom] = useState(rangeStartISO(30));
  const [to, setTo] = useState(todayISO());
  const [clubFilter, setClubFilter] = useState("all");
  const [relativeRange,setRelativeRange]=useState<7|30|'month'|null>(30);
  useEffect(()=>{
    if(relativeRange===null)return;
    return startLiveReportRefresh(async()=>{
      setFrom(relativeRange==='month'?monthStartISO():rangeStartISO(relativeRange));
      setTo(todayISO());
    });
  },[relativeRange]);

  const { loading, error, clubs, summary, reload } = useClubFinanceSummary({ from, to, clubFilter });

  const donut = useMemo(() => {
    if (!summary) return [];
    return (Object.keys(summary.statusTotals) as PayrollStatusKey[])
      .map((k) => ({ key: k, label: PAYROLL_STATUS_META[k].label, value: summary.statusTotals[k], tone: PAYROLL_STATUS_META[k].tone }))
      .filter((d) => d.value > 0);
  }, [summary]);

  const agingData = useMemo(
    () => (summary ? AGING_BUCKETS.map((b) => ({ label: b.label, value: summary.aging[b.key], tone: b.tone })) : []),
    [summary],
  );
  const costClubs = useMemo(
    () => (summary ? summary.perClub.filter((c) => c.cost !== 0 || c.revenue !== 0).slice(0, 8) : []),
    [summary],
  );

  // Visible to club_admin, super_admin, OR club owner (clubs.owner_id). After all hooks (rules-of-hooks).
  if (!(isClubAdmin || isClubOwner)) {
    return <Navigate to="/" replace />;
  }

  const exportXlsx = () => {
    if (!summary || loading || error) return;
    exportToExcel(
      summary.perClub.map((c, i) => ({ ...c, _stt: i + 1 })),
      [
        { header: "STT", get: (r) => r._stt },
        { header: "CÂU LẠC BỘ", get: (r) => r.name },
        { header: "DOANH THU (₫)", get: (r) => r.revenue },
        { header: "CHI PHÍ ĐÃ GHI NHẬN (₫)", get: (r) => r.cost },
        { header: "CÒN LẠI SAU CHI PHÍ (₫)", get: (r) => r.net },
      ],
      `tai-chinh-clb_${from}_${to}`,
      "TỔNG HỢP THEO CLB",
    );
    exportToExcel(
      summary.perPeriod.map((p, i) => ({ ...p, _stt: i + 1 })),
      [
        { header: "STT", get: (r) => r._stt },
        { header: "CLB", get: (r) => r.clubName },
        { header: "KỲ", get: (r) => r.periodKey },
        { header: "TỔNG LƯƠNG (₫)", get: (r) => r.gross },
        { header: "LƯƠNG NET (₫)", get: (r) => r.net },
        { header: "TRẠNG THÁI", get: (r) => PAYROLL_STATUS_META[r.status].label },
      ],
      `tai-chinh-clb-ky-luong_${from}_${to}`,
      "THEO KỲ LƯƠNG DEALER",
    );
    if(summary.dealerLive) exportToExcel(
      [{...summary.dealerLive,clubScope:clubFilter==='all'?'Tất cả CLB được quyền xem':clubs.find(c=>c.id===clubFilter)?.name??'CLB đã chọn'}],
      [
        {header:'PHẠM VI CLB',get:r=>r.clubScope},
        {header:'CẬP NHẬT (UTC+7)',get:r=>new Date(r.asOf).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})},
        {header:'PT CHƯA CHỐT · DEALER ĐANG HOẠT ĐỘNG (₫)',get:r=>r.ptActiveUnfinalizedBalance},
        {header:'PT ĐÃ CHỐT CHƯA TRẢ (₫)',get:r=>r.ptFinalizedUnpaidBalance},
        {header:'TỔNG PT DEALER CHƯA TRẢ (₫)',get:r=>r.ptTotalUnpaid},
      ],
      'tai-chinh-clb-luong-dealer-pt-hien-tai',
      'PT DEALER HIỆN TẠI',
    );
    if(summary.dealerFtLive) exportToExcel(
      [{...summary.dealerFtLive,clubScope:clubFilter==='all'?'Tất cả CLB được quyền xem':clubs.find(c=>c.id===clubFilter)?.name??'CLB đã chọn'}],
      [
        {header:'PHẠM VI CLB',get:r=>r.clubScope},
        {header:'CẬP NHẬT (UTC+7)',get:r=>new Date(r.asOf).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})},
        {header:'KỲ DỰ TÍNH',get:r=>r.period},
        {header:'DEALER FT GROSS DỰ TÍNH (₫)',get:r=>r.gross},
        {header:'DEALER FT NET DỰ TÍNH (₫)',get:r=>r.net},
        {header:'CƠ SỞ DỰ TÍNH',get:()=> 'Ca đang mở theo giờ chuẩn; chỉ dealer chưa được ghi nhận trong kỳ'},
      ],
      'tai-chinh-clb-du-tinh-dealer-ft-hien-tai',
      'DEALER FT DỰ TÍNH',
    );
  };

  const r = summary?.revenue;
  const seg = (v: number) => (r && r.total > 0 ? (v / r.total) * 100 : 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl text-primary">Tài chính CLB</h1>
          <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
            {isAdmin ? "super_admin · toàn bộ CLB" : "chủ CLB"}
          </Badge>
        </div>
          <div className="text-xs text-muted-foreground">Tách khoản đã ghi nhận và lương tạm tính</div>
      </div>

      {/* Filters */}
      <Card className="p-3 gradient-card border-primary/20">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="owner-finance-from" className="text-xs text-muted-foreground">Từ ngày</Label>
            <Input id="owner-finance-from" type="date" value={from} onChange={(e) => {setRelativeRange(null);setFrom(e.target.value);}} className="h-9 w-[150px]" />
          </div>
          <div>
            <Label htmlFor="owner-finance-to" className="text-xs text-muted-foreground">Đến ngày</Label>
            <Input id="owner-finance-to" type="date" value={to} onChange={(e) => {setRelativeRange(null);setTo(e.target.value);}} className="h-9 w-[150px]" />
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-9" onClick={() => { setRelativeRange(7);setFrom(rangeStartISO(7)); setTo(todayISO()); }}>7 ngày</Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => { setRelativeRange(30);setFrom(rangeStartISO(30)); setTo(todayISO()); }}>30 ngày</Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => { setRelativeRange('month');setFrom(monthStartISO()); setTo(todayISO()); }}>Tháng này</Button>
          </div>
          {isAdmin && (
            <div>
              <Label className="text-xs text-muted-foreground">Câu lạc bộ</Label>
              <Select value={clubFilter} onValueChange={setClubFilter}>
                <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả các CLB</SelectItem>
                  {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex gap-1 ml-auto">
            <Button size="sm" variant="outline" className="h-9" onClick={reload} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Làm mới
            </Button>
            <Button size="sm" variant="outline" className="h-9" onClick={exportXlsx} disabled={loading || !summary || !!error}>
              <Download className="w-3.5 h-3.5 mr-1" /> Xuất Excel
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border-destructive/40 bg-destructive/10 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-destructive" /> {error}
        </Card>
      )}

      {!summary ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <Kpi icon={<Coins className="w-3.5 h-3.5" />} label="Doanh thu thật" value={formatVND(summary.revenue.total)} hint="các nguồn thu đã ghi nhận" accent="text-primary" />
            <Kpi icon={<Users className="w-3.5 h-3.5" />} label="Chi phí lương" value={formatVND(summary.cost.payrollNet)} hint="đã lưu" accent="text-[#f0997b]" />
            <Kpi icon={<TrendingUp className="w-3.5 h-3.5" />} label="Còn lại sau chi phí" value={formatVND(summary.net)} hint={summary.revenue.total > 0
              ? `biên ${formatPct(margin(summary.net, summary.revenue.total))} · theo số đã ghi nhận`
              : "Chưa xác định biên · doanh thu bằng hoặc dưới 0"} accent="text-primary" highlight />
            <Kpi icon={<Clock className="w-3.5 h-3.5" />} label="Lương ghi nhận chưa trả" value={formatVND(summary.unpaidTotal)} hint="các kỳ trong báo cáo" accent="text-warning" />
            <Kpi icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Đã đối soát" value={formatVND(summary.reconciledTotal)} hint="hoàn tất" accent="text-[#378ADD]" />
          </div>

          {/* Net formula note */}
          <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
            <span className="text-foreground/80">Còn lại sau chi phí: tổng doanh thu trừ lương, giá vốn F&amp;B/COMP và chi phí CLB đã ghi nhận trên server.</span>
            <span>·</span>
            <span className="text-warning/90">Chưa gồm khoản tạm tính và chi phí chưa ghi nhận; chưa phải lãi ròng cuối cùng.</span>
            <span>·</span>
            {summary.fnbAvailable ? (
              <span>buy-in, vốn staking, tiền mặt cashier KHÔNG tính vào số này</span>
            ) : (
              <span>buy-in, vốn staking và tiền mặt cashier KHÔNG tính vào số này</span>
            )}
          </div>

          <Card className="p-4 gradient-card border-primary/20 space-y-3">
            <h2 className="text-sm font-semibold">Lương nhân viên đang tạm tính · hiện tại</h2>
            {summary.staffLive ? <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="text-sm">FT gross tạm tính: <strong>{formatVND(summary.staffLive.ftProvisionalGross)}</strong></div>
                <div className="text-sm">FT net tạm tính: <strong>{formatVND(summary.staffLive.ftProvisionalNet)}</strong></div>
                <div className="text-sm">PT chưa trả: <strong>{formatVND(summary.staffLive.ptUnpaidBalance)}</strong></div>
              </div>
              <p className="text-xs text-muted-foreground">FT kỳ {summary.staffLive.ftPeriod}; PT là số dư chưa trả hiện tại, có thể gồm ca từ kỳ trước. Chưa cộng các khoản này vào chi phí đã ghi nhận trong khoảng báo cáo.</p>
            </> : <p className="text-sm text-muted-foreground">Chưa xác minh được tổng hợp lương nhân viên ngoài dealer từ backend hiện tại.</p>}
          </Card>

          <Card className="p-4 gradient-card border-primary/20 space-y-3">
            <h2 className="text-sm font-semibold">Dealer FT dự tính · kỳ hiện tại chưa ghi nhận</h2>
            {summary.dealerFtLive ? <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="text-sm">Dealer FT gross dự tính: <strong>{formatVND(summary.dealerFtLive.gross)}</strong></div>
                <div className="text-sm">Dealer FT net dự tính: <strong>{formatVND(summary.dealerFtLive.net)}</strong></div>
              </div>
              <p className="text-xs text-muted-foreground">Kỳ {summary.dealerFtLive.period}; chỉ gồm dealer chưa được ghi nhận trong kỳ. Ca đang mở dự tính theo giờ chuẩn, chưa cộng vào chi phí đã ghi nhận.</p>
            </> : <p className="text-sm text-muted-foreground">Chưa có dữ liệu dự tính dealer FT đã xác minh.</p>}
          </Card>

          <Card className="p-4 gradient-card border-primary/20 space-y-3">
            <h2 className="text-sm font-semibold">Lương dealer PT chưa trả · hiện tại</h2>
            {summary.dealerLive ? <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="text-sm">Chưa chốt (dealer đang hoạt động): <strong>{formatVND(summary.dealerLive.ptActiveUnfinalizedBalance)}</strong></div>
                <div className="text-sm">Đã chốt, chưa trả: <strong>{formatVND(summary.dealerLive.ptFinalizedUnpaidBalance)}</strong></div>
                <div className="text-sm">Tổng PT dealer chưa trả: <strong>{formatVND(summary.dealerLive.ptTotalUnpaid)}</strong></div>
              </div>
              <p className="text-xs text-muted-foreground">Số dư hiện tại, có thể gồm ca từ kỳ trước. Chưa cộng vào chi phí đã ghi nhận; chi phí PT được ghi nhận khi trả.</p>
            </> : <p className="text-sm text-muted-foreground">Chưa có dữ liệu lương dealer PT đã xác minh.</p>}
          </Card>

          {/* Revenue breakdown — two SEPARATE streams: Giải đấu (rake) vs Staking (phí) */}
          <Card className="p-4 gradient-card border-primary/20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold"><PieChartIcon className="w-4 h-4 text-primary" /> Cơ cấu doanh thu thật</div>
              <div className="text-sm font-bold text-primary">{formatVND(summary.revenue.total)}</div>
            </div>
            {/* top-level: tournament rake vs staking fees (kept separate) */}
            {summary.revenue.total>0&&[summary.revenue.rake,summary.revenue.serviceFee,summary.revenue.stakingFees,summary.revenue.payoutFees,summary.revenue.fnb].every(v=>v>=0)&&<div className="flex h-3.5 rounded-full overflow-hidden bg-muted">
              <div style={{ width: `${seg(summary.revenue.rake+summary.revenue.serviceFee)}%`, background: REV_COLORS.rake }} />
              <div style={{ width: `${seg(summary.revenue.stakingFees + summary.revenue.payoutFees)}%`, background: REV_COLORS.staking }} />
              {summary.fnbAvailable&&<div style={{width:`${seg(summary.revenue.fnb)}%`,background:REV_COLORS.fnb}}/>}
            </div>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <LegendDot color={REV_COLORS.rake} label="Giải đấu (rake + phí dịch vụ)" value={formatVND(summary.revenue.rake+summary.revenue.serviceFee)} />
              <LegendDot color={REV_COLORS.staking} label="Staking (phí)" value={formatVND(summary.revenue.stakingFees + summary.revenue.payoutFees)} />
              {summary.fnbAvailable ? (
                <LegendDot color={REV_COLORS.fnb} label="F&amp;B (doanh thu)" value={formatVND(summary.revenue.fnb)} />
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground/70">
                  <span className="inline-block w-2 h-2 rounded-[2px] border border-dashed border-muted-foreground/60" />
                  Chưa xác minh được dữ liệu F&amp;B từ backend hiện tại
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              {/* GIẢI ĐẤU */}
              <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-1.5">
                <div className="text-xs font-semibold text-foreground/90 flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5" style={{ color: REV_COLORS.rake }} /> Giải đấu
                </div>
                  <Line label="Rake giải đấu" value={formatVND(summary.revenue.rake)} strong />
                  <Line label="Phí dịch vụ giải đấu" value={formatVND(summary.revenue.serviceFee)} />
                <Line label="• Online" value={formatVND(summary.revenue.rakeOnline)} sub />
                <Line label="• Offline" value={formatVND(summary.revenue.rakeOffline)} sub />
                <Line label="• Re-entry" value={formatVND(summary.revenue.rakeReentry)} sub />
                {(summary.revenue.serviceFee ?? 0) > 0 && (
                  <Line label="Phí dịch vụ" value={formatVND(summary.revenue.serviceFee)} strong />
                )}
                <div className="h-px bg-border/50 my-1" />
                <Line label="Thực thu (đối chiếu)" value={formatVND(summary.revenue.rakeActual)} muted />
                <Line
                  label="Chênh lệch"
                  value={`${summary.revenue.rakeVariance >= 0 ? "+" : ""}${formatVND(summary.revenue.rakeVariance)}`}
                  tone={summary.revenue.rakeVariance < 0 ? "#f0997b" : "#00ff88"}
                />
              </div>
              {/* STAKING */}
              <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-1.5">
                <div className="text-xs font-semibold text-foreground/90 flex items-center gap-1.5">
                  <Coins className="w-3.5 h-3.5" style={{ color: REV_COLORS.staking }} /> Staking
                </div>
                <Line label="Phí cố định / dịch vụ" value={formatVND(summary.revenue.stakingFixed)} />
                <Line label="Phí % / giao dịch" value={formatVND(summary.revenue.stakingPercent)} />
                <Line label="Phí lưu trữ" value={formatVND(summary.revenue.stakingArchive)} />
                <Line label="Phí chi trả / ITM / cash-out" value={formatVND(summary.revenue.payoutFees)} />
              </div>
              {/* Display verified server F&B movements, including zero and refund-only periods. */}
              {summary.fnbAvailable && (
                <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-1.5">
                  <div className="text-xs font-semibold text-foreground/90 flex items-center gap-1.5">
                    <Coins className="w-3.5 h-3.5" style={{ color: REV_COLORS.fnb }} /> F&amp;B (Đồ ăn / thức uống)
                  </div>
                  <Line label="Doanh thu (sau hoàn)" value={formatVND(summary.revenue.fnb)} strong />
                  <Line label="Giá vốn (COGS)" value={formatVND(summary.cost.fnbCogs)} tone="#f0997b" />
                  {summary.cost.compCogs !== 0 && (
                    <Line label="Giá vốn COMP (miễn phí)" value={formatVND(summary.cost.compCogs)} tone="#f0997b" />
                  )}
                  <div className="h-px bg-border/50 my-1" />
                  <Line label="Doanh thu trừ COGS bán hàng" value={formatVND(summary.revenue.fnb - summary.cost.fnbCogs)} strong tone={REV_COLORS.fnb} />
                </div>
              )}
            </div>

            <div className="text-[10px] text-muted-foreground/80 pt-0.5">
              Rake và phí dịch vụ theo từng lượt buy đã thanh toán, dùng giá đã ghi nhận. Buy-in là tiền giải, không tính vào doanh thu này. Phí staking tách riêng, không gộp vào rake.
            </div>
          </Card>

          {/* Charts: trend + donut */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4 gradient-card border-primary/20">
              <div className="text-sm font-semibold mb-2">Doanh thu vs Chi phí đã ghi nhận</div>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={summary.trend} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2f36" vertical={false} />
                    <XAxis dataKey="key" tick={{ fontSize: 11, fill: "#8b9099" }} tickLine={false} axisLine={{ stroke: "#2a2f36" }} />
                    <YAxis tickFormatter={(v) => formatVndShort(Number(v))} tick={{ fontSize: 11, fill: "#8b9099" }} tickLine={false} axisLine={false} width={48} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatVND(Number(v))} />
                    <Area type="monotone" dataKey="revenue" name="Doanh thu" stroke="#00ff88" fill="rgba(0,255,136,0.14)" strokeWidth={2} />
                    <Area type="monotone" dataKey="cost" name="Chi phí đã ghi nhận" stroke="#f0997b" fill="rgba(240,153,123,0.10)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4 gradient-card border-primary/20">
              <div className="text-sm font-semibold mb-2">Trạng thái payroll</div>
              {donut.length === 0 ? (
                <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">Chưa có kỳ lương trong khoảng này.</div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="h-[200px] flex-1 min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={donut} dataKey="value" nameKey="label" innerRadius={48} outerRadius={78} paddingAngle={2} stroke="none">
                          {donut.map((d) => <Cell key={d.key} fill={d.tone} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatVND(Number(v))} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    {donut.map((d) => <LegendDot key={d.key} color={d.tone} label={d.label} />)}
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* Charts: aging + cost-by-club (admin) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4 gradient-card border-primary/20">
              <div className="text-sm font-semibold mb-2">Tuổi nợ lương chưa trả</div>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agingData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2f36" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8b9099" }} tickLine={false} axisLine={{ stroke: "#2a2f36" }} />
                    <YAxis tickFormatter={(v) => formatVndShort(Number(v))} tick={{ fontSize: 11, fill: "#8b9099" }} tickLine={false} axisLine={false} width={48} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatVND(Number(v))} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {agingData.map((a, i) => <Cell key={i} fill={a.tone} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {isAdmin && (
              <Card className="p-4 gradient-card border-primary/20">
                <div className="text-sm font-semibold mb-2 flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" /> Chi phí đã ghi nhận theo CLB</div>
                <p className="text-xs text-muted-foreground mb-2">Độ dài thanh theo trị tuyệt đối; số âm là khoản giảm chi phí.</p>
                <div className="space-y-2.5">
                  {costClubs.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-6 text-center">Chưa có dữ liệu.</div>
                  ) : costClubs.map((c) => {
                    const max = Math.max(...costClubs.map((x) => Math.abs(x.cost)), 1);
                    return (
                      <div key={c.clubId}>
                        <div className="flex justify-between text-[11px] mb-1"><span className="truncate">{c.name}</span><span>{formatVND(c.cost)}</span></div>
                        <div className="h-2 rounded bg-muted overflow-hidden"><div className="h-2 rounded" style={{ width: `${(Math.abs(c.cost) / max) * 100}%`, background: "#f0997b" }} /></div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>

          {/* Per-club table (admin) */}
          {isAdmin && summary.perClub.length > 0 && (
            <Card className="p-0 gradient-card border-primary/20 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/50 text-sm font-semibold">So sánh theo câu lạc bộ</div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Câu lạc bộ</TableHead>
                      <TableHead className="text-right">Doanh thu</TableHead>
                      <TableHead className="text-right">Chi phí đã ghi nhận</TableHead>
                      <TableHead className="text-right">Còn lại</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.perClub.map((c) => (
                      <TableRow key={c.clubId} className={isAdmin ? "cursor-pointer" : ""} onClick={() => isAdmin && setClubFilter(c.clubId)}>
                        <TableCell className="text-sm font-medium">{c.name}</TableCell>
                        <TableCell className="text-right text-xs text-primary">{formatVND(c.revenue)}</TableCell>
                        <TableCell className="text-right text-xs text-[#f0997b]">{formatVND(c.cost)}</TableCell>
                        <TableCell className="text-right text-xs font-bold">{formatVND(c.net)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-bold">TỔNG</TableCell>
                      <TableCell className="text-right text-primary">{formatVND(summary.revenue.total)}</TableCell>
                      <TableCell className="text-right text-[#f0997b]">{formatVND(summary.perClub.reduce((total,club)=>total+club.cost,0))}</TableCell>
                      <TableCell className="text-right font-bold">{formatVND(summary.net)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </Card>
          )}

          {/* Per-period table */}
          <Card className="p-0 gradient-card border-primary/20 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/50 text-sm font-semibold">Theo kỳ lương dealer</div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {isAdmin && <TableHead>CLB</TableHead>}
                    <TableHead>Kỳ</TableHead>
                    <TableHead className="text-right">Tổng lương</TableHead>
                    <TableHead className="text-right">Lương net</TableHead>
                    <TableHead className="text-right">Trạng thái</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.perPeriod.length === 0 ? (
                    <TableRow><TableCell colSpan={isAdmin ? 5 : 4} className="text-center text-muted-foreground py-8">Không có kỳ lương trong khoảng này.</TableCell></TableRow>
                  ) : summary.perPeriod.map((p) => (
                    <TableRow key={p.id}>
                      {isAdmin && <TableCell className="text-xs">{p.clubName}</TableCell>}
                      <TableCell className="text-sm font-medium">{p.periodKey}</TableCell>
                      <TableCell className="text-right text-xs">{formatVND(p.gross)}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-primary">{formatVND(p.net)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary" className="text-[9px]" style={{ background: `${PAYROLL_STATUS_META[p.status].tone}22`, color: PAYROLL_STATUS_META[p.status].tone }}>
                          {PAYROLL_STATUS_META[p.status].label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

function Kpi({ icon, label, value, hint, accent, highlight }: {
  icon: React.ReactNode; label: string; value: string; hint?: string; accent?: string; highlight?: boolean;
}) {
  return (
    <Card className={`p-3 gradient-card ${highlight ? "border-primary/40" : "border-primary/20"}`}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">{icon}{label}</div>
      <div className={`text-lg font-display font-bold mt-1 ${accent ?? "text-foreground"}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </Card>
  );
}

function Line({ label, value, strong, muted, sub, tone }: {
  label: string; value: string; strong?: boolean; muted?: boolean; sub?: boolean; tone?: string;
}) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className={muted ? "text-muted-foreground/60" : sub ? "text-muted-foreground pl-1" : "text-muted-foreground"}>{label}</span>
      <span className={`font-mono ${strong ? "font-bold text-primary" : "text-foreground/90"}`} style={tone ? { color: tone } : undefined}>{value}</span>
    </div>
  );
}

function LegendDot({ color, label, value }: { color: string; label: string; value?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: color }} />
      {label}{value ? ` · ${value}` : ""}
    </span>
  );
}

export default ClubFinanceDashboard;
