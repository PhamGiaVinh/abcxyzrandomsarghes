import {act,cleanup,renderHook} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {PropsWithChildren} from 'react';
const f=vi.hoisted(()=>({rpc:vi.fn(),success:vi.fn(),error:vi.fn(),auth:{user:{id:'owner'},session:{access_token:'TEST_SALARY_A'},loading:false,isClubOwner:true}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>f.auth}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>f.rpc(...args)}}));
vi.mock('sonner',()=>({toast:{success:f.success,error:f.error,info:vi.fn()}}));
import {useSalaryActions} from './useStaffSalary';
const clients:QueryClient[]=[];
const runId='11111111-1111-4111-8111-111111111111';
const saved={club_id:'club',period_year:2026,period_month:10,header:{status:'approved'},rows:[{id:runId,staff_id:'staff',full_name:'TEST',department:'service',employment_type:'full_time',gross_vnd:10000,net_vnd:10000,manual_bhxh_vnd:0,manual_tax_vnd:0,status:'locked'}],total_gross_vnd:10000,total_net_vnd:10000};
const receipts={chot:{status:'ok',club_id:'club',period_year:2026,period_month:10,locked_now:1,total_net_vnd:10000},submit:{status:'submitted',club_id:'club',period_year:2026,period_month:10,runs:1},approve:{status:'approved',club_id:'club',period_year:2026,period_month:10,approved_at:'2026-10-31T12:00:00+07:00'},reject:{status:'rejected',reason:'TEST reason'},markPaid:{status:'paid',run_id:runId,paid_at:'2026-10-31T12:00:00+07:00'}};
type Action=keyof typeof receipts;const names:Action[]=['chot','submit','approve','reject','markPaid'];
const args=(name:Action):any=>name==='markPaid'?runId:name==='reject'?'TEST reason':undefined;
function mount(club='club',year=2026,month=10){const c=new QueryClient({defaultOptions:{mutations:{retry:false}}});clients.push(c);return renderHook(()=>useSalaryActions('live',club,year,month),{wrapper:({children}:PropsWithChildren)=><QueryClientProvider client={c}>{children}</QueryClientProvider>});}
beforeEach(()=>{f.rpc.mockReset();f.success.mockReset();f.error.mockReset();f.auth={user:{id:'owner'},session:{access_token:'TEST_SALARY_A'},loading:false,isClubOwner:true};});
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());vi.useRealTimers();});
it.each(names)('does not announce null %s mutation data as success',async(name)=>{
 f.rpc.mockImplementation(fn=>Promise.resolve({data:fn==='get_staff_salary_report'?saved:null,error:null}));const v=mount();await act(async()=>{await expect((v.result.current[name].mutateAsync as any)(args(name))).rejects.toThrow();});expect(f.success).not.toHaveBeenCalled();
});
it.each(names)('accepts the actual canonical %s receipt contract',async(name)=>{
 f.rpc.mockImplementation(fn=>Promise.resolve({data:fn==='get_staff_salary_report'?saved:receipts[name],error:null}));const v=mount();await act(async()=>{await (v.result.current[name].mutateAsync as any)(args(name));});expect(f.success).toHaveBeenCalledTimes(1);
});
it.each(names)('refuses captured %s action after a session change',async(name)=>{
 const v=mount(),old=v.result.current[name].mutateAsync;f.auth={...f.auth,session:{access_token:'TEST_SALARY_B'}};v.rerender();await act(async()=>{await expect((old as any)(args(name))).rejects.toThrow();});expect(f.rpc).not.toHaveBeenCalled();
});
it('does not publish a late old-session salary approval result',async()=>{
 let resolve!:(v:unknown)=>void;f.rpc.mockReturnValueOnce(new Promise(r=>{resolve=r;}));const v=mount();let result!:Promise<unknown>;await act(async()=>{result=v.result.current.approve.mutateAsync().catch(e=>e);});f.auth={...f.auth,session:{access_token:'TEST_SALARY_B'}};v.rerender();await act(async()=>{resolve({data:receipts.approve,error:null});await result;});expect(f.success).not.toHaveBeenCalled();
});
it('does not mark a run from outside the selected club and period',async()=>{
 f.rpc.mockResolvedValue({data:{...saved,rows:[]},error:null});const v=mount();await act(async()=>{await expect(v.result.current.markPaid.mutateAsync(runId)).rejects.toThrow();});expect(f.rpc.mock.calls.some(c=>c[0]==='mark_staff_salary_paid')).toBe(false);
});
it.each(['voided','locked'])('does not call a %s idempotent response a paid salary',async(status)=>{
 f.rpc.mockImplementation(fn=>Promise.resolve({data:fn==='get_staff_salary_report'?saved:{status,run_id:runId,idempotent:true},error:null}));const v=mount();await act(async()=>{await expect(v.result.current.markPaid.mutateAsync(runId)).rejects.toThrow();});expect(f.success).not.toHaveBeenCalled();
});
it('rejects an approval receipt echoing another club',async()=>{
 f.rpc.mockResolvedValue({data:{...receipts.approve,club_id:'other'},error:null});const v=mount();await act(async()=>{await expect(v.result.current.approve.mutateAsync()).rejects.toThrow();});expect(f.success).not.toHaveBeenCalled();
});
it('recognizes an already approved submit instead of claiming a new submission',async()=>{
 f.rpc.mockResolvedValue({data:{status:'approved',idempotent:true},error:null});const v=mount();await act(async()=>{await v.result.current.submit.mutateAsync(undefined);});expect(f.success).toHaveBeenCalledWith('Bảng lương đã được duyệt.');
});
it('accepts the short canonical already-approved receipt',async()=>{
 f.rpc.mockResolvedValue({data:{status:'approved',idempotent:true},error:null});const v=mount();await act(async()=>{await v.result.current.approve.mutateAsync();});expect(f.success).toHaveBeenCalledTimes(1);
});
it('accepts the short canonical already-paid receipt for the exact run',async()=>{
 f.rpc.mockImplementation(fn=>Promise.resolve({data:fn==='get_staff_salary_report'?saved:{status:'paid',run_id:runId,idempotent:true},error:null}));const v=mount();await act(async()=>{await v.result.current.markPaid.mutateAsync(runId);});expect(f.success).toHaveBeenCalledTimes(1);
});
it.each([{...saved,club_id:'other'},{...saved,period_year:2027},{...saved,period_month:11},{...saved,header:{status:'submitted'}}])('refuses payment on an unverified or unapproved report %j',async(data)=>{
 f.rpc.mockResolvedValue({data,error:null});const v=mount();await act(async()=>{await expect(v.result.current.markPaid.mutateAsync(runId)).rejects.toThrow();});expect(f.rpc.mock.calls.some(c=>c[0]==='mark_staff_salary_paid')).toBe(false);
});
it('does not issue another action while an approval is still in flight',async()=>{
 let resolve!:(v:unknown)=>void;f.rpc.mockReturnValueOnce(new Promise(r=>{resolve=r;}));const v=mount();let result!:Promise<unknown>;await act(async()=>{result=v.result.current.approve.mutateAsync();});await act(async()=>{await expect(v.result.current.reject.mutateAsync('TEST reason')).rejects.toThrow();await expect(v.result.current.chot.mutateAsync()).rejects.toThrow();});expect(f.rpc).toHaveBeenCalledTimes(1);await act(async()=>{resolve({data:receipts.approve,error:null});await result;});
});
it('bounds a stalled mutation without automatically resending it',async()=>{
 vi.useFakeTimers();f.rpc.mockReturnValueOnce(new Promise(()=>{}));const v=mount();let result!:Promise<unknown>;await act(async()=>{result=v.result.current.chot.mutateAsync().catch(e=>e);});await act(async()=>vi.advanceTimersByTimeAsync(20001));expect(await result).toBeInstanceOf(Error);expect(f.rpc).toHaveBeenCalledTimes(1);expect(f.success).not.toHaveBeenCalled();
});
it('times out the payment pre-read without ever sending a payment intent',async()=>{
 vi.useFakeTimers();f.rpc.mockReturnValueOnce(new Promise(()=>{}));const v=mount();let result!:Promise<unknown>;await act(async()=>{result=v.result.current.markPaid.mutateAsync(runId).catch(e=>e);});await act(async()=>vi.advanceTimersByTimeAsync(10001));expect(await result).toBeInstanceOf(Error);expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(['get_staff_salary_report']);
});
it('ignores a captured fire-and-forget action after session replacement',()=>{
 const v=mount(),old=v.result.current.chot.mutate;f.auth={...f.auth,session:{access_token:'TEST_SALARY_B'}};v.rerender();expect(()=>old()).not.toThrow();expect(f.rpc).not.toHaveBeenCalled();
});
it('does not send a payment after its pre-read completes in an abandoned session',async()=>{
 let resolve!:(v:unknown)=>void;f.rpc.mockReturnValueOnce(new Promise(r=>{resolve=r;}));const v=mount();let result!:Promise<unknown>;await act(async()=>{result=v.result.current.markPaid.mutateAsync(runId).catch(e=>e);});f.auth={...f.auth,session:{access_token:'TEST_SALARY_NEW'}};v.rerender();await act(async()=>{resolve({data:saved,error:null});await result;});expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(['get_staff_salary_report']);expect(f.success).not.toHaveBeenCalled();
});
it('does not send a second payment intent for a PT month summary of daily cash already paid',async()=>{
 f.rpc.mockImplementation(fn=>Promise.resolve({data:fn==='get_staff_salary_report'?{...saved,rows:[{...saved.rows[0],employment_type:'part_time'}]}:receipts.markPaid,error:null}));const v=mount();await act(async()=>{await expect(v.result.current.markPaid.mutateAsync(runId)).rejects.toThrow();});expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(['get_staff_salary_report']);expect(f.success).not.toHaveBeenCalled();
});
it.skipIf(!process.env.VINPOKER_STAFF_NATIVE_ACTION_REPORT)('consumes the exact captured canonical native workflow and idempotent receipt shapes',async()=>{
 const fs=await import('node:fs');const native=JSON.parse(fs.readFileSync(process.env.VINPOKER_STAFF_NATIVE_ACTION_REPORT!,'utf8'));expect(native.rollbackExact).toBe(true);const s=Object.fromEntries(native.stages.map((x:any)=>[x.stage,x.data])) as Record<string,any>;
 const cases:[Action,string,unknown][]=[['chot','chot',undefined],['submit','submit',undefined],['reject','reject','LOCAL TEST reject'],['approve','approve',undefined],['markPaid','paid',s.paid.run_id],['approve','approveAgain',undefined],['submit','submitApproved',undefined],['markPaid','paidAgain',s.paid.run_id],['chot','chotAgain',undefined]];
 for(const [action,stage,arg] of cases){f.rpc.mockReset();f.success.mockClear();f.auth={...f.auth,user:{id:native.fixture.owner}};f.rpc.mockImplementation(fn=>Promise.resolve({data:fn==='get_staff_salary_report'?(stage==='paidAgain'?s.paidReport:s.beforePaid):s[stage],error:null}));const v=mount(native.fixture.club,s.saved.period_year,s.saved.period_month);await act(async()=>{await (v.result.current[action].mutateAsync as any)(arg);});expect(f.success).toHaveBeenCalledTimes(1);v.unmount();}
});
it('re-reads an already paid FT run after an unknown payment outcome and a remount',async()=>{
 vi.useFakeTimers();let committed=false;let writes=0;
 f.rpc.mockImplementation(fn=>{
  if(fn==='get_staff_salary_report')return Promise.resolve({data:{...saved,rows:[{...saved.rows[0],status:committed?'paid':'locked'}]},error:null});
  if(fn==='mark_staff_salary_paid'){
   if(!committed){committed=true;writes++;return new Promise(()=>{});}
   return Promise.resolve({data:{status:'paid',run_id:runId,idempotent:true},error:null});
  }
  throw Error('unexpected RPC');
 });
 const first=mount();let outcome!:Promise<unknown>;
 await act(async()=>{outcome=first.result.current.markPaid.mutateAsync(runId).catch(e=>e);});
 await act(async()=>vi.advanceTimersByTimeAsync(20001));
 expect(await outcome).toBeInstanceOf(Error);expect(f.success).not.toHaveBeenCalled();
 first.unmount();const second=mount();
 await act(async()=>{await second.result.current.markPaid.mutateAsync(runId);});
 expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(['get_staff_salary_report','mark_staff_salary_paid','get_staff_salary_report','mark_staff_salary_paid']);
 expect(writes).toBe(1);expect(f.success).toHaveBeenCalledTimes(1);
});
