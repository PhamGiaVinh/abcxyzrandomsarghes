import {createElement,type ReactNode} from 'react';
import {renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({read:vi.fn(),actor:'actor' as string|null,session:{access_token:'staff-old'}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:f.actor?{id:f.actor}:null,loading:false,session:f.session})}));
vi.mock('@/lib/staffApp/dataSource',()=>({staffDataSource:()=> 'live'}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{
 const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,then:(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>Promise.resolve(f.read()).then(resolve,reject)};return q;
}}}));
import {useStaffAttendance} from './useStaffAttendance';
const row={id:'attendance',staff_id:'staff',shift_date:'2026-10-19',check_in_time:'2026-10-19T00:00:00Z',check_out_time:null,status:'checked_in',total_worked_minutes_today:null};
const profile={staffId:'staff',userId:'actor',clubId:'club'};
function wrapper(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 return({children}:{children:ReactNode})=>createElement(QueryClientProvider,{client},children);}
beforeEach(()=>{f.read.mockReset();f.actor='actor';f.session={access_token:'staff-old'};f.read.mockResolvedValue({data:[row],error:null});});
describe('staff attendance read boundary',()=>{
 it('does not retain an open shift from a previous session of the same actor',async()=>{
  const h=renderHook(()=>useStaffAttendance(profile),{wrapper:wrapper()});await waitFor(()=>expect(h.result.current.openAttendance).not.toBeNull());
  f.read.mockImplementation(()=>new Promise(()=>{}));f.session={access_token:'staff-new'};h.rerender();
  expect(h.result.current.rows).toEqual([]);expect(h.result.current.openAttendance).toBeNull();h.unmount();
 });
 it.each([null,[{...row,staff_id:'other'}],[{...row,check_in_time:'bad-date'}],[row,{...row,id:'second-open'}]])('does not infer availability from missing or ambiguous attendance',async(data)=>{
  f.read.mockResolvedValue({data,error:null});const h=renderHook(()=>useStaffAttendance(profile),{wrapper:wrapper()});
  await waitFor(()=>expect(h.result.current.isError).toBe(true));expect(h.result.current.rows).toEqual([]);expect(h.result.current.openAttendance).toBeNull();h.unmount();
 });
 it('accepts an explicit successful empty read',async()=>{
  f.read.mockResolvedValue({data:[],error:null});const h=renderHook(()=>useStaffAttendance(profile),{wrapper:wrapper()});
  await waitFor(()=>expect(h.result.current.isSuccess).toBe(true));expect(h.result.current.rows).toEqual([]);h.unmount();
 });
 it('does not expose old actor cache when account changes',async()=>{
  const h=renderHook(()=>useStaffAttendance(profile),{wrapper:wrapper()});await waitFor(()=>expect(h.result.current.rows).toHaveLength(1));
  f.read.mockImplementation(()=>new Promise(()=>{}));f.actor='other';h.rerender();expect(h.result.current.rows).toEqual([]);h.unmount();
 });
 it('clears attendance on logout without another request',async()=>{
  const h=renderHook(()=>useStaffAttendance(profile),{wrapper:wrapper()});await waitFor(()=>expect(h.result.current.rows).toHaveLength(1));
  f.actor=null;h.rerender();expect(h.result.current.rows).toEqual([]);expect(f.read).toHaveBeenCalledTimes(1);h.unmount();
 });
});
