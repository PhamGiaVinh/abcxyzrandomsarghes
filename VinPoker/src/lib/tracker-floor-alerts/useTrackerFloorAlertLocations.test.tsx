// @vitest-environment jsdom
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {useTrackerFloorAlertLocations} from './useTrackerFloorAlertLocations';
const alerts=[{physical_table_id:'table',hand_id:'hand'}];
const good={tables:{data:[{id:'table',table_number:2}],error:null},
 hands:{data:[{id:'hand',hand_number:28,status:'in_progress',is_voided:false}],error:null}};
function client(read:(name:string)=>unknown,signals:AbortSignal[]=[]){
 return {from:(name:string)=>({select:()=>({in:()=>{
  const value=Promise.resolve().then(()=>read(name));
  return Object.assign(value,{abortSignal:(signal:AbortSignal)=>{signals.push(signal);return value;}});
 }})})} as unknown as SupabaseClient;
}
afterEach(()=>{cleanup();vi.useRealTimers();});
it('does not present a failed metadata response as a verified hand location',async()=>{
 const c=client(name=>({...good[name==='game_tables'?'tables':'hands'],error:{message:'503'}}));
 const h=renderHook(()=>useTrackerFloorAlertLocations(c,alerts));
 await waitFor(()=>expect(h.result.current(alerts[0])).toEqual({unavailable:true}));
});
it('marks a missing table or hand as unavailable instead of silently treating it as not voided',async()=>{
 const c=client(name=>name==='game_tables'?good.tables:{data:[],error:null});
 const h=renderHook(()=>useTrackerFloorAlertLocations(c,alerts));
 await waitFor(()=>expect(h.result.current(alerts[0])).toEqual({unavailable:true}));
});
it('bounds a hung metadata read and ignores its late response',async()=>{
 let finish!:(value:unknown)=>void;
 const signals:AbortSignal[]=[];
 const c=client(name=>name==='game_tables'?good.tables:new Promise(resolve=>{finish=resolve;}),signals);
 vi.useFakeTimers();
 const h=renderHook(()=>useTrackerFloorAlertLocations(c,alerts));
 await act(async()=>{await vi.advanceTimersByTimeAsync(11000);});
 expect(h.result.current(alerts[0])).toEqual({unavailable:true});
 expect(signals).toHaveLength(2);expect(signals.every(signal=>signal.aborted)).toBe(true);
 await act(async()=>{finish(good.hands);});
 expect(h.result.current(alerts[0])).toEqual({unavailable:true});
});
it('catches a rejected metadata transport without an unhandled promise',async()=>{
 const c=client(()=>Promise.reject(new Error('network unavailable')));
 const h=renderHook(()=>useTrackerFloorAlertLocations(c,alerts));
 await waitFor(()=>expect(h.result.current(alerts[0])).toEqual({unavailable:true}));
});
it('recovers a valid location on refresh and never applies an older client response',async()=>{
 let finish!:(value:unknown)=>void;
 const old=client(name=>name==='game_tables'?good.tables:new Promise(resolve=>{finish=resolve;}));
 const current=client(name=>good[name==='game_tables'?'tables':'hands']);
 const h=renderHook(({c})=>useTrackerFloorAlertLocations(c,alerts),{initialProps:{c:old}});
 await act(async()=>{await Promise.resolve();});
 h.rerender({c:current});
 await waitFor(()=>expect(h.result.current(alerts[0])).toEqual({tableNumber:2,handNumber:28,handStatus:'in_progress',handVoided:false}));
 await act(async()=>{finish({data:[{id:'hand',hand_number:99,status:'completed',is_voided:true}],error:null});});
 expect(h.result.current(alerts[0])?.handNumber).toBe(28);
});
