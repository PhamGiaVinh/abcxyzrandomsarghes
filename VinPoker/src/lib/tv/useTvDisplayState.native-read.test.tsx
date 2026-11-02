// Actual hook + SDK HTTP + native anon read adapter. Broadcast remains modeled.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync,readFileSync,existsSync } from 'node:fs';
const h=vi.hoisted(()=>({requests:0,errors:[] as unknown[],configs:[] as (()=>void)[]}));
vi.mock('@/integrations/supabase/client',async()=>{
  const {createClient}=await import('@supabase/supabase-js');
  const {transferableAbortController}=await import('node:util');
  const native=createClient('http://127.0.0.1:54329','LOCAL_TEST_ONLY',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  return {supabase:{rpc:(name:string,args:Record<string,unknown>)=>{
    h.requests++;const query=native.rpc(name,args);
    return {abortSignal:(signal:AbortSignal)=>{
      // Node fetch rejects jsdom's AbortSignal realm; preserve cancellation through a host signal.
      const host=transferableAbortController(),forward=()=>host.abort();
      if(signal.aborted)host.abort();else signal.addEventListener('abort',forward,{once:true});
      return Promise.resolve(query.abortSignal(host.signal)).then(result=>{if(result.error)h.errors.push(result.error);return result;})
        .finally(()=>signal.removeEventListener('abort',forward));
    }};
  },
    channel:()=>{const channel={on:(_kind:string,_filter:unknown,callback:()=>void)=>{h.configs.push(callback);return channel;},subscribe:()=>channel};return channel;},removeChannel:async()=> 'ok'}};
});
vi.mock('@/hooks/useLiveClock',()=>({useLiveClock:()=>0}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{tvLayoutEditorV1:true}}));
import {useTvDisplayState} from './useTvDisplayState';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe.skipIf(process.env.VINPOKER_TV1235_LOCAL!=='1')('native same-token standby recovery',()=>{
 it('clears the prior tournament on a native unassigned snapshot then restores current native data',async()=>{
  const output='D:/Quy trình/output/reports/tv1235-hook-observations-local-20261028.json';expect(existsSync(output)).toBe(false);
  vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
  h.requests=0;h.errors=[];h.configs=[];const observations=[];
  for(const [alias,suffix,entries,chips] of [
   ['LOCAL1154-A','Flight A',8,0],['LOCAL1154-B','Flight B',8,0],['LOCAL1154-D2','Final Day',15,300000],
  ] as const){
   const {result,unmount}=renderHook(()=>useTvDisplayState(alias));
   await waitFor(()=>expect(result.current.state,JSON.stringify(h.errors)).toBe('ready'),{timeout:10000});
   expect(result.current.data?.tournamentName).toContain(suffix);expect(result.current.data?.totalEntries).toBe(entries);
   await act(async()=>{await result.current.refetch();});
   expect(result.current.state).toBe('standby');expect(result.current.data).toBeNull();expect(result.current.payload?.tournament).toBeNull();expect(result.current.offline).toBe(false);
   await act(async()=>{await result.current.refetch();});expect(result.current.state).toBe('ready');
   expect(result.current.data?.tournamentName).toContain(suffix);expect(result.current.data?.totalEntries).toBe(entries);expect(result.current.data?.totalChips).toBe(chips);
   observations.push({alias,suffix,entries,chips,sequence:['ready','standby','ready'],standbyDataCleared:true});unmount();
  }
  expect(h.requests).toBe(9);expect(h.errors).toEqual([]);
  writeFileSync(output,JSON.stringify({kind:'ACTUAL_HOOK_SDK_HTTP_NATIVE_ANON_STANDBY_ASSIGNMENT_SETUP_ROLLBACK_NOT_BROWSER',observations,httpRequests:h.requests,errors:h.errors,realRealtime:false,wholeJourney:false},null,2));
 },60000);
});
describe.skipIf(process.env.VINPOKER_TV1222_LOCAL!=='1')('native visibility and offline recovery',()=>{
 it('suppresses hidden/offline reads, retains snapshots and resumes each existing display',async()=>{
  let visibility:DocumentVisibilityState='hidden',online=false;
  vi.spyOn(document,'visibilityState','get').mockImplementation(()=>visibility);
  vi.spyOn(navigator,'onLine','get').mockImplementation(()=>online);
  h.requests=0;h.errors=[];h.configs=[];
  const observations=[];
  for(const [alias,name,entries,chips] of [
   ['LOCAL1154-A','Flight A',8,0],['LOCAL1154-B','Flight B',8,0],['LOCAL1154-D2','Final Day',15,300000],
  ] as const){
   visibility='hidden';online=false;const before=h.requests;
   const {result,unmount}=renderHook(()=>useTvDisplayState(alias));
   await act(async()=>{await result.current.refetch();});expect(h.requests).toBe(before);
   visibility='visible';await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));await result.current.refetch();});
   expect(h.requests).toBe(before);
   online=true;await act(async()=>{window.dispatchEvent(new Event('online'));});
   await waitFor(()=>expect(result.current.state,JSON.stringify(h.errors)).toBe('ready'),{timeout:10000});
   expect(result.current.data?.tournamentName).toContain(name);expect(result.current.data?.totalEntries).toBe(entries);expect(result.current.data?.totalChips).toBe(chips);
   expect(h.requests).toBe(before+1);const snapshot=result.current.data;const callback=h.configs.at(-1)!;
   online=false;await act(async()=>{window.dispatchEvent(new Event('offline'));await result.current.refetch();callback();});
   expect(result.current.offline).toBe(true);expect(result.current.data).toEqual(snapshot);expect(h.requests).toBe(before+1);
   visibility='hidden';online=true;await act(async()=>{window.dispatchEvent(new Event('online'));await result.current.refetch();});
   expect(h.requests).toBe(before+1);
   visibility='visible';await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
   await waitFor(()=>expect(result.current.offline).toBe(false),{timeout:10000});
   expect(result.current.state).toBe('ready');expect(result.current.data?.tournamentName).toContain(name);expect(h.requests).toBe(before+2);
   const retired=result.current.refetch;unmount();await act(async()=>{await retired();callback();window.dispatchEvent(new Event('online'));});expect(h.requests).toBe(before+2);
   observations.push({alias,name,entries,chips,requests:2,suppressedHiddenOffline:true,lastGoodRetained:true,retiredRequests:0});
  }
  expect(h.errors).toEqual([]);expect(h.requests).toBe(6);
  writeFileSync('D:/Quy trình/output/reports/tv1222-hook-observations-local-20261028.json',JSON.stringify({kind:'ACTUAL_HOOK_SDK_HTTP_NATIVE_ANON_MODELED_VISIBILITY_NETWORK_AND_BROADCAST',observations,httpRequests:h.requests,errors:h.errors,browser:false,realRealtime:false,wholeJourney:false},null,2));
 },60000);
});
describe.skipIf(process.env.VINPOKER_TV1154_LOCAL!=='1')('owned native TV READ transport',()=>{
  it.skipIf(process.env.VINPOKER_TV1202_LOCAL==='1')('reads three exact scopes then prevents retired refetch/broadcast from sending another HTTP request',async()=>{
    vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
    vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
    const observations=[];
    for(const [alias,suffix,entries,chips] of [
      ['LOCAL1154-A','Flight A',8,0],['LOCAL1154-B','Flight B',8,0],['LOCAL1154-D2','Final Day',15,300000],
    ] as const){
      const {result,unmount}=renderHook(()=>useTvDisplayState(alias));
      await waitFor(()=>expect(result.current.state,JSON.stringify(h.errors)).toBe('ready'),{timeout:10000});
      expect(result.current.data?.tournamentName).toContain(suffix);
      expect(result.current.data?.totalEntries).toBe(entries);
      expect(result.current.data?.totalChips).toBe(chips);
      const refetch=result.current.refetch,config=h.configs.at(-1)!;
      expect(config).toBeTypeOf('function');
      observations.push({alias,name:result.current.data?.tournamentName,entries,chips});
      const before=h.requests;unmount();
      await act(async()=>{await refetch();config();await Promise.resolve();});
      expect(h.requests).toBe(before);
    }
    expect(h.requests).toBe(3);
    expect(h.errors).toEqual([]);
    writeFileSync('D:/Quy trình/output/reports/tv1154-hook-sdk-native-observations-local-20261027.json',JSON.stringify({kind:'ACTUAL_HOOK_SDK_HTTP_NATIVE_ANON_READ_MODEL_BROADCAST_NOT_BROWSER',observations,httpRequests:h.requests,retiredCallbacksAdditionalRequests:0,fullRealtimeAccepted:false,wholeJourneyAccepted:false},null,2)+'\n');
  }, 40_000); // Three serial native reads, each retaining the product's 10s deadline.
});


