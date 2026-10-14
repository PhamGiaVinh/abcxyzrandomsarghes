import {act,renderHook,waitFor} from '@testing-library/react';
import {beforeEach,describe,it,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({
 auth:{user:{id:'owner-a'},session:{access_token:'TEST_SESSION_A'},isAdmin:true,loading:false},
 rpc:vi.fn(),from:vi.fn(),
}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>fixture.auth}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:fixture.rpc,from:fixture.from}}));
import {useClubFinanceSummary} from './useClubFinanceSummary';

function packet(net=0) {
 return {revenue:{stakingFees:0,payoutFees:0,rake:0,total:0},
  cost:{payrollNet:0,payrollGross:0,adjustments:0},net,
  statusTotals:{},unpaidTotal:0,reconciledTotal:0,
  aging:{d0_30:0,d31_60:0,d61_90:0,d90p:0},trend:[],perPeriod:[],perClub:[],
  clubs:[{id:'club-a',name:'Club TEST'}]};
}
function deferred(){let resolve!:(value:unknown)=>void;const promise=new Promise(resolvePromise=>{resolve=resolvePromise;});return {promise,resolve};}
const scope={from:'2026-10-01',to:'2026-10-14',clubFilter:'all'};
describe('finance read integrity',()=>{
 beforeEach(()=>{fixture.rpc.mockReset();fixture.from.mockReset();fixture.from.mockImplementation(()=>{throw new Error('client fallback forbidden');});
  fixture.auth={user:{id:'owner-a'},session:{access_token:'TEST_SESSION_A'},isAdmin:true,loading:false};});
 it('rejects a successful RPC with null headline instead of publishing zero',async()=>{
  fixture.rpc.mockResolvedValue({data:{...packet(),net:null},error:null});
  const {result}=renderHook(()=>useClubFinanceSummary(scope));
  await waitFor(()=>expect(result.current.loading).toBe(false));
  expect(result.current.summary).toBeNull();expect(result.current.error).toBeTruthy();
 });
 it('preserves nonempty canonical detail rows without recalculating balances',async()=>{
  const data={...packet(-3),trend:[{key:'2026-10',revenue:10,cost:13}],
   perPeriod:[{id:'period-test',clubId:'club-a',clubName:'Club TEST',periodKey:'2026-10',gross:15,net:13,status:'draft'}],
   perClub:[{clubId:'club-a',name:'Club TEST',revenue:10,cost:13,net:-3}]};
  fixture.rpc.mockResolvedValue({data,error:null});
  const {result}=renderHook(()=>useClubFinanceSummary(scope));
  await waitFor(()=>expect(result.current.loading).toBe(false));
  expect(result.current.error).toBeNull();expect(result.current.summary?.trend).toEqual(data.trend);
  expect(result.current.summary?.perPeriod).toEqual(data.perPeriod);
  expect(result.current.summary?.perClub).toEqual(data.perClub);expect(result.current.summary?.net).toBe(-3);
 });
 it('rejects malformed detail values instead of silently dropping their rows',async()=>{
  fixture.rpc.mockResolvedValue({data:{...packet(),trend:[{key:'2026-10',revenue:null,cost:0}]},error:null});
  const {result}=renderHook(()=>useClubFinanceSummary(scope));
  await waitFor(()=>expect(result.current.loading).toBe(false));
  expect(result.current.summary).toBeNull();expect(result.current.error).toContain('FINANCE_SUMMARY_INVALID');
 });
 it('does not scan broad tables after RPC permission denial',async()=>{
  fixture.rpc.mockResolvedValue({data:null,error:{code:'42501',message:'forbidden'}});
  const {result}=renderHook(()=>useClubFinanceSummary(scope));
  await waitFor(()=>expect(result.current.loading).toBe(false));
  expect(fixture.from).not.toHaveBeenCalled();expect(result.current.summary).toBeNull();
  expect(result.current.error).toBe('forbidden');
 });
 it('does not let an old range overwrite a newer successful range',async()=>{
  const old=deferred(),fresh=deferred();fixture.rpc.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const {result,rerender}=renderHook(props=>useClubFinanceSummary(props),{initialProps:scope});
  rerender({...scope,to:'2026-10-15'});
  await act(async()=>fresh.resolve({data:packet(2),error:null}));
  await waitFor(()=>expect(result.current.summary?.net).toBe(2));
  await act(async()=>old.resolve({data:packet(99),error:null}));
  expect(result.current.summary?.net).toBe(2);
 });
 it('masks previous scope immediately while the new club loads',async()=>{
  fixture.rpc.mockResolvedValueOnce({data:packet(7),error:null}).mockReturnValueOnce(new Promise(()=>{}));
  const {result,rerender}=renderHook(props=>useClubFinanceSummary(props),{initialProps:scope});
  await waitFor(()=>expect(result.current.summary?.net).toBe(7));
  rerender({...scope,clubFilter:'club-b'});
  expect(result.current.summary).toBeNull();expect(result.current.clubs).toEqual([]);
 });
 it('loads again for a different actor with the same role and filters',async()=>{
  fixture.rpc.mockResolvedValueOnce({data:packet(7),error:null}).mockReturnValueOnce(new Promise(()=>{}));
  const {result,rerender}=renderHook(()=>useClubFinanceSummary(scope));
  await waitFor(()=>expect(result.current.summary?.net).toBe(7));
  fixture.auth={...fixture.auth,user:{id:'owner-b'},session:{access_token:'TEST_SESSION_B'}};
  rerender();expect(result.current.summary).toBeNull();
  await waitFor(()=>expect(fixture.rpc).toHaveBeenCalledTimes(2));
 });
 it('rejects old responses after A to B to A rather than matching only the final scope string',async()=>{
  const old=deferred(),middle=deferred(),fresh=deferred();
  fixture.rpc.mockReturnValueOnce(old.promise).mockReturnValueOnce(middle.promise).mockReturnValueOnce(fresh.promise);
  const {result,rerender}=renderHook(props=>useClubFinanceSummary(props),{initialProps:scope});
  rerender({...scope,clubFilter:'club-b'});rerender(scope);
  await act(async()=>fresh.resolve({data:packet(3),error:null}));
  await act(async()=>old.resolve({data:packet(99),error:null}));
  await act(async()=>middle.resolve({data:null,error:{message:'old error'}}));
  expect(result.current.summary?.net).toBe(3);expect(result.current.error).toBeNull();
 });
 it('fences an older token response without storing a token in the returned state',async()=>{
  const old=deferred(),fresh=deferred();fixture.rpc.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const {result,rerender}=renderHook(()=>useClubFinanceSummary(scope));
  fixture.auth={...fixture.auth,session:{access_token:'TEST_SESSION_REFRESH'}};rerender();
  await act(async()=>fresh.resolve({data:packet(4),error:null}));
  await act(async()=>old.resolve({data:packet(99),error:null}));
  expect(result.current.summary?.net).toBe(4);
  expect(JSON.stringify(result.current)).not.toContain('TEST_SESSION');
 });
 it('ignores a retained reload callback from an old scope',async()=>{
  const old=deferred(),fresh=deferred();fixture.rpc.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const {result,rerender}=renderHook(props=>useClubFinanceSummary(props),{initialProps:scope});
  const oldReload=result.current.reload;rerender({...scope,clubFilter:'club-b'});
  await act(async()=>oldReload());expect(fixture.rpc).toHaveBeenCalledTimes(2);
  await act(async()=>fresh.resolve({data:packet(5),error:null}));
  expect(result.current.summary?.net).toBe(5);
 });
});
