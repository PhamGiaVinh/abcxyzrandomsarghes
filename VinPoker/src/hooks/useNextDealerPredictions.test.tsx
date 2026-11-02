import {createElement,type ReactNode} from 'react';
import {act,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({rpc:vi.fn(),user:{id:'actor'} as {id:string}|null}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:f.user,session:null})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>{
 const promise=Promise.resolve(f.rpc(...args));return Object.assign(promise,{abortSignal:()=>promise});
}}}));
import {useNextDealerPredictions,type DealerAssignment} from './useDealerSwing';
const assignment=(session:string):DealerAssignment=>({id:'assignment',table_id:'a-table',table_session_id:session,attendance_id:'attendance',status:'assigned',released_at:null,
 assigned_at:'2026-10-29T00:00:00Z',updated_at:'2026-10-29T00:00:00Z',last_swing_attempted_at:null,swing_in_progress:false,
 swing_processed_at:null,swing_due_at:null,pre_assigned_at:null,overtime_started_at:null,
 game_tables:{id:'a-table',table_name:'TEST',table_type:'tournament',status:'active'},
 dealer_attendance:{current_state:'dealing',dealers:{full_name:'Current TEST'}},
 pre_assigned_attendance_id:'next-attendance',pre_assign_status:'valid',version:1});
