import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { formatVND, formatDateTime } from "@/lib/format";
import { Loader2, RefreshCw, CheckCircle2, XCircle, Banknote } from "lucide-react";
import {useSePaySettlementIntent} from './useSePaySettlementIntent';

// Shape returned by public.sepay_cashier_settlement_worklist (20261116000000) — RAW FACTS only.
type Row = {
  bank_transaction_id: string;
  club_id: string | null;
  club_name: string | null;
  amount: number | null;
  content: string | null;
  txn_ref: string | null;
  occurred_at: string | null;
  created_at: string;
  bt_status: string;
  reference_code: string | null;
  reg_match_count: number;
  registration_id: string | null;
  reg_status: string | null;
  reg_total_pay: number | null;
  player_display: string | null;
  tournament_name: string | null;
  amount_delta: number | null;
  settlement_outcome: string | null;
  settlement_reason: string | null;
  settlement_created_at: string | null;
};

/**
 * Cashier "Đối soát SePay" tab — surfaces the SePay reconciliation worklist (transfers the reconcile
 * worker verified + flagged) and submits confirm/ignore through actor-bound intent receipts.
 * The RPC returns raw facts; the cashier eyeballs the comparison and the
 * RPC re-validates authoritatively on click. clubIds is accepted for parity (the RPC self-scopes).
 */
export const SePaySettlementTab = ({ clubIds }: { clubIds?: string[] } = {}) => {
  const { user, session } = useAuth();
  if (!user) return <Card className="p-4" role="alert">Đăng nhập để đọc danh sách đối soát SePay.</Card>;
  return <SettlementSession actorId={user.id} key={JSON.stringify([user.id, sessionReadEpoch(session), [...(clubIds ?? [])].sort()])}/>;
};

function validSettlementRow(value: unknown): value is Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  const optionalText=(field:string)=>r[field]===undefined||r[field]===null||typeof r[field]==='string';
  const optionalDate=(field:string)=>r[field]===undefined||r[field]===null
    ||typeof r[field]==='string'&&Number.isFinite(Date.parse(r[field]));
  return typeof r.bank_transaction_id === 'string' && !!r.bank_transaction_id.trim()
    && ['club_name','content','txn_ref','reference_code','reg_status','player_display','tournament_name','settlement_outcome','settlement_reason'].every(optionalText)
    && ['occurred_at','settlement_created_at'].every(optionalDate)
    && (r.club_id === null || typeof r.club_id === 'string')
    && typeof r.created_at === 'string' && Number.isFinite(Date.parse(r.created_at))
    && typeof r.bt_status === 'string' && Number.isSafeInteger(r.reg_match_count) && Number(r.reg_match_count) >= 0
    && (r.registration_id === null || typeof r.registration_id === 'string')
    && [r.amount, r.reg_total_pay, r.amount_delta].every(value => value === null || typeof value === 'number' && Number.isSafeInteger(value));
}

