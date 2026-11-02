import {useCallback,useEffect,useRef,useState} from 'react';

/** Read lifecycle only. Inbox owns its data in the keyed actor/session subtree. */
export function useInboxReadLane<T>(scope:string|null,read:(signal:AbortSignal)=>Promise<T>,publish:(value:T)=>void,failed:()=>void){
  const handlers=useRef({read,publish,failed});handlers.current={read,publish,failed};
  const [busy,setBusy]=useState(true);
  const refreshRef=useRef<()=>Promise<void>>(()=>Promise.resolve());
  const refresh=useCallback(()=>refreshRef.current(),[]);
  useEffect(()=>{
    if(!scope){setBusy(false);return;}
    let active=true,pending=false,flight:Promise<void>|null=null,controller:AbortController|null=null;
    const run=():Promise<void>=>{
      if(!active)return Promise.resolve();
      if(flight){pending=true;return flight;}
      const request=new AbortController();controller=request;
      setBusy(true);
      flight=Promise.resolve().then(async()=>{
        let deadline:ReturnType<typeof setTimeout>|undefined;
        const interrupted=new Promise<never>((_,reject)=>{
          request.signal.addEventListener('abort',()=>reject(new Error('inbox_read_cancelled')),{once:true});
          deadline=setTimeout(()=>request.abort(),15_000);
        });
        try{
          if(!active||request.signal.aborted)return;
          const value=await Promise.race([handlers.current.read(request.signal),interrupted]);
          if(active&&!request.signal.aborted)handlers.current.publish(value);
        }catch{
          if(active)handlers.current.failed();
        }finally{
          clearTimeout(deadline);request.abort();
          if(controller===request)controller=null;
          if(active)setBusy(false);
        }
      }).finally(()=>{
        flight=null;
        if(pending&&active){pending=false;void run();}
      });
      return flight;
    };
    refreshRef.current=run;void run();
    return ()=>{active=false;controller?.abort();refreshRef.current=()=>Promise.resolve();};
  },[scope]);
  return {busy,refresh};
}
