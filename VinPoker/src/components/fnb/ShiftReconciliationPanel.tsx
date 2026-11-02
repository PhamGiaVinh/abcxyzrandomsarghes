import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { useFnbShiftIntent } from "@/hooks/useFnbShiftIntent";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { fnbShiftBackend,parseFnbShiftCash } from "@/lib/fnbShiftIntent";
import { useFnbShifts, useFnbShiftReport } from "@/hooks/useFnbShift";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Loader2, DoorOpen, DoorClosed, Wallet } from "lucide-react";

const fmtTime = (iso: string | null): string => (iso ? new Date(iso).toLocaleString("vi-VN") : "—");
// khớp = muted, thừa (>0) = success, thiếu (<0) = destructive — same convention as StocktakeBoard.
const varTone = (v: number | null | undefined): string =>
  v == null || v === 0 ? "text-muted-foreground" : v > 0 ? "text-success" : "text-destructive";
const varLabel = (v: number | null | undefined): string =>
  v == null ? "" : v === 0 ? "(khớp)" : v > 0 ? "(thừa)" : "(thiếu)";
const signed = (v: number | null | undefined): string =>
  v == null ? "—" : (v > 0 ? "+" : "") + formatVND(v);

/**
 * A3 — F&B counter cash-shift reconciliation ("Chốt ca"). Mirrors StocktakeBoard's open→count→commit:
 * open a shift (optional opening float) → take orders on the other tabs → close by counting the drawer
 * and see the variance (khớp/thiếu/thừa) vs system-expected cash. Cash-only. Every mutation routes
 * through the SECURITY DEFINER RPCs; the server re-enforces cashier/owner authz. Parent gates this on
 * FEATURES.fnbShifts && canPay. Untyped fnb_* client.
 */
