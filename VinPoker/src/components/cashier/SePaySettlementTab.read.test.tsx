import {Component,type ReactNode} from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SePaySettlementTab } from './SePaySettlementTab';
import { toast } from 'sonner';

const { rpc, auth } = vi.hoisted(() => ({ rpc: vi.fn(), auth: { user: { id: '00000000-0000-4000-8000-000000000001' }, session: null } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
afterEach(() => { cleanup(); sessionStorage.clear(); rpc.mockReset(); vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear(); auth.user = { id: '00000000-0000-4000-8000-000000000001' }; vi.useRealTimers(); });
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
// Current intent boundary uses actual UUID-shaped IDs; labels remain unchanged.
function ids(value:unknown):unknown {
 const names=['actor-a','bank-a','reg-a','club-a','entry-a','seat-a','receipt-a','table-a'];
 if(typeof value==='string'&&names.includes(value))return `00000000-0000-4000-8000-${String(names.indexOf(value)+1).padStart(12,'0')}`;
 if(Array.isArray(value))return value.map(ids);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,ids(v)]));
 return value;
}
const query = (promise: Promise<unknown>) => {const normalized=promise.then(ids);return Object.assign(normalized, { abortSignal: () => normalized });};
function envelope(receipt:unknown,args:Record<string,unknown>){return {ok:true,status:'receipt_found',actor_id:auth.user.id,
 request_id:args.p_request_id,club_id:'club-a',request_hash:'a'.repeat(64),replayed:false,
 payload:{operation:args.p_operation,bank_transaction_id:args.p_bank_transaction_id,registration_id:args.p_registration_id,reason:args.p_reason,
 ...(args.p_expected_snapshot?{snapshot:args.p_expected_snapshot}:{})},receipt};}

it('shows a read error instead of claiming no actionable transfers, then retries', async () => {
 rpc.mockReturnValueOnce(query(Promise.resolve({ data: null, error: { message: 'backend unavailable' } })))
  .mockReturnValueOnce(query(Promise.resolve({ data: [], error: null })));
 render(<SePaySettlementTab clubIds={['club-a']}/>);
 await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Không tải được'));
 expect(screen.queryByText('Không có khoản nào cần xử lý.')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
 await screen.findByText('Không có khoản nào cần xử lý.');
 expect(rpc).toHaveBeenCalledTimes(2);
});

for(const data of [null, { ok: true }, [null]])it(`rejects malformed successful worklist ${JSON.stringify(data)}`, async () => {
 rpc.mockReturnValue(query(Promise.resolve({ data, error: null })));
 render(<SePaySettlementTab clubIds={['club-a']}/>);
 await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Không tải được'));
 expect(screen.queryByText('Không có khoản nào cần xử lý.')).not.toBeInTheDocument();
});

it('does not accept an old actor response after switching accounts in the same club', async () => {
 const old = deferred(), current = deferred();
 rpc.mockReturnValueOnce(query(old.promise)).mockReturnValueOnce(query(current.promise));
 const view = render(<SePaySettlementTab clubIds={['club-a']}/>);
 auth.user = { id: 'actor-b' }; view.rerender(<SePaySettlementTab clubIds={['club-a']}/>);
 await act(async () => { current.resolve({ data: [], error: null }); });
 await screen.findByText('Không có khoản nào cần xử lý.');
 await act(async () => { old.resolve({ data: null, error: { message: 'old actor failure' } }); });
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 expect(rpc).toHaveBeenCalledTimes(2);
});

it('bounds a hung read, retries, and ignores its late response', async () => {
 vi.useFakeTimers(); const old=deferred();
 rpc.mockReturnValueOnce(query(old.promise)).mockReturnValueOnce(query(Promise.resolve({data:[],error:null})));
 render(<SePaySettlementTab clubIds={['club-a']}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
 expect(screen.getByRole('alert')).toHaveTextContent('Không tải được');
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));});
 expect(screen.getByText('Không có khoản nào cần xử lý.')).toBeInTheDocument();
 await act(async()=>{old.resolve({data:null,error:{message:'late'}});});
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('renders permission denial separately and never reports a network error as no permission', async()=>{
 rpc.mockReturnValue(query(Promise.resolve({data:null,error:{code:'42501'}})));
 render(<SePaySettlementTab clubIds={['club-a']}/>);
 await screen.findByText('Không có quyền đọc danh sách đối soát SePay.');
 expect(screen.queryByText('Không có khoản nào cần xử lý.')).not.toBeInTheDocument();
});

