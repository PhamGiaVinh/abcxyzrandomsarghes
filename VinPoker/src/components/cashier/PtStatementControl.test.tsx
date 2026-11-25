import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PtStatementControl } from './PtStatementControl';
import {retainPtStatementPayment,loadPtStatementPayment} from '@/lib/ptStatementPayment';

const state = vi.hoisted(() => ({ actor: '11111111-1111-4111-8111-111111111111', rpc: vi.fn(),flags:{financePtStatementDetails:false} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: state.actor }, session: null }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: state.rpc } }));
vi.mock('@/lib/featureFlags',()=>({FEATURES:state.flags}));
const club = '22222222-2222-4222-8222-222222222222', dealer = '33333333-3333-4333-8333-333333333333';
const props = () => ({ clubId: club, dealerId: dealer, dealerName: 'Dealer TEST', onFinalized: vi.fn() });
const receipt = (request: string) => ({ statement_id: '44444444-4444-4444-8444-444444444444', request_id: request,
  club_id: club, dealer_id: dealer, state: 'finalized' as const, net_amount_vnd: 102478,
  finalized_at: '2026-10-30T10:00:00+07:00', payment_id: null, statement_hash: 'a'.repeat(64) });
const key = () => `vinpoker:pt-statement:v1:${state.actor}:${club}:${dealer}`;
beforeEach(() => { sessionStorage.clear(); state.actor = '11111111-1111-4111-8111-111111111111'; state.rpc.mockReset();state.flags.financePtStatementDetails=false; });