const row=(club:string)=>({table_id:club+'-table',table_name:club,current_dealer:'Current TEST',next_dealer:'Next TEST',minutes_until_swing:5});
const wrapper=()=>{const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});return ({children}:{children:ReactNode})=>createElement(QueryClientProvider,{client},children);};
beforeEach(()=>{f.user={id:'actor'};f.rpc.mockReset();f.rpc.mockImplementation((_name,args)=>Promise.resolve({data:[row(args.p_club_id)],error:null}));});
afterEach(()=>vi.useRealTimers());
describe('multi-club next dealer read',()=>{
 it('refreshes when the preassigned attendance changes but not for attempt-only version bumps',async()=>{
  const h=renderHook(({assignments})=>useNextDealerPredictions(['a'],assignments),{wrapper:wrapper(),initialProps:{assignments:[assignment('session-a')]}});
  await waitFor(()=>expect(h.result.current.data?.['a-table']).toBeTruthy());
  h.rerender({assignments:[{...assignment('session-a'),version:2}]});
  await act(async()=>{});expect(f.rpc).toHaveBeenCalledTimes(1);
  h.rerender({assignments:[{...assignment('session-a'),version:3,pre_assigned_attendance_id:'replacement-next'}]});
  expect(h.result.current.data).toBeNull();await waitFor(()=>expect(f.rpc).toHaveBeenCalledTimes(2));
 });
 it('ignores a late old-session prediction after the new session is verified',async()=>{
  let finish!:(value:unknown)=>void;f.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}))
   .mockResolvedValueOnce({data:[{...row('a'),next_dealer:'Session B next'}],error:null});
  const h=renderHook(({assignments})=>useNextDealerPredictions(['a'],assignments),{wrapper:wrapper(),initialProps:{assignments:[assignment('session-a')]}});
  await waitFor(()=>expect(f.rpc).toHaveBeenCalledTimes(1));h.rerender({assignments:[assignment('session-b')]});
  await waitFor(()=>expect(h.result.current.data?.['a-table']?.nextDealerName).toBe('Session B next'));
  await act(async()=>finish({data:[{...row('a'),next_dealer:'Stale A next'}],error:null}));
  expect(h.result.current.data?.['a-table']?.nextDealerName).toBe('Session B next');
 });
 it('invalidates a confirmed prediction immediately when the same physical table changes session',async()=>{
  let finish!:(value:unknown)=>void;f.rpc.mockResolvedValueOnce({data:[row('a')],error:null}).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const h=renderHook(({assignments})=>useNextDealerPredictions(['a'],assignments),{wrapper:wrapper(),initialProps:{assignments:[assignment('session-a')]}});
  await waitFor(()=>expect(h.result.current.data?.['a-table']?.nextDealerName).toBe('Next TEST'));
  h.rerender({assignments:[assignment('session-b')]});
  expect(h.result.current.data).toBeNull();await waitFor(()=>expect(f.rpc).toHaveBeenCalledTimes(2));
  await act(async()=>finish({data:[{...row('a'),next_dealer:'Next session B'}],error:null}));
  await waitFor(()=>expect(h.result.current.data?.['a-table']?.nextDealerName).toBe('Next session B'));
 });
 it('does not reuse the initial cached generation after close and reopen',async()=>{
  let finish!:(value:unknown)=>void;f.rpc.mockResolvedValueOnce({data:[row('a')],error:null}).mockResolvedValueOnce({data:[],error:null})
   .mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const h=renderHook(({assignments})=>useNextDealerPredictions(['a'],assignments),{wrapper:wrapper(),initialProps:{assignments:[assignment('session-a')]}});
  await waitFor(()=>expect(h.result.current.data?.['a-table']).toBeTruthy());
  h.rerender({assignments:[]});expect(h.result.current.data).toBeNull();
  await waitFor(()=>expect(h.result.current.data).toEqual({}));
  h.rerender({assignments:[assignment('session-a')]});expect(h.result.current.data).toBeNull();
  await waitFor(()=>expect(f.rpc).toHaveBeenCalledTimes(3));
  await act(async()=>finish({data:[row('a')],error:null}));
 });
 it('bounds a hanging read and ignores late success',async()=>{
  vi.useFakeTimers();let resolve!:(value:unknown)=>void;
  f.rpc.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const h=renderHook(()=>useNextDealerPredictions(['a']),{wrapper:wrapper()});
  await act(async()=>{await vi.advanceTimersByTimeAsync(15_100);});
  expect(h.result.current.error).toBeTruthy();expect(h.result.current.data).toBeNull();
  await act(async()=>{resolve({data:[row('a')],error:null});await vi.advanceTimersByTimeAsync(10);});
  expect(h.result.current.data).toBeNull();h.unmount();
 });
 it('does not request or retain predictions after logout',async()=>{
  const h=renderHook(()=>useNextDealerPredictions(['a']),{wrapper:wrapper()});
  await waitFor(()=>expect(h.result.current.data?.['a-table']).toBeTruthy());
  f.user=null;h.rerender();expect(h.result.current.data).toBeNull();
  await act(async()=>{await h.result.current.refetch();});expect(f.rpc).toHaveBeenCalledTimes(1);
 });
 it('rejects duplicate table identities from separate clubs',async()=>{
  f.rpc.mockResolvedValue({data:[row('same')],error:null});
  const h=renderHook(()=>useNextDealerPredictions(['a','b']),{wrapper:wrapper()});
  await waitFor(()=>expect(h.result.current.error).toBeTruthy());expect(h.result.current.data).toBeNull();
 });
 it('loads every unique requested club',async()=>{
  const h=renderHook(()=>useNextDealerPredictions(['a','b','a']),{wrapper:wrapper()});
  await waitFor(()=>expect(Object.keys(h.result.current.data??{}).sort()).toEqual(['a-table','b-table']));
  expect(f.rpc).toHaveBeenCalledTimes(2);
 });
 it('does not let a delayed old-club response overwrite the current club',async()=>{
  let old!:(value:unknown)=>void;f.rpc.mockImplementationOnce(()=>new Promise(resolve=>{old=resolve;}));
  const h=renderHook(({ids})=>useNextDealerPredictions(ids),{wrapper:wrapper(),initialProps:{ids:['a']}});
  await waitFor(()=>expect(f.rpc).toHaveBeenCalledOnce());h.rerender({ids:['b']});
  await waitFor(()=>expect(h.result.current.data?.['b-table']).toBeTruthy());
  await act(async()=>old({data:[row('a')],error:null}));expect(h.result.current.data?.['a-table']).toBeUndefined();
 });
 it('reports a failed club rather than presenting a complete prediction',async()=>{
  f.rpc.mockResolvedValue({data:null,error:{message:'503'}});
  const h=renderHook(()=>useNextDealerPredictions(['a']),{wrapper:wrapper()});
  await waitFor(()=>expect(h.result.current).toHaveProperty('error',expect.any(String)));
  expect(h.result.current.data).toBeNull();
 });
});
