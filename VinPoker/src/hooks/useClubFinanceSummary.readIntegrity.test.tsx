import {act,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({
 auth:{user:{id:'owner-a'},session:{access_token:'TEST_SESSION_A'},isAdmin:true,loading:false},
 rpc:vi.fn(),from:vi.fn(),
}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>fixture.auth}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:fixture.rpc,from:fixture.from}}));
import {useClubFinanceSummary} from './useClubFinanceSummary';

function packet(net=0,q=scope) {
 return {fromDate:q.from,toDate:q.to,clubId:q.clubFilter==='all'?null:q.clubFilter,
  timeZone:'Asia/Ho_Chi_Minh',periodEndExclusive:true,periodFrom:q.from+'T00:00:00+07:00',
  periodTo:new Date(Date.parse(q.to+'T00:00:00+07:00')+86400000).toISOString(),
  revenue:{stakingFees:0,payoutFees:0,rake:0,total:0},
  cost:{payrollNet:0,payrollGross:0,adjustments:0},net,
  statusTotals:{},unpaidTotal:0,reconciledTotal:0,
  aging:{d0_30:0,d31_60:0,d61_90:0,d90p:0},trend:[],perPeriod:[],perClub:[],
  clubs:[{id:'club-a',name:'Club TEST'}]};
}
function deferred(){let resolve!:(value:unknown)=>void;const promise=new Promise(resolvePromise=>{resolve=resolvePromise;});return {promise,resolve};}
const scope={from:'2026-10-01',to:'2026-10-14',clubFilter:'all'};
describe('finance read integrity',()=>{
 it('keeps a late successful read hidden after logout and recovers only with the next session',async()=>{
  const stale=deferred();fixture.rpc.mockResolvedValueOnce({data:packet(7),error:null}).mockReturnValueOnce(stale.promise);
  const {result,rerender,unmount}=renderHook(()=>useClubFinanceSummary(scope));
  await waitFor(()=>expect(result.current.summary?.net).toBe(7));
  let pending!:Promise<void>;act(()=>{pending=result.current.reload();});
  fixture.auth={...fixture.auth,user:null,session:null} as unknown as typeof fixture.auth;
  rerender();expect(result.current.summary).toBeNull();expect(result.current.clubs).toEqual([]);
  await act(async()=>{stale.resolve({data:packet(999),error:null});await pending;});
  expect(result.current.summary).toBeNull();expect(result.current.error).toBe('AUTH_REQUIRED');
  expect(fixture.rpc).toHaveBeenCalledTimes(2);
  fixture.rpc.mockResolvedValueOnce({data:packet(12),error:null});
  fixture.auth={user:{id:'owner-b'},session:{access_token:'TEST_SESSION_B'},isAdmin:true,loading:false};rerender();
  await waitFor(()=>expect(result.current.summary?.net).toBe(12));
  expect(result.current.error).toBeNull();unmount();
 });
 it('masks verified money during auth revalidation and rejects the previous pending response',async()=>{
  const stale=deferred();fixture.rpc.mockResolvedValueOnce({data:packet(7),error:null}).mockReturnValueOnce(stale.promise);
  const {result,rerender,unmount}=renderHook(()=>useClubFinanceSummary(scope));
  await waitFor(()=>expect(result.current.summary?.net).toBe(7));
  let pending!:Promise<void>;act(()=>{pending=result.current.reload();});
  fixture.auth={...fixture.auth,loading:true};rerender();
  expect(result.current.summary).toBeNull();expect(result.current.clubs).toEqual([]);
  await act(async()=>{stale.resolve({data:packet(999),error:null});await pending;});
  expect(result.current.summary).toBeNull();expect(fixture.rpc).toHaveBeenCalledTimes(2);
  fixture.rpc.mockResolvedValueOnce({data:packet(13),error:null});
  fixture.auth={...fixture.auth,loading:false};rerender();
  await waitFor(()=>expect(result.current.summary?.net).toBe(13));unmount();
 });
 afterEach(()=>vi.useRealTimers());
 beforeEach(()=>{fixture.rpc.mockReset();fixture.from.mockReset();fixture.from.mockImplementation(()=>{throw new Error('client fallback forbidden');});
  fixture.auth={user:{id:'owner-a'},session:{access_token:'TEST_SESSION_A'},isAdmin:true,loading:false};});
 it('keeps same-scope verified totals while polling and clears them on failure',async()=>{
  vi.useFakeTimers();const pending=deferred();fixture.rpc.mockResolvedValueOnce({data:packet(100),error:null}).mockReturnValueOnce(pending.promise);
  const {result,unmount}=renderHook(()=>useClubFinanceSummary(scope));await act(async()=>{});expect(result.current.summary?.net).toBe(100);
  await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(result.current.loading).toBe(true);expect(result.current.summary?.net).toBe(100);
  await act(async()=>pending.resolve({data:null,error:{message:'LOCAL_TEST_READ_FAILED'}}));expect(result.current.summary).toBeNull();expect(result.current.error).toBe('LOCAL_TEST_READ_FAILED');
  unmount();vi.useRealTimers();
 });
 it('preserves current staff provisional balances separately from booked range totals',async()=>{
  fixture.rpc.mockResolvedValue({data:{...packet(-100000),staffLive:{scope:'current_outstanding',timeZone:'Asia/Ho_Chi_Minh',asOf:'2026-10-31T11:00:00Z',ftPeriod:'2026-10',ftProvisionalGross:200000,ftProvisionalNet:180000,ptUnpaidBalance:11152}},error:null});
  const {result,unmount}=renderHook(()=>useClubFinanceSummary(scope));await waitFor(()=>expect(result.current.loading).toBe(false));
  expect(result.current.summary?.staffLive?.ptUnpaidBalance).toBe(11152);expect(result.current.summary?.net).toBe(-100000);unmount();
 });
 it.each([0,-500])('marks explicit F&B evidence as available even for zero/refund %s',async(fnb)=>{
  const p=packet();fixture.rpc.mockResolvedValue({data:{...p,revenue:{...p.revenue,fnb},cost:{...p.cost,fnbCogs:0,compCogs:0}},error:null});
  const {result,unmount}=renderHook(()=>useClubFinanceSummary(scope));await waitFor(()=>expect(result.current.loading).toBe(false));
  expect(result.current.summary?.fnbAvailable).toBe(true);expect(result.current.summary?.revenue.fnb).toBe(fnb);unmount();
 });
 it('does not claim that an absent legacy F&B packet was verified',async()=>{
  fixture.rpc.mockResolvedValue({data:packet(),error:null});const {result,unmount}=renderHook(()=>useClubFinanceSummary(scope));
  await waitFor(()=>expect(result.current.loading).toBe(false));expect(result.current.summary?.fnbAvailable).toBe(false);unmount();
 });
 it('blocks malformed staff live evidence instead of silently omitting the staff section',async()=>{
  fixture.rpc.mockResolvedValue({data:{...packet(),staffLive:null},error:null});const {result,unmount}=renderHook(()=>useClubFinanceSummary(scope));
  await waitFor(()=>expect(result.current.loading).toBe(false));expect(result.current.summary).toBeNull();expect(result.current.error).toBeTruthy();unmount();
 });
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
  await act(async()=>fresh.resolve({data:packet(2,{...scope,to:'2026-10-15'}),error:null}));
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
  await act(async()=>fresh.resolve({data:packet(5,{...scope,clubFilter:'club-b'}),error:null}));
 expect(result.current.summary?.net).toBe(5);
 });
 it('sends calendar dates to v2 only, never browser timestamp bounds',async()=>{
  fixture.rpc.mockResolvedValue({data:packet(),error:null});
  const {result}=renderHook(()=>useClubFinanceSummary(scope));
  await waitFor(()=>expect(result.current.loading).toBe(false));
  expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('get_club_finance_summary_v2',{
   p_from_date:scope.from,p_to_date:scope.to,p_club_id:null,
  });
 });
 it.each([
  {fromDate:'2026-09-01'},{toDate:'2026-10-13'},{clubId:'other'},
  {timeZone:'UTC'},{periodEndExclusive:false},
  {periodFrom:'2026-10-01T00:00:00Z'},{periodTo:'2026-10-14T23:59:59+07:00'},
 ])('rejects a successful payload with mismatched scope %j',async(patch)=>{
  fixture.rpc.mockResolvedValue({data:{...packet(9),...patch},error:null});
  const {result}=renderHook(()=>useClubFinanceSummary(scope));
  await waitFor(()=>expect(result.current.loading).toBe(false));
  expect(result.current.summary).toBeNull();expect(result.current.error).toContain('FINANCE_SUMMARY_INVALID');
  expect(fixture.from).not.toHaveBeenCalled();
 });
 it.each([
  {from:'2026-02-30',to:'2026-03-01'}, {from:'',to:'2026-10-14'},
  {from:'2026-10-15',to:'2026-10-14'}, {from:'0000-01-01',to:'2026-10-14'},
 ])('rejects invalid calendar input before invoking any RPC %j',async(query)=>{
  fixture.rpc.mockResolvedValue({data:packet(),error:null});
  const {result}=renderHook(()=>useClubFinanceSummary({...scope,...query}));
  await waitFor(()=>expect(result.current.loading).toBe(false));
  expect(fixture.rpc).not.toHaveBeenCalled();expect(result.current.summary).toBeNull();expect(result.current.error).toBeTruthy();
 });
 it('does not fall back to the old interval API when v2 is absent',async()=>{
  fixture.rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'missing contract'}});
  const {result}=renderHook(()=>useClubFinanceSummary(scope));
  await waitFor(()=>expect(result.current.loading).toBe(false));
  expect(fixture.rpc).toHaveBeenCalledTimes(1);expect(fixture.rpc.mock.calls[0][0]).toBe('get_club_finance_summary_v2');
  expect(result.current.error).toContain('UTC+7');expect(result.current.summary).toBeNull();
 });

 it('refreshes an open owner report without a manual click and retires its poll on unmount',async()=>{
  vi.useFakeTimers();fixture.rpc.mockResolvedValue({data:packet(7),error:null});
  const view=renderHook(()=>useClubFinanceSummary(scope));
  try{await act(async()=>{});expect(view.result.current.summary?.net).toBe(7);
   fixture.rpc.mockResolvedValue({data:packet(9),error:null});
   await act(async()=>vi.advanceTimersByTimeAsync(5000));
   expect(view.result.current.summary?.net).toBe(9);expect(fixture.rpc).toHaveBeenCalledTimes(2);
   view.unmount();await act(async()=>vi.advanceTimersByTimeAsync(10000));expect(fixture.rpc).toHaveBeenCalledTimes(2);
  }finally{view.unmount();vi.useRealTimers();}
 });

 it('recovers a hung report read without letting its late result replace the new totals',async()=>{
  vi.useFakeTimers();const old=deferred();fixture.rpc.mockReturnValueOnce(old.promise).mockResolvedValue({data:packet(9),error:null});
  const v=renderHook(()=>useClubFinanceSummary(scope));
  try{await act(async()=>vi.advanceTimersByTimeAsync(10001));expect(v.result.current.summary?.net).toBe(9);
   await act(async()=>old.resolve({data:packet(99),error:null}));expect(v.result.current.summary?.net).toBe(9);
  }finally{v.unmount();vi.useRealTimers();}
 });

 it.each([6000,9000])('accepts consecutive %sms reads slower than the poll without starving totals',async(latency)=>{
  vi.useFakeTimers();let active=0,peak=0,sequence=0;
  fixture.rpc.mockImplementation(()=>{const value=++sequence;active++;peak=Math.max(peak,active);
   return new Promise(resolve=>setTimeout(()=>{active--;resolve({data:packet(value*100),error:null});},latency));});
  const view=renderHook(()=>useClubFinanceSummary(scope));
  try{for(let cycle=1;cycle<=6;cycle++){
    await act(async()=>vi.advanceTimersByTimeAsync(latency));
    expect(view.result.current.summary?.net).toBe(cycle*100);
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.loading).toBe(false);
    expect(peak).toBe(1);
    if(cycle<6)await act(async()=>vi.advanceTimersByTimeAsync(10000-latency));
   }
   const calls=fixture.rpc.mock.calls.length;view.unmount();
   await act(async()=>vi.advanceTimersByTimeAsync(latency+10000));
   expect(fixture.rpc).toHaveBeenCalledTimes(calls);expect(active).toBe(0);
  }finally{view.unmount();vi.useRealTimers();}
 });
});

it('propagates verified current dealer FT and PT without adding them to booked P&L',async()=>{
 vi.useRealTimers();fixture.rpc.mockReset();fixture.auth={user:{id:'owner-a'},session:{access_token:'TEST_SESSION_FT'},isAdmin:true,loading:false};fixture.rpc.mockResolvedValue({data:{...packet(-100000),dealerLive:{scope:'current_outstanding',timeZone:'Asia/Ho_Chi_Minh',asOf:'2026-11-01T01:40:00Z',ptActiveUnfinalizedBalance:1207,ptFinalizedUnpaidBalance:2500,ptTotalUnpaid:3707},dealerFtLive:{scope:'current_month_provisional',timeZone:'Asia/Ho_Chi_Minh',asOf:'2026-11-01T01:40:00Z',period:'2026-11',gross:461538,net:413077}},error:null});
 const {result,unmount}=renderHook(()=>useClubFinanceSummary(scope));await waitFor(()=>expect(result.current.loading).toBe(false));expect(result.current.summary?.dealerLive?.ptTotalUnpaid).toBe(3707);expect(result.current.summary?.dealerFtLive?.net).toBe(413077);expect(result.current.summary?.net).toBe(-100000);unmount();
});
