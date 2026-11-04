// This public endpoint needs bounded anonymous PostgREST readers, not Auth/session,
// Storage or Realtime clients. Keep the transport stateless across callers.
export interface PublicHudRpcTiming {durationMs:number;outcome:'ok'|'http'|'transport'|'deadline'|'cancelled'}
export function createAnonymousPublicHudClient(baseUrl:string,anonKey:string,send:typeof fetch=fetch,requestSignal?:AbortSignal,observe?:(value:PublicHudRpcTiming)=>void){
 const base=new URL(baseUrl);
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error('PUBLIC_RPC_CONFIGURATION');
 return {async rpc(name:string,args:Record<string,unknown>):Promise<{data:unknown;error:unknown}>{
  if(!['get_public_player_hud_summary_v1','get_public_player_hud_history_v1','get_public_player_hud_summary_batch_v1'].includes(name))return {data:null,error:{code:'PUBLIC_RPC_NOT_ALLOWED'}};
  const controller=new AbortController();
  const started=performance.now();let deadline=false,outcome:PublicHudRpcTiming['outcome']='transport';
  const cancel=()=>controller.abort();
  if(requestSignal?.aborted)cancel();else requestSignal?.addEventListener('abort',cancel,{once:true});
  const timeout=setTimeout(()=>{deadline=true;cancel();},5000);
  try{
   const response=await send(new URL('/rest/v1/rpc/'+name,base),{method:'POST',
    headers:{apikey:anonKey,Authorization:`Bearer ${anonKey}`,'Content-Type':'application/json','Content-Profile':'public','Accept-Profile':'public'},
    body:JSON.stringify(args),signal:controller.signal,redirect:'error'});
   const body=await response.json();
   if(!response.ok){outcome='http';return {data:null,error:{code:typeof body?.code==='string'&&/^[A-Z0-9_]{5,24}$/.test(body.code)?body.code:`HTTP_${response.status}`}};}
   outcome='ok';
   return {data:body,error:null};
  }catch{outcome=requestSignal?.aborted?'cancelled':deadline?'deadline':'transport';return {data:null,error:{code:'PUBLIC_RPC_TRANSPORT'}};}
  finally{
   clearTimeout(timeout);requestSignal?.removeEventListener('abort',cancel);
   // Observability cannot replace the public RPC's result or sanitized error.
   try{observe?.({durationMs:performance.now()-started,outcome});}catch{}
  }
 }};
}
