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
it('loads TV using the parent-event foreign key when the event also points to a final tournament',async()=>{
 h.fetch.mockImplementation(async(input:RequestInfo|URL)=>{
  const url=new URL(String(input));
  const select=url.searchParams.get('select')??'';
  let data:unknown=[];
  if(url.pathname.endsWith('/tournaments')&&select.includes('main_event:')){
   if(!select.includes('main_event:tournament_events!tournaments_event_id_fkey(')){
    return new Response(JSON.stringify({code:'PGRST201',message:'More than one relationship between tournaments and tournament_events'}),{status:300});
   }
   data={name:'TEST TV',status:'live',prize_pool:0,main_event:{guarantee_amount:2500000},club:null};
  }else if(url.pathname.endsWith('/rpc/get_tournament_clock')){
   data={remaining_seconds:600,is_running:false};
  }else if(url.pathname.endsWith('/rpc/get_tournament_participation_counts_v1')){
   data={tournament_id:tour,counts:{total_entries:0,re_entries:0,remaining:0,seated:0,waiting:0,busted:0,
    anomaly_entries:0,anomaly_seats:0,live_entry_stack:0,seated_stack:0,waiting_stack:0},average_stack:0,prize_pool:0};
  }else if(url.pathname.endsWith('/tournaments'))data=null;
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 });
 const {result}=renderHook(()=>useTournamentTvDataCore(tour,{userId:'TEST_OWNER',authLoading:false}));
 await waitFor(()=>expect(result.current.state).toBe('ready'));
 expect(result.current.data?.mainEventGuarantee).toBe(2500000);
});
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
