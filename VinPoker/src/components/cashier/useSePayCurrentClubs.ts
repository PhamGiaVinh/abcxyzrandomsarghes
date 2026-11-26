import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Current server membership, independent of a still-open parent's cached club list. */
export function useSePayCurrentClubs(actorId:string,initialIds:string[],enabled:boolean){
 const [state,setState]=useState<{clubIds:string[]|null;error:string|null}>({clubIds:null,error:null});
 const alive=useRef(false),generation=useRef(0),flight=useRef<AbortController|null>(null);
 const refresh=useCallback(async()=>{
  if(!enabled||!alive.current||flight.current)return;
  const revision=++generation.current,controller=new AbortController();flight.current=controller;
  try{
   const {data,error}=await observeTrackerContextRead(supabase.rpc('cashier_club_ids',{_user_id:actorId}).abortSignal(controller.signal));
   if(!alive.current||revision!==generation.current)return;
   if(error||!Array.isArray(data)||!data.every(id=>typeof id==='string'&&uuid.test(id))||new Set(data).size!==data.length)throw Error('unverified_cashier_membership');
   const clubIds=[...data].sort();
   setState(previous=>previous.clubIds?.join(',')===clubIds.join(',')&&!previous.error?previous:{clubIds,error:null});
  }catch{
   if(alive.current&&revision===generation.current)setState({clubIds:null,error:'Chưa xác minh được quyền đối soát. Hãy thử lại.'});
  }finally{controller.abort();if(flight.current===controller)flight.current=null;}
 },[actorId,enabled]);
 useEffect(()=>{
  alive.current=true;void refresh();
  const timer=enabled?window.setInterval(()=>void refresh(),5000):undefined;
  return()=>{alive.current=false;generation.current++;window.clearInterval(timer);flight.current?.abort();flight.current=null;};
 },[refresh,enabled]);
 return enabled?{...state,refresh}:{clubIds:initialIds,error:null,refresh};
}
