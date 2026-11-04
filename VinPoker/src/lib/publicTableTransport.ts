import type {PostgrestSingleResponse} from '@supabase/supabase-js';
const callerCancelled=()=>Object.assign(new DOMException('Aborted','AbortError'),{publicTableCallerCancelled:true});

// Shared by the real spectator and load generator. No user session, response
// cache, retry, or direct-RPC fallback is installed on this public Edge read.
export async function readPublicTableRequest(baseUrl:string,key:string,tournamentId:string,tableId:string,signal:AbortSignal,send:typeof fetch=fetch):Promise<PostgrestSingleResponse<unknown>>{
 if(signal.aborted)throw callerCancelled();
 const base=new URL(baseUrl);
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error('PUBLIC_TABLE_CONFIGURATION');
 const controller=new AbortController();let deadline=false;
 const abort=()=>controller.abort(signal.reason);
 if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>{deadline=true;controller.abort();},5000);
 try{
  const response=await send(new URL('/functions/v1/public-player-hud',base),{
   method:'POST',headers:{apikey:key,...(key.startsWith('sb_publishable_')?{}:{Authorization:`Bearer ${key}`}), 'Content-Type':'application/json'},
   body:JSON.stringify({mode:'current_table',tournament_id:tournamentId,table_id:tableId}),signal:controller.signal,
   cache:'no-store',credentials:'omit',redirect:'error',
  });
  if(!response.ok)throw Object.assign(Error('PUBLIC_TABLE_UNAVAILABLE'),{publicTableHttpStatus:response.status});
  const data=await response.json();
  if(deadline)throw Object.assign(Error('PUBLIC_TABLE_DEADLINE'),{name:'TimeoutError'});
  if(signal.aborted)throw callerCancelled();
  return {data,error:null,count:null,status:response.status,statusText:response.statusText,success:true};
 }catch(error){
  if(deadline)throw Object.assign(Error('PUBLIC_TABLE_DEADLINE'),{name:'TimeoutError'});
  const aborted=error===controller.signal.reason||typeof error==='object'&&error!==null&&'name' in error&&error.name==='AbortError';
  if(signal.aborted&&aborted)throw callerCancelled();
  const status=(error as {publicTableHttpStatus?:unknown})?.publicTableHttpStatus;
  throw Object.assign(Error('PUBLIC_TABLE_UNAVAILABLE'),typeof status==='number'?{publicTableHttpStatus:status}:{});
 }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
