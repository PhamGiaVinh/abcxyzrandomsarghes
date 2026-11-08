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
const participation='floor_private.tournament_participation_v1(uuid)';
const partMetadata=()=>jsonSql(`SELECT to_jsonb(p)-'prosrc'-'prolang' FROM pg_proc p WHERE oid='${participation}'::regprocedure;`);
const partBefore=partMetadata();
const clockMetadata=()=>jsonSql(`SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid='public.get_public_tournament_clock_summary(uuid)'::regprocedure;`);
const clockMetaBefore=clockMetadata();
const clockSamples=()=>pgbench(`SET ROLE anon;SELECT public.get_public_tournament_clock_summary('${tour}');RESET ROLE;`);
const clockOriginal=clockSamples();
const entry='80000000-0000-4000-8000-000000000003';
const participationCases=()=>jsonSql(`BEGIN;CREATE TEMP TABLE plan_cases(n integer,v jsonb);
 INSERT INTO plan_cases VALUES(0,jsonb_build_object('participation',floor_private.tournament_participation_v1('${tour}'),'clock',(SELECT to_jsonb(c)-'remaining_seconds'-'level_ends_at' FROM public.get_public_tournament_clock_summary('${tour}') c)));
 UPDATE public.tournament_seats SET player_name='Updated fixture display' WHERE entry_id='${entry}';
 INSERT INTO plan_cases VALUES(1,jsonb_build_object('participation',floor_private.tournament_participation_v1('${tour}'),'clock',(SELECT to_jsonb(c)-'remaining_seconds'-'level_ends_at' FROM public.get_public_tournament_clock_summary('${tour}') c)));
 UPDATE public.tournament_seats SET is_active=false WHERE entry_id='${entry}';
 UPDATE public.tournament_entries SET status='registered' WHERE id='${entry}';
 INSERT INTO plan_cases VALUES(2,jsonb_build_object('participation',floor_private.tournament_participation_v1('${tour}'),'clock',(SELECT to_jsonb(c)-'remaining_seconds'-'level_ends_at' FROM public.get_public_tournament_clock_summary('${tour}') c)));
 UPDATE public.tournament_entries SET status='busted' WHERE id='${entry}';
 INSERT INTO plan_cases VALUES(3,jsonb_build_object('participation',floor_private.tournament_participation_v1('${tour}'),'clock',(SELECT to_jsonb(c)-'remaining_seconds'-'level_ends_at' FROM public.get_public_tournament_clock_summary('${tour}') c)));
 UPDATE public.tournament_entries SET status='bagged' WHERE id='${entry}';
 INSERT INTO plan_cases VALUES(4,jsonb_build_object('participation',floor_private.tournament_participation_v1('${tour}'),'clock',(SELECT to_jsonb(c)-'remaining_seconds'-'level_ends_at' FROM public.get_public_tournament_clock_summary('${tour}') c)));
 UPDATE public.tournament_entries SET status='finished' WHERE id='${entry}';
 INSERT INTO plan_cases VALUES(5,jsonb_build_object('participation',floor_private.tournament_participation_v1('${tour}'),'clock',(SELECT to_jsonb(c)-'remaining_seconds'-'level_ends_at' FROM public.get_public_tournament_clock_summary('${tour}') c)));
 INSERT INTO plan_cases VALUES(6,jsonb_build_object('participation',floor_private.tournament_participation_v1('${other}'),'clock',(SELECT to_jsonb(c)-'remaining_seconds'-'level_ends_at' FROM public.get_public_tournament_clock_summary('${other}') c)));
 SELECT jsonb_agg(v ORDER BY n) FROM plan_cases;ROLLBACK;`);
