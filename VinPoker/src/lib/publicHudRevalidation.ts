// A withdrawn HUD must remain empty while the source-removal transaction is
// being projected. HUD opening/access revalidation uses this preparation loop;
// successful/open HUDs and transport failures never start background polling.
export const PUBLIC_HUD_REVALIDATION_WINDOW_MS=5_000;
class PreparationWaitAborted extends Error {}
const cancelled=()=>Object.assign(Error('aborted'),{publicHudCallerCancelled:true});
const deadline=()=>Object.assign(Error('PUBLIC_HUD_UNAVAILABLE'),{publicHudDeadline:true});

export async function revalidatePublicHudRead<T extends Record<string,unknown>>(
 read:(signal:AbortSignal)=>Promise<T>,signal:AbortSignal,onPreparing?:()=>void,
):Promise<T>{
 if(signal.aborted)throw cancelled();
 const budget=new AbortController();
 let expired=false;
 const timer=setTimeout(()=>{expired=true;budget.abort();},PUBLIC_HUD_REVALIDATION_WINDOW_MS);
 // A real user close wins if it happens first; a later close must not erase an
 // already-fired revalidation/HTTP deadline.
 const stopBudget=()=>{clearTimeout(timer);budget.abort(signal.reason);};
 signal.addEventListener('abort',stopBudget,{once:true});
 const owned=budget.signal;
 let notified=false;
 try{
  while(true){
   const value=await read(owned);
   if(expired)throw deadline();
   if(signal.aborted)throw cancelled();
   if(value.access!=='public'||value.state!=='unavailable')return value;
   // The server's withdrawal barrier contains no old metrics. Do not convert a
   // malformed/stale-data response into an apparently safe preparation state.
   if(Object.keys(value).some(key=>key!=='access'&&key!=='state'))throw Error('PUBLIC_HUD_INVALID_PREPARATION');
   if(!notified){notified=true;onPreparing?.();}
   await new Promise<void>((resolve,reject)=>{
    let waiting:ReturnType<typeof setTimeout>;
    const cleanup=()=>{clearTimeout(waiting);owned.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(new PreparationWaitAborted());};
    if(owned.aborted){abort();return;}
    waiting=setTimeout(()=>{cleanup();resolve();},250+Math.random()*250);
    owned.addEventListener('abort',abort,{once:true});
   });
  }
 }catch(error){
  if(error instanceof PreparationWaitAborted){
   if(expired)throw Object.assign(Error('PUBLIC_HUD_PREPARING'),{publicHudRevalidationExpired:true});
   throw cancelled();
  }
  if((error as {publicHudCallerCancelled?:boolean})?.publicHudCallerCancelled&&expired)throw deadline();
  // Preserve known HTTP/network/counter failures even if the user closes late.
  throw error;
 }finally{
  clearTimeout(timer);signal.removeEventListener('abort',stopBudget);budget.abort();
 }
}
