// This public endpoint needs two anonymous PostgREST readers, not Auth/session,
// Storage or Realtime clients. Keep the transport stateless across callers.
export function createAnonymousPublicHudClient(baseUrl:string,anonKey:string,send:typeof fetch=fetch,requestSignal?:AbortSignal){
 const base=new URL(baseUrl);
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error('PUBLIC_RPC_CONFIGURATION');
 return {async rpc(name:string,args:Record<string,unknown>):Promise<{data:unknown;error:unknown}>{
  if(!['get_public_player_hud_summary_v1','get_public_player_hud_history_v1'].includes(name))return {data:null,error:{code:'PUBLIC_RPC_NOT_ALLOWED'}};
  try{
   const response=await send(new URL('/rest/v1/rpc/'+name,base),{method:'POST',
    headers:{apikey:anonKey,Authorization:`Bearer ${anonKey}`,'Content-Type':'application/json','Content-Profile':'public','Accept-Profile':'public'},
    body:JSON.stringify(args),signal:requestSignal?AbortSignal.any([requestSignal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000),redirect:'error'});
   const body=await response.json();
   if(!response.ok)return {data:null,error:{code:typeof body?.code==='string'&&/^[A-Z0-9_]{5,24}$/.test(body.code)?body.code:`HTTP_${response.status}`}};
   return {data:body,error:null};
  }catch{return {data:null,error:{code:'PUBLIC_RPC_TRANSPORT'}};}
 }};
}
