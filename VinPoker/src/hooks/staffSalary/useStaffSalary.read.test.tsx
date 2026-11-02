import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {onlineManager,QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {PropsWithChildren} from 'react';
const f=vi.hoisted(()=>({rpc:vi.fn(),auth:{user:{id:'owner-a'},session:{access_token:'TEST_STAFF_A'},loading:false,isAdmin:false,isClubAdmin:false}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>f.rpc(...args)}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>f.auth}));
import {useStaffSalaryMonth} from './useStaffSalary';
const clients:QueryClient[]=[];
const packet=(net=1000)=>({club_id:'club-test',period_year:2026,period_month:10,header:{status:'approved'},rows:[{
 id:'run-test',staff_id:'staff-test',full_name:'LOCAL TEST staff',department:'fnb',employment_type:'full_time',worked_days:1,worked_minutes:null,
 gross_vnd:net,manual_bhxh_vnd:0,manual_tax_vnd:0,net_vnd:net,status:'locked'}],total_gross_vnd:net,total_net_vnd:net});
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);const wrapper=({children}:PropsWithChildren)=><QueryClientProvider client={client}>{children}</QueryClientProvider>;return renderHook(()=>useStaffSalaryMonth('live','club-test',2026,10),{wrapper});}
beforeEach(()=>{f.rpc.mockReset();f.auth={user:{id:'owner-a'},session:{access_token:'TEST_STAFF_A'},loading:false,isAdmin:false,isClubAdmin:false};});
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());onlineManager.setOnline(true);vi.useRealTimers();});
it('withholds a cached salary report while its offline read is paused',async()=>{
 vi.useFakeTimers();f.rpc.mockResolvedValue({data:packet(),error:null});const view=mount();
 await act(async()=>vi.advanceTimersByTimeAsync(1));expect(view.result.current.data?.totalNetVnd).toBe(1000);
 act(()=>onlineManager.setOnline(false));await act(async()=>vi.advanceTimersByTimeAsync(6000));
 expect(view.result.current.isPaused).toBe(true);expect(view.result.current.data).toBeUndefined();
 f.rpc.mockResolvedValue({data:packet(2000),error:null});act(()=>onlineManager.setOnline(true));
 await act(async()=>vi.advanceTimersByTimeAsync(1));expect(view.result.current.data?.totalNetVnd).toBe(2000);
});
it('does not turn null staff report data into a verified zero salary',async()=>{
 f.rpc.mockResolvedValue({data:null,error:null});const view=mount();await waitFor(()=>expect(view.result.current.isFetching).toBe(false));
 expect(view.result.current.isError).toBe(true);expect(view.result.current.data).toBeUndefined();
});
it('automatically observes another operator changing staff salary status and totals',async()=>{
 vi.useFakeTimers();f.rpc.mockResolvedValue({data:packet(1000),error:null});const view=mount();
 await act(async()=>vi.advanceTimersByTimeAsync(1));expect(view.result.current.data?.totalNetVnd).toBe(1000);
 f.rpc.mockResolvedValue({data:packet(2000),error:null});await act(async()=>vi.advanceTimersByTimeAsync(5000));
 expect(view.result.current.data?.totalNetVnd).toBe(2000);
});
it('does not reuse a previous owner session cache for the same club/month',async()=>{
 f.rpc.mockResolvedValueOnce({data:packet(),error:null}).mockReturnValueOnce(new Promise(()=>{}));const view=mount();await waitFor(()=>expect(view.result.current.isFetching).toBe(false));
 expect(view.result.current.data?.totalNetVnd).toBe(1000);
 f.auth={...f.auth,session:{access_token:'TEST_STAFF_B'}};view.rerender();expect(view.result.current.data).toBeUndefined();
 await act(async()=>{});expect(f.rpc).toHaveBeenCalledTimes(2);
});
it('rejects missing row money rather than publishing it as zero',async()=>{
 const data=packet();data.rows[0].net_vnd=null as never;f.rpc.mockResolvedValue({data,error:null});const view=mount();await waitFor(()=>expect(view.result.current.isFetching).toBe(false));
 expect(view.result.current.isError).toBe(true);expect(view.result.current.data).toBeUndefined();
});
it.each(['club_id','period_year','period_month'] as const)('rejects a response for another %s',async(field)=>{
 const data=packet();Object.assign(data,{[field]:field==='club_id'?'other-club':1});
 f.rpc.mockResolvedValue({data,error:null});const view=mount();
 await waitFor(()=>expect(view.result.current.isError).toBe(true));expect(view.result.current.data).toBeUndefined();
});
it('rejects inconsistent totals and duplicate staff rows',async()=>{
 const data=packet();data.rows.push({...data.rows[0],id:'another-run'});data.total_net_vnd=2000;data.total_gross_vnd=2000;
 f.rpc.mockResolvedValue({data,error:null});const view=mount();
 await waitFor(()=>expect(view.result.current.isError).toBe(true));expect(view.result.current.data).toBeUndefined();
});
it('rejects totals that disagree with unique saved rows',async()=>{
 const data=packet();data.total_net_vnd=999;f.rpc.mockResolvedValue({data,error:null});const view=mount();
 await waitFor(()=>expect(view.result.current.isError).toBe(true));expect(view.result.current.data).toBeUndefined();
});
it('preserves an approved empty snapshot rather than reading a new preview',async()=>{
 const data={...packet(),rows:[],total_gross_vnd:0,total_net_vnd:0};f.rpc.mockResolvedValue({data,error:null});const view=mount();
 await waitFor(()=>expect(view.result.current.isSuccess).toBe(true));expect(view.result.current.data?.hasRuns).toBe(true);
 expect(view.result.current.data?.standardShifts).toBeNull();expect(f.rpc).toHaveBeenCalledTimes(1);
});
it('displays preview totals from verified server rows instead of the empty saved total',async()=>{
 const row={...packet().rows[0],already_locked:false};
 f.rpc.mockResolvedValueOnce({data:{...packet(),header:{status:'prepared'},rows:[],total_gross_vnd:0,total_net_vnd:0},error:null})
 .mockResolvedValueOnce({data:{club_id:'club-test',period_year:2026,period_month:10,standard_shifts_per_month:26,staff:[row]},error:null});
 const view=mount();await waitFor(()=>expect(view.result.current.isSuccess).toBe(true));
 expect(view.result.current.data?.hasRuns).toBe(false);expect(view.result.current.data?.totalNetVnd).toBe(1000);
});
it('times out a hung read and recovers on a later automatic read',async()=>{
 vi.useFakeTimers();f.rpc.mockReturnValueOnce(new Promise(()=>{})).mockResolvedValue({data:packet(),error:null});const view=mount();
 await act(async()=>vi.advanceTimersByTimeAsync(10001));expect(view.result.current.isError).toBe(true);expect(view.result.current.data).toBeUndefined();
 await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(view.result.current.data?.totalNetVnd).toBe(1000);
});
it('does not publish a late report from a previous session',async()=>{
 let old!: (value:unknown)=>void;f.rpc.mockReturnValueOnce(new Promise(resolve=>{old=resolve;}));const view=mount();
 await waitFor(()=>expect(f.rpc).toHaveBeenCalledTimes(1));
 f.rpc.mockResolvedValueOnce({data:packet(2000),error:null});f.auth={...f.auth,session:{access_token:'TEST_STAFF_B'}};view.rerender();
 await waitFor(()=>expect(view.result.current.data?.totalNetVnd).toBe(2000));
 await act(async()=>old({data:packet(1000),error:null}));expect(view.result.current.data?.totalNetVnd).toBe(2000);
});
it('masks salary while authentication is changing and blocks a captured old refetch',async()=>{
 f.rpc.mockResolvedValue({data:packet(),error:null});const view=mount();await waitFor(()=>expect(view.result.current.isSuccess).toBe(true));
 const staleRefetch=view.result.current.refetch;f.auth={...f.auth,loading:true};view.rerender();
 expect(view.result.current.data).toBeUndefined();await expect(staleRefetch()).rejects.toThrow('STAFF_SALARY_AUTH_REQUIRED');
 expect(f.rpc).toHaveBeenCalledTimes(1);
});

