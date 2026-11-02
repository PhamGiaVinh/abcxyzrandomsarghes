import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({rpc:vi.fn(),readiness:vi.fn(),from:vi.fn(),signals:[] as AbortSignal[],
 auth:{user:{id:'owner'} as {id:string}|null,session:{access_token:'TEST'} as {access_token:string}|null,loading:false}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:f.rpc,from:f.from}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>f.auth}));
vi.mock('@/lib/feltLifecycleReadiness',async importOriginal=>({
 ...await importOriginal<typeof import('@/lib/feltLifecycleReadiness')>(),getTournamentCloseReadiness:f.readiness,
}));
import {useCloseReport} from './useCloseReport';
const ready=(amount=100)=>({ok:true,ready:true,alreadyClosed:false,blockers:[],entryCount:1,
 buyInTotal:amount,cashInTotal:amount,prizeTotal:amount,clubRevenue:0,cashierBalance:0,reconcileDelta:0,reconciled:true});
const deferred=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
beforeEach(()=>{
 vi.clearAllMocks();f.signals=[];f.auth={user:{id:'owner'},session:{access_token:'TEST'},loading:false};
 f.from.mockImplementation(()=>{const b={select:()=>b,eq:()=>b,abortSignal:(signal:AbortSignal)=>{f.signals.push(signal);return b;},then:(done:(v:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(done)};return b;});
 f.readiness.mockResolvedValue(ready());f.rpc.mockResolvedValue({data:{ok:true,outcome:'closed',report_id:'00000000-0000-4000-8000-000000000001',reconciled:true,club_revenue:0},error:null});
});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('close report scope and preflight ownership',()=>{
 it('hides old report when tournament becomes empty and ignores old reload',async()=>{
  const {result,rerender}=renderHook(({id}:{id:string|null})=>useCloseReport(id),{initialProps:{id:'A' as string|null}});
  await waitFor(()=>expect(result.current.report?.entryCount).toBe(1));const oldReload=result.current.reload;
  rerender({id:null});expect(result.current.report).toBeNull();expect(result.current.readiness).toBeNull();
  await act(async()=>{await oldReload();});expect(f.readiness).toHaveBeenCalledTimes(1);
 });
 it('does not send a close after switching tournament during readiness',async()=>{
  const {result,rerender}=renderHook(({id})=>useCloseReport(id),{initialProps:{id:'A'}});
  await waitFor(()=>expect(result.current.loading).toBe(false));const pending=deferred<ReturnType<typeof ready>>();
  f.readiness.mockReturnValueOnce(pending.promise);let completion!:ReturnType<typeof result.current.closeTournament>;
  act(()=>{completion=result.current.closeTournament();});rerender({id:'B'});
  await act(async()=>{pending.resolve(ready());await completion;});expect(f.rpc).not.toHaveBeenCalled();
  expect(await completion).toMatchObject({ok:false,error:'close_scope_changed'});
 });
 it('does not send a close after logout during readiness',async()=>{
  const {result,rerender}=renderHook(()=>useCloseReport('A'));
  await waitFor(()=>expect(result.current.loading).toBe(false));const pending=deferred<ReturnType<typeof ready>>();
  f.readiness.mockReturnValueOnce(pending.promise);let completion!:ReturnType<typeof result.current.closeTournament>;
  act(()=>{completion=result.current.closeTournament();});f.auth={user:null,session:null,loading:false};rerender();
  expect(result.current.report).toBeNull();await act(async()=>{pending.resolve(ready());await completion;});
  expect(f.rpc).not.toHaveBeenCalled();expect(result.current.error).toBe('AUTH_REQUIRED');
 });
 it('coalesces neither duplicate close nor a second writer during preflight',async()=>{
  const {result}=renderHook(()=>useCloseReport('A'));await waitFor(()=>expect(result.current.loading).toBe(false));
  const pending=deferred<ReturnType<typeof ready>>();f.readiness.mockReturnValueOnce(pending.promise);
  let first!:ReturnType<typeof result.current.closeTournament>;act(()=>{first=result.current.closeTournament();});
  expect(await result.current.closeTournament()).toMatchObject({ok:false,error:'close_in_progress'});
  await act(async()=>{pending.resolve(ready());await first;});expect(f.rpc).toHaveBeenCalledTimes(1);
 });
 it('does not mark B closed when an already-sent A writer finishes late',async()=>{
  const {result,rerender}=renderHook(({id})=>useCloseReport(id),{initialProps:{id:'A'}});
  await waitFor(()=>expect(result.current.loading).toBe(false));const pending=deferred<{data:{ok:boolean};error:null}>();
  f.rpc.mockReturnValueOnce(pending.promise);let completion!:ReturnType<typeof result.current.closeTournament>;
  act(()=>{completion=result.current.closeTournament();});await waitFor(()=>expect(f.rpc).toHaveBeenCalledTimes(1));
  rerender({id:'B'});await waitFor(()=>expect(result.current.loading).toBe(false));
  await act(async()=>{pending.resolve({data:{ok:true},error:null});await completion;});
  expect(result.current.alreadyClosed).toBe(false);expect(await completion).toMatchObject({ok:false,error:'close_scope_changed'});
 });
 it('returns unknown outcome without retry when the sent writer rejects',async()=>{
  const {result}=renderHook(()=>useCloseReport('A'));await waitFor(()=>expect(result.current.loading).toBe(false));
  f.rpc.mockRejectedValueOnce(new Error('fetch failed'));let outcome:unknown;
  await act(async()=>{outcome=await result.current.closeTournament();});
  expect(outcome).toMatchObject({ok:false});expect(f.rpc).toHaveBeenCalledTimes(1);expect(result.current.alreadyClosed).toBe(false);
 });
 it('refuses a retained close callback after logout without any new read or writer',async()=>{
  const {result,rerender}=renderHook(()=>useCloseReport('A'));await waitFor(()=>expect(result.current.loading).toBe(false));
  const oldClose=result.current.closeTournament;f.auth={user:null,session:null,loading:false};rerender();
  await act(async()=>{expect(await oldClose()).toMatchObject({ok:false,error:'close_scope_changed'});});
  expect(f.readiness).toHaveBeenCalledTimes(1);expect(f.rpc).not.toHaveBeenCalled();
 });
});

it.each(['registrations','readiness'])('bounds a hung report %s read and ignores its late response',async(kind)=>{
 const pending=deferred<ReturnType<typeof ready>>(),rows=deferred<{data:never[];error:null}>();
 if(kind==='readiness')f.readiness.mockReturnValueOnce(pending.promise);
 else f.from.mockImplementation((table:string)=>{const b={select:()=>b,eq:()=>b,abortSignal:(signal:AbortSignal)=>{f.signals.push(signal);return b;},then:(done:(v:unknown)=>unknown)=> (table==='tournament_registrations'?rows.promise:Promise.resolve({data:[],error:null})).then(done)};return b;});
 vi.useFakeTimers();const {result}=renderHook(()=>useCloseReport('A'));
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 expect(result.current.loading).toBe(false);expect(result.current.error).toBeTruthy();expect(result.current.report).toBeNull();
 expect(f.signals.length).toBe(2);expect(f.signals.every(s=>s.aborted)).toBe(true);
 await act(async()=>{pending.resolve(ready());rows.resolve({data:[],error:null});});expect(result.current.report).toBeNull();expect(result.current.error).toBeTruthy();expect(f.rpc).not.toHaveBeenCalled();
 await act(async()=>{await result.current.reload();});expect(result.current.error).toBeNull();expect(result.current.report?.entryCount).toBe(1);
});
it('bounds close readiness preflight without sending or retrying the writer',async()=>{
 const {result}=renderHook(()=>useCloseReport('A'));await waitFor(()=>expect(result.current.loading).toBe(false));
 vi.useFakeTimers();f.readiness.mockReturnValueOnce(new Promise(()=>{}));let outcome:unknown;
 act(()=>{void result.current.closeTournament().then(value=>{outcome=value;});});
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 expect(outcome).toMatchObject({ok:false});expect(f.rpc).not.toHaveBeenCalled();expect(result.current.error).toBeTruthy();expect(result.current.report).toBeNull();
});
it('aborts owned report reads when the component retires',()=>{
 f.readiness.mockReturnValue(new Promise(()=>{}));const {unmount}=renderHook(()=>useCloseReport('A'));unmount();
 expect(f.signals.length).toBe(2);expect(f.signals.every(s=>s.aborted)).toBe(true);
});
it('does not fabricate an empty report from malformed successful rows',async()=>{
 f.from.mockImplementation(()=>{const b={select:()=>b,eq:()=>b,abortSignal:(signal:AbortSignal)=>{f.signals.push(signal);return b;},then:(done:(v:unknown)=>unknown)=>Promise.resolve({data:null,error:null}).then(done)};return b;});
 const {result}=renderHook(()=>useCloseReport('A'));await waitFor(()=>expect(result.current.loading).toBe(false));
 expect(result.current.report).toBeNull();expect(result.current.error).toBeTruthy();
});

it('refuses a late same-scope preflight after an explicit report reload supersedes it',async()=>{
 const {result}=renderHook(()=>useCloseReport('A'));await waitFor(()=>expect(result.current.loading).toBe(false));
 const pending=deferred<ReturnType<typeof ready>>();f.readiness.mockReturnValueOnce(pending.promise);let completion!:ReturnType<typeof result.current.closeTournament>;
 act(()=>{completion=result.current.closeTournament();});await act(async()=>{await result.current.reload();});
 await act(async()=>{pending.resolve(ready());await completion;});
 expect(await completion).toMatchObject({ok:false,error:'close_scope_changed'});expect(f.rpc).not.toHaveBeenCalled();
});
it.each(['reject','transport-error'])('invalidates the close snapshot after an unknown writer %s outcome',async(kind)=>{
 const {result}=renderHook(()=>useCloseReport('A'));await waitFor(()=>expect(result.current.loading).toBe(false));
 if(kind==='reject')f.rpc.mockRejectedValueOnce(new Error('fetch failed'));
 else f.rpc.mockResolvedValueOnce({data:null,error:{message:'Failed to fetch'}});
 await act(async()=>{await result.current.closeTournament();});
 expect(f.rpc).toHaveBeenCalledTimes(1);expect(result.current.report).toBeNull();
 expect(result.current.readiness).toBeNull();expect(result.current.error).toContain('Không xác minh');
 await act(async()=>{await result.current.reload();});expect(result.current.report).not.toBeNull();
 expect(f.rpc).toHaveBeenCalledTimes(1);
});
it('ends a never-settling writer observation, requires verified reload, and ignores late completion',async()=>{
 const {result}=renderHook(()=>useCloseReport('A'));await waitFor(()=>expect(result.current.loading).toBe(false));
 const pending=deferred<{data:{ok:boolean};error:null}>();f.rpc.mockReturnValueOnce(pending.promise);
 vi.useFakeTimers();let outcome:unknown;
 act(()=>{void result.current.closeTournament().then(value=>{outcome=value;});});
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 expect(outcome).toMatchObject({ok:false});expect(result.current.error).toContain('Không xác minh');
 expect(result.current.report).toBeNull();expect(f.rpc).toHaveBeenCalledTimes(1);
 await act(async()=>{expect(await result.current.closeTournament()).toMatchObject({ok:false});});
 expect(f.rpc).toHaveBeenCalledTimes(1);
 await act(async()=>{await result.current.reload();});expect(result.current.report).not.toBeNull();
 await act(async()=>{pending.resolve({data:{ok:true},error:null});});
 expect(result.current.alreadyClosed).toBe(false);expect(f.rpc).toHaveBeenCalledTimes(1);
});
it('keeps unknown close blocked after a failed reload and permits it only after verified reload',async()=>{
 const {result}=renderHook(()=>useCloseReport('A'));await waitFor(()=>expect(result.current.loading).toBe(false));
 f.rpc.mockRejectedValueOnce(new Error('lost response'));
 await act(async()=>{await result.current.closeTournament();});
 f.readiness.mockRejectedValueOnce(new Error('read failed'));
 await act(async()=>{await result.current.reload();});
 await act(async()=>{expect(await result.current.closeTournament()).toMatchObject({ok:false});});
 expect(f.rpc).toHaveBeenCalledTimes(1);
 await act(async()=>{await result.current.reload();});
 await act(async()=>{expect(await result.current.closeTournament()).toMatchObject({ok:true});});
 expect(f.rpc).toHaveBeenCalledTimes(2);
});
it('does not overwrite another tournament when an old writer observation expires',async()=>{
 const {result,rerender}=renderHook(({id})=>useCloseReport(id),{initialProps:{id:'A'}});
 await waitFor(()=>expect(result.current.loading).toBe(false));f.rpc.mockReturnValueOnce(new Promise(()=>{}));
 vi.useFakeTimers();act(()=>{void result.current.closeTournament();});await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
 rerender({id:'B'});await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 expect(result.current.report).not.toBeNull();expect(result.current.error).toBeNull();expect(result.current.alreadyClosed).toBe(false);
 expect(f.rpc).toHaveBeenCalledTimes(1);
});
it.each([
 {ok:true},
 {ok:'true',outcome:'closed',report_id:'00000000-0000-4000-8000-000000000001',reconciled:true,club_revenue:0},
 {ok:true,outcome:'unexpected',report_id:'00000000-0000-4000-8000-000000000001',reconciled:true,club_revenue:0},
 {ok:true,outcome:'closed',report_id:'bad-report',reconciled:true,club_revenue:0},
 {ok:true,outcome:'closed',report_id:'00000000-0000-4000-8000-000000000001',reconciled:'true',club_revenue:0},
 {ok:true,outcome:'closed',report_id:'00000000-0000-4000-8000-000000000001',reconciled:true,club_revenue:Infinity},
])('does not declare close success for an unverified receipt %j',async(data)=>{
 const {result}=renderHook(()=>useCloseReport('A'));await waitFor(()=>expect(result.current.loading).toBe(false));
 f.rpc.mockResolvedValueOnce({data,error:null});let outcome:unknown;
 await act(async()=>{outcome=await result.current.closeTournament();});
 expect(outcome).toMatchObject({ok:false});expect(result.current.alreadyClosed).toBe(false);
 expect(result.current.report).toBeNull();expect(result.current.error).toContain('Không xác minh');
 expect(f.rpc).toHaveBeenCalledTimes(1);
});
it.each(['closed','already_closed'])('accepts the actual %s receipt contract without clamping negative recorded revenue',async(outcome)=>{
 const {result}=renderHook(()=>useCloseReport('A'));await waitFor(()=>expect(result.current.loading).toBe(false));
 f.rpc.mockResolvedValueOnce({data:{ok:true,outcome,report_id:'00000000-0000-4000-8000-000000000001',reconciled:false,club_revenue:-100},error:null});
 let value:unknown;await act(async()=>{value=await result.current.closeTournament();});
 expect(value).toEqual({ok:true,reconciled:false,clubRevenue:-100});expect(result.current.alreadyClosed).toBe(true);
 expect(result.current.error).toBeNull();expect(f.rpc).toHaveBeenCalledTimes(1);
});

it.each([['buy_in',null],['total_pay',null],['buy_in',''],['total_pay',false],['buy_in',9007199254740992],['total_pay',Infinity]] as const)('rejects invalid close registration money %s=%s',async(field,value)=>{
 f.from.mockImplementation((table:string)=>{const b={select:()=>b,eq:()=>b,abortSignal:()=>b,then:(done:(v:unknown)=>unknown)=>Promise.resolve({data:table==='tournament_registrations'?[{buy_in:100000,total_pay:115000,reference_code:'CASH_TEST',status:'confirmed',[field]:value}]:[],error:null}).then(done)};return b;});
 const {result}=renderHook(()=>useCloseReport('A'));await waitFor(()=>expect(result.current.loading).toBe(false));
 expect(result.current.report).toBeNull();expect(result.current.error).toBeTruthy();expect(f.rpc).not.toHaveBeenCalled();
});
it.each([['prize',''],['prize',false],['prize',undefined],['prize',Infinity],['position',null]] as const)('rejects malformed recorded elimination %s=%s',async(field,value)=>{
 f.from.mockImplementation((table:string)=>{const b={select:()=>b,eq:()=>b,abortSignal:()=>b,then:(done:(v:unknown)=>unknown)=>Promise.resolve({data:table==='tournament_eliminations'?[{position:1,prize:0,[field]:value}]:[],error:null}).then(done)};return b;});
 const {result}=renderHook(()=>useCloseReport('A'));await waitFor(()=>expect(result.current.loading).toBe(false));
 expect(result.current.report).toBeNull();expect(result.current.error).toBeTruthy();expect(f.rpc).not.toHaveBeenCalled();
});
it.each([null,'0','12.5',0])('retains canonical nullable/zero/numeric prize handling %s',async(prize)=>{
 f.from.mockImplementation((table:string)=>{const b={select:()=>b,eq:()=>b,abortSignal:()=>b,then:(done:(v:unknown)=>unknown)=>Promise.resolve({data:table==='tournament_registrations'?[{buy_in:'100000',total_pay:'115000',reference_code:'CASH_TEST',status:'confirmed'}]:[{position:1,prize}],error:null}).then(done)};return b;});
 const {result}=renderHook(()=>useCloseReport('A'));await waitFor(()=>expect(result.current.loading).toBe(false));
 expect(result.current.report).not.toBeNull();expect(result.current.error).toBeNull();expect(f.rpc).not.toHaveBeenCalled();
});

it('recovers an invalid close-money read only through an explicit fresh canonical reload',async()=>{
 let valid=false;
 f.from.mockImplementation((table:string)=>{const b={select:()=>b,eq:()=>b,abortSignal:()=>b,then:(done:(v:unknown)=>unknown)=>Promise.resolve({data:table==='tournament_registrations'?[{buy_in:valid?0:null,total_pay:0,reference_code:'CASH_TEST',status:'confirmed'}]:[],error:null}).then(done)};return b;});
 const {result}=renderHook(()=>useCloseReport('A'));await waitFor(()=>expect(result.current.loading).toBe(false));
 expect(result.current.report).toBeNull();expect(result.current.error).toBeTruthy();
 valid=true;f.readiness.mockResolvedValue(ready(0));await act(async()=>{await result.current.reload();});
 expect(result.current.error).toBeNull();expect(result.current.report?.cashInTotal).toBe(0);
 expect(result.current.report?.bySource.offline).toBe(1);expect(f.rpc).not.toHaveBeenCalled();
});
