import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {PropsWithChildren} from 'react';
const f=vi.hoisted(()=>({rpc:vi.fn(),auth:{user:{id:'owner-a'},session:{access_token:'TEST_EXPENSE_A'},loading:false,isAdmin:false,isClubAdmin:false}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>f.auth}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>f.rpc(...args)}}));
import {useClubExpenses} from './useClubExpenses';
const from='2026-09-30T17:00:00.000Z',to='2026-10-31T17:00:00.000Z';
const packet=(amount=1000)=>({club_id:'club-test',from,to,rows:[{id:'expense-test',category:'misc',amount_vnd:amount,description:null,incurred_at:'2026-10-15T12:00:00+07:00',payment_status:'paid',payment_source:'cash'}],total_vnd:amount,paid_vnd:amount,unpaid_vnd:0,by_category:{misc:amount}});
const clients:QueryClient[]=[];
function mount(club='club-test',start=from,end=to){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);return renderHook(()=>useClubExpenses('live',club,start,end),{wrapper:({children}:PropsWithChildren)=><QueryClientProvider client={client}>{children}</QueryClientProvider>});}
beforeEach(()=>{f.rpc.mockReset();f.auth={user:{id:'owner-a'},session:{access_token:'TEST_EXPENSE_A'},loading:false,isAdmin:false,isClubAdmin:false};});
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());vi.useRealTimers();});
it.each([null,{error:'forbidden'}, {...packet(),total_vnd:null}, {...packet(),club_id:'other-club'}, {...packet(),total_vnd:999}])('rejects unavailable, malformed, wrong scope or inconsistent expense evidence %j',async(data)=>{
 f.rpc.mockResolvedValue({data,error:null});const v=mount();await waitFor(()=>expect(v.result.current.isFetching).toBe(false));expect(v.result.current.isError).toBe(true);expect(v.result.current.data).toBeUndefined();
});
it('automatically observes expenses recorded by another operator',async()=>{
 vi.useFakeTimers();f.rpc.mockResolvedValue({data:packet(),error:null});const v=mount();await act(async()=>vi.advanceTimersByTimeAsync(1));expect(v.result.current.data?.totalVnd).toBe(1000);
 f.rpc.mockResolvedValue({data:packet(2000),error:null});await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(v.result.current.data?.totalVnd).toBe(2000);
});
it('masks the previous session cache and refuses its captured refetch',async()=>{
 f.rpc.mockResolvedValueOnce({data:packet(),error:null}).mockReturnValueOnce(new Promise(()=>{}));const v=mount();await waitFor(()=>expect(v.result.current.isSuccess).toBe(true));const old=v.result.current.refetch;
 f.auth={...f.auth,session:{access_token:'TEST_EXPENSE_B'}};v.rerender();expect(v.result.current.data).toBeUndefined();await expect(old()).rejects.toThrow();
});
it('bounds a hung read and recovers automatically',async()=>{
 vi.useFakeTimers();f.rpc.mockReturnValueOnce(new Promise(()=>{})).mockResolvedValue({data:packet(),error:null});const v=mount();await act(async()=>vi.advanceTimersByTimeAsync(10001));expect(v.result.current.isError).toBe(true);expect(v.result.current.data).toBeUndefined();
 await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(v.result.current.data?.totalVnd).toBe(1000);
});
it('does not expose retained successful totals when a subsequent read is denied',async()=>{
 f.rpc.mockResolvedValueOnce({data:packet(),error:null});const v=mount();await waitFor(()=>expect(v.result.current.isSuccess).toBe(true));f.rpc.mockResolvedValueOnce({data:null,error:Error('forbidden')});await act(async()=>{await v.result.current.refetch();});await waitFor(()=>expect(v.result.current.isError).toBe(true));expect(v.result.current.data).toBeUndefined();
});
it('retains signed credit adjustments and binds rows to the verified packet club',async()=>{
 f.rpc.mockResolvedValue({data:packet(-250),error:null});const v=mount();await waitFor(()=>expect(v.result.current.isSuccess).toBe(true));expect(v.result.current.data?.totalVnd).toBe(-250);expect(v.result.current.data?.rows[0].clubId).toBe('club-test');
});
it.each([
 {...packet(),paid_vnd:999},
 {...packet(),by_category:{misc:999}},
 {...packet(),rows:[packet().rows[0],packet().rows[0]],total_vnd:2000,paid_vnd:2000,by_category:{misc:2000}},
 {...packet(),rows:[{...packet().rows[0],amount_vnd:0.5}]},
 {...packet(),rows:[{...packet().rows[0],incurred_at:to}]},
 {...packet(),rows:[{...packet().rows[0],club_id:'other-club'}]},
 {...packet(),from:'2026-10-01T00:00:00Z'},
])('rejects unsafe row, date, category or paid subtotal evidence %j',async(data)=>{
 f.rpc.mockResolvedValue({data,error:null});const v=mount();await waitFor(()=>expect(v.result.current.isError).toBe(true));expect(v.result.current.data).toBeUndefined();
});
it('does not publish a previous session response arriving after reauthentication',async()=>{
 let resolve!:(v:unknown)=>void;f.rpc.mockReturnValueOnce(new Promise(r=>{resolve=r;}));const v=mount();await waitFor(()=>expect(f.rpc).toHaveBeenCalledTimes(1));
 f.auth={...f.auth,session:{access_token:'TEST_EXPENSE_NEW'}};f.rpc.mockResolvedValue({data:packet(2000),error:null});v.rerender();await waitFor(()=>expect(v.result.current.data?.totalVnd).toBe(2000));await act(async()=>{resolve({data:packet(9999),error:null});});expect(v.result.current.data?.totalVnd).toBe(2000);
});
it.skipIf(!process.env.VINPOKER_EXPENSE_NATIVE_RUNTIME)('observes native PostgreSQL expense and linked credit on automatic refresh with exact rollback',async()=>{
 const runtime=process.env.VINPOKER_EXPENSE_NATIVE_RUNTIME!;
 const {randomUUID}=await import('node:crypto');const {execFileSync}=await import('node:child_process');
 // Native Node owns WSL/psql; Vitest's module loader cannot resolve this external Windows runtime.
 const bridge=`import fs from 'node:fs';import {pathToFileURL} from 'node:url';const root=process.argv[1],c=await import(pathToFileURL(root+'report-owner-ft-native-context-20261031.mjs').href),p=await import(pathToFileURL(root+'main-live-native-context-20261031.mjs').href),q=JSON.parse(fs.readFileSync(0,'utf8'));let r;if(q.action==='context'){const f=JSON.parse(fs.readFileSync(c.path,'utf8')).fixture;r={fixture:f,guard:c.guard,ownerAuth:c.auth(f.owner)};}else if(q.action==='protected'){p.assertOriginalProtected();r=true;}else if(q.action==='read')r=c.read(q.query);else if(q.action==='sql')r=JSON.parse(c.sql(q.query));else throw Error('Unexpected native action');process.stdout.write(JSON.stringify(r));`;
 const native=(action:string,query='')=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',bridge,runtime],{input:JSON.stringify({action,query}),encoding:'utf8',timeout:30000}));
 const {fixture,guard,ownerAuth}=native('context');const read=(q:string)=>native('read',q),sql=(q:string)=>native('sql',q),assertOriginalProtected=()=>native('protected');
 f.auth={...f.auth,user:{id:fixture.owner}};
 const hash=()=>read("SELECT to_jsonb(md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]')::text)) FROM public.club_expenses e;");
 const before=hash();let includeCredit=false;const key1=randomUUID(),key2=randomUUID();
 f.rpc.mockImplementation((name,args)=>{
  expect(name).toBe('get_club_expenses');expect(args.p_club_id).toBe(fixture.club);
  const seed=includeCredit?`CREATE TEMP TABLE expense_base ON COMMIT DROP AS SELECT public.record_club_expense(p_club_id=>'${fixture.club}',p_category=>'misc',p_amount_vnd=>10000,p_incurred_at=>clock_timestamp(),p_description=>'LOCAL TEST hook original',p_payment_status=>'unpaid',p_payment_source=>NULL,p_adjusts_id=>NULL,p_idempotency_key=>'${key1}') AS result;
DO $$ DECLARE r jsonb;BEGIN ASSERT(SELECT result->>'status' FROM expense_base)='ok';r:=public.record_club_expense(p_club_id=>'${fixture.club}',p_category=>'misc',p_amount_vnd=>-10000,p_incurred_at=>clock_timestamp(),p_description=>'LOCAL TEST hook linked credit',p_payment_status=>'unpaid',p_payment_source=>NULL,p_adjusts_id=>(SELECT(result->>'expense_id')::uuid FROM expense_base),p_idempotency_key=>'${key2}');ASSERT r->>'status'='ok';END $$;`:'';
  return Promise.resolve({data:sql(`BEGIN;${guard}${ownerAuth}${seed}SELECT public.get_club_expenses('${fixture.club}','${args.p_from}','${args.p_to}');ROLLBACK;`),error:null});
 });
 try{const v=mount(fixture.club,'2026-10-01T00:00:00+07:00','2026-11-01T00:00:00+07:00');await waitFor(()=>expect(v.result.current.isSuccess).toBe(true));const initial=v.result.current.data!.rows.length;
 includeCredit=true;await waitFor(()=>expect(v.result.current.data?.rows.length).toBe(initial+2),{timeout:8000});expect(v.result.current.data!.rows.some(r=>r.amountVnd===-10000)).toBe(true);expect(v.result.current.data!.rows.every(r=>r.clubId===fixture.club)).toBe(true);expect(v.result.current.data!.totalVnd).toBe(0);
 }finally{expect(hash()).toBe(before);assertOriginalProtected();}
},20000);
