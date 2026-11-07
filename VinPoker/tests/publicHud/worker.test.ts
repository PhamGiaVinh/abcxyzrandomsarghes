import {expect,it,vi} from 'vitest';
import {processPublicHudJobs} from '../../supabase/functions/public-hud-projector-v1/worker';

const job=(id:string)=>({kind:'hand',entity_id:id,generation:7,lease_token:'lease-'+id,source_error:false,
  source:{fingerprint:'a'.repeat(32),hand:{handId:id,status:'completed',isVoided:false,buttonSeat:1,boardCardCount:0,
    players:[{player_id:'player',seat_number:1,starting_stack:1000}],actions:[],settlement:null}}});

it('classifies only the source attached to its claim and avoids another source RPC',async()=>{
  const rpc=vi.fn(async(name:string)=>({data:name==='claim_public_hud_jobs_with_source_v1'?[job('one')]:true,error:null}));
  expect(await processPublicHudJobs({rpc})).toMatchObject({claimed:1,processed:1,failed:0});
  expect(rpc.mock.calls.map(call=>call[0])).toEqual(['claim_public_hud_jobs_with_source_v1','publish_public_hud_hand_v1']);
  expect(rpc).toHaveBeenLastCalledWith('publish_public_hud_hand_v1',expect.objectContaining({
    p_entity:'one',p_generation:7,p_lease:'lease-one',p_fingerprint:'a'.repeat(32),
    p_rows:[expect.objectContaining({playerId:'player',publicHands:1})],
  }));
});

it('isolates an unavailable source while processing other hand and metadata jobs',async()=>{
  const rpc=vi.fn(async(name:string)=>({data:name==='claim_public_hud_jobs_with_source_v1'?
    [{...job('bad'),source:null,source_error:true},job('good'),{...job('result'),kind:'result',source:null}]:true,error:null}));
  expect(await processPublicHudJobs({rpc})).toMatchObject({claimed:3,processed:2,failed:1});
  expect(rpc).toHaveBeenCalledWith('fail_public_hud_job_v1',expect.objectContaining({p_entity:'bad',p_generation:7,p_lease:'lease-bad'}));
  expect(rpc).toHaveBeenCalledWith('process_public_hud_metadata_v1',expect.objectContaining({p_kind:'result',p_entity:'result'}));
  expect(rpc.mock.calls.some(call=>call[0]==='get_public_hud_job_source_v1')).toBe(false);
});

it('retains canonical publication rejection instead of reporting a stale source as processed',async()=>{
  const rpc=vi.fn(async(name:string)=>({data:name==='claim_public_hud_jobs_with_source_v1'?[job('stale')]:name!=='publish_public_hud_hand_v1',error:null}));
  expect(await processPublicHudJobs({rpc})).toMatchObject({processed:0,failed:1});
  expect(rpc).toHaveBeenCalledWith('fail_public_hud_job_v1',expect.objectContaining({p_entity:'stale',p_generation:7,p_lease:'lease-stale'}));
});

it('fails a missing new RPC without silently using the old network path',async()=>{
  const rpc=vi.fn(async()=>({data:null,error:{code:'PGRST202'}}));
  await expect(processPublicHudJobs({rpc})).rejects.toThrow('PUBLIC_HUD_CLAIM_FAILED');
  expect(rpc).toHaveBeenCalledTimes(1);
});
