import {act,cleanup,renderHook} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {PropsWithChildren} from 'react';
const f=vi.hoisted(()=>({rpc:vi.fn(),success:vi.fn(),error:vi.fn(),auth:{user:{id:'owner-test'},session:{access_token:'LOCAL_TEST_A'},loading:false,isClubOwner:true}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>f.auth}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>f.rpc(...args)}}));
vi.mock('sonner',()=>({toast:{success:f.success,error:f.error}}));
import {useRecordClubExpense} from './useClubExpenses';
const clients:QueryClient[]=[];
const input={category:'misc' as const,amountVnd:10000,incurredAt:'2026-10-31T12:00:00+07:00',description:'LOCAL TEST expense',paymentStatus:'unpaid' as const,paymentSource:null};
const receipt={status:'ok',expense_id:'11111111-1111-4111-8111-111111111111',idempotent:false};
function mount(club='club-test'){const client=new QueryClient({defaultOptions:{mutations:{retry:false}}});clients.push(client);return renderHook(({club:activeClub,from}:{club:string;from:string}={club,from:'2026-10-01'})=>useRecordClubExpense('live',activeClub,from,'2026-11-01'),{initialProps:{club,from:'2026-10-01'},wrapper:({children}:PropsWithChildren)=><QueryClientProvider client={client}>{children}</QueryClientProvider>});}
beforeEach(()=>{sessionStorage.clear();f.rpc.mockReset();f.success.mockReset();f.error.mockReset();f.auth={user:{id:'owner-test'},session:{access_token:'LOCAL_TEST_A'},loading:false,isClubOwner:true};});
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());vi.useRealTimers();vi.restoreAllMocks();});
it.each([null,{}, {status:'ok'}, {...receipt,expense_id:null},{...receipt,idempotent:'false'}])('does not announce unverified expense write %j as success',async(data)=>{
 f.rpc.mockResolvedValue({data,error:null});const v=mount();await act(async()=>{await expect(v.result.current.mutateAsync(input)).rejects.toThrow();});expect(f.success).not.toHaveBeenCalled();
});
it('retains the request identity after a lost response and permits a fresh identical expense only after confirmation',async()=>{
 f.rpc.mockResolvedValueOnce({data:null,error:Error('connection lost')}).mockResolvedValue({data:receipt,error:null});const v=mount();await act(async()=>{await expect(v.result.current.mutateAsync(input)).rejects.toThrow();});await act(async()=>{await v.result.current.mutateAsync(input);});
 const keys=f.rpc.mock.calls.map(c=>c[1].p_idempotency_key);expect(keys[1]).toBe(keys[0]);await act(async()=>{await v.result.current.mutateAsync(input);});expect(f.rpc.mock.calls[2][1].p_idempotency_key).not.toBe(keys[0]);
});
it('retains an uncertain request through remount and restores its draft',async()=>{
 f.rpc.mockResolvedValueOnce({data:null,error:Error('lost')}).mockResolvedValue({data:receipt,error:null});const v=mount();await act(async()=>{await expect(v.result.current.mutateAsync(input)).rejects.toThrow();});v.unmount();const next=mount();expect((next.result.current as any).pendingInput).toEqual(input);await act(async()=>{await next.result.current.mutateAsync(input);});expect(f.rpc.mock.calls[1][1].p_idempotency_key).toBe(f.rpc.mock.calls[0][1].p_idempotency_key);
});
it('does not issue a changed expense while its previous outcome is unknown',async()=>{
 f.rpc.mockResolvedValue({data:null,error:Error('lost')});const v=mount();await act(async()=>{await expect(v.result.current.mutateAsync(input)).rejects.toThrow();await expect(v.result.current.mutateAsync({...input,amountVnd:20000})).rejects.toThrow();});expect(f.rpc).toHaveBeenCalledTimes(1);
});
it('does not send a captured mutation after the actor session changed',async()=>{
 const v=mount(),old=v.result.current.mutateAsync;f.auth={...f.auth,session:{access_token:'LOCAL_TEST_B'}};v.rerender();await act(async()=>{await expect(old(input)).rejects.toThrow();});expect(f.rpc).not.toHaveBeenCalled();
});
it('does not announce a late old-session write result in the new session',async()=>{
 let resolve!:(v:unknown)=>void;f.rpc.mockReturnValueOnce(new Promise(r=>{resolve=r;}));const v=mount();let operation!:Promise<unknown>;await act(async()=>{operation=v.result.current.mutateAsync(input).catch(e=>e);});f.auth={...f.auth,session:{access_token:'LOCAL_TEST_B'}};v.rerender();await act(async()=>{resolve({data:receipt,error:null});await operation;});expect(f.success).not.toHaveBeenCalled();
});
it('does not release the first write lock when rejecting repeated clicks',async()=>{
 let resolve!:(v:unknown)=>void;f.rpc.mockReturnValueOnce(new Promise(r=>{resolve=r;}));const v=mount();let first!:Promise<unknown>;await act(async()=>{first=v.result.current.mutateAsync(input);});
 await act(async()=>{await expect(v.result.current.mutateAsync(input)).rejects.toThrow();await expect(v.result.current.mutateAsync(input)).rejects.toThrow();});expect(f.rpc).toHaveBeenCalledTimes(1);await act(async()=>{resolve({data:receipt,error:null});await first;});
});
it('bounds a stalled write, never automatically retries, and preserves its identity for explicit retry',async()=>{
 vi.useFakeTimers();f.rpc.mockReturnValueOnce(new Promise(()=>{})).mockResolvedValue({data:receipt,error:null});const v=mount();let result!:Promise<unknown>;await act(async()=>{result=v.result.current.mutateAsync(input).catch(e=>e);});await act(async()=>vi.advanceTimersByTimeAsync(20001));expect(await result).toBeInstanceOf(Error);expect(f.rpc).toHaveBeenCalledTimes(1);await act(async()=>{await v.result.current.mutateAsync(input);});expect(f.rpc.mock.calls[1][1].p_idempotency_key).toBe(f.rpc.mock.calls[0][1].p_idempotency_key);
});
it('releases a fresh explicitly rejected intent so the operator can correct input',async()=>{
 f.rpc.mockResolvedValueOnce({data:{error:'INVALID_INPUT'},error:null}).mockResolvedValue({data:receipt,error:null});const v=mount();await act(async()=>{await expect(v.result.current.mutateAsync(input)).rejects.toThrow('INVALID_INPUT');await v.result.current.mutateAsync({...input,description:'corrected'});});expect(f.rpc.mock.calls[1][1].p_idempotency_key).not.toBe(f.rpc.mock.calls[0][1].p_idempotency_key);
});
it('does not discard an earlier unknown outcome when a later retry is forbidden',async()=>{
 f.rpc.mockResolvedValueOnce({data:null,error:Error('lost')}).mockResolvedValueOnce({data:null,error:{code:'42501',message:'forbidden'}}).mockResolvedValue({data:receipt,error:null});const v=mount();await act(async()=>{await expect(v.result.current.mutateAsync(input)).rejects.toThrow();await expect(v.result.current.mutateAsync(input)).rejects.toThrow();await v.result.current.mutateAsync(input);});expect(new Set(f.rpc.mock.calls.map(c=>c[1].p_idempotency_key)).size).toBe(1);
});
it('does not treat a contradictory success and error packet as a definite rollback',async()=>{
 f.rpc.mockResolvedValueOnce({data:{...receipt,error:'NETWORK_ERROR'},error:null}).mockResolvedValue({data:receipt,error:null});const v=mount();await act(async()=>{await expect(v.result.current.mutateAsync(input)).rejects.toThrow();await v.result.current.mutateAsync(input);});expect(f.rpc.mock.calls[1][1].p_idempotency_key).toBe(f.rpc.mock.calls[0][1].p_idempotency_key);
});
it('refuses to write when durable request storage fails',async()=>{
 const v=mount();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('storage unavailable');});await act(async()=>{await expect(v.result.current.mutateAsync(input)).rejects.toThrow();});expect(f.rpc).not.toHaveBeenCalled();
});
it('does not overwrite a corrupted pending request journal',async()=>{
 sessionStorage.setItem('vinpoker:expense-record:v1:owner-test:club-test','broken');const v=mount();await act(async()=>{await expect(v.result.current.mutateAsync(input)).rejects.toThrow();});expect(f.rpc).not.toHaveBeenCalled();expect(sessionStorage.getItem('vinpoker:expense-record:v1:owner-test:club-test')).toBe('broken');
});
it('uses an already pending request from another mounted expense form',async()=>{
 const first=mount(),second=mount();f.rpc.mockResolvedValueOnce({data:null,error:Error('lost')}).mockResolvedValue({data:receipt,error:null});await act(async()=>{await expect(first.result.current.mutateAsync(input)).rejects.toThrow();await second.result.current.mutateAsync(input);});expect(f.rpc.mock.calls[1][1].p_idempotency_key).toBe(f.rpc.mock.calls[0][1].p_idempotency_key);
});
it('accepts both confirmed receipts when two mounted forms share the same pending request',async()=>{
 const first=mount(),second=mount();let finishFirst!:(v:unknown)=>void,finishSecond!:(v:unknown)=>void;
 f.rpc.mockReturnValueOnce(new Promise(r=>{finishFirst=r;})).mockReturnValueOnce(new Promise(r=>{finishSecond=r;}));let a!:Promise<unknown>,b!:Promise<unknown>;
 await act(async()=>{a=first.result.current.mutateAsync(input).catch(e=>e);b=second.result.current.mutateAsync(input).catch(e=>e);});expect(f.rpc).toHaveBeenCalledTimes(2);expect(f.rpc.mock.calls[1][1].p_idempotency_key).toBe(f.rpc.mock.calls[0][1].p_idempotency_key);
 await act(async()=>{finishFirst({data:receipt,error:null});await a;finishSecond({data:{...receipt,idempotent:true},error:null});await b;});expect(await a).not.toBeInstanceOf(Error);expect(await b).not.toBeInstanceOf(Error);
});
it.each([{club:'other-club',from:'2026-10-01'},{club:'club-test',from:'2026-09-01'}])('refuses a captured write after report scope changes to %j',async(next)=>{
 const v=mount(),old=v.result.current.mutateAsync;v.rerender(next);await act(async()=>{await expect(old(input)).rejects.toThrow();});expect(f.rpc).not.toHaveBeenCalled();
});
it('does not carry the prior actor pending draft or request identity into another actor',async()=>{
 f.rpc.mockResolvedValueOnce({data:null,error:Error('lost')}).mockResolvedValue({data:receipt,error:null});const v=mount();await act(async()=>{await expect(v.result.current.mutateAsync(input)).rejects.toThrow();});f.auth={...f.auth,user:{id:'other-owner'}};v.rerender();expect(v.result.current.pendingInput).toBeNull();await act(async()=>{await v.result.current.mutateAsync(input);});expect(f.rpc.mock.calls[1][1].p_idempotency_key).not.toBe(f.rpc.mock.calls[0][1].p_idempotency_key);expect(sessionStorage.getItem('vinpoker:expense-record:v1:owner-test:club-test')).not.toBeNull();
});
it.skipIf(!process.env.VINPOKER_EXPENSE_RECORD_NATIVE_RUNTIME)('retries the actual committed native expense once after a withheld response and client remount',async()=>{
 const runtime=process.env.VINPOKER_EXPENSE_RECORD_NATIVE_RUNTIME!;
 const fs=await import('node:fs');const {execFileSync}=await import('node:child_process');
 const bridge=`import fs from 'node:fs';import {pathToFileURL} from 'node:url';const root=process.argv[1],c=await import(pathToFileURL(root+'report-owner-ft-native-context-20261031.mjs').href),p=await import(pathToFileURL(root+'main-live-native-context-20261031.mjs').href),q=JSON.parse(fs.readFileSync(0,'utf8'));let r;if(q.action==='context')r={guard:c.guard,ownerAuth:c.auth(q.actor)};else if(q.action==='protected'){p.assertOriginalProtected();r=true;}else if(q.action==='read')r=c.read(q.query);else if(q.action==='sql')r=JSON.parse(c.sql(q.query));else throw Error('Unexpected native action');process.stdout.write(JSON.stringify(r));`;
 const native=(action:string,query='',actor='')=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',bridge,runtime],{input:JSON.stringify({action,query,actor}),encoding:'utf8',timeout:30000}));
 const file='D:/Quy trình/output/reports/report-expense-record-native-concurrency-20261031.json';const journal=JSON.parse(fs.readFileSync(file,'utf8')),fixture=journal.fixture;
 expect(journal.phase).toBe('QUALIFIED_NATIVE_EXPENSE_SAME_KEY_CONCURRENT_INSERT_ONCE');expect(journal.hookRetryStarted).toBeUndefined();journal.hookRetryStarted=true;const save=()=>fs.writeFileSync(file,JSON.stringify(journal,null,2));save();
 const {guard,ownerAuth}=native('context','',fixture.owner);f.auth={...f.auth,user:{id:fixture.owner}};
 const facts=()=>native('read',`SELECT jsonb_build_object('count',(SELECT count(*) FROM public.club_expenses WHERE club_id='${fixture.club}'),'total',(SELECT sum(amount_vnd) FROM public.club_expenses WHERE club_id='${fixture.club}'),'otherExpenses',(SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]')::text) FROM public.club_expenses e WHERE club_id<>'${fixture.club}'));`);
 const before=facts();native('protected');let drop=true;const keys:string[]=[],receipts:unknown[]=[];
 const literal=(v:unknown)=>v==null?'NULL':"'"+String(v).replace(/'/g,"''")+"'";
 f.rpc.mockImplementation((name,args)=>{
  expect(name).toBe('record_club_expense');expect(args.p_club_id).toBe(fixture.club);keys.push(args.p_idempotency_key);journal.hookRequestKeys=keys;save();
  const receipt=native('sql',`BEGIN;${guard}${ownerAuth}SELECT public.record_club_expense(p_club_id=>${literal(args.p_club_id)},p_category=>${literal(args.p_category)},p_amount_vnd=>${args.p_amount_vnd},p_incurred_at=>${literal(args.p_incurred_at)},p_description=>${literal(args.p_description)},p_payment_status=>${literal(args.p_payment_status)},p_payment_source=>${literal(args.p_payment_source)},p_adjusts_id=>NULL,p_idempotency_key=>${literal(args.p_idempotency_key)});COMMIT;`);receipts.push(receipt);
  if(drop){drop=false;return Promise.resolve({data:null,error:Error('LOCAL_TEST_RESPONSE_WITHHELD_AFTER_NATIVE_COMMIT')});}return Promise.resolve({data:receipt,error:null});
 });
 try{
  const first=mount(fixture.club);await act(async()=>{await expect(first.result.current.mutateAsync(input)).rejects.toThrow();});expect(facts().count).toBe(before.count+1);expect(f.success).not.toHaveBeenCalled();first.unmount();
  const retry=mount(fixture.club);expect(retry.result.current.pendingInput).toEqual(input);await act(async()=>{await retry.result.current.mutateAsync(input);});expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);expect((receipts[1] as any).idempotent).toBe(true);expect((receipts[1] as any).expense_id).toBe((receipts[0] as any).expense_id);expect(f.success).toHaveBeenCalledTimes(1);
  const after=facts();expect(after.count).toBe(before.count+1);expect(after.total).toBe(before.total+10000);expect(after.otherExpenses).toBe(before.otherExpenses);native('protected');
  const finance=native('sql',`BEGIN READ ONLY;${guard}${ownerAuth}SELECT public.get_club_finance_summary_v2('2026-10-31','2026-10-31','${fixture.club}');ROLLBACK;`);expect(finance.cost.clubExpenses).toBe(after.total);expect(finance.net).toBe(-after.total);
  journal.hookRetry={pass:true,keys,receipts,before,after,finance,remountRestoredDraft:true,withheldResponseAfterActualCommit:true,deliveryFaultModelled:true,hostedNetwork:false};journal.phase='QUALIFIED_NATIVE_EXPENSE_CONCURRENCY_AND_CLIENT_POST_COMMIT_RETRY';save();
 }catch(error){journal.hookError=String(error);save();throw error;}
},30000);
