BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_tournament_create91'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR inet_server_port()<>55441 OR current_user<>'postgres'
 OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN
   RAISE EXCEPTION 'wrong_owned_create91_target';
 END IF;
END $$;
-- The schema-only restored TEST fixture omits Supabase's managed auth grants.
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE FUNCTION pg_temp.assert91(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'create91_assertion: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES
 ('e9100000-0000-4000-8000-000000000001'),('e9100000-0000-4000-8000-000000000002');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('e9100000-0000-4000-8000-000000000011','e9100000-0000-4000-8000-000000000001','Create91 TEST','TEST'),
 ('e9100000-0000-4000-8000-000000000012','e9100000-0000-4000-8000-000000000002','Foreign91 TEST','TEST');
SELECT set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
CREATE FUNCTION pg_temp.fingerprint91() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_object(
 'parents',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t),
 'levels',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l),
 'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,operation_type,request_id) FROM public.table_operation_receipts r))::text)
$$;
SELECT pg_temp.assert91(NOT has_function_privilege('anon','public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)','EXECUTE'), 'actor-only ACL');
SELECT pg_temp.assert91(NOT has_function_privilege('anon','public.get_tournament_create_receipt_v1(uuid,jsonb,jsonb,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.get_tournament_create_receipt_v1(uuid,jsonb,jsonb,uuid,uuid)','EXECUTE'), 'receipt actor-only ACL');
CREATE TEMP TABLE request91 AS SELECT
 '{"name":"Atomic91 TEST","start_time":"2026-10-20T05:00:00Z","buy_in":1000000,"rake_amount":100000,"service_fee_amount":50000,"guarantee_amount":null,"starting_stack":20000,"location":"TEST","description":"atomic fixture","game_type":"nlh","minutes_per_level":20,"late_reg_close_level":6}'::jsonb config,
 '[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]'::jsonb levels;
GRANT SELECT ON request91 TO authenticated;

CREATE FUNCTION pg_temp.reject_level91() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'injected_level91_failure'; END $$;
CREATE TRIGGER reject_level91 BEFORE INSERT ON public.tournament_levels FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_level91();
DO $$ DECLARE before text:=pg_temp.fingerprint91(); BEGIN
 PERFORM set_config('role','authenticated',true);
 BEGIN
  PERFORM public.create_tournament_with_levels_v1('e9100000-0000-4000-8000-000000000011',config,levels,
   'e9100000-0000-4000-8000-000000000021',auth.uid()) FROM request91;
  RAISE EXCEPTION 'fault_not_reached';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected_level91_failure' THEN RAISE; END IF; END;
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.assert91(pg_temp.fingerprint91()=before,'failed levels rollback parent and receipt');
END $$;
DROP TRIGGER reject_level91 ON public.tournament_levels;

SET LOCAL ROLE authenticated;
DO $$ DECLARE first jsonb; replay jsonb; BEGIN
 SELECT public.create_tournament_with_levels_v1('e9100000-0000-4000-8000-000000000011',config,levels,
  'e9100000-0000-4000-8000-000000000021',auth.uid()) INTO first FROM request91;
 PERFORM pg_temp.assert91((first->>'ok')::boolean,'owner positive');
 PERFORM set_config('test.created91',first->>'tournament_id',true);
 SELECT public.create_tournament_with_levels_v1('e9100000-0000-4000-8000-000000000011',config,levels,
  'e9100000-0000-4000-8000-000000000021',auth.uid()) INTO replay FROM request91;
 PERFORM pg_temp.assert91(replay=first,'lost response same key returns identical receipt');
 SELECT public.get_tournament_create_receipt_v1('e9100000-0000-4000-8000-000000000011',config,levels,
  'e9100000-0000-4000-8000-000000000021',auth.uid()) INTO replay FROM request91;
 PERFORM pg_temp.assert91(replay=first,'receipt readback returns identical commit without writer');
 SELECT public.get_tournament_create_receipt_v1('e9100000-0000-4000-8000-000000000011',config||'{"name":"changed"}',levels,
  'e9100000-0000-4000-8000-000000000021',auth.uid()) INTO replay FROM request91;
 PERFORM pg_temp.assert91(replay->>'error'='IDEMPOTENCY_CONFLICT','receipt rejects mismatched payload');
 SELECT public.create_tournament_with_levels_v1('e9100000-0000-4000-8000-000000000011',config||'{"buy_in":2}'::jsonb,levels,
  'e9100000-0000-4000-8000-000000000021',auth.uid()) INTO replay FROM request91;
 PERFORM pg_temp.assert91(replay->>'error'='IDEMPOTENCY_CONFLICT','same key changed money conflicts');
 SELECT public.create_tournament_with_levels_v1('e9100000-0000-4000-8000-000000000011',config,'[]',
  'e9100000-0000-4000-8000-000000000021',auth.uid()) INTO replay FROM request91;
 PERFORM pg_temp.assert91(replay->>'error'='IDEMPOTENCY_CONFLICT','same key changed levels conflicts');
 SELECT public.create_tournament_with_levels_v1('e9100000-0000-4000-8000-000000000012',config,levels,
  'e9100000-0000-4000-8000-000000000022',auth.uid()) INTO replay FROM request91;
 PERFORM pg_temp.assert91(replay->>'error'='actor_not_allowed','wrong club denied');
 SELECT public.create_tournament_with_levels_v1('e9100000-0000-4000-8000-000000000011',config,levels,
  'e9100000-0000-4000-8000-000000000022','e9100000-0000-4000-8000-000000000002') INTO replay FROM request91;
 PERFORM pg_temp.assert91(replay->>'error'='actor_changed','expected actor fenced');
 SELECT public.create_tournament_with_levels_v1('e9100000-0000-4000-8000-000000000011',config||'{"club_id":"e9100000-0000-4000-8000-000000000012"}',levels,
  'e9100000-0000-4000-8000-000000000022',auth.uid()) INTO replay FROM request91;
 PERFORM pg_temp.assert91(replay->>'error'='unsupported_create_field','cannot smuggle alternate club');
