import {createAnonymousPublicHudClient} from './publicRpc.ts';
import type {PublicHudRpcTiming} from './publicRpc.ts';
type Reply={data:unknown;error:unknown};
export type PublicHudReadTiming=PublicHudRpcTiming&{groupSize:number};
const unavailable=():Reply=>({data:null,error:{code:'PUBLIC_RPC_TRANSPORT'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function summaryReplies(reply:Reply,snapshots:(string|null)[]):Map<string|null,Reply>{
 if(reply.error)return new Map(snapshots.map(s=>[s,reply]));
 const data=reply.data as {version?:unknown;summary?:Record<string,unknown>;checks?:unknown};
 if(!data||data.version!=='public-hud-summary-batch-v1'||!data.summary||typeof data.summary!=='object'||Array.isArray(data.summary)||!Array.isArray(data.checks)||data.checks.length!==snapshots.length)throw Error('PUBLIC_RPC_BATCH_INVALID');
 const replies=new Map<string|null,Reply>();
 for(const value of data.checks){
  if(!value||typeof value!=='object')throw Error('PUBLIC_RPC_BATCH_INVALID');
  const c=value as {snapshot:string|null;valid:boolean;accessChanged:boolean};
  if(!snapshots.includes(c.snapshot)||replies.has(c.snapshot)||typeof c.valid!=='boolean'||typeof c.accessChanged!=='boolean')throw Error('PUBLIC_RPC_BATCH_INVALID');
  const ready=data.summary.access==='public'&&['current','updating'].includes(String(data.summary.state));
  replies.set(c.snapshot,c.valid?{data:ready?{...data.summary,accessChanged:c.accessChanged}:data.summary,error:null}:{data:null,error:{code:'PUBLIC_SNAPSHOT_INVALID'}});
 }
 return replies;
}
function normalized(name:string,args:Record<string,unknown>):Record<string,unknown>|null{
 if(name==='get_public_tournament_table_live_or_last_hand_v2'){
  if(Object.keys(args).length!==2||typeof args.p_tournament_id!=='string'||!uuid.test(args.p_tournament_id)||
   typeof args.p_tournament_table_id!=='string'||!uuid.test(args.p_tournament_table_id))return null;
  return {p_tournament_id:args.p_tournament_id,p_tournament_table_id:args.p_tournament_table_id};
 }
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
 type Waiter={started:number;done:boolean;snapshot:string|null;finish:(reply:Reply,outcome:PublicHudRpcTiming['outcome'],size:number)=>void};
 type Group={name:string;args:Record<string,unknown>;key:string;bytes:number;snapshotBytes:number;snapshots:Map<string|null,{count:number;bytes:number}>;controller:AbortController;waiters:Set<Waiter>;timer:ReturnType<typeof setTimeout>};
 const pending=new Map<string,Group>();let pendingBytes=0,totalWaiters=0;
 const remove=(g:Group)=>{if(pending.get(g.key)===g){pending.delete(g.key);pendingBytes-=g.bytes;}};
 const direct=(name:string,args:Record<string,unknown>,signal:AbortSignal,observe?:(v:PublicHudReadTiming)=>void)=>
  createAnonymousPublicHudClient(url,key,send,signal,v=>observe?.({...v,groupSize:1})).rpc(name,args);
 return {forRequest(signal:AbortSignal,observe?:(v:PublicHudReadTiming)=>void){return {rpc(name:string,args:Record<string,unknown>):Promise<Reply>{
  const safe=normalized(name,args);
  if(!safe)return direct(name,args,signal,observe);
  const summary=name==='get_public_player_hud_summary_v1',snapshot=summary?safe.p_access_snapshot as string|null:null;
  const groupKey=JSON.stringify([name,summary?{p_tournament_id:safe.p_tournament_id,p_player_id:safe.p_player_id}:safe]);
  const bytes=new TextEncoder().encode(groupKey).length;
  let group=pending.get(groupKey);
  const addedSnapshotBytes=summary&&!group?.snapshots.has(snapshot)&&snapshot!==null?new TextEncoder().encode(snapshot).length:0;
  // Saturation bypasses batching with the original fresh read, never stale data.
  if(bytes>16384||totalWaiters>=2048||group&&group.waiters.size>=256||!group&&pending.size>=128||
   pendingBytes+(group?0:bytes)+addedSnapshotBytes>262144||
   summary&&((group?.snapshotBytes??0)+addedSnapshotBytes>16384||group&&!group.snapshots.has(snapshot)&&group.snapshots.size>=64))return direct(name,safe,signal,observe);
  if(!group){
   group={name,args:safe,key:groupKey,bytes,snapshotBytes:0,snapshots:new Map(),controller:new AbortController(),waiters:new Set(),timer:undefined!};
   const owned=group;pending.set(groupKey,owned);pendingBytes+=bytes;
   owned.timer=setTimeout(()=>{
    // This synchronous removal precedes fetch/DB snapshot acquisition. A late
    // open (including one after withdrawal) necessarily starts a new query.
    remove(owned);const size=owned.waiters.size;if(!size)return;
    const snapshots=[...owned.snapshots.keys()],batch=summary&&snapshots.length>1;
    const rpcName=batch?'get_public_player_hud_summary_batch_v1':owned.name;
    const rpcArgs=summary?{p_tournament_id:owned.args.p_tournament_id,p_player_id:owned.args.p_player_id,
     ...(batch?{p_access_snapshots:snapshots}:{p_access_snapshot:snapshots[0]})}:owned.args;
    let timing:PublicHudRpcTiming|undefined;
    void createAnonymousPublicHudClient(url,key,send,owned.controller.signal,v=>{timing=v;}).rpc(rpcName,rpcArgs)
     .then(reply=>{const mapped=batch?summaryReplies(reply,snapshots):null;for(const waiter of [...owned.waiters])waiter.finish(mapped?mapped.get(waiter.snapshot)!:reply,timing?.outcome??'transport',size);})
     .catch(()=>{for(const waiter of [...owned.waiters])waiter.finish(unavailable(),'transport',size);});
   },5);
  }
  const owned=group;
  return new Promise<Reply>(resolve=>{
   const waiter:Waiter={started:performance.now(),done:false,snapshot,finish:()=>{}};
   let deadline:ReturnType<typeof setTimeout>;
   const abort=()=>waiter.finish(unavailable(),'cancelled',owned.waiters.size);
   waiter.finish=(reply,outcome,size)=>{
    if(waiter.done)return;waiter.done=true;clearTimeout(deadline);signal.removeEventListener('abort',abort);owned.waiters.delete(waiter);totalWaiters--;
    if(summary){const slot=owned.snapshots.get(snapshot)!;if(--slot.count===0){owned.snapshots.delete(snapshot);owned.snapshotBytes-=slot.bytes;owned.bytes-=slot.bytes;if(pending.get(groupKey)===owned)pendingBytes-=slot.bytes;}}
    if(!owned.waiters.size){remove(owned);clearTimeout(owned.timer);owned.controller.abort();}
    try{observe?.({durationMs:performance.now()-waiter.started,outcome,groupSize:Math.max(1,size)});}catch{}
    // Each consumer owns its JSON; mutation cannot affect another HUD.
    try{resolve(structuredClone(reply));}catch{resolve(unavailable());}
   };
   owned.waiters.add(waiter);totalWaiters++;
   if(summary){const slot=owned.snapshots.get(snapshot);if(slot)slot.count++;else{owned.snapshots.set(snapshot,{count:1,bytes:addedSnapshotBytes});owned.snapshotBytes+=addedSnapshotBytes;owned.bytes+=addedSnapshotBytes;pendingBytes+=addedSnapshotBytes;}}
   // Preserve the original five-second deadline from this invocation, including
   // admission time; one waiter's deadline must not cancel surviving readers.
   deadline=setTimeout(()=>waiter.finish(unavailable(),'deadline',owned.waiters.size),5000);
   if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  });
 }};}};
}
