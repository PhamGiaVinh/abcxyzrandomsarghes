interface Pending {controller:AbortController;promise:Promise<unknown>;users:number}
const clients=new WeakMap<object,Map<string,Pending>>();
/** Share in-flight public reads only. Never reuse data after a scope is closed. */
export function sharePublicTournamentRead<T>(client:object,key:string,signal:AbortSignal,read:(signal:AbortSignal)=>PromiseLike<T>):Promise<T>{
  if(signal.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
  let entries=clients.get(client);if(!entries){entries=new Map();clients.set(client,entries);}
  let pending=entries.get(key);
  if(!pending){
    const controller=new AbortController();
    pending={controller,users:0,promise:Promise.resolve()};
    entries.set(key,pending);
    try{pending.promise=Promise.resolve(read(controller.signal));}
    catch(error){pending.promise=Promise.reject(error);}
    const owned=pending;
    void pending.promise.finally(()=>{if(entries!.get(key)===owned)entries!.delete(key);}).catch(()=>{});
  }
  const owned=pending;owned.users++;
  return new Promise<T>((resolve,reject)=>{
    let finished=false;
    const release=()=>{if(finished)return;finished=true;signal.removeEventListener('abort',abort);owned.users--;if(!owned.users){owned.controller.abort();if(entries!.get(key)===owned)entries!.delete(key);}};
    const abort=()=>{release();reject(new DOMException('Aborted','AbortError'));};
    signal.addEventListener('abort',abort,{once:true});
    owned.promise.then(value=>{if(finished)return;release();resolve(value as T);},error=>{if(finished)return;release();reject(error);});
  });
}
