import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {sql,jsonSql,pgbench} from './nativeDb.mjs';
const signature='public.get_public_tournament_clock_summary(uuid)';
const tour='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const missing='10000000-0000-4000-8000-999999999999';
const skewInsert=`INSERT INTO public.tournament_entries(id,tournament_id,player_id,status)
 SELECT public.fixture_scale_uuid('81000000',n),'${tour}',public.fixture_scale_uuid('31000000',n),'waiting' FROM generate_series(1,1000) n;`;
const metadata=()=>jsonSql(`SELECT to_jsonb(p)-'prosrc'-'prolang' FROM pg_proc p WHERE oid='${signature}'::regprocedure;`);
const original=sql(`SELECT pg_get_functiondef('${signature}'::regprocedure);`),beforeMeta=metadata();
const cases=()=>jsonSql(`BEGIN;
 CREATE TEMP TABLE clock_plan_cases(n integer,v jsonb);
 SET LOCAL ROLE anon;
 DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.get_public_tournament_clock_summary('${missing}')) THEN RAISE EXCEPTION 'missing_clock_visible';END IF;END $$;
 RESET ROLE;
 INSERT INTO clock_plan_cases SELECT 0,jsonb_agg(to_jsonb(c)-'remaining_seconds'-'level_ends_at' ORDER BY c.tournament_id) FROM public.get_public_tournament_clock_summary('${tour}') c;
 UPDATE public.tournaments SET clock_paused_at=clock_started_at+interval '30 seconds' WHERE id='${tour}';
 INSERT INTO clock_plan_cases SELECT 1,jsonb_agg(to_jsonb(c) ORDER BY c.tournament_id) FROM public.get_public_tournament_clock_summary('${tour}') c;
 UPDATE public.tournaments SET deleted_at=clock_timestamp() WHERE id='${tour}';
 INSERT INTO clock_plan_cases SELECT 2,jsonb_agg(to_jsonb(c)) FROM public.get_public_tournament_clock_summary('${tour}') c;
 INSERT INTO clock_plan_cases SELECT 3,jsonb_agg(to_jsonb(c)-'remaining_seconds'-'level_ends_at') FROM public.get_public_tournament_clock_summary('${other}') c;
 UPDATE public.tournaments SET deleted_at=NULL,clock_paused_at=NULL WHERE id='${tour}';
 INSERT INTO clock_plan_cases SELECT 4,jsonb_agg(to_jsonb(c)-'remaining_seconds'-'level_ends_at') FROM public.get_public_tournament_clock_summary('${tour}') c;
 ${skewInsert}
 INSERT INTO clock_plan_cases SELECT 5,jsonb_agg(to_jsonb(c)-'remaining_seconds'-'level_ends_at') FROM public.get_public_tournament_clock_summary('${tour}') c;
 INSERT INTO clock_plan_cases SELECT 6,jsonb_agg(to_jsonb(c)-'remaining_seconds'-'level_ends_at') FROM public.get_public_tournament_clock_summary('${other}') c;
 SELECT jsonb_agg(to_jsonb(c) ORDER BY n) FROM clock_plan_cases c;ROLLBACK;`);
const before=cases();
const samples=()=>pgbench(`SET ROLE anon;SELECT * FROM public.get_public_tournament_clock_summary('${tour}');SELECT * FROM public.get_public_tournament_clock_summary('${other}');SELECT * FROM public.get_public_tournament_clock_summary('${missing}');RESET ROLE;`);
const skewSamples=()=>jsonSql(`BEGIN;${skewInsert}
 CREATE TEMP TABLE clock_plan_latency(ms double precision);
 DO $$ DECLARE started timestamptz;BEGIN FOR i IN 1..220 LOOP
 started:=clock_timestamp();
 PERFORM public.get_public_tournament_clock_summary('${tour}');
 PERFORM public.get_public_tournament_clock_summary('${other}');
 PERFORM public.get_public_tournament_clock_summary('${missing}');
 IF i>20 THEN INSERT INTO clock_plan_latency VALUES(extract(epoch FROM clock_timestamp()-started)*1000);END IF;
 END LOOP;END $$;
 SELECT jsonb_agg(ms ORDER BY ms) FROM clock_plan_latency;ROLLBACK;`);
