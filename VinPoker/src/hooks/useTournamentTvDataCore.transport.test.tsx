import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({fetch:vi.fn(),signals:[] as AbortSignal[]}));
vi.mock('@/integrations/supabase/SupabaseClientContext',async()=>{
 const {createClient}=await import('@supabase/supabase-js');
 const client=createClient('http://127.0.0.1:54329','LOCAL_TV_READ_ONLY',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(...args)=>h.fetch(...args)}});
 // Only Realtime is modeled. All query builders/AbortSignal delivery are SDK.
 const channel=client.channel('LOCAL_TV_TRANSPORT');
 vi.spyOn(channel,'subscribe').mockReturnValue(channel);
 vi.spyOn(client,'channel').mockReturnValue(channel);
 return {useSupabaseClient:()=>client};
});
vi.mock('@/hooks/useLiveClock',()=>({useLiveClock:()=>0}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{tvLayoutEditorV1:false}}));
import {useTournamentTvDataCore} from './useTournamentTvDataCore';
const tour='f7280000-0000-4000-8000-000000000003';
beforeEach(()=>{
 h.fetch.mockReset();h.signals=[];
 h.fetch.mockImplementation((_input:unknown,init:RequestInit)=>new Promise((_resolve,reject)=>{
  const signal=init.signal!;h.signals.push(signal);
  signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
 }));
});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('delivers abort to the actual SDK transport on unmount',async()=>{
 const view=renderHook(()=>useTournamentTvDataCore(tour,{userId:'TEST_OWNER',authLoading:false}));
 await waitFor(()=>expect(h.fetch).toHaveBeenCalledTimes(1));
 await act(async()=>view.unmount());
 expect(h.signals).toHaveLength(1);expect(h.signals[0].aborted).toBe(true);
});
it('aborts the actual SDK fetch after the bounded read deadline',async()=>{
 vi.useFakeTimers();
 const {result}=renderHook(()=>useTournamentTvDataCore(tour,{userId:'TEST_OWNER',authLoading:false}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 expect(h.fetch).toHaveBeenCalledTimes(1);expect(h.signals[0].aborted).toBe(true);
 expect(result.current.state).toBe('error');expect(result.current.data).toBeNull();
});
