import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {sql,jsonSql} from './nativeDb.mjs';
if(process.argv.includes('--initialize')){
 execFileSync(process.execPath,['tests/publicHud/scale.seed.mjs'],{env:{...process.env,PUBLIC_HUD_SCALE_HANDS:'100'},stdio:['ignore','pipe','pipe']});
 for(const file of ['20261104002200_public_tracker_read_plan_reuse.sql','20261104002300_tracker_participation_read_plan_reuse.sql','20261104002500_public_clock_read_plan_reuse.sql','20261104003200_public_clock_counts_only.sql','20261104002700_public_current_table_prepared_reads.sql','20261106105930_public_clock_numeric_buy_in.sql'])sql(readFileSync('supabase/migrations/'+file,'utf8'));
}
const signature='public.get_public_tournament_table_clock_v1(uuid,uuid)',tour='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',table='50000000-0000-4000-8000-000000000001';
const missing='10000000-0000-4000-8000-999999999999';
const callees="'public.get_public_tournament_table_live_or_last_hand_v2(uuid,uuid)'::regprocedure,'public.get_public_tournament_clock_summary(uuid)'::regprocedure";
const calleeState=()=>jsonSql(`SELECT jsonb_agg((to_jsonb(p)-'prosrc')||jsonb_build_object('hash',md5(replace(pg_get_functiondef(p.oid),chr(13),''))) ORDER BY p.oid) FROM pg_proc p WHERE oid IN(${callees});`);
const before=calleeState();
sql(readFileSync('supabase/migrations/20261106184814_public_table_clock_read_bundle.sql','utf8'));
assert.deepEqual(calleeState(),before,'Canonical getters and grants must remain unchanged');
const meta=jsonSql(`SELECT jsonb_build_object('definer',prosecdef,'volatile',provolatile,'acl',proacl::text,'config',proconfig,'result',prorettype::regtype::text,'owner',proowner::regrole::text,'hash',md5(replace(pg_get_functiondef(oid),chr(13),''))) FROM pg_proc WHERE oid='${signature}'::regprocedure;`);
assert.equal(meta.definer,false);assert.equal(meta.volatile,'s');assert.equal(meta.result,'jsonb');assert.equal(meta.owner,'postgres');assert.deepEqual(meta.config,['search_path=""']);
assert.equal(meta.acl,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}');
const objectKeys=['tableClockBundleDefinitionMatches','tableClockBundleMetadataMatches'];
const postcheckLines=readFileSync('scripts/ops/tracker-hud-20261104-postcheck.sql','utf8').split(/\r?\n/);
const objectSql=objectKeys.map(key=>{
 const lines=postcheckLines.filter(line=>line.trimStart().startsWith(`'${key}',`));
 assert.equal(lines.length,1,key);return lines[0].trim().replace(/,$/,'');
}).join(',');
assert.deepEqual(jsonSql(`SELECT jsonb_build_object(${objectSql});`),Object.fromEntries(objectKeys.map(key=>[key,true])));
const metadataDrift=jsonSql(`BEGIN;ALTER FUNCTION ${signature} SECURITY DEFINER;SELECT jsonb_build_object(${objectSql});ROLLBACK;`);
assert.equal(metadataDrift.tableClockBundleMetadataMatches,false);
const definitionDrift=jsonSql(`BEGIN;ALTER FUNCTION ${signature} COST 101;SELECT jsonb_build_object(${objectSql});ROLLBACK;`);
assert.equal(definitionDrift.tableClockBundleDefinitionMatches,false);
let comparisons=0;
const compare=(role,tournamentId,tableId,mutation='')=>{
 const value=jsonSql(`BEGIN;${mutation};SET LOCAL ROLE ${role};SELECT jsonb_build_object(
  'actual',public.get_public_tournament_table_clock_v1('${tournamentId}','${tableId}'),
  'expected',jsonb_build_object('table',public.get_public_tournament_table_live_or_last_hand_v2('${tournamentId}','${tableId}'),
   'clock',CASE WHEN public.get_public_tournament_table_live_or_last_hand_v2('${tournamentId}','${tableId}')->>'access'='public'
    THEN coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM public.get_public_tournament_clock_summary('${tournamentId}') c),'[]'::jsonb) ELSE '[]'::jsonb END));ROLLBACK;`);
 assert.deepEqual(value.actual,value.expected);comparisons++;return value.actual;
};
for(const role of ['anon','authenticated']){
 assert.equal(compare(role,tour,table).table.access,'public');
 assert.equal(compare(role,other,table).table.error,'table_out_of_scope');
 assert.equal(compare(role,missing,table).table.access,'revoked');
 assert.equal(compare(role,tour,table,`UPDATE public.tournaments SET deleted_at=clock_timestamp() WHERE id='${tour}'`).table.access,'revoked');
 compare(role,tour,table,`UPDATE public.table_sessions SET closed_at=clock_timestamp() WHERE id=(SELECT table_session_id FROM public.tournament_tables WHERE id='${table}')`);
 compare(role,tour,table,`UPDATE public.tournament_tables SET tournament_id='${other}' WHERE id='${table}'`);
 compare(role,tour,table,`UPDATE public.tournaments SET clock_paused_at=clock_started_at+interval '30 seconds' WHERE id='${tour}'`);
 compare(role,tour,table,`UPDATE public.tournament_hands SET is_voided=true WHERE tournament_table_id='${table}'`);
}
const denial=jsonSql(`BEGIN;REVOKE EXECUTE ON FUNCTION public.get_public_tournament_clock_summary(uuid) FROM anon;
 SET LOCAL ROLE anon;SELECT public.get_public_tournament_table_clock_v1('${missing}','${table}');ROLLBACK;`);
