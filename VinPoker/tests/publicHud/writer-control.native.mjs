// Diagnostic counterfactual, never a qualification substitute. Run alone on an
// already seeded disposable native test DB; do not run beside HTTP/worker load.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';
import {measureFixtureWriterTransactions} from './scale.write.native.mjs';
assert.equal(process.env.PUBLIC_HUD_WRITER_CONTROL,'isolated-native-only');
assert.ok(process.env.PUBLIC_HUD_WRITER_CONTROL_REPORT,'Explicit diagnostic report path required');
const database=process.env.PUBLIC_HUD_LOCAL_DATABASE;
assert.match(database??'',/^vinpoker_hud_test_[a-z0-9_]+$/);
assert.equal(sql('SELECT current_database();'),database);
// No pgbench/HTTP workers may be connected while the counterfactual is active.
const preflight=[];
const maintenanceWaitMs=180000;
for(let check=0;check<=maintenanceWaitMs/500;check++){
 const sessions=jsonSql("SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM (SELECT backend_type,state,count(*) AS sessions FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() GROUP BY backend_type,state) s;");
 preflight.push({observedAt:new Date().toISOString(),sessions});
 if(!sessions.length||sessions.some(s=>s.backend_type!=='autovacuum worker')||check===maintenanceWaitMs/500)break;
 // Only automatic maintenance may finish before this diagnostic begins.
 // Another application/worker client remains an immediate hard rejection.
 await new Promise(resolve=>setTimeout(resolve,500));
}
writeFileSync(process.env.PUBLIC_HUD_WRITER_CONTROL_REPORT+'.preflight.json',JSON.stringify({kind:'READONLY_NATIVE_CONTROL_PREFLIGHT',maintenanceWaitMs,observations:preflight},null,2));
assert.deepEqual(preflight.at(-1).sessions,[],'Exclusive native database required before changing the fixture marker');
const catalog=()=>jsonSql(`SELECT coalesce(jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid)) ORDER BY tgname),'[]') FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass AND NOT tgisinternal;`);
const before=catalog(),trigger=before.find(t=>t.name==='hud_hand_changed');
assert.ok(trigger?.enabled==='O'&&trigger.definition.endsWith('EXECUTE FUNCTION tracker_analytics_v1.hand_changed()'),'Expected HUD marker trigger required');
const sourceCount=sql('SELECT count(*) FROM public.tournament_hands;');
const ownedScope="tournament_id='10000000-0000-4000-8000-000000000001' AND hand_number=2000000001";
assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE ${ownedScope};`),'0','Counterfactual fixture scope already occupied');
const queue=()=>jsonSql("SELECT jsonb_build_object('jobs',count(*),'leased',count(*) FILTER(WHERE lease_until IS NOT NULL),'failed',count(*) FILTER(WHERE attempts>0)) FROM tracker_analytics_v1.jobs;");
function cleanupOwned(){
 // Only this run's reserved synthetic hand-number scope, including partial
 // pgbench failures. No worker can have published a contribution for these IDs.
 return jsonSql(`BEGIN;CREATE TEMP TABLE owned_writer_hands AS SELECT id FROM public.tournament_hands WHERE ${ownedScope};
 DO $$ BEGIN IF (SELECT count(*) FROM owned_writer_hands)>220 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.hand_contributions c JOIN owned_writer_hands h ON h.id=c.hand_id) THEN RAISE EXCEPTION 'writer_control_cleanup_scope';END IF;END $$;
 DELETE FROM public.hand_actions WHERE hand_id IN(SELECT id FROM owned_writer_hands);
 DELETE FROM public.hand_players WHERE hand_id IN(SELECT id FROM owned_writer_hands);
 DELETE FROM public.tournament_hands WHERE id IN(SELECT id FROM owned_writer_hands);
 DELETE FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id IN(SELECT id FROM owned_writer_hands);
 SELECT jsonb_build_object('ownedHandsRemoved',count(*)) FROM owned_writer_hands;COMMIT;`);
}
const results=[];
try{
 for(let pair=0;pair<3;pair++){
  // Alternate order, preserve every result. Same data/index setup, same existing
  // 20 warmup/200 graded commits, no forced checkpoint or stats reset.
  const order=pair%2?['incremental','withoutHudMarker']:['withoutHudMarker','incremental'];
  const measurements={};
  for(const mode of order){
   const queueBefore=queue();let removed;
   if(mode==='withoutHudMarker')sql('DROP TRIGGER hud_hand_changed ON public.tournament_hands;');
   try{measurements[mode]=measureFixtureWriterTransactions({commit:true});}
   finally{
    if(mode==='withoutHudMarker')sql(trigger.definition+';');
    removed=cleanupOwned();
    assert.deepEqual(queue(),queueBefore,'Owned diagnostic jobs were not cleaned');
    assert.deepEqual(catalog(),before,'Source trigger catalog changed');
    assert.equal(sql('SELECT count(*) FROM public.tournament_hands;'),sourceCount);
   }
   assert.equal(removed.ownedHandsRemoved,220);
   measurements[mode].queueBefore=queueBefore;
   measurements[mode].queueAfter=queue();
  }
  results.push({pair:pair+1,order,measurements,p95MarginalPercent:(measurements.incremental.p95Ms/measurements.withoutHudMarker.p95Ms-1)*100});
 }
}finally{
 // If the diagnostic fails, restore this one exact definition; never change
 // source-revision, Realtime, auth/RLS or any other trigger.
 if(!catalog().some(t=>t.name==='hud_hand_changed'))sql(trigger.definition+';');
 assert.deepEqual(catalog(),before,'Source trigger restoration failed');
}
const report={kind:'DIAGNOSTIC_MATCHED_SETUP_MARGINAL_HUD_MARKER_NOT_QUALIFICATION',database,sourceHands:Number(sourceCount),pairs:results,sourceTriggerCatalogRestored:true,qualification:false,limitations:'Only marginal HUD hand marker; other incremental changes remain in both arms. Owned unprojected jobs are cleaned; index bloat, legacy marker state, cache/autovacuum/OS scheduling can still differ. No original failed result is replaced.'};
writeFileSync(process.env.PUBLIC_HUD_WRITER_CONTROL_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify({kind:report.kind,sourceHands:report.sourceHands,pairs:results.map(r=>({pair:r.pair,order:r.order,p95MarginalPercent:r.p95MarginalPercent})),sourceTriggerCatalogRestored:true,qualification:false}));
