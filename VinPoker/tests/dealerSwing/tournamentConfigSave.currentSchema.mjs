import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
assert.ok(process.env.PGHOST==='127.0.0.1'&&process.env.PGPORT==='55441'
 &&process.env.PGUSER==='postgres'&&process.env.PGDATABASE==='vinpoker_ops_checkin');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.equal(process.env[key],undefined);
const fixture=readFileSync('tests/dealerSwing/operationalInventory.pg17.sql','utf8');
assert.equal((fixture.match(/ROLLBACK;/g)??[]).length,1);
const body=`
RESET ROLE;
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 ('e1700000-0000-4000-8000-000000000015','e1700000-0000-4000-8000-000000000002','Config A',5,'tournament','inactive','available'),
 ('e1700000-0000-4000-8000-000000000016','e1700000-0000-4000-8000-000000000002','Config B',6,'tournament','inactive','available');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.save_tournament_config_v1(uuid,uuid,jsonb,uuid[],timestamptz,uuid[],uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.save_tournament_config_v1(uuid,uuid,jsonb,uuid[],timestamptz,uuid[],uuid,uuid)','EXECUTE'), 'exact actor-only ACL');
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
DO $test$ DECLARE r jsonb; again jsonb; payload jsonb:='{"name":"Atomic config TEST","swing_duration_minutes":45,"warn_at_minutes":5,"crit_at_minutes":2}'; BEGIN
 again:=public.save_tournament_config_v1(NULL,'e1700000-0000-4000-8000-000000000002',payload,
 ARRAY[]::uuid[],NULL,ARRAY[]::uuid[],'e1700000-0000-4000-8000-000000000089',
 'e1700000-0000-4000-8000-000000000098');
 PERFORM pg_temp.assert_true(again->>'error'='actor_changed','queued request under changed account rejected');
 again:=public.get_tournament_config_save_receipt_v1('e1700000-0000-4000-8000-000000000089',
 'e1700000-0000-4000-8000-000000000098');
 PERFORM pg_temp.assert_true(again->>'error'='actor_changed','receipt bound to expected actor');
 r:=public.save_tournament_config_v1(NULL,'e1700000-0000-4000-8000-000000000002',payload,
 ARRAY['e1700000-0000-4000-8000-000000000015'::uuid,'e1700000-0000-4000-8000-000000000016'::uuid],NULL,ARRAY[]::uuid[],
 'e1700000-0000-4000-8000-000000000081',auth.uid());
 PERFORM pg_temp.assert_true((r->>'ok')::boolean,'create opens two selected canonical tables');
 PERFORM set_config('test.config_tour',r->'tournament'->>'id',true);
 PERFORM set_config('test.config_updated_at',r->'tournament'->>'updated_at',true);
 again:=public.save_tournament_config_v1(NULL,'e1700000-0000-4000-8000-000000000002',payload,
 ARRAY['e1700000-0000-4000-8000-000000000016'::uuid,'e1700000-0000-4000-8000-000000000015'::uuid],NULL,ARRAY[]::uuid[],
 'e1700000-0000-4000-8000-000000000081',auth.uid());
 PERFORM pg_temp.assert_true(again=r,'lost response replay and normalized table ordering');
 again:=public.save_tournament_config_v1(NULL,'e1700000-0000-4000-8000-000000000002',payload||'{"name":"changed"}'::jsonb,
 ARRAY['e1700000-0000-4000-8000-000000000015'::uuid,'e1700000-0000-4000-8000-000000000016'::uuid],NULL,ARRAY[]::uuid[],
 'e1700000-0000-4000-8000-000000000081',auth.uid());
 PERFORM pg_temp.assert_true(again->>'error'='IDEMPOTENCY_CONFLICT','same key changed payload conflicts');
 again:=public.save_tournament_config_v1(NULL,'e1700000-0000-4000-8000-000000000099',payload,ARRAY[]::uuid[],NULL,ARRAY[]::uuid[],
 'e1700000-0000-4000-8000-000000000082',auth.uid());
 PERFORM pg_temp.assert_true(again->>'error'='actor_not_allowed','cross-club actor denied');
END $test$;
RESET ROLE;
CREATE TEMP TABLE config_links_before AS SELECT id,game_table_id,table_session_id,status
 FROM public.tournament_tables WHERE tournament_id=current_setting('test.config_tour')::uuid;
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM config_links_before),'two canonical identities');
SELECT set_config('test.config_active_ids',(SELECT array_agg(id ORDER BY id)::text FROM config_links_before),true);
CREATE FUNCTION pg_temp.config_fingerprint() RETURNS text LANGUAGE sql AS $fn$
 SELECT md5(jsonb_build_object('tours',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t),
 'tables',(SELECT jsonb_agg(to_jsonb(tt) ORDER BY id) FROM public.tournament_tables tt),
 'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.table_sessions s),
 'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,operation_type,request_id) FROM public.table_operation_receipts r))::text)
$fn$;
DO $test$ DECLARE before text:=pg_temp.config_fingerprint(); BEGIN
 BEGIN
   PERFORM public.save_tournament_config_v1(NULL,'e1700000-0000-4000-8000-000000000002',
   '{"name":"must roll back","swing_duration_minutes":45,"warn_at_minutes":5,"crit_at_minutes":2}',
   ARRAY['e1700000-0000-4000-8000-000000000014'::uuid,'e1700000-0000-4000-8000-000000000015'::uuid],NULL,ARRAY[]::uuid[],
   'e1700000-0000-4000-8000-000000000083',auth.uid());
   RAISE EXCEPTION 'expected child failure';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
   IF SQLERRM<>'configuration_table_open_rejected' THEN RAISE; END IF;
 END;
 PERFORM pg_temp.assert_true(pg_temp.config_fingerprint()=before,'parent and earlier child open roll back together');
 BEGIN
   PERFORM public.save_tournament_config_v1(current_setting('test.config_tour')::uuid,'e1700000-0000-4000-8000-000000000002',
   '{"name":"must not close old tables","swing_duration_minutes":45,"warn_at_minutes":5,"crit_at_minutes":2}',
   ARRAY['e1700000-0000-4000-8000-000000000011'::uuid],current_setting('test.config_updated_at')::timestamptz,
   current_setting('test.config_active_ids')::uuid[],'e1700000-0000-4000-8000-000000000084',auth.uid());
   RAISE EXCEPTION 'expected replacement failure';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
   IF SQLERRM<>'configuration_table_open_rejected' THEN RAISE; END IF;
 END;
 PERFORM pg_temp.assert_true(pg_temp.config_fingerprint()=before,'earlier closes and metadata roll back on later failure');
END $test$;
CREATE FUNCTION pg_temp.reject_config_receipt() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF NEW.operation_type='save_tournament_config_v1' THEN
   RAISE EXCEPTION 'injected_config_receipt_failure';
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER config_receipt_failure BEFORE INSERT ON public.table_operation_receipts
 FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_config_receipt();
DO $test$ DECLARE before text:=pg_temp.config_fingerprint(); BEGIN
 BEGIN
   PERFORM public.save_tournament_config_v1(NULL,'e1700000-0000-4000-8000-000000000002',
   '{"name":"receipt must roll back","swing_duration_minutes":45,"warn_at_minutes":5,"crit_at_minutes":2}',
   ARRAY['e1700000-0000-4000-8000-000000000014'::uuid],NULL,ARRAY[]::uuid[],
   'e1700000-0000-4000-8000-000000000087',auth.uid());
   RAISE EXCEPTION 'expected receipt failure';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
   IF SQLERRM<>'injected_config_receipt_failure' THEN RAISE; END IF;
 END;
 PERFORM pg_temp.assert_true(pg_temp.config_fingerprint()=before,
   'final receipt failure rolls back parent, opened table, session and child receipt');
END $test$;
DROP TRIGGER config_receipt_failure ON public.table_operation_receipts;
SET LOCAL ROLE authenticated;
DO $test$ DECLARE r jsonb; replay jsonb; BEGIN
 r:=public.save_tournament_config_v1(current_setting('test.config_tour')::uuid,'e1700000-0000-4000-8000-000000000002',
 '{"name":"metadata updated","swing_duration_minutes":45,"warn_at_minutes":5,"crit_at_minutes":2}',
 ARRAY['e1700000-0000-4000-8000-000000000015'::uuid,'e1700000-0000-4000-8000-000000000016'::uuid],
 current_setting('test.config_updated_at')::timestamptz,current_setting('test.config_active_ids')::uuid[],
 'e1700000-0000-4000-8000-000000000085',auth.uid());
 PERFORM pg_temp.assert_true((r->>'ok')::boolean,'valid metadata update');
 replay:=public.get_tournament_config_save_receipt_v1('e1700000-0000-4000-8000-000000000085',auth.uid());
 PERFORM pg_temp.assert_true(replay=r,'actor receipt reader recovers committed result');
 replay:=public.save_tournament_config_v1(current_setting('test.config_tour')::uuid,'e1700000-0000-4000-8000-000000000002',
 '{"name":"stale update","swing_duration_minutes":45,"warn_at_minutes":5,"crit_at_minutes":2}',
 ARRAY['e1700000-0000-4000-8000-000000000015'::uuid,'e1700000-0000-4000-8000-000000000016'::uuid],
 current_setting('test.config_updated_at')::timestamptz,current_setting('test.config_active_ids')::uuid[],
 'e1700000-0000-4000-8000-000000000086',auth.uid());
 PERFORM pg_temp.assert_true(replay->>'error'='STALE_CONFIG','stale metadata cannot overwrite');
END $test$;
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT id,game_table_id,table_session_id,status FROM config_links_before
 EXCEPT SELECT id,game_table_id,table_session_id,status FROM public.tournament_tables WHERE tournament_id=current_setting('test.config_tour')::uuid),
 'metadata updates preserve existing table identities');
`;
const preflight=`DO $$ BEGIN IF current_database()<>'vinpoker_ops_checkin' OR current_user<>'postgres'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55441
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'Owned PG17 TEST required'; END IF; END $$;`;
const intent=`SELECT set_config('request.headers','{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"e1700000-0000-4000-8000-000000000001"}',true);`;
const sql=(preflight+fixture.replace('BEGIN;',`BEGIN; ${intent}`).replace('ROLLBACK;',body+'\nROLLBACK;'))
 .replaceAll('auth.uid()',"current_setting('request.jwt.claim.sub')::uuid")
 .replaceAll('e1700000-','ee800000-').replaceAll("'exact-key'","'config88-exact'")
 .replaceAll("'cross-club-key'","'config88-cross'").replaceAll("'closed-key'","'config88-closed'");
const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
assert.equal(r.error,undefined,r.error?.message);
assert.equal(r.status,0,r.stderr);
console.log('Atomic config create/update, actor scope, CAS, receipt and child rollback PASS');