const participationBefore=participationCases();
const clockBefore=jsonSql(`SET ROLE anon;SELECT to_jsonb(c)-'remaining_seconds'-'level_ends_at' FROM public.get_public_tournament_clock_summary('${tour}') c;`);
sql(readFileSync('supabase/migrations/20261104002300_tracker_participation_read_plan_reuse.sql','utf8'));
assert.deepEqual(clockMetadata(),clockMetaBefore);
assert.deepEqual(partMetadata(),partBefore);assert.deepEqual(participationCases(),participationBefore);
assert.deepEqual(jsonSql(`SET ROLE anon;SELECT to_jsonb(c)-'remaining_seconds'-'level_ends_at' FROM public.get_public_tournament_clock_summary('${tour}') c;`),clockBefore);
for(const role of ['anon','authenticated','service_role'])assert.throws(()=>sql(`SET ROLE ${role};SELECT floor_private.tournament_participation_v1('${tour}');`),/permission denied/);
// Exercise the real public caller after warming both tenant plans. Source edits
// are separate statements, so each STABLE call must observe its fresh snapshot.
sql(`BEGIN;SET LOCAL ROLE anon;DO $$ BEGIN FOR i IN 1..30 LOOP
 PERFORM public.get_public_tournament_clock_summary('${tour}');
 PERFORM public.get_public_tournament_clock_summary('${other}');
 END LOOP;END $$;RESET ROLE;
 UPDATE public.tournament_entries SET current_stack=2000 WHERE id='${entry}';
 UPDATE public.tournament_seats SET chip_count=2000 WHERE entry_id='${entry}';
 UPDATE public.tournament_chip_counts cc SET chip_count=2000 FROM public.tournament_entries e WHERE e.id='${entry}' AND cc.tournament_id=e.tournament_id AND cc.player_id=e.player_id AND cc.entry_number=e.entry_no;
 SET LOCAL ROLE anon;DO $$ BEGIN
 IF (SELECT c.average_stack FROM public.get_public_tournament_clock_summary('${tour}') c) IS DISTINCT FROM 1500::numeric THEN RAISE EXCEPTION 'cached_clock_stack';END IF;
 END $$;RESET ROLE;
 UPDATE public.tournament_entries SET status='busted' WHERE id='${entry}';
 UPDATE public.tournament_seats SET is_active=false WHERE entry_id='${entry}';
 SET LOCAL ROLE authenticated;DO $$ BEGIN
 IF (SELECT c.players_remaining FROM public.get_public_tournament_clock_summary('${tour}') c) IS DISTINCT FROM 1::bigint THEN RAISE EXCEPTION 'cached_clock_participation';END IF;
 IF (SELECT c.players_remaining FROM public.get_public_tournament_clock_summary('${other}') c) IS DISTINCT FROM 2::bigint THEN RAISE EXCEPTION 'clock_tenant_plan';END IF;
 END $$;RESET ROLE;
 UPDATE public.tournaments SET deleted_at=clock_timestamp() WHERE id='${tour}';
 SET LOCAL ROLE anon;DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.get_public_tournament_clock_summary('${tour}')) THEN RAISE EXCEPTION 'cached_clock_withdrawal';END IF;
 END $$;ROLLBACK;`);
const clockWrapped=clockSamples();
const recovery=readFileSync('tests/publicHud/read-plans.forward-rollback.sql','utf8');
assert.equal((recovery.match(/^COMMIT;/gm)??[]).length,1);
sql(recovery.replace(/^COMMIT;/m,()=>`DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM spectator_projection_v2.read_plan_originals_v1 r WHERE md5(replace(pg_get_functiondef(r.signature::regprocedure),chr(13),''))<>r.original_definition_hash) THEN RAISE EXCEPTION 'read_plan_restore_differs'; END IF;
 END $$;ROLLBACK;`));
assert.deepEqual(metadata(),beforeMeta);assert.deepEqual(readSet(),before);
const stats=values=>({samples:values.length,p50Ms:values[Math.floor(values.length*.5)],p95Ms:values[Math.floor(values.length*.95)]});
const report={kind:'NATIVE_POSTGRESQL_PLAN_REUSE_NOT_HTTP_CAPACITY',passed:true,original:stats(originalSamples),wrapped:stats(wrappedSamples),
 clockCaller:{original:stats(clockOriginal),wrapped:stats(clockWrapped)},
 checks:['byte-equivalent-public-json','same-owner-acl-oid-contract','anonymous-and-authenticated','wrong-tour','warm-plan-rebind','visibility-withdrawal','source-edit-not-results-cache','void','session-change','private-backup-denied','canonical-clock-caller','participation-display-waiting-busted-bagged-finished','warm-clock-stack-counts-and-withdrawal','private-helper-denied','exact-forward-rollback']};
if(process.env.PUBLIC_HUD_PLAN_REPORT)writeFileSync(process.env.PUBLIC_HUD_PLAN_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