const originalSamples=samples();
const skewOriginal=skewSamples();
sql(readFileSync('supabase/migrations/20261104002500_public_clock_read_plan_reuse.sql','utf8'));
assert.deepEqual(metadata(),beforeMeta);assert.deepEqual(cases(),before);
for(const role of ['anon','authenticated','service_role'])assert.throws(()=>sql(`SET ROLE ${role};SELECT * FROM spectator_projection_v2.clock_read_plan_original_v1;`),/permission denied/);
sql(`BEGIN;SET LOCAL ROLE anon;
 DO $$ BEGIN FOR i IN 1..30 LOOP
 PERFORM public.get_public_tournament_clock_summary('${tour}');
 PERFORM public.get_public_tournament_clock_summary('${other}');
 PERFORM public.get_public_tournament_clock_summary('${missing}');
 END LOOP;END $$;RESET ROLE;
 UPDATE public.tournaments SET deleted_at=clock_timestamp() WHERE id='${tour}';
 SET LOCAL ROLE authenticated;DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.get_public_tournament_clock_summary('${tour}')) THEN RAISE EXCEPTION 'warm_clock_withdrawal';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.get_public_tournament_clock_summary('${other}')) THEN RAISE EXCEPTION 'warm_clock_cross_scope';END IF;
 END $$;RESET ROLE;
 UPDATE public.tournaments SET deleted_at=NULL,clock_started_at=statement_timestamp()-interval '10 seconds',clock_paused_at=NULL,pause_accumulated=0 WHERE id='${tour}';
 SET LOCAL ROLE anon;DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.get_public_tournament_clock_summary('${tour}') c WHERE c.is_running AND c.remaining_seconds>=0 AND c.level_ends_at IS NOT NULL) THEN RAISE EXCEPTION 'warm_clock_source_update';END IF;
 END $$;ROLLBACK;`);
const wrappedSamples=samples(),wrapped=sql(`SELECT pg_get_functiondef('${signature}'::regprocedure);`);
const skewWrapped=skewSamples();
const recovery=readFileSync('tests/publicHud/clock-read-plan.forward-rollback.sql','utf8');
sql(recovery.replace(/^COMMIT;/m,'ROLLBACK;'));
assert.equal(sql(`SELECT pg_get_functiondef('${signature}'::regprocedure);`),wrapped);
const priorRecovery=readFileSync('tests/publicHud/read-plans.forward-rollback.sql','utf8');
sql(recovery.replace(/^COMMIT;/m,'')+priorRecovery.replace(/^BEGIN;/m,'').replace(/^COMMIT;/m,()=>`DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM spectator_projection_v2.read_plan_originals_v1 r WHERE md5(replace(pg_get_functiondef(r.signature::regprocedure),chr(13),''))<>r.original_definition_hash) THEN RAISE EXCEPTION 'combined_clock_recovery_differs';END IF;
 END $$;ROLLBACK;`));
assert.equal(sql(`SELECT pg_get_functiondef('${signature}'::regprocedure);`),wrapped);
// Restore/reapply the actual preimage to prove both hashes and row equivalence;
// leave the candidate installed for the subsequent real HTTP load.
sql(recovery);assert.equal(sql(`SELECT pg_get_functiondef('${signature}'::regprocedure);`),original);
assert.deepEqual(cases(),before);sql(wrapped);assert.deepEqual(metadata(),beforeMeta);
const stats=a=>({samples:a.length,p50Ms:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)]});
const report={kind:'NATIVE_CLOCK_PLAN_REUSE_NOT_HTTP_CAPACITY',passed:true,original:stats(originalSamples),wrapped:stats(wrappedSamples),skew1000WaitingEntries:{original:stats(skewOriginal),wrapped:stats(skewWrapped)},checks:['same-oid-owner-acl-signature-properties','row-equivalence-small-and-skewed-tour','paused-clock','missing-tour','cross-tour','warmed-withdrawal-restore','source-update','private-backup-denied','exact-rollback-reapply','combined-025-then-023-recovery']};
if(process.env.PUBLIC_HUD_CLOCK_PLAN_REPORT)writeFileSync(process.env.PUBLIC_HUD_CLOCK_PLAN_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
