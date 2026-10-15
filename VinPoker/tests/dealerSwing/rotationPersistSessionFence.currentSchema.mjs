// Regression oracle: run only in the existing owned disposable PG17 harness.
// Baseline must fail at the mixed-table assertion, not at setup.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

assert.ok(process.env.PGHOST === '127.0.0.1' && process.env.PGPORT === '55441'
  && process.env.PGUSER === 'postgres' && process.env.PGDATABASE === 'vinpoker_ops_checkin',
  'Only the exact owned current-schema CI database is permitted');
for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS']) {
  assert.equal(process.env[key], undefined, `${key} override is forbidden`);
}
const fixture = readFileSync('tests/dealerSwing/operationalInventory.pg17.sql', 'utf8');
assert.equal((fixture.match(/ROLLBACK;/g) ?? []).length, 1);
const regression = `
RESET ROLE;
CREATE TEMP TABLE stale_rotation_assignment AS
SELECT id,table_id,table_session_id FROM public.dealer_assignments
WHERE table_session_id='e1700000-0000-4000-8000-000000000021' AND released_at IS NULL;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM stale_rotation_assignment),'one old assignment');
SELECT set_config('request.jwt.claim.role','service_role',true);
GRANT SELECT ON stale_rotation_assignment TO service_role;
SET LOCAL ROLE service_role;
-- A current-session positive control is essential: rejecting everything is not a fix.
DO $test$ DECLARE result jsonb; BEGIN
 result:=public.upsert_rotation_plan('e1700000-0000-4000-8000-000000000002',
 'e1700000-0000-4000-8000-000000000063',jsonb_build_array(jsonb_build_object(
 'table_id','e1700000-0000-4000-8000-000000000011','assignment_id',(SELECT id FROM stale_rotation_assignment),
 'slot_index',0,'planned_relief_at',now()+interval '30 minutes','is_shortage',true,'solver_version','session-fence-regression'),
 jsonb_build_object('table_id','e1700000-0000-4000-8000-000000000011',
 'assignment_id',null,'slot_index',1,'planned_relief_at',now()+interval '60 minutes',
 'is_shortage',true,'solver_version','session-fence-regression'),
 jsonb_build_object('table_id','e1700000-0000-4000-8000-000000000014',
 'assignment_id',(SELECT id FROM stale_rotation_assignment),'slot_index',0,
 'planned_relief_at',now()+interval '30 minutes','is_shortage',true,'solver_version','invalid-session')),
 ARRAY['e1700000-0000-4000-8000-000000000011'::uuid,'e1700000-0000-4000-8000-000000000014'::uuid]);
 PERFORM pg_temp.assert_true(result->>'outcome'='ok','current session persist succeeds');
 PERFORM pg_temp.assert_true(EXISTS(SELECT FROM public.dealer_rotation_schedule
   WHERE assignment_id=(SELECT id FROM stale_rotation_assignment) AND status='predicted'),
   'current session prediction exists despite invalid other table');
 PERFORM pg_temp.assert_true(EXISTS(SELECT FROM public.dealer_rotation_schedule
   WHERE table_id='e1700000-0000-4000-8000-000000000011' AND slot_index=1 AND assignment_id IS NULL
     AND status='predicted'), 'anchored forecast remains valid');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT FROM public.dealer_rotation_schedule
   WHERE table_id='e1700000-0000-4000-8000-000000000014'), 'invalid table has no prediction');
 PERFORM pg_temp.assert_true(result->'rejected_table_ids' @> '["e1700000-0000-4000-8000-000000000014"]'::jsonb,
   'receipt identifies rejected table');
END $test$;
-- Invalid input must not supersede the valid existing prediction.
CREATE TEMP TABLE preserved_prediction AS SELECT id,version FROM public.dealer_rotation_schedule
 WHERE table_id='e1700000-0000-4000-8000-000000000011' AND status='predicted';
DO $test$ DECLARE result jsonb; BEGIN
 result:=public.upsert_rotation_plan('e1700000-0000-4000-8000-000000000002',
 'e1700000-0000-4000-8000-000000000065',jsonb_build_array(jsonb_build_object(
 'table_id','e1700000-0000-4000-8000-000000000011','assignment_id',null,
 'slot_index',0,'planned_relief_at',now(),'is_shortage',true)),
 ARRAY['e1700000-0000-4000-8000-000000000011'::uuid]);
 PERFORM pg_temp.assert_true(result->'rejected_table_ids' @> '["e1700000-0000-4000-8000-000000000011"]'::jsonb,
   'NULL assignment rejects table');
 result:=public.upsert_rotation_plan('e1700000-0000-4000-8000-000000000002',
 'e1700000-0000-4000-8000-000000000068',jsonb_build_array(jsonb_build_object(
 'table_id','e1700000-0000-4000-8000-000000000011','assignment_id',null,
 'slot_index',1,'planned_relief_at',now(),'is_shortage',true)),
 ARRAY['e1700000-0000-4000-8000-000000000011'::uuid]);
 PERFORM pg_temp.assert_true(result->'rejected_table_ids' @> '["e1700000-0000-4000-8000-000000000011"]'::jsonb,
   'forecast without current slot0 anchor rejects table');
 result:=public.upsert_rotation_plan('e1700000-0000-4000-8000-000000000099',
 'e1700000-0000-4000-8000-000000000066','[]'::jsonb,
 ARRAY['e1700000-0000-4000-8000-000000000011'::uuid]);
 PERFORM pg_temp.assert_true(result->'rejected_table_ids' @> '["e1700000-0000-4000-8000-000000000011"]'::jsonb,
   'cross-club scope rejected');
 result:=public.upsert_rotation_plan('e1700000-0000-4000-8000-000000000002',
 'e1700000-0000-4000-8000-000000000067','[{"table_id":"not-a-uuid"}]'::jsonb,null);
 PERFORM pg_temp.assert_true(result->>'outcome'='error','malformed input returns explicit error');
 PERFORM pg_temp.assert_true((SELECT count(*)=2 FROM public.dealer_rotation_schedule s
   JOIN preserved_prediction p ON p.id=s.id AND p.version=s.version WHERE s.status='predicted'),
   'invalid input preserves valid prediction identity and version');
END $test$;
RESET ROLE;
-- The baseline close does not yet cancel predictions; remove the positive control
-- inside this rolled-back fixture so this test isolates NEW stale persistence.
DELETE FROM public.dealer_rotation_schedule WHERE table_id='e1700000-0000-4000-8000-000000000011';
SELECT set_config('test.rotation_revision',(SELECT revision::text FROM public.table_sessions
 WHERE id='e1700000-0000-4000-8000-000000000021'),true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((public.operator_close_club_table_v2(
 'e1700000-0000-4000-8000-000000000021',current_setting('test.rotation_revision')::bigint,
 'e1700000-0000-4000-8000-000000000061')->>'ok')::boolean,'canonical close succeeds');
SELECT pg_temp.assert_true((public.operator_open_club_tables_v2(
 ARRAY['e1700000-0000-4000-8000-000000000011'::uuid],'cash',
 'e1700000-0000-4000-8000-000000000062')->>'ok')::boolean,'physical table reopens');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.dealer_assignments
 WHERE id=(SELECT id FROM stale_rotation_assignment) AND released_at IS NULL),'old assignment released');
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
SELECT public.upsert_rotation_plan('e1700000-0000-4000-8000-000000000002',
 'e1700000-0000-4000-8000-000000000064',jsonb_build_array(jsonb_build_object(
 'table_id','e1700000-0000-4000-8000-000000000011','assignment_id',(SELECT id FROM stale_rotation_assignment),
 'slot_index',0,'planned_relief_at',now()+interval '30 minutes','is_shortage',true,'solver_version','session-fence-regression')),
 ARRAY['e1700000-0000-4000-8000-000000000011'::uuid]);
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM public.dealer_rotation_schedule
 WHERE assignment_id=(SELECT id FROM stale_rotation_assignment) AND status='predicted'),
 'stale_rotation_prediction_committed');
RESET ROLE;
`;
const intent = `SELECT set_config('request.headers','{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"e1700000-0000-4000-8000-000000000001"}',true);`;
const preflight = `DO $$ BEGIN IF current_database()<>'vinpoker_ops_checkin' OR current_user<>'postgres'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55441
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'Exact owned loopback PG17 database required'; END IF; END $$;`;
const sql = (preflight + fixture.replace('BEGIN;', `BEGIN; ${intent}`)
  .replace('ROLLBACK;', `${regression}\nROLLBACK;`))
  .replaceAll('e1700000-', 'e9700000-')
  .replaceAll("'exact-key'", "'persist-session-exact-key'")
  .replaceAll("'cross-club-key'", "'persist-session-cross-club-key'")
  .replaceAll("'closed-key'", "'persist-session-closed-key'");
const result = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
assert.equal(result.error, undefined, result.error?.message);
assert.equal(result.status, 0, result.stderr);
console.log('Current-session positive control and close/reopen stale persist rejection PASS');
