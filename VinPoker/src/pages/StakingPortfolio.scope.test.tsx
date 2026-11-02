import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ user: { id: 'backer-a' },session:{access_token:'LOCAL_A'}, read: vi.fn(),write:vi.fn(),upload:vi.fn(),signed:vi.fn(),success:vi.fn(),error:vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: h.user, session:h.session,loading: false }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/BankInfoCard', () => ({ BankInfoCard: () => null }));
vi.mock('@/components/StakingTransferBankCard',()=>({StakingTransferBankCard:()=>null}));
vi.mock('@/lib/compressImage',()=>({compressImage:async(file:File)=>file}));
vi.mock('sonner',()=>({toast:{success:h.success,error:h.error}}));
vi.mock('@/components/TransferInstructions', () => ({ TransferInstructions: () => null }));
vi.mock('@/components/RatingDialog', () => ({ RatingDialog: () => null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: (table: string) => {
    let writing=false;
    const q = { update:()=>{writing=true;return q;},select: () => q, eq: () => q, in: () => q, order: () => q,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(writing?h.write():h.read(table)).then(resolve, reject) };
    return q;
  },
  channel: () => { const c = { on: () => c, subscribe: () => c }; return c; }, removeChannel: vi.fn(),
  storage:{from:()=>({upload:h.upload,createSignedUrl:h.signed})},
} }));
import Portfolio from './StakingPortfolio';
const purchase = { id: 'purchase-a', deal_id: 'deal-a', backer_id: 'backer-a', status: 'committed',
  amount_vnd: 100000, percent: 10, markup: 1, committed_at: '2026-10-18T00:00:00Z' };
const deal = { id: 'deal-a', player_id: 'player-a', tournament_id: null, custom_event_name: 'PRIVATE BACKING', status: 'committed' };
beforeEach(() => {
  vi.clearAllMocks();h.session={access_token:'LOCAL_A'};h.write.mockResolvedValue({data:[],error:null});h.upload.mockResolvedValue({error:null});
  h.signed.mockResolvedValue({data:{signedUrl:'https://example.invalid/proof'},error:null});
  h.user = { id: 'backer-a' };
  h.read.mockReset().mockImplementation((table: string) => ({ data: table === 'staking_purchases' ? [purchase] : table === 'staking_deals' ? [deal] : [], error: null }));
});
it('does not claim upload success when no committed purchase was attached',async()=>{
 const view=render(<MemoryRouter><Portfolio/></MemoryRouter>);await screen.findByText('PRIVATE BACKING');
 const input=view.container.querySelector('input[type=file]')!;
 fireEvent.change(input,{target:{files:[new File(['LOCAL TEST'],'proof.png',{type:'image/png'})]}});
 await waitFor(()=>expect(h.write).toHaveBeenCalled());expect(h.success).not.toHaveBeenCalled();expect(h.error).toHaveBeenCalled();
});
it('does not update a purchase when the proof URL cannot be signed',async()=>{
 h.signed.mockResolvedValue({data:null,error:{message:'LOCAL signing unavailable'}});
 const view=render(<MemoryRouter><Portfolio/></MemoryRouter>);await screen.findByText('PRIVATE BACKING');
 fireEvent.change(view.container.querySelector('input[type=file]')!,{target:{files:[new File(['LOCAL TEST'],'proof.png',{type:'image/png'})]}});
 await waitFor(()=>expect(h.signed).toHaveBeenCalled());expect(h.write).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
});
it('accepts a matching attached and submitted proof acknowledgement',async()=>{
 h.write.mockResolvedValue({data:[{id:purchase.id,status:'committed',transfer_proof_url:'https://example.invalid/proof',transfer_proof_submitted:true}],error:null});
 const view=render(<MemoryRouter><Portfolio/></MemoryRouter>);await screen.findByText('PRIVATE BACKING');
 fireEvent.change(view.container.querySelector('input[type=file]')!,{target:{files:[new File(['LOCAL TEST'],'proof.png',{type:'image/png'})]}});
 await waitFor(()=>expect(h.success).toHaveBeenCalledWith('Đã upload biên lai'));
});
it('does not attach an upload completed after same-user session replacement',async()=>{
 let resolve!:(v:unknown)=>void;h.upload.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const view=render(<MemoryRouter><Portfolio/></MemoryRouter>);await screen.findByText('PRIVATE BACKING');
 fireEvent.change(view.container.querySelector('input[type=file]')!,{target:{files:[new File(['LOCAL TEST'],'proof.png',{type:'image/png'})]}});
 await waitFor(()=>expect(resolve).toBeTypeOf('function'));
 h.session={access_token:'LOCAL_B'};view.rerender(<MemoryRouter><Portfolio/></MemoryRouter>);
 await screen.findByText('PRIVATE BACKING');await act(async()=>resolve({error:null}));
 expect(h.signed).not.toHaveBeenCalled();expect(h.write).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
});
const settledRead = (ledgerAmount: unknown = 80100, recipientAmount: unknown = 80100) => (table: string) => ({ data:
  table === 'staking_purchases' ? [{ ...purchase, status: 'funded' }]
    : table === 'staking_deals' ? [{ ...deal, status: 'completed', result_prize_vnd: 1000000 }]
    : table === 'staking_ledger' ? [{ deal_id: 'deal-a', amount_vnd: ledgerAmount, metadata: { purchase_id: 'purchase-a' } }]
    : table === 'payout_recipients' ? [{ id: 'recipient-a', purchase_id: 'purchase-a', amount_vnd: recipientAmount, platform_fee_vnd: 0, status: 'paid' }]
    : [], error: null });
