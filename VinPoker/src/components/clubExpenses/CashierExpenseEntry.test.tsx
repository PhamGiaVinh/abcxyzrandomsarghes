import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cashierExpenseIntent,cashierExpenseKey,saveCashierExpenseIntent} from '@/lib/clubExpenses/cashierExpensePayment';
const f=vi.hoisted(()=>({actor:'18140000-0000-4000-8000-000000000001',session:{access_token:'LOCAL_TEST_ONLY'},club:'18140000-0000-4000-8000-000000000002',shift:'18140000-0000-4000-8000-000000000003',expense:'18140000-0000-4000-8000-000000000005',allowed:true,rpc:vi.fn(),lookup:vi.fn(),last:null as Record<string,unknown>|null}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:f.actor},session:f.session,loading:false})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(name:string,args:Record<string,unknown>)=>f.rpc(name,args),from:(table:string)=>{
 let columns='';const q={select:(value:string)=>{columns=value;return q;},eq:()=>q,is:()=>q,maybeSingle:()=>{
  if(table==='cashier_tour_settings')return Promise.resolve({data:{club_id:f.club,enabled:true,expense_cash_source_enabled:true},error:null});
  if(columns.includes('receipts:'))return Promise.resolve({data:f.lookup(),error:null});
  return Promise.resolve({data:{id:f.shift,club_id:f.club,opening_cash:10000000,opened_at:'2026-11-26T00:00:00Z',closed_at:null},error:null});
 }};return q;
}}}));
import CashierExpenseEntry from './CashierExpenseEntry';
const clients:QueryClient[]=[];
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});clients.push(client);const view=render(<QueryClientProvider client={client}><CashierExpenseEntry clubId={f.club} allowNew/></QueryClientProvider>);return {...view,rerenderAuth:()=>view.rerender(<QueryClientProvider client={client}><CashierExpenseEntry clubId={f.club} allowNew/></QueryClientProvider>)};}
beforeEach(()=>{sessionStorage.clear();f.allowed=true;f.rpc.mockReset();f.lookup.mockReset();f.last=null;f.lookup.mockReturnValue(null);
 f.session={access_token:'LOCAL_TEST_ONLY'};
 f.rpc.mockImplementation((name,args)=>{if(name==='is_club_cashier')return Promise.resolve({data:f.allowed,error:null});if(name==='cashier_shift_summary_v1')return Promise.resolve({data:{ok:true,shift_id:f.shift,club_id:f.club,closed_at:null,expected_cash:10000000},error:null});f.last=args;return Promise.resolve({data:{status:'ok',idempotent:false,expense_id:f.expense,request_id:args.p_request_id,shift_id:args.p_shift_id,amount_vnd:args.p_amount_vnd,paid_at:'2026-11-26T01:00:00Z'},error:null});});});
