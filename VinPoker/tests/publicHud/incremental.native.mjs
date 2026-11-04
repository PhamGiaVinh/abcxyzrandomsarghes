import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {initialize,sql,jsonSql,sqlAsync,service} from './nativeDb.mjs';

if(process.argv.includes('--initialize'))initialize();
if(process.argv.includes('--enqueue-coalescing'))sql(readFileSync('supabase/migrations/20261104003100_public_hud_enqueue_write_coalescing.sql','utf8'));
const directory=await mkdtemp(path.join(os.tmpdir(),'vinpoker-hud-native-'));
await build({entryPoints:['supabase/functions/public-hud-projector-v1/worker.ts'],outfile:path.join(directory,'worker.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {processPublicHudJobs}=await import(pathToFileURL(path.join(directory,'worker.mjs')));
const quote=value=>value===null?'NULL':`'${String(value).replaceAll("'","''")}'`;
const signatures={
  claim_public_hud_jobs_v1:['p_limit'],get_public_hud_job_source_v1:['p_kind','p_entity','p_generation','p_lease'],
  publish_public_hud_hand_v1:['p_entity','p_generation','p_lease','p_fingerprint','p_rows'],
  process_public_hud_metadata_v1:['p_kind','p_entity','p_generation','p_lease'],
  fail_public_hud_job_v1:['p_kind','p_entity','p_generation','p_lease','p_error'],
};
const client={async rpc(name,args){
  assert.ok(name in signatures);
  const values=signatures[name].map(key=>quote(typeof args[key]==='object'?JSON.stringify(args[key]):args[key]));
  try{return {data:JSON.parse(await sqlAsync(`${service} SELECT to_jsonb(public.${name}(${values.join(',')}));`)),error:null};}
  catch(error){return {data:null,error:String(error)};}
}};
const tour='10000000-0000-4000-8000-000000000001',hand='20000000-0000-4000-8000-000000000001';
const a='30000000-0000-4000-8000-000000000001',b='30000000-0000-4000-8000-000000000002';
const state=()=>jsonSql(`SELECT jsonb_build_object('jobs',(SELECT count(*) FROM tracker_analytics_v1.jobs),
 'a',(SELECT to_jsonb(t) FROM tracker_analytics_v1.player_totals t WHERE player_id='${a}'),
 'contributions',(SELECT count(*) FROM tracker_analytics_v1.hand_contributions));`);
async function drain(){for(let round=0;round<40;round++){
  if(state().jobs===0)return;
  const result=await processPublicHudJobs(client);assert.equal(result.failed,0,JSON.stringify(result));
  await new Promise(resolve=>setTimeout(resolve,50));
}throw Error('Queue did not drain');}
try{
  sql(`INSERT INTO public.tournaments(id) VALUES('${tour}');
    INSERT INTO public.tournament_hands(id,tournament_id,community_cards) VALUES('${hand}','${tour}','["AS","KD","QC","JS","2D"]');
    INSERT INTO public.hand_players(hand_id,tournament_id,player_id,seat_number,starting_stack) VALUES
      ('${hand}','${tour}','${a}',1,1000),('${hand}','${tour}','${b}',2,1000);
    INSERT INTO public.hand_actions(hand_id,player_id,street,action_type,action_amount,action_order) VALUES
      ('${hand}','${a}','preflop','post_sb',50,1),('${hand}','${b}','preflop','post_bb',100,2),
      ('${hand}','${a}','preflop','call',50,3),('${hand}','${b}','preflop','check',0,4);`);
  await drain();assert.equal(state().a.public_hands,1);assert.equal(state().contributions,2);
  const first=state().a;
  sql(`SELECT tracker_analytics_v1.enqueue('hand','${hand}');`);await drain();
  assert.deepEqual(state().a.numerators,first.numerators);assert.equal(state().a.public_hands,1);
  // An old lease cannot apply after a newer source update.
  sql(`SELECT tracker_analytics_v1.enqueue('hand','${hand}');`);
  const old=(await client.rpc('claim_public_hud_jobs_v1',{p_limit:1})).data[0];
  const source=(await client.rpc('get_public_hud_job_source_v1',{p_kind:'hand',p_entity:hand,p_generation:old.generation,p_lease:old.lease_token})).data;
  sql(`UPDATE public.tournament_hands SET source_revision=source_revision+1,is_voided=true WHERE id='${hand}';`);
  assert.equal((await client.rpc('publish_public_hud_hand_v1',{p_entity:hand,p_generation:old.generation,p_lease:old.lease_token,p_fingerprint:source.fingerprint,p_rows:[]})).data,false);
  await drain();assert.equal(state().a.public_hands,0);assert.equal(state().contributions,0);
  sql(`UPDATE public.tournament_hands SET source_revision=source_revision+1,is_voided=false WHERE id='${hand}';`);
  await drain();assert.equal(state().a.public_hands,1);
  // Proof revision changes must reclassify even when hand source_revision stays fixed.
  const sourceRevision=sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`);
  const outcome={schemaVersion:'settlement-outcome-v1',status:'verified',pots:[{winnerIds:[a]}],handRanks:[{playerId:a},{playerId:b}],players:[{playerId:a,startingStack:1000,endingStack:1100,netDelta:100,externalDelta:0}]};
  sql(`INSERT INTO public.tournament_settlement_outcomes(hand_id,source_revision,settlement_revision,status,public_outcome)
    VALUES('${hand}',${sourceRevision},1,'verified',${quote(JSON.stringify(outcome))});`);
  await drain();assert.equal(state().a.missing_proof[8],0);assert.equal(state().a.numerators[8],1);
  sql(`UPDATE public.tournament_settlement_outcomes SET status='revoked' WHERE hand_id='${hand}';`);
  await drain();assert.equal(state().a.missing_proof[8],1);
  sql(`UPDATE public.tournament_settlement_outcomes SET status='verified',settlement_revision=2 WHERE hand_id='${hand}';`);
  await drain();assert.equal(state().a.missing_proof[8],0);
  sql(`UPDATE public.tournaments SET status='draft' WHERE id='${tour}';`);
  await drain();assert.equal(state().a.missing_proof[8],1);
  sql(`UPDATE public.tournaments SET status='live' WHERE id='${tour}';`);
  await drain();assert.equal(state().a.missing_proof[8],0);
  assert.equal(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`),sourceRevision);
  sql(`INSERT INTO public.player_results(id,player_id,verified_by_admin,prize) VALUES('${hand}','${a}',true,100);`);
  await drain();assert.equal(state().a.winnings,100);assert.equal(state().a.result_count,1);
  sql(`UPDATE public.player_results SET prize=200 WHERE id='${hand}';`);await drain();assert.equal(state().a.winnings,200);
  sql(`UPDATE public.player_results SET verified_by_admin=false WHERE id='${hand}';`);await drain();assert.equal(state().a.winnings,0);assert.equal(state().a.result_count,0);
  sql(`UPDATE public.tournaments SET deleted_at=now() WHERE id='${tour}';`);await drain();assert.equal(state().a.public_hands,0);
  sql(`UPDATE public.tournaments SET deleted_at=NULL WHERE id='${tour}';`);await drain();assert.equal(state().a.public_hands,1);
  const summary=()=>jsonSql(`SET ROLE anon; SELECT public.get_public_player_hud_summary_v1('${tour}','${a}');`);
  assert.equal(summary().state,'warming');
  for(let round=0;round<10;round++){
    const backfill=jsonSql(`${service} SELECT public.backfill_public_hud_v1(50);`);
    if(round===0){
      const late='00000000-0000-4000-8000-000000000001';
      sql(`BEGIN;INSERT INTO public.tournament_hands(id,tournament_id,status) VALUES('${late}','${tour}','completed');
       INSERT INTO public.hand_players(hand_id,tournament_id,player_id,seat_number,starting_stack)
        SELECT '${late}',tournament_id,player_id,seat_number,starting_stack FROM public.hand_players WHERE hand_id='${hand}';
       INSERT INTO public.hand_actions(hand_id,player_id,street,action_type,action_amount,action_order)
        SELECT '${late}',player_id,street,action_type,action_amount,action_order FROM public.hand_actions WHERE hand_id='${hand}';COMMIT;`);
      assert.equal(sql(`SELECT priority FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id='${late}';`),'0');
      await drain();assert.equal(state().a.public_hands,2);
      sql(`BEGIN;DELETE FROM public.hand_actions WHERE hand_id='${late}';DELETE FROM public.hand_players WHERE hand_id='${late}';DELETE FROM public.tournament_hands WHERE id='${late}';COMMIT;`);
    }
    await drain();if(backfill.complete)break;
  }
  assert.equal(jsonSql('SELECT to_jsonb(backfill_complete) FROM tracker_analytics_v1.config;'),true);
  sql('UPDATE tracker_analytics_v1.config SET enabled=true;');
  assert.equal(summary().counters.publicHands,1);
  assert.equal(summary().totalWinnings,null);
  const history=jsonSql(`SET ROLE anon; SELECT public.get_public_player_hud_history_v1('${tour}','${a}');`);
  assert.equal(history.handHistory.length,1);assert.equal(history.handHistory[0].endingStack,1100);
  assert.equal(history.nextCursor,null);
  sql(`UPDATE public.tournament_settlement_outcomes SET public_outcome=jsonb_set(public_outcome,'{pots}','[{"winnerIds":"malformed"}]') WHERE hand_id='${hand}';`);
  await drain();assert.equal(state().a.missing_proof[8],1);
  assert.equal(jsonSql(`SET ROLE anon; SELECT public.get_public_player_hud_history_v1('${tour}','${a}');`).handHistory[0].endingStack,null);
  sql(`UPDATE public.tournament_settlement_outcomes SET public_outcome=${quote(JSON.stringify(outcome))},settlement_revision=3 WHERE hand_id='${hand}';`);
  await drain();
  sql(`UPDATE public.tournaments SET deleted_at=now() WHERE id='${tour}';`);
  assert.equal(summary().access,'revoked');
  await drain();sql(`UPDATE public.tournaments SET deleted_at=NULL WHERE id='${tour}';`);await drain();
  const second='20000000-0000-4000-8000-000000000002';
  sql(`INSERT INTO public.tournament_hands(id,tournament_id) VALUES('${second}','${tour}');
    INSERT INTO public.hand_players(hand_id,tournament_id,player_id,seat_number,starting_stack) VALUES('${second}','${tour}','${a}',1,1000),('${second}','${tour}','${b}',2,1000);
    INSERT INTO public.hand_actions(hand_id,player_id,street,action_type,action_amount,action_order) VALUES('${second}','${a}','preflop','post_sb',50,1),('${second}','${b}','preflop','post_bb',100,2),('${second}','${a}','preflop','call',50,3);
    UPDATE public.player_results SET verified_by_admin=true,prize=500 WHERE id='${hand}';`);
  const claims=await Promise.all([client.rpc('claim_public_hud_jobs_v1',{p_limit:1}),client.rpc('claim_public_hud_jobs_v1',{p_limit:1})]);
  const claimed=claims.flatMap(r=>r.data);assert.equal(claimed.length,2);assert.equal(new Set(claimed.map(j=>j.kind+':'+j.entity_id)).size,2);
  sql("UPDATE tracker_analytics_v1.jobs SET lease_until=clock_timestamp()-interval '1 second';");
  const expired=claimed.find(j=>j.kind==='hand');
  assert.ok((await client.rpc('get_public_hud_job_source_v1',{p_kind:'hand',p_entity:expired.entity_id,p_generation:expired.generation,p_lease:expired.lease_token})).error);
  await drain();assert.equal(state().a.public_hands,2);assert.equal(state().a.winnings,500);
  const previousSummary=summary();
  sql(`UPDATE public.player_results SET prize=600 WHERE id='${hand}';`);
  const updatingSummary=summary();
  assert.equal(updatingSummary.revision,previousSummary.revision);
  assert.equal(updatingSummary.totalWinnings,500);assert.equal(updatingSummary.recentResults[0].prize,500);
  await drain();assert.equal(summary().totalWinnings,600);assert.equal(summary().recentResults[0].prize,600);
  sql(`DELETE FROM public.hand_players WHERE hand_id='${second}' AND player_id='${a}';`);
  assert.equal(summary().state,'unavailable');
  assert.equal(jsonSql(`SET ROLE anon; SELECT public.get_public_player_hud_history_v1('${tour}','${a}');`).handHistory.some(h=>h.handId===second),false);
  await drain();assert.equal(state().a.public_hands,1);
  sql(`INSERT INTO public.hand_players(hand_id,tournament_id,player_id,seat_number,starting_stack) VALUES('${second}','${tour}','${a}',1,1000);`);
  await drain();assert.equal(state().a.public_hands,2);
  // Allocation order is deliberately opposite to commit order. MAX(identity)
  // would miss A; PostgreSQL snapshot visibility must detect its late commit.
  const early=sqlAsync(`BEGIN;SELECT tracker_analytics_v1.mark_access_revocation();
    SELECT pg_advisory_xact_lock(911040015);SELECT pg_sleep(2);COMMIT;`);
  let earlyStarted=false;
  for(let i=0;i<30;i++){
    if(sql('SELECT pg_try_advisory_xact_lock(911040015);')==='f'){earlyStarted=true;break;}
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(earlyStarted,true);
  sql('SELECT tracker_analytics_v1.mark_access_revocation();');
  const openedBetweenCommits=summary();
  const maxBefore=sql('SELECT max(event_id) FROM tracker_analytics_v1.access_revocations;');
  await early;
  assert.equal(sql('SELECT max(event_id) FROM tracker_analytics_v1.access_revocations;'),maxBefore);
  const verified=jsonSql(`SET ROLE anon;SELECT public.get_public_player_hud_summary_v1('${tour}','${a}','${openedBetweenCommits.accessSnapshot}');`);
  assert.equal(verified.accessChanged,true);
  const sourceCount=sql('SELECT count(*) FROM public.tournament_hands;');
  sql('UPDATE tracker_analytics_v1.config SET enabled=false,worker_enabled=false;');
  assert.equal(summary().state,'warming');
  assert.equal(jsonSql(`${service} SELECT jsonb_build_object('request',public.dispatch_public_hud_projection_v1());`).request,null);
  sql('UPDATE tracker_analytics_v1.config SET enabled=true;');
  assert.equal(summary().counters.publicHands,2);
  assert.equal(sql('SELECT count(*) FROM public.tournament_hands;'),sourceCount);
  assert.throws(()=>sql("SET ROLE anon; SELECT public.claim_public_hud_jobs_v1(1);"),/permission denied/);
  console.log(JSON.stringify({kind:'NATIVE_POSTGRESQL_NOT_HTTP_OR_LOAD_TEST',checks:['classification','idempotent-retry','stale-lease','void','restore','settlement-revoke','settlement-reverify','eligibility-revoke','eligibility-restore','unchanged-source-revision','result-edit','result-revoke','visibility-revoke','visibility-restore','backfill','warming','anonymous-summary','verified-stack','immediate-revocation','anon-denial'],passed:true}));
}finally{
  const target=path.resolve(directory),prefix=path.resolve(os.tmpdir())+path.sep+'vinpoker-hud-native-';
  if(!target.startsWith(prefix))throw Error('Invalid task temporary path');
  await rm(target,{recursive:true,force:true});
}
