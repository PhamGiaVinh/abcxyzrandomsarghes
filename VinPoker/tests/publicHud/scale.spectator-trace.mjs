const marker='VINPOKER_SPECTATOR_RPC_TRACE ';
export function instrumentSpectatorWorker(source){
 const signature='export async function processPublicSpectatorJobs(';
 if(source.split(signature).length!==2)throw Error('Spectator worker instrumentation boundary changed');
 return source.replace(signature,'async function originalProcessPublicSpectatorJobs(')+`
export async function processPublicSpectatorJobs(client,deadline){
 const batch=crypto.randomUUID();
 return originalProcessPublicSpectatorJobs({rpc:async(name,args)=>{
  const startedAt=Date.now();let outcome='error';
  try{const reply=await client.rpc(name,args);outcome=reply.error?'error':name==='publish_public_spectator_projection_v2'?(reply.data===true?'published':'fenced'):'ok';return reply;}
  finally{try{
   const match=/^10000000-0000-4000-8000-([0-9a-f]{12})$/.exec(args.p_tournament_id??'');
   const index=match?parseInt(match[1],16):0;
   const scopeIndex=index>=1&&index<=20?index:null;
   const value=args.p_source_vector?.generation;
   const generation=scopeIndex!==null&&typeof value==='string'&&/^[0-9]{1,20}$/.test(value)?value:null;
   console.log(${JSON.stringify(marker)}+JSON.stringify({batch,rpc:name,component:args.p_component??null,startedAt,endedAt:Date.now(),outcome,scopeIndex,generation}));
  }catch{/* Telemetry cannot replace a business RPC result. */}}
 }},deadline);
}
`;
}
export function parseSpectatorTrace(log){
 const allowed=new Set(['absorb_public_spectator_generations_v2','flush_public_spectator_broadcast_v2','claim_public_spectator_projection_v2','get_public_spectator_projection_source_v2','publish_public_spectator_projection_v2','fail_public_spectator_projection_v2']);
 const events=[];
 for(const line of log.split('\n')){
  const at=line.indexOf(marker);if(at<0)continue;
  try{const row=JSON.parse(line.slice(at+marker.length).trim());
   if(!allowed.has(row.rpc)||!/^[a-f0-9-]{36}$/.test(row.batch)||!['tables','ranking','payout','visibility',null].includes(row.component)||!['ok','error','published','fenced'].includes(row.outcome)||!Number.isSafeInteger(row.startedAt)||!Number.isSafeInteger(row.endedAt)||row.endedAt<row.startedAt)continue;
   const event={batch:row.batch,rpc:row.rpc,component:row.component,startedAt:row.startedAt,endedAt:row.endedAt,outcome:row.outcome};
   if(Number.isInteger(row.scopeIndex)&&row.scopeIndex>=1&&row.scopeIndex<=20){
    event.scopeIndex=row.scopeIndex;
    if(typeof row.generation==='string'&&/^[0-9]{1,20}$/.test(row.generation))event.generation=row.generation;
   }
   events.push(event);
  }catch{/* Raw runtime logs never enter the artifact. */}
 }
 return events;
}
export function summarizeSpectatorTrace(events){
 const summary=values=>({samples:values.length,p95Ms:values.length?[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]:null,maxMs:values.length?values.reduce((max,value)=>Math.max(max,value),0):null});
 const byRpc={};
 for(const row of events)(byRpc[row.rpc]??=[]).push(row.endedAt-row.startedAt);
 const flushes=new Map();
 for(const row of events)if(row.rpc==='flush_public_spectator_broadcast_v2'&&row.outcome==='ok'){
  const rows=flushes.get(row.batch)??[];rows.push(row);flushes.set(row.batch,rows);
 }
 for(const rows of flushes.values())rows.sort((a,b)=>a.startedAt-b.startedAt);
 const wait=[],throughFlush=[];let published=0,withoutFollowingFlush=0;
 for(const row of events)if(row.rpc==='publish_public_spectator_projection_v2'&&row.outcome==='published'){
  published++;
  const flush=flushes.get(row.batch)?.find(candidate=>candidate.startedAt>=row.endedAt);
  if(!flush){withoutFollowingFlush++;continue;}
  wait.push(flush.startedAt-row.endedAt);throughFlush.push(flush.endedAt-row.endedAt);
 }
 return {rpcDurations:Object.fromEntries(Object.entries(byRpc).map(([rpc,values])=>[rpc,summary(values)])),published,withoutFollowingFlush,
  publishAckToNextSuccessfulFlushStart:summary(wait),publishAckToNextSuccessfulFlushEnd:summary(throughFlush),
  scope:'Same-batch successful flush starting after publish acknowledgement; not proof a particular tournament notification was emitted or delivered. Missing following flushes are counted, not treated as zero. Independent percentiles are not additive.'};
}
