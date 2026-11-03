import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {sql,jsonSql,pgbench} from './nativeDb.mjs';
if(process.argv.includes('--initialize'))execFileSync(process.execPath,['tests/publicHud/scale.seed.mjs'],{
 env:{...process.env,PUBLIC_HUD_SCALE_HANDS:'100'},stdio:['ignore','pipe','pipe']});
const tour='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const table='50000000-0000-4000-8000-000000000001',otherTable='50000000-0000-4000-8000-000000000002';
const signatures=['public.get_public_tournament_hand_v2(uuid,uuid)','public.get_public_tournament_table_live_or_last_hand_v2(uuid,uuid)'];
const list=signatures.map(s=>`'${s}'::regprocedure`).join(',');
const metadata=()=>jsonSql(`SELECT jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'strict',proisstrict,'parallel',proparallel,'cost',procost,'volatile',provolatile,'definer',prosecdef,'args',proargtypes::text,'result',prorettype) ORDER BY oid) FROM pg_proc WHERE oid IN (${list});`);
const readSet=()=>jsonSql(`SET ROLE anon;SELECT jsonb_build_object('one',public.get_public_tournament_table_live_or_last_hand_v2('${tour}','${table}'),
 'two',public.get_public_tournament_table_live_or_last_hand_v2('${other}','${otherTable}'),
 'wrongTenant',public.get_public_tournament_table_live_or_last_hand_v2('${other}','${table}'));`);
const beforeMeta=metadata(),before=readSet();
assert.equal(before.one.access,'public');assert.equal(before.two.access,'public');assert.equal(before.wrongTenant.error,'table_out_of_scope');
const samples=()=>pgbench(`SET ROLE anon;SELECT public.get_public_tournament_table_live_or_last_hand_v2('${tour}','${table}');RESET ROLE;`);
const originalSamples=samples();
sql(readFileSync('supabase/migrations/20261104002200_public_tracker_read_plan_reuse.sql','utf8'));
assert.deepEqual(metadata(),beforeMeta);assert.deepEqual(readSet(),before);
assert.equal(sql(`SELECT count(*) FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IN (${list}) AND l.lanname='plpgsql';`),'2');
assert.throws(()=>sql('SET ROLE anon;SELECT * FROM spectator_projection_v2.read_plan_originals_v1;'),/permission denied/);
// Same-backend warmed plans must bind each scope and observe source changes.
sql(`BEGIN; SET LOCAL ROLE anon;
 DO $$ BEGIN FOR i IN 1..30 LOOP
  PERFORM public.get_public_tournament_table_live_or_last_hand_v2('${tour}','${table}');
  PERFORM public.get_public_tournament_table_live_or_last_hand_v2('${other}','${otherTable}');
 END LOOP; END $$; RESET ROLE;
 UPDATE public.tournaments SET deleted_at=clock_timestamp() WHERE id='${tour}';
 SET LOCAL ROLE anon;DO $$ BEGIN
  IF public.get_public_tournament_table_live_or_last_hand_v2('${tour}','${table}') IS DISTINCT FROM '{"access":"revoked"}'::jsonb THEN RAISE EXCEPTION 'cached_visibility'; END IF;
  IF public.get_public_tournament_table_live_or_last_hand_v2('${other}','${otherTable}')->>'access'<>'public' THEN RAISE EXCEPTION 'cross_scope_plan'; END IF;
 END $$;RESET ROLE;
 UPDATE public.tournaments SET deleted_at=NULL WHERE id='${tour}';
 UPDATE public.tournament_hands SET pot_size=987654 WHERE id='${before.one.hand.id}';
 SET LOCAL ROLE authenticated;DO $$ BEGIN
  IF public.get_public_tournament_hand_v2('${tour}','${before.one.hand.id}')->>'pot'<>'987654' THEN RAISE EXCEPTION 'cached_result_instead_of_plan'; END IF;
 END $$;RESET ROLE;
 UPDATE public.tournament_hands SET is_voided=true WHERE id='${before.one.hand.id}';
 SET LOCAL ROLE anon;DO $$ BEGIN
  IF public.get_public_tournament_hand_v2('${tour}','${before.one.hand.id}')<>'{}'::jsonb THEN RAISE EXCEPTION 'cached_void'; END IF;
  IF public.get_public_tournament_table_live_or_last_hand_v2('${tour}','${table}')#>>'{hand,id}'='${before.one.hand.id}' THEN RAISE EXCEPTION 'cached_void_table'; END IF;
 END $$;RESET ROLE;
 UPDATE public.tournament_tables SET table_session_id='60000000-0000-4000-8000-999999999999' WHERE id='${table}';
 SET LOCAL ROLE anon;DO $$ BEGIN
  IF public.get_public_tournament_table_live_or_last_hand_v2('${tour}','${table}')#>>'{hand,id}' IS NOT NULL THEN RAISE EXCEPTION 'cached_prior_session'; END IF;
 END $$;ROLLBACK;`);
const wrappedSamples=samples();
const recovery=readFileSync('tests/publicHud/read-plans.forward-rollback.sql','utf8');
assert.equal((recovery.match(/^COMMIT;/gm)??[]).length,1);
sql(recovery.replace(/^COMMIT;/m,()=>`DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM spectator_projection_v2.read_plan_originals_v1 r WHERE md5(replace(pg_get_functiondef(r.signature::regprocedure),chr(13),''))<>r.original_definition_hash) THEN RAISE EXCEPTION 'read_plan_restore_differs'; END IF;
 END $$;ROLLBACK;`));
assert.deepEqual(metadata(),beforeMeta);assert.deepEqual(readSet(),before);
const stats=values=>({samples:values.length,p50Ms:values[Math.floor(values.length*.5)],p95Ms:values[Math.floor(values.length*.95)]});
const report={kind:'NATIVE_POSTGRESQL_PLAN_REUSE_NOT_HTTP_CAPACITY',passed:true,original:stats(originalSamples),wrapped:stats(wrappedSamples),
 checks:['byte-equivalent-public-json','same-owner-acl-oid-contract','anonymous-and-authenticated','wrong-tour','warm-plan-rebind','visibility-withdrawal','source-edit-not-results-cache','void','session-change','private-backup-denied','exact-forward-rollback']};
if(process.env.PUBLIC_HUD_PLAN_REPORT)writeFileSync(process.env.PUBLIC_HUD_PLAN_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