export function ShiftReconciliationPanel({ clubId, canClose }: { clubId: string; canClose: boolean }) {
  const {user,session,loading}=useAuth();
  if(loading)return <Skeleton className="h-40 w-full"/>;
  if(!user)return <Card role="alert" className="p-4">Đăng nhập để xác minh ca.</Card>;
  let backend='';try{backend=fnbShiftBackend(import.meta.env.VITE_SUPABASE_URL);}catch{return <Card role="alert" className="p-4">Không xác minh được backend ca.</Card>;}
  return <ScopedShiftPanel key={`${backend}:${user.id}:${sessionReadEpoch(session)}:${clubId}`} clubId={clubId} canClose={canClose} actorId={user.id}/>;
}
function ScopedShiftPanel({clubId,canClose,actorId}:{clubId:string;canClose:boolean;actorId:string}) {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useFnbShifts(clubId);
  const openShift = isError ? null : data?.open ?? null;
  const closedRows = (data?.recent ?? []).filter((r) => r.status === "closed");

  const { data: report, isLoading: reportLoading, isError: reportError, refetch: refetchReport } = useFnbShiftReport(openShift?.id ?? null);

  const [floatInput, setFloatInput] = useState("");
  const [countedInput, setCountedInput] = useState("");

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["fnb", "shifts", clubId] });
    if (openShift?.id) await qc.invalidateQueries({ queryKey: ["fnb", "shiftReport", openShift.id] });
    setFloatInput("");setCountedInput("");
  };
  const intent=useFnbShiftIntent(actorId,clubId,invalidate);
  const opening=intent.busy,closing=intent.busy;
  const openShiftFn = async () => {
    const amount=parseFnbShiftCash(floatInput,true);
    if(amount===null){toast.error('Nhập số tiền nguyên không âm hợp lệ.');return;}
    await intent.submit('open',null,amount);
  };

  const closeShiftFn = async () => {
    if (!openShift) return;
    if (countedInput.trim() === "") { toast.error("Nhập số tiền mặt đã đếm."); return; }
    const amount=parseFnbShiftCash(countedInput);
    if(amount===null){toast.error('Nhập số tiền nguyên không âm hợp lệ.');return;}
    await intent.submit('close',openShift.id,amount);
  };

  if(intent.pending)return <Card role="alert" className="p-4 space-y-3">
    <p>Yêu cầu {intent.pending.operation==='open'?'mở':'chốt'} ca chưa được xác minh. Không tạo mã mới.</p>
    <p className="text-xs break-all">Mã: {intent.pending.requestId}</p>
    {intent.message&&<p className="text-sm">{intent.message}</p>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={intent.busy} onClick={()=>void intent.recover()}>Đối chiếu yêu cầu</Button>
      <Button variant="outline" disabled={!canClose||intent.busy} onClick={()=>void intent.retry()}>Gửi lại cùng mã</Button>
      <Button variant="outline" disabled={!canClose||intent.busy} onClick={()=>void intent.cancel()}>Hủy yêu cầu an toàn</Button>
    </div>
  </Card>;
  if(intent.blocked)return <Card role="alert" className="p-4">{intent.message??'Đang xác minh yêu cầu ca đã lưu…'}</Card>;
  if(!isError&&data&&(data.open&&data.open.club_id!==clubId||data.recent.some(row=>row?.club_id!==clubId))
    ||!reportLoading&&!reportError&&openShift&&report&&(report.shift.id!==openShift.id||report.shift.club_id!==clubId))return (
    <Card role="alert" className="p-4 space-y-3">
      <p>Không xác minh được ca thuộc đúng CLB. Chưa thể mở hoặc chốt ca.</p>
      <Button variant="outline" onClick={()=>{void refetch();void refetchReport();}}>Thử tải lại ca</Button>
    </Card>
  );

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError || !data) return (
    <Card role="alert" className="p-4 space-y-3">
      <p>Không xác minh được danh sách ca. Chưa thể mở hoặc chốt ca.</p>
      <Button variant="outline" onClick={() => void refetch()}>Thử tải lại ca</Button>
    </Card>
  );
  if (openShift && reportLoading) return <p role="status">Đang tải số liệu ca…</p>;
  if (openShift && (reportError || !report)) return (
    <Card role="alert" className="p-4 space-y-3">
      <p>Không xác minh được số liệu ca. Chưa thể chốt ca.</p>
      <Button variant="outline" onClick={() => void refetchReport()}>Thử tải lại số liệu ca</Button>
    </Card>
  );

  return (
    <div className="space-y-4">
      {!canClose && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          Bạn không có vai trò Thu ngân — không thể mở/chốt ca (chủ CLB cấp quyền ở Quản trị → Nhân sự).
        </div>
      )}

      {/* ── No open shift → open one ─────────────────────────────────────────── */}
      {!openShift ? (
        <Card className="p-5 space-y-3">
          <div className="text-sm font-semibold flex items-center gap-2"><DoorOpen className="w-4 h-4 text-primary" /> Chưa có ca đang mở</div>
          <p className="text-xs text-muted-foreground">Mở ca để bắt đầu tính tiền mặt F&amp;B. Cuối ca, đếm tiền và chốt để xem chênh lệch.</p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Tiền quỹ đầu ca (nếu có)</Label>
              <Input aria-label="Tiền quỹ đầu ca" value={floatInput} onChange={(e) => setFloatInput(e.target.value)} inputMode="numeric"
                placeholder="0" className="bg-card border-border text-foreground h-9 w-[160px] font-mono" />
            </div>
            <Button className="h-9" disabled={!canClose || opening} onClick={openShiftFn}>
              {opening ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <DoorOpen className="w-4 h-4 mr-1" />} Mở ca
            </Button>
          </div>
        </Card>
      ) : (
        /* ── Open shift → live totals + close form ──────────────────────────── */
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" /> Ca đang mở</div>
            <div className="text-xs text-muted-foreground">Mở: {fmtTime(openShift.opened_at)}</div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Tiền quỹ đầu ca" value={formatVND(openShift.opening_float_vnd)} />
            <Stat label="Doanh thu (đã thu)" value={formatVND(report?.sales_vnd ?? 0)} />
            <Stat label="Hoàn tiền" value={report?.refunds_vnd ? `- ${formatVND(report.refunds_vnd)}` : formatVND(0)} tone="#f0997b" />
            <Stat label="Dự kiến trong két" value={formatVND(report?.expected_drawer_vnd ?? openShift.opening_float_vnd)} strong />
          </div>
          {!!report?.comp_count && (
            <div className="text-xs text-muted-foreground">Có {report.comp_count} đơn comp (miễn phí) — không tính vào tiền mặt.</div>
          )}

          <div className="border-t border-border pt-3 flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Tiền mặt đã đếm</Label>
              <Input aria-label="Tiền mặt đã đếm" value={countedInput} onChange={(e) => setCountedInput(e.target.value)} inputMode="numeric"
                placeholder="Đếm trong két" className="bg-card border-border text-foreground h-9 w-[180px] font-mono" />
            </div>
            <Button variant="destructive" className="h-9" disabled={!canClose || closing} onClick={closeShiftFn}>
              {closing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <DoorClosed className="w-4 h-4 mr-1" />} Chốt ca
            </Button>
            {parseFnbShiftCash(countedInput) !== null && (
              <div className={`text-sm font-mono self-center ${varTone(parseFnbShiftCash(countedInput)! - (report?.expected_drawer_vnd ?? openShift.opening_float_vnd))}`}>
                Chênh lệch: {signed(parseFnbShiftCash(countedInput)! - (report?.expected_drawer_vnd ?? openShift.opening_float_vnd))}{" "}
                {varLabel(parseFnbShiftCash(countedInput)! - (report?.expected_drawer_vnd ?? openShift.opening_float_vnd))}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── History of closed shifts ───────────────────────────────────────── */}
      <Card className="p-4">
        <div className="text-sm font-semibold mb-2">Lịch sử chốt ca</div>
        {closedRows.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">Chưa có ca nào đã chốt.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mở → Chốt</TableHead>
                <TableHead className="text-right">Dự kiến</TableHead>
                <TableHead className="text-right">Đã đếm</TableHead>
                <TableHead className="text-right">Chênh lệch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {closedRows.map((r) => {
                const expectedDrawer = (r.opening_float_vnd ?? 0) + (r.expected_cash_vnd ?? 0);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{fmtTime(r.opened_at)}<br />→ {fmtTime(r.closed_at)}</TableCell>
                    <TableCell className="text-right font-mono">{formatVND(expectedDrawer)}</TableCell>
                    <TableCell className="text-right font-mono">{r.counted_cash_vnd == null ? "—" : formatVND(r.counted_cash_vnd)}</TableCell>
                    <TableCell className={`text-right font-mono ${varTone(r.variance_vnd)}`}>
                      {signed(r.variance_vnd)} <span className="text-[11px]">{varLabel(r.variance_vnd)}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`font-mono ${strong ? "text-base font-semibold" : "text-sm"}`} style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  );
}
