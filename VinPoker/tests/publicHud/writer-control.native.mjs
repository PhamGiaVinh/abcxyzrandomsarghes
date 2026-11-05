// Diagnostic counterfactual, never a qualification substitute. Run alone on an
// already seeded disposable native test DB; do not run beside HTTP/worker load.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
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
// Optional matched hand-observer profile. The source writer, fixture source
// revision triggers, all data/indexes and commit timing remain identical.
const profilePath=process.env.PUBLIC_HUD_WRITER_OBSERVER_BASELINE;
const observerNames=['mark_dirty','mark_hand_child_dirty','mark_row_dirty'];
const observerSignatures=['spectator_projection_v2.mark_dirty(uuid,text,text,text)','spectator_projection_v2.mark_hand_child_dirty()','spectator_projection_v2.mark_row_dirty()'];
const baselineHashes=['5275ae9972ac43651bd1b831b52332dd','e9df156b6ee5d6a22ba968257ae38852','34ebfad5c2bea4d3306d67d435fe02a6'];
const candidateHashes=['e5684f8818e0d536bcdde7842032f71d','c9f805174bf0cf551aff43a748684df1','27a7e7aad6c0a9f52b040594b4ac115b'];
const observerMetadata=()=>jsonSql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY p.proname) FROM pg_proc p WHERE p.oid IN(${observerSignatures.map(s=>`'${s}'::regprocedure`).join(',')});`);
const observers=()=>jsonSql(`SELECT jsonb_agg(jsonb_build_object('name',p.proname,'definition',replace(pg_get_functiondef(p.oid),chr(13),'')) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='spectator_projection_v2' AND p.proname IN('mark_dirty','mark_hand_child_dirty','mark_row_dirty');`);
const candidateObservers=profilePath?observers():null;
const candidateMetadata=profilePath?observerMetadata():null;
const baselineObservers=profilePath?JSON.parse(readFileSync(profilePath,'utf8').replace(/^\uFEFF/,'')):null;
if(profilePath){
 assert.deepEqual(baselineObservers.map(p=>p.name),observerNames);
 assert.deepEqual(candidateObservers.map(p=>p.name),observerNames);
 for(const [profile,hashes] of [[baselineObservers,baselineHashes],[candidateObservers,candidateHashes]])for(let i=0;i<profile.length;i++)assert.equal(createHash('md5').update(profile[i].definition).digest('hex'),hashes[i],'Canonical observer definition required');
}
const setObservers=profile=>{
 sql('BEGIN;'+profile.map(p=>p.definition+';').join('\n')+'COMMIT;');
 assert.deepEqual(observers(),profile,'Observer profile did not match');
 const metadata=observerMetadata();
 const withoutBody=rows=>rows.map(({prosrc,...rest})=>rest);
 assert.deepEqual(withoutBody(metadata),withoutBody(candidateMetadata),'Observer OID/owner/ACL/metadata changed');
 if(profile===candidateObservers)assert.deepEqual(metadata,candidateMetadata,'Candidate function metadata restoration failed');
};
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
   if(mode==='withoutHudMarker'){
    if(profilePath)setObservers(baselineObservers);
    sql('DROP TRIGGER hud_hand_changed ON public.tournament_hands;');
   }
   try{measurements[mode]=measureFixtureWriterTransactions({commit:true});}
   finally{
    if(mode==='withoutHudMarker'){
     sql(trigger.definition+';');
     if(profilePath)setObservers(candidateObservers);
    }
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
 if(profilePath)setObservers(candidateObservers);
 assert.deepEqual(catalog(),before,'Source trigger restoration failed');
}
const report={kind:profilePath?'DIAGNOSTIC_MATCHED_HAND_OBSERVERS_NOT_QUALIFICATION':'DIAGNOSTIC_MATCHED_SETUP_MARGINAL_HUD_MARKER_NOT_QUALIFICATION',observerProfile:profilePath?{baseline:baselineObservers,candidate:candidateObservers}:null,database,sourceHands:Number(sourceCount),pairs:results,sourceTriggerCatalogRestored:true,qualification:false,limitations:profilePath?'Only this fixture hand writer and its three Spectator observers plus HUD hand trigger. No settlement/result/withdrawal coverage. Same data/index setup; cache/autovacuum/OS scheduling can differ. Original failed gate remains.':'Only marginal HUD hand marker; other incremental changes remain in both arms. Owned unprojected jobs are cleaned; index bloat, legacy marker state, cache/autovacuum/OS scheduling can still differ. No original failed result is replaced.'};
if(profilePath)report.observerFunctionMetadataRestored=true;
writeFileSync(process.env.PUBLIC_HUD_WRITER_CONTROL_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify({kind:report.kind,sourceHands:report.sourceHands,pairs:results.map(r=>({pair:r.pair,order:r.order,p95MarginalPercent:r.p95MarginalPercent})),sourceTriggerCatalogRestored:true,qualification:false}));
