import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';
import {build} from 'esbuild';
import {nativeWorkerClient} from './nativeRpc.mjs';
// Earlier integration cases intentionally leave valid hand jobs. Quiesce them
// through the real projector so "current" certifies this result transition.
const bundle=await build({entryPoints:['supabase/functions/public-hud-projector-v1/worker.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {processPublicHudJobs}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const priorJobs=Number(sql('SELECT count(*) FROM tracker_analytics_v1.jobs;'));
for(let i=0;i<40&&Number(sql('SELECT count(*) FROM tracker_analytics_v1.jobs;'))>0;i++){
 const processed=await processPublicHudJobs(nativeWorkerClient,80,Date.now()+20000);
 assert.equal(processed.failed,0,JSON.stringify(processed));
}
assert.equal(sql('SELECT count(*) FROM tracker_analytics_v1.jobs;'),'0','Require the real worker to finish prior fixture jobs');
const signature='tracker_analytics_v1.broadcast_withdrawal_v1()';
const migration=readFileSync('supabase/migrations/20261104003400_public_hud_result_withdrawal_scope.sql','utf8');
const recovery=readFileSync('tests/publicHud/result-withdrawal.forward-rollback.sql','utf8').replace(/^BEGIN;\r?\n/m,'').replace(/COMMIT;\s*$/,'');
const meta=()=>jsonSql(`SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid='${signature}'::regprocedure;`);
const before=meta();
const objectCheck=readFileSync('scripts/ops/tracker-hud-20261104-postcheck.sql','utf8').split(/\r?\n/).filter(line=>line.trimStart().startsWith("'resultWithdrawalDefinitionMatches',"));
assert.equal(objectCheck.length,1);
const checkSql=`SELECT jsonb_build_object(${objectCheck[0].trim().replace(/,$/,'')});`;
assert.equal(jsonSql(checkSql).resultWithdrawalDefinitionMatches,false);
assert.equal(sql(`SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));`),'d21e991e6f1709070c370e43488d6eb2');
const scope=jsonSql(`SELECT jsonb_build_object('tour',tournament_id,'player',player_id,'hand',hand_id) FROM tracker_analytics_v1.hand_contributions ORDER BY hand_id,player_id LIMIT 1;`);
const result='f1100034-0000-4000-8000-000000000001';
const summary=`public.get_public_player_hud_summary_v1('${scope.tour}','${scope.player}')`;
const clear=`DELETE FROM spectator_projection_v2.broadcast_pending_v1;DELETE FROM tracker_analytics_v1.revocation_broadcast_v1;`;
const project=`DO $$ DECLARE j jsonb; BEGIN
 SELECT x INTO STRICT j FROM jsonb_array_elements(public.claim_public_hud_jobs_v1(80)) x WHERE x->>'kind'='result' AND x->>'entity_id'='${result}';
 IF NOT public.process_public_hud_metadata_v1('result','${result}',(j->>'generation')::bigint,(j->>'lease_token')::uuid) THEN RAISE EXCEPTION 'result publish failed';END IF;
 END $$;`;
const seed=`SET LOCAL request.jwt.claim.role='service_role';
 INSERT INTO public.player_results(id,player_id,verified_by_admin,prize,tournament_name,event_date,position,total_entries)
 VALUES('${result}','${scope.player}',true,100,'SYNTHETIC RESULT WITHDRAWAL TEST','2026-01-01',1,2);${project}`;
const sources=`jsonb_build_object(${['tournaments','tournament_entries','tournament_seats','tournament_prizes','tournament_chip_counts'].map(table=>`'${table}',(SELECT md5(coalesce(string_agg(to_jsonb(r)::text,'' ORDER BY id),'')) FROM public.${table} r WHERE ${table==='tournaments'?'id':'tournament_id'}='${scope.tour}')`).join(',')})`;
sql(migration);
assert.equal(jsonSql(checkSql).resultWithdrawalDefinitionMatches,true);
assert.deepEqual(meta(),before);
const checks=[];
for(const [name,change] of [
 ['unverify',`UPDATE public.player_results SET verified_by_admin=false WHERE id='${result}';`],
 ['delete',`DELETE FROM public.player_results WHERE id='${result}';`],
 ['reassign',`UPDATE public.player_results SET player_id='f1100034-0000-4000-8000-000000000002' WHERE id='${result}';`],
]){
 const value=jsonSql(`BEGIN;${seed}${clear}
 CREATE TEMP TABLE result_before AS SELECT ${sources} AS sources,${summary} AS summary;
 ${change}
 CREATE TEMP TABLE result_blocked AS SELECT ${summary} AS summary,
 (SELECT count(*) FROM tracker_analytics_v1.revocation_broadcast_v1) AS hud,
 (SELECT count(*) FROM spectator_projection_v2.broadcast_pending_v1) AS pages;
 ${project}
 SELECT jsonb_build_object('blocked',(SELECT summary->>'state' FROM result_blocked),'hud',(SELECT hud FROM result_blocked),'pages',(SELECT pages FROM result_blocked),
 'sourceUnchanged',(SELECT sources FROM result_before)=${sources},'beforeWinnings',(SELECT summary->'totalWinnings' FROM result_before),
 'afterWinnings',${summary}->'totalWinnings','state',${summary}->>'state');ROLLBACK;`);
 assert.equal(value.blocked,'unavailable',name+' must immediately block obsolete totals');
 assert.equal(value.hud,1,name+' must retain global HUD access watermark and durable notification');
 assert.equal(value.pages,0,name+' must not invalidate unrelated tournament components');
 assert.equal(value.sourceUnchanged,true);assert.equal(value.state,'current');
 assert.equal(Number(value.beforeWinnings)-Number(value.afterWinnings),100);
 checks.push(name);
}
const hand=jsonSql(`BEGIN;${clear}UPDATE public.tournament_hands SET is_voided=true WHERE id='${scope.hand}';
 SELECT jsonb_build_object('hud',(SELECT count(*) FROM tracker_analytics_v1.revocation_broadcast_v1),
 'visibility',(SELECT count(*) FROM spectator_projection_v2.broadcast_pending_v1 WHERE tournament_id='${scope.tour}' AND component='visibility'),
 'state',${summary}->>'state');ROLLBACK;`);
assert.equal(hand.hud,1);assert.ok(hand.visibility>0);assert.equal(hand.state,'unavailable');
const tour=jsonSql(`BEGIN;${clear}UPDATE public.tournaments SET deleted_at=clock_timestamp() WHERE id='${scope.tour}';
 SELECT jsonb_build_object('hud',(SELECT count(*) FROM tracker_analytics_v1.revocation_broadcast_v1),
 'visibility',(SELECT count(*) FROM spectator_projection_v2.broadcast_pending_v1 WHERE tournament_id='${scope.tour}' AND component='visibility'),
 'access',${summary}->>'access');ROLLBACK;`);
assert.equal(tour.hud,1);assert.ok(tour.visibility>0);assert.equal(tour.access,'revoked');
assert.throws(()=>sql(migration,{captureFailure:true}),/preimage differs/);
assert.equal(sql(`BEGIN;${recovery}SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));ROLLBACK;`),'d21e991e6f1709070c370e43488d6eb2');
const report={kind:'NATIVE_RESULT_WITHDRAWAL_SCOPE_NOT_WEBSOCKET_CAPACITY',passed:true,priorJobsDrained:priorJobs,checks:[...checks,'unrelated-source-unchanged','immediate-hud-barrier','actual-claim-and-result-publication','hand-withdrawal-unchanged','tour-withdrawal-unchanged','metadata-preserved','exact-recovery']};
if(process.env.PUBLIC_HUD_RESULT_SCOPE_REPORT)writeFileSync(process.env.PUBLIC_HUD_RESULT_SCOPE_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
