import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {SePaySettlementTab} from './SePaySettlementTab';
const m=vi.hoisted(()=>({rpc:vi.fn(),actor:'00000000-0000-4000-8000-000000000001',features:{sepayScopedHandoff:true}}));
const actor='00000000-0000-4000-8000-000000000001',a='00000000-0000-4000-8000-000000000011',b='00000000-0000-4000-8000-000000000012';
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:m.actor},session:null})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:m.rpc}}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:m.features}));
vi.mock('sonner',()=>({toast:{error:vi.fn(),success:vi.fn()}}));
afterEach(()=>{cleanup();m.rpc.mockReset();m.actor=actor;m.features.sepayScopedHandoff=true;sessionStorage.clear();vi.useRealTimers();});
const row=(club:string,tail:string)=>({bank_transaction_id:'00000000-0000-4000-8000-0000000000'+tail,club_id:club,
 created_at:'2026-11-27T00:00:00Z',bt_status:'unmatched',reg_match_count:0,registration_id:null,
 amount:club===a?80000:150000,reg_total_pay:null,amount_delta:null,content:club===a?'A transfer':'B transfer'});
function fixture(){let allowed=[a,b];m.rpc.mockImplementation((name:string)=>{const response=Promise.resolve({data:name==='cashier_club_ids'?allowed:[row(a,'41'),row(b,'42')].filter(r=>allowed.includes(r.club_id)),error:null});return Object.assign(response,{abortSignal:()=>response});});return()=>{allowed=[b];};}
it('revalidates all-clubs membership and removes revoked A data/pending controls while retaining B and the journal',async()=>{
 vi.useFakeTimers();const revoke=fixture(),key=`vinpoker:sepay-pending:v1:${actor}`;
 const saved=JSON.stringify({actorId:actor,requestId:'00000000-0000-4000-8000-000000000071',clubId:a,
  bankId:row(a,'41').bank_transaction_id,registrationId:null,operation:'ignore',reason:'TEST pending A'});
 sessionStorage.setItem(key,saved);render(<SePaySettlementTab clubIds={[a,b]} allClubs/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 expect(screen.getByText('A transfer')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Tra cứu yêu cầu đang chờ'})).toBeInTheDocument();
 revoke();await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
 expect(screen.queryByText('A transfer')).not.toBeInTheDocument();expect(screen.getByText('B transfer')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Tra cứu yêu cầu đang chờ'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Thử lại cùng yêu cầu'})).not.toBeInTheDocument();
 expect(screen.queryByRole('link',{name:'Mở đúng giao dịch đang chờ'})).not.toBeInTheDocument();
 expect(sessionStorage.getItem(key)).toBe(saved);expect(m.rpc.mock.calls.some(c=>c[0]==='cashier_sepay_intent_v1')).toBe(false);
});
it('closes the revoked A dialog while an all-clubs screen remains open for B',async()=>{
 vi.useFakeTimers();const revoke=fixture();render(<SePaySettlementTab clubIds={[a,b]} allClubs/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});fireEvent.click(screen.getAllByRole('button',{name:'Bỏ qua'})[0]);
 expect(screen.getByRole('dialog')).toBeInTheDocument();revoke();await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.queryByText('A transfer')).not.toBeInTheDocument();
 expect(screen.getByText('B transfer')).toBeInTheDocument();expect(m.rpc.mock.calls.some(c=>c[0]==='cashier_sepay_intent_v1')).toBe(false);
});
it('does not restore the old actor membership after its delayed response arrives',async()=>{
 let release!:(value:unknown)=>void;const old=new Promise(resolve=>{release=resolve;});
 m.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  const response=name==='cashier_club_ids'&&args._user_id===actor?old:Promise.resolve({data:name==='cashier_club_ids'?[b]:[row(b,'42')],error:null});
  return Object.assign(response,{abortSignal:()=>response});
 });
 const view=render(<SePaySettlementTab clubIds={[a,b]} allClubs/>);m.actor='00000000-0000-4000-8000-000000000002';
 view.rerender(<SePaySettlementTab clubIds={[a,b]} allClubs/>);await screen.findByText('B transfer');
 await act(async()=>{release({data:[a],error:null});});
 expect(screen.getByText('B transfer')).toBeInTheDocument();expect(screen.queryByText('A transfer')).not.toBeInTheDocument();
 expect(m.rpc.mock.calls.filter(c=>c[0]==='cashier_club_ids').map(c=>c[1]._user_id)).toEqual([actor,m.actor]);
});
it('clears data and actions on an unverified membership result without reporting an empty worklist',async()=>{
 vi.useFakeTimers();let failed=false;
 m.rpc.mockImplementation((name:string)=>{const response=Promise.resolve(name==='cashier_club_ids'
  ?failed?{data:null,error:{code:'network_unavailable'}}:{data:[a,b],error:null}
  :{data:[row(a,'41'),row(b,'42')],error:null});return Object.assign(response,{abortSignal:()=>response});});
 render(<SePaySettlementTab clubIds={[a,b]} allClubs/>);await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 expect(screen.getByText('A transfer')).toBeInTheDocument();failed=true;
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
 expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh được quyền');
 expect(screen.queryByText('A transfer')).not.toBeInTheDocument();expect(screen.queryByText('B transfer')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Bỏ qua'})).not.toBeInTheDocument();
 expect(screen.queryByText('Không có khoản nào cần xử lý.')).not.toBeInTheDocument();
});
it('bounds a hung membership read and ignores its late success',async()=>{
 vi.useFakeTimers();let release!:(value:unknown)=>void;const hung=new Promise(resolve=>{release=resolve;});
 let reads=0;m.rpc.mockImplementation(()=>{const response=++reads===1?hung:new Promise(()=>{});return Object.assign(response,{abortSignal:()=>response});});
 render(<SePaySettlementTab clubIds={[a,b]} allClubs/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(9999);});expect(m.rpc).toHaveBeenCalledTimes(1);
 await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh được quyền');
 await act(async()=>{release({data:[a],error:null});});
 expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh được quyền');
 expect(screen.queryByText('A transfer')).not.toBeInTheDocument();
});
it('retains the legacy flag-off reader without membership RPCs or new polling',async()=>{
 vi.useFakeTimers();m.features.sepayScopedHandoff=false;fixture();
 render(<SePaySettlementTab clubIds={[a,b]} allClubs/>);await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 expect(screen.getByText('A transfer')).toBeInTheDocument();await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
 expect(m.rpc.mock.calls.map(c=>c[0])).toEqual(['sepay_cashier_settlement_worklist']);
});
