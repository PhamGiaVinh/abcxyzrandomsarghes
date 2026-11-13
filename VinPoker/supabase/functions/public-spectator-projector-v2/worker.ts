import {reducePublicSpectatorPayload} from '../_shared/publicSpectatorReducer.ts';
import {decodeSourceBatch} from './sourceBatch.ts';
interface Client {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>}
interface WorkGroup {tournament_id:string;component:'tables'|'ranking'|'payout'|'visibility';group_key:string;fencing_token:string}
export async function processPublicSpectatorJobs(client:Client,deadline=Date.now()+5_000,sourceMode:'single'|'batch'='single'){
  const call=(name:string,args:Record<string,unknown>)=>{
    if(Date.now()>=deadline)throw Error('deadline_exceeded');
    return client.rpc(name,args);
  };
  let lastFlushStartedAt=Date.now();
  // Existing committed notifications need not wait for deferred generations.
  // Drain BOTH calls even on failure; no claim may escape an unfinished startup
  // transaction. Rows queued by absorption remain durable for the final flush.
  const [absorbed,flushed]=await Promise.allSettled([
    Promise.resolve().then(()=>call('absorb_public_spectator_generations_v2',{p_limit:100})),
    Promise.resolve().then(()=>call('flush_public_spectator_broadcast_v2',{p_limit:100})),
  ]);
  if(absorbed.status==='rejected')throw absorbed.reason;
  if(absorbed.value.error)throw Error('generation_absorb_failed');
  if(flushed.status==='rejected')throw flushed.reason;
  if(flushed.value.error)throw Error('broadcast_flush_failed');
  const claimed=await call('claim_public_spectator_projection_v2',{p_limit:50});
  if(claimed.error||!Array.isArray(claimed.data))throw Error('claim_failed');
  const jobs=claimed.data as WorkGroup[],results:Array<{key:string;published:boolean;error?:string}>=[];
  let cursor=0;
  let earlyFlush:Promise<void>|null=null;
  const requestFlush=()=>{
    if(earlyFlush||Date.now()-lastFlushStartedAt<100||Date.now()>=deadline)return;
    // Stream committed publications without waiting for the slowest job.
    // One tracked RPC only; pending rows stay in the outbox for the final flush.
    earlyFlush=Promise.resolve().then(async()=>{
      lastFlushStartedAt=Date.now();
      try{await call('flush_public_spectator_broadcast_v2',{p_limit:100});}
      catch{/* A committed publication stays committed; durable outbox retries. */}
    }).finally(()=>{earlyFlush=null;});
  };
  async function fail(job:WorkGroup,reason:unknown){
    const key=`${job.tournament_id}:${job.component}:${job.group_key}`;
    const error=reason instanceof Error?reason.message:'unknown';
    if(Date.now()<deadline)try{await call('fail_public_spectator_projection_v2',{p_tournament_id:job.tournament_id,p_component:job.component,p_group_key:job.group_key,p_fencing_token:job.fencing_token,p_error:error});}catch{/* Lease recovers interrupted failure reports. */}
    results.push({key,published:false,error});
  }
  async function process(job:WorkGroup,read:()=>PromiseLike<{data:unknown;error:unknown}>){
      const key=`${job.tournament_id}:${job.component}:${job.group_key}`;
      try{
        const source=await read();
        if(source.error||!source.data)throw Error('source_failed');
        // A source write can revoke the claim between claim and source read.
        // Only the exact DB fence receipt is a no-op; errors/missing data still fail.
        if(typeof source.data==='object'&&Object.keys(source.data).length===1&&
          (source.data as {fenced?:unknown}).fenced===true){
          results.push({key,published:false});return;
        }
        const value=source.data as {sourceVector:Record<string,string>;payload:unknown};
        const published=await call('publish_public_spectator_projection_v2',{p_tournament_id:job.tournament_id,p_component:job.component,p_group_key:job.group_key,
          p_fencing_token:job.fencing_token,p_source_vector:value.sourceVector,p_payload:reducePublicSpectatorPayload(job.component,value.payload)});
        if(published.error)throw Error('publish_failed');
        results.push({key,published:published.data===true});
        if(published.data===true)requestFlush();
      }catch(reason){await fail(job,reason);}
  }
  const single=(job:WorkGroup)=>call('get_public_spectator_projection_source_v2',{p_tournament_id:job.tournament_id,p_component:job.component,p_fencing_token:job.fencing_token});
  async function run(){
    while(cursor<jobs.length&&Date.now()<deadline){
      const job=jobs[cursor++];await process(job,()=>single(job));
    }
  }
  if(sourceMode==='batch'){
    // Isolated opt-in only: a wave waits for all source reads. This head-of-line
    // tradeoff needs real workload evidence before enabling it in the entrypoint.
    while(cursor<jobs.length&&Date.now()<deadline){
      const wave=jobs.slice(cursor,cursor+6);cursor+=wave.length;
      let receipts:ReturnType<typeof decodeSourceBatch>;
      try{
        const reply=await call('get_public_spectator_projection_sources_v2',{p_jobs:wave.map(({tournament_id,component,fencing_token})=>({tournament_id,component,fencing_token}))});
        if(reply.error)throw Error('source_batch_failed');
        receipts=decodeSourceBatch(wave,reply.data);
      }catch(reason){await Promise.all(wave.map(job=>fail(job,reason)));continue;}
      await Promise.all(wave.map((job,index)=>process(job,()=>{
        const receipt=receipts[index];
        if('requiresIndividual' in receipt)return single(job);
        if('error' in receipt)return Promise.resolve({data:null,error:receipt.error});
        return Promise.resolve({data:receipt.source,error:null});
      })));
    }
  }else await Promise.all(Array.from({length:Math.min(6,jobs.length)},()=>run()));
  await earlyFlush;
  if(Date.now()<deadline)try{await call('flush_public_spectator_broadcast_v2',{p_limit:100});}catch{/* Outbox remains for next dispatch. */}
  return {claimed:jobs.length,processed:results.length,results,sourceMode};
}
