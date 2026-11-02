import {createElement,type ReactNode} from 'react';
import {act,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,describe,it,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({rpc:vi.fn(),auth:{user:{id:'actor-a'},session:{access_token:'TEST_SESSION_A'},loading:false,isAdmin:false}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>fixture.auth}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>({abortSignal:()=>fixture.rpc(...args)})}}));
import {useFinanceSummaryRpcOnly} from './useFinanceSummaryRpcOnly';
const packet=(net=0,clubId='club-test')=>({fromDate:'2026-10-01',toDate:'2026-10-14',clubId,timeZone:'Asia/Ho_Chi_Minh',periodEndExclusive:true,
 periodFrom:'2026-10-01T00:00:00+07:00',periodTo:'2026-10-15T00:00:00+07:00',
 revenue:{total:0,rake:0,stakingFees:0,payoutFees:0},cost:{payrollNet:0,payrollGross:0,adjustments:0},net});
function wrapper(client:QueryClient){return ({children}:{children:ReactNode})=>createElement(QueryClientProvider,{client},children);}
describe('accountant finance RPC read integrity',()=>{
 beforeEach(()=>{fixture.rpc.mockReset();fixture.auth={user:{id:'actor-a'},session:{access_token:'TEST_SESSION_A'},loading:false,isAdmin:false};});
 it('retains canonical current staff balances without adding them to booked payroll',async()=>{
  fixture.rpc.mockResolvedValue({data:{...packet(-100000),staffLive:{scope:'current_outstanding',timeZone:'Asia/Ho_Chi_Minh',asOf:'2026-10-31T11:00:00Z',ftPeriod:'2026-10',ftProvisionalGross:200000,ftProvisionalNet:180000,ptUnpaidBalance:11152}},error:null});
  const client=new QueryClient();const {result,unmount}=renderHook(()=>useFinanceSummaryRpcOnly('club-test','2026-10-01','2026-10-14'),{wrapper:wrapper(client)});
  await waitFor(()=>expect(result.current.isSuccess).toBe(true));expect(result.current.data?.staffLive?.ftProvisionalNet).toBe(180000);expect(result.current.data?.net).toBe(-100000);unmount();client.clear();
 });
 it('does not publish a malformed success as a zero balance or retry it',async()=>{
  fixture.rpc.mockResolvedValue({data:{...packet(),net:null},error:null});
  const client=new QueryClient();const {result,unmount}=renderHook(()=>useFinanceSummaryRpcOnly('club-test','2026-10-01','2026-10-14'),{wrapper:wrapper(client)});
  await waitFor(()=>expect(result.current.isError).toBe(true));expect(result.current.data).toBeUndefined();
  expect(fixture.rpc).toHaveBeenCalledTimes(1);unmount();client.clear();
 });
 it('uses distinct actor/session cache keys and never stores the bearer token in them',async()=>{
  fixture.rpc.mockResolvedValueOnce({data:packet(7),error:null}).mockReturnValueOnce(new Promise(()=>{}));
  const client=new QueryClient();const {result,rerender,unmount}=renderHook(()=>useFinanceSummaryRpcOnly('club-test','2026-10-01','2026-10-14'),{wrapper:wrapper(client)});
  await waitFor(()=>expect(result.current.data?.net).toBe(7));
  fixture.auth={...fixture.auth,user:{id:'actor-b'},session:{access_token:'TEST_SESSION_B'}};
  act(()=>rerender());expect(result.current.data).toBeUndefined();
  await waitFor(()=>expect(fixture.rpc).toHaveBeenCalledTimes(2));
  expect(JSON.stringify(client.getQueryCache().getAll().map(query=>query.queryKey))).not.toContain('TEST_SESSION');
  unmount();client.clear();
 });
 it('hides cached balances while auth is loading and refuses old or disabled refetches',async()=>{
  fixture.rpc.mockResolvedValue({data:packet(7),error:null});
  const client=new QueryClient();const {result,rerender,unmount}=renderHook(()=>useFinanceSummaryRpcOnly('club-test','2026-10-01','2026-10-14'),{wrapper:wrapper(client)});
  await waitFor(()=>expect(result.current.data?.net).toBe(7));
  const previousRefetch=result.current.refetch;
  fixture.auth={...fixture.auth,loading:true};act(()=>rerender());
  expect(result.current.data).toBeUndefined();
  expect(result.current.isLoading).toBe(true);
  await expect(previousRefetch()).rejects.toThrow('AUTH_REQUIRED');
  await expect(result.current.refetch()).rejects.toThrow('AUTH_REQUIRED');
  expect(fixture.rpc).toHaveBeenCalledTimes(1);unmount();client.clear();
 });
 it('starts a fresh read when returning to a scope whose previous read is still pending',async()=>{
  let resolveOld!:(value:unknown)=>void;
  fixture.rpc.mockReturnValueOnce(new Promise(resolve=>{resolveOld=resolve;}))
   .mockReturnValueOnce(new Promise(()=>{})).mockResolvedValueOnce({data:packet(3,'club-a'),error:null});
  const client=new QueryClient();const {result,rerender,unmount}=renderHook(({club})=>useFinanceSummaryRpcOnly(club,'2026-10-01','2026-10-14'),{initialProps:{club:'club-a'},wrapper:wrapper(client)});
  await waitFor(()=>expect(fixture.rpc).toHaveBeenCalledTimes(1));
  rerender({club:'club-b'});await waitFor(()=>expect(fixture.rpc).toHaveBeenCalledTimes(2));
  rerender({club:'club-a'});
  await waitFor(()=>expect(fixture.rpc).toHaveBeenCalledTimes(3));
  await waitFor(()=>expect(result.current.data?.net).toBe(3));
  await act(async()=>resolveOld({data:packet(99),error:null}));
 expect(result.current.data?.net).toBe(3);unmount();client.clear();
 });
 it('uses only the date-based v2 contract for the selected club',async()=>{
  fixture.rpc.mockResolvedValue({data:packet(7),error:null});
  const client=new QueryClient();const {result,unmount}=renderHook(()=>useFinanceSummaryRpcOnly('club-test','2026-10-01','2026-10-14'),{wrapper:wrapper(client)});
  await waitFor(()=>expect(result.current.data?.net).toBe(7));
  expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('get_club_finance_summary_v2',{p_from_date:'2026-10-01',p_to_date:'2026-10-14',p_club_id:'club-test'});
  unmount();client.clear();
 });
 it('rejects a result belonging to another club instead of caching its balance',async()=>{
  fixture.rpc.mockResolvedValue({data:packet(99,'club-other'),error:null});
  const client=new QueryClient();const {result,unmount}=renderHook(()=>useFinanceSummaryRpcOnly('club-test','2026-10-01','2026-10-14'),{wrapper:wrapper(client)});
  await waitFor(()=>expect(result.current.isError).toBe(true));expect(result.current.data).toBeUndefined();
  expect(fixture.rpc).toHaveBeenCalledTimes(1);unmount();client.clear();
 });
 it('rejects invalid calendar dates before requesting the server',async()=>{
  fixture.rpc.mockResolvedValue({data:packet(),error:null});
  const client=new QueryClient();const {result,unmount}=renderHook(()=>useFinanceSummaryRpcOnly('club-test','2026-02-30','2026-03-01'),{wrapper:wrapper(client)});
  await waitFor(()=>expect(result.current.isError).toBe(true));expect(fixture.rpc).not.toHaveBeenCalled();
  unmount();client.clear();
 });

 it('updates a visible accountant summary when a different device changes the canonical totals',async()=>{
  vi.useFakeTimers();fixture.rpc.mockResolvedValue({data:packet(7),error:null});const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const v=renderHook(()=>useFinanceSummaryRpcOnly('club-test','2026-10-01','2026-10-14'),{wrapper:wrapper(client)});
  try{await act(async()=>vi.advanceTimersByTimeAsync(1));expect(v.result.current.data?.net).toBe(7);
   fixture.rpc.mockResolvedValue({data:packet(9),error:null});await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(v.result.current.data?.net).toBe(9);
  }finally{v.unmount();client.clear();vi.useRealTimers();}
 });
 it('recovers a hung accountant read without accepting the late stale result',async()=>{
  vi.useFakeTimers();let release!:(value:unknown)=>void;
  fixture.rpc.mockReturnValueOnce(new Promise(resolve=>{release=resolve;})).mockResolvedValue({data:packet(9),error:null});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const view=renderHook(()=>useFinanceSummaryRpcOnly('club-test','2026-10-01','2026-10-14'),{wrapper:wrapper(client)});
  try{
   await act(async()=>vi.advanceTimersByTimeAsync(16001));
   expect(fixture.rpc.mock.calls.length).toBeGreaterThan(1);expect(view.result.current.data?.net).toBe(9);
   await act(async()=>release({data:packet(99),error:null}));expect(view.result.current.data?.net).toBe(9);
  }finally{view.unmount();client.clear();vi.useRealTimers();}
 });});