it('does not retain worklist data after logout', async()=>{
 rpc.mockReturnValue(query(Promise.resolve({data:[],error:null})));
 const view=render(<SePaySettlementTab clubIds={['club-a']}/>);
 await screen.findByText('Không có khoản nào cần xử lý.');
 Object.assign(auth,{user:null});view.rerender(<SePaySettlementTab clubIds={['club-a']}/>);
 expect(screen.getByRole('alert')).toHaveTextContent('Đăng nhập');
 expect(screen.queryByText('Không có khoản nào cần xử lý.')).not.toBeInTheDocument();
 expect(rpc).toHaveBeenCalledTimes(1);
});

it('renders a valid raw worklist row without dispatching a mutation',async()=>{
 rpc.mockReturnValue(query(Promise.resolve({data:[{bank_transaction_id:'bank-a',club_id:'club-a',created_at:'2026-10-21T00:00:00Z',bt_status:'pending',reg_match_count:1,registration_id:'reg-a',amount:100000,reg_total_pay:100000,amount_delta:0,player_display:'TEST Player',tournament_name:'TEST Tour'}],error:null})));
 render(<SePaySettlementTab clubIds={['club-a']}/>);
 await screen.findByText('TEST Player · TEST Tour');
 expect(screen.getByRole('button',{name:'Xác nhận'})).toBeEnabled();
 expect(rpc.mock.calls.every(call=>call[0]==='sepay_cashier_settlement_worklist')).toBe(true);
});

