\set ON_ERROR_STOP on
-- Diagnostic, NOT a fixed-behavior regression: demonstrates why the rendered
-- client must not mint a second key after an unknown partial cash payment.
-- No real cash, hosted service, external transport, or production connection.
BEGIN;
\if :{?CASH112_CASE}
SELECT set_config('test.cash112','true',true);
\else
SELECT set_config('test.cash112','false',true);
\endif
DO $$ BEGIN
 IF current_database() NOT IN ('vinpoker_ops_full111_finish99','vinpoker_ops_cash112_ci','vinpoker_ops_cash112_qualified','vinpoker_ops_cash112_overlap','vinpoker_ops_cash112_ui','vinpoker_ops_cash115_qualified_c','vinpoker_ops_reentry115_overlap')
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55441
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
  RAISE EXCEPTION 'owned_isolated_cash_fixture_required'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_cash(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'cash_identity_test: %',message; END IF;END $$;
CREATE FUNCTION pg_temp.fail_cash_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.operation_type='cashier_cash_buyin_v2' AND current_setting('test.fail_cash_receipt',true)='true' THEN
  RAISE EXCEPTION 'TEST_CASH_RECEIPT_WRITE_FAILURE'; END IF; RETURN NEW;END $$;
CREATE TRIGGER test_cash_receipt BEFORE INSERT ON public.table_operation_receipts
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_cash_receipt();
DO $$ DECLARE owner_id uuid:=gen_random_uuid(); player_id uuid:=gen_random_uuid(); club uuid:=gen_random_uuid();
 tour uuid:=gen_random_uuid(); registration uuid; first_key uuid:=gen_random_uuid(); second_key uuid:=gen_random_uuid();
 r jsonb; intent jsonb; saved jsonb; candidate_key uuid; BEGIN
 INSERT INTO auth.users(id) VALUES(owner_id),(player_id);
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES(club,owner_id,'Cash identity local TEST','TEST','approved');
 INSERT INTO public.club_cashiers(club_id,user_id) VALUES(club,owner_id);
 INSERT INTO public.club_dealer_controls(club_id,user_id) VALUES(club,owner_id);
 INSERT INTO public.cashier_tour_settings(club_id,enabled) VALUES(club,true);
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',owner_id)::text,true);
 PERFORM set_config('role','authenticated',true);
 r:=public.create_tournament_with_levels_v1(club,jsonb_build_object('name','Cash identity local TEST',
   'start_time',now()+interval '1 hour','buy_in',100000,'rake_amount',0,'service_fee_amount',0,
   'starting_stack',20000,'game_type','nlh','minutes_per_level',20,'late_reg_close_level',6),
   '[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]',gen_random_uuid(),owner_id);
 PERFORM pg_temp.assert_cash(r->>'ok'='true','canonical tournament create: '||r::text);
 tour:=(r->>'tournament_id')::uuid;
 PERFORM set_config('role','none',true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM set_config('role','service_role',true);
 r:=public.cashier_create_app_registration_v1(tour,player_id);
 PERFORM pg_temp.assert_cash(r->>'ok'='true' AND (r->>'total_pay')::bigint=100000,'server-priced app registration: '||r::text);
 registration:=(r->>'registration_id')::uuid;
 PERFORM set_config('role','none',true);
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',owner_id)::text,true);
 PERFORM set_config('role','authenticated',true);
 r:=public.cashier_open_shift_v1(club,0);
 PERFORM pg_temp.assert_cash(r->>'ok'='true','canonical TEST drawer opens');
 -- CASH112_CONCURRENCY_FIXTURE_READY
 r:=public.cashier_record_cash_buyin_v1(registration,10000,first_key);
 PERFORM pg_temp.assert_cash(r->>'ok'='true' AND r->>'payment_state'='partial' AND (r->>'received')::bigint=10000,'first partial movement commits');
 r:=public.cashier_record_cash_buyin_v1(registration,10000,first_key);
 PERFORM pg_temp.assert_cash(r->>'ok'='true' AND r->>'already_recorded'='true','retained key is correctly idempotent');
 r:=public.cashier_record_cash_buyin_v1(registration,11000,first_key);
 PERFORM pg_temp.assert_cash(r->>'error'='request_id_reused','same key changed amount conflicts');
 r:=public.cashier_record_cash_buyin_v1(registration,10000,second_key);
 PERFORM pg_temp.assert_cash(r->>'ok'='true' AND (r->>'received')::bigint=20000,'new key is a distinct real movement, not recovery');
 PERFORM pg_temp.assert_cash((SELECT count(*)=2 AND sum(amount)=20000 AND sum(applied_amount)=20000
   FROM public.cashier_buyin_movements WHERE registration_id=registration),'exactly two movements after client-style key reset');
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.assert_cash(NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE registration_id=registration),
   'partial payment does not fabricate entry or seating');
 PERFORM pg_temp.assert_cash((SELECT cashier_paid_at IS NULL FROM public.tournament_registrations WHERE id=registration),
   'partial remains unpaid, not another seating/refund test');
 IF current_setting('test.cash112')='true' THEN
  PERFORM set_config('role','authenticated',true);
  intent:=jsonb_build_object('actor_id',owner_id,'club_id',club,'tournament_id',tour,
    'registration_id',registration,'amount',10000,'request_id',first_key);
  r:=public.resolve_cashier_cash_buyin_intent_v1(intent,'read');
  PERFORM pg_temp.assert_cash(r->>'status'='recorded','read reconciles exact legacy movement');
  r:=public.resolve_cashier_cash_buyin_intent_v1(intent,'record'); saved:=r;
  PERFORM pg_temp.assert_cash(r->>'status'='recorded','exact legacy movement adopted without charging again');
  PERFORM pg_temp.assert_cash(public.resolve_cashier_cash_buyin_intent_v1(intent,'cancel')=saved,
    'a committed payment cannot be cancelled away');
  candidate_key:=gen_random_uuid();intent:=jsonb_set(intent,'{request_id}',to_jsonb(candidate_key::text));
  r:=public.resolve_cashier_cash_buyin_intent_v1(intent,'read');
  PERFORM pg_temp.assert_cash(r->>'status'='unknown','missing receipt stays unknown');
  r:=public.resolve_cashier_cash_buyin_intent_v1(intent,'cancel');saved:=r;
  PERFORM pg_temp.assert_cash(r->>'status'='cancelled','missing intent gets a durable tombstone');
  PERFORM pg_temp.assert_cash(public.resolve_cashier_cash_buyin_intent_v1(intent,'record')=saved,
    'late exact writer cannot charge after cancellation');
  r:=public.cashier_record_cash_buyin_v1(registration,10000,candidate_key);
  PERFORM pg_temp.assert_cash(r->>'error'='cash_intent_cancelled','legacy v1 also respects cancellation');
  intent:=jsonb_set(intent,'{request_id}',to_jsonb(gen_random_uuid()::text));
  r:=public.resolve_cashier_cash_buyin_intent_v1(intent,'record');saved:=r;
  PERFORM pg_temp.assert_cash(r->>'status'='recorded' AND r->'result'->>'payment_state'='partial',
    'exact actor-bound new partial commits with receipt');
  PERFORM pg_temp.assert_cash(public.resolve_cashier_cash_buyin_intent_v1(intent,'record')=saved
    AND public.resolve_cashier_cash_buyin_intent_v1(intent,'read')=saved,'response-loss recovery returns original receipt');
  r:=public.resolve_cashier_cash_buyin_intent_v1(jsonb_set(intent,'{amount}','11000'),'record');
  PERFORM pg_temp.assert_cash(r->>'error'='IDEMPOTENCY_CONFLICT','different payload cannot reuse receipt');
  r:=public.resolve_cashier_cash_buyin_intent_v1(jsonb_set(intent,'{actor_id}',to_jsonb(player_id::text)),'record');
  PERFORM pg_temp.assert_cash(r->>'error'='actor_not_allowed','expected actor mismatch denied');
  r:=public.resolve_cashier_cash_buyin_intent_v1(jsonb_set(intent,'{club_id}',to_jsonb(gen_random_uuid()::text)),'record');
  PERFORM pg_temp.assert_cash(r->>'error'='actor_not_allowed','cross-club intent denied');
  intent:=jsonb_set(intent,'{request_id}',to_jsonb(gen_random_uuid()::text));
  PERFORM set_config('test.fail_cash_receipt','true',true);
  BEGIN
   r:=public.resolve_cashier_cash_buyin_intent_v1(intent,'record');
   RAISE EXCEPTION 'cash receipt failure unexpectedly committed';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'TEST_CASH_RECEIPT_WRITE_FAILURE' THEN RAISE;END IF; END;
  PERFORM set_config('test.fail_cash_receipt','false',true);
  PERFORM set_config('role','none',true);
  PERFORM pg_temp.assert_cash((SELECT count(*)=3 AND sum(amount)=30000 FROM public.cashier_buyin_movements WHERE registration_id=registration),
    'receipt fault rolls back its money movement and cancelled attempts do not charge');
  PERFORM pg_temp.assert_cash(NOT EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt(owner_id,
    'cashier_cash_buyin_v2',(intent->>'request_id')::uuid)),'receipt fault leaves no false terminal receipt');
  PERFORM set_config('role','authenticated',true);
  intent:=jsonb_set(jsonb_set(intent,'{request_id}',to_jsonb(gen_random_uuid()::text)),'{amount}','100000');
  r:=public.resolve_cashier_cash_buyin_intent_v1(intent,'record');saved:=r;
  PERFORM pg_temp.assert_cash(r->>'status'='rejected' AND r->'result'->>'error'='amount_exceeds_remaining',
    'definitive business rejection has a durable non-money outcome');
  PERFORM pg_temp.assert_cash(public.resolve_cashier_cash_buyin_intent_v1(intent,'read')=saved
    AND public.resolve_cashier_cash_buyin_intent_v1(intent,'cancel')=saved,'rejected intent remains terminal');
  r:=public.resolve_cashier_cash_buyin_intent_v1(jsonb_set(intent,'{amount}','1.5'),'record');
  PERFORM pg_temp.assert_cash(r->>'error'='invalid_cash_intent','fractional cash intent denied');
  r:=public.resolve_cashier_cash_buyin_intent_v1(intent||'{"extra":"field"}'::jsonb,'record');
  PERFORM pg_temp.assert_cash(r->>'error'='invalid_cash_intent','unknown intent fields denied');
  PERFORM set_config('role','none',true);
  PERFORM set_config('request.jwt.claim.sub',player_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',player_id)::text,true);
  PERFORM set_config('role','authenticated',true);
  r:=public.resolve_cashier_cash_buyin_intent_v1(jsonb_set(intent,'{actor_id}',to_jsonb(player_id::text)),'read');
  PERFORM pg_temp.assert_cash(r->>'error'='actor_not_allowed','actual outsider actor cannot read cashier receipt');
  PERFORM set_config('role','none',true);
  PERFORM set_config('role','anon',true);
  BEGIN
   r:=public.resolve_cashier_cash_buyin_intent_v1(intent,'read');
   RAISE EXCEPTION 'anonymous cash receipt unexpectedly callable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('role','none',true);
  PERFORM set_config('role','service_role',true);
  BEGIN
   r:=public.resolve_cashier_cash_buyin_intent_v1(intent,'record');
   RAISE EXCEPTION 'service cash writer unexpectedly callable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('role','none',true);
  PERFORM pg_temp.assert_cash((SELECT count(*)=3 AND sum(amount)=30000 FROM public.cashier_buyin_movements WHERE registration_id=registration),
    'rejection, invalid payload and wrong roles do not change cash');
  PERFORM pg_temp.assert_cash(NOT has_function_privilege('anon','public.resolve_cashier_cash_buyin_intent_v1(jsonb,text)','EXECUTE')
    AND NOT has_function_privilege('service_role','public.resolve_cashier_cash_buyin_intent_v1(jsonb,text)','EXECUTE'),
    'exact intent endpoint remains authenticated only');
  RAISE NOTICE 'CASH112_EXACT_INTENT_RECEIPT_CANCEL_LEGACY_FAULT_ATOMICITY_PASS';
 ELSE
  RAISE NOTICE 'CASH_KEY_RESET_ACTUAL_DOUBLE_PARTIAL_DIAGNOSTIC_NOT_FIXED';
 END IF;
END $$;
ROLLBACK;
