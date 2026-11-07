import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {sql,jsonSql,service} from './nativeDb.mjs';

// Observe the EXISTING production worker while it backfills an owned raw seed.
// No second worker, fabricated contribution, read activation or source hand
// insertion: the parent checkpoint driver's fixed cardinality remains intact.
const database=process.env.PUBLIC_HUD_LOCAL_DATABASE,output=process.env.PUBLIC_HUD_BACKFILL_CONCURRENT_REPORT;
assert.equal(process.env.PUBLIC_HUD_BACKFILL_CONCURRENT,'owned-raw-backfill-only');
assert.equal(process.platform,'linux','Run beside the native Linux worker,not one WSL launch per probe');
assert.match(database??'',/^vinpoker_hud_test_backfill_raw_[a-z0-9_]+$/);
assert.ok(output&&isAbsolute(output)&&!existsSync(output),'Fresh absolute evidence path required');
const sourceSha=process.env.PUBLIC_HUD_BACKFILL_SOURCE_SHA;
assert.match(sourceSha??'',/^[a-f0-9]{40}$/,'Exact reviewed driver source required');
assert.equal(sql('SELECT current_database();'),database);
const config=()=>jsonSql('SELECT to_jsonb(c) FROM tracker_analytics_v1.config c;');
const initial=config();
assert.equal(initial.enabled,false);assert.equal(initial.worker_enabled,true);assert.equal(initial.backfill_complete,false);
assert.ok(initial.backfill_hand_cursor);
const hand='20000000-0000-4000-8000-000000000001';
const before=jsonSql(`SELECT jsonb_build_object('hands',(SELECT count(*) FROM public.tournament_hands),'contributions',(SELECT count(*) FROM tracker_analytics_v1.hand_contributions WHERE hand_id='${hand}'),'status',h.status,'voided',coalesce(h.is_voided,false),'revision',h.source_revision,'fixtureFunctionsAbsent',to_regprocedure('public.fixture_scale_amend_once_v1(uuid,uuid,text)') IS NULL AND to_regprocedure('public.fixture_scale_amend_ready_v1(uuid)') IS NULL) FROM public.tournament_hands h WHERE h.id='${hand}' AND h.tournament_id='10000000-0000-4000-8000-000000000001' AND h.hand_number=1;`);
assert.equal(before.hands,1_000_000);assert.equal(before.contributions,2);assert.equal(before.status,'completed');assert.equal(before.voided,false);assert.equal(before.fixtureFunctionsAbsent,true);
const fixture=readFileSync('tests/publicHud/scale.amendments.fixture.sql','utf8');
sql(fixture);
const report={kind:'REAL_NATIVE_AMENDMENTS_DURING_MILLION_RAW_BACKFILL',sourceSha,fixtureSha256:createHash('sha256').update(fixture).digest('hex'),database,sourceHands:before.hands,initialCheckpoint:initial.backfill_hand_cursor,finalCheckpoint:null,phase:'running',samples:[],maxMs:null,withinFiveSeconds:false,parentBackfillAdvanced:false,qualification:false,productionCapacityClaim:false,limitations:'Existing four-session production worker handles real source-triggered edits/void/restore/settlement and new result rows while historical backfill runs. Native PostgreSQL probes,not HTTP/Edge latency or spectator load. Hand cardinality remains fixed;does not qualify insertion of new live hands. Final independent million-hand raw shadow is still required.'};
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const mutate=kind=>jsonSql(`${service}SELECT public.fixture_scale_amend_once_v1('${randomUUID()}','${hand}','${kind}');`);
save();
try{
 let lastRevision;
 for(const kind of ['correct','void','restore','verify','revoke','reverify','result_create','result_edit','result_revoke','result_reverify']){
  assert.equal(config().backfill_complete,false,'Every mutation must occur during backfill');
  const receipt=mutate(kind),sourceAt=Date.parse(receipt.sourceWrittenAt),deadline=Date.now()+15000;
  assert.ok(Number.isFinite(sourceAt));
  if(['revoke','reverify'].includes(kind))assert.equal(receipt.sourceRevision,lastRevision,'Settlement must invalidate without a hand revision change');
  lastRevision=receipt.sourceRevision;
  let ready=false;
  while(Date.now()<deadline){
   ready=sql(`${service}SELECT public.fixture_scale_amend_ready_v1('${receipt.operation}');`)==='t';
   if(ready)break;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  const elapsedMs=Date.now()-sourceAt;
  report.samples.push({kind,sourceRevision:receipt.sourceRevision,elapsedMs,ready,backfillComplete:config().backfill_complete});save();
  assert.equal(ready,true,'Existing worker did not publish the exact mutation receipt');
 }
 let final=config();const checkpointDeadline=Date.now()+30000;
 while(final.backfill_hand_cursor===initial.backfill_hand_cursor&&!final.backfill_complete&&Date.now()<checkpointDeadline){
  await new Promise(resolve=>setTimeout(resolve,100));final=config();
 }
 report.finalCheckpoint=final.backfill_hand_cursor;
 report.parentBackfillAdvanced=report.finalCheckpoint!==report.initialCheckpoint;
 report.maxMs=Math.max(...report.samples.map(row=>row.elapsedMs));
 report.withinFiveSeconds=report.maxMs<=5000;
 assert.equal(Number(sql('SELECT count(*) FROM public.tournament_hands;')),before.hands);
 assert.equal(sql(`SELECT coalesce(is_voided,false) FROM public.tournament_hands WHERE id='${hand}';`),'f');
 assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.hand_contributions WHERE hand_id='${hand}';`),'2');
 assert.equal(final.enabled,false);assert.equal(final.backfill_complete,false);
 assert.equal(report.parentBackfillAdvanced,true,'Historical checkpoint must advance alongside source mutations');
 assert.equal(report.withinFiveSeconds,true,'Background amendment latency exceeded5seconds');
 report.phase='passed';save();console.log(JSON.stringify(report));
}catch(error){
 // A failed void observation must not strand this synthetic hand as voided or
 // poison the parent driver's final cardinality check. Queue canonical restore;
 // its eventual publication remains unverified when the worker is unavailable.
 if(sql(`SELECT coalesce(is_voided,false) FROM public.tournament_hands WHERE id='${hand}';`)==='t'){
  mutate('restore');report.cleanupRestoreQueued=true;
 }
 report.phase='failed';save();throw error;
}
