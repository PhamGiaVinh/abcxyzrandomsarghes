import {classifyPublicHudHand, PUBLIC_HUD_PROJECTION_VERSION} from '../_shared/publicHudContribution.ts';
import type {TrackerAnalyticsHand} from '../_shared/trackerPlayerAnalytics.ts';

export interface HudJob {kind:'hand'|'result'|'visibility';entity_id:string;generation:number;lease_token:string;
  source:unknown;source_error:boolean}
export interface HudWorkerClient {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>}

export async function processPublicHudJobs(client:HudWorkerClient,limit=20,deadline=Date.now()+5_000){
  const claimed=await client.rpc('claim_public_hud_jobs_with_source_v1',{p_limit:limit});
  if(claimed.error||!Array.isArray(claimed.data))throw Error('PUBLIC_HUD_CLAIM_FAILED');
  const jobs=claimed.data as HudJob[];
  let cursor=0,processed=0,failed=0;
  async function run(){
    while(cursor<jobs.length&&Date.now()<deadline){
      const job=jobs[cursor++];
      const args={p_kind:job.kind,p_entity:job.entity_id,p_generation:job.generation,p_lease:job.lease_token};
      try{
        let published;
        if(job.kind==='hand'){
          // Source belongs only to this claim/token. Publication still checks
          // the current source fingerprint, generation and unexpired lease.
          if(job.source_error!==false||!job.source)throw Error('PUBLIC_HUD_SOURCE_FAILED');
          const value=job.source as {hand:TrackerAnalyticsHand|null;fingerprint:string};
          if(!/^[a-f0-9]{32}$/.test(value.fingerprint))throw Error('PUBLIC_HUD_SOURCE_INVALID');
          const rows=value.hand?classifyPublicHudHand(value.hand):[];
          published=await client.rpc('publish_public_hud_hand_v1',{
            p_entity:job.entity_id,p_generation:job.generation,p_lease:job.lease_token,p_fingerprint:value.fingerprint,p_rows:rows,
          });
        }else published=await client.rpc('process_public_hud_metadata_v1',args);
        if(published.error||published.data!==true)throw Error('PUBLIC_HUD_PUBLISH_REJECTED');
        processed++;
      }catch{
        failed++;
        await client.rpc('fail_public_hud_job_v1',{...args,p_error:'PUBLIC_HUD_WORK_FAILED'});
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(4,jobs.length)},()=>run()));
  return {version:PUBLIC_HUD_PROJECTION_VERSION,claimed:jobs.length,processed,failed};
}