afterEach(()=>{cleanup();clients.splice(0).forEach(x=>x.clear());vi.restoreAllMocks();});
const payments=()=>f.rpc.mock.calls.filter(c=>c[0]==='record_cashier_club_expense_v1');
it('requires explicit till selection, persists the intent before sending and prevents double submit',async()=>{
 mount();await waitFor(()=>expect(screen.getByLabelText('Két chi tiền')).not.toBeDisabled());fireEvent.change(screen.getByLabelText('Số tiền chi'),{target:{value:'1.000.000'}});
 expect(screen.getByRole('button',{name:'Chi từ két'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Két chi tiền'),{target:{value:f.shift}});
 let finish!:(value:unknown)=>void;f.rpc.mockImplementationOnce((name,args)=>{expect(name).toBe('record_cashier_club_expense_v1');expect(sessionStorage.getItem(cashierExpenseKey(f.actor,f.club))).toContain(String(args.p_request_id));f.last=args;return new Promise(r=>{finish=r;});});
 const form=screen.getByLabelText('Số tiền chi').closest('form')!;fireEvent.submit(form);fireEvent.submit(form);expect(payments()).toHaveLength(1);
 await act(async()=>{finish({data:{status:'ok',idempotent:false,expense_id:f.expense,request_id:f.last!.p_request_id,shift_id:f.shift,amount_vnd:1000000,paid_at:'2026-11-26T01:00:00Z'},error:null});});
 await screen.findByText('Đã ghi chi từ két');expect(sessionStorage.getItem(cashierExpenseKey(f.actor,f.club))).toBeNull();
});
it('does not upgrade accountant or navigation access into permission to spend a till',async()=>{
 f.allowed=false;mount();await screen.findByText(/chưa có quyền chi từ két/);expect(payments()).toHaveLength(0);expect(screen.queryByLabelText('Két chi tiền')).toBeNull();
});
it.each(['pending','denied-read'] as const)('hides a receipt while current authorization is %s after session refresh',async mode=>{
 const view=mount();await waitFor(()=>expect(screen.getByLabelText('Két chi tiền')).not.toBeDisabled());
 fireEvent.change(screen.getByLabelText('Số tiền chi'),{target:{value:'1000000'}});fireEvent.change(screen.getByLabelText('Két chi tiền'),{target:{value:f.shift}});
 fireEvent.submit(screen.getByLabelText('Số tiền chi').closest('form')!);await screen.findByText('Đã ghi chi từ két');
 const base=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementation((name,args)=>name==='is_club_cashier'?(mode==='pending'?new Promise(()=>{}):Promise.resolve({data:null,error:{code:'42501'}})):base(name,args));
 f.session={access_token:'LOCAL_TEST_NEW_AUTH'};view.rerenderAuth();
 await waitFor(()=>expect(screen.queryByText('Đã ghi chi từ két')).toBeNull());
 expect(screen.queryByText(new RegExp(f.expense))).toBeNull();expect(payments()).toHaveLength(1);
});
it('resolves a restored closed-source absence by read only, without sending a payment',async()=>{
 const intent=cashierExpenseIntent(f.actor,f.club,{shiftId:f.shift,category:'rent',amountVnd:1000000,incurredAt:'2026-10-10T12:00:00+07:00',description:null});saveCashierExpenseIntent(sessionStorage,intent);
 f.lookup.mockReturnValue({id:f.shift,club_id:f.club,closed_at:'2026-11-26T02:00:00Z',receipts:[],club:{id:f.club,expenses:[]}});mount();
 await waitFor(()=>expect(sessionStorage.getItem(cashierExpenseKey(f.actor,f.club))).toBeNull());expect(payments()).toHaveLength(0);expect(screen.getByRole('alert')).toHaveTextContent(/két đã đóng/i);
});
it('does not leave a refreshed session busy or let its old acknowledgement unlock a newer retry',async()=>{
 const view=mount();await waitFor(()=>expect(screen.getByLabelText('Két chi tiền')).not.toBeDisabled());
 fireEvent.change(screen.getByLabelText('Số tiền chi'),{target:{value:'1000000'}});fireEvent.change(screen.getByLabelText('Két chi tiền'),{target:{value:f.shift}});
 const base=f.rpc.getMockImplementation()!,sent:Record<string,unknown>[]=[],finish:((v:unknown)=>void)[]=[];
 f.rpc.mockImplementation((name,args)=>{if(name!=='record_cashier_club_expense_v1')return base(name,args);sent.push(args);return new Promise(resolve=>finish.push(resolve));});
 fireEvent.submit(screen.getByLabelText('Số tiền chi').closest('form')!);expect(sent).toHaveLength(1);
 f.session={access_token:'LOCAL_TEST_REFRESHED'};view.rerenderAuth();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Gửi lại yêu cầu cũ'})).not.toBeDisabled());
 fireEvent.click(screen.getByRole('button',{name:'Gửi lại yêu cầu cũ'}));expect(sent).toHaveLength(2);expect(sent[1]).toEqual(sent[0]);
 const packet={data:{status:'ok',idempotent:true,expense_id:f.expense,request_id:sent[0].p_request_id,shift_id:f.shift,amount_vnd:1000000,paid_at:'2026-11-26T01:00:00Z'},error:null};
 await act(async()=>finish[0](packet));expect(screen.getByRole('button',{name:'Đang xác minh…'})).toBeDisabled();expect(screen.queryByText('Đã ghi chi từ két')).toBeNull();
 await act(async()=>finish[1](packet));await screen.findByText('Đã ghi chi từ két');
});
