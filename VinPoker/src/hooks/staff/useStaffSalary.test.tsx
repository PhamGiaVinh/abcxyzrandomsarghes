import {createElement,type ReactNode} from 'react';
import {act,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {StaffProfileView} from '@/types/staffApp';
const f=vi.hoisted(()=>({rpc:vi.fn(),actor:'actor' as string|null,source:'live' as 'live'|'mock',session:{access_token:'staff-session-old'}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:f.rpc}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:f.actor?{id:f.actor}:null,loading:false,session:f.session})}));
vi.mock('@/lib/staffApp/dataSource',()=>({staffDataSource:()=>f.source}));
import {useStaffSalary} from './useStaffSalary';
const profile:StaffProfileView={staffId:'staff',userId:'actor',clubId:'club',clubName:'TEST',fullName:'TEST Staff',
  department:'service',employmentType:'part_time',hourlyRateVnd:50000,status:'active'};
const payload={staff_id:'staff',club_id:'club',employment_type:'part_time',hourly_rate_vnd:50000,accrued_minutes:0,balance_vnd:0,
  last_reset_at:'2026-10-19T00:00:00Z',current_shift_open:false,current_shift_start:null,monthly_salary_vnd:null,recent_payments:[]};
function wrapper(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 return({children}:{children:ReactNode})=>createElement(QueryClientProvider,{client},children);}
beforeEach(()=>{f.rpc.mockReset();f.actor='actor';f.source='live';f.session={access_token:'staff-session-old'};f.rpc.mockResolvedValue({data:payload,error:null});});
describe('staff self salary read integrity',()=>{
 it('ignores the old session response arriving after the new session salary',async()=>{
  let resolveOld!: (value:unknown)=>void;
  f.rpc.mockImplementationOnce(()=>new Promise(done=>{resolveOld=done;}));
  const h=renderHook(()=>useStaffSalary(profile),{wrapper:wrapper()});
  await waitFor(()=>expect(f.rpc).toHaveBeenCalledTimes(1));
  f.rpc.mockResolvedValueOnce({data:{...payload,balance_vnd:10000},error:null});
  f.session={access_token:'staff-session-new'};h.rerender();
  await waitFor(()=>expect(h.result.current.salary?.balanceVnd).toBe(10000));
  await act(async()=>resolveOld({data:{...payload,balance_vnd:50000},error:null}));
  expect(h.result.current.salary?.balanceVnd).toBe(10000);expect(f.rpc).toHaveBeenCalledTimes(2);h.unmount();
 });
 it('does not reuse salary from the previous session of the same actor',async()=>{
  f.rpc.mockResolvedValueOnce({data:{...payload,balance_vnd:50000},error:null});
  const h=renderHook(()=>useStaffSalary(profile),{wrapper:wrapper()});
  await waitFor(()=>expect(h.result.current.salary?.balanceVnd).toBe(50000));
  let resolve!: (value:unknown)=>void;
  f.rpc.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  f.session={access_token:'staff-session-new'};h.rerender();
  expect(h.result.current.salary).toBeNull();
  await waitFor(()=>expect(f.rpc).toHaveBeenCalledTimes(2));
  await act(async()=>resolve({data:{...payload,balance_vnd:10000},error:null}));
  await waitFor(()=>expect(h.result.current.salary?.balanceVnd).toBe(10000));h.unmount();
 });
 it.each([null,{error:'staff not found or inactive'},{...payload,balance_vnd:null},{...payload,staff_id:'other'},
  {...payload,club_id:'other'},{...payload,balance_vnd:'0'},{...payload,recent_payments:null}])('does not fabricate zero salary from invalid evidence',async(data)=>{
  f.rpc.mockResolvedValue({data,error:null});const h=renderHook(()=>useStaffSalary(profile),{wrapper:wrapper()});
  await waitFor(()=>expect(h.result.current.isError).toBe(true));expect(h.result.current.salary).toBeNull();h.unmount();
 });
 it('accepts zero only when the canonical self-scoped payload confirms it',async()=>{
  const h=renderHook(()=>useStaffSalary(profile),{wrapper:wrapper()});
  await waitFor(()=>expect(h.result.current.salary?.balanceVnd).toBe(0));expect(h.result.current.isError).toBe(false);h.unmount();
 });
 it('does not expose a last-good salary as current after a failed refresh',async()=>{
  const h=renderHook(()=>useStaffSalary(profile),{wrapper:wrapper()});await waitFor(()=>expect(h.result.current.salary).not.toBeNull());
  f.rpc.mockResolvedValue({data:{error:'staff not found or inactive',monthly_salary_vnd:null,recent_payments:[]},error:null});
  await act(async()=>{await h.result.current.refetch();});
  await waitFor(()=>expect(h.result.current.isError).toBe(true));expect(h.result.current.salary).toBeNull();expect(f.rpc).toHaveBeenCalledTimes(2);h.unmount();
 });
 it('does not expose cached salary to a different actor with the old profile still mounted',async()=>{
  const h=renderHook(()=>useStaffSalary(profile),{wrapper:wrapper()});await waitFor(()=>expect(h.result.current.salary).not.toBeNull());
  f.actor='other';h.rerender();expect(h.result.current.salary).toBeNull();expect(f.rpc).toHaveBeenCalledTimes(1);h.unmount();
 });
 it('clears private salary on logout even when the old profile remains passed in',async()=>{
  const h=renderHook(()=>useStaffSalary(profile),{wrapper:wrapper()});await waitFor(()=>expect(h.result.current.salary).not.toBeNull());
  f.actor=null;h.rerender();expect(h.result.current.salary).toBeNull();expect(f.rpc).toHaveBeenCalledTimes(1);h.unmount();
 });
});
