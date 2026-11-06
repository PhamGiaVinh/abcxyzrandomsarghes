import assert from 'node:assert/strict';
import {writeFileSync,existsSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {sql,jsonSql,service} from './nativeDb.mjs';

// Synthetic source lifecycle beside the already-running raw backfill. Never
// starts a worker or writes derived data. The temporary source hand is retired
// through source DELETE triggers,then the original million-source set remains.
const database=process.env.PUBLIC_HUD_LOCAL_DATABASE,output=process.env.PUBLIC_HUD_BACKFILL_LIVE_HAND_REPORT;
assert.equal(process.env.PUBLIC_HUD_BACKFILL_LIVE_HAND,'owned-raw-backfill-only');
assert.equal(process.platform,'linux');assert.match(database??'',/^vinpoker_hud_test_backfill_raw_[a-z0-9_]+$/);
assert.ok(output&&isAbsolute(output)&&!existsSync(output),'Fresh absolute report required');
const sourceSha=process.env.PUBLIC_HUD_BACKFILL_SOURCE_SHA;
assert.match(sourceSha??'',/^[a-f0-9]{40}$/);assert.equal(sql('SELECT current_database();'),database);
const config=()=>jsonSql('SELECT to_jsonb(c) FROM tracker_analytics_v1.config c;');
const initial=config();assert.equal(initial.enabled,false);assert.equal(initial.worker_enabled,true);assert.equal(initial.backfill_complete,false);assert.ok(initial.backfill_hand_cursor);
const tour='10000000-0000-4000-8000-000000000001',number=20_000_001;
assert.equal(sql('SELECT count(*) FROM public.tournament_hands;'),'1000000');
assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${tour}' AND hand_number=${number};`),'0');
let hand=null;
const report={kind:'REAL_NEW_SOURCE_HAND_DURING_MILLION_RAW_BACKFILL',sourceSha,database,initialCheckpoint:initial.backfill_hand_cursor,finalCheckpoint:null,phase:'running',steps:[],completionMs:null,retirementMs:null,immediateHardBlocks:null,originalCardinalityRestored:false,parentBackfillAdvanced:false,qualification:false,productionCapacityClaim:false,limitations:'One synthetic two-player hand through existing fixture source-intent RPC and real source triggers/classifier/worker while raw historical backfill is incomplete. No additional worker or derived writes. Measures native PostgreSQL receipt-to-observation,not Floor authorization,HTTP/Edge,Realtime or spectator capacity. Source DELETE cleanup has no ledger/payment/provider in this fixture. Final independent million-hand shadow remains required.'};
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const waitFor=async(query)=>{const deadline=Date.now()+15000;while(Date.now()<deadline){if(sql(query)==='t')return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Existing worker did not publish lifecycle receipt');};
const remove=()=>jsonSql(`BEGIN;DELETE FROM public.tournament_hands WHERE id='${hand}' AND tournament_id='${tour}' AND hand_number=${number};SELECT jsonb_build_object('sourceWrittenAt',clock_timestamp(),'hardBlocks',(SELECT count(*) FROM tracker_analytics_v1.job_players WHERE kind='hand' AND entity_id='${hand}' AND hard_block));COMMIT;`);
save();
try{
 for(let step=0;step<=5;step++){
  assert.equal(config().backfill_complete,false);
  const operation=randomUUID(),args=`'${operation}','${tour}',${number},${step},${hand?`'${hand}'`:'NULL'}`;
  const value=jsonSql(`${service}SELECT public.fixture_scale_step_once_v1(${args});`);
  assert.match(value.handId,/^[a-f0-9-]{36}$/);if(hand)assert.equal(value.handId,hand);else hand=value.handId;
  assert.deepEqual(jsonSql(`${service}SELECT public.fixture_scale_step_once_v1(${args});`),value,'Same intent must return the committed receipt');
  if(step<5){
   assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id='${hand}';`),'0');
   assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.hand_contributions WHERE hand_id='${hand}';`),'0');
  }else{
   await waitFor(`${service}SELECT public.fixture_scale_hand_ready_v1('${hand}');`);
   report.completionMs=Date.now()-Date.parse(value.sourceWrittenAt);
   assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.hand_contributions c JOIN public.tournament_hands h ON h.id=c.hand_id WHERE h.id='${hand}' AND c.source_fingerprint=tracker_analytics_v1.hand_fingerprint(h.id) AND c.source_revision=h.source_revision AND c.tournament_id=h.tournament_id AND c.hand_number=h.hand_number AND c.public_hands=1 AND c.observed_hands=1 AND c.omitted_hands=0;`),'2');
   report.exactSourceContributions=true;
  }
  report.steps.push({step,idempotent:true,backfillComplete:config().backfill_complete});save();
 }
 const removed=remove();report.immediateHardBlocks=removed.hardBlocks;save();
 assert.equal(report.immediateHardBlocks,2,'Both old contributors must block in the source transaction');
 await waitFor(`SELECT NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id='${hand}') AND NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.hand_contributions WHERE hand_id='${hand}');`);
 report.retirementMs=Date.now()-Date.parse(removed.sourceWrittenAt);
 assert.equal(sql(`SELECT (SELECT count(*) FROM public.tournament_hands)||'|'||(SELECT count(*) FROM public.hand_players WHERE hand_id='${hand}')||'|'||(SELECT count(*) FROM public.hand_actions WHERE hand_id='${hand}');`),'1000000|0|0');
 report.originalCardinalityRestored=true;
 let final=config();const deadline=Date.now()+30000;
 while(final.backfill_hand_cursor===initial.backfill_hand_cursor&&!final.backfill_complete&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,100));final=config();}
 report.finalCheckpoint=final.backfill_hand_cursor;report.parentBackfillAdvanced=report.finalCheckpoint!==report.initialCheckpoint;
 assert.equal(final.enabled,false);assert.equal(final.backfill_complete,false);assert.equal(report.parentBackfillAdvanced,true);
 assert.ok(report.completionMs>=0&&report.completionMs<=5000,'New completed hand exceeded5seconds');
 assert.ok(report.retirementMs>=0&&report.retirementMs<=5000,'Deleted hand retirement exceeded5seconds');
 report.phase='passed';save();console.log(JSON.stringify(report));
}catch(error){
 if(hand&&sql(`SELECT count(*) FROM public.tournament_hands WHERE id='${hand}' AND tournament_id='${tour}' AND hand_number=${number};`)==='1'){
  remove();report.cleanupDeletionQueued=true;
 }
 report.phase='failed';save();throw error;
}