function SettlementSession({actorId}:{actorId:string}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scope, setScope] = useState<"actionable" | "resolved">("actionable");
  const [confirmTarget, setConfirmTarget] = useState<Row | null>(null);
  const [confirmReason, setConfirmReason] = useState("");
  const [ignoreTarget, setIgnoreTarget] = useState<Row | null>(null);
  const [ignoreReason, setIgnoreReason] = useState("");
  // Stale-response guard (mount + clubs-loaded fire back to back; only the latest may write state).
  const loadSeq = useRef(0), readFlight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    readFlight.current?.abort();
    const controller = new AbortController(); readFlight.current = controller;
    setRows(null);
    setLoadError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- existing RPC is not in generated types.ts
      const { data, error } = await observeTrackerContextRead((supabase.rpc as any)("sepay_cashier_settlement_worklist", {
        p_scope: scope, p_limit: 200,
      }).abortSignal(controller.signal)) as { data: unknown; error: { code?: string } | null };
      if (seq !== loadSeq.current) return;
      if (error?.code === '42501') { setLoadError('Không có quyền đọc danh sách đối soát SePay.'); return; }
      if (error || !Array.isArray(data) || !data.every(validSettlementRow)
        || new Set(data.map(row => row.bank_transaction_id)).size !== data.length) throw new Error('unverified_worklist');
      setRows(data);
    } catch {
      if (seq === loadSeq.current) setLoadError('Không tải được danh sách đối soát SePay. Hãy thử lại.');
    } finally {
      controller.abort();
      if (seq === loadSeq.current) readFlight.current = null;
    }
  }, [scope]);

  const cancelRead = useCallback(() => { loadSeq.current++; readFlight.current?.abort(); }, []);
  const mutation=useSePaySettlementIntent(actorId,()=>{
    setConfirmTarget(null);setConfirmReason('');setIgnoreTarget(null);setIgnoreReason('');void load();
  });
  const busy=mutation.busy?mutation.pending?.bankId??null:null;
  const mutationBlocked=mutation.busy||mutation.pending!==null||mutation.journalError||rows===null||loadError!==null;
  // Re-run when the scope filter changes; actor/session/club changes remount above.
  useEffect(() => {
    setConfirmTarget(null); setConfirmReason(''); setIgnoreTarget(null); setIgnoreReason('');
    void load();
    return cancelRead;
  }, [load, cancelRead]);

  const doConfirm = async () => {
    const r = confirmTarget;
    if (!r || !r.registration_id || mutationBlocked) return;
    const flight=mutation.start({operation:'confirm',bankId:r.bank_transaction_id,registrationId:r.registration_id,
      clubId:r.club_id,reason:confirmReason.trim()||null,snapshot:{bank_amount:r.amount,total_pay:r.reg_total_pay}});
    setConfirmTarget(null);await flight;
  };

  const doIgnore = async () => {
    const r = ignoreTarget;
    if (!r || mutationBlocked) return;
    const flight=mutation.start({operation:'ignore',bankId:r.bank_transaction_id,registrationId:null,
      clubId:r.club_id,reason:ignoreReason.trim()||null,snapshot:{bank_amount:r.amount,total_pay:null}});
    setIgnoreTarget(null);await flight;
  };

  // Mirror the RPC's reason_required_on_mismatch: reason is required when CK amount ≠ reg total_pay.
  const confirmMismatch = !!confirmTarget && confirmTarget.amount != null && confirmTarget.reg_total_pay != null
    && confirmTarget.amount !== confirmTarget.reg_total_pay;
  const confirmDisabled = mutationBlocked
    || (confirmMismatch && confirmReason.trim().length === 0);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Banknote className="w-5 h-5 text-primary" /> Đối soát SePay
          </h2>
          <p className="text-xs text-muted-foreground">
            Các khoản chuyển khoản hệ thống đã xác minh với SePay. Đối chiếu với đăng ký rồi xác nhận hoặc bỏ qua. App KHÔNG giữ tiền.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={scope === "actionable" ? "default" : "outline"} size="sm" className="h-9" onClick={() => setScope("actionable")}>Cần xử lý</Button>
          <Button variant={scope === "resolved" ? "default" : "outline"} size="sm" className="h-9" onClick={() => setScope("resolved")}>Đã xử lý</Button>
          <Button variant="ghost" size="icon" aria-label="Tải lại đối soát SePay" className="h-9 w-9" onClick={load} disabled={rows === null && !loadError}>
            {rows === null && !loadError ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {(mutation.pending||mutation.journalError)&&<div role="alert" className="rounded-md border border-warning/40 p-3 text-sm space-y-2">
        <p>{mutation.journalError?'Không đọc/lưu được yêu cầu đang chờ. Không gửi khoản mới; cần kiểm tra journal trước.':mutation.notice||'Có yêu cầu chưa xác minh từ lần trước. Tra cứu receipt trước khi tiếp tục.'}</p>
        {mutation.pending&&<div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" disabled={mutation.busy} onClick={()=>void mutation.recover()}>Tra cứu yêu cầu đang chờ</Button>
          {mutation.missing&&<Button variant="outline" size="sm" disabled={mutation.busy} onClick={()=>void mutation.retry()}>Thử lại cùng yêu cầu</Button>}
        </div>}
      </div>}
      {loadError ? <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
        <p>{loadError}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>Thử lại</Button>
      </div> : rows === null ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : rows.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-10">
          {scope === "actionable" ? "Không có khoản nào cần xử lý." : "Chưa có khoản nào đã xử lý."}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const isMismatch = r.amount != null && r.reg_total_pay != null && r.amount !== r.reg_total_pay;
            return (
              <div key={r.bank_transaction_id} className="rounded-lg border border-border bg-card/40 p-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                <div className="space-y-1.5 text-sm min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-primary">
                      {r.amount != null ? formatVND(r.amount) : <span className="text-warning">Thiếu số tiền</span>}
                    </span>
                    {r.reference_code
                      ? <Badge variant="outline" className="font-mono">{r.reference_code}</Badge>
                      : <Badge variant="outline" className="text-muted-foreground">không có mã</Badge>}
                    {r.bt_status === "matched" && <Badge variant="outline" className="text-success border-success/40">đã khớp</Badge>}
                    {r.bt_status === "ignored" && <Badge variant="outline" className="text-muted-foreground">đã bỏ qua</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{r.content ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{r.club_name ?? "—"} · {formatDateTime(r.occurred_at ?? r.created_at)}</div>

                  {/* Matched registration + raw amounts side by side — cashier eyeballs the comparison */}
                  {r.reg_match_count === 1 && r.registration_id ? (
                    <div className="rounded-md bg-muted/40 p-2 text-xs space-y-0.5">
                      <div className="font-medium">{r.player_display ?? "Player"} · {r.tournament_name ?? "—"}</div>
                      <div className={isMismatch ? "text-warning" : "text-muted-foreground"}>
                        CK <b>{r.amount != null ? formatVND(r.amount) : "—"}</b> · Tổng phí đăng ký <b>{r.reg_total_pay != null ? formatVND(r.reg_total_pay) : "—"}</b>
                        {isMismatch && r.amount_delta != null && <span> · chênh so với tổng phí {formatVND(r.amount_delta)}</span>}
                      </div>
                      {scope === "actionable" && r.reg_status && r.reg_status !== "pending" && (
                        <div className="text-warning">Đăng ký không ở trạng thái chờ (đang: {r.reg_status})</div>
                      )}
                    </div>
                  ) : r.reg_match_count === 0 ? (
                    <div className="text-xs text-muted-foreground">Không tìm thấy đăng ký khớp mã.</div>
                  ) : (
                    <div className="text-xs text-warning">Nhiều đăng ký khớp mã ({r.reg_match_count}) — kiểm tra thủ công.</div>
                  )}

                  {r.settlement_outcome && (
                    <div className="text-[11px] text-muted-foreground">
                      Cờ gần nhất: {r.settlement_outcome}{r.settlement_reason ? ` (${r.settlement_reason})` : ""}
                    </div>
                  )}
                </div>

                {scope === "actionable" && (
                  <div className="flex md:flex-col gap-2 md:w-40">
                    <Button size="sm" className="flex-1 h-9"
                      disabled={mutationBlocked || r.reg_match_count !== 1 || r.amount == null}
                      onClick={() => { setConfirmTarget(r); setConfirmReason(""); }}>
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Xác nhận
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 h-9 text-destructive border-destructive/40"
                      disabled={mutationBlocked}
                      onClick={() => { setIgnoreTarget(r); setIgnoreReason(""); }}>
                      <XCircle className="w-3.5 h-3.5 mr-1" /> Bỏ qua
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Confirm dialog */}
      <Dialog open={confirmTarget !== null} onOpenChange={(o) => { if (!o) { setConfirmTarget(null); setConfirmReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xác nhận khoản chuyển khoản</DialogTitle>
            <DialogDescription>
              Ghi nhận khoản chuyển cho <b>{confirmTarget?.player_display ?? "Player"}</b> — giải <b>{confirmTarget?.tournament_name ?? "—"}</b>.
              <span className="block mt-1">Chỉ xếp ghế khi tổng tiền đã ghi nhận đủ và có bàn/ghế phù hợp.</span>
              <br />CK <b>{confirmTarget?.amount != null ? formatVND(confirmTarget.amount) : "—"}</b> · Tổng phí đăng ký <b>{confirmTarget?.reg_total_pay != null ? formatVND(confirmTarget.reg_total_pay) : "—"}</b>
              {confirmMismatch && <span className="text-warning"> — chênh với tổng phí, bắt buộc nhập lý do.</span>}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={confirmMismatch ? "Lý do chênh lệch (bắt buộc). Ghi chú không thay cho ghi nhận tiền tại Cashier." : "Ghi chú (không bắt buộc)"}
            value={confirmReason} onChange={(e) => setConfirmReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmTarget(null); setConfirmReason(""); }}>Huỷ</Button>
            <Button disabled={confirmDisabled} onClick={doConfirm}>
              {busy === confirmTarget?.bank_transaction_id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
              Xác nhận khoản chuyển
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ignore dialog */}
      <Dialog open={ignoreTarget !== null} onOpenChange={(o) => { if (!o) { setIgnoreTarget(null); setIgnoreReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bỏ qua giao dịch</DialogTitle>
            <DialogDescription>
              Đánh dấu khoản <b>{ignoreTarget?.amount != null ? formatVND(ignoreTarget.amount) : "—"}</b> là không cần đối soát (không phải đăng ký giải).
            </DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Lý do (không bắt buộc) — VD: nạp quỹ, không liên quan đăng ký"
            value={ignoreReason} onChange={(e) => setIgnoreReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIgnoreTarget(null); setIgnoreReason(""); }}>Huỷ</Button>
            <Button variant="destructive" disabled={mutationBlocked} onClick={doIgnore}>
              {busy === ignoreTarget?.bank_transaction_id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Xác nhận bỏ qua
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
