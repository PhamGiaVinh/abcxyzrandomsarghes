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
   // Pinned runtime v1.77.9 types/global.d.ts emits a string detail.
   // Also accept the reason-object shape documented by older hosted examples.
   const raw=reason&&typeof reason==='object'&&!Array.isArray(reason)?(reason as {reason?:unknown}).reason:reason;
   const aliases:Record<string,string>={cpu:'CPUTime',memory:'Memory',wall_clock:'WallClockTime',early_drop:'EarlyDrop',termination:'TerminationRequested'};
   reason=typeof raw==='string'?(aliases[raw]??raw):raw;
   const safe=typeof reason==='string'&&['CPUTime','WallClockTime','Memory','MemoryLimit','EarlyDrop','TerminationRequested'].includes(reason)?reason:'unknown';
   try{emit({kind:'PUBLIC_HUD_ISOLATE_SHUTDOWN',reason:safe,ageMs:Math.max(0,Math.round(now()-started)),received,completed,active});}catch{}
  },
 };
}