it('propagates current dealer FT and PT estimates through the accountant read adapter',async()=>{
 vi.useRealTimers();fixture.rpc.mockReset();fixture.auth={user:{id:'actor-ft'},session:{access_token:'TEST_SESSION_FT'},loading:false,isAdmin:false};fixture.rpc.mockResolvedValue({data:{...packet(-100000),dealerLive:{scope:'current_outstanding',timeZone:'Asia/Ho_Chi_Minh',asOf:'2026-11-01T01:40:00Z',ptActiveUnfinalizedBalance:1207,ptFinalizedUnpaidBalance:2500,ptTotalUnpaid:3707},dealerFtLive:{scope:'current_month_provisional',timeZone:'Asia/Ho_Chi_Minh',asOf:'2026-11-01T01:40:00Z',period:'2026-11',gross:461538,net:413077}},error:null});
 const client=new QueryClient();const {result,unmount}=renderHook(()=>useFinanceSummaryRpcOnly('club-test','2026-10-01','2026-10-14'),{wrapper:wrapper(client)});await waitFor(()=>expect(result.current.isSuccess).toBe(true));expect(result.current.data?.dealerLive?.ptTotalUnpaid).toBe(3707);expect(result.current.data?.dealerFtLive?.net).toBe(413077);expect(result.current.data?.net).toBe(-100000);unmount();client.clear();
});
