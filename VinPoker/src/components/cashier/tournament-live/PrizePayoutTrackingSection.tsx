import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { usePrizePaymentIntent } from "@/hooks/usePrizePaymentIntent";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Lock, CheckCircle2, HandCoins } from "lucide-react";
import { formatVND } from "@/lib/format";
import {
  useTournamentPayoutRecipients, type PayoutRecipientPlace,
} from "@/hooks/useTournamentPayoutRecipients";

// W3-B2 — cashier "Đã trả thưởng" (record prize paid) section. Read via
// get_tournament_payout_recipients (server-derived list); write via
// record_tournament_prize_payment_v2 (server derives amount + recipient and
// revalidates the read confirmation token). Money-action: a confirmation dialog restates the
// recipient / rank / amount before the ledger row is written; already_paid is idempotent success,
// never a red error. Read-only display doctrine: every number is Tạm tính (a hand-over
// acknowledgement, NOT a bank/cash reconciliation).

const METHOD_LABEL: Record<string, string> = {
  cash: "Tiền mặt", bank: "Chuyển khoản", app: "Ví/App", other: "Khác",
};


function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }); } catch { return ""; }
}

export function PrizePayoutTrackingSection({ tournamentId }: { tournamentId: string }) {
  const { user, session } = useAuth();
  const scope = JSON.stringify([tournamentId, user?.id, sessionReadEpoch(session)]);
  return <ScopedPrizePayoutTrackingSection key={scope} tournamentId={tournamentId} actorId={user?.id} />;
}

function ScopedPrizePayoutTrackingSection({ tournamentId, actorId }: { tournamentId: string; actorId?: string }) {
  const { loading, error, notApplied, data, reload } = useTournamentPayoutRecipients(tournamentId);
  const [target, setTarget] = useState<PayoutRecipientPlace | null>(null);
  const [method, setMethod] = useState<string>("cash");
  const payment = usePrizePaymentIntent(actorId, tournamentId, reload);
  const busy = payment.busy;
  const verified = !loading && !error && !notApplied && data?.tournamentId === tournamentId;
  const confirmedTarget = verified && !payment.pending && !payment.blocked && target && data.places.some((place) =>
    !place.isPaid && place.finishedPlace === target.finishedPlace && place.entryId === target.entryId
    && place.recipientRef === target.recipientRef && place.confirmationToken === target.confirmationToken
    && place.recipientName === target.recipientName && place.prizeAmount === target.prizeAmount,
  ) ? target : null;
  useEffect(() => {
    if (target && !confirmedTarget) setTarget(null);
  }, [target, confirmedTarget]);
  const confirmPay = () => {
    if (!confirmedTarget) return;
    void payment.submit(confirmedTarget, method);
    setTarget(null);
  };

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <HandCoins className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Đã trả thưởng</span>
          {verified && data.isPartial && <Badge variant="outline">Một phần Main Event</Badge>}
        </div>
        {data && data.totalCount > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {data.paidCount}/{data.totalCount} {data.isPartial ? "suất đã chốt" : "suất"} · {formatVND(data.paidTotal)}/{formatVND(data.owedTotal)}
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Ghi nhận đã trao tiền thưởng cho người thắng — <span className="text-amber-500">Tạm tính</span>,
        không phải đối soát ngân hàng. {data?.mode==='multi_day'
          ?'Số tiền theo nghĩa vụ Main Event đã khóa và điều chỉnh đã duyệt, gồm minimum cash/bag cash.'
          :'Số tiền do hệ thống tự tính theo hạng.'}
      </p>
      {verified && data.isPartial && (
        <p role="status" className="text-xs text-amber-500">
          Chỉ gồm nghĩa vụ cá nhân đã chốt; chưa phải tổng nghĩa vụ toàn Main Event.
        </p>
      )}

      {payment.pending && (
        <div role="status" className="space-y-2 rounded border border-amber-500/30 p-2 text-xs">
          <p>Yêu cầu đang chờ xác minh · Hạng {payment.pending.finishedPlace} · {payment.pending.recipientName} · {formatVND(payment.pending.prizeAmount)}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { void payment.recover(); }}>Kiểm tra kết quả</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { void payment.retry(); }}>Gửi lại yêu cầu cũ</Button>
          </div>
        </div>
      )}
      {payment.blocked && <p role="alert" className="text-xs text-destructive">Chưa xác minh được yêu cầu đã lưu. Tạm khóa ghi nhận mới.</p>}
      {notApplied ? (
        <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-500">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Cần áp dụng trên hệ thống (RPC chưa được bật). Xem được cấu trúc — chưa ghi nhận trả được.</span>
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang tải danh sách…
        </div>
      ) : error ? (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-destructive">Không tải được: {error}</p>
          <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={reload}>Tải lại danh sách trả thưởng</Button>
        </div>
      ) : !verified || !data || data.places.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Chưa có hạng trúng thưởng đã chốt kết quả — chưa thể ghi nhận trả.
        </p>
      ) : (
        <div className="space-y-1">
          {data.places.map((p) => (
            <div
              key={p.entryId}
              className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2 rounded border border-border/60 bg-muted/20 px-2 py-2 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto]"
            >
              <span className="text-xs font-semibold text-muted-foreground">#{p.finishedPlace}</span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{p.recipientName}</div>
                <div className="font-mono text-xs text-primary">{data.mode==='multi_day'
                  ?<>Nghĩa vụ {formatVND(p.obligationAmount??0)} · Đã trả {formatVND(p.paidAmount??0)} · Còn {formatVND(p.prizeAmount)}</>
                  :formatVND(p.prizeAmount)}</div>
              </div>
              {p.isPaid ? (
                <Badge variant="outline" className="col-start-2 w-fit max-w-full whitespace-normal border-emerald-500/40 text-emerald-500 text-[10px] sm:col-start-auto">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Đã trả{p.paidAt ? ` · ${fmtDate(p.paidAt)}` : ""}
                  {p.method && METHOD_LABEL[p.method] ? ` · ${METHOD_LABEL[p.method]}` : ""}
                </Badge>
              ) : (
                <Button
                  size="sm"
                  disabled={busy || !!payment.pending || payment.blocked}
                  variant="outline"
                  className="col-start-2 min-h-11 w-fit text-xs sm:col-start-auto"
                  onClick={() => { setMethod("cash"); setTarget(p); }}
                >
                  Ghi nhận đã trả
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!confirmedTarget} onOpenChange={(v) => { if (!busy && !v) setTarget(null); }}>
        <AlertDialogContent className="operations-typography max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận đã trả thưởng</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Người nhận</span>
                    <span className="min-w-0 break-words text-right font-medium [overflow-wrap:anywhere]">{target?.recipientName}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Hạng</span>
                    <span className="font-medium">#{target?.finishedPlace}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Số tiền</span>
                    <span className="font-mono font-bold text-primary">
                      {target ? formatVND(target.prizeAmount) : ""}
                    </span>
                  </div>
                </div>
                <p>Sau khi xác nhận, hệ thống ghi nhận đã trả vào lịch sử (không thể tự ý sửa).</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Hình thức trả</Label>
            <Select value={method} onValueChange={setMethod} disabled={busy}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Tiền mặt</SelectItem>
                <SelectItem value="bank">Chuyển khoản</SelectItem>
                <SelectItem value="app">Ví/App</SelectItem>
                <SelectItem value="other">Khác</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Quay lại</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); confirmPay(); }}>
              {busy ? "Đang ghi nhận…" : "Xác nhận đã trả"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
