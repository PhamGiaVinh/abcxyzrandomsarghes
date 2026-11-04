// Opt-in disposable-stack telemetry. Never includes request bodies or identities.
export function createIsolateDiagnostics(enabled:boolean,emit:(value:Record<string,unknown>)=>void,now=()=>performance.now()){
 const started=now();let received=0,completed=0,active=0;
 return {
  begin(){
   if(!enabled)return ()=>{};
   received++;active++;let done=false;
   return ()=>{if(!done){done=true;active--;completed++;}};
  },
  shutdown(reason:unknown){
   if(!enabled)return;
   const safe=typeof reason==='string'&&['CPUTime','WallClockTime','Memory','MemoryLimit','EarlyDrop','TerminationRequested'].includes(reason)?reason:'unknown';
   try{emit({kind:'PUBLIC_HUD_ISOLATE_SHUTDOWN',reason:safe,ageMs:Math.max(0,Math.round(now()-started)),received,completed,active});}catch{}
  },
 };
}
