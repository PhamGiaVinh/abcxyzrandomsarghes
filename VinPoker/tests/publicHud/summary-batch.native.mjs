import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {sql,jsonSql,sqlAsync} from './nativeDb.mjs';
const tour='10000000-0000-4000-8000-000000000001',player='30000000-0000-4000-8000-000000000001';
sql(readFileSync('supabase/migrations/20261104002600_public_hud_summary_batch.sql','utf8'));
const read=(snapshots='ARRAY[NULL]::text[]')=>jsonSql(`SET ROLE anon;SELECT public.get_public_player_hud_summary_batch_v1('${tour}','${player}',${snapshots});`);
assert.equal(read().summary.access,'public');assert.ok(['current','updating'].includes(read().summary.state));
// Compare within the SAME statement, including the returned current snapshot.
const equivalence=(iterations=1)=>`DO $$ DECLARE batch jsonb; scalar jsonb; actual jsonb; previous text; repeat integer;
 BEGIN FOR repeat IN 1..${iterations} LOOP FOREACH previous IN ARRAY ARRAY[NULL,'1:2:',pg_current_snapshot()::text,pg_current_snapshot()::text] LOOP
 SELECT public.get_public_player_hud_summary_v1('${tour}','${player}',previous),
 public.get_public_player_hud_summary_batch_v1('${tour}','${player}',ARRAY[previous]) INTO scalar,batch;
 IF NOT (batch#>>'{checks,0,valid}')::boolean THEN RAISE EXCEPTION 'batch_valid_snapshot_rejected';END IF;
 actual:=batch->'summary';
 IF actual->>'access'='public' AND actual->>'state' IN ('current','updating') THEN
 actual:=actual||jsonb_build_object('accessChanged',batch#>'{checks,0,accessChanged}');END IF;
 IF actual IS DISTINCT FROM scalar THEN RAISE EXCEPTION 'batch_scalar_differs';END IF;
 END LOOP;END LOOP;END $$;`;
for(const role of ['anon','authenticated','service_role'])sql(`SET ROLE ${role};${equivalence()}`);
// DO is volatile: separate SPI assignments may acquire different snapshots.
// Unrelated committed XIDs must not break SAME-SELECT scalar/batch parity.
const xidChurn=sqlAsync(Array(500).fill('BEGIN;SELECT pg_current_xact_id();SELECT pg_sleep(0.002);COMMIT;').join('\n'));
try{for(const role of ['anon','authenticated','service_role'])sql(`SET ROLE ${role};${equivalence(32)}`);}finally{await xidChurn;}
const mixed=read("ARRAY[NULL,'invalid','1:2:','2:1:',NULL]::text[]");
assert.equal(mixed.version,'public-hud-summary-batch-v1');assert.equal(mixed.checks.length,5);
assert.deepEqual(mixed.checks.map(c=>c.valid),[true,false,true,false,true]);
assert.deepEqual(mixed.checks.map(c=>c.snapshot),[null,'invalid','1:2:','2:1:',null]);
// Shape and UTF8-byte limits are enforced before any aggregate computation.
for(const input of ['NULL::text[]',"ARRAY[]::text[]","array_fill('1:2:'::text,ARRAY[65])","ARRAY[['1:2:','2:3:']]::text[]","array_fill(repeat('界',6000),ARRAY[1])"])
 assert.throws(()=>read(input),/invalid_snapshot_batch/);
assert.equal(read("ARRAY[repeat('1',8193)]::text[]").checks[0].valid,false);
sql(`BEGIN;UPDATE tracker_analytics_v1.config SET enabled=false;SET LOCAL ROLE anon;${equivalence()}
 DO $$ DECLARE b jsonb;BEGIN b:=public.get_public_player_hud_summary_batch_v1('${tour}','${player}',ARRAY['invalid']);
 IF b#>>'{summary,state}'<>'warming' OR b#>>'{checks,0,valid}'<>'true' THEN RAISE EXCEPTION 'warming_snapshot_parse_changed';END IF;END $$;
 RESET ROLE;ROLLBACK;`);
sql(`BEGIN;INSERT INTO tracker_analytics_v1.visibility_barriers(tournament_id) VALUES('${tour}') ON CONFLICT DO NOTHING;
 SET LOCAL ROLE anon;${equivalence()}
 DO $$ DECLARE b jsonb;BEGIN b:=public.get_public_player_hud_summary_batch_v1('${tour}','${player}',ARRAY['invalid']);
 IF b#>>'{summary,state}'<>'unavailable' OR b#>>'{checks,0,valid}'<>'true' THEN RAISE EXCEPTION 'blocked_snapshot_parse_changed';END IF;END $$;
 RESET ROLE;ROLLBACK;`);