END $$;
RESET ROLE;
SELECT pg_temp.assert91((SELECT count(*)=1 FROM public.tournaments WHERE club_id='e9100000-0000-4000-8000-000000000011'),'one parent only');
SELECT pg_temp.assert91((SELECT count(*)=1 FROM public.tournament_levels WHERE tournament_id=current_setting('test.created91')::uuid),'one selected level');
SELECT pg_temp.assert91((SELECT buy_in=1000000 AND rake_amount=100000 AND service_fee_amount=50000
 AND guarantee_amount IS NULL AND starting_stack=20000 AND live_status='registering'
 FROM public.tournaments WHERE id=current_setting('test.created91')::uuid),'money/stack/status unchanged');

CREATE FUNCTION pg_temp.reject_receipt91() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.operation_type='create_tournament_with_levels_v1' THEN RAISE EXCEPTION 'injected_receipt91_failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER reject_receipt91 BEFORE INSERT ON public.table_operation_receipts FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_receipt91();
DO $$ DECLARE before text:=pg_temp.fingerprint91(); BEGIN
 PERFORM set_config('role','authenticated',true);
 BEGIN
  PERFORM public.create_tournament_with_levels_v1('e9100000-0000-4000-8000-000000000011',config,levels,
   'e9100000-0000-4000-8000-000000000023',auth.uid()) FROM request91;
  RAISE EXCEPTION 'receipt_fault_not_reached';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected_receipt91_failure' THEN RAISE; END IF; END;
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.assert91(pg_temp.fingerprint91()=before,'failed receipt rollback parent and levels');
END $$;
DROP TRIGGER reject_receipt91 ON public.table_operation_receipts;

-- Compare the existing two-statement RLS seam with the atomic RPC, rather than
-- assuming broader Floor permissions are equivalent to tournament INSERT.
INSERT INTO auth.users(id) VALUES
 ('e9100000-0000-4000-8000-000000000003'),('e9100000-0000-4000-8000-000000000004'),
 ('e9100000-0000-4000-8000-000000000005'),('e9100000-0000-4000-8000-000000000006');
INSERT INTO public.club_cashiers(club_id,user_id) VALUES
 ('e9100000-0000-4000-8000-000000000011','e9100000-0000-4000-8000-000000000003');
INSERT INTO public.club_trackers(club_id,user_id,granted_by) VALUES
 ('e9100000-0000-4000-8000-000000000011','e9100000-0000-4000-8000-000000000004','e9100000-0000-4000-8000-000000000001');
INSERT INTO public.club_dealer_controls(club_id,user_id) VALUES
 ('e9100000-0000-4000-8000-000000000011','e9100000-0000-4000-8000-000000000005');
INSERT INTO public.user_roles(user_id,role) VALUES('e9100000-0000-4000-8000-000000000006','super_admin');
DO $$ DECLARE actor uuid; old_allowed boolean; parent_id uuid; r jsonb; before text;
BEGIN
 FOREACH actor IN ARRAY ARRAY[
  'e9100000-0000-4000-8000-000000000001'::uuid,'e9100000-0000-4000-8000-000000000002'::uuid,
  'e9100000-0000-4000-8000-000000000003'::uuid,'e9100000-0000-4000-8000-000000000004'::uuid,
  'e9100000-0000-4000-8000-000000000005'::uuid,'e9100000-0000-4000-8000-000000000006'::uuid
 ] LOOP
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  old_allowed:=false;
  PERFORM set_config('role','authenticated',true);
  BEGIN
   INSERT INTO public.tournaments(club_id,name,start_time,buy_in,rake_amount,starting_stack,game_type,minutes_per_level,late_reg_close_level,live_status)
    VALUES('e9100000-0000-4000-8000-000000000011','Role91 TEST','2026-10-20T05:00:00Z',1000000,0,20000,'nlh',20,6,'registering') RETURNING id INTO parent_id;
   INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,duration_minutes,is_break)
    VALUES(parent_id,1,100,200,0,20,false);
   RAISE EXCEPTION USING ERRCODE='P9191',MESSAGE='rollback_successful_old_seam';
  EXCEPTION WHEN SQLSTATE 'P9191' THEN old_allowed:=true;
   WHEN insufficient_privilege THEN old_allowed:=false;
  END;
  PERFORM set_config('role','none',true);
  before:=pg_temp.fingerprint91();
  PERFORM set_config('role','authenticated',true);
  SELECT public.create_tournament_with_levels_v1('e9100000-0000-4000-8000-000000000011',config,levels,
   'e9100000-0000-4000-8000-000000000029',actor) INTO r FROM request91;
  PERFORM pg_temp.assert91((r->>'ok')::boolean=old_allowed,'atomic authority equals old parent+levels authority for '||actor);
  PERFORM set_config('role','none',true);
  IF NOT old_allowed THEN PERFORM pg_temp.assert91(pg_temp.fingerprint91()=before,'denied role has zero business delta'); END IF;
 END LOOP;
END $$;
ROLLBACK;
\echo CREATE91_PARENT_LEVEL_RECEIPT_ROLLBACK_ACTOR_TENANT_REPLAY_AND_MONEY_PASS
\echo CREATE91_OWNER_OUTSIDER_CASHIER_TRACKER_DEALER_CONTROL_SUPERADMIN_MATCH_EXISTING_RLS_PASS
