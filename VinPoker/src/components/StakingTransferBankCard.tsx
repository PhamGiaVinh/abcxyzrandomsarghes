import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { sessionReadEpoch } from '@/lib/sessionReadEpoch';
import { supabase } from '@/integrations/supabase/client';
import { BankInfoCard } from './BankInfoCard';
import { Button } from './ui/button';

const receipt = z.object({
  state: z.literal('verified'), purchase_id: z.string().uuid(), deal_id: z.string().uuid(),
  amount_vnd: z.number().int().nonnegative().safe(), reference_code: z.string().min(1),
  committed_at: z.string().datetime({ offset: true }),
  bank: z.object({ bank_name: z.string().min(1), account_number: z.string().min(1),
    account_holder: z.string().min(1), qr_code_url: z.string().nullable(), notes: z.string().nullable() }),
});
const terminal = z.object({ state: z.enum(['closed', 'needs_attention']),
  purchase_id: z.string().uuid(), deal_id: z.string().uuid() });
type TransferRead = (name: 'get_staking_purchase_transfer_v1', args: { p_purchase: string }) => {
  abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
};
interface Props { purchaseId?: string; dealId: string; amount: number; reference: string }
type State = { kind: 'loading' | 'error' | 'needs_attention' | 'closed' }
  | { kind: 'verified'; data: z.infer<typeof receipt> };

export function StakingTransferBankCard(props: Props) {
  const { user, session } = useAuth();
  return <ScopedBankCard key={`${user?.id ?? 'out'}:${sessionReadEpoch(session)}:${props.purchaseId ?? 'missing'}:${props.dealId}:${props.amount}:${props.reference}`}
    {...props} signedIn={!!user} />;
}

function ScopedBankCard({ purchaseId, dealId, amount, reference, signedIn }: Props & { signedIn: boolean }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!signedIn || !purchaseId) { setState({ kind: 'needs_attention' }); return; }
    let active = true;
    const controller = new AbortController();
    setState({ kind: 'loading' });
    const timer = setTimeout(() => {
      if (active) { active = false; setState({ kind: 'error' }); controller.abort(); }
    }, 10_000);
    void (async () => {
      try {
        const { data, error } = await (supabase.rpc as unknown as TransferRead)('get_staking_purchase_transfer_v1', { p_purchase: purchaseId })
          .abortSignal(controller.signal);
        if (!active) return;
        if (error) throw error;
        const parsed = receipt.safeParse(data);
        const ended = terminal.safeParse(data);
        if (parsed.success && parsed.data.purchase_id === purchaseId && parsed.data.deal_id === dealId
          && parsed.data.amount_vnd === amount && parsed.data.reference_code === reference) {
          setState({ kind: 'verified', data: parsed.data });
        } else if (ended.success && ended.data.purchase_id === purchaseId && ended.data.deal_id === dealId) {
          setState({ kind: ended.data.state });
        } else { setState({ kind: 'needs_attention' }); }
      } catch {
        if (active) setState({ kind: 'error' });
      } finally { clearTimeout(timer); }
    })();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [purchaseId, dealId, amount, reference, signedIn, attempt]);

  if (state.kind === 'verified') return <BankInfoCard account={{
    bank_name: state.data.bank.bank_name, account_number: state.data.bank.account_number,
    account_holder: state.data.bank.account_holder, qr_code_url: state.data.bank.qr_code_url, notes: state.data.bank.notes,
  }} />;
  if (state.kind === 'loading') return <div role="status" className="p-4 text-sm text-muted-foreground">Đang xác minh tài khoản nhận tiền…</div>;
  return <div role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm space-y-2">
    <p>{state.kind === 'closed' ? 'Giao dịch không còn chờ chuyển khoản. Hãy tải lại danh mục.'
      : state.kind === 'error' ? 'Không xác minh được tài khoản nhận tiền. Không chuyển khoản theo tài khoản khác.'
      : 'Thiếu chứng cứ tài khoản nhận tiền của giao dịch này. Liên hệ Cashier trước khi chuyển khoản.'}</p>
    {state.kind === 'error' && <Button variant="outline" size="sm" onClick={() => setAttempt(n => n + 1)}>Thử lại</Button>}
  </div>;
}