sql(`BEGIN;UPDATE public.tournaments SET deleted_at=clock_timestamp() WHERE id='${tour}';SET LOCAL ROLE anon;${equivalence()}
 DO $$ DECLARE b jsonb;BEGIN b:=public.get_public_player_hud_summary_batch_v1('${tour}','${player}',ARRAY['invalid']);
 IF b#>>'{summary,access}'<>'revoked' OR b#>>'{checks,0,valid}'<>'true' THEN RAISE EXCEPTION 'revoked_snapshot_parse_changed';END IF;END $$;
 RESET ROLE;ROLLBACK;`);
const wrong=jsonSql(`SET ROLE anon;SELECT public.get_public_player_hud_summary_batch_v1('${tour}','90000000-0000-4000-8000-999999999999',ARRAY[NULL]::text[]);`);
assert.equal(wrong.summary.access,'revoked');
assert.equal(jsonSql(`SET ROLE anon;SELECT public.get_public_player_hud_summary_batch_v1('10000000-0000-4000-8000-999999999999','${player}',ARRAY[NULL]::text[]);`).summary.access,'revoked');
// An earlier allocated transaction commits AFTER a later revocation and open.
// MAX(event_id) remains unchanged, but both scalar and batch must detect it.
const early=sqlAsync(`BEGIN;SELECT tracker_analytics_v1.mark_access_revocation();SELECT pg_advisory_xact_lock(911040026);SELECT pg_sleep(2);COMMIT;`);
let started=false;
for(let i=0;i<30;i++){
 if(sql('SELECT pg_try_advisory_xact_lock(911040026);')==='f'){started=true;break;}
 await new Promise(resolve=>setTimeout(resolve,20));
}
assert.equal(started,true);sql('SELECT tracker_analytics_v1.mark_access_revocation();');
const between=read().summary.accessSnapshot,maxBefore=sql('SELECT max(event_id) FROM tracker_analytics_v1.access_revocations;');
assert.match(between,/^\d+:\d+:(\d+(,\d+)*)?$/);await early;
assert.equal(sql('SELECT max(event_id) FROM tracker_analytics_v1.access_revocations;'),maxBefore);
const after=read(`ARRAY['${between}',NULL,'invalid','${between}']::text[]`);
assert.deepEqual(after.checks.map(c=>[c.valid,c.accessChanged]),[[true,true],[true,false],[false,false],[true,true]]);
assert.equal(jsonSql(`SET ROLE anon;SELECT public.get_public_player_hud_summary_v1('${tour}','${player}','${between}');`).accessChanged,true);
assert.equal(read(`ARRAY['${after.summary.accessSnapshot}']::text[]`).checks[0].accessChanged,false);
assert.throws(()=>sql('SET ROLE anon;SELECT * FROM tracker_analytics_v1.access_revocations;'),/permission denied/);
sql(readFileSync('tests/publicHud/summary-batch.forward-rollback.sql','utf8').replace(/^COMMIT;/m,()=>`DO $$ BEGIN
 IF to_regprocedure('public.get_public_player_hud_summary_batch_v1(uuid,uuid,text[])') IS NOT NULL THEN RAISE EXCEPTION 'batch_recovery_still_present';END IF;
 IF md5(replace(pg_get_functiondef('public.get_public_player_hud_summary_v1(uuid,uuid,text)'::regprocedure),chr(13),''))<>'0f3feed28a4e3711ed2d4e7511e1ca26' THEN RAISE EXCEPTION 'scalar_recovery_changed';END IF;
 END $$;ROLLBACK;`));
assert.equal(read().version,'public-hud-summary-batch-v1');
const report={kind:'NATIVE_SUMMARY_BATCH_NOT_HTTP_CAPACITY',passed:true,checks:['scalar-equivalence-three-roles','single-statement-parity-under-unrelated-xid-churn','exact-current-snapshot','null-duplicates-mixed-malformed','shape-count-utf8-byte-bounds','warming-unavailable-revoked-early-outcomes','wrong-player-tour-scope','out-of-order-committed-revocation','reopen-current-snapshot','private-revocation-table-denied','guarded-drop-recovery-preserves-scalar']};
if(process.env.PUBLIC_HUD_SUMMARY_BATCH_REPORT)writeFileSync(process.env.PUBLIC_HUD_SUMMARY_BATCH_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
