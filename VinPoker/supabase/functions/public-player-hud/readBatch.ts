import {createAnonymousPublicHudClient} from './publicRpc.ts';
import type {PublicHudRpcTiming} from './publicRpc.ts';
type Reply={data:unknown;error:unknown};
export type PublicHudReadTiming=PublicHudRpcTiming&{groupSize:number};
const unavailable=():Reply=>({data:null,error:{code:'PUBLIC_RPC_TRANSPORT'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function normalized(name:string,args:Record<string,unknown>):Record<string,unknown>|null{
 if(typeof args.p_tournament_id!=='string'||!uuid.test(args.p_tournament_id)||typeof args.p_player_id!=='string'||!uuid.test(args.p_player_id))return null;
 const scope={p_tournament_id:args.p_tournament_id,p_player_id:args.p_player_id};
 if(name==='get_public_player_hud_summary_v1'){
  const snapshot=args.p_access_snapshot??null;
  if(Object.keys(args).some(k=>!['p_tournament_id','p_player_id','p_access_snapshot'].includes(k))||
   (snapshot!==null&&(typeof snapshot!=='string'||snapshot.length>8192||!/^\d+:\d+:(\d+(,\d+)*)?$/.test(snapshot))))return null;
  return {...scope,p_access_snapshot:snapshot};
 }
 if(name==='get_public_player_hud_history_v1'){
  const hand=args.p_after_hand??null,time=args.p_after_time??null;
  if(Object.keys(args).some(k=>!['p_tournament_id','p_player_id','p_after_hand','p_after_time'].includes(k))||
   (hand!==null&&(typeof hand!=='string'||!uuid.test(hand)))||
   (time!==null&&(hand===null||typeof time!=='string'||!Number.isFinite(Date.parse(time)))))return null;
  return {...scope,p_after_hand:hand,p_after_time:time};
 }
 return null;
}

/** Share only requests admitted BEFORE the rights/data query starts, never its
 * in-flight/completed result with a later arrival. Fixed anonymous transport. */
export function createPublicHudReadBatcher(url:string,key:string,send:typeof fetch=fetch){
 createAnonymousPublicHudClient(url,key,send); // Validate immutable configuration.
 type Waiter={started:number;done:boolean;finish:(reply:Reply,outcome:PublicHudRpcTiming['outcome'],size:number)=>void};
 type Group={name:string;args:Record<string,unknown>;key:string;bytes:number;controller:AbortController;waiters:Set<Waiter>;timer:ReturnType<typeof setTimeout>};
 const pending=new Map<string,Group>();let pendingBytes=0,totalWaiters=0;
 const remove=(g:Group)=>{if(pending.get(g.key)===g){pending.delete(g.key);pendingBytes-=g.bytes;}};
 const direct=(name:string,args:Record<string,unknown>,signal:AbortSignal,observe?:(v:PublicHudReadTiming)=>void)=>
  createAnonymousPublicHudClient(url,key,send,signal,v=>observe?.({...v,groupSize:1})).rpc(name,args);
 return {forRequest(signal:AbortSignal,observe?:(v:PublicHudReadTiming)=>void){return {rpc(name:string,args:Record<string,unknown>):Promise<Reply>{
  const safe=normalized(name,args);
  if(!safe)return direct(name,args,signal,observe);
  const groupKey=JSON.stringify([name,safe]),bytes=new TextEncoder().encode(groupKey).length;
  let group=pending.get(groupKey);
  // Saturation bypasses batching with the original fresh read, never stale data.
  if(bytes>16384||totalWaiters>=2048||group&&group.waiters.size>=256||!group&&(pending.size>=128||pendingBytes+bytes>262144))return direct(name,safe,signal,observe);
  if(!group){
   group={name,args:safe,key:groupKey,bytes,controller:new AbortController(),waiters:new Set(),timer:undefined!};
   const owned=group;pending.set(groupKey,owned);pendingBytes+=bytes;
   owned.timer=setTimeout(()=>{
    // This synchronous removal precedes fetch/DB snapshot acquisition. A late
    // open (including one after withdrawal) necessarily starts a new query.
    remove(owned);const size=owned.waiters.size;if(!size)return;
    let timing:PublicHudRpcTiming|undefined;
    void createAnonymousPublicHudClient(url,key,send,owned.controller.signal,v=>{timing=v;}).rpc(owned.name,owned.args)
     .then(reply=>{for(const waiter of [...owned.waiters])waiter.finish(reply,timing?.outcome??'transport',size);})
     .catch(()=>{for(const waiter of [...owned.waiters])waiter.finish(unavailable(),'transport',size);});
   },5);
  }
  const owned=group;
  return new Promise<Reply>(resolve=>{
   const waiter:Waiter={started:performance.now(),done:false,finish:()=>{}};
   let deadline:ReturnType<typeof setTimeout>;
   const abort=()=>waiter.finish(unavailable(),'cancelled',owned.waiters.size);
   waiter.finish=(reply,outcome,size)=>{
    if(waiter.done)return;waiter.done=true;clearTimeout(deadline);signal.removeEventListener('abort',abort);owned.waiters.delete(waiter);totalWaiters--;
    if(!owned.waiters.size){remove(owned);clearTimeout(owned.timer);owned.controller.abort();}
    try{observe?.({durationMs:performance.now()-waiter.started,outcome,groupSize:Math.max(1,size)});}catch{}
    // Each consumer owns its JSON; mutation cannot affect another HUD.
    try{resolve(structuredClone(reply));}catch{resolve(unavailable());}
   };
   owned.waiters.add(waiter);totalWaiters++;
   // Preserve the original five-second deadline from this invocation, including
   // admission time; one waiter's deadline must not cancel surviving readers.
   deadline=setTimeout(()=>waiter.finish(unavailable(),'deadline',owned.waiters.size),5000);
   if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  });
 }};}};
}
