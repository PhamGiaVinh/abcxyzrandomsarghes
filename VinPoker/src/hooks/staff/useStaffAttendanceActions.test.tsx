import {createElement,type ReactNode} from 'react';
import {act,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({rpc:vi.fn(),actor:'actor' as string|null,session:{access_token:'staff-old'},success:vi.fn(),failure:vi.fn(),invalidate:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:f.actor?{id:f.actor}:null,session:f.session,loading:false})}));
vi.mock('@/lib/staffApp/dataSource',()=>({staffDataSource:()=> 'live'}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:f.rpc}}));
vi.mock('sonner',()=>({toast:{success:f.success,error:f.failure}}));
import {useStaffAttendanceActions} from './useStaffAttendanceActions';
import {useStaffSalary} from './useStaffSalary';
import type {StaffProfileView} from '@/types/staffApp';
const attendance='11111111-1111-4111-8111-111111111111';
const profile={staffId:'staff',userId:'actor',clubId:'club'};
const receipt={outcome:'checked_in',attendance_id:attendance,check_in_time:'2026-10-19T00:00:00Z'};
function wrapper(){const client=new QueryClient({defaultOptions:{mutations:{retry:false}}});
 vi.spyOn(client,'invalidateQueries').mockImplementation(f.invalidate);
 return({children}:{children:ReactNode})=>createElement(QueryClientProvider,{client},children);}
beforeEach(()=>{vi.clearAllMocks();f.rpc.mockReset();f.actor='actor';f.session={access_token:'staff-old'};f.invalidate.mockResolvedValue(undefined);f.rpc.mockResolvedValue({data:receipt,error:null});});
describe('staff attendance commit confirmation',()=>{
 it('refreshes the actual session-scoped salary query after check-in',async()=>{
  const staff:StaffProfileView={...profile,fullName:'TEST',clubName:'TEST',department:'service',employmentType:'part_time',hourlyRateVnd:50000,status:'active'};
  let balance=50000;
  f.rpc.mockImplementation(async(name:string)=>name==='get_my_staff_salary'?{data:{staff_id:'staff',club_id:'club',employment_type:'part_time',hourly_rate_vnd:50000,
   accrued_minutes:0,balance_vnd:balance,last_reset_at:null,current_shift_open:false,current_shift_start:null,monthly_salary_vnd:null,recent_payments:[]},error:null}
   :{data:receipt,error:null});
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});
  const realWrapper=({children}:{children:ReactNode})=>createElement(QueryClientProvider,{client},children);
  const h=renderHook(()=>({salary:useStaffSalary(staff),actions:useStaffAttendanceActions(profile)}),{wrapper:realWrapper});
  await waitFor(()=>expect(h.result.current.salary.salary?.balanceVnd).toBe(50000));
  balance=60000;
  await act(async()=>{await h.result.current.actions.checkIn.mutateAsync();});
  await waitFor(()=>expect(h.result.current.salary.salary?.balanceVnd).toBe(60000));h.unmount();
 });
 it.each(['checked_in','already_checked_in'])('confirms canonical %s and invalidates both scoped attendance and salary',async(outcome)=>{
  f.rpc.mockResolvedValue({data:{...receipt,outcome},error:null});const h=renderHook(()=>useStaffAttendanceActions(profile),{wrapper:wrapper()});
  await act(async()=>{await h.result.current.checkIn.mutateAsync();});expect(f.success).toHaveBeenCalledWith('Đã check-in.');
  expect(f.invalidate).toHaveBeenCalledTimes(2);expect(f.invalidate.mock.calls.every(([args])=>args.exact&&args.refetchType==='active')).toBe(true);h.unmount();
 });
 it('confirms checkout only with its canonical receipt',async()=>{
  f.rpc.mockResolvedValue({data:{outcome:'checked_out',attendance_id:attendance,check_out_time:'2026-10-19T01:00:00Z',total_worked_minutes_today:60},error:null});
  const h=renderHook(()=>useStaffAttendanceActions(profile),{wrapper:wrapper()});await act(async()=>{await h.result.current.checkOut.mutateAsync();});
  expect(f.success).toHaveBeenCalledWith('Đã check-out.');expect(f.rpc).toHaveBeenCalledTimes(1);h.unmount();
 });
 it.each([null,{}, {outcome:'unknown'}, {outcome:'no_open_shift'}])('does not toast success for an unconfirmed server outcome',async(data)=>{
  f.rpc.mockResolvedValue({data,error:null});const h=renderHook(()=>useStaffAttendanceActions(profile),{wrapper:wrapper()});let failure:unknown;
  await act(async()=>{try{await h.result.current.checkOut.mutateAsync();}catch(error){failure=error;}});
  expect(failure).toBeInstanceOf(Error);expect(f.success).not.toHaveBeenCalled();expect(f.rpc).toHaveBeenCalledTimes(1);h.unmount();
 });
 it.each(['actor','session'])('does not announce an old completion after %s changes',async(change)=>{
  let finish!:(v:unknown)=>void;f.rpc.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
  const h=renderHook(()=>useStaffAttendanceActions(profile),{wrapper:wrapper()});let pending!:Promise<unknown>;
  act(()=>{pending=h.result.current.checkIn.mutateAsync();});await waitFor(()=>expect(f.rpc).toHaveBeenCalledTimes(1));
  if(change==='actor')f.actor='other';else f.session={access_token:'staff-new'};
  h.rerender();await act(async()=>{finish({data:receipt,error:null});await pending;});
  expect(f.success).not.toHaveBeenCalled();expect(f.invalidate).toHaveBeenCalledTimes(2);
  expect(f.invalidate.mock.calls.every(([args])=>args.refetchType==='none'&&args.queryKey.includes('actor')&&!args.queryKey.includes('other'))).toBe(true);h.unmount();
 });
 it('serializes same-tick check-in and check-out through one operation gate',async()=>{
  const finish:Array<(v:unknown)=>void>=[];f.rpc.mockImplementation(()=>new Promise(done=>{finish.push(done);}));
  const h=renderHook(()=>useStaffAttendanceActions(profile),{wrapper:wrapper()});
  act(()=>{h.result.current.checkIn.mutate();h.result.current.checkIn.mutate();h.result.current.checkOut.mutate();});
  await waitFor(()=>expect(f.rpc).toHaveBeenCalled());const count=f.rpc.mock.calls.length;
  await act(async()=>{for(const done of finish)done({data:receipt,error:null});});
  expect(count).toBe(1);h.unmount();
 });
});