assert.equal(denial.table.access,'revoked');assert.deepEqual(denial.clock,[],'An unavailable clock must not mask a definitive table denial');
assert.throws(()=>sql(`BEGIN;REVOKE EXECUTE ON FUNCTION public.get_public_tournament_clock_summary(uuid) FROM anon;
 SET LOCAL ROLE anon;SELECT public.get_public_tournament_table_clock_v1('${tour}','${table}');ROLLBACK;`,{captureFailure:true}),'A public table must not mask a real clock error');
assert.throws(()=>sql(`SET ROLE service_role;SELECT public.get_public_tournament_table_clock_v1('${tour}','${table}');`,{captureFailure:true}));
assert.throws(()=>sql(readFileSync('supabase/migrations/20261106184814_public_table_clock_read_bundle.sql','utf8'),{captureFailure:true}),'Existing signature must reject reapply');
assert.deepEqual(calleeState(),before);
sql(readFileSync('tests/publicHud/table-clock-bundle.forward-rollback.sql','utf8'));
assert.equal(sql(`SELECT to_regprocedure('${signature}') IS NULL;`),'t');assert.deepEqual(calleeState(),before);
sql(readFileSync('supabase/migrations/20261106184814_public_table_clock_read_bundle.sql','utf8'));compare('anon',tour,table);
const report={kind:'REAL_PG17_FRESH_PUBLIC_TABLE_CLOCK_BUNDLE',comparisons,roles:2,securityInvoker:true,canonicalGettersUnchanged:true,reapplyDenied:true,serviceRoleDenied:true,denialSurvivesClockFailure:true,publicClockErrorsRetained:true,rollbackAndReapply:true,releasePostchecksAndTamper:true,hash:meta.hash,qualification:false,limitations:'Exact fresh SQL semantics, authorization and recovery only;not HTTP roundtrip/capacity or production proof.'};
if(process.env.PUBLIC_HUD_BUNDLE_REPORT)writeFileSync(process.env.PUBLIC_HUD_BUNDLE_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