it('completed return and PnL use committed purchase amounts rather than gross prize percentage', async () => {
  h.read.mockImplementation(settledRead());render(<MemoryRouter><Portfolio /></MemoryRouter>);
  const label = await screen.findByText('Đã nhận lại');
  expect(label.parentElement).toHaveTextContent('80.100');
  expect(screen.getByText('Kết quả hợp tác').parentElement).toHaveTextContent('19.900');
  expect(label.parentElement).not.toHaveTextContent('100.000');
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Hoàn tất 1' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Hoàn tất 1' }));
  expect(within(screen.getByRole('tabpanel', { name: 'Hoàn tất 1' })).queryByText('Đã khóa', { exact: true })).toBeNull();
});
it('accepts a verified zero return instead of inventing a gross prize share', async () => {
  h.read.mockImplementation(settledRead(0, 0));render(<MemoryRouter><Portfolio /></MemoryRouter>);
  const label = await screen.findByText('Đã nhận lại');expect(label.parentElement).toHaveTextContent('0');
  expect(label.parentElement).not.toHaveTextContent('100.000');expect(screen.queryByRole('alert')).toBeNull();
});
it.each(['missing', 'mismatch', 'duplicate', 'negative', 'unsafe'])('does not manufacture completed return when settlement evidence is %s', async scenario => {
  const read = settledRead(scenario === 'negative' ? -1 : scenario === 'unsafe' ? Number.MAX_SAFE_INTEGER + 1 : 80100,
    scenario === 'mismatch' ? 80101 : 80100);
  h.read.mockImplementation((table: string) => {
    const result = read(table);
    if (table === 'staking_ledger' && scenario === 'missing') return { data: [], error: null };
    if (table === 'staking_ledger' && scenario === 'duplicate') return { data: [...result.data, ...result.data], error: null };
    return result;
  });
  render(<MemoryRouter><Portfolio /></MemoryRouter>);
  await screen.findByRole('alert');expect(screen.queryByText('Đã nhận lại')).toBeNull();
});
it('does not publish a late old-account purchase into the new account', async () => {
  let resolveOld!: (value: unknown) => void;
  h.read.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
  const view = () => <MemoryRouter><Portfolio /></MemoryRouter>;
  const mounted = render(view());
  await waitFor(() => expect(h.read).toHaveBeenCalledWith('staking_purchases'));
  h.user = { id: 'backer-b' };
  h.read.mockImplementation((table: string) => ({ data: table === 'staking_deals' ? [deal] : [], error: null }));
  mounted.rerender(view());
  await screen.findByText('Bạn không có giữ chỗ nào đang chờ chuyển khoản.');
  await act(async () => resolveOld({ data: [purchase], error: null }));
  expect(screen.queryByText('PRIVATE BACKING')).toBeNull();
});
it('does not display unverified zero totals while the financial read is pending', () => {
  h.read.mockImplementation(() => new Promise(() => {}));
  render(<MemoryRouter><Portfolio /></MemoryRouter>);
  expect(screen.queryByText('Tổng hỗ trợ')).toBeNull();
  expect(screen.getByLabelText('Đang tải danh mục backing')).toBeTruthy();
});
it.each(['staking_purchases', 'payout_recipients', 'deal_ratings', 'reject'])('blocks partial financial UI and allows retry after %s error', async tableToFail => {
  const success = h.read.getMockImplementation()!;
  h.read.mockImplementation((table: string) => tableToFail === 'reject' ? Promise.reject(new Error('LOCAL NETWORK')) : table === tableToFail ? { data: null, error: { message: '503 LOCAL' } } : success(table));
  render(<MemoryRouter><Portfolio /></MemoryRouter>);
  await screen.findByRole('alert');
  expect(screen.queryByText('PRIVATE BACKING')).toBeNull();
  expect(screen.queryByText('Tổng hỗ trợ')).toBeNull();
  h.read.mockReturnValue({ data: [], error: null });
  fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại danh mục' }));
  await screen.findByText('Bạn không có giữ chỗ nào đang chờ chuyển khoản.');
});
