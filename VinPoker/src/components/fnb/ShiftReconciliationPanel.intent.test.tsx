import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({rpc:vi.fn(),success:vi.fn(),error:vi.fn(),
 shifts:{data:{open:null,recent:[]} as unknown,isLoading:false,isError:false,refetch:vi.fn()},
 report:{data:undefined as unknown,isLoading:false,isError:false,refetch:vi.fn()},
 auth:{user:{id:'10000000-0000-4000-8000-000000000001'},session:{access_token:'TEST_NO_SECRET'},loading:false}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>h.auth}));
vi.mock('@/hooks/useFnbShift',()=>({useFnbShifts:()=>h.shifts,useFnbShiftReport:()=>h.report}));
vi.mock('sonner',()=>({toast:{success:h.success,error:h.error}}));
import {ShiftReconciliationPanel} from './ShiftReconciliationPanel';
const club='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
const open={id:'30000000-0000-4000-8000-000000000001',club_id:club,status:'open',opened_at:'2026-10-25T08:00:00Z',opening_float_vnd:1000};
const view=(clubId=club)=><QueryClientProvider client={new QueryClient()}><ShiftReconciliationPanel clubId={clubId} canClose/></QueryClientProvider>;
function withOpen(){h.shifts.data={open,recent:[open]};h.report.data={shift:open,sales_vnd:5000,refunds_vnd:0,expected_cash_vnd:5000,expected_drawer_vnd:6000,comp_count:0,orders:[]};}
describe('F&B shift mutation recovery, not transport-success',()=>{
 beforeEach(()=>{
  localStorage.clear();vi.stubEnv('VITE_SUPABASE_URL','http://127.0.0.1:54329');
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async (_name:string,work:()=>unknown)=>work())}});
  h.rpc.mockReset();h.rpc.mockResolvedValue({data:null,error:null});h.success.mockReset();h.error.mockReset();
  h.shifts={data:{open:null,recent:[]},isLoading:false,isError:false,refetch:vi.fn()};
  h.report={data:undefined,isLoading:false,isError:false,refetch:vi.fn()};
  h.auth={user:{id:'10000000-0000-4000-8000-000000000001'},session:{access_token:'TEST_NO_SECRET'},loading:false};
 });
 afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
 it('does not report a null open response as success',async()=>{
  render(view());fireEvent.click(screen.getByRole('button',{name:'Mở ca'}));
  await waitFor(()=>expect(h.rpc).toHaveBeenCalled());
  await act(async()=>{});expect(h.success).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('chưa được xác minh');
 });
 it('does not turn malformed close totals into confirmed zero variance',async()=>{
  withOpen();h.rpc.mockResolvedValue({data:{status:'ok',variance_vnd:0},error:null});render(view());
  fireEvent.change(screen.getByPlaceholderText('Đếm trong két'),{target:{value:'6000'}});
  fireEvent.click(screen.getByRole('button',{name:'Chốt ca'}));
  await waitFor(()=>expect(h.rpc).toHaveBeenCalled());await act(async()=>{});
  expect(h.success).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('chưa được xác minh');
 });
 it.each(['abc','-1','1.5'])('rejects invalid cash input %s without converting it to zero/another number',async value=>{
  render(view());fireEvent.change(screen.getByPlaceholderText('0'),{target:{value}});
  fireEvent.click(screen.getByRole('button',{name:'Mở ca'}));await act(async()=>{});
  expect(h.rpc).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
 });
 it('retains the unresolved key over unmount/reload rather than allowing a new open',async()=>{
  h.rpc.mockResolvedValue({data:null,error:{message:'503'}});const page=render(view());
  fireEvent.click(screen.getByRole('button',{name:'Mở ca'}));await waitFor(()=>expect(h.rpc).toHaveBeenCalled());await act(async()=>{});
  const first=h.rpc.mock.calls[0][1].p_client_request_id;page.unmount();h.rpc.mockClear();render(view());
  expect(screen.getByRole('alert')).toHaveTextContent('chưa được xác minh');
  expect(screen.queryByRole('button',{name:'Mở ca'})).not.toBeInTheDocument();
  expect(Object.values(localStorage).some(value=>typeof value==='string'&&value.includes(first))).toBe(true);expect(h.rpc).not.toHaveBeenCalled();
 });
 it('does not apply an old club completion to the new club screen',async()=>{
  let resolve!:(value:unknown)=>void;h.rpc.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  const page=render(view());fireEvent.click(screen.getByRole('button',{name:'Mở ca'}));await waitFor(()=>expect(h.rpc).toHaveBeenCalled());
  page.rerender(view(other));await act(async()=>resolve({data:{status:'ok'},error:null}));
  expect(h.success).not.toHaveBeenCalled();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 });
 it('confirms an exact actor-bound receipt and retains a settled fence without bearer data',async()=>{
  h.rpc.mockImplementation((_name,args)=>Promise.resolve({data:{status:'ok',actor_id:args.p_expected_actor,club_id:args.p_club_id,
   request_id:args.p_client_request_id,operation:'open',shift_id:open.id,already_open:false,opening_float_vnd:0},error:null}));
  render(view());fireEvent.click(screen.getByRole('button',{name:'Mở ca'}));
  await waitFor(()=>expect(h.success).toHaveBeenCalledTimes(1));
  expect(h.rpc.mock.calls[0][0]).toBe('fnb_open_shift_v2');expect(h.rpc.mock.calls[0][1].p_expected_actor).toBe(h.auth.user.id);
  const raw=Object.values(localStorage).find(value=>typeof value==='string'&&value.includes('settled'));
  expect(raw).toBeTruthy();expect(raw).not.toContain('TEST_NO_SECRET');expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 });
 it('a not_found lookup never clears the pending intent or retries a mutation automatically',async()=>{
  h.rpc.mockImplementation((name,args)=>Promise.resolve(name==='fnb_get_shift_intent_v1'?{data:{status:'not_found',actor_id:args.p_expected_actor,club_id:args.p_club_id,request_id:args.p_request_id},error:null}:{data:null,error:{message:'503'}}));
  render(view());fireEvent.click(screen.getByRole('button',{name:'Mở ca'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Đối chiếu yêu cầu'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Đối chiếu yêu cầu'}));
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Chưa tìm thấy receipt'));
  expect(h.rpc.mock.calls.filter(([name])=>name==='fnb_open_shift_v2')).toHaveLength(1);expect(h.success).not.toHaveBeenCalled();
 });
 it('explicit retry checks receipt then sends only the retained request key',async()=>{
  let writes=0;h.rpc.mockImplementation((name,args)=>{
   if(name==='fnb_get_shift_intent_v1')return Promise.resolve({data:{status:'not_found',actor_id:args.p_expected_actor,club_id:args.p_club_id,request_id:args.p_request_id},error:null});
   writes++;return Promise.resolve(writes===1?{data:null,error:{message:'503'}}:{data:{status:'ok',actor_id:args.p_expected_actor,club_id:args.p_club_id,request_id:args.p_client_request_id,operation:'open',shift_id:open.id,already_open:false,opening_float_vnd:0},error:null});
  });
  render(view());fireEvent.click(screen.getByRole('button',{name:'Mở ca'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Gửi lại cùng mã'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Gửi lại cùng mã'}));await waitFor(()=>expect(h.success).toHaveBeenCalledTimes(1));
  const sent=h.rpc.mock.calls.filter(([name])=>name==='fnb_open_shift_v2');expect(sent).toHaveLength(2);expect(sent[1][1]).toEqual(sent[0][1]);
 });
 it('cancel only settles the journal after a context-bound server fence',async()=>{
  h.rpc.mockImplementation((name,args)=>Promise.resolve(name==='fnb_cancel_shift_intent_v1'?{data:{status:'cancelled',actor_id:args.p_expected_actor,club_id:args.p_club_id,request_id:args.p_request_id,operation:args.p_operation},error:null}:{data:null,error:null}));
  render(view());fireEvent.click(screen.getByRole('button',{name:'Mở ca'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Hủy yêu cầu an toàn'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Hủy yêu cầu an toàn'}));await waitFor(()=>expect(h.success).toHaveBeenCalledTimes(1));
  expect(h.success.mock.calls[0][0]).toContain('Đã hủy');expect(screen.getByRole('button',{name:'Mở ca'})).toBeEnabled();
  expect(h.rpc.mock.calls.filter(([name])=>name==='fnb_open_shift_v2')).toHaveLength(1);
 });
 it('blocks writes if durable storage fails before dispatch',async()=>{
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
  render(view());fireEvent.click(screen.getByRole('button',{name:'Mở ca'}));await act(async()=>{});
  expect(h.rpc).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
 });
 it('synchronous double-click has one writer before the React pending state renders',async()=>{
  h.rpc.mockImplementationOnce(()=>new Promise(()=>{}));render(view());const button=screen.getByRole('button',{name:'Mở ca'});
  fireEvent.click(button);fireEvent.click(button);await waitFor(()=>expect(h.rpc).toHaveBeenCalledTimes(1));
 });
 it('account changes fence old success and do not expose the old pending journal',async()=>{
  let resolve!:(value:unknown)=>void;h.rpc.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  const page=render(view());fireEvent.click(screen.getByRole('button',{name:'Mở ca'}));await waitFor(()=>expect(h.rpc).toHaveBeenCalled());
  h.auth={...h.auth,user:{id:'10000000-0000-4000-8000-000000000002'}};page.rerender(view());
  await act(async()=>resolve({data:{status:'ok'},error:null}));expect(h.success).not.toHaveBeenCalled();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 });
 it('a hung write reaches bounded recovery without allocating another request key',async()=>{
  vi.useFakeTimers();h.rpc.mockImplementation((name,args)=>name==='fnb_open_shift_v2'?new Promise(()=>{}):Promise.resolve({data:{status:'not_found',actor_id:args.p_expected_actor,club_id:args.p_club_id,request_id:args.p_request_id},error:null}));
  render(view());fireEvent.click(screen.getByRole('button',{name:'Mở ca'}));await act(async()=>{});
  await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});
  expect(screen.getByRole('button',{name:'Đối chiếu yêu cầu'})).toBeEnabled();
  expect(h.rpc.mock.calls.filter(([name])=>name==='fnb_open_shift_v2')).toHaveLength(1);expect(h.success).not.toHaveBeenCalled();
 });
 it('does not offer a close action for a shift from another club even if a read resolves successfully',()=>{
  withOpen();render(view(other));
  expect(screen.getByRole('alert')).toHaveTextContent('CLB');
  expect(screen.queryByRole('button',{name:'Chốt ca'})).not.toBeInTheDocument();expect(h.rpc).not.toHaveBeenCalled();
 });
});