describe.skipIf(process.env.VINPOKER_TV1202_LOCAL!=='1')('same-hook native display scope transition',()=>{
 it('discards delayed A and retired A/B refetch and ready-B broadcast callback after D2 is ready',async()=>{
  vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
  h.requests=0;h.errors=[];h.configs=[];
  const tracePath='D:/Quy trình/output/reports/tv1202-switch-native-local-20261028.json';
  const runStarted=Date.now();
  const trace=()=>{const packet=JSON.parse(readFileSync(tracePath,'utf8'));return {...packet,http:packet.http.filter((r:{started:number})=>r.started>=runStarted)};};
  const {result,rerender,unmount}=renderHook(({token})=>useTvDisplayState(token),{initialProps:{token:'LOCAL1154-A'}});
  await waitFor(()=>expect(trace().http.some((r:{alias:string;outcome:string})=>r.alias==='LOCAL1154-A'&&r.outcome==='pending')).toBe(true),{timeout:10000});
  const oldA=result.current.refetch;expect(h.configs).toHaveLength(0);
  rerender({token:'LOCAL1154-B'});
  await waitFor(()=>expect(result.current.state).toBe('ready'),{timeout:10000});
  expect(result.current.data?.tournamentName).toContain('Flight B');
  const oldB=result.current.refetch,callbackB=h.configs.at(-1)!;
  rerender({token:'LOCAL1154-D2'});
  await waitFor(()=>expect(result.current.state).toBe('ready'),{timeout:10000});
  expect(result.current.data?.tournamentName).toContain('Final Day');
  const before=h.requests;
  await act(async()=>{await oldA();await oldB();callbackB();});
  expect(h.requests).toBe(before);
  await waitFor(()=>expect(trace().http.some((r:{alias:string;outcome:string})=>r.alias==='LOCAL1154-A'&&r.outcome==='native')).toBe(true),{timeout:10000});
  expect(result.current.data?.tournamentName).toContain('Final Day');
  expect(result.current.data?.totalEntries).toBe(15);
  expect(result.current.data?.totalChips).toBe(300000);
  expect(h.requests).toBe(3);
  const retired=result.current.refetch;unmount();await act(async()=>{await retired();});expect(h.requests).toBe(3);
  writeFileSync('D:/Quy trình/output/reports/tv1202-hook-observations-local-20261028.json',JSON.stringify({httpRequests:h.requests,errors:h.errors,retiredCallbacksAdditionalRequests:0,lateA:trace().http.find((r:{alias:string})=>r.alias==='LOCAL1154-A'),finalName:result.current.data?.tournamentName,entries:15,chips:300000,realRealtime:false,browser:false,wholeJourney:false},null,2));
 },30000);
});
