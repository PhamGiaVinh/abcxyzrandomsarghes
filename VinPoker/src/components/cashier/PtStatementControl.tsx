import { useEffect, useRef, useState } from 'react';
import { startLiveReportRefresh } from '@/lib/liveReportRefresh';
import { observeTrackerContextRead } from '@/lib/tournament/observeTrackerContextRead';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { sessionReadEpoch } from '@/lib/sessionReadEpoch';
import { formatVND } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ptStatementReceiptSchema as Receipt, loadPtStatementPayment, retainPtStatementPayment,
  clearPtStatementPayment, submitPtStatementPayment, type PtStatementReceipt as Statement,
  type PtStatementPaymentIntent } from '@/lib/ptStatementPayment';

type Props = { clubId: string; dealerId: string; dealerName: string; onFinalized: () => void; canFinalize?: boolean };
type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

export function PtStatementControl(props: Props) {
  const { user, session } = useAuth();
  if (!user) return null;
  return <ScopedControl key={JSON.stringify([user.id, sessionReadEpoch(session), props.clubId, props.dealerId])} {...props} actorId={user.id} />;
}

function ScopedControl({ clubId, dealerId, dealerName, actorId, onFinalized, canFinalize = true }: Props & { actorId: string }) {
  const storageKey = `vinpoker:pt-statement:v1:${actorId}:${clubId}:${dealerId}`;
  const alive = useRef(true);
  const inFlight = useRef(false);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [nextPeriod, setNextPeriod] = useState(false);
  const [paymentPending, setPaymentPending] = useState<PtStatementPaymentIntent | null>(null);
  const [payConfirm, setPayConfirm] = useState(false);
  const [method, setMethod] = useState<'cash' | 'bank'>('cash');
  const [reference, setReference] = useState('');

  async function read(requestId: string | null) {
    const result = await observeTrackerContextRead((supabase.rpc as unknown as Rpc)('get_part_time_payroll_statement_status_v1', {
      p_club_id: clubId, p_dealer_id: dealerId, p_request_id: requestId,
    }));
    if (result.error) throw result.error;
    if (result.data === null) return null;
    const row = Receipt.parse(result.data);
    if (row.club_id !== clubId || row.dealer_id !== dealerId || (requestId && row.request_id !== requestId)) throw new Error('PT_STATEMENT_SCOPE_INVALID');
    return row;
  }

  async function refresh() {
    setReady(false);
    try {
      const payment = loadPtStatementPayment(sessionStorage, actorId, clubId, dealerId);
      setPaymentPending(payment);
      const pending = sessionStorage.getItem(storageKey);
      if (pending) z.string().uuid().parse(pending);
      const row = await read(payment?.statement.request_id ?? pending);
      if (payment && (!row || row.statement_id !== payment.statement.statement_id
        || row.statement_hash !== payment.statement.statement_hash)) throw Error('PT_PAYMENT_STATEMENT_CHANGED');
      if (!alive.current) return;
      setStatement(row); setReady(true); setError(null);
    } catch {
      if (alive.current) setError('Chưa xác minh được phiếu PT. Hãy tải lại trước khi chốt.');
    }
  }

  useEffect(() => {
    alive.current = true;
    const stop = startLiveReportRefresh(async () => {
      if (!inFlight.current) await refresh();
    });
    return () => { alive.current = false; stop(); };
    // The parent keys this entire scope by actor, session, club and dealer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finalize() {
    if (inFlight.current || !ready || !canFinalize || paymentPending) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      let request = sessionStorage.getItem(storageKey);
      if (request) z.string().uuid().parse(request);
      if (nextPeriod) {
        const current = await read(null);
        if (!alive.current) return;
        if (!statement?.payment_id || !current?.payment_id || current.statement_id !== statement.statement_id
          || current.payment_id !== statement.payment_id || current.statement_hash !== statement.statement_hash) {
          throw new Error('PT_PREVIOUS_PAYMENT_NOT_VERIFIED');
        }
        request = crypto.randomUUID();
        sessionStorage.setItem(storageKey, request);
        if (sessionStorage.getItem(storageKey) !== request) throw new Error('PT_INTENT_NOT_PERSISTED');
        // Further retries must retain this new request, even if its write response is lost.
        setNextPeriod(false);
      }
      if (!request) {
        request = crypto.randomUUID(); sessionStorage.setItem(storageKey, request);
        if (sessionStorage.getItem(storageKey) !== request) throw new Error('PT_INTENT_NOT_PERSISTED');
      }
      let row = await read(request);
      let writeFailure: unknown = null;
      if (!alive.current) return;
      if (!row) {
        // A missing response is unresolved. Always read the same durable request afterwards.
        try {
          const result = await (supabase.rpc as unknown as Rpc)('finalize_part_time_payroll_statement', {
            p_request_id: request, p_club_id: clubId, p_dealer_id: dealerId,
            p_reason: 'Chốt phiếu PT theo giờ thực tế từ Dealer Swing', p_replaces_statement_id: null,
          });
          writeFailure = result.error;
        } catch (cause) { writeFailure = cause; /* Readback decides whether the server committed. */ }
        row = await read(request);
      }
      if (!alive.current) return;
      if (!row) throw writeFailure ?? new Error('PT_FINALIZATION_UNRESOLVED');
      setStatement(row); setConfirm(false); onFinalized();
    } catch (cause) {
      const code = typeof cause === 'object' && cause !== null && 'message' in cause ? cause.message : null;
      if (alive.current) setError(code === 'PT_LEGACY_MONTHLY_OVERLAP_REQUIRES_REVIEW'
        ? 'Khoảng công này đã nằm trong bảng lương tháng. Cần đối soát bảng lương cũ trước khi chốt PT để tránh trả trùng.'
        : code === 'PT_FINALIZED_STATEMENT_PENDING_PAYMENT'
          ? 'Dealer đã có phiếu PT chốt chưa chi. Cần kiểm tra phiếu hiện có trước khi chốt thêm.'
          : 'Chưa xác nhận chốt thành công. Mã yêu cầu được giữ lại; thử lại sẽ kiểm tra đúng yêu cầu này.');
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function pay() {
    if (inFlight.current || !ready || !statement) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const intent = retainPtStatementPayment(sessionStorage, paymentPending ?? {
        actorId, statement, method, reference: reference.trim() || null, key: crypto.randomUUID(),
      });
      setPaymentPending(intent);
      const paid = await submitPtStatementPayment((name, args) => (supabase.rpc as unknown as Rpc)(name, args), intent, () => alive.current);
      if (!alive.current) return;
      clearPtStatementPayment(sessionStorage, intent);
      setStatement(paid); setPaymentPending(null); setPayConfirm(false); onFinalized();
    } catch {
      if (alive.current) setError('Chưa xác minh được khoản chi. Giữ nguyên yêu cầu và đối chiếu trước khi chi thêm.');
    } finally {
      inFlight.current = false; if (alive.current) setBusy(false);
    }
  }

  const active = statement && !['voided', 'replaced'].includes(statement.state);
  return <div className="mt-3 space-y-2 border-t border-border pt-3">
    {active && <p role="status" className="text-xs">Phiếu đã chốt: {formatVND(statement.net_amount_vnd)} · {statement.payment_id ? 'Đã ghi nhận chi' : 'Chưa chi'}</p>}
    {active && statement.payment_id && canFinalize && !paymentPending && <Button size="sm" variant="outline" disabled={busy || !ready} onClick={() => { setNextPeriod(true); setConfirm(true); }}>Chốt kỳ PT tiếp theo</Button>}
    {active && !statement.payment_id && statement.net_amount_vnd > 0 && !paymentPending && <Button size="sm" disabled={busy || !ready} onClick={() => setPayConfirm(true)}>Chi phiếu PT</Button>}
    {paymentPending && <Button size="sm" variant="outline" disabled={busy || !ready} onClick={() => void pay()}>Kiểm tra khoản chi PT đã lưu</Button>}
    {error && !confirm && !payConfirm && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {!ready && <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>Tải lại phiếu PT</Button>}
    {statement && !active && <p role="status" className="text-xs">Phiếu đã hủy hoặc thay thế. Cần kiểm tra lịch sử trước khi tạo phiếu mới.</p>}
    {ready && !statement && canFinalize && !paymentPending && <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm(true)}>Chốt phiếu PT</Button>}
    {ready && !statement && !canFinalize && <p className="text-xs text-muted-foreground">Cần Owner chốt phiếu PT trước khi ghi nhận chi.</p>}
    <Dialog open={confirm} onOpenChange={open => { if (!busy) setConfirm(open); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Chốt phiếu PT cho {dealerName}</DialogTitle>
          <DialogDescription>Máy chủ chốt số tiền theo giờ thực tế và giữ khoảng thời gian đó cho phiếu. Thao tác này chưa chi tiền.</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>Hủy</Button>
          <Button disabled={busy} onClick={() => void finalize()}>{busy ? 'Đang xác minh…' : 'Xác nhận chốt phiếu'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={payConfirm} onOpenChange={open => { if (!busy) setPayConfirm(open); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Chi phiếu PT cho {dealerName}</DialogTitle>
          <DialogDescription>Ghi nhận chi đúng {formatVND(statement?.net_amount_vnd ?? 0)} theo phiếu đã chốt. Không tính lại công hoặc bảng lương tháng.</DialogDescription></DialogHeader>
        <label className="space-y-1 text-sm">Phương thức chi<select aria-label="Phương thức chi PT" value={method} disabled={busy || !!paymentPending}
          onChange={event => setMethod(event.target.value as 'cash' | 'bank')} className="min-h-10 w-full rounded border border-border bg-background px-2">
          <option value="cash">Tiền mặt</option><option value="bank">Chuyển khoản</option>
        </select></label>
        <label className="space-y-1 text-sm">Mã tham chiếu<input aria-label="Mã tham chiếu chi PT" value={reference} maxLength={200} disabled={busy || !!paymentPending}
          onChange={event => setReference(event.target.value)} className="min-h-10 w-full rounded border border-border bg-background px-2" /></label>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setPayConfirm(false)}>Hủy</Button>
          <Button disabled={busy || !ready} onClick={() => void pay()}>{busy ? 'Đang xác minh…' : paymentPending ? 'Kiểm tra khoản chi PT đã lưu' : 'Xác nhận chi phiếu PT'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
