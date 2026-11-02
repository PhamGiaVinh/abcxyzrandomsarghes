import {act,renderHook,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const h=vi.hoisted(()=>({auth:{user:{id:'actor-a'} as {id:string}|null,loading:false},rpc:vi.fn(),clubIn:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>h.auth}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc,from:()=>({select:()=>({in:h.clubIn})})}}));
import {useFnbClubs} from './useFnbClubs';
const club={id:'club-a',name:'TEST A'};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
describe('F&B club read boundaries',()=>{
 beforeEach(()=>{h.auth={user:{id:'actor-a'},loading:false};h.rpc.mockReset().mockResolvedValue({data:['club-a'],error:null});h.clubIn.mockReset().mockResolvedValue({data:[club],error:null});});
 it('reports RPC failure without claiming no clubs and allows a read retry',async()=>{
  h.rpc.mockResolvedValueOnce({data:null,error:{message:'503'}});
  const {result}=renderHook(()=>useFnbClubs());
  await waitFor(()=>expect(result.current.error).toBeTruthy());
  expect(result.current.clubs).toBeNull();expect(result.current.loading).toBe(false);expect(h.clubIn).not.toHaveBeenCalled();
  act(()=>result.current.reload());await waitFor(()=>expect(result.current.clubs).toEqual([club]));expect(result.current.error).toBeNull();
 });
 it('does not turn club-name read errors into no assignment',async()=>{
  h.clubIn.mockResolvedValue({data:null,error:{message:'network'}});
  const {result}=renderHook(()=>useFnbClubs());await waitFor(()=>expect(result.current.error).toBeTruthy());expect(result.current.clubs).toBeNull();
 });
 it('clears clubs on logout immediately',async()=>{
  const {result,rerender}=renderHook(()=>useFnbClubs());await waitFor(()=>expect(result.current.clubs).toEqual([club]));
  h.auth={user:null,loading:false};rerender();expect(result.current.clubs).toEqual([]);expect(result.current.clubIds).toEqual([]);
 });
 it('hides old clubs while actor B loads and ignores late actor A',async()=>{
  const a=deferred<{data:typeof club[];error:null}>();h.clubIn.mockReturnValueOnce(a.promise);
  const {result,rerender}=renderHook(()=>useFnbClubs());await waitFor(()=>expect(h.clubIn).toHaveBeenCalledTimes(1));
  const b=deferred<{data:string[];error:null}>();h.rpc.mockReturnValueOnce(b.promise);h.auth={user:{id:'actor-b'},loading:false};rerender();
  expect(result.current.clubs).toBeNull();expect(result.current.loading).toBe(true);
  await act(async()=>a.resolve({data:[club],error:null}));expect(result.current.clubs).toBeNull();
  await act(async()=>b.resolve({data:[],error:null}));await waitFor(()=>expect(result.current.clubs).toEqual([]));
 });
 it('does not restart a verified read for an equivalent user object',async()=>{
  const {result,rerender}=renderHook(()=>useFnbClubs());await waitFor(()=>expect(result.current.clubs).toEqual([club]));
  h.auth={user:{id:'actor-a'},loading:false};rerender();expect(h.rpc).toHaveBeenCalledTimes(1);
 });
 it('reports a rejected request instead of remaining in loading',async()=>{
  h.rpc.mockRejectedValue(new Error('Failed to fetch'));const {result}=renderHook(()=>useFnbClubs());
  await waitFor(()=>expect(result.current.error).toBeTruthy());expect(result.current.loading).toBe(false);
 });
 it('only uses the empty state after a successful empty scope response',async()=>{
  h.rpc.mockResolvedValue({data:[],error:null});const {result}=renderHook(()=>useFnbClubs());
  await waitFor(()=>expect(result.current.clubs).toEqual([]));expect(result.current.error).toBeNull();
 });
});
