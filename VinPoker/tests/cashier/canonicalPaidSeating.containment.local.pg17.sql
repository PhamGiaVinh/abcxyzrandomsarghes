-- LOCAL rollback rehearsal only: hold initial canonical allocation, retain payment records and113 guards.
-- This is NOT an all-writer/re-entry shutdown or permission to apply production DDL.
-- Owned reviewed-schema TEST. Requires main13/27/28, candidate113 and inert repo network support.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='20s';
DO $$ DECLARE
 actor uuid:=gen_random_uuid();club uuid:=gen_random_uuid();
 tour uuid;physical uuid;tt uuid;sess uuid;epoch bigint;hand uuid;button integer;seats integer[];
 player uuid;reg jsonb;r jsonb;first jsonb;replay jsonb;revision bigint;i integer;key text:=gen_random_uuid()::text;
 actors uuid[];entries integer[];saved_definition text;saved_meta jsonb;old_receipt jsonb;existing_reg uuid;
BEGIN
 ASSERT current_database()='vinpoker_ops_guard_main_20261028_v2';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55442;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-main-guards-20261028/data';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OPS_GUARD_MAIN_20261028_REVIEWED_SCHEMA_ONLY';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 INSERT INTO auth.users(id)VALUES(actor);
 INSERT INTO public.clubs(id,name,region,owner_id,status)VALUES(club,'Reviewed guard TEST','TEST',actor,'approved');
 INSERT INTO public.club_cashiers(club_id,user_id)VALUES(club,actor);
 INSERT INTO public.cashier_tour_settings(club_id,enabled)VALUES(club,true);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 PERFORM set_config('role','none',true);
 tour:=gen_random_uuid();
 INSERT INTO public.tournaments(id,club_id,name,status,start_time,buy_in,rake_amount,service_fee_amount,starting_stack,current_level,live_status)
 VALUES(tour,club,'Reviewed guard native TEST','active',clock_timestamp(),100000,0,0,20000,1,'registering');
 INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,duration_minutes,is_break)
 VALUES(tour,1,100,200,0,20,false);
 UPDATE public.game_tables SET table_number=1,operational_status='available' WHERE id=(SELECT id FROM public.game_tables WHERE club_id=club ORDER BY table_name,id LIMIT 1);
 PERFORM set_config('role','none',true);
 SELECT gt.id INTO STRICT physical FROM public.game_tables gt
 WHERE gt.club_id=club AND gt.status='inactive' AND gt.operational_status='available'
   AND NOT EXISTS (SELECT 1 FROM public.table_sessions ts WHERE ts.game_table_id=gt.id AND ts.closed_at IS NULL)
 ORDER BY gt.table_number,gt.id LIMIT 1 FOR UPDATE OF gt SKIP LOCKED;
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_open_tournament_table_v3(tour,physical,'tracker',gen_random_uuid());ASSERT r->>'ok'='true',r::text;
 r:=public.cashier_open_shift_v1(club,0);ASSERT r->>'ok'='true',r::text;
 PERFORM set_config('role','none',true);
 SELECT id,table_session_id INTO STRICT tt,sess FROM public.tournament_tables WHERE tournament_id=tour AND game_table_id=physical;
 FOR i IN 1..3 LOOP
  player:=gen_random_uuid();INSERT INTO auth.users(id)VALUES(player);INSERT INTO public.profiles(user_id,display_name)VALUES(player,'D301 TEST '||player);
  PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
  reg:=public.cashier_create_app_registration_v1(tour,player);ASSERT reg->>'ok'='true',reg::text;
  PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.sub',actor::text,true);PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);PERFORM set_config('role','authenticated',true);
  r:=public.cashier_record_cash_buyin_v1((reg->>'registration_id')::uuid,100000,gen_random_uuid());ASSERT r->>'ok'='true',r::text;ASSERT r->>'seating_state'='seated',r::text;
  PERFORM set_config('role','none',true);
 END LOOP;


 old_receipt:=r;existing_reg:=(reg->>'registration_id')::uuid;
 SELECT pg_get_functiondef(oid),jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'names',proargnames,'modes',proargmodes,'result',prorettype)
 INTO saved_definition,saved_meta FROM pg_proc WHERE oid='floor_private.pick_cashier_canonical_seat_v1(uuid,text)'::regprocedure;
 ASSERT md5(replace(saved_definition,chr(13),''))='770a70ad4ae2226a2fdc82adf1e1f9ae';
 ASSERT EXISTS(SELECT 1 FROM floor_private.pick_cashier_canonical_seat_v1(tour,'random_balanced'));
 EXECUTE $hold$CREATE OR REPLACE FUNCTION floor_private.pick_cashier_canonical_seat_v1(p_tournament_id uuid,p_draw_mode text)
 RETURNS TABLE(logical_id uuid,physical_id uuid,session_id uuid,number integer,capacity integer,seat integer,epoch bigint)
 LANGUAGE plpgsql SET search_path='' AS $body$ BEGIN RETURN;END; $body$ $hold$;
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.pick_cashier_canonical_seat_v1(tour,'random_balanced'));
 ASSERT NOT has_function_privilege('authenticated','floor_private.pick_cashier_canonical_seat_v1(uuid,text)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','floor_private.pick_cashier_canonical_seat_v1(uuid,text)','EXECUTE');
 PERFORM set_config('role','authenticated',true);
 replay:=public.confirm_registration_and_assign_seat(existing_reg,actor,'random_balanced');
 ASSERT replay->>'ok'='true' AND replay->>'idempotent'='true';
 ASSERT replay->>'entry_id'=old_receipt->>'entry_id' AND replay->>'receipt_id'=old_receipt->>'receipt_id';
 PERFORM set_config('role','none',true);
 player:=gen_random_uuid();INSERT INTO auth.users(id)VALUES(player);INSERT INTO public.profiles(user_id,display_name)VALUES(player,'HOLD TEST '||player);
 PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
 reg:=public.cashier_create_app_registration_v1(tour,player);ASSERT reg->>'ok'='true';
 PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.sub',actor::text,true);PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);PERFORM set_config('role','authenticated',true);
 r:=public.cashier_record_cash_buyin_v1((reg->>'registration_id')::uuid,100000,gen_random_uuid());
 ASSERT r->>'ok'='true' AND r->>'seating_state'='waiting' AND r->>'payment_state'='paid',r::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*)=3 AND sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_id=tour AND is_active);
 ASSERT (SELECT count(*)=4 AND sum(amount)=400000 FROM public.cashier_buyin_movements WHERE tournament_id=tour);
 EXECUTE saved_definition;
 ASSERT (SELECT pg_get_functiondef(oid)=saved_definition AND jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'names',proargnames,'modes',proargmodes,'result',prorettype)=saved_meta FROM pg_proc WHERE oid='floor_private.pick_cashier_canonical_seat_v1(uuid,text)'::regprocedure);
 PERFORM set_config('role','authenticated',true);
 r:=public.confirm_registration_and_assign_seat((reg->>'registration_id')::uuid,actor,'random_balanced');ASSERT r->>'ok'='true',r::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*)=4 AND sum(chip_count)=80000 FROM public.tournament_seats WHERE tournament_id=tour AND is_active);
 ASSERT (SELECT count(*)=4 AND sum(amount)=400000 FROM public.cashier_buyin_movements WHERE tournament_id=tour);
END $$;
ROLLBACK;
SELECT 'CASHIER113_SCOPED_ALLOCATION_HOLD_EXACT_RESTORE_PAID_RECOVERY_PASS';
