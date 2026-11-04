// This public endpoint needs bounded anonymous PostgREST readers, not Auth/session,
// Storage or Realtime clients. Keep the transport stateless across callers.
export interface PublicHudRpcTiming {durationMs:number;outcome:'ok'|'http'|'transport'|'deadline'|'cancelled'}
export function createAnonymousPublicHudClient(baseUrl:string,anonKey:string,send:typeof fetch=fetch,requestSignal?:AbortSignal,observe?:(value:PublicHudRpcTiming)=>void,historyViaEdge=false){
 const base=new URL(baseUrl);
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error('PUBLIC_RPC_CONFIGURATION');
 return {async rpc(name:string,args:Record<string,unknown>):Promise<{data:unknown;error:unknown}>{
  if(!['get_public_player_hud_summary_v1','get_public_player_hud_history_v1','get_public_player_hud_summary_batch_v1'].includes(name))return {data:null,error:{code:'PUBLIC_RPC_NOT_ALLOWED'}};
  const controller=new AbortController();
  const started=performance.now();let deadline=false,httpFailure=false,outcome:PublicHudRpcTiming['outcome']='transport';
  const cancel=()=>controller.abort();
  if(requestSignal?.aborted)cancel();else requestSignal?.addEventListener('abort',cancel,{once:true});
  const timeout=setTimeout(()=>{deadline=true;cancel();},5000);
  try{
   const edgeHistory=historyViaEdge&&name==='get_public_player_hud_history_v1';
   if(edgeHistory&&Object.keys(args).some(key=>!['p_tournament_id','p_player_id','p_after_hand','p_after_time'].includes(key)))throw Error('PUBLIC_RPC_INVALID_ARGS');
   if(edgeHistory&&args.p_after_hand==null&&args.p_after_time!=null)throw Error('PUBLIC_RPC_INVALID_ARGS');
   const requestBody=edgeHistory?{mode:'history',tournament_id:args.p_tournament_id,player_id:args.p_player_id,
    ...(args.p_after_hand!=null?{cursor:{handId:args.p_after_hand,playedAt:args.p_after_time??null}}:{})}:args;
   const response=await send(new URL(edgeHistory?'/functions/v1/public-player-hud':'/rest/v1/rpc/'+name,base),{method:'POST',
    headers:{apikey:anonKey,...(anonKey.startsWith('sb_publishable_')?{}:{Authorization:`Bearer ${anonKey}`}),
     'Content-Type':'application/json','Content-Profile':'public','Accept-Profile':'public'},
    body:JSON.stringify(requestBody),signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store'});
   httpFailure=!response.ok;
   const body=await response.json();
   if(!response.ok){outcome='http';return {data:null,error:{code:typeof body?.code==='string'&&/^[A-Z0-9_]{5,24}$/.test(body.code)?body.code:`HTTP_${response.status}`}};}
   outcome='ok';
   return {data:body,error:null};
  }catch(error){
   const abortedFailure=error===controller.signal.reason||typeof error==='object'&&error!==null&&'name' in error&&error.name==='AbortError';
   outcome=deadline?'deadline':httpFailure?'http':requestSignal?.aborted&&abortedFailure?'cancelled':'transport';
   return {data:null,error:{code:'PUBLIC_RPC_TRANSPORT'}};
  }
  finally{
   clearTimeout(timeout);requestSignal?.removeEventListener('abort',cancel);
   // Observability cannot replace the public RPC's result or sanitized error.
   try{observe?.({durationMs:performance.now()-started,outcome});}catch{}
  }
 }};
}
