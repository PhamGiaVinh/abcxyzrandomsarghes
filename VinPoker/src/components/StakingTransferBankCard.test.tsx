import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), user: { id: 'backer' } as { id: string } | null,
  session: { access_token: 'LOCAL_ONLY_A' } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: h.user, session: h.session }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { StakingTransferBankCard } from './StakingTransferBankCard';
const props = { purchaseId: 'e5200000-0000-4000-8000-000000000001', dealId: 'e5200000-0000-4000-8000-000000000002',
  amount: 100000, reference: 'LOCAL_ONLY' };
const valid = { state: 'verified', purchase_id: props.purchaseId, deal_id: props.dealId, amount_vnd: props.amount,
  reference_code: props.reference, committed_at: '2026-10-23T00:00:00Z', bank: { bank_name: 'FROZEN_BANK',
    account_number: 'LOCAL_ONLY', account_holder: 'TEST', qr_code_url: null, notes: null } };
beforeEach(() => {
  vi.clearAllMocks(); h.user = { id: 'backer' }; h.session = { access_token: 'LOCAL_ONLY_A' };
  h.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: valid, error: null }) });
});
it('reads only the purchase-owned snapshot and never global bank accounts', async () => {
  render(<StakingTransferBankCard {...props} />);
  expect(await screen.findByText('FROZEN_BANK')).toBeInTheDocument();
  expect(h.rpc).toHaveBeenCalledWith('get_staking_purchase_transfer_v1', { p_purchase: props.purchaseId });
  expect(h.from).not.toHaveBeenCalled();
});
it('fails closed for a mismatched amount', async () => {
  h.rpc.mockReturnValue({ abortSignal: async () => ({ data: { ...valid, amount_vnd: 1 }, error: null }) });
  render(<StakingTransferBankCard {...props} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Thiếu chứng cứ');
  expect(screen.queryByText('FROZEN_BANK')).not.toBeInTheDocument(); expect(h.from).not.toHaveBeenCalled();
});
it('requires purchase identity before reading', async () => {
  render(<StakingTransferBankCard {...props} purchaseId={undefined} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Thiếu chứng cứ'); expect(h.rpc).not.toHaveBeenCalled();
});
it('shows read failure and retries only on explicit action', async () => {
  h.rpc.mockReturnValueOnce({ abortSignal: async () => ({ data: null, error: { code: '503' } }) });
  render(<StakingTransferBankCard {...props} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Không xác minh được'); expect(h.rpc).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText('FROZEN_BANK')).toBeInTheDocument(); expect(h.rpc).toHaveBeenCalledTimes(2);
});
it('discards a late response when the authenticated session is replaced', async () => {
  let resolve!: (value: unknown) => void;
  h.rpc.mockReturnValueOnce({ abortSignal: () => new Promise(r => { resolve = r; }) });
  const view = render(<StakingTransferBankCard {...props} />);
  h.session = { access_token: 'LOCAL_ONLY_B' };
  h.rpc.mockReturnValue({ abortSignal: async () => ({ data: { ...valid, state: 'closed' }, error: null }) });
  view.rerender(<StakingTransferBankCard {...props} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('không còn chờ');
  await act(async () => { resolve({ data: valid, error: null }); });
  expect(screen.queryByText('FROZEN_BANK')).not.toBeInTheDocument();
});
it('ends a hung read and ignores its eventual response', async () => {
  vi.useFakeTimers();
  try {
    let resolve!: (value: unknown) => void;
    h.rpc.mockReturnValue({ abortSignal: () => new Promise(r => { resolve = r; }) });
    render(<StakingTransferBankCard {...props} />);
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(screen.getByRole('alert')).toHaveTextContent('Không xác minh được');
    await act(async () => { resolve({ data: valid, error: null }); });
    expect(screen.queryByText('FROZEN_BANK')).not.toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});
