import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({user:{id:'actor'} as {id:string}|null,session:{access_token:'local-a'},read:vi.fn(),events:[] as Array<()=>void>,remove:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:f.user,session:f.session})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 from:(table:string)=>{const q={select:()=>q,in:()=>q,order:()=>f.read(table),then:(resolve:(value:unknown)=>unknown,reject?:(reason:unknown)=>unknown)=>Promise.resolve(f.read(table)).then(resolve,reject)};return q;},
 channel:()=>{const c={on:(_event:string,_filter:unknown,callback:()=>void)=>{f.events.push(callback);return c;},subscribe:()=>c};return c;},removeChannel:(...args:unknown[])=>f.remove(...args),
}}));
import {useRotationSchedule} from './useRotationSchedule';
const row=(club:string)=>({id:club+'-schedule',club_id:club,table_id:club+'-table',assignment_id:club+'-assignment',slot_index:0,in_attendance_id:null,status:'announced',updated_at:'2026-10-24T00:00:00Z'});
beforeEach(()=>{f.user={id:'actor'};f.session={access_token:'local-a'};f.read.mockReset();f.events=[];f.remove.mockReset();});
afterEach(()=>cleanup());
describe('rotation schedule scoped lifecycle',()=>{
 it('does not resurrect a delayed response after the club selection is cleared',async()=>{
  let finish!:(v:unknown)=>void;f.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const h=renderHook(({ids})=>useRotationSchedule(ids),{initialProps:{ids:['a']}});
  h.rerender({ids:[]});await act(async()=>finish({data:[row('a')],error:null}));
  expect(h.result.current.rows).toEqual([]);expect(h.result.current.byTableId).toEqual({});expect(h.result.current.loading).toBe(false);
 });
 it('does not apply a late read error after the club selection is cleared',async()=>{
  let finish!:(v:unknown)=>void;f.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const h=renderHook(({ids})=>useRotationSchedule(ids),{initialProps:{ids:['a']}});
  h.rerender({ids:[]});await act(async()=>finish({data:null,error:{message:'old 503'}}));
  expect(h.result.current.error).toBeNull();expect(h.result.current.rows).toEqual([]);
 });
 it('hides loaded old-club rows while the new club read is pending',async()=>{
  f.read.mockResolvedValueOnce({data:[row('a')],error:null}).mockImplementationOnce(()=>new Promise(()=>{}));
  const h=renderHook(({ids})=>useRotationSchedule(ids),{initialProps:{ids:['a']}});
  await waitFor(()=>expect(h.result.current.rows).toHaveLength(1));h.rerender({ids:['b']});
  expect(h.result.current.rows).toEqual([]);expect(h.result.current.byTableId).toEqual({});expect(h.result.current.loading).toBe(true);
 });
 it('drops loaded names after logout and does not read on manual refresh',async()=>{
  f.read.mockResolvedValue({data:[row('a')],error:null});const h=renderHook(()=>useRotationSchedule(['a']));
  await waitFor(()=>expect(h.result.current.rows).toHaveLength(1));f.user=null;h.rerender();
  expect(h.result.current.rows).toEqual([]);await act(async()=>h.result.current.refetch());expect(f.read).toHaveBeenCalledOnce();
 });
 it('invalidates the same-club result after actor/session replacement',async()=>{
  f.read.mockResolvedValueOnce({data:[row('a')],error:null}).mockImplementationOnce(()=>new Promise(()=>{}));
  const h=renderHook(()=>useRotationSchedule(['a']));await waitFor(()=>expect(h.result.current.rows).toHaveLength(1));
  f.session={access_token:'local-b'};h.rerender();expect(h.result.current.rows).toEqual([]);expect(h.result.current.loading).toBe(true);
 });
 it('ignores callbacks from a retired subscription instead of refreshing the new club',async()=>{
  f.read.mockResolvedValue({data:[],error:null});const h=renderHook(({ids})=>useRotationSchedule(ids),{initialProps:{ids:['a']}});
  await act(async()=>{});const retired=f.events[0];h.rerender({ids:['b']});await act(async()=>{});const before=f.read.mock.calls.length;
  await act(async()=>retired());expect(f.read).toHaveBeenCalledTimes(before);
 });
 it('cannot refresh after unmount through a retained callback',async()=>{
  f.read.mockResolvedValue({data:[],error:null});const h=renderHook(()=>useRotationSchedule(['a']));await act(async()=>{});
  const refresh=h.result.current.refetch;h.unmount();const before=f.read.mock.calls.length;await act(async()=>refresh());expect(f.read).toHaveBeenCalledTimes(before);
 });
 it('invalidates loaded data when a different actor retains the same clubs',async()=>{
  f.read.mockResolvedValueOnce({data:[row('a')],error:null}).mockImplementationOnce(()=>new Promise(()=>{}));
  const h=renderHook(()=>useRotationSchedule(['a']));await waitFor(()=>expect(h.result.current.rows).toHaveLength(1));
  f.user={id:'other-actor'};h.rerender();expect(h.result.current.rows).toEqual([]);expect(h.result.current.loading).toBe(true);
 });
 it('cannot reuse the first generation after switching A to B and back to A',async()=>{
  let old!:(v:unknown)=>void;
  f.read.mockImplementationOnce(()=>new Promise(resolve=>{old=resolve;})).mockResolvedValueOnce({data:[row('b')],error:null}).mockResolvedValueOnce({data:[{...row('a'),id:'fresh-a'}],error:null});
  const h=renderHook(({ids})=>useRotationSchedule(ids),{initialProps:{ids:['a']}});h.rerender({ids:['b']});
  await waitFor(()=>expect(h.result.current.rows[0]?.club_id).toBe('b'));h.rerender({ids:['a']});
  await waitFor(()=>expect(h.result.current.rows[0]?.id).toBe('fresh-a'));await act(async()=>old({data:[row('a')],error:null}));
  expect(h.result.current.rows[0]?.id).toBe('fresh-a');
 });
 it('deduplicates club order and keeps locked slot precedence and optional name enrichment',async()=>{
  const candidate={...row('a'),in_attendance_id:'incoming'};
  f.read.mockImplementation((table:string)=>Promise.resolve({data:table==='dealer_attendance'?[{id:'incoming',dealers:{full_name:'Named TEST dealer',tier:'B'}}]:[{...candidate,id:'predicted',status:'predicted'},candidate],error:null}));
  const h=renderHook(({ids})=>useRotationSchedule(ids),{initialProps:{ids:['b','a','a']}});
  await waitFor(()=>expect(h.result.current.byTableId['a-table']?.slot0?.id).toBe('a-schedule'));
  expect(h.result.current.byTableId['a-table'].slot0?.in_dealer_name).toBe('Named TEST dealer');
  h.rerender({ids:['a','b']});await act(async()=>{});expect(f.read).toHaveBeenCalledTimes(2);
 });
});
