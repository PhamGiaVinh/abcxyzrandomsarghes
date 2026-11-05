import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {initialize,sql,jsonSql,sqlAsync,service} from './nativeDb.mjs';
import {loadClassifier,createShadow,shadowSql} from '../../scripts/ops/tracker-hud-shadow.mjs';

if(process.argv.includes('--initialize'))initialize();
if(process.argv.includes('--enqueue-coalescing'))sql(readFileSync('supabase/migrations/20261104003100_public_hud_enqueue_write_coalescing.sql','utf8'));
if(process.argv.includes('--initialize'))sql(readFileSync('supabase/migrations/20261106010000_public_hud_visibility_restore_reclassification.sql','utf8'));
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
  // Read raw source independently after each real-trigger/worker amendment.
  // Job readiness alone cannot establish that derived counters are correct.
  const classifier=await loadClassifier(),amendmentShadows=[];
  const originalResult=jsonSql(`SELECT to_jsonb(r) FROM public.player_results r WHERE id='${hand}';`);
  assert.equal(originalResult.verified_by_admin,true);
  const sourceFingerprint=()=>sql(`SELECT md5(jsonb_build_object(
   'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h),
   'actions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
   'proofs',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x),
   'results',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.player_results x),
   'tours',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournaments x))::text);`);
  for(const [kind,change] of [
    ['action-correct',`UPDATE public.hand_actions SET action_type='raise' WHERE hand_id='${hand}' AND player_id='${a}' AND action_type='call';`],
    ['action-restore',`UPDATE public.hand_actions SET action_type='call' WHERE hand_id='${hand}' AND player_id='${a}' AND action_type='raise';`],
    ['void',`UPDATE public.tournament_hands SET is_voided=true,source_revision=source_revision+1 WHERE id='${hand}';`],
    ['restore',`UPDATE public.tournament_hands SET is_voided=false,source_revision=source_revision+1 WHERE id='${hand}';`],
    ['settlement-revoke',`UPDATE public.tournament_settlement_outcomes SET status='revoked',settlement_revision=settlement_revision+1 WHERE hand_id='${hand}';`],
    ['settlement-reverify',`UPDATE public.tournament_settlement_outcomes SET status='verified',settlement_revision=settlement_revision+1,source_revision=(SELECT source_revision FROM public.tournament_hands WHERE id='${hand}') WHERE hand_id='${hand}';`],
    ['result-revoke',`UPDATE public.player_results SET verified_by_admin=false WHERE id='${hand}';`],
    ['result-reverify',`UPDATE public.player_results SET verified_by_admin=true WHERE id='${hand}';`],
    ['result-edit',`UPDATE public.player_results SET prize=300 WHERE id='${hand}';`],
    ['result-revoke-again',`UPDATE public.player_results SET verified_by_admin=false WHERE id='${hand}';`],
    ['result-restore',`UPDATE public.player_results SET prize=${originalResult.prize},verified_by_admin=true WHERE id='${hand}';`],
    ['visibility-revoke',`UPDATE public.tournaments SET deleted_at=now() WHERE id='${tour}';`],
    ['hidden-action-correct',`UPDATE public.hand_actions SET action_type='raise' WHERE hand_id='${hand}' AND player_id='${a}' AND action_type='call';`],
    ['hidden-action-restore',`UPDATE public.hand_actions SET action_type='call' WHERE hand_id='${hand}' AND player_id='${a}' AND action_type='raise';`],
    ['visibility-restore',`UPDATE public.tournaments SET deleted_at=NULL WHERE id='${tour}';`],
  ]){
    const before=sourceFingerprint();
    const changed=Number(sql(`WITH changed AS (${change.replace(/;$/,'')} RETURNING 1) SELECT count(*) FROM changed;`));
    assert.equal(changed,1,`${kind}: exactly one actual source row`);
    assert.notEqual(sourceFingerprint(),before,`${kind}: source state must change`);
    if(kind==='visibility-restore'){
      const claimed=await processPublicHudJobs(client);assert.equal(claimed.failed,0);
      const queued=jsonSql(`SELECT coalesce(jsonb_agg(entity_id ORDER BY entity_id),'[]') FROM tracker_analytics_v1.jobs WHERE kind='hand';`);
      assert.deepEqual(queued,[hand],'Only the hand recomputed while hidden needs restoration');
      assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.visibility_barriers WHERE tournament_id='${tour}';`),'1');
      assert.equal(summary().state,'unavailable','Do not expose partial restoration');
    }
    await drain();
    const shadow=createShadow(classifier);
    for(const line of sql(shadowSql).split('\n').filter(Boolean))shadow.accept(JSON.parse(line));
    const report=shadow.finish();assert.equal(report.complete,true,kind);
    if(kind==='visibility-revoke'||kind.startsWith('hidden-')){
      // Excluded tour totals intentionally retain their last private policy
      // snapshot. Do not issue a PASS certificate for this intermediate state.
      assert.equal(summary().access,'revoked');assert.equal(state().a.public_hands,0);
      assert.ok(report.examples.every(example=>['hand_settlement_evidence','hand_source_identity'].includes(example.code)),`${kind}: ${JSON.stringify(report.examples)}`);
    }else assert.equal(report.passed,true,`${kind}: ${JSON.stringify(report.examples)}`);
    amendmentShadows.push({kind,certificatePassed:report.passed,privatePolicySnapshotRetained:kind==='visibility-revoke'||kind.startsWith('hidden-'),sourceHands:report.sourceHands,contributions:report.contributions,results:report.results,mismatches:report.mismatches});
  }
  console.log(JSON.stringify({kind:'NATIVE_AMENDMENTS_WITH_INDEPENDENT_RAW_SOURCE_SHADOW',passed:true,amendments:amendmentShadows,limitations:'Tiny native fixture;correctness oracle separate from HTTP/WS load latency;not large-history backfill or hosted capacity'}));
  // Force a hidden-policy publisher to wait after fingerprint validation. A
  // concurrent restore must wait for that publisher before queuing its dirty
  // contribution; otherwise late publication can escape the targeted refresh.
  sql(`UPDATE public.tournaments SET deleted_at=now() WHERE id='${tour}';`);await drain();
  sql(`SELECT tracker_analytics_v1.enqueue('hand','${hand}');`);
  let parkedPublish;
  await processPublicHudJobs({async rpc(name,args){
    if(name==='publish_public_hud_hand_v1'){parkedPublish=args;return {data:true,error:null};}
    return client.rpc(name,args);
  }});
  assert.ok(parkedPublish);
  const waitFor=async(query,label)=>{
    for(let attempt=0;attempt<40;attempt++){
      if(sql(query)==='t')return;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    throw Error(label);
  };
  const locker=sqlAsync(`BEGIN;SET application_name='hud_native_restore_locker';
    SELECT pg_advisory_xact_lock(hashtextextended('public-hud:${a}',0));SELECT pg_sleep(8);COMMIT;`);
  await waitFor("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='hud_native_restore_locker' AND wait_event='PgSleep');",'Player lock not acquired');
  const publish=sqlAsync(`SET application_name='hud_native_restore_publisher';${service}
    SELECT public.publish_public_hud_hand_v1(${signatures.publish_public_hud_hand_v1.map(key=>quote(typeof parkedPublish[key]==='object'?JSON.stringify(parkedPublish[key]):parkedPublish[key])).join(',')});`);
  await waitFor("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='hud_native_restore_publisher' AND wait_event_type='Lock' AND wait_event='advisory');",'Publisher did not reach player lock');
  const restore=sqlAsync(`SET application_name='hud_native_restore_source';UPDATE public.tournaments SET deleted_at=NULL WHERE id='${tour}';`);
  await waitFor("SELECT EXISTS(SELECT 1 FROM pg_stat_activity restoring JOIN pg_stat_activity publishing ON publishing.pid=ANY(pg_blocking_pids(restoring.pid)) WHERE restoring.application_name='hud_native_restore_source' AND publishing.application_name='hud_native_restore_publisher' AND restoring.wait_event_type='Lock');",'Restore crossed an in-flight hidden publisher');
  await locker;assert.equal(await publish,'t');await restore;
  assert.equal(summary().state,'unavailable');await drain();
  const concurrentShadow=createShadow(classifier);
  for(const line of sql(shadowSql).split('\n').filter(Boolean))concurrentShadow.accept(JSON.parse(line));
  const concurrentReport=concurrentShadow.finish();
  assert.equal(concurrentReport.passed,true,JSON.stringify(concurrentReport.examples));
  console.log(JSON.stringify({kind:'NATIVE_HIDDEN_PUBLISHER_RESTORE_LOCK_ORDER',passed:true,sourceHands:concurrentReport.sourceHands,limitations:'Forced two-session policy race;not load or all lock orderings'}));
  // Canonical source FKs cascade tournament -> hand -> actions/players/proof.
  // A publisher waiting for its candidate parent must hold no child lock that
  // could deadlock that cascade, and must reject a hand moved meanwhile.
  const fromTour='10000000-0000-4000-8000-000000000003',toTour='10000000-0000-4000-8000-000000000004';
  const movingHand='20000000-0000-4000-8000-000000000003';
  sql(`INSERT INTO public.tournaments(id) VALUES('${fromTour}'),('${toTour}');
    INSERT INTO public.tournament_hands(id,tournament_id) VALUES('${movingHand}','${fromTour}');
    INSERT INTO public.hand_players(hand_id,tournament_id,player_id,seat_number,starting_stack) VALUES
      ('${movingHand}','${fromTour}','${a}',1,1000),('${movingHand}','${fromTour}','${b}',2,1000);`);
  await drain();
  const parkHand=async()=>{
    sql(`SELECT tracker_analytics_v1.enqueue('hand','${movingHand}');`);
    let packet;
    await processPublicHudJobs({async rpc(name,args){
      if(name==='publish_public_hud_hand_v1'&&args.p_entity===movingHand){packet=args;return {data:true,error:null};}
      return client.rpc(name,args);
    }});
    assert.ok(packet);return packet;
  };
  for(const kind of ['move','cascade-delete']){
    const packet=await parkHand(),candidate=kind==='move'?fromTour:toTour;
    const parent=sqlAsync(`BEGIN;SET application_name='hud_native_parent_writer';
      SELECT id FROM public.tournaments WHERE id='${candidate}' FOR UPDATE;SELECT pg_sleep(8);
      ${kind==='cascade-delete'?`DELETE FROM public.tournaments WHERE id='${candidate}';`:''}COMMIT;`);
    await waitFor("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='hud_native_parent_writer' AND wait_event='PgSleep');",'Parent source lock missing');
    const publishing=sqlAsync(`SET application_name='hud_native_scope_publisher';${service}
      SELECT public.publish_public_hud_hand_v1(${signatures.publish_public_hud_hand_v1.map(key=>quote(typeof packet[key]==='object'?JSON.stringify(packet[key]):packet[key])).join(',')});`);
    await waitFor("SELECT EXISTS(SELECT 1 FROM pg_stat_activity p JOIN pg_stat_activity w ON w.pid=ANY(pg_blocking_pids(p.pid)) WHERE p.application_name='hud_native_scope_publisher' AND w.application_name='hud_native_parent_writer');",'Publisher did not lock parent first');
    if(kind==='move')sql(`BEGIN;UPDATE public.tournament_hands SET tournament_id='${toTour}' WHERE id='${movingHand}';
      UPDATE public.hand_players SET tournament_id='${toTour}' WHERE hand_id='${movingHand}';COMMIT;`);
    await parent;assert.equal(await publishing,'f',`${kind}: reject stale source scope`);await drain();
    assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.hand_contributions WHERE hand_id='${movingHand}' AND tournament_id='${toTour}';`),kind==='move'?'2':'0');
    const shadow=createShadow(classifier);
    for(const line of sql(shadowSql).split('\n').filter(Boolean))shadow.accept(JSON.parse(line));
    const report=shadow.finish();assert.equal(report.passed,true,`${kind}: ${JSON.stringify(report.examples)}`);
    console.log(JSON.stringify({kind:'NATIVE_PARENT_LOCK_'+kind.toUpperCase().replace('-','_'),passed:true,sourceHands:report.sourceHands,mismatches:report.mismatches}));
  }
  sql(`DELETE FROM public.tournaments WHERE id='${fromTour}';`);await drain();
  // A deleted_at restore must not downgrade a status eligibility refresh that
  // already requires all hands. A superseded visibility lease cannot clear it.
  sql(`UPDATE public.tournaments SET deleted_at=now() WHERE id='${tour}';
    UPDATE public.tournaments SET status='draft' WHERE id='${tour}';`);
  const visibilityLease=(await client.rpc('claim_public_hud_jobs_v1',{p_limit:20})).data.find(job=>job.kind==='visibility');
  assert.ok(visibilityLease);
  sql(`UPDATE public.tournaments SET deleted_at=NULL WHERE id='${tour}';`);
  assert.deepEqual(jsonSql(`SELECT jsonb_build_object('refresh',refresh_hands,'targeted',refresh_hidden_only,'cursor',progress_cursor)
    FROM tracker_analytics_v1.jobs WHERE kind='visibility' AND entity_id='${tour}';`),{refresh:true,targeted:false,cursor:null});
  assert.equal((await client.rpc('process_public_hud_metadata_v1',{p_kind:'visibility',p_entity:tour,p_generation:visibilityLease.generation,p_lease:visibilityLease.lease_token})).data,false);
  assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.visibility_barriers WHERE tournament_id='${tour}';`),'1');
  sql(`UPDATE public.tournaments SET status='live' WHERE id='${tour}';`);await drain();
  const eligibilityShadow=createShadow(classifier);
  for(const line of sql(shadowSql).split('\n').filter(Boolean))eligibilityShadow.accept(JSON.parse(line));
  const eligibilityReport=eligibilityShadow.finish();assert.equal(eligibilityReport.passed,true,JSON.stringify(eligibilityReport.examples));
  console.log(JSON.stringify({kind:'NATIVE_FULL_REFRESH_RESTORE_AND_SUPERSEDED_VISIBILITY_LEASE',passed:true,mismatches:eligibilityReport.mismatches}));
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