for(const response of [
 {ok:true,outcome:'unknown'},
 {ok:true,outcome:'manual_confirmed',registration_id:'other-reg',club_id:'club-a',confirm:{ok:true}},
 {ok:true,outcome:'manual_confirmed',registration_id:'reg-a',club_id:'club-a',confirm:{ok:true}},
])it(`does not claim seating success from an unverified confirmation ${JSON.stringify(response)}`,async()=>{
 rpc.mockImplementation((name:string,args:Record<string,unknown>)=>query(Promise.resolve(name==='sepay_cashier_settlement_worklist'?{data:[{bank_transaction_id:'bank-a',club_id:'club-a',created_at:'2026-10-21T00:00:00Z',bt_status:'pending',reg_match_count:1,registration_id:'reg-a',amount:100000,reg_total_pay:100000,amount_delta:0,player_display:'TEST Player',tournament_name:'TEST Tour'}],error:null}:{data:envelope(response,args),error:null})));
 render(<SePaySettlementTab clubIds={['club-a']}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Xác nhận'}));
 fireEvent.click(screen.getByRole('button',{name:'Xác nhận khoản chuyển'}));
 await waitFor(()=>expect(toast.error).toHaveBeenCalled());
 expect(toast.success).not.toHaveBeenCalled();
});

it('accepts the exact current manual-confirm receipt shape',async()=>{
 const row={bank_transaction_id:'bank-a',club_id:'club-a',created_at:'2026-10-21T00:00:00Z',bt_status:'pending',reg_match_count:1,registration_id:'reg-a',amount:100000,reg_total_pay:100000,amount_delta:0};
 rpc.mockImplementation((name:string,args:Record<string,unknown>)=>query(Promise.resolve({error:null,data:name==='sepay_cashier_settlement_worklist'?[row]:envelope({ok:true,outcome:'manual_confirmed',registration_id:'reg-a',club_id:'club-a',confirm:{ok:true,registration_id:'reg-a',entry_id:'entry-a',seat_id:'seat-a',receipt_id:'receipt-a',table_id:'table-a',seat_number:2}},args)})));
 render(<SePaySettlementTab clubIds={['club-a']}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Xác nhận'}));
 fireEvent.click(screen.getByRole('button',{name:'Xác nhận khoản chuyển'}));
 await waitFor(()=>expect(toast.success).toHaveBeenCalledWith('Đã xác nhận — ghế đã được xếp.'));
});

for(const [response,success] of [[{ok:true,outcome:'unknown'},false],[{ok:true,outcome:'dismissed',club_id:'other-club'},false],[{ok:true,outcome:'dismissed',club_id:'club-a'},true],[{ok:true,already_ignored:true},true]] as const)
 it(`validates ignore outcome ${JSON.stringify(response)}`,async()=>{
  const row={bank_transaction_id:'bank-a',club_id:'club-a',created_at:'2026-10-21T00:00:00Z',bt_status:'pending',reg_match_count:0,registration_id:null,amount:100000,reg_total_pay:null,amount_delta:null};
  rpc.mockImplementation((name:string,args:Record<string,unknown>)=>query(Promise.resolve({data:name==='sepay_cashier_settlement_worklist'?[row]:envelope(response,args),error:null})));
  render(<SePaySettlementTab clubIds={['club-a']}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Bỏ qua'}));
  fireEvent.click(screen.getByRole('button',{name:'Xác nhận bỏ qua'}));
  await waitFor(()=>expect(success?toast.success:toast.error).toHaveBeenCalled());
  if(!success)expect(toast.success).not.toHaveBeenCalled();
 });

it('keeps the exact intent after response loss and resolves it after remount without a second commit',async()=>{
 const row={bank_transaction_id:'bank-a',club_id:'club-a',created_at:'2026-10-21T00:00:00Z',bt_status:'unmatched',reg_match_count:0,registration_id:null,amount:100000,reg_total_pay:null,amount_delta:null};
 rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  if(name==='sepay_cashier_settlement_worklist')return query(Promise.resolve({data:[row],error:null}));
  return query(Promise.resolve(args.p_mode==='commit'?{data:null,error:{message:'response lost after commit'}}:
   {data:envelope({ok:true,outcome:'dismissed',club_id:'club-a'},args),error:null}));
 });
 const view=render(<SePaySettlementTab clubIds={['club-a']}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Bỏ qua'}));
 fireEvent.click(screen.getByRole('button',{name:'Xác nhận bỏ qua'}));
 await screen.findByText('Chưa xác minh được kết quả. Giữ nguyên yêu cầu và tra cứu trước khi thao tác tiếp.');
 const commit=rpc.mock.calls.find(call=>call[0]==='cashier_sepay_intent_v1');expect(commit).toBeTruthy();
 expect(screen.getByRole('button',{name:'Bỏ qua'})).toBeDisabled();
 view.unmount();render(<SePaySettlementTab clubIds={['club-a']}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Tra cứu yêu cầu đang chờ'}));
 await waitFor(()=>expect(toast.success).toHaveBeenCalledWith('Đã bỏ qua giao dịch.'));
 const calls=rpc.mock.calls.filter(call=>call[0]==='cashier_sepay_intent_v1');
 expect(calls).toHaveLength(2);expect(calls[0][1].p_mode).toBe('commit');expect(calls[1][1].p_mode).toBe('receipt');
 expect(calls[1][1].p_request_id).toBe(calls[0][1].p_request_id);
});

it('only retries the same key after an explicit missing-receipt lookup',async()=>{
 const row={bank_transaction_id:'bank-a',club_id:'club-a',created_at:'2026-10-21T00:00:00Z',bt_status:'unmatched',reg_match_count:0,registration_id:null,amount:100000,reg_total_pay:null,amount_delta:null};
 let commits=0;
 rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  if(name==='sepay_cashier_settlement_worklist')return query(Promise.resolve({data:[row],error:null}));
  if(args.p_mode==='receipt')return query(Promise.resolve({data:{...envelope(null,args),status:'receipt_not_found'},error:null}));
  return query(Promise.resolve(++commits===1?{data:null,error:{message:'lost'}}:{data:envelope({ok:true,already_ignored:true},args),error:null}));
 });
 render(<SePaySettlementTab clubIds={['club-a']}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Bỏ qua'}));
 fireEvent.click(screen.getByRole('button',{name:'Xác nhận bỏ qua'}));
 await screen.findByText('Chưa xác minh được kết quả. Giữ nguyên yêu cầu và tra cứu trước khi thao tác tiếp.');
 expect(screen.queryByRole('button',{name:'Thử lại cùng yêu cầu'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Tra cứu yêu cầu đang chờ'}));
 fireEvent.click(await screen.findByRole('button',{name:'Thử lại cùng yêu cầu'}));
 await waitFor(()=>expect(toast.success).toHaveBeenCalledWith('Đã bỏ qua giao dịch.'));
 const calls=rpc.mock.calls.filter(call=>call[0]==='cashier_sepay_intent_v1');
 expect(calls.map(c=>c[1].p_mode)).toEqual(['commit','receipt','commit']);
 expect(new Set(calls.map(c=>c[1].p_request_id)).size).toBe(1);
});

it('does not clear the old actor journal or toast after an account switch during commit',async()=>{
 const slow=deferred();let commitArgs:Record<string,unknown>={};
 const row={bank_transaction_id:'bank-a',club_id:'club-a',created_at:'2026-10-21T00:00:00Z',bt_status:'unmatched',reg_match_count:0,registration_id:null,amount:100000,reg_total_pay:null,amount_delta:null};
 rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  if(name==='sepay_cashier_settlement_worklist')return query(Promise.resolve({data:[row],error:null}));
  commitArgs=args;return query(slow.promise);
 });
 const view=render(<SePaySettlementTab clubIds={['club-a']}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Bỏ qua'}));
 fireEvent.click(screen.getByRole('button',{name:'Xác nhận bỏ qua'}));
 auth.user={id:'00000000-0000-4000-8000-000000000099'};view.rerender(<SePaySettlementTab clubIds={['club-a']}/>);
 await act(async()=>{slow.resolve({data:{...envelope({ok:true,already_ignored:true},commitArgs),actor_id:'00000000-0000-4000-8000-000000000001'},error:null});});
 expect(toast.success).not.toHaveBeenCalled();
 const saved=JSON.parse(sessionStorage.getItem('vinpoker:sepay-pending:v1:00000000-0000-4000-8000-000000000001')!);
 expect(saved.resolved).not.toBe(true);
 expect(screen.queryByRole('button',{name:'Tra cứu yêu cầu đang chờ'})).not.toBeInTheDocument();
});

it('bounds a hung mutation without clearing its key or accepting a late success',async()=>{
 const slow=deferred();let args:Record<string,unknown>={};
 const row={bank_transaction_id:'bank-a',club_id:'club-a',created_at:'2026-10-21T00:00:00Z',bt_status:'unmatched',reg_match_count:0,registration_id:null,amount:100000,reg_total_pay:null,amount_delta:null};
 rpc.mockImplementation((name:string,input:Record<string,unknown>)=>{
  if(name==='sepay_cashier_settlement_worklist')return query(Promise.resolve({data:[row],error:null}));
  args=input;return query(slow.promise);
 });
 render(<SePaySettlementTab clubIds={['club-a']}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Bỏ qua'}));
 vi.useFakeTimers();
 fireEvent.click(screen.getByRole('button',{name:'Xác nhận bỏ qua'}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(20000);});
 expect(screen.getByText('Chưa xác minh được kết quả. Giữ nguyên yêu cầu và tra cứu trước khi thao tác tiếp.')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Tra cứu yêu cầu đang chờ'})).toBeEnabled();
 await act(async()=>{slow.resolve({data:envelope({ok:true,already_ignored:true},args),error:null});});
 expect(toast.success).not.toHaveBeenCalled();
 expect(JSON.parse(sessionStorage.getItem('vinpoker:sepay-pending:v1:00000000-0000-4000-8000-000000000001')!).requestId).toBe(args.p_request_id);
});

it('does not send a mutation when durable journal storage fails',async()=>{
 const row={bank_transaction_id:'bank-a',club_id:'club-a',created_at:'2026-10-21T00:00:00Z',bt_status:'unmatched',reg_match_count:0,registration_id:null,amount:100000,reg_total_pay:null,amount_delta:null};
 rpc.mockReturnValue(query(Promise.resolve({data:[row],error:null})));
 render(<SePaySettlementTab clubIds={['club-a']}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Bỏ qua'}));
 const denied=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota');});
 try{
  fireEvent.click(screen.getByRole('button',{name:'Xác nhận bỏ qua'}));
  await screen.findByText('Không đọc/lưu được yêu cầu đang chờ. Không gửi khoản mới; cần kiểm tra journal trước.');
  expect(rpc.mock.calls.every(call=>call[0]==='sepay_cashier_settlement_worklist')).toBe(true);
 }finally{denied.mockRestore();}
});

it('keeps the Supabase client receiver when dispatching an intent RPC',async()=>{
 const row={bank_transaction_id:'bank-a',club_id:'club-a',created_at:'2026-10-21T00:00:00Z',bt_status:'unmatched',reg_match_count:0,registration_id:null,amount:100000,reg_total_pay:null,amount_delta:null};
 rpc.mockImplementation(function(this:{rpc:unknown},name:string,args:Record<string,unknown>){
  if(name==='sepay_cashier_settlement_worklist')return query(Promise.resolve({data:[row],error:null}));
  expect(this?.rpc).toBe(rpc);
  return query(Promise.resolve({data:envelope({ok:true,already_ignored:true},args),error:null}));
 });
 render(<SePaySettlementTab clubIds={['club-a']}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Bỏ qua'}));
 fireEvent.click(screen.getByRole('button',{name:'Xác nhận bỏ qua'}));
 await waitFor(()=>expect(toast.success).toHaveBeenCalledWith('Đã bỏ qua giao dịch.'));
});

it('does not warn about normal confirmed registrations in the resolved list',async()=>{
 const row={bank_transaction_id:'bank-a',club_id:'club-a',created_at:'2026-10-21T00:00:00Z',bt_status:'matched',reg_match_count:1,registration_id:'reg-a',reg_status:'confirmed',amount:100000,reg_total_pay:100000,amount_delta:0,player_display:'TEST Player',tournament_name:'TEST Tour'};
 rpc.mockImplementation((_name:string,args:Record<string,unknown>)=>query(Promise.resolve({data:args.p_scope==='resolved'?[row]:[],error:null})));
 render(<SePaySettlementTab clubIds={['club-a']}/>);
 await screen.findByText('Không có khoản nào cần xử lý.');
 fireEvent.click(screen.getByRole('button',{name:'Đã xử lý'}));
 await screen.findByText('TEST Player · TEST Tour');
 expect(screen.queryByText(/Đăng ký không ở trạng thái chờ/)).not.toBeInTheDocument();
});

it('does not promise seating or treating a note as cash for a short bank transfer',async()=>{
 const row={bank_transaction_id:'bank-a',club_id:'club-a',created_at:'2026-10-21T00:00:00Z',bt_status:'unmatched',reg_match_count:1,registration_id:'reg-a',reg_status:'pending',amount:40000,reg_total_pay:100000,amount_delta:-60000,player_display:'TEST Partial',tournament_name:'TEST Tour'};
 rpc.mockReturnValue(query(Promise.resolve({data:[row],error:null})));
 render(<SePaySettlementTab clubIds={['club-a']}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Xác nhận'}));
 expect(screen.getByText('Chỉ xếp ghế khi tổng tiền đã ghi nhận đủ và có bàn/ghế phù hợp.')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Xác nhận & xếp ghế'})).not.toBeInTheDocument();
 expect(screen.queryByPlaceholderText(/khách bù tiền mặt/)).not.toBeInTheDocument();
 expect(rpc.mock.calls.every(call=>call[0]==='sepay_cashier_settlement_worklist')).toBe(true);
});

for(const amount of [1.5,Number.MAX_SAFE_INTEGER+1])it(`rejects unrepresentable integer VND from worklist ${amount}`,async()=>{
 const row={bank_transaction_id:'bank-a',club_id:'club-a',created_at:'2026-10-21T00:00:00Z',bt_status:'unmatched',reg_match_count:0,registration_id:null,amount,reg_total_pay:null,amount_delta:null};
 rpc.mockReturnValue(query(Promise.resolve({data:[row],error:null})));
 render(<SePaySettlementTab clubIds={['club-a']}/>);
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Không tải được danh sách đối soát'));
 expect(screen.queryByRole('button',{name:'Bỏ qua'})).not.toBeInTheDocument();
});

it('labels the frozen registration total as a total, not the outstanding amount',async()=>{
 const row={bank_transaction_id:'bank-a',club_id:'club-a',created_at:'2026-10-21T00:00:00Z',bt_status:'unmatched',reg_match_count:1,registration_id:'reg-a',reg_status:'pending',amount:80000,reg_total_pay:100000,amount_delta:-20000,player_display:'TEST Partial',tournament_name:'TEST Tour'};
 rpc.mockReturnValue(query(Promise.resolve({data:[row],error:null})));
 render(<SePaySettlementTab clubIds={['club-a']}/>);
 const confirm=await screen.findByRole('button',{name:'Xác nhận'});
 expect(screen.queryByText(/Cần thu/)).not.toBeInTheDocument();
 expect(screen.getByText(/Tổng phí đăng ký/)).toBeInTheDocument();
 fireEvent.click(confirm);
 expect(screen.queryByText(/Cần thu/)).not.toBeInTheDocument();
 expect(screen.getAllByText(/Tổng phí đăng ký/)).toHaveLength(2);
});
for(const {status,surplus} of [{status:'partial',surplus:0},{status:'waiting',surplus:0},{status:'review',surplus:0},{status:'waiting',surplus:20000},{status:'review',surplus:20000}] as const)it(`resolves ${status} receipt with surplus ${surplus} without promising a seat or dispatching another payment`,async()=>{
 const amount=surplus>0?80000:40000;
 const row={bank_transaction_id:'bank-a',club_id:'club-a',created_at:'2026-10-21T00:00:00Z',bt_status:'unmatched',reg_match_count:1,registration_id:'reg-a',reg_status:'pending',amount,reg_total_pay:100000,amount_delta:amount-100000,player_display:'TEST Partial',tournament_name:'TEST Tour'};
 const common={ok:true,registration_id:'reg-a',club_id:'club-a',surplus,applied:amount-surplus};
 const receipt=status==='partial'?{...common,outcome:'partial_received',payment_state:'partial',received:40000,remaining:60000}:
  {...common,outcome:status==='waiting'?'paid_waiting_seat':'paid_seating_review',payment_state:'paid',
   confirm:{ok:status==='waiting',payment_state:'paid',seating_state:status==='waiting'?'waiting':'needs_review',...(status==='review'?{error:'TEST seat locked'}:{})}};
 let resolved=false;
 rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  if(name==='sepay_cashier_settlement_worklist')return query(Promise.resolve({data:resolved?[]:[row],error:null}));
  resolved=true;return query(Promise.resolve({data:envelope(receipt,args),error:null}));
 });
 render(<SePaySettlementTab clubIds={['club-a']}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Xác nhận'}));
 fireEvent.change(screen.getByPlaceholderText(/Lý do chênh lệch/),{target:{value:'TEST partial receipt'}});
 fireEvent.click(screen.getByRole('button',{name:'Xác nhận khoản chuyển'}));
 await screen.findByText('Không có khoản nào cần xử lý.');
 const message=status==='partial'?'Đã ghi nhận tiền một phần; còn thiếu 60.000đ. Chưa xếp ghế.':status==='waiting'?'Đã nhận đủ tiền — đang chờ bàn/ghế. Không thu lại tiền.':'Đã ghi nhận tiền nhưng xếp ghế cần xử lý. Không thu lại tiền.';
 expect(status==='review'?toast.error:toast.success).toHaveBeenCalledWith(message+(surplus>0?` Có tiền dư ${surplus.toLocaleString('vi-VN')}đ cần đối soát.`:''));
 expect(rpc.mock.calls.filter(call=>call[0]==='cashier_sepay_intent_v1')).toHaveLength(1);
 expect(JSON.parse(sessionStorage.getItem('vinpoker:sepay-pending:v1:00000000-0000-4000-8000-000000000001')!).resolved).toBe(true);
 expect(toast.success).not.toHaveBeenCalledWith('Đã xác nhận — ghế đã được xếp.');
});

class MalformedReadBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<p data-testid="unexpected-render-crash">Unexpected render crash</p>:this.props.children;}
}
it.each([{content:{invalid:true}},{occurred_at:'not-a-date'},{settlement_created_at:'not-a-date'}])('rejects invalid display fields before rendering or enabling SePay actions: %j',async(invalid)=>{
 const row={bank_transaction_id:'bank-a',club_id:'club-a',created_at:'2026-10-21T00:00:00Z',bt_status:'pending',reg_match_count:1,registration_id:'reg-a',amount:100000,reg_total_pay:100000,amount_delta:0,player_display:'TEST Player',tournament_name:'TEST Tour',...invalid};
 rpc.mockReturnValue(query(Promise.resolve({data:[row],error:null})));
 render(<MalformedReadBoundary><SePaySettlementTab clubIds={['club-a']}/></MalformedReadBoundary>);
 await screen.findByRole('alert');expect(screen.getByRole('alert')).toHaveTextContent('Không tải được');
 expect(screen.queryByTestId('unexpected-render-crash')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Xác nhận'})).not.toBeInTheDocument();
 expect(rpc.mock.calls.every(call=>call[0]==='sepay_cashier_settlement_worklist')).toBe(true);
});
