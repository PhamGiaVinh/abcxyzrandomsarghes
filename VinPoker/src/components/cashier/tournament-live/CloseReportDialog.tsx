/**
 * CloseReportDialog — operator "Chốt giải" settlement report + 2-step lock.
 *
 * Shows the per-tournament money reconciliation (buy-in pass-through, club revenue =
 * rake + service, prize, cashier balance) from the pure computeCloseReport, then a
 * type-to-confirm ("CHOT GIAI") lock that calls the audited `close_tournament` RPC.
 *
 * Money-path (RED): rendered ONLY behind FEATURES.closeReport (the caller gates the
 * entry button). Locking does NOT auto-close dealer tours or release staking — those
 * stay explicit; this dialog only settles + finalizes the tournament itself.
 */
import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Lock, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import { useCloseReport } from "@/hooks/useCloseReport";
import { describeCloseBlockers } from "@/lib/feltLifecycleReadiness";
import {TournamentRankingReviewPanel} from './TournamentRankingReviewPanel';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tournamentId: string;
  tournamentName: string;
  onClosed?: () => void;
}

const CONFIRM_PHRASE = "CHOT GIAI";
const fmt = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}₫`;

function Cell({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="text-lg font-semibold tabular-nums leading-none">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-1 leading-tight">{label}</div>
      {hint && <div className="text-[10px] text-muted-foreground/70 leading-tight">{hint}</div>}
    </div>
  );
}

function Row({ label, sub, amount, accent }: { label: string; sub?: string; amount: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm border-b border-border/60 last:border-0">
      <span>
        {label}
        {sub && <span className="text-muted-foreground"> · {sub}</span>}
      </span>
      <span className={`tabular-nums ${accent ? "text-warning font-medium" : ""}`}>{amount}</span>
    </div>
  );
}

export default function CloseReportDialog({ open, onOpenChange, tournamentId, tournamentName, onClosed }: Props) {
  const { report, loading, error, alreadyClosed, readiness, reload, closeTournament } = useCloseReport(tournamentId);
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [rankingBlocked,setRankingBlocked]=useState(true);

  useEffect(() => {
    if (open) { setStep(1); setTyped(""); reload(); }
  }, [open, reload]);

  // A refreshed report needs a new review; an earlier phrase is not consent to new figures.
  useEffect(() => {
    if (loading || error) { setStep(1); setTyped(""); }
  }, [loading, error]);

  const phraseOk = typed.trim().toUpperCase() === CONFIRM_PHRASE;
  const canConfirm = phraseOk && !loading && !error && !busy && !rankingBlocked && !alreadyClosed && !!report && readiness?.ok === true && readiness.ready;

  const handleConfirm = async () => {
    if(!canConfirm)return;
    setBusy(true);
    const res = await closeTournament("close_report");
    setBusy(false);
    if(res.error==='close_scope_changed')return;
    if (!res.ok) {
      toast.error(`Không chốt được: ${res.error ?? "lỗi không rõ"}`);
      return;
    }
    toast.success(res.reconciled ? "Đã chốt giải — số dư khớp" : "Đã chốt giải (số dư chưa cân — đã ghi nhận)");
    onClosed?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-4 h-4" /> Chốt giải
          </DialogTitle>
          <DialogDescription className="font-medium text-foreground">{tournamentName}</DialogDescription>
        </DialogHeader>

        <TournamentRankingReviewPanel tournamentId={tournamentId} required={readiness?.blockers.includes('manual_ranking_review_required')??false}
          enabled={open} onBlockingChange={setRankingBlocked} onRecorded={reload}/>

        {loading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <div className="min-w-0 space-y-2">
              <p>Không tải được báo cáo: {error}</p>
              <Button variant="outline" size="sm" className="min-h-11" disabled={busy}
                onClick={()=>{setStep(1);setTyped("");void reload();}}>Thử tải lại báo cáo</Button>
            </div>
          </div>
        )}

        {!loading && !error && report && (
          <div className="space-y-3">
            {alreadyClosed && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
                <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                <span>Giải này đã được chốt. Đây là snapshot tại lúc chốt, không phải số dư quầy hiện tại.
                  Các khoản trả thưởng sau đó xem tại mục Payout.</span>
              </div>
            )}
            {!alreadyClosed && readiness && !readiness.ready && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning" role="status">
                Chưa thể chốt giải. Hãy xử lý trong Floor/Tracker: {describeCloseBlockers(readiness.blockers)}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <Cell label="Đăng ký đã xác nhận" value={report.entryCount} hint={`${report.bySource.online} on · ${report.bySource.offline} off · ${report.bySource.reentry} re`} />
              <Cell label="Re-entry" value={report.reentryCount} />
              <Cell label="Free-rake" value={report.freeRakeUsed} />
            </div>
            <p className="text-xs text-muted-foreground">Báo cáo đăng ký và thu/chi của riêng giải này; không gộp tiền các flight hoặc nghĩa vụ payout Main Event. Người qualified vào D2 không tạo đăng ký thu phí mới.</p>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border p-3">
                <div className="text-[11px] font-medium text-muted-foreground mb-1">TIỀN VÀO</div>
                <Row label="Buy-in" sub="pass-through" amount={fmt(report.buyInTotal)} />
                <Row label={report.clubRevenue < 0 ? "Chênh thu − buy-in" : "Doanh thu club"}
                  sub={report.clubRevenue < 0 ? "dữ liệu thu chưa đủ" : "rake + phí DV"}
                  amount={fmt(report.clubRevenue)} accent />
                <Row label="Tiền mặt vào" amount={fmt(report.cashInTotal)} />
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-[11px] font-medium text-muted-foreground mb-1">TIỀN RA</div>
                <Row label={alreadyClosed ? "Prize ghi nhận lúc chốt" : "Prize trả hạng"} sub="pass-through" amount={fmt(report.prizeTotal)} />
                <Row label={alreadyClosed ? "Số dư quầy lúc chốt" : "Số dư quầy"} sub="vào − ra" amount={fmt(report.cashierBalance)} />
              </div>
            </div>

            {report.reconciled ? (
              <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2">
                <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" />
                <div className="text-sm">
                  <div className="font-medium">{alreadyClosed ? "Lúc chốt: số dư quầy khớp — chênh 0₫" : "Số dư quầy khớp — chênh 0₫"}</div>
                  <div className="text-xs text-muted-foreground">Doanh thu club {fmt(report.clubRevenue)} = tiền vào − tiền ra</div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
                <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <div className="font-medium text-warning">{alreadyClosed ? "Lúc chốt: số dư chưa cân" : "Số dư chưa cân"} — chênh {fmt(Math.abs(report.reconcileDelta))}</div>
                  <div className="text-xs text-muted-foreground">
                    {alreadyClosed ? "Chênh lệch đã được lưu tại thời điểm chốt. Đối chiếu các khoản trả thưởng phát sinh sau đó trong Payout; snapshot này không tự cập nhật."
                    : report.overlay > 0
                      ? `Club bù overlay ${fmt(report.overlay)} (prize > buy-in).`
                      : report.surplusToPool > 0
                        ? `Buy-in dư ${fmt(report.surplusToPool)} so với prize đã trả (payout chưa nhập đủ?).`
                        : "Kiểm tra lại prize/cashout."}
                    {!alreadyClosed && <> {readiness?.ready ? "Vẫn chốt được — sẽ ghi nhận minh bạch."
                      : "Chênh lệch sẽ được ghi nhận sau khi các điều kiện chốt được đáp ứng."}</>}
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>Chốt giải KHÔNG tự Đóng tour dealer hay release staking — làm riêng để tránh lỗi. Chỉ Owner / Cashier chốt được.</span>
            </div>

            {step === 2 && !alreadyClosed && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Để xác nhận, gõ <span className="font-semibold text-foreground">CHOT GIAI</span> bên dưới:
                </p>
                <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="CHOT GIAI" autoFocus className="min-h-[40px]" />
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {alreadyClosed ? (
            <Button variant="outline" onClick={() => onOpenChange(false)} className="min-h-[40px]">Đóng</Button>
          ) : step === 1 ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy} className="min-h-[40px]">Huỷ</Button>
              <Button variant="outline" onClick={() => setStep(2)}
                disabled={!report || loading || busy || rankingBlocked || !readiness?.ready} className="min-h-[40px]">Tiếp tục</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStep(1)} disabled={busy} className="min-h-[40px]">Quay lại</Button>
              <Button onClick={handleConfirm} disabled={!canConfirm} className="min-h-[40px]">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Chốt giải"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