describe('retained full-payment request after installment adoption',()=>{
  it('unblocks the next period only after archiving authoritative nonpayment proof',async()=>{
    const original=receipt('55555555-5555-4555-8555-555555555555');
    const old=retainPtStatementPayment(sessionStorage,{actorId:state.actor,statement:original,method:'cash',reference:null,
      key:'66666666-6666-4666-8666-666666666666'});
    const current={...original,installments_adopted:true,paid_total_vnd:102478,remaining_vnd:0,
      payment_id:'77777777-7777-4777-8777-777777777777'};
    state.rpc.mockImplementation(async name=>({data:name==='resolve_pt_full_payment_intent_v1'?{
      resolution:'superseded_by_installments',actor_id:state.actor,statement_id:original.statement_id,
      statement_hash:original.statement_hash,club_id:club,dealer_id:dealer,intent_key:old.key,
      approved_amount_vnd:102478,legacy_payment_recorded:false,
      approval_request_id:'88888888-8888-4888-8888-888888888888'}:current,error:null}));
    const p=props();render(<PtStatementControl {...p}/>);
    const button=await screen.findByRole('button',{name:'Lưu đối chiếu yêu cầu chi cũ'});
    expect(screen.queryByRole('button',{name:'Chốt kỳ PT tiếp theo'})).not.toBeInTheDocument();
    fireEvent.click(button);
    await screen.findByRole('button',{name:'Chốt kỳ PT tiếp theo'});
    expect(loadPtStatementPayment(sessionStorage,state.actor,club,dealer)).toBeNull();
    expect(screen.getByText(/Yêu cầu cũ đã lưu để đối chiếu/)).toBeInTheDocument();
    expect(p.onFinalized).not.toHaveBeenCalled();
    expect(state.rpc.mock.calls.some(([name])=>name.startsWith('pay_') || name.startsWith('finalize_'))).toBe(false);
  });
  it('keeps the old request and next-period lock if the server refuses resolution',async()=>{
    const original=receipt('55555555-5555-4555-8555-555555555555');
    const old=retainPtStatementPayment(sessionStorage,{actorId:state.actor,statement:original,method:'cash',reference:null,
      key:'66666666-6666-4666-8666-666666666666'});
    state.rpc.mockImplementation(async name=>name==='resolve_pt_full_payment_intent_v1'
      ?{data:null,error:{code:'42501'}}:{data:{...original,installments_adopted:true,paid_total_vnd:50000,remaining_vnd:52478},error:null});
    render(<PtStatementControl {...props()}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Lưu đối chiếu yêu cầu chi cũ'}));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Chưa đủ bằng chứng/);
    expect(loadPtStatementPayment(sessionStorage,state.actor,club,dealer)).toEqual(old);
    expect(screen.queryByRole('button',{name:'Chốt kỳ PT tiếp theo'})).not.toBeInTheDocument();
    expect(state.rpc.mock.calls.some(([name])=>name.startsWith('pay_') || name.startsWith('finalize_'))).toBe(false);
  });
});

describe('cashier pays the finalized PT statement', () => {
  it('keeps the new payslip history dark until its independent rollout is enabled',async()=>{
    state.rpc.mockResolvedValue({data:receipt('55555555-5555-4555-8555-555555555555'),error:null});
    const p=props(),v=render(<PtStatementControl {...p}/>);
    await screen.findByRole('status');
    expect(screen.queryByRole('button',{name:'Xem phiếu & lịch sử chi'})).not.toBeInTheDocument();
    expect(state.rpc.mock.calls.some(([name])=>name==='get_pt_statement_installments_v1')).toBe(false);
    state.flags.financePtStatementDetails=true;v.rerender(<PtStatementControl {...p}/>);
    expect(await screen.findByRole('button',{name:'Xem phiếu & lịch sử chi'})).toBeInTheDocument();
    expect(state.rpc.mock.calls.some(([name])=>name==='get_pt_statement_installments_v1')).toBe(false);
  });
  it('shows server-confirmed partial cash and remaining debt without exposing full payment', async () => {
    state.rpc.mockResolvedValue({data:{...receipt('55555555-5555-4555-8555-555555555555'),net_amount_vnd:5000000,
      installments_adopted:true,paid_total_vnd:2000000,remaining_vnd:3000000},error:null});
    render(<PtStatementControl {...props()} canFinalize={false}/>);
    const status=await screen.findByRole('status');
    expect(status).toHaveTextContent(/Đã chi: 2\.000\.000/);
    expect(status).toHaveTextContent(/Còn phải trả: 3\.000\.000/);
    expect(screen.queryByRole('button',{name:'Phát lương và tất toán'})).not.toBeInTheDocument();
    expect(state.rpc.mock.calls.some(([name])=>name.startsWith('pay_'))).toBe(false);
  });
  it('lets the cashier pay a frozen statement and reconciles a lost response without calling the legacy balance API', async () => {
    const frozen = receipt('55555555-5555-4555-8555-555555555555');
    let paid: string | null = null;
    state.rpc.mockImplementation(async (name) => {
      if (name === 'pay_finalized_part_time_payroll_statement') { paid = '77777777-7777-4777-8777-777777777777'; throw Error('lost'); }
      return { data: { ...frozen, payment_id: paid }, error: null };
    });
    render(<PtStatementControl {...props()} canFinalize={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Phát lương và tất toán' }));
    const confirmPay = screen.getByRole('button', { name: 'Xác nhận phát lương' });
    fireEvent.click(confirmPay); fireEvent.click(confirmPay);
    expect(await screen.findByText(/Phiếu đã chốt:/)).toHaveTextContent('Đã ghi nhận chi');
    expect(state.rpc.mock.calls.filter(([name]) => name === 'pay_finalized_part_time_payroll_statement')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(/Còn phải trả: 0/);
    expect(screen.getByRole('status')).toHaveTextContent('77777777-7777-4777-8777-777777777777');
    expect(state.rpc.mock.calls.some(([name]) => name === 'pay_part_time_balance')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Chốt kỳ PT tiếp theo' })).not.toBeInTheDocument();
  });

  it('keeps an uncertain payment across remount and checks the paid statement without another write', async () => {
    const frozen = receipt('55555555-5555-4555-8555-555555555555');
    const id = '77777777-7777-4777-8777-777777777777'; let paid = false, unavailable = false;
    state.rpc.mockImplementation(async name => {
      if (name === 'pay_finalized_part_time_payroll_statement') { paid = true; unavailable = true; throw Error('lost'); }
      if (unavailable) throw Error('offline');
      return { data: { ...frozen, payment_id: paid ? id : null }, error: null };
    });
    const view = render(<PtStatementControl {...props()} canFinalize={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Phát lương và tất toán' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận phát lương' }));
    await screen.findByText(/Chưa xác minh được khoản chi/);
    view.unmount(); unavailable = false;
    render(<PtStatementControl {...props()} canFinalize={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Kiểm tra khoản chi PT đã lưu' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Kiểm tra khoản chi PT đã lưu' })).not.toBeInTheDocument());
    expect(state.rpc.mock.calls.filter(([name]) => name === 'pay_finalized_part_time_payroll_statement')).toHaveLength(1);
  });
});

describe('PT statement finalization recovery', () => {
  it('requires confirmation and reconciles a committed write after transport failure', async () => {
    let committed: ReturnType<typeof receipt> | null = null;
    state.rpc.mockImplementation(async (name, args) => {
      if (name === 'finalize_part_time_payroll_statement') { committed = receipt(args.p_request_id); throw Error('lost response'); }
      return { data: committed, error: null };
    });
    const p = props(); render(<PtStatementControl {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Chốt phiếu PT' }));
    expect(state.rpc.mock.calls.filter(([n]) => n.startsWith('finalize_'))).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận chốt phiếu' }));
    expect(await screen.findByText(/Phiếu đã chốt:/)).toHaveTextContent('Chưa chi');
    expect(p.onFinalized).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(key())).toBe(committed!.request_id);
  });

  it('recovers a retained request on reload without issuing another write', async () => {
    const request = '55555555-5555-4555-8555-555555555555'; sessionStorage.setItem(key(), request);
    state.rpc.mockResolvedValue({ data: receipt(request), error: null });
    render(<PtStatementControl {...props()} />);
    await screen.findByText(/Phiếu đã chốt:/);
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc.mock.calls[0][1].p_request_id).toBe(request);
  });

  it('does not expose finalize when the reader is unavailable or returns a foreign receipt', async () => {
    state.rpc.mockResolvedValue({ data: { ...receipt('55555555-5555-4555-8555-555555555555'), club_id: dealer }, error: null });
    render(<PtStatementControl {...props()} />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Chốt phiếu PT' })).not.toBeInTheDocument();
  });

  it('retains the same request for an unresolved retry and prevents concurrent clicks', async () => {
    state.rpc.mockResolvedValue({ data: null, error: null });
    render(<PtStatementControl {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Chốt phiếu PT' }));
    const button = screen.getByRole('button', { name: 'Xác nhận chốt phiếu' });
    fireEvent.click(button); fireEvent.click(button);
    await screen.findByRole('alert');
    const request = sessionStorage.getItem(key());
    expect(state.rpc.mock.calls.filter(([n]) => n.startsWith('finalize_'))).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận chốt phiếu' }));
    await waitFor(() => expect(state.rpc.mock.calls.filter(([n]) => n.startsWith('finalize_'))).toHaveLength(2));
    expect(state.rpc.mock.calls.filter(([n]) => n.startsWith('finalize_')).every(([, a]) => a.p_request_id === request)).toBe(true);
  });

  it('ignores an old actor response after the session scope changes', async () => {
    let resolve!: (value: unknown) => void;
    state.rpc.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue({ data: null, error: null });
    const p = props(); const view = render(<PtStatementControl {...p} />);
    state.actor = '66666666-6666-4666-8666-666666666666'; view.rerender(<PtStatementControl {...p} />);
    await screen.findByRole('button', { name: 'Chốt phiếu PT' });
    await act(async () => resolve({ data: receipt('55555555-5555-4555-8555-555555555555'), error: null }));
    expect(screen.queryByText(/Phiếu đã chốt:/)).not.toBeInTheDocument();
    expect(p.onFinalized).not.toHaveBeenCalled();
  });

  it('explains a server overlap denial without clearing the durable request or claiming success', async () => {
    state.rpc.mockImplementation(async name => name === 'finalize_part_time_payroll_statement'
      ? { data: null, error: { message: 'PT_LEGACY_MONTHLY_OVERLAP_REQUIRES_REVIEW' } }
      : { data: null, error: null });
    const p = props(); render(<PtStatementControl {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Chốt phiếu PT' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận chốt phiếu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cần đối soát bảng lương cũ');
    expect(sessionStorage.getItem(key())).toBeTruthy();
    expect(p.onFinalized).not.toHaveBeenCalled();
  });

  it('starts a new request only after explicit confirmation and server verification of the prior paid receipt', async () => {
    const oldRequest = '55555555-5555-4555-8555-555555555555';
    const paid = { ...receipt(oldRequest), payment_id: '77777777-7777-4777-8777-777777777777' };
    sessionStorage.setItem(key(), oldRequest);
    let committed: ReturnType<typeof receipt> | null = null;
    state.rpc.mockImplementation(async (name, args) => {
      if (name === 'finalize_part_time_payroll_statement') { committed = receipt(args.p_request_id); return { data: committed, error: null }; }
      return { data: args.p_request_id === null || args.p_request_id === oldRequest ? paid : committed, error: null };
    });
    render(<PtStatementControl {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Chốt kỳ PT tiếp theo' }));
    expect(sessionStorage.getItem(key())).toBe(oldRequest);
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận chốt phiếu' }));
    await screen.findByText(/Chưa chi/);
    expect(sessionStorage.getItem(key())).not.toBe(oldRequest);
    expect(state.rpc.mock.calls.filter(([name]) => name.startsWith('finalize_'))).toHaveLength(1);
  });

  it('retains the old request if the prior payment cannot be verified before a new period', async () => {
    const request = '55555555-5555-4555-8555-555555555555'; sessionStorage.setItem(key(), request);
    state.rpc.mockResolvedValueOnce({ data: { ...receipt(request), payment_id: '77777777-7777-4777-8777-777777777777' }, error: null })
      .mockResolvedValue({ data: null, error: { message: 'offline' } });
    render(<PtStatementControl {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Chốt kỳ PT tiếp theo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận chốt phiếu' }));
    await screen.findByRole('alert');
    expect(sessionStorage.getItem(key())).toBe(request);
    expect(state.rpc.mock.calls.some(([name]) => name.startsWith('finalize_'))).toBe(false);
  });
});

it('observes another operator paying the statement without a remount or manual refresh',async()=>{
 vi.useFakeTimers();let paid:string|null=null;
 state.rpc.mockImplementation(async()=>({data:{...receipt('55555555-5555-4555-8555-555555555555'),payment_id:paid},error:null}));
 const view=render(<PtStatementControl {...props()} canFinalize={false}/>);
 try{
  await act(async()=>vi.advanceTimersByTimeAsync(1));expect(screen.getByRole('status')).toHaveTextContent('Chưa chi');
  paid='77777777-7777-4777-8777-777777777777';await act(async()=>vi.advanceTimersByTimeAsync(5000));
  expect(screen.getByRole('status')).toHaveTextContent('Đã ghi nhận chi');
  expect(state.rpc.mock.calls.some(([name])=>name==='pay_finalized_part_time_payroll_statement')).toBe(false);
 }finally{view.unmount();vi.useRealTimers();}
});

it('hides previously loaded payroll facts when the same-session status read is refused',async()=>{
 vi.useFakeTimers();let revoked=false;
 state.rpc.mockImplementation(async()=>revoked?{data:null,error:{code:'42501'}}
   :{data:receipt('55555555-5555-4555-8555-555555555555'),error:null});
 const view=render(<PtStatementControl {...props()}/>);
 try{
  await act(async()=>vi.advanceTimersByTimeAsync(1));expect(screen.getByRole('status')).toHaveTextContent('102.478');
  revoked=true;await act(async()=>vi.advanceTimersByTimeAsync(5000));
  expect(screen.queryByText(/Phiếu đã chốt:/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Phát lương và tất toán'})).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(/Chưa xác minh/);
 }finally{view.unmount();vi.useRealTimers();}
});
