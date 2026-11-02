import {createElement,type ReactNode} from 'react';
import {act,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({read:vi.fn(),actor:'actor' as string|null,session:{access_token:'old-staff-session'}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:f.actor?{id:f.actor}:null,session:f.session,loading:false})}));
vi.mock('@/lib/staffApp/dataSource',()=>({staffDataSource:()=> 'live'}));
vi.mock('@/lib/staffApp/selectedClub',()=>({useSelectedStaffId:()=>null,setSelectedStaffId:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{
 const q={select:()=>q,eq:()=>q,is:()=>q,order:()=>f.read()};return q;
}}}));
import {useStaffLink} from './useStaffLink';
const row={id:'staff',user_id:'actor',club_id:'club',full_name:'TEST Staff',department:'service',employment_type:'part_time',status:'active',clubs:{name:'TEST'}};
function wrapper(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 return({children}:{children:ReactNode})=>createElement(QueryClientProvider,{client},children);}
beforeEach(()=>{f.actor='actor';f.session={access_token:'old-staff-session'};f.read.mockReset();f.read.mockResolvedValue({data:[row],error:null});});
describe('staff membership read evidence',()=>{
 it('clears cached memberships on logout',async()=>{
  const h=renderHook(()=>useStaffLink(),{wrapper:wrapper()});await waitFor(()=>expect(h.result.current.isStaff).toBe(true));
  f.actor=null;h.rerender();expect(h.result.current.staff).toBeNull();expect(h.result.current.memberships).toEqual([]);h.unmount();
 });
 it('revalidates the same actor in a new session before exposing old memberships',async()=>{
  const h=renderHook(()=>useStaffLink(),{wrapper:wrapper()});await waitFor(()=>expect(h.result.current.isStaff).toBe(true));
  f.read.mockImplementation(()=>new Promise(()=>{}));f.session={access_token:'new-staff-session'};h.rerender();
  expect(h.result.current.staff).toBeNull();expect(h.result.current.loading).toBe(true);h.unmount();
 });
 it.each([null,[{...row,user_id:'outsider'}],[row,row],[{...row,department:'unknown'}]])('rejects missing or foreign membership evidence',async(data)=>{
  f.read.mockResolvedValue({data,error:null});const h=renderHook(()=>useStaffLink(),{wrapper:wrapper()});
  await waitFor(()=>expect(h.result.current.error).toBeTruthy());expect(h.result.current.staff).toBeNull();h.unmount();
 });
 it('exposes transport failure distinctly from a verified empty membership list',async()=>{
  f.read.mockResolvedValue({data:null,error:{message:'503 TEST'}});const h=renderHook(()=>useStaffLink(),{wrapper:wrapper()});
  await waitFor(()=>expect(h.result.current.error).toBeTruthy());expect(h.result.current.staff).toBeNull();h.unmount();
 });
 it('does not retain an actionable old membership after a failed refresh',async()=>{
  const h=renderHook(()=>useStaffLink(),{wrapper:wrapper()});await waitFor(()=>expect(h.result.current.isStaff).toBe(true));
  f.read.mockResolvedValue({data:null,error:{message:'503 TEST'}});
  await act(async()=>{await h.result.current.refetch();});
  await waitFor(()=>expect(h.result.current.error).toBeTruthy());expect(h.result.current.staff).toBeNull();expect(h.result.current.memberships).toEqual([]);h.unmount();
 });
 it('accepts a successful empty membership read',async()=>{
  f.read.mockResolvedValue({data:[],error:null});const h=renderHook(()=>useStaffLink(),{wrapper:wrapper()});
  await waitFor(()=>expect(h.result.current.loading).toBe(false));expect(h.result.current.isStaff).toBe(false);expect(h.result.current.error).toBeFalsy();h.unmount();
 });
});
