import {createElement,type ReactNode} from 'react';
import {act,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,describe,it,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({rpc:vi.fn(),auth:{user:{id:'actor-a'},session:{access_token:'TEST_SESSION_A'},loading:false,isAdmin:false}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>fixture.auth}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>({abortSignal:()=>fixture.rpc(...args)})}}));
import {useFinanceSummaryRpcOnly} from './useFinanceSummaryRpcOnly';
const packet=(net=0)=>({revenue:{total:0,rake:0,stakingFees:0,payoutFees:0},cost:{payrollNet:0,payrollGross:0,adjustments:0},net});
function wrapper(client:QueryClient){return ({children}:{children:ReactNode})=>createElement(QueryClientProvider,{client},children);}
describe('accountant finance RPC read integrity',()=>{
 beforeEach(()=>{fixture.rpc.mockReset();fixture.auth={user:{id:'actor-a'},session:{access_token:'TEST_SESSION_A'},loading:false,isAdmin:false};});
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
   .mockReturnValueOnce(new Promise(()=>{})).mockResolvedValueOnce({data:packet(3),error:null});
  const client=new QueryClient();const {result,rerender,unmount}=renderHook(({club})=>useFinanceSummaryRpcOnly(club,'2026-10-01','2026-10-14'),{initialProps:{club:'club-a'},wrapper:wrapper(client)});
  await waitFor(()=>expect(fixture.rpc).toHaveBeenCalledTimes(1));
  rerender({club:'club-b'});await waitFor(()=>expect(fixture.rpc).toHaveBeenCalledTimes(2));
  rerender({club:'club-a'});
  await waitFor(()=>expect(fixture.rpc).toHaveBeenCalledTimes(3));
  await waitFor(()=>expect(result.current.data?.net).toBe(3));
  await act(async()=>resolveOld({data:packet(99),error:null}));
  expect(result.current.data?.net).toBe(3);unmount();client.clear();
 });
});
