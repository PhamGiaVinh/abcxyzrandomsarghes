\set ON_ERROR_STOP on
BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';
DO $$ DECLARE club uuid:=gen_random_uuid();menu uuid:=gen_random_uuid();ingredient uuid:=gen_random_uuid();physical uuid;
 actor uuid:=gen_random_uuid();order_id uuid;bank uuid:=gen_random_uuid();bad_bank uuid:=gen_random_uuid();
 account text:='TEST-NON-BANK720-'||gen_random_uuid();token text:='LOCAL-TEST720-'||gen_random_uuid();response jsonb;reference text;
BEGIN
 ASSERT current_database()='vinpoker_fnb719_gate_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())=
  'VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
 ASSERT to_regclass('floor_private.fnb720_fixture') IS NULL,'720 fixture constructor consumed';
 ASSERT md5(pg_get_functiondef('public.fnb_settle_bank_paid(uuid,uuid)'::regprocedure))='458176bb3c8b293d0c44056b15309670';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 INSERT INTO auth.users(id) VALUES(actor);
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES(club,actor,'FNB720 bank serialized TEST','TEST','approved');
 INSERT INTO public.fnb_settings(club_id,guest_order_enabled,guest_bank_auto_confirm) VALUES(club,true,false);
 SELECT id INTO STRICT physical FROM public.game_tables WHERE club_id=club AND table_number=30;
 INSERT INTO public.fnb_table_qr_tokens(club_id,table_ref,token,is_active) VALUES(club,physical,token,true);
 INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost) VALUES(ingredient,club,'LOCAL720 ingredient','unit',10,1000);
 INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES(menu,club,'LOCAL720 item',5000,true,true);
 INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty) VALUES(club,menu,ingredient,2);
 INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,is_active,account_type)
 VALUES(club,'LOCAL TEST720 NOT A BANK',account,'NO REAL ACCOUNT',true,'escrow');
 PERFORM set_config('role','anon',true);
 response:=public.fnb_guest_create_order(token,3::smallint,'LOCAL720 TEST',NULL,
  jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1)),'bank_transfer',gen_random_uuid()::text);
 ASSERT response->>'status'='ok',response::text;order_id:=(response->>'order_id')::uuid;
 PERFORM set_config('role','none',true);
 SELECT o.reference_code INTO STRICT reference FROM public.fnb_orders o WHERE o.id=order_id AND o.payment_method='bank_transfer' AND o.subtotal_vnd=5000;
 ASSERT reference LIKE 'FNB-%';
 INSERT INTO public.bank_transactions(id,provider,provider_txn_id,account_number,club_id,amount,transfer_type,content,api_verified_at)
 VALUES(bank,'sepay','LOCAL720-'||bank,account,club,5000,'in',reference,NULL),
 (bad_bank,'sepay','LOCAL720-'||bad_bank,account,club,4999,'in',reference,clock_timestamp());
 -- New TEST metadata changes only: the bank order must retain its frozen price.
 UPDATE public.fnb_menu_items SET price_vnd=9000 WHERE id=menu;
 CREATE TABLE floor_private.fnb720_fixture(fixture jsonb NOT NULL);
 ALTER TABLE floor_private.fnb720_fixture ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON floor_private.fnb720_fixture FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.fnb720_fixture VALUES(jsonb_build_object('club',club,'actor',actor,'order',order_id,'menu',menu,'ingredient',ingredient,'bank',bank,'bad_bank',bad_bank,'test_only',true));
END $$;
COMMIT;
SELECT 'FNB720_CLONE_ONLY_FAKE_BANK_GUEST_ORDER_PREPARED_NO_SETTLEMENT';
