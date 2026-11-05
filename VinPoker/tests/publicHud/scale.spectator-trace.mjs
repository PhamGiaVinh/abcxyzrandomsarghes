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
  finally{try{console.log(${JSON.stringify(marker)}+JSON.stringify({batch,rpc:name,component:args.p_component??null,startedAt,endedAt:Date.now(),outcome}));}catch{/* Telemetry cannot replace a business RPC result. */}}
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
   events.push({batch:row.batch,rpc:row.rpc,component:row.component,startedAt:row.startedAt,endedAt:row.endedAt,outcome:row.outcome});
  }catch{/* Raw runtime logs never enter the artifact. */}
 }
 return events;
}
