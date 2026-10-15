// Diagnostic only: stale prediction persistence is not successful Swing execution.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
assert.ok(process.env.PGHOST==='127.0.0.1'&&process.env.PGPORT==='55441'
 &&process.env.PGUSER==='postgres'&&process.env.PGDATABASE==='vinpoker_ops_checkin',
 'Only the exact owned current-schema CI database is permitted');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])
 assert.ok(process.env[key]===undefined,`${key} override is forbidden`);
const fixture=readFileSync('tests/dealerSwing/operationalInventory.pg17.sql','utf8');
assert.equal((fixture.match(/ROLLBACK;/g)??[]).length,1);
const diagnostic=`
RESET ROLE;
SELECT pg_temp.assert_true(md5(replace(pg_get_functiondef('public.upsert_rotation_plan(uuid,uuid,jsonb,uuid[])'::regprocedure),chr(13),''))='a9fa4700cdd8b75e713ffcd7578155b6','persist definition matches LF-normalized live function');
CREATE TEMP TABLE stale_rotation_assignment AS
SELECT id,table_id,table_session_id FROM public.dealer_assignments
WHERE table_session_id='e1700000-0000-4000-8000-000000000021' AND released_at IS NULL;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM stale_rotation_assignment),'one actual old assignment');
SELECT set_config('test.rotation_revision',(SELECT revision::text FROM public.table_sessions WHERE id='e1700000-0000-4000-8000-000000000021'),true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((public.operator_close_club_table_v2(
 'e1700000-0000-4000-8000-000000000021',current_setting('test.rotation_revision')::bigint,
 'e1700000-0000-4000-8000-000000000061')->>'ok')::boolean,'canonical close succeeds');
SELECT pg_temp.assert_true((public.operator_open_club_tables_v2(
 ARRAY['e1700000-0000-4000-8000-000000000011'::uuid],'cash',
 'e1700000-0000-4000-8000-000000000062')->>'ok')::boolean,'same physical table reopens');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id='e1700000-0000-4000-8000-000000000021'),'old session closed');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.table_sessions WHERE game_table_id='e1700000-0000-4000-8000-000000000011' AND closed_at IS NULL AND id<>'e1700000-0000-4000-8000-000000000021'),'new exact session exists');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.dealer_assignments WHERE id=(SELECT id FROM stale_rotation_assignment) AND released_at IS NULL),'old assignment released by canonical close');
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.headers','{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"e1700000-0000-4000-8000-000000000001"}',true);
GRANT SELECT ON stale_rotation_assignment TO service_role;
SET LOCAL ROLE service_role;
DO $test$ DECLARE result jsonb; BEGIN
 result:=public.upsert_rotation_plan('e1700000-0000-4000-8000-000000000002',
 'e1700000-0000-4000-8000-000000000063',jsonb_build_array(jsonb_build_object(
 'table_id','e1700000-0000-4000-8000-000000000011','assignment_id',(SELECT id FROM stale_rotation_assignment),
 'slot_index',0,'planned_relief_at',now()+interval '30 minutes','is_shortage',true,'solver_version','stale-session-diagnostic')),
 ARRAY['e1700000-0000-4000-8000-000000000011'::uuid]);
 PERFORM pg_temp.assert_true(result->>'outcome'='ok','diagnostic: stale snapshot still accepted by persist');
 PERFORM pg_temp.assert_true(EXISTS(SELECT FROM public.dealer_rotation_schedule WHERE assignment_id=(SELECT id FROM stale_rotation_assignment) AND status='predicted'),'diagnostic: stale predicted row exists after reopen');
END $test$;
RESET ROLE;
`;
// Verified manual-intent exception only; this is NOT an automatic-OFF test.
const manual=`SELECT set_config('request.headers','{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"e1700000-0000-4000-8000-000000000001"}',true);`;
const preflight=`DO $$ BEGIN IF current_database()<>'vinpoker_ops_checkin' OR current_user<>'postgres'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55441
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'Exact owned loopback PG17 database required'; END IF; END $$;`;
// The earlier overlap harness deliberately commits e170 fixtures; use our own namespace.
const sql=(preflight+fixture.replace('BEGIN;',`BEGIN; ${manual}`).replace('ROLLBACK;',`${diagnostic}\nROLLBACK;`))
 .replaceAll('e1700000-','e8700000-');
const result=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
assert.equal(result.status,0,result.stderr);
console.log('DIAGNOSTIC ONLY (verified manual intent): close/reopen releases old assignment but stale predicted plan persists; not automatic-OFF or Swing execution proof');
