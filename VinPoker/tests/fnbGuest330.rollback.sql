\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
\if :{?FNB333_BANK}
SELECT set_config('test.fnb333_bank','true',true);
\endif
\if :{?FNB332_EXTRA}
SELECT set_config('test.fnb332_extra','true',true);
\endif
CREATE FUNCTION pg_temp.fail_guest_receipt332() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('test.fnb332_fault',true)='true' THEN RAISE EXCEPTION 'TEST_RECEIPT332_FAILURE';END IF;RETURN NEW;END $$;
\if :{?FNB330_CAP}
SELECT set_config('test.fnb330_cap','true',true);
\else
SELECT set_config('test.fnb330_cap','false',true);
\endif
DO $$
DECLARE owner_id uuid:=gen_random_uuid();club uuid:=gen_random_uuid();physical uuid;item uuid:=gen_random_uuid();token text:='LOCAL-TEST330-'||gen_random_uuid();
 first_key text:=gen_random_uuid()::text;first_result jsonb;actual jsonb;i integer;other_table uuid;other_token text:='LOCAL-TEST332-'||gen_random_uuid();legacy_key text:=gen_random_uuid()::text;method text:='cash';
BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'local330_only';END IF;
 INSERT INTO auth.users(id) VALUES(owner_id);
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES(club,owner_id,'Guest330 isolated TEST','TEST','approved');
 INSERT INTO public.fnb_settings(club_id,guest_order_enabled) VALUES(club,true) ON CONFLICT(club_id) DO UPDATE SET guest_order_enabled=true;
 SELECT id INTO physical FROM public.game_tables WHERE club_id=club AND table_number=30;
 IF physical IS NULL THEN RAISE EXCEPTION 'canonical330_inventory_missing';END IF;
 INSERT INTO public.fnb_table_qr_tokens(club_id,table_ref,token,is_active) VALUES(club,physical,token,true);
 INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES(item,club,'TEST330 coffee',10000,true,false);
 IF current_setting('test.fnb333_bank',true)='true' THEN
  method:='bank_transfer';
  INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,is_active,account_type)
   VALUES(club,'LOCAL TEST333 NOT A BANK','TEST-NON-BANK333','NO REAL ACCOUNT',true,'escrow');
 END IF;
 PERFORM set_config('role','anon',true);
 first_result:=public.fnb_guest_create_order(token,3::smallint,'TEST',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',item,'qty',1)),method,first_key);
 IF first_result->>'status'<>'ok' THEN RAISE EXCEPTION 'initial330_order_failed:%',first_result;END IF;
 IF current_setting('test.fnb333_bank',true)='true' THEN
  PERFORM set_config('role','none',true);
  UPDATE public.platform_bank_accounts SET is_active=false,account_number='TEST-NEW-NON-BANK333' WHERE club_id=club;
  UPDATE public.fnb_menu_items SET price_vnd=20000,is_active=false WHERE id=item;
  PERFORM set_config('role','anon',true);
  actual:=public.fnb_guest_create_order(token,3::smallint,'TEST',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',item,'qty',1)),method,first_key);
  IF actual-'idempotent' IS DISTINCT FROM first_result-'idempotent' OR actual->>'idempotent' IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'bank333_replay_repriced_or_changed_snapshot';END IF;
  actual:=public.fnb_guest_create_order(token,3::smallint,'TEST',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',item,'qty',1)),'cash',first_key);
  IF actual->>'error' IS DISTINCT FROM 'REQUEST_ID_CONFLICT' THEN RAISE EXCEPTION 'bank333_changed_method_accepted';END IF;
  PERFORM set_config('role','none',true);
  IF (SELECT count(*) FROM public.fnb_orders WHERE club_id=club)<>1
   OR (SELECT sum(qty*unit_price_snapshot) FROM public.fnb_order_items WHERE club_id=club)<>10000
  THEN RAISE EXCEPTION 'bank333_order_line_conservation_failed';END IF;
  UPDATE public.fnb_settings SET guest_order_enabled=false WHERE club_id=club;
  PERFORM set_config('role','anon',true);
  actual:=public.fnb_guest_create_order(token,3::smallint,'TEST',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',item,'qty',1)),method,first_key);
  IF actual->>'error' IS DISTINCT FROM 'GUEST_ORDER_DISABLED' THEN RAISE EXCEPTION 'bank333_club_off_accepted';END IF;
  RETURN;
 END IF;
 IF current_setting('test.fnb332_extra',true)='true' THEN
  PERFORM set_config('role','none',true);
  IF has_table_privilege('anon','floor_private.fnb_guest_request_receipts_v1','SELECT')
   OR has_function_privilege('anon','floor_private.fnb_guest_create_order_core228(text,smallint,text,text,jsonb,text,text)','EXECUTE')
   OR has_function_privilege('service_role','floor_private.fnb_guest_create_order_core228(text,smallint,text,text,jsonb,text,text)','EXECUTE')
  THEN RAISE EXCEPTION 'private332_acl_exposed';END IF;
  PERFORM set_config('role','anon',true);
  BEGIN
   PERFORM floor_private.fnb_guest_create_order_core228(token,3::smallint,'TEST',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',item,'qty',1)),'cash',gen_random_uuid()::text);
   RAISE EXCEPTION 'private332_core_executable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  PERFORM set_config('role','none',true);
  CREATE TRIGGER test_receipt332 BEFORE INSERT ON floor_private.fnb_guest_request_receipts_v1 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_guest_receipt332();
  PERFORM set_config('test.fnb332_fault','true',true);
  BEGIN
   PERFORM set_config('role','anon',true);
   actual:=public.fnb_guest_create_order(token,3::smallint,'TEST',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',item,'qty',1)),'cash',gen_random_uuid()::text);
   RAISE EXCEPTION 'receipt332_fault_not_raised';
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'TEST_RECEIPT332_FAILURE' THEN RAISE;END IF;
  END;
  PERFORM set_config('role','none',true);
  PERFORM set_config('test.fnb332_fault','false',true);
  IF (SELECT count(*) FROM public.fnb_orders WHERE club_id=club)<>1
   OR (SELECT count(*) FROM floor_private.fnb_guest_request_receipts_v1 WHERE order_id=(first_result->>'order_id')::uuid)<>1
  THEN RAISE EXCEPTION 'receipt332_failure_left_partial_order';END IF;
  SELECT id INTO other_table FROM public.game_tables WHERE club_id=club AND table_number=31;
  INSERT INTO public.fnb_table_qr_tokens(club_id,table_ref,token,is_active) VALUES(club,other_table,other_token,true);
  PERFORM set_config('role','anon',true);
  actual:=public.fnb_guest_create_order(other_token,3::smallint,'TEST',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',item,'qty',1)),'cash',first_key);
  IF actual->>'error' IS DISTINCT FROM 'REQUEST_ID_CONFLICT' OR actual ? 'order_id' THEN RAISE EXCEPTION 'cross_token332_order_leak';END IF;
  PERFORM set_config('role','none',true);
  actual:=floor_private.fnb_guest_create_order_core228(token,3::smallint,'TEST',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',item,'qty',1)),'cash',legacy_key);
  IF actual->>'status'<>'ok' THEN RAISE EXCEPTION 'legacy332_setup_failed';END IF;
  PERFORM set_config('role','anon',true);
  actual:=public.fnb_guest_create_order(token,3::smallint,'TEST',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',item,'qty',1)),'cash',legacy_key);
  IF actual->>'error' IS DISTINCT FROM 'REQUEST_ID_CONFLICT' THEN RAISE EXCEPTION 'legacy332_unproven_payload_accepted';END IF;
  PERFORM set_config('role','none',true);
  UPDATE public.fnb_table_qr_tokens t SET is_active=false WHERE t.club_id=club AND t.table_ref=physical;
  PERFORM set_config('role','anon',true);
  actual:=public.fnb_guest_create_order(token,3::smallint,'TEST',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',item,'qty',1)),'cash',first_key);
  IF actual->>'error' IS DISTINCT FROM 'TOKEN_INVALID' THEN RAISE EXCEPTION 'revoked332_token_accepted';END IF;
  RETURN;
 END IF;
 IF current_setting('test.fnb330_cap')='true' THEN
  FOR i IN 2..5 LOOP
   actual:=public.fnb_guest_create_order(token,3::smallint,'TEST',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',item,'qty',1)),'cash',gen_random_uuid()::text);
   IF actual->>'status'<>'ok' THEN RAISE EXCEPTION 'setup330_cap_failed:%',actual;END IF;
  END LOOP;
  actual:=public.fnb_guest_create_order(token,3::smallint,'TEST',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',item,'qty',1)),'cash',first_key);
  IF actual->>'order_id' IS DISTINCT FROM first_result->>'order_id' OR actual->>'idempotent' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'fnb330_replay_at_cap_failed:%',actual;END IF;
 ELSE
  actual:=public.fnb_guest_create_order(token,3::smallint,'TEST',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',item,'qty',2)),'cash',first_key);
  IF actual->>'error' IS DISTINCT FROM 'REQUEST_ID_CONFLICT' THEN RAISE EXCEPTION 'fnb330_changed_payload_not_conflict:%',actual;END IF;
 END IF;
END $$;
SELECT 'FNB330_GUEST_IDEMPOTENCY_ROLLBACK_PASS';
ROLLBACK;
