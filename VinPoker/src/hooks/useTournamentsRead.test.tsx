import type {ReactNode} from 'react';
import {act,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
const calls=vi.hoisted(()=>({from:vi.fn(),select:vi.fn(),eq:vi.fn(),in:vi.fn(),abortSignal:vi.fn(),rows:[] as unknown}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>({from:calls.from})}));
import {useTournaments,useActiveTournaments} from './useTournaments';
const verifiedSession={access_token:'TEST-only-token-a'};
it.each([useTournaments,useActiveTournaments])('keeps late old-session data separate and never includes a bearer token in cache keys (%#)',async(read)=>{
 let finish!:(value:unknown)=>void;
 const query={select:calls.select,eq:calls.eq,in:calls.in,abortSignal:calls.abortSignal,order:vi.fn()
  .mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}))
  .mockResolvedValueOnce({data:[{id:'new-session-only'}],error:null})};
 calls.from.mockReturnValue(query);calls.select.mockReturnValue(query);calls.eq.mockReturnValue(query);calls.in.mockReturnValue(query);calls.abortSignal.mockReturnValue(query);
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 const provider=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
 const view=renderHook(({session})=>read('club-a','actor-a',session),{initialProps:{session:verifiedSession},wrapper:provider});
 view.rerender({session:{access_token:'TEST-only-token-b'}});
 await waitFor(()=>expect(view.result.current.data).toEqual([{id:'new-session-only'}]));
 await act(async()=>{finish({data:[{id:'previous-session-only'}],error:null});});
 expect(view.result.current.data).toEqual([{id:'new-session-only'}]);
 const keys=JSON.stringify(client.getQueryCache().getAll().map(q=>q.queryKey));
 expect(keys).not.toContain('TEST-only-token');expect(keys).toContain('actor-a');
});
it.each([useTournaments,useActiveTournaments])('does not share fresh data with a new session of the same actor (%#)',async(read)=>{
 calls.rows=[{id:'previous-session-only'}];
 const view=renderHook(({session})=>read('club-a','actor-a',session),{initialProps:{session:verifiedSession},wrapper:wrapper()});
 await waitFor(()=>expect(view.result.current.data).toEqual(calls.rows));
 calls.rows=[{id:'new-session-only'}];
 view.rerender({session:{access_token:'TEST-only-token-b'}});
 expect(view.result.current.data).toBeUndefined();
 await waitFor(()=>expect(view.result.current.data).toEqual(calls.rows));
 expect(calls.from).toHaveBeenCalledTimes(2);
});
it.each([useTournaments,useActiveTournaments])('requires a verified session even when an old actor is retained (%#)',(read)=>{
 const view=renderHook(()=>read('club-a','actor-a',null),{wrapper:wrapper()});
 expect(view.result.current.fetchStatus).toBe('idle');
 expect(calls.from).not.toHaveBeenCalled();
});
it.each([useTournaments,useActiveTournaments])('hides cached tournaments on logout and does not fetch without an actor (%#)',async(read)=>{
 calls.rows=[{id:'private-tour'}];
 const view=renderHook(({actor}:{actor:string|undefined})=>read('club-a',actor,verifiedSession),{initialProps:{actor:'actor-a' as string|undefined},wrapper:wrapper()});
 await waitFor(()=>expect(view.result.current.data).toEqual(calls.rows));
 view.rerender({actor:undefined});
 expect(view.result.current.data).toBeUndefined();expect(view.result.current.fetchStatus).toBe('idle');
 await view.result.current.refetch().catch(()=>{});
 expect(calls.from).toHaveBeenCalledTimes(1);
});
it.each([useTournaments,useActiveTournaments])('retains same-actor deduplication and club-prefix invalidation (%#)',async(read)=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 const provider=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
 const first=renderHook(()=>read('club-a','actor-a',verifiedSession),{wrapper:provider});
 const second=renderHook(()=>read('club-a','actor-a',verifiedSession),{wrapper:provider});
 await waitFor(()=>expect(first.result.current.isSuccess&&second.result.current.isSuccess).toBe(true));
 expect(calls.from).toHaveBeenCalledTimes(1);
 await act(async()=>{await client.invalidateQueries({queryKey:['tournaments','club-a']});});
 expect(calls.from).toHaveBeenCalledTimes(2);
});
it.each([useTournaments,useActiveTournaments])('does not share fresh tournament data across actors (%#)',async(read)=>{
 const first=[{id:'actor-a-only'}],second=[{id:'actor-b-only'}];
 calls.rows=first;
 const view=renderHook(({actor})=>read('club-a',actor,verifiedSession),{initialProps:{actor:'actor-a'},wrapper:wrapper()});
 await waitFor(()=>expect(view.result.current.data).toEqual(first));
 calls.rows=second;
 view.rerender({actor:'actor-b'});
 expect(view.result.current.data).toBeUndefined();
 await waitFor(()=>expect(view.result.current.data).toEqual(second));
 expect(calls.from).toHaveBeenCalledTimes(2);
});
it.each([useTournaments,useActiveTournaments])('does not publish an old actor response into the new actor read (%#)',async(read)=>{
 let finish!:(value:unknown)=>void;
 const query={select:calls.select,eq:calls.eq,in:calls.in,abortSignal:calls.abortSignal,order:vi.fn()
  .mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}))
  .mockResolvedValueOnce({data:[{id:'actor-b-only'}],error:null})};
 calls.from.mockReturnValue(query);calls.select.mockReturnValue(query);calls.eq.mockReturnValue(query);calls.in.mockReturnValue(query);calls.abortSignal.mockReturnValue(query);
 const view=renderHook(({actor})=>read('club-a',actor,verifiedSession),{initialProps:{actor:'actor-a'},wrapper:wrapper()});
 view.rerender({actor:'actor-b'});
 await waitFor(()=>expect(view.result.current.data).toEqual([{id:'actor-b-only'}]));
 await act(async()=>{finish({data:[{id:'actor-a-only'}],error:null});});
 expect(view.result.current.data).toEqual([{id:'actor-b-only'}]);
});
beforeEach(()=>{
 vi.clearAllMocks();
 calls.rows=[];
 const query={select:calls.select,eq:calls.eq,in:calls.in,abortSignal:calls.abortSignal,order:()=>Promise.resolve({data:calls.rows,error:null})};
 calls.abortSignal.mockReturnValue(query);
 calls.from.mockReturnValue(query);calls.select.mockReturnValue(query);calls.eq.mockReturnValue(query);calls.in.mockReturnValue(query);calls.abortSignal.mockReturnValue(query);
});
afterEach(()=>vi.useRealTimers());
it.each([useTournaments,useActiveTournaments])('rejects null and object envelopes, permits verified empty, and recovers on explicit retry (%#)',async(read)=>{
 calls.rows=null;
 const view=renderHook(()=>read('club-a','actor-a',verifiedSession),{wrapper:wrapper()});
 await waitFor(()=>expect(view.result.current.isError).toBe(true));
 expect(view.result.current.data).toBeUndefined();
 calls.rows={rows:[]};await act(async()=>{await view.result.current.refetch();});
 expect(view.result.current.isError).toBe(true);expect(view.result.current.data).toBeUndefined();
 calls.rows=[];await act(async()=>{await view.result.current.refetch();});
 await waitFor(()=>expect(view.result.current.isSuccess).toBe(true));expect(view.result.current.data).toEqual([]);
});
it.each([useTournaments,useActiveTournaments])('bounds hung reads and aborts their SDK request (%#)',async(read)=>{
 vi.useFakeTimers();
 let finish!:(value:unknown)=>void;
 const query={select:calls.select,eq:calls.eq,in:calls.in,abortSignal:calls.abortSignal,order:()=>new Promise(resolve=>{finish=resolve;})};
 calls.from.mockReturnValue(query);calls.select.mockReturnValue(query);calls.eq.mockReturnValue(query);calls.in.mockReturnValue(query);calls.abortSignal.mockReturnValue(query);calls.abortSignal.mockReturnValue(query);
 const view=renderHook(()=>read('club-a','actor-a',verifiedSession),{wrapper:wrapper()});
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
 expect(view.result.current.isError).toBe(true);
 expect(calls.abortSignal.mock.calls[0]?.[0]?.aborted).toBe(true);
 await act(async()=>{finish({data:[{id:'late-after-deadline'}],error:null});await vi.advanceTimersByTimeAsync(1);});
 expect(view.result.current.isError).toBe(true);expect(view.result.current.data).toBeUndefined();
});
it.each([useTournaments,useActiveTournaments])('aborts a pending SDK read when its last observer unmounts (%#)',async(read)=>{
 const query={select:calls.select,eq:calls.eq,in:calls.in,abortSignal:calls.abortSignal,order:()=>new Promise(()=>{})};
 calls.from.mockReturnValue(query);calls.select.mockReturnValue(query);calls.eq.mockReturnValue(query);calls.in.mockReturnValue(query);calls.abortSignal.mockReturnValue(query);
 const view=renderHook(()=>read('club-a','actor-a',verifiedSession),{wrapper:wrapper()});
 const signal=calls.abortSignal.mock.calls[0][0] as AbortSignal;
 expect(signal.aborted).toBe(false);view.unmount();expect(signal.aborted).toBe(true);
});
function wrapper(){
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 return ({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
it('both tournament readers disambiguate the existing table_id relationship and retain club scope',async()=>{
 const all=renderHook(()=>useTournaments('club-a','actor-a',verifiedSession),{wrapper:wrapper()});
 await waitFor(()=>expect(all.result.current.isSuccess).toBe(true));
 const active=renderHook(()=>useActiveTournaments('club-b','actor-a',verifiedSession),{wrapper:wrapper()});
 await waitFor(()=>expect(active.result.current.isSuccess).toBe(true));
 expect(calls.select).toHaveBeenCalledTimes(2);
 for(const [projection] of calls.select.mock.calls)expect(projection).toContain('game_tables!tournament_tables_table_id_fkey');
 expect(calls.eq).toHaveBeenCalledWith('club_id','club-a');expect(calls.eq).toHaveBeenCalledWith('club_id','club-b');
 expect(calls.in).toHaveBeenCalledWith('status',['active','live','break','final_table']);
});
it('does not fetch an unscoped tournament list',()=>{
 renderHook(()=>useTournaments(undefined,'actor-a',verifiedSession),{wrapper:wrapper()});
 expect(calls.from).not.toHaveBeenCalled();
});

it('preserves distinct canonical, legacy and session IDs from the server',async()=>{
 const row={id:'tour-a',tournament_tables:[{
  id:'logical-a',table_id:null,game_table_id:'physical-a',
  table_session_id:'session-a',status:'active',game_tables:null,
  canonical_game_table:{id:'physical-a',table_name:'Table A'},
 }]};
 calls.rows=[row];
 const all=renderHook(()=>useTournaments('club-a','actor-a',verifiedSession),{wrapper:wrapper()});
 await waitFor(()=>expect(all.result.current.isSuccess).toBe(true));
 expect(all.result.current.data).toEqual([row]);
 const active=renderHook(()=>useActiveTournaments('club-a','actor-a',verifiedSession),{wrapper:wrapper()});
 await waitFor(()=>expect(active.result.current.isSuccess).toBe(true));
 expect(active.result.current.data).toEqual([row]);
});

it('projects canonical Floor table identity and session without replacing the legacy identity',async()=>{
 const all=renderHook(()=>useTournaments('club-a','actor-a',verifiedSession),{wrapper:wrapper()});
 await waitFor(()=>expect(all.result.current.isSuccess).toBe(true));
 const active=renderHook(()=>useActiveTournaments('club-a','actor-a',verifiedSession),{wrapper:wrapper()});
 await waitFor(()=>expect(active.result.current.isSuccess).toBe(true));
 for(const [projection] of calls.select.mock.calls){
  const fields=projection.slice(projection.indexOf('tournament_tables'));
  const identityFields=fields.slice(0,fields.indexOf('game_tables!'));
  expect(identityFields).toMatch(/\bid\s*,/);
  expect(fields).toMatch(/\btable_id\s*,/);
  expect(fields).toMatch(/\bgame_table_id\s*,/);
  expect(fields).toMatch(/\btable_session_id\s*,/);
  expect(fields).toMatch(/\bstatus\s*,/);
  expect(fields).toContain('tournament_tables_game_table_id_v3_fkey');
  expect(fields).toContain('tournament_tables_table_id_fkey');
 }
});
