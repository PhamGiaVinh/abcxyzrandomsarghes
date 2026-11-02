-- Isolated native regression; psql with ON_ERROR_STOP=1. Guarded owned local DB only.
-- Every case applies candidate304 inside BEGIN and ROLLBACK; no committed DDL/data.
-- Bank method is seeded on a fresh pending TEST order, service core only; no provider callback.
\set ON_ERROR_STOP on
BEGIN;SET LOCAL lock_timeout='3s';DO $$ BEGIN ASSERT current_database()='vinpoker_owner_ft_reports_20261031';ASSERT current_setting('port')='55441';ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OWNER_FT_REPORTS_20261031_OWNED_LOCAL_TEST';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT NOT(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role');END $$;
\ir ../migrations/20270128000304_fnb_cancel_snapshot_cost_v1.sql
INSERT INTO auth.users(id)VALUES('f42e2100-5897-44f9-96e5-88e2b7a1fe00');INSERT INTO auth.users(id)VALUES('9fe47929-3fc3-4acc-a150-0f691effd879');INSERT INTO public.profiles(user_id,display_name)VALUES('9fe47929-3fc3-4acc-a150-0f691effd879','LOCAL TEST refund owner');INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES('5ecbe8ff-c4e3-4b41-9b0e-362e9fd1a748','9fe47929-3fc3-4acc-a150-0f691effd879','LOCAL TEST refund regular_unshipped','TEST','approved');SET LOCAL request.jwt.claim.sub='9fe47929-3fc3-4acc-a150-0f691effd879';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"9fe47929-3fc3-4acc-a150-0f691effd879"}';SET LOCAL ROLE authenticated;
DO $case$ DECLARE r jsonb;ing uuid;menu uuid;menu2 uuid;oid uuid;line uuid;lines jsonb;paid jsonb;cancelled jsonb;cancelled2 jsonb;finance jsonb;report jsonb;stock numeric;BEGIN
r:=public.fnb_upsert_ingredient(p_club_id=>'5ecbe8ff-c4e3-4b41-9b0e-362e9fd1a748',p_name=>'LOCAL TEST ingredient',p_stock_unit=>'unit',p_purchase_unit=>'unit',p_units_per_purchase=>1);ASSERT NOT(r?'error'),r::text;ing:=(r->>'id')::uuid;
r:=public.fnb_stock_in('5ecbe8ff-c4e3-4b41-9b0e-362e9fd1a748',ing,100,1000,'954c8f68-fe6c-4c50-8543-e0948053e42f');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_upsert_menu_item(p_club_id=>'5ecbe8ff-c4e3-4b41-9b0e-362e9fd1a748',p_name=>'LOCAL TEST menu',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu:=(r->>'id')::uuid;
r:=public.fnb_set_recipe(menu,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;
lines:=jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1));

r:=public.fnb_open_shift_v2('5ecbe8ff-c4e3-4b41-9b0e-362e9fd1a748',0,'74c4683b-7417-441c-9aa8-cdcb9372cf08','9fe47929-3fc3-4acc-a150-0f691effd879');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_update_settings(p_club_id=>'5ecbe8ff-c4e3-4b41-9b0e-362e9fd1a748',p_fnb_in_club_net=>true,p_restock_on_shipped_cancel=>false);ASSERT NOT(r?'error'),r::text;
r:=public.fnb_create_order('5ecbe8ff-c4e3-4b41-9b0e-362e9fd1a748','counter','LOCAL TEST',NULL,NULL,lines,'7aa085e6-51d9-40bf-8793-7ec016207f46');ASSERT NOT(r?'error'),r::text;oid:=(r->>'order_id')::uuid;IF false THEN
 RESET ROLE;UPDATE public.fnb_orders SET payment_method='bank_transfer' WHERE id=oid AND status='pending' AND paid_at IS NULL;ASSERT FOUND,'fresh pending bank fixture only';SET LOCAL ROLE service_role;
 PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claim.role','service_role',true);PERFORM set_config('request.jwt.claims','{"role":"service_role","sub":""}',true);
 paid:=public.fnb_settle_bank_paid(oid,'80977bdd-d0d9-485f-930b-d5531d6ec74b');
 RESET ROLE;SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claim.sub','9fe47929-3fc3-4acc-a150-0f691effd879',true);PERFORM set_config('request.jwt.claim.role','authenticated',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"9fe47929-3fc3-4acc-a150-0f691effd879"}',true);
 ELSE paid:=public.fnb_mark_paid(oid,'5ea67792-f0c0-4c04-89c8-733e99811645');END IF;ASSERT NOT(paid?'error'),paid::text;
r:=public.fnb_mark_paid(oid,'1e9fe794-09ad-448f-b352-ebff91446313');ASSERT r->>'status'='ok' AND (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'paid replay must not capture again';

RESET ROLE;
BEGIN UPDATE floor_private.fnb_paid_line_snapshot_v1 SET qty=qty+1 WHERE order_id=(SELECT id FROM public.fnb_orders WHERE club_id='5ecbe8ff-c4e3-4b41-9b0e-362e9fd1a748' ORDER BY created_at LIMIT 1);RAISE EXCEPTION 'snapshot mutation unexpectedly allowed';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
SET LOCAL ROLE authenticated;
PERFORM set_config('request.jwt.claim.sub','f42e2100-5897-44f9-96e5-88e2b7a1fe00',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"f42e2100-5897-44f9-96e5-88e2b7a1fe00"}',true);
BEGIN r:=public.fnb_cancel_order(oid,'LOCAL TEST unauthorized');ASSERT r->>'error'='Forbidden',r::text;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.get_club_finance_summary_v2(current_date,current_date,'5ecbe8ff-c4e3-4b41-9b0e-362e9fd1a748');RAISE EXCEPTION 'unauthorized finance read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','5ecbe8ff-c4e3-4b41-9b0e-362e9fd1a748');RAISE EXCEPTION 'unauthorized fnb read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
PERFORM set_config('request.jwt.claim.sub','9fe47929-3fc3-4acc-a150-0f691effd879',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"9fe47929-3fc3-4acc-a150-0f691effd879"}',true);
RESET ROLE;
ASSERT NOT has_table_privilege('authenticated','floor_private.fnb_paid_line_snapshot_v1','SELECT');
ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_cancel_cogs_reversal_v1(uuid,bigint,timestamptz)','EXECUTE');
SET LOCAL ROLE authenticated;



cancelled:=public.fnb_cancel_order(oid,'LOCAL TEST refund');ASSERT NOT(cancelled?'error'),cancelled::text;
cancelled2:=public.fnb_cancel_order(oid,'LOCAL TEST replay');ASSERT NOT(cancelled2?'error'),cancelled2::text;
SELECT on_hand INTO stock FROM public.fnb_ingredients WHERE id=ing;
finance:=public.get_club_finance_summary_v2((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'5ecbe8ff-c4e3-4b41-9b0e-362e9fd1a748');
report:=public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','5ecbe8ff-c4e3-4b41-9b0e-362e9fd1a748');
PERFORM set_config('local.fnb_refund_case',jsonb_build_object('name','regular_unshipped','paid',paid,'cancel',cancelled,'replay',cancelled2,'stock',stock,'averageCost',(SELECT avg_unit_cost FROM public.fnb_ingredients WHERE id=ing),'finance',finance,'report',report,'order',(SELECT to_jsonb(o) FROM public.fnb_orders o WHERE id=oid),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at,id) FROM public.fnb_stock_movements m WHERE ref_id=oid))::text,true);
END $case$;SELECT current_setting('local.fnb_refund_case');DO $assert$ DECLARE r jsonb:=current_setting('local.fnb_refund_case')::jsonb;BEGIN ASSERT (r->'finance'->'cost'->>'fnbCogs')::numeric=0;ASSERT (r->'report'->>'cogs')::numeric=0;ASSERT (r->>'stock')::numeric=100;ASSERT (r->'finance'->'revenue'->>'fnb')::numeric=0;ASSERT (SELECT coalesce(sum((x->>'revenue')::numeric),0) FROM jsonb_array_elements(r->'report'->'topItems')x)=0;END $assert$;
ROLLBACK;

BEGIN;SET LOCAL lock_timeout='3s';DO $$ BEGIN ASSERT current_database()='vinpoker_owner_ft_reports_20261031';ASSERT current_setting('port')='55441';ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OWNER_FT_REPORTS_20261031_OWNED_LOCAL_TEST';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT NOT(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role');END $$;
\ir ../migrations/20270128000304_fnb_cancel_snapshot_cost_v1.sql
INSERT INTO auth.users(id)VALUES('90d469cb-6f84-4fac-852a-22534647dfb8');INSERT INTO auth.users(id)VALUES('6caa1c9d-a5e1-4440-a716-7508892674df');INSERT INTO public.profiles(user_id,display_name)VALUES('6caa1c9d-a5e1-4440-a716-7508892674df','LOCAL TEST refund owner');INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES('27913747-4195-49d6-8f8e-3ead693aa440','6caa1c9d-a5e1-4440-a716-7508892674df','LOCAL TEST refund regular_shipped_no_return','TEST','approved');SET LOCAL request.jwt.claim.sub='6caa1c9d-a5e1-4440-a716-7508892674df';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"6caa1c9d-a5e1-4440-a716-7508892674df"}';SET LOCAL ROLE authenticated;
DO $case$ DECLARE r jsonb;ing uuid;menu uuid;menu2 uuid;oid uuid;line uuid;lines jsonb;paid jsonb;cancelled jsonb;cancelled2 jsonb;finance jsonb;report jsonb;stock numeric;BEGIN
r:=public.fnb_upsert_ingredient(p_club_id=>'27913747-4195-49d6-8f8e-3ead693aa440',p_name=>'LOCAL TEST ingredient',p_stock_unit=>'unit',p_purchase_unit=>'unit',p_units_per_purchase=>1);ASSERT NOT(r?'error'),r::text;ing:=(r->>'id')::uuid;
r:=public.fnb_stock_in('27913747-4195-49d6-8f8e-3ead693aa440',ing,100,1000,'4b67c0dc-0eed-4eed-86d1-c16aa9b05520');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_upsert_menu_item(p_club_id=>'27913747-4195-49d6-8f8e-3ead693aa440',p_name=>'LOCAL TEST menu',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu:=(r->>'id')::uuid;
r:=public.fnb_set_recipe(menu,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;
lines:=jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1));

r:=public.fnb_open_shift_v2('27913747-4195-49d6-8f8e-3ead693aa440',0,'e5f76627-1909-483b-b4dd-fabc87322ca3','6caa1c9d-a5e1-4440-a716-7508892674df');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_update_settings(p_club_id=>'27913747-4195-49d6-8f8e-3ead693aa440',p_fnb_in_club_net=>true,p_restock_on_shipped_cancel=>false);ASSERT NOT(r?'error'),r::text;
r:=public.fnb_create_order('27913747-4195-49d6-8f8e-3ead693aa440','counter','LOCAL TEST',NULL,NULL,lines,'f20136a2-609a-4c05-9a08-3cb6484e745e');ASSERT NOT(r?'error'),r::text;oid:=(r->>'order_id')::uuid;IF false THEN
 RESET ROLE;UPDATE public.fnb_orders SET payment_method='bank_transfer' WHERE id=oid AND status='pending' AND paid_at IS NULL;ASSERT FOUND,'fresh pending bank fixture only';SET LOCAL ROLE service_role;
 PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claim.role','service_role',true);PERFORM set_config('request.jwt.claims','{"role":"service_role","sub":""}',true);
 paid:=public.fnb_settle_bank_paid(oid,'09d3a42e-6a74-4309-b67a-47b277f7e07f');
 RESET ROLE;SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claim.sub','6caa1c9d-a5e1-4440-a716-7508892674df',true);PERFORM set_config('request.jwt.claim.role','authenticated',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"6caa1c9d-a5e1-4440-a716-7508892674df"}',true);
 ELSE paid:=public.fnb_mark_paid(oid,'31f5ccd5-bcd4-42f8-b072-aa714c97f6ed');END IF;ASSERT NOT(paid?'error'),paid::text;
r:=public.fnb_mark_paid(oid,'868b4f6c-7381-4eb3-b702-9ec35d651ce9');ASSERT r->>'status'='ok' AND (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'paid replay must not capture again';

RESET ROLE;
BEGIN UPDATE floor_private.fnb_paid_line_snapshot_v1 SET qty=qty+1 WHERE order_id=(SELECT id FROM public.fnb_orders WHERE club_id='27913747-4195-49d6-8f8e-3ead693aa440' ORDER BY created_at LIMIT 1);RAISE EXCEPTION 'snapshot mutation unexpectedly allowed';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
SET LOCAL ROLE authenticated;
PERFORM set_config('request.jwt.claim.sub','90d469cb-6f84-4fac-852a-22534647dfb8',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"90d469cb-6f84-4fac-852a-22534647dfb8"}',true);
BEGIN r:=public.fnb_cancel_order(oid,'LOCAL TEST unauthorized');ASSERT r->>'error'='Forbidden',r::text;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.get_club_finance_summary_v2(current_date,current_date,'27913747-4195-49d6-8f8e-3ead693aa440');RAISE EXCEPTION 'unauthorized finance read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','27913747-4195-49d6-8f8e-3ead693aa440');RAISE EXCEPTION 'unauthorized fnb read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
PERFORM set_config('request.jwt.claim.sub','6caa1c9d-a5e1-4440-a716-7508892674df',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"6caa1c9d-a5e1-4440-a716-7508892674df"}',true);
RESET ROLE;
ASSERT NOT has_table_privilege('authenticated','floor_private.fnb_paid_line_snapshot_v1','SELECT');
ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_cancel_cogs_reversal_v1(uuid,bigint,timestamptz)','EXECUTE');
SET LOCAL ROLE authenticated;
r:=public.fnb_mark_shipped(oid,NULL);ASSERT NOT(r?'error'),r::text;


cancelled:=public.fnb_cancel_order(oid,'LOCAL TEST refund');ASSERT NOT(cancelled?'error'),cancelled::text;
cancelled2:=public.fnb_cancel_order(oid,'LOCAL TEST replay');ASSERT NOT(cancelled2?'error'),cancelled2::text;
SELECT on_hand INTO stock FROM public.fnb_ingredients WHERE id=ing;
finance:=public.get_club_finance_summary_v2((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'27913747-4195-49d6-8f8e-3ead693aa440');
report:=public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','27913747-4195-49d6-8f8e-3ead693aa440');
PERFORM set_config('local.fnb_refund_case',jsonb_build_object('name','regular_shipped_no_return','paid',paid,'cancel',cancelled,'replay',cancelled2,'stock',stock,'averageCost',(SELECT avg_unit_cost FROM public.fnb_ingredients WHERE id=ing),'finance',finance,'report',report,'order',(SELECT to_jsonb(o) FROM public.fnb_orders o WHERE id=oid),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at,id) FROM public.fnb_stock_movements m WHERE ref_id=oid))::text,true);
END $case$;SELECT current_setting('local.fnb_refund_case');DO $assert$ DECLARE r jsonb:=current_setting('local.fnb_refund_case')::jsonb;BEGIN ASSERT (r->'finance'->'cost'->>'fnbCogs')::numeric=2000;ASSERT (r->'report'->>'cogs')::numeric=2000;ASSERT (r->>'stock')::numeric=98;ASSERT (r->'finance'->'revenue'->>'fnb')::numeric=0;ASSERT (SELECT coalesce(sum((x->>'revenue')::numeric),0) FROM jsonb_array_elements(r->'report'->'topItems')x)=0;END $assert$;
ROLLBACK;

BEGIN;SET LOCAL lock_timeout='3s';DO $$ BEGIN ASSERT current_database()='vinpoker_owner_ft_reports_20261031';ASSERT current_setting('port')='55441';ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OWNER_FT_REPORTS_20261031_OWNED_LOCAL_TEST';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT NOT(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role');END $$;
\ir ../migrations/20270128000304_fnb_cancel_snapshot_cost_v1.sql
INSERT INTO auth.users(id)VALUES('49bc26b2-744e-4ba0-894d-823445aeece6');INSERT INTO auth.users(id)VALUES('d1a6e6c3-5301-4a00-8520-193e4b40b9ef');INSERT INTO public.profiles(user_id,display_name)VALUES('d1a6e6c3-5301-4a00-8520-193e4b40b9ef','LOCAL TEST refund owner');INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES('e18a3322-d170-4bb5-b5ac-fb1bc54a0dd6','d1a6e6c3-5301-4a00-8520-193e4b40b9ef','LOCAL TEST refund regular_shipped_return','TEST','approved');SET LOCAL request.jwt.claim.sub='d1a6e6c3-5301-4a00-8520-193e4b40b9ef';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"d1a6e6c3-5301-4a00-8520-193e4b40b9ef"}';SET LOCAL ROLE authenticated;
DO $case$ DECLARE r jsonb;ing uuid;menu uuid;menu2 uuid;oid uuid;line uuid;lines jsonb;paid jsonb;cancelled jsonb;cancelled2 jsonb;finance jsonb;report jsonb;stock numeric;BEGIN
r:=public.fnb_upsert_ingredient(p_club_id=>'e18a3322-d170-4bb5-b5ac-fb1bc54a0dd6',p_name=>'LOCAL TEST ingredient',p_stock_unit=>'unit',p_purchase_unit=>'unit',p_units_per_purchase=>1);ASSERT NOT(r?'error'),r::text;ing:=(r->>'id')::uuid;
r:=public.fnb_stock_in('e18a3322-d170-4bb5-b5ac-fb1bc54a0dd6',ing,100,1000,'d6f8df61-ad78-430e-ae21-d2cee3f5e37d');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_upsert_menu_item(p_club_id=>'e18a3322-d170-4bb5-b5ac-fb1bc54a0dd6',p_name=>'LOCAL TEST menu',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu:=(r->>'id')::uuid;
r:=public.fnb_set_recipe(menu,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;
lines:=jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1));

r:=public.fnb_open_shift_v2('e18a3322-d170-4bb5-b5ac-fb1bc54a0dd6',0,'32700e84-2ce6-4c51-9b9a-c8367ad44e2e','d1a6e6c3-5301-4a00-8520-193e4b40b9ef');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_update_settings(p_club_id=>'e18a3322-d170-4bb5-b5ac-fb1bc54a0dd6',p_fnb_in_club_net=>true,p_restock_on_shipped_cancel=>true);ASSERT NOT(r?'error'),r::text;
r:=public.fnb_create_order('e18a3322-d170-4bb5-b5ac-fb1bc54a0dd6','counter','LOCAL TEST',NULL,NULL,lines,'7f9e7fb3-be58-43b1-9350-66bab6a559e7');ASSERT NOT(r?'error'),r::text;oid:=(r->>'order_id')::uuid;IF false THEN
 RESET ROLE;UPDATE public.fnb_orders SET payment_method='bank_transfer' WHERE id=oid AND status='pending' AND paid_at IS NULL;ASSERT FOUND,'fresh pending bank fixture only';SET LOCAL ROLE service_role;
 PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claim.role','service_role',true);PERFORM set_config('request.jwt.claims','{"role":"service_role","sub":""}',true);
 paid:=public.fnb_settle_bank_paid(oid,'d833e966-55d8-4ed6-9d58-60da12fd035f');
 RESET ROLE;SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claim.sub','d1a6e6c3-5301-4a00-8520-193e4b40b9ef',true);PERFORM set_config('request.jwt.claim.role','authenticated',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"d1a6e6c3-5301-4a00-8520-193e4b40b9ef"}',true);
 ELSE paid:=public.fnb_mark_paid(oid,'177c9d81-e902-4b75-82a0-449964eeb363');END IF;ASSERT NOT(paid?'error'),paid::text;
r:=public.fnb_mark_paid(oid,'0127e160-17de-414e-8715-4b328e85f470');ASSERT r->>'status'='ok' AND (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'paid replay must not capture again';

RESET ROLE;
BEGIN UPDATE floor_private.fnb_paid_line_snapshot_v1 SET qty=qty+1 WHERE order_id=(SELECT id FROM public.fnb_orders WHERE club_id='e18a3322-d170-4bb5-b5ac-fb1bc54a0dd6' ORDER BY created_at LIMIT 1);RAISE EXCEPTION 'snapshot mutation unexpectedly allowed';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
SET LOCAL ROLE authenticated;
PERFORM set_config('request.jwt.claim.sub','49bc26b2-744e-4ba0-894d-823445aeece6',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"49bc26b2-744e-4ba0-894d-823445aeece6"}',true);
BEGIN r:=public.fnb_cancel_order(oid,'LOCAL TEST unauthorized');ASSERT r->>'error'='Forbidden',r::text;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.get_club_finance_summary_v2(current_date,current_date,'e18a3322-d170-4bb5-b5ac-fb1bc54a0dd6');RAISE EXCEPTION 'unauthorized finance read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','e18a3322-d170-4bb5-b5ac-fb1bc54a0dd6');RAISE EXCEPTION 'unauthorized fnb read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
PERFORM set_config('request.jwt.claim.sub','d1a6e6c3-5301-4a00-8520-193e4b40b9ef',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"d1a6e6c3-5301-4a00-8520-193e4b40b9ef"}',true);
RESET ROLE;
ASSERT NOT has_table_privilege('authenticated','floor_private.fnb_paid_line_snapshot_v1','SELECT');
ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_cancel_cogs_reversal_v1(uuid,bigint,timestamptz)','EXECUTE');
SET LOCAL ROLE authenticated;
r:=public.fnb_mark_shipped(oid,NULL);ASSERT NOT(r?'error'),r::text;


cancelled:=public.fnb_cancel_order(oid,'LOCAL TEST refund');ASSERT NOT(cancelled?'error'),cancelled::text;
cancelled2:=public.fnb_cancel_order(oid,'LOCAL TEST replay');ASSERT NOT(cancelled2?'error'),cancelled2::text;
SELECT on_hand INTO stock FROM public.fnb_ingredients WHERE id=ing;
finance:=public.get_club_finance_summary_v2((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'e18a3322-d170-4bb5-b5ac-fb1bc54a0dd6');
report:=public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','e18a3322-d170-4bb5-b5ac-fb1bc54a0dd6');
PERFORM set_config('local.fnb_refund_case',jsonb_build_object('name','regular_shipped_return','paid',paid,'cancel',cancelled,'replay',cancelled2,'stock',stock,'averageCost',(SELECT avg_unit_cost FROM public.fnb_ingredients WHERE id=ing),'finance',finance,'report',report,'order',(SELECT to_jsonb(o) FROM public.fnb_orders o WHERE id=oid),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at,id) FROM public.fnb_stock_movements m WHERE ref_id=oid))::text,true);
END $case$;SELECT current_setting('local.fnb_refund_case');DO $assert$ DECLARE r jsonb:=current_setting('local.fnb_refund_case')::jsonb;BEGIN ASSERT (r->'finance'->'cost'->>'fnbCogs')::numeric=0;ASSERT (r->'report'->>'cogs')::numeric=0;ASSERT (r->>'stock')::numeric=100;ASSERT (r->'finance'->'revenue'->>'fnb')::numeric=0;ASSERT (SELECT coalesce(sum((x->>'revenue')::numeric),0) FROM jsonb_array_elements(r->'report'->'topItems')x)=0;END $assert$;
ROLLBACK;

BEGIN;SET LOCAL lock_timeout='3s';DO $$ BEGIN ASSERT current_database()='vinpoker_owner_ft_reports_20261031';ASSERT current_setting('port')='55441';ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OWNER_FT_REPORTS_20261031_OWNED_LOCAL_TEST';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT NOT(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role');END $$;
\ir ../migrations/20270128000304_fnb_cancel_snapshot_cost_v1.sql
INSERT INTO auth.users(id)VALUES('8ea4ed61-41df-424d-bda3-b6e58a0c6b50');INSERT INTO auth.users(id)VALUES('9fbeccda-0d29-4d6d-9fed-e55839133440');INSERT INTO public.profiles(user_id,display_name)VALUES('9fbeccda-0d29-4d6d-9fed-e55839133440','LOCAL TEST refund owner');INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES('90546480-b5e3-493a-9759-22e00891c4ac','9fbeccda-0d29-4d6d-9fed-e55839133440','LOCAL TEST refund comp_unshipped','TEST','approved');SET LOCAL request.jwt.claim.sub='9fbeccda-0d29-4d6d-9fed-e55839133440';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"9fbeccda-0d29-4d6d-9fed-e55839133440"}';SET LOCAL ROLE authenticated;
DO $case$ DECLARE r jsonb;ing uuid;menu uuid;menu2 uuid;oid uuid;line uuid;lines jsonb;paid jsonb;cancelled jsonb;cancelled2 jsonb;finance jsonb;report jsonb;stock numeric;BEGIN
r:=public.fnb_upsert_ingredient(p_club_id=>'90546480-b5e3-493a-9759-22e00891c4ac',p_name=>'LOCAL TEST ingredient',p_stock_unit=>'unit',p_purchase_unit=>'unit',p_units_per_purchase=>1);ASSERT NOT(r?'error'),r::text;ing:=(r->>'id')::uuid;
r:=public.fnb_stock_in('90546480-b5e3-493a-9759-22e00891c4ac',ing,100,1000,'03e5f279-b945-4b71-a047-1247c459ff58');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_upsert_menu_item(p_club_id=>'90546480-b5e3-493a-9759-22e00891c4ac',p_name=>'LOCAL TEST menu',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu:=(r->>'id')::uuid;
r:=public.fnb_set_recipe(menu,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;
lines:=jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1));

r:=public.fnb_open_shift_v2('90546480-b5e3-493a-9759-22e00891c4ac',0,'82fed58e-2f3d-4240-9248-f24f4f95226a','9fbeccda-0d29-4d6d-9fed-e55839133440');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_update_settings(p_club_id=>'90546480-b5e3-493a-9759-22e00891c4ac',p_fnb_in_club_net=>true,p_restock_on_shipped_cancel=>false);ASSERT NOT(r?'error'),r::text;
paid:=public.fnb_create_comp_order('90546480-b5e3-493a-9759-22e00891c4ac','counter','LOCAL TEST',NULL,NULL,lines,'LOCAL TEST comp','5fc5d85a-dfbb-4beb-8abb-aab15e2455dc');ASSERT NOT(paid?'error'),paid::text;oid:=(paid->>'order_id')::uuid;
r:=public.fnb_mark_paid(oid,'b4b98f13-d19b-46b5-a634-6a85be919f52');ASSERT r->>'status'='ok' AND (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'paid replay must not capture again';
r:=public.fnb_create_comp_order('90546480-b5e3-493a-9759-22e00891c4ac','counter','LOCAL TEST',NULL,NULL,lines,'LOCAL TEST comp',(SELECT client_request_id FROM public.fnb_orders WHERE id=oid));ASSERT (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'COMP retry identity';
RESET ROLE;
BEGIN UPDATE floor_private.fnb_paid_line_snapshot_v1 SET qty=qty+1 WHERE order_id=(SELECT id FROM public.fnb_orders WHERE club_id='90546480-b5e3-493a-9759-22e00891c4ac' ORDER BY created_at LIMIT 1);RAISE EXCEPTION 'snapshot mutation unexpectedly allowed';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
SET LOCAL ROLE authenticated;
PERFORM set_config('request.jwt.claim.sub','8ea4ed61-41df-424d-bda3-b6e58a0c6b50',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"8ea4ed61-41df-424d-bda3-b6e58a0c6b50"}',true);
BEGIN r:=public.fnb_cancel_order(oid,'LOCAL TEST unauthorized');ASSERT r->>'error'='Forbidden',r::text;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.get_club_finance_summary_v2(current_date,current_date,'90546480-b5e3-493a-9759-22e00891c4ac');RAISE EXCEPTION 'unauthorized finance read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','90546480-b5e3-493a-9759-22e00891c4ac');RAISE EXCEPTION 'unauthorized fnb read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
PERFORM set_config('request.jwt.claim.sub','9fbeccda-0d29-4d6d-9fed-e55839133440',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"9fbeccda-0d29-4d6d-9fed-e55839133440"}',true);
RESET ROLE;
ASSERT NOT has_table_privilege('authenticated','floor_private.fnb_paid_line_snapshot_v1','SELECT');
ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_cancel_cogs_reversal_v1(uuid,bigint,timestamptz)','EXECUTE');
SET LOCAL ROLE authenticated;



cancelled:=public.fnb_cancel_order(oid,'LOCAL TEST refund');ASSERT NOT(cancelled?'error'),cancelled::text;
cancelled2:=public.fnb_cancel_order(oid,'LOCAL TEST replay');ASSERT NOT(cancelled2?'error'),cancelled2::text;
SELECT on_hand INTO stock FROM public.fnb_ingredients WHERE id=ing;
finance:=public.get_club_finance_summary_v2((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'90546480-b5e3-493a-9759-22e00891c4ac');
report:=public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','90546480-b5e3-493a-9759-22e00891c4ac');
PERFORM set_config('local.fnb_refund_case',jsonb_build_object('name','comp_unshipped','paid',paid,'cancel',cancelled,'replay',cancelled2,'stock',stock,'averageCost',(SELECT avg_unit_cost FROM public.fnb_ingredients WHERE id=ing),'finance',finance,'report',report,'order',(SELECT to_jsonb(o) FROM public.fnb_orders o WHERE id=oid),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at,id) FROM public.fnb_stock_movements m WHERE ref_id=oid))::text,true);
END $case$;SELECT current_setting('local.fnb_refund_case');DO $assert$ DECLARE r jsonb:=current_setting('local.fnb_refund_case')::jsonb;BEGIN ASSERT (r->'finance'->'cost'->>'compCogs')::numeric=0;ASSERT (r->'report'->>'compCogs')::numeric=0;ASSERT (r->>'stock')::numeric=100;ASSERT (r->'finance'->'revenue'->>'fnb')::numeric=0;END $assert$;
ROLLBACK;

BEGIN;SET LOCAL lock_timeout='3s';DO $$ BEGIN ASSERT current_database()='vinpoker_owner_ft_reports_20261031';ASSERT current_setting('port')='55441';ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OWNER_FT_REPORTS_20261031_OWNED_LOCAL_TEST';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT NOT(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role');END $$;
\ir ../migrations/20270128000304_fnb_cancel_snapshot_cost_v1.sql
INSERT INTO auth.users(id)VALUES('e33428a9-ab91-4a34-866b-40a3c2530837');INSERT INTO auth.users(id)VALUES('62f71390-01c4-4fee-b406-8c0f63993031');INSERT INTO public.profiles(user_id,display_name)VALUES('62f71390-01c4-4fee-b406-8c0f63993031','LOCAL TEST refund owner');INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES('b133a475-1460-486d-acbc-53e18d67f187','62f71390-01c4-4fee-b406-8c0f63993031','LOCAL TEST refund comp_shipped_no_return','TEST','approved');SET LOCAL request.jwt.claim.sub='62f71390-01c4-4fee-b406-8c0f63993031';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"62f71390-01c4-4fee-b406-8c0f63993031"}';SET LOCAL ROLE authenticated;
DO $case$ DECLARE r jsonb;ing uuid;menu uuid;menu2 uuid;oid uuid;line uuid;lines jsonb;paid jsonb;cancelled jsonb;cancelled2 jsonb;finance jsonb;report jsonb;stock numeric;BEGIN
r:=public.fnb_upsert_ingredient(p_club_id=>'b133a475-1460-486d-acbc-53e18d67f187',p_name=>'LOCAL TEST ingredient',p_stock_unit=>'unit',p_purchase_unit=>'unit',p_units_per_purchase=>1);ASSERT NOT(r?'error'),r::text;ing:=(r->>'id')::uuid;
r:=public.fnb_stock_in('b133a475-1460-486d-acbc-53e18d67f187',ing,100,1000,'50ba27a5-d301-43a7-b3da-4ca3d9dd34f1');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_upsert_menu_item(p_club_id=>'b133a475-1460-486d-acbc-53e18d67f187',p_name=>'LOCAL TEST menu',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu:=(r->>'id')::uuid;
r:=public.fnb_set_recipe(menu,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;
lines:=jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1));

r:=public.fnb_open_shift_v2('b133a475-1460-486d-acbc-53e18d67f187',0,'7d5feb48-4b69-4a9b-83ca-01b13d47f601','62f71390-01c4-4fee-b406-8c0f63993031');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_update_settings(p_club_id=>'b133a475-1460-486d-acbc-53e18d67f187',p_fnb_in_club_net=>true,p_restock_on_shipped_cancel=>false);ASSERT NOT(r?'error'),r::text;
paid:=public.fnb_create_comp_order('b133a475-1460-486d-acbc-53e18d67f187','counter','LOCAL TEST',NULL,NULL,lines,'LOCAL TEST comp','644d4d78-c080-4372-8972-f6464490bd87');ASSERT NOT(paid?'error'),paid::text;oid:=(paid->>'order_id')::uuid;
r:=public.fnb_mark_paid(oid,'c83d8ed1-3bb5-4463-bb2b-67d899195446');ASSERT r->>'status'='ok' AND (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'paid replay must not capture again';
r:=public.fnb_create_comp_order('b133a475-1460-486d-acbc-53e18d67f187','counter','LOCAL TEST',NULL,NULL,lines,'LOCAL TEST comp',(SELECT client_request_id FROM public.fnb_orders WHERE id=oid));ASSERT (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'COMP retry identity';
RESET ROLE;
BEGIN UPDATE floor_private.fnb_paid_line_snapshot_v1 SET qty=qty+1 WHERE order_id=(SELECT id FROM public.fnb_orders WHERE club_id='b133a475-1460-486d-acbc-53e18d67f187' ORDER BY created_at LIMIT 1);RAISE EXCEPTION 'snapshot mutation unexpectedly allowed';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
SET LOCAL ROLE authenticated;
PERFORM set_config('request.jwt.claim.sub','e33428a9-ab91-4a34-866b-40a3c2530837',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"e33428a9-ab91-4a34-866b-40a3c2530837"}',true);
BEGIN r:=public.fnb_cancel_order(oid,'LOCAL TEST unauthorized');ASSERT r->>'error'='Forbidden',r::text;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.get_club_finance_summary_v2(current_date,current_date,'b133a475-1460-486d-acbc-53e18d67f187');RAISE EXCEPTION 'unauthorized finance read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','b133a475-1460-486d-acbc-53e18d67f187');RAISE EXCEPTION 'unauthorized fnb read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
PERFORM set_config('request.jwt.claim.sub','62f71390-01c4-4fee-b406-8c0f63993031',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"62f71390-01c4-4fee-b406-8c0f63993031"}',true);
RESET ROLE;
ASSERT NOT has_table_privilege('authenticated','floor_private.fnb_paid_line_snapshot_v1','SELECT');
ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_cancel_cogs_reversal_v1(uuid,bigint,timestamptz)','EXECUTE');
SET LOCAL ROLE authenticated;
r:=public.fnb_mark_shipped(oid,NULL);ASSERT NOT(r?'error'),r::text;


cancelled:=public.fnb_cancel_order(oid,'LOCAL TEST refund');ASSERT NOT(cancelled?'error'),cancelled::text;
cancelled2:=public.fnb_cancel_order(oid,'LOCAL TEST replay');ASSERT NOT(cancelled2?'error'),cancelled2::text;
SELECT on_hand INTO stock FROM public.fnb_ingredients WHERE id=ing;
finance:=public.get_club_finance_summary_v2((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'b133a475-1460-486d-acbc-53e18d67f187');
report:=public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','b133a475-1460-486d-acbc-53e18d67f187');
PERFORM set_config('local.fnb_refund_case',jsonb_build_object('name','comp_shipped_no_return','paid',paid,'cancel',cancelled,'replay',cancelled2,'stock',stock,'averageCost',(SELECT avg_unit_cost FROM public.fnb_ingredients WHERE id=ing),'finance',finance,'report',report,'order',(SELECT to_jsonb(o) FROM public.fnb_orders o WHERE id=oid),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at,id) FROM public.fnb_stock_movements m WHERE ref_id=oid))::text,true);
END $case$;SELECT current_setting('local.fnb_refund_case');DO $assert$ DECLARE r jsonb:=current_setting('local.fnb_refund_case')::jsonb;BEGIN ASSERT (r->'finance'->'cost'->>'compCogs')::numeric=2000;ASSERT (r->'report'->>'compCogs')::numeric=2000;ASSERT (r->>'stock')::numeric=98;ASSERT (r->'finance'->'revenue'->>'fnb')::numeric=0;END $assert$;
ROLLBACK;

BEGIN;SET LOCAL lock_timeout='3s';DO $$ BEGIN ASSERT current_database()='vinpoker_owner_ft_reports_20261031';ASSERT current_setting('port')='55441';ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OWNER_FT_REPORTS_20261031_OWNED_LOCAL_TEST';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT NOT(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role');END $$;
\ir ../migrations/20270128000304_fnb_cancel_snapshot_cost_v1.sql
INSERT INTO auth.users(id)VALUES('869a3e2b-08de-48aa-b1d0-6b073f61a73a');INSERT INTO auth.users(id)VALUES('e563b43b-90b0-4af8-ac19-43f58f12f249');INSERT INTO public.profiles(user_id,display_name)VALUES('e563b43b-90b0-4af8-ac19-43f58f12f249','LOCAL TEST refund owner');INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES('f75e5099-c3c1-4f13-a57d-c0fb01eafc53','e563b43b-90b0-4af8-ac19-43f58f12f249','LOCAL TEST refund comp_shipped_return','TEST','approved');SET LOCAL request.jwt.claim.sub='e563b43b-90b0-4af8-ac19-43f58f12f249';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"e563b43b-90b0-4af8-ac19-43f58f12f249"}';SET LOCAL ROLE authenticated;
DO $case$ DECLARE r jsonb;ing uuid;menu uuid;menu2 uuid;oid uuid;line uuid;lines jsonb;paid jsonb;cancelled jsonb;cancelled2 jsonb;finance jsonb;report jsonb;stock numeric;BEGIN
r:=public.fnb_upsert_ingredient(p_club_id=>'f75e5099-c3c1-4f13-a57d-c0fb01eafc53',p_name=>'LOCAL TEST ingredient',p_stock_unit=>'unit',p_purchase_unit=>'unit',p_units_per_purchase=>1);ASSERT NOT(r?'error'),r::text;ing:=(r->>'id')::uuid;
r:=public.fnb_stock_in('f75e5099-c3c1-4f13-a57d-c0fb01eafc53',ing,100,1000,'3d66e3f4-2e95-4483-9a99-2bb807106679');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_upsert_menu_item(p_club_id=>'f75e5099-c3c1-4f13-a57d-c0fb01eafc53',p_name=>'LOCAL TEST menu',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu:=(r->>'id')::uuid;
r:=public.fnb_set_recipe(menu,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;
lines:=jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1));

r:=public.fnb_open_shift_v2('f75e5099-c3c1-4f13-a57d-c0fb01eafc53',0,'07c8be4f-e1e6-4109-8640-05495654e330','e563b43b-90b0-4af8-ac19-43f58f12f249');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_update_settings(p_club_id=>'f75e5099-c3c1-4f13-a57d-c0fb01eafc53',p_fnb_in_club_net=>true,p_restock_on_shipped_cancel=>true);ASSERT NOT(r?'error'),r::text;
paid:=public.fnb_create_comp_order('f75e5099-c3c1-4f13-a57d-c0fb01eafc53','counter','LOCAL TEST',NULL,NULL,lines,'LOCAL TEST comp','c81a1722-1d09-4d7a-ac02-db54604847dd');ASSERT NOT(paid?'error'),paid::text;oid:=(paid->>'order_id')::uuid;
r:=public.fnb_mark_paid(oid,'5eae5138-d0c1-468c-966c-5fdf3142a248');ASSERT r->>'status'='ok' AND (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'paid replay must not capture again';
r:=public.fnb_create_comp_order('f75e5099-c3c1-4f13-a57d-c0fb01eafc53','counter','LOCAL TEST',NULL,NULL,lines,'LOCAL TEST comp',(SELECT client_request_id FROM public.fnb_orders WHERE id=oid));ASSERT (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'COMP retry identity';
RESET ROLE;
BEGIN UPDATE floor_private.fnb_paid_line_snapshot_v1 SET qty=qty+1 WHERE order_id=(SELECT id FROM public.fnb_orders WHERE club_id='f75e5099-c3c1-4f13-a57d-c0fb01eafc53' ORDER BY created_at LIMIT 1);RAISE EXCEPTION 'snapshot mutation unexpectedly allowed';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
SET LOCAL ROLE authenticated;
PERFORM set_config('request.jwt.claim.sub','869a3e2b-08de-48aa-b1d0-6b073f61a73a',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"869a3e2b-08de-48aa-b1d0-6b073f61a73a"}',true);
BEGIN r:=public.fnb_cancel_order(oid,'LOCAL TEST unauthorized');ASSERT r->>'error'='Forbidden',r::text;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.get_club_finance_summary_v2(current_date,current_date,'f75e5099-c3c1-4f13-a57d-c0fb01eafc53');RAISE EXCEPTION 'unauthorized finance read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','f75e5099-c3c1-4f13-a57d-c0fb01eafc53');RAISE EXCEPTION 'unauthorized fnb read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
PERFORM set_config('request.jwt.claim.sub','e563b43b-90b0-4af8-ac19-43f58f12f249',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"e563b43b-90b0-4af8-ac19-43f58f12f249"}',true);
RESET ROLE;
ASSERT NOT has_table_privilege('authenticated','floor_private.fnb_paid_line_snapshot_v1','SELECT');
ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_cancel_cogs_reversal_v1(uuid,bigint,timestamptz)','EXECUTE');
SET LOCAL ROLE authenticated;
r:=public.fnb_mark_shipped(oid,NULL);ASSERT NOT(r?'error'),r::text;


cancelled:=public.fnb_cancel_order(oid,'LOCAL TEST refund');ASSERT NOT(cancelled?'error'),cancelled::text;
cancelled2:=public.fnb_cancel_order(oid,'LOCAL TEST replay');ASSERT NOT(cancelled2?'error'),cancelled2::text;
SELECT on_hand INTO stock FROM public.fnb_ingredients WHERE id=ing;
finance:=public.get_club_finance_summary_v2((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'f75e5099-c3c1-4f13-a57d-c0fb01eafc53');
report:=public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','f75e5099-c3c1-4f13-a57d-c0fb01eafc53');
PERFORM set_config('local.fnb_refund_case',jsonb_build_object('name','comp_shipped_return','paid',paid,'cancel',cancelled,'replay',cancelled2,'stock',stock,'averageCost',(SELECT avg_unit_cost FROM public.fnb_ingredients WHERE id=ing),'finance',finance,'report',report,'order',(SELECT to_jsonb(o) FROM public.fnb_orders o WHERE id=oid),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at,id) FROM public.fnb_stock_movements m WHERE ref_id=oid))::text,true);
END $case$;SELECT current_setting('local.fnb_refund_case');DO $assert$ DECLARE r jsonb:=current_setting('local.fnb_refund_case')::jsonb;BEGIN ASSERT (r->'finance'->'cost'->>'compCogs')::numeric=0;ASSERT (r->'report'->>'compCogs')::numeric=0;ASSERT (r->>'stock')::numeric=100;ASSERT (r->'finance'->'revenue'->>'fnb')::numeric=0;END $assert$;
ROLLBACK;

BEGIN;SET LOCAL lock_timeout='3s';DO $$ BEGIN ASSERT current_database()='vinpoker_owner_ft_reports_20261031';ASSERT current_setting('port')='55441';ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OWNER_FT_REPORTS_20261031_OWNED_LOCAL_TEST';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT NOT(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role');END $$;
\ir ../migrations/20270128000304_fnb_cancel_snapshot_cost_v1.sql
INSERT INTO auth.users(id)VALUES('63a6c593-21c8-42cb-a1d4-b6cde5e2cb7c');INSERT INTO auth.users(id)VALUES('3f9b369c-5834-4516-b810-92444603fae7');INSERT INTO public.profiles(user_id,display_name)VALUES('3f9b369c-5834-4516-b810-92444603fae7','LOCAL TEST refund owner');INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES('22e94227-d424-40f4-b7af-f502428adf37','3f9b369c-5834-4516-b810-92444603fae7','LOCAL TEST refund regular_partial_no_return','TEST','approved');SET LOCAL request.jwt.claim.sub='3f9b369c-5834-4516-b810-92444603fae7';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"3f9b369c-5834-4516-b810-92444603fae7"}';SET LOCAL ROLE authenticated;
DO $case$ DECLARE r jsonb;ing uuid;menu uuid;menu2 uuid;oid uuid;line uuid;lines jsonb;paid jsonb;cancelled jsonb;cancelled2 jsonb;finance jsonb;report jsonb;stock numeric;BEGIN
r:=public.fnb_upsert_ingredient(p_club_id=>'22e94227-d424-40f4-b7af-f502428adf37',p_name=>'LOCAL TEST ingredient',p_stock_unit=>'unit',p_purchase_unit=>'unit',p_units_per_purchase=>1);ASSERT NOT(r?'error'),r::text;ing:=(r->>'id')::uuid;
r:=public.fnb_stock_in('22e94227-d424-40f4-b7af-f502428adf37',ing,100,1000,'92dd237d-fb50-425f-bb8f-d903fdd632eb');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_upsert_menu_item(p_club_id=>'22e94227-d424-40f4-b7af-f502428adf37',p_name=>'LOCAL TEST menu',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu:=(r->>'id')::uuid;
r:=public.fnb_set_recipe(menu,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;
lines:=jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1));
r:=public.fnb_upsert_menu_item(p_club_id=>'22e94227-d424-40f4-b7af-f502428adf37',p_name=>'LOCAL TEST menu two',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu2:=(r->>'id')::uuid;r:=public.fnb_set_recipe(menu2,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;lines:=lines||jsonb_build_array(jsonb_build_object('menu_item_id',menu2,'qty',1));
r:=public.fnb_open_shift_v2('22e94227-d424-40f4-b7af-f502428adf37',0,'d4f69cd9-2dfa-4b71-998b-c0c92387fb88','3f9b369c-5834-4516-b810-92444603fae7');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_update_settings(p_club_id=>'22e94227-d424-40f4-b7af-f502428adf37',p_fnb_in_club_net=>true,p_restock_on_shipped_cancel=>false);ASSERT NOT(r?'error'),r::text;
r:=public.fnb_create_order('22e94227-d424-40f4-b7af-f502428adf37','counter','LOCAL TEST',NULL,NULL,lines,'3aaae696-2c0b-4f37-9871-0af888632d1a');ASSERT NOT(r?'error'),r::text;oid:=(r->>'order_id')::uuid;IF false THEN
 RESET ROLE;UPDATE public.fnb_orders SET payment_method='bank_transfer' WHERE id=oid AND status='pending' AND paid_at IS NULL;ASSERT FOUND,'fresh pending bank fixture only';SET LOCAL ROLE service_role;
 PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claim.role','service_role',true);PERFORM set_config('request.jwt.claims','{"role":"service_role","sub":""}',true);
 paid:=public.fnb_settle_bank_paid(oid,'2e72a63d-96f1-429f-8d21-28105176e7b9');
 RESET ROLE;SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claim.sub','3f9b369c-5834-4516-b810-92444603fae7',true);PERFORM set_config('request.jwt.claim.role','authenticated',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"3f9b369c-5834-4516-b810-92444603fae7"}',true);
 ELSE paid:=public.fnb_mark_paid(oid,'b5f18cb1-08ff-47ad-afaf-e3ba4900d326');END IF;ASSERT NOT(paid?'error'),paid::text;
r:=public.fnb_mark_paid(oid,'ce9f6d7e-e197-485b-a897-a4ea6ba51e73');ASSERT r->>'status'='ok' AND (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'paid replay must not capture again';

RESET ROLE;
BEGIN UPDATE floor_private.fnb_paid_line_snapshot_v1 SET qty=qty+1 WHERE order_id=(SELECT id FROM public.fnb_orders WHERE club_id='22e94227-d424-40f4-b7af-f502428adf37' ORDER BY created_at LIMIT 1);RAISE EXCEPTION 'snapshot mutation unexpectedly allowed';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
SET LOCAL ROLE authenticated;
PERFORM set_config('request.jwt.claim.sub','63a6c593-21c8-42cb-a1d4-b6cde5e2cb7c',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"63a6c593-21c8-42cb-a1d4-b6cde5e2cb7c"}',true);
BEGIN r:=public.fnb_cancel_order(oid,'LOCAL TEST unauthorized');ASSERT r->>'error'='Forbidden',r::text;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.get_club_finance_summary_v2(current_date,current_date,'22e94227-d424-40f4-b7af-f502428adf37');RAISE EXCEPTION 'unauthorized finance read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','22e94227-d424-40f4-b7af-f502428adf37');RAISE EXCEPTION 'unauthorized fnb read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
PERFORM set_config('request.jwt.claim.sub','3f9b369c-5834-4516-b810-92444603fae7',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"3f9b369c-5834-4516-b810-92444603fae7"}',true);
RESET ROLE;
ASSERT NOT has_table_privilege('authenticated','floor_private.fnb_paid_line_snapshot_v1','SELECT');
ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_cancel_cogs_reversal_v1(uuid,bigint,timestamptz)','EXECUTE');
SET LOCAL ROLE authenticated;
SELECT id INTO line FROM public.fnb_order_items WHERE order_id=oid AND menu_item_id=menu;r:=public.fnb_mark_shipped(oid,line);ASSERT NOT(r?'error'),r::text;


cancelled:=public.fnb_cancel_order(oid,'LOCAL TEST refund');ASSERT NOT(cancelled?'error'),cancelled::text;
cancelled2:=public.fnb_cancel_order(oid,'LOCAL TEST replay');ASSERT NOT(cancelled2?'error'),cancelled2::text;
SELECT on_hand INTO stock FROM public.fnb_ingredients WHERE id=ing;
finance:=public.get_club_finance_summary_v2((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'22e94227-d424-40f4-b7af-f502428adf37');
report:=public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','22e94227-d424-40f4-b7af-f502428adf37');
PERFORM set_config('local.fnb_refund_case',jsonb_build_object('name','regular_partial_no_return','paid',paid,'cancel',cancelled,'replay',cancelled2,'stock',stock,'averageCost',(SELECT avg_unit_cost FROM public.fnb_ingredients WHERE id=ing),'finance',finance,'report',report,'order',(SELECT to_jsonb(o) FROM public.fnb_orders o WHERE id=oid),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at,id) FROM public.fnb_stock_movements m WHERE ref_id=oid))::text,true);
END $case$;SELECT current_setting('local.fnb_refund_case');DO $assert$ DECLARE r jsonb:=current_setting('local.fnb_refund_case')::jsonb;BEGIN ASSERT (r->'finance'->'cost'->>'fnbCogs')::numeric=2000;ASSERT (r->'report'->>'cogs')::numeric=2000;ASSERT (r->>'stock')::numeric=98;ASSERT (r->'finance'->'revenue'->>'fnb')::numeric=0;ASSERT (SELECT coalesce(sum((x->>'revenue')::numeric),0) FROM jsonb_array_elements(r->'report'->'topItems')x)=0;END $assert$;
ROLLBACK;

BEGIN;SET LOCAL lock_timeout='3s';DO $$ BEGIN ASSERT current_database()='vinpoker_owner_ft_reports_20261031';ASSERT current_setting('port')='55441';ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OWNER_FT_REPORTS_20261031_OWNED_LOCAL_TEST';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT NOT(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role');END $$;
\ir ../migrations/20270128000304_fnb_cancel_snapshot_cost_v1.sql
INSERT INTO auth.users(id)VALUES('d6afa86a-d723-4a44-a074-6d0c27f11696');INSERT INTO auth.users(id)VALUES('012e3ae3-1dee-4a30-9739-0d52a31b1b6e');INSERT INTO public.profiles(user_id,display_name)VALUES('012e3ae3-1dee-4a30-9739-0d52a31b1b6e','LOCAL TEST refund owner');INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES('2ae9fdec-40ff-4093-9882-40565dff5a00','012e3ae3-1dee-4a30-9739-0d52a31b1b6e','LOCAL TEST refund comp_partial_no_return','TEST','approved');SET LOCAL request.jwt.claim.sub='012e3ae3-1dee-4a30-9739-0d52a31b1b6e';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"012e3ae3-1dee-4a30-9739-0d52a31b1b6e"}';SET LOCAL ROLE authenticated;
DO $case$ DECLARE r jsonb;ing uuid;menu uuid;menu2 uuid;oid uuid;line uuid;lines jsonb;paid jsonb;cancelled jsonb;cancelled2 jsonb;finance jsonb;report jsonb;stock numeric;BEGIN
r:=public.fnb_upsert_ingredient(p_club_id=>'2ae9fdec-40ff-4093-9882-40565dff5a00',p_name=>'LOCAL TEST ingredient',p_stock_unit=>'unit',p_purchase_unit=>'unit',p_units_per_purchase=>1);ASSERT NOT(r?'error'),r::text;ing:=(r->>'id')::uuid;
r:=public.fnb_stock_in('2ae9fdec-40ff-4093-9882-40565dff5a00',ing,100,1000,'74447d0a-a219-40c0-9ae2-0f7ccf26b2da');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_upsert_menu_item(p_club_id=>'2ae9fdec-40ff-4093-9882-40565dff5a00',p_name=>'LOCAL TEST menu',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu:=(r->>'id')::uuid;
r:=public.fnb_set_recipe(menu,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;
lines:=jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1));
r:=public.fnb_upsert_menu_item(p_club_id=>'2ae9fdec-40ff-4093-9882-40565dff5a00',p_name=>'LOCAL TEST menu two',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu2:=(r->>'id')::uuid;r:=public.fnb_set_recipe(menu2,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;lines:=lines||jsonb_build_array(jsonb_build_object('menu_item_id',menu2,'qty',1));
r:=public.fnb_open_shift_v2('2ae9fdec-40ff-4093-9882-40565dff5a00',0,'8d6c5282-8044-41f6-ae13-9038bebed0b7','012e3ae3-1dee-4a30-9739-0d52a31b1b6e');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_update_settings(p_club_id=>'2ae9fdec-40ff-4093-9882-40565dff5a00',p_fnb_in_club_net=>true,p_restock_on_shipped_cancel=>false);ASSERT NOT(r?'error'),r::text;
paid:=public.fnb_create_comp_order('2ae9fdec-40ff-4093-9882-40565dff5a00','counter','LOCAL TEST',NULL,NULL,lines,'LOCAL TEST comp','8f3bb47f-1461-451c-bc77-2a0bf4906090');ASSERT NOT(paid?'error'),paid::text;oid:=(paid->>'order_id')::uuid;
r:=public.fnb_mark_paid(oid,'8c57709b-c807-498f-be39-7da0479105a7');ASSERT r->>'status'='ok' AND (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'paid replay must not capture again';
r:=public.fnb_create_comp_order('2ae9fdec-40ff-4093-9882-40565dff5a00','counter','LOCAL TEST',NULL,NULL,lines,'LOCAL TEST comp',(SELECT client_request_id FROM public.fnb_orders WHERE id=oid));ASSERT (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'COMP retry identity';
RESET ROLE;
BEGIN UPDATE floor_private.fnb_paid_line_snapshot_v1 SET qty=qty+1 WHERE order_id=(SELECT id FROM public.fnb_orders WHERE club_id='2ae9fdec-40ff-4093-9882-40565dff5a00' ORDER BY created_at LIMIT 1);RAISE EXCEPTION 'snapshot mutation unexpectedly allowed';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
SET LOCAL ROLE authenticated;
PERFORM set_config('request.jwt.claim.sub','d6afa86a-d723-4a44-a074-6d0c27f11696',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"d6afa86a-d723-4a44-a074-6d0c27f11696"}',true);
BEGIN r:=public.fnb_cancel_order(oid,'LOCAL TEST unauthorized');ASSERT r->>'error'='Forbidden',r::text;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.get_club_finance_summary_v2(current_date,current_date,'2ae9fdec-40ff-4093-9882-40565dff5a00');RAISE EXCEPTION 'unauthorized finance read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','2ae9fdec-40ff-4093-9882-40565dff5a00');RAISE EXCEPTION 'unauthorized fnb read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
PERFORM set_config('request.jwt.claim.sub','012e3ae3-1dee-4a30-9739-0d52a31b1b6e',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"012e3ae3-1dee-4a30-9739-0d52a31b1b6e"}',true);
RESET ROLE;
ASSERT NOT has_table_privilege('authenticated','floor_private.fnb_paid_line_snapshot_v1','SELECT');
ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_cancel_cogs_reversal_v1(uuid,bigint,timestamptz)','EXECUTE');
SET LOCAL ROLE authenticated;
SELECT id INTO line FROM public.fnb_order_items WHERE order_id=oid AND menu_item_id=menu;r:=public.fnb_mark_shipped(oid,line);ASSERT NOT(r?'error'),r::text;


cancelled:=public.fnb_cancel_order(oid,'LOCAL TEST refund');ASSERT NOT(cancelled?'error'),cancelled::text;
cancelled2:=public.fnb_cancel_order(oid,'LOCAL TEST replay');ASSERT NOT(cancelled2?'error'),cancelled2::text;
SELECT on_hand INTO stock FROM public.fnb_ingredients WHERE id=ing;
finance:=public.get_club_finance_summary_v2((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'2ae9fdec-40ff-4093-9882-40565dff5a00');
report:=public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','2ae9fdec-40ff-4093-9882-40565dff5a00');
PERFORM set_config('local.fnb_refund_case',jsonb_build_object('name','comp_partial_no_return','paid',paid,'cancel',cancelled,'replay',cancelled2,'stock',stock,'averageCost',(SELECT avg_unit_cost FROM public.fnb_ingredients WHERE id=ing),'finance',finance,'report',report,'order',(SELECT to_jsonb(o) FROM public.fnb_orders o WHERE id=oid),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at,id) FROM public.fnb_stock_movements m WHERE ref_id=oid))::text,true);
END $case$;SELECT current_setting('local.fnb_refund_case');DO $assert$ DECLARE r jsonb:=current_setting('local.fnb_refund_case')::jsonb;BEGIN ASSERT (r->'finance'->'cost'->>'compCogs')::numeric=2000;ASSERT (r->'report'->>'compCogs')::numeric=2000;ASSERT (r->>'stock')::numeric=98;ASSERT (r->'finance'->'revenue'->>'fnb')::numeric=0;END $assert$;
ROLLBACK;

BEGIN;SET LOCAL lock_timeout='3s';DO $$ BEGIN ASSERT current_database()='vinpoker_owner_ft_reports_20261031';ASSERT current_setting('port')='55441';ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OWNER_FT_REPORTS_20261031_OWNED_LOCAL_TEST';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT NOT(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role');END $$;
\ir ../migrations/20270128000304_fnb_cancel_snapshot_cost_v1.sql
INSERT INTO auth.users(id)VALUES('32731953-eed2-4a08-866c-5ff9f045cfaa');INSERT INTO auth.users(id)VALUES('26d06695-9ce3-4daa-9c42-8c463e17340c');INSERT INTO public.profiles(user_id,display_name)VALUES('26d06695-9ce3-4daa-9c42-8c463e17340c','LOCAL TEST refund owner');INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES('cfdd8753-f959-4519-aae4-4fc89e3e3deb','26d06695-9ce3-4daa-9c42-8c463e17340c','LOCAL TEST refund regular_recipe_changed_after_pay','TEST','approved');SET LOCAL request.jwt.claim.sub='26d06695-9ce3-4daa-9c42-8c463e17340c';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"26d06695-9ce3-4daa-9c42-8c463e17340c"}';SET LOCAL ROLE authenticated;
DO $case$ DECLARE r jsonb;ing uuid;menu uuid;menu2 uuid;oid uuid;line uuid;lines jsonb;paid jsonb;cancelled jsonb;cancelled2 jsonb;finance jsonb;report jsonb;stock numeric;BEGIN
r:=public.fnb_upsert_ingredient(p_club_id=>'cfdd8753-f959-4519-aae4-4fc89e3e3deb',p_name=>'LOCAL TEST ingredient',p_stock_unit=>'unit',p_purchase_unit=>'unit',p_units_per_purchase=>1);ASSERT NOT(r?'error'),r::text;ing:=(r->>'id')::uuid;
r:=public.fnb_stock_in('cfdd8753-f959-4519-aae4-4fc89e3e3deb',ing,100,1000,'c611c737-ca8f-462c-9420-1973d0e2c202');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_upsert_menu_item(p_club_id=>'cfdd8753-f959-4519-aae4-4fc89e3e3deb',p_name=>'LOCAL TEST menu',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu:=(r->>'id')::uuid;
r:=public.fnb_set_recipe(menu,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;
lines:=jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1));
r:=public.fnb_upsert_menu_item(p_club_id=>'cfdd8753-f959-4519-aae4-4fc89e3e3deb',p_name=>'LOCAL TEST menu two',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu2:=(r->>'id')::uuid;r:=public.fnb_set_recipe(menu2,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;lines:=lines||jsonb_build_array(jsonb_build_object('menu_item_id',menu2,'qty',1));
r:=public.fnb_open_shift_v2('cfdd8753-f959-4519-aae4-4fc89e3e3deb',0,'1502dad1-c0d6-4892-bf83-651a16e2ad96','26d06695-9ce3-4daa-9c42-8c463e17340c');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_update_settings(p_club_id=>'cfdd8753-f959-4519-aae4-4fc89e3e3deb',p_fnb_in_club_net=>true,p_restock_on_shipped_cancel=>false);ASSERT NOT(r?'error'),r::text;
r:=public.fnb_create_order('cfdd8753-f959-4519-aae4-4fc89e3e3deb','counter','LOCAL TEST',NULL,NULL,lines,'25b2fec9-3b2d-4348-b52d-661a8befc920');ASSERT NOT(r?'error'),r::text;oid:=(r->>'order_id')::uuid;IF false THEN
 RESET ROLE;UPDATE public.fnb_orders SET payment_method='bank_transfer' WHERE id=oid AND status='pending' AND paid_at IS NULL;ASSERT FOUND,'fresh pending bank fixture only';SET LOCAL ROLE service_role;
 PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claim.role','service_role',true);PERFORM set_config('request.jwt.claims','{"role":"service_role","sub":""}',true);
 paid:=public.fnb_settle_bank_paid(oid,'4a10ac30-4a1f-43bc-b3cf-4d9c9ded3cea');
 RESET ROLE;SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claim.sub','26d06695-9ce3-4daa-9c42-8c463e17340c',true);PERFORM set_config('request.jwt.claim.role','authenticated',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"26d06695-9ce3-4daa-9c42-8c463e17340c"}',true);
 ELSE paid:=public.fnb_mark_paid(oid,'7d909bb6-5a6b-401b-b5ea-21e80abe89e5');END IF;ASSERT NOT(paid?'error'),paid::text;
r:=public.fnb_mark_paid(oid,'929ba0e9-f69b-476c-94a8-270bbed1072f');ASSERT r->>'status'='ok' AND (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'paid replay must not capture again';

RESET ROLE;
BEGIN UPDATE floor_private.fnb_paid_line_snapshot_v1 SET qty=qty+1 WHERE order_id=(SELECT id FROM public.fnb_orders WHERE club_id='cfdd8753-f959-4519-aae4-4fc89e3e3deb' ORDER BY created_at LIMIT 1);RAISE EXCEPTION 'snapshot mutation unexpectedly allowed';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
SET LOCAL ROLE authenticated;
PERFORM set_config('request.jwt.claim.sub','32731953-eed2-4a08-866c-5ff9f045cfaa',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"32731953-eed2-4a08-866c-5ff9f045cfaa"}',true);
BEGIN r:=public.fnb_cancel_order(oid,'LOCAL TEST unauthorized');ASSERT r->>'error'='Forbidden',r::text;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.get_club_finance_summary_v2(current_date,current_date,'cfdd8753-f959-4519-aae4-4fc89e3e3deb');RAISE EXCEPTION 'unauthorized finance read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','cfdd8753-f959-4519-aae4-4fc89e3e3deb');RAISE EXCEPTION 'unauthorized fnb read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
PERFORM set_config('request.jwt.claim.sub','26d06695-9ce3-4daa-9c42-8c463e17340c',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"26d06695-9ce3-4daa-9c42-8c463e17340c"}',true);
RESET ROLE;
ASSERT NOT has_table_privilege('authenticated','floor_private.fnb_paid_line_snapshot_v1','SELECT');
ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_cancel_cogs_reversal_v1(uuid,bigint,timestamptz)','EXECUTE');
SET LOCAL ROLE authenticated;
SELECT id INTO line FROM public.fnb_order_items WHERE order_id=oid AND menu_item_id=menu;r:=public.fnb_mark_shipped(oid,line);ASSERT NOT(r?'error'),r::text;
r:=public.fnb_set_recipe(menu2,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',7)));ASSERT NOT(r?'error'),r::text;

cancelled:=public.fnb_cancel_order(oid,'LOCAL TEST refund');ASSERT NOT(cancelled?'error'),cancelled::text;
cancelled2:=public.fnb_cancel_order(oid,'LOCAL TEST replay');ASSERT NOT(cancelled2?'error'),cancelled2::text;
SELECT on_hand INTO stock FROM public.fnb_ingredients WHERE id=ing;
finance:=public.get_club_finance_summary_v2((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'cfdd8753-f959-4519-aae4-4fc89e3e3deb');
report:=public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','cfdd8753-f959-4519-aae4-4fc89e3e3deb');
PERFORM set_config('local.fnb_refund_case',jsonb_build_object('name','regular_recipe_changed_after_pay','paid',paid,'cancel',cancelled,'replay',cancelled2,'stock',stock,'averageCost',(SELECT avg_unit_cost FROM public.fnb_ingredients WHERE id=ing),'finance',finance,'report',report,'order',(SELECT to_jsonb(o) FROM public.fnb_orders o WHERE id=oid),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at,id) FROM public.fnb_stock_movements m WHERE ref_id=oid))::text,true);
END $case$;SELECT current_setting('local.fnb_refund_case');DO $assert$ DECLARE r jsonb:=current_setting('local.fnb_refund_case')::jsonb;BEGIN ASSERT (r->'finance'->'cost'->>'fnbCogs')::numeric=2000;ASSERT (r->'report'->>'cogs')::numeric=2000;ASSERT (r->>'stock')::numeric=98;ASSERT (r->'finance'->'revenue'->>'fnb')::numeric=0;ASSERT (SELECT coalesce(sum((x->>'revenue')::numeric),0) FROM jsonb_array_elements(r->'report'->'topItems')x)=0;END $assert$;
ROLLBACK;

BEGIN;SET LOCAL lock_timeout='3s';DO $$ BEGIN ASSERT current_database()='vinpoker_owner_ft_reports_20261031';ASSERT current_setting('port')='55441';ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OWNER_FT_REPORTS_20261031_OWNED_LOCAL_TEST';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT NOT(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role');END $$;
\ir ../migrations/20270128000304_fnb_cancel_snapshot_cost_v1.sql
INSERT INTO auth.users(id)VALUES('eec8842d-065d-4d65-a50d-ee7f5eb91817');INSERT INTO auth.users(id)VALUES('a6a19de0-3334-494a-82de-f78de46cc95c');INSERT INTO public.profiles(user_id,display_name)VALUES('a6a19de0-3334-494a-82de-f78de46cc95c','LOCAL TEST refund owner');INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES('1a25d386-002f-46c9-8bc9-3b145f18daf7','a6a19de0-3334-494a-82de-f78de46cc95c','LOCAL TEST refund comp_recipe_changed_after_pay','TEST','approved');SET LOCAL request.jwt.claim.sub='a6a19de0-3334-494a-82de-f78de46cc95c';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"a6a19de0-3334-494a-82de-f78de46cc95c"}';SET LOCAL ROLE authenticated;
DO $case$ DECLARE r jsonb;ing uuid;menu uuid;menu2 uuid;oid uuid;line uuid;lines jsonb;paid jsonb;cancelled jsonb;cancelled2 jsonb;finance jsonb;report jsonb;stock numeric;BEGIN
r:=public.fnb_upsert_ingredient(p_club_id=>'1a25d386-002f-46c9-8bc9-3b145f18daf7',p_name=>'LOCAL TEST ingredient',p_stock_unit=>'unit',p_purchase_unit=>'unit',p_units_per_purchase=>1);ASSERT NOT(r?'error'),r::text;ing:=(r->>'id')::uuid;
r:=public.fnb_stock_in('1a25d386-002f-46c9-8bc9-3b145f18daf7',ing,100,1000,'289039b8-62ba-416d-8a19-2e059dd34233');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_upsert_menu_item(p_club_id=>'1a25d386-002f-46c9-8bc9-3b145f18daf7',p_name=>'LOCAL TEST menu',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu:=(r->>'id')::uuid;
r:=public.fnb_set_recipe(menu,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;
lines:=jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1));
r:=public.fnb_upsert_menu_item(p_club_id=>'1a25d386-002f-46c9-8bc9-3b145f18daf7',p_name=>'LOCAL TEST menu two',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu2:=(r->>'id')::uuid;r:=public.fnb_set_recipe(menu2,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;lines:=lines||jsonb_build_array(jsonb_build_object('menu_item_id',menu2,'qty',1));
r:=public.fnb_open_shift_v2('1a25d386-002f-46c9-8bc9-3b145f18daf7',0,'7611dab5-49a2-45c8-a990-01fbef7b7ccd','a6a19de0-3334-494a-82de-f78de46cc95c');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_update_settings(p_club_id=>'1a25d386-002f-46c9-8bc9-3b145f18daf7',p_fnb_in_club_net=>true,p_restock_on_shipped_cancel=>false);ASSERT NOT(r?'error'),r::text;
paid:=public.fnb_create_comp_order('1a25d386-002f-46c9-8bc9-3b145f18daf7','counter','LOCAL TEST',NULL,NULL,lines,'LOCAL TEST comp','b5fdd942-9dc9-4e9c-81a9-97be4cddb073');ASSERT NOT(paid?'error'),paid::text;oid:=(paid->>'order_id')::uuid;
r:=public.fnb_mark_paid(oid,'c2a69ad6-f355-42f8-9e84-0fcf2c305787');ASSERT r->>'status'='ok' AND (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'paid replay must not capture again';
r:=public.fnb_create_comp_order('1a25d386-002f-46c9-8bc9-3b145f18daf7','counter','LOCAL TEST',NULL,NULL,lines,'LOCAL TEST comp',(SELECT client_request_id FROM public.fnb_orders WHERE id=oid));ASSERT (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'COMP retry identity';
RESET ROLE;
BEGIN UPDATE floor_private.fnb_paid_line_snapshot_v1 SET qty=qty+1 WHERE order_id=(SELECT id FROM public.fnb_orders WHERE club_id='1a25d386-002f-46c9-8bc9-3b145f18daf7' ORDER BY created_at LIMIT 1);RAISE EXCEPTION 'snapshot mutation unexpectedly allowed';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
SET LOCAL ROLE authenticated;
PERFORM set_config('request.jwt.claim.sub','eec8842d-065d-4d65-a50d-ee7f5eb91817',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"eec8842d-065d-4d65-a50d-ee7f5eb91817"}',true);
BEGIN r:=public.fnb_cancel_order(oid,'LOCAL TEST unauthorized');ASSERT r->>'error'='Forbidden',r::text;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.get_club_finance_summary_v2(current_date,current_date,'1a25d386-002f-46c9-8bc9-3b145f18daf7');RAISE EXCEPTION 'unauthorized finance read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','1a25d386-002f-46c9-8bc9-3b145f18daf7');RAISE EXCEPTION 'unauthorized fnb read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
PERFORM set_config('request.jwt.claim.sub','a6a19de0-3334-494a-82de-f78de46cc95c',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"a6a19de0-3334-494a-82de-f78de46cc95c"}',true);
RESET ROLE;
ASSERT NOT has_table_privilege('authenticated','floor_private.fnb_paid_line_snapshot_v1','SELECT');
ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_cancel_cogs_reversal_v1(uuid,bigint,timestamptz)','EXECUTE');
SET LOCAL ROLE authenticated;
SELECT id INTO line FROM public.fnb_order_items WHERE order_id=oid AND menu_item_id=menu;r:=public.fnb_mark_shipped(oid,line);ASSERT NOT(r?'error'),r::text;
r:=public.fnb_set_recipe(menu2,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',7)));ASSERT NOT(r?'error'),r::text;

cancelled:=public.fnb_cancel_order(oid,'LOCAL TEST refund');ASSERT NOT(cancelled?'error'),cancelled::text;
cancelled2:=public.fnb_cancel_order(oid,'LOCAL TEST replay');ASSERT NOT(cancelled2?'error'),cancelled2::text;
SELECT on_hand INTO stock FROM public.fnb_ingredients WHERE id=ing;
finance:=public.get_club_finance_summary_v2((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'1a25d386-002f-46c9-8bc9-3b145f18daf7');
report:=public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','1a25d386-002f-46c9-8bc9-3b145f18daf7');
PERFORM set_config('local.fnb_refund_case',jsonb_build_object('name','comp_recipe_changed_after_pay','paid',paid,'cancel',cancelled,'replay',cancelled2,'stock',stock,'averageCost',(SELECT avg_unit_cost FROM public.fnb_ingredients WHERE id=ing),'finance',finance,'report',report,'order',(SELECT to_jsonb(o) FROM public.fnb_orders o WHERE id=oid),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at,id) FROM public.fnb_stock_movements m WHERE ref_id=oid))::text,true);
END $case$;SELECT current_setting('local.fnb_refund_case');DO $assert$ DECLARE r jsonb:=current_setting('local.fnb_refund_case')::jsonb;BEGIN ASSERT (r->'finance'->'cost'->>'compCogs')::numeric=2000;ASSERT (r->'report'->>'compCogs')::numeric=2000;ASSERT (r->>'stock')::numeric=98;ASSERT (r->'finance'->'revenue'->>'fnb')::numeric=0;END $assert$;
ROLLBACK;

BEGIN;SET LOCAL lock_timeout='3s';DO $$ BEGIN ASSERT current_database()='vinpoker_owner_ft_reports_20261031';ASSERT current_setting('port')='55441';ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OWNER_FT_REPORTS_20261031_OWNED_LOCAL_TEST';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT NOT(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role');END $$;
\ir ../migrations/20270128000304_fnb_cancel_snapshot_cost_v1.sql
INSERT INTO auth.users(id)VALUES('5470fec2-d901-42ce-bf26-c50e559b90be');INSERT INTO auth.users(id)VALUES('48eabdb3-ed66-40d6-b7ff-0ae982927c96');INSERT INTO public.profiles(user_id,display_name)VALUES('48eabdb3-ed66-40d6-b7ff-0ae982927c96','LOCAL TEST refund owner');INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES('4d5960e1-8265-456b-ad9d-1b917182e3d3','48eabdb3-ed66-40d6-b7ff-0ae982927c96','LOCAL TEST refund regular_return_after_cost_changed','TEST','approved');SET LOCAL request.jwt.claim.sub='48eabdb3-ed66-40d6-b7ff-0ae982927c96';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"48eabdb3-ed66-40d6-b7ff-0ae982927c96"}';SET LOCAL ROLE authenticated;
DO $case$ DECLARE r jsonb;ing uuid;menu uuid;menu2 uuid;oid uuid;line uuid;lines jsonb;paid jsonb;cancelled jsonb;cancelled2 jsonb;finance jsonb;report jsonb;stock numeric;BEGIN
r:=public.fnb_upsert_ingredient(p_club_id=>'4d5960e1-8265-456b-ad9d-1b917182e3d3',p_name=>'LOCAL TEST ingredient',p_stock_unit=>'unit',p_purchase_unit=>'unit',p_units_per_purchase=>1);ASSERT NOT(r?'error'),r::text;ing:=(r->>'id')::uuid;
r:=public.fnb_stock_in('4d5960e1-8265-456b-ad9d-1b917182e3d3',ing,100,1000,'d8ea6323-dc7e-4c00-84fc-3e31ae434ec7');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_upsert_menu_item(p_club_id=>'4d5960e1-8265-456b-ad9d-1b917182e3d3',p_name=>'LOCAL TEST menu',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu:=(r->>'id')::uuid;
r:=public.fnb_set_recipe(menu,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;
lines:=jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1));

r:=public.fnb_open_shift_v2('4d5960e1-8265-456b-ad9d-1b917182e3d3',0,'5c4c2633-e696-4a5c-8e39-d41a83b79a9e','48eabdb3-ed66-40d6-b7ff-0ae982927c96');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_update_settings(p_club_id=>'4d5960e1-8265-456b-ad9d-1b917182e3d3',p_fnb_in_club_net=>true,p_restock_on_shipped_cancel=>false);ASSERT NOT(r?'error'),r::text;
r:=public.fnb_create_order('4d5960e1-8265-456b-ad9d-1b917182e3d3','counter','LOCAL TEST',NULL,NULL,lines,'4394b273-eabd-4033-9f4c-cb14f60d6f28');ASSERT NOT(r?'error'),r::text;oid:=(r->>'order_id')::uuid;IF false THEN
 RESET ROLE;UPDATE public.fnb_orders SET payment_method='bank_transfer' WHERE id=oid AND status='pending' AND paid_at IS NULL;ASSERT FOUND,'fresh pending bank fixture only';SET LOCAL ROLE service_role;
 PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claim.role','service_role',true);PERFORM set_config('request.jwt.claims','{"role":"service_role","sub":""}',true);
 paid:=public.fnb_settle_bank_paid(oid,'4ee26801-17bb-439c-b27b-867d31b816e6');
 RESET ROLE;SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claim.sub','48eabdb3-ed66-40d6-b7ff-0ae982927c96',true);PERFORM set_config('request.jwt.claim.role','authenticated',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"48eabdb3-ed66-40d6-b7ff-0ae982927c96"}',true);
 ELSE paid:=public.fnb_mark_paid(oid,'35a48a89-b96b-4b98-b81a-e9a681c4dcde');END IF;ASSERT NOT(paid?'error'),paid::text;
r:=public.fnb_mark_paid(oid,'8aa1ce61-f580-453d-a651-1f06912e0a61');ASSERT r->>'status'='ok' AND (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'paid replay must not capture again';

RESET ROLE;
BEGIN UPDATE floor_private.fnb_paid_line_snapshot_v1 SET qty=qty+1 WHERE order_id=(SELECT id FROM public.fnb_orders WHERE club_id='4d5960e1-8265-456b-ad9d-1b917182e3d3' ORDER BY created_at LIMIT 1);RAISE EXCEPTION 'snapshot mutation unexpectedly allowed';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
SET LOCAL ROLE authenticated;
PERFORM set_config('request.jwt.claim.sub','5470fec2-d901-42ce-bf26-c50e559b90be',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"5470fec2-d901-42ce-bf26-c50e559b90be"}',true);
BEGIN r:=public.fnb_cancel_order(oid,'LOCAL TEST unauthorized');ASSERT r->>'error'='Forbidden',r::text;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.get_club_finance_summary_v2(current_date,current_date,'4d5960e1-8265-456b-ad9d-1b917182e3d3');RAISE EXCEPTION 'unauthorized finance read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','4d5960e1-8265-456b-ad9d-1b917182e3d3');RAISE EXCEPTION 'unauthorized fnb read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
PERFORM set_config('request.jwt.claim.sub','48eabdb3-ed66-40d6-b7ff-0ae982927c96',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"48eabdb3-ed66-40d6-b7ff-0ae982927c96"}',true);
RESET ROLE;
ASSERT NOT has_table_privilege('authenticated','floor_private.fnb_paid_line_snapshot_v1','SELECT');
ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_cancel_cogs_reversal_v1(uuid,bigint,timestamptz)','EXECUTE');
SET LOCAL ROLE authenticated;


r:=public.fnb_stock_in('4d5960e1-8265-456b-ad9d-1b917182e3d3',ing,100,3000,'eb376088-4744-4a7d-be82-be48d337fe42');ASSERT NOT(r?'error'),r::text;
cancelled:=public.fnb_cancel_order(oid,'LOCAL TEST refund');ASSERT NOT(cancelled?'error'),cancelled::text;
cancelled2:=public.fnb_cancel_order(oid,'LOCAL TEST replay');ASSERT NOT(cancelled2?'error'),cancelled2::text;
SELECT on_hand INTO stock FROM public.fnb_ingredients WHERE id=ing;
finance:=public.get_club_finance_summary_v2((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'4d5960e1-8265-456b-ad9d-1b917182e3d3');
report:=public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','4d5960e1-8265-456b-ad9d-1b917182e3d3');
PERFORM set_config('local.fnb_refund_case',jsonb_build_object('name','regular_return_after_cost_changed','paid',paid,'cancel',cancelled,'replay',cancelled2,'stock',stock,'averageCost',(SELECT avg_unit_cost FROM public.fnb_ingredients WHERE id=ing),'finance',finance,'report',report,'order',(SELECT to_jsonb(o) FROM public.fnb_orders o WHERE id=oid),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at,id) FROM public.fnb_stock_movements m WHERE ref_id=oid))::text,true);
END $case$;SELECT current_setting('local.fnb_refund_case');DO $assert$ DECLARE r jsonb:=current_setting('local.fnb_refund_case')::jsonb;BEGIN ASSERT (r->'finance'->'cost'->>'fnbCogs')::numeric=0;ASSERT (r->'report'->>'cogs')::numeric=0;ASSERT (r->>'stock')::numeric=200;ASSERT (r->'finance'->'revenue'->>'fnb')::numeric=0;ASSERT (SELECT coalesce(sum((x->>'revenue')::numeric),0) FROM jsonb_array_elements(r->'report'->'topItems')x)=0;ASSERT (r->>'averageCost')::numeric=2000;END $assert$;
ROLLBACK;

BEGIN;SET LOCAL lock_timeout='3s';DO $$ BEGIN ASSERT current_database()='vinpoker_owner_ft_reports_20261031';ASSERT current_setting('port')='55441';ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OWNER_FT_REPORTS_20261031_OWNED_LOCAL_TEST';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT NOT(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role');END $$;
\ir ../migrations/20270128000304_fnb_cancel_snapshot_cost_v1.sql
INSERT INTO auth.users(id)VALUES('edd740a6-2967-430e-a329-cdbc8848713e');INSERT INTO auth.users(id)VALUES('353b8649-b3c7-4c3c-be22-0b09ce69d5e2');INSERT INTO public.profiles(user_id,display_name)VALUES('353b8649-b3c7-4c3c-be22-0b09ce69d5e2','LOCAL TEST refund owner');INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES('2bd584ef-755f-4e61-a405-b6a8afc60b88','353b8649-b3c7-4c3c-be22-0b09ce69d5e2','LOCAL TEST refund regular_fractional_partial','TEST','approved');SET LOCAL request.jwt.claim.sub='353b8649-b3c7-4c3c-be22-0b09ce69d5e2';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"353b8649-b3c7-4c3c-be22-0b09ce69d5e2"}';SET LOCAL ROLE authenticated;
DO $case$ DECLARE r jsonb;ing uuid;menu uuid;menu2 uuid;oid uuid;line uuid;lines jsonb;paid jsonb;cancelled jsonb;cancelled2 jsonb;finance jsonb;report jsonb;stock numeric;BEGIN
r:=public.fnb_upsert_ingredient(p_club_id=>'2bd584ef-755f-4e61-a405-b6a8afc60b88',p_name=>'LOCAL TEST ingredient',p_stock_unit=>'unit',p_purchase_unit=>'unit',p_units_per_purchase=>1);ASSERT NOT(r?'error'),r::text;ing:=(r->>'id')::uuid;
r:=public.fnb_stock_in('2bd584ef-755f-4e61-a405-b6a8afc60b88',ing,100,0.25,'9bb9d51c-d362-4a9d-b26a-9dc0bce0e20f');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_upsert_menu_item(p_club_id=>'2bd584ef-755f-4e61-a405-b6a8afc60b88',p_name=>'LOCAL TEST menu',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu:=(r->>'id')::uuid;
r:=public.fnb_set_recipe(menu,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;
lines:=jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1));
r:=public.fnb_upsert_menu_item(p_club_id=>'2bd584ef-755f-4e61-a405-b6a8afc60b88',p_name=>'LOCAL TEST menu two',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu2:=(r->>'id')::uuid;r:=public.fnb_set_recipe(menu2,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;lines:=lines||jsonb_build_array(jsonb_build_object('menu_item_id',menu2,'qty',1));
r:=public.fnb_open_shift_v2('2bd584ef-755f-4e61-a405-b6a8afc60b88',0,'33f0cf84-ed57-4ba7-9e78-8d35a2205eec','353b8649-b3c7-4c3c-be22-0b09ce69d5e2');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_update_settings(p_club_id=>'2bd584ef-755f-4e61-a405-b6a8afc60b88',p_fnb_in_club_net=>true,p_restock_on_shipped_cancel=>false);ASSERT NOT(r?'error'),r::text;
r:=public.fnb_create_order('2bd584ef-755f-4e61-a405-b6a8afc60b88','counter','LOCAL TEST',NULL,NULL,lines,'9c6ecd00-6785-4699-bebd-61e4f1e71432');ASSERT NOT(r?'error'),r::text;oid:=(r->>'order_id')::uuid;IF false THEN
 RESET ROLE;UPDATE public.fnb_orders SET payment_method='bank_transfer' WHERE id=oid AND status='pending' AND paid_at IS NULL;ASSERT FOUND,'fresh pending bank fixture only';SET LOCAL ROLE service_role;
 PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claim.role','service_role',true);PERFORM set_config('request.jwt.claims','{"role":"service_role","sub":""}',true);
 paid:=public.fnb_settle_bank_paid(oid,'739070fa-2ff0-4803-8470-f4b455a5ddfd');
 RESET ROLE;SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claim.sub','353b8649-b3c7-4c3c-be22-0b09ce69d5e2',true);PERFORM set_config('request.jwt.claim.role','authenticated',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"353b8649-b3c7-4c3c-be22-0b09ce69d5e2"}',true);
 ELSE paid:=public.fnb_mark_paid(oid,'52616f6c-b3dc-4b3e-ac10-ba952b1c5f31');END IF;ASSERT NOT(paid?'error'),paid::text;
r:=public.fnb_mark_paid(oid,'d9ac49f5-5e99-483a-9e6f-a9d34b9a216b');ASSERT r->>'status'='ok' AND (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'paid replay must not capture again';

RESET ROLE;
BEGIN UPDATE floor_private.fnb_paid_line_snapshot_v1 SET qty=qty+1 WHERE order_id=(SELECT id FROM public.fnb_orders WHERE club_id='2bd584ef-755f-4e61-a405-b6a8afc60b88' ORDER BY created_at LIMIT 1);RAISE EXCEPTION 'snapshot mutation unexpectedly allowed';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
SET LOCAL ROLE authenticated;
PERFORM set_config('request.jwt.claim.sub','edd740a6-2967-430e-a329-cdbc8848713e',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"edd740a6-2967-430e-a329-cdbc8848713e"}',true);
BEGIN r:=public.fnb_cancel_order(oid,'LOCAL TEST unauthorized');ASSERT r->>'error'='Forbidden',r::text;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.get_club_finance_summary_v2(current_date,current_date,'2bd584ef-755f-4e61-a405-b6a8afc60b88');RAISE EXCEPTION 'unauthorized finance read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','2bd584ef-755f-4e61-a405-b6a8afc60b88');RAISE EXCEPTION 'unauthorized fnb read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
PERFORM set_config('request.jwt.claim.sub','353b8649-b3c7-4c3c-be22-0b09ce69d5e2',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"353b8649-b3c7-4c3c-be22-0b09ce69d5e2"}',true);
RESET ROLE;
ASSERT NOT has_table_privilege('authenticated','floor_private.fnb_paid_line_snapshot_v1','SELECT');
ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_cancel_cogs_reversal_v1(uuid,bigint,timestamptz)','EXECUTE');
SET LOCAL ROLE authenticated;
SELECT id INTO line FROM public.fnb_order_items WHERE order_id=oid AND menu_item_id=menu;r:=public.fnb_mark_shipped(oid,line);ASSERT NOT(r?'error'),r::text;


cancelled:=public.fnb_cancel_order(oid,'LOCAL TEST refund');ASSERT NOT(cancelled?'error'),cancelled::text;
cancelled2:=public.fnb_cancel_order(oid,'LOCAL TEST replay');ASSERT NOT(cancelled2?'error'),cancelled2::text;
SELECT on_hand INTO stock FROM public.fnb_ingredients WHERE id=ing;
finance:=public.get_club_finance_summary_v2((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'2bd584ef-755f-4e61-a405-b6a8afc60b88');
report:=public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','2bd584ef-755f-4e61-a405-b6a8afc60b88');
PERFORM set_config('local.fnb_refund_case',jsonb_build_object('name','regular_fractional_partial','paid',paid,'cancel',cancelled,'replay',cancelled2,'stock',stock,'averageCost',(SELECT avg_unit_cost FROM public.fnb_ingredients WHERE id=ing),'finance',finance,'report',report,'order',(SELECT to_jsonb(o) FROM public.fnb_orders o WHERE id=oid),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at,id) FROM public.fnb_stock_movements m WHERE ref_id=oid))::text,true);
END $case$;SELECT current_setting('local.fnb_refund_case');DO $assert$ DECLARE r jsonb:=current_setting('local.fnb_refund_case')::jsonb;BEGIN ASSERT (r->'finance'->'cost'->>'fnbCogs')::numeric=1;ASSERT (r->'report'->>'cogs')::numeric=1;ASSERT (r->>'stock')::numeric=98;ASSERT (r->'finance'->'revenue'->>'fnb')::numeric=0;ASSERT (SELECT coalesce(sum((x->>'revenue')::numeric),0) FROM jsonb_array_elements(r->'report'->'topItems')x)=0;END $assert$;
ROLLBACK;

BEGIN;SET LOCAL lock_timeout='3s';DO $$ BEGIN ASSERT current_database()='vinpoker_owner_ft_reports_20261031';ASSERT current_setting('port')='55441';ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OWNER_FT_REPORTS_20261031_OWNED_LOCAL_TEST';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT NOT(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role');END $$;
\ir ../migrations/20270128000304_fnb_cancel_snapshot_cost_v1.sql
INSERT INTO auth.users(id)VALUES('76a5a261-eb68-497b-b2b7-76640c8d2339');INSERT INTO auth.users(id)VALUES('9efdf67f-ea6e-4af6-a626-d5fe1dce00d1');INSERT INTO public.profiles(user_id,display_name)VALUES('9efdf67f-ea6e-4af6-a626-d5fe1dce00d1','LOCAL TEST refund owner');INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES('32837894-accd-41b7-8d1e-2defa9cd693f','9efdf67f-ea6e-4af6-a626-d5fe1dce00d1','LOCAL TEST refund comp_fractional_partial','TEST','approved');SET LOCAL request.jwt.claim.sub='9efdf67f-ea6e-4af6-a626-d5fe1dce00d1';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"9efdf67f-ea6e-4af6-a626-d5fe1dce00d1"}';SET LOCAL ROLE authenticated;
DO $case$ DECLARE r jsonb;ing uuid;menu uuid;menu2 uuid;oid uuid;line uuid;lines jsonb;paid jsonb;cancelled jsonb;cancelled2 jsonb;finance jsonb;report jsonb;stock numeric;BEGIN
r:=public.fnb_upsert_ingredient(p_club_id=>'32837894-accd-41b7-8d1e-2defa9cd693f',p_name=>'LOCAL TEST ingredient',p_stock_unit=>'unit',p_purchase_unit=>'unit',p_units_per_purchase=>1);ASSERT NOT(r?'error'),r::text;ing:=(r->>'id')::uuid;
r:=public.fnb_stock_in('32837894-accd-41b7-8d1e-2defa9cd693f',ing,100,0.25,'4dcf20fb-4056-445e-8cd8-b71781620745');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_upsert_menu_item(p_club_id=>'32837894-accd-41b7-8d1e-2defa9cd693f',p_name=>'LOCAL TEST menu',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu:=(r->>'id')::uuid;
r:=public.fnb_set_recipe(menu,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;
lines:=jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1));
r:=public.fnb_upsert_menu_item(p_club_id=>'32837894-accd-41b7-8d1e-2defa9cd693f',p_name=>'LOCAL TEST menu two',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu2:=(r->>'id')::uuid;r:=public.fnb_set_recipe(menu2,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;lines:=lines||jsonb_build_array(jsonb_build_object('menu_item_id',menu2,'qty',1));
r:=public.fnb_open_shift_v2('32837894-accd-41b7-8d1e-2defa9cd693f',0,'17449f7a-3cf7-47c2-9075-2bc86d84e280','9efdf67f-ea6e-4af6-a626-d5fe1dce00d1');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_update_settings(p_club_id=>'32837894-accd-41b7-8d1e-2defa9cd693f',p_fnb_in_club_net=>true,p_restock_on_shipped_cancel=>false);ASSERT NOT(r?'error'),r::text;
paid:=public.fnb_create_comp_order('32837894-accd-41b7-8d1e-2defa9cd693f','counter','LOCAL TEST',NULL,NULL,lines,'LOCAL TEST comp','7ce68a0a-6228-47ef-9cb4-49bf647e9b65');ASSERT NOT(paid?'error'),paid::text;oid:=(paid->>'order_id')::uuid;
r:=public.fnb_mark_paid(oid,'83b44b28-ba06-48fc-abfe-3c62d25c2f31');ASSERT r->>'status'='ok' AND (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'paid replay must not capture again';
r:=public.fnb_create_comp_order('32837894-accd-41b7-8d1e-2defa9cd693f','counter','LOCAL TEST',NULL,NULL,lines,'LOCAL TEST comp',(SELECT client_request_id FROM public.fnb_orders WHERE id=oid));ASSERT (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'COMP retry identity';
RESET ROLE;
BEGIN UPDATE floor_private.fnb_paid_line_snapshot_v1 SET qty=qty+1 WHERE order_id=(SELECT id FROM public.fnb_orders WHERE club_id='32837894-accd-41b7-8d1e-2defa9cd693f' ORDER BY created_at LIMIT 1);RAISE EXCEPTION 'snapshot mutation unexpectedly allowed';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
SET LOCAL ROLE authenticated;
PERFORM set_config('request.jwt.claim.sub','76a5a261-eb68-497b-b2b7-76640c8d2339',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"76a5a261-eb68-497b-b2b7-76640c8d2339"}',true);
BEGIN r:=public.fnb_cancel_order(oid,'LOCAL TEST unauthorized');ASSERT r->>'error'='Forbidden',r::text;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.get_club_finance_summary_v2(current_date,current_date,'32837894-accd-41b7-8d1e-2defa9cd693f');RAISE EXCEPTION 'unauthorized finance read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','32837894-accd-41b7-8d1e-2defa9cd693f');RAISE EXCEPTION 'unauthorized fnb read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
PERFORM set_config('request.jwt.claim.sub','9efdf67f-ea6e-4af6-a626-d5fe1dce00d1',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"9efdf67f-ea6e-4af6-a626-d5fe1dce00d1"}',true);
RESET ROLE;
ASSERT NOT has_table_privilege('authenticated','floor_private.fnb_paid_line_snapshot_v1','SELECT');
ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_cancel_cogs_reversal_v1(uuid,bigint,timestamptz)','EXECUTE');
SET LOCAL ROLE authenticated;
SELECT id INTO line FROM public.fnb_order_items WHERE order_id=oid AND menu_item_id=menu;r:=public.fnb_mark_shipped(oid,line);ASSERT NOT(r?'error'),r::text;


cancelled:=public.fnb_cancel_order(oid,'LOCAL TEST refund');ASSERT NOT(cancelled?'error'),cancelled::text;
cancelled2:=public.fnb_cancel_order(oid,'LOCAL TEST replay');ASSERT NOT(cancelled2?'error'),cancelled2::text;
SELECT on_hand INTO stock FROM public.fnb_ingredients WHERE id=ing;
finance:=public.get_club_finance_summary_v2((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'32837894-accd-41b7-8d1e-2defa9cd693f');
report:=public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','32837894-accd-41b7-8d1e-2defa9cd693f');
PERFORM set_config('local.fnb_refund_case',jsonb_build_object('name','comp_fractional_partial','paid',paid,'cancel',cancelled,'replay',cancelled2,'stock',stock,'averageCost',(SELECT avg_unit_cost FROM public.fnb_ingredients WHERE id=ing),'finance',finance,'report',report,'order',(SELECT to_jsonb(o) FROM public.fnb_orders o WHERE id=oid),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at,id) FROM public.fnb_stock_movements m WHERE ref_id=oid))::text,true);
END $case$;SELECT current_setting('local.fnb_refund_case');DO $assert$ DECLARE r jsonb:=current_setting('local.fnb_refund_case')::jsonb;BEGIN ASSERT (r->'finance'->'cost'->>'compCogs')::numeric=1;ASSERT (r->'report'->>'compCogs')::numeric=1;ASSERT (r->>'stock')::numeric=98;ASSERT (r->'finance'->'revenue'->>'fnb')::numeric=0;END $assert$;
ROLLBACK;

BEGIN;SET LOCAL lock_timeout='3s';DO $$ BEGIN ASSERT current_database()='vinpoker_owner_ft_reports_20261031';ASSERT current_setting('port')='55441';ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OWNER_FT_REPORTS_20261031_OWNED_LOCAL_TEST';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT NOT(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role');END $$;
\ir ../migrations/20270128000304_fnb_cancel_snapshot_cost_v1.sql
INSERT INTO auth.users(id)VALUES('44df9315-b2d4-472d-8995-666a784f26ee');INSERT INTO auth.users(id)VALUES('f3d0f11f-6cf7-47ed-957c-5d8f800a2aea');INSERT INTO public.profiles(user_id,display_name)VALUES('f3d0f11f-6cf7-47ed-957c-5d8f800a2aea','LOCAL TEST refund owner');INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES('02152b70-fbc2-4524-a2c9-d16d0d52ede3','f3d0f11f-6cf7-47ed-957c-5d8f800a2aea','LOCAL TEST refund bank_core_partial_refund','TEST','approved');SET LOCAL request.jwt.claim.sub='f3d0f11f-6cf7-47ed-957c-5d8f800a2aea';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"f3d0f11f-6cf7-47ed-957c-5d8f800a2aea"}';SET LOCAL ROLE authenticated;
DO $case$ DECLARE r jsonb;ing uuid;menu uuid;menu2 uuid;oid uuid;line uuid;lines jsonb;paid jsonb;cancelled jsonb;cancelled2 jsonb;finance jsonb;report jsonb;stock numeric;BEGIN
r:=public.fnb_upsert_ingredient(p_club_id=>'02152b70-fbc2-4524-a2c9-d16d0d52ede3',p_name=>'LOCAL TEST ingredient',p_stock_unit=>'unit',p_purchase_unit=>'unit',p_units_per_purchase=>1);ASSERT NOT(r?'error'),r::text;ing:=(r->>'id')::uuid;
r:=public.fnb_stock_in('02152b70-fbc2-4524-a2c9-d16d0d52ede3',ing,100,1000,'5993ece2-eaa2-456d-962f-927e905e5951');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_upsert_menu_item(p_club_id=>'02152b70-fbc2-4524-a2c9-d16d0d52ede3',p_name=>'LOCAL TEST menu',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu:=(r->>'id')::uuid;
r:=public.fnb_set_recipe(menu,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;
lines:=jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1));
r:=public.fnb_upsert_menu_item(p_club_id=>'02152b70-fbc2-4524-a2c9-d16d0d52ede3',p_name=>'LOCAL TEST menu two',p_price_vnd=>5000,p_tracks_inventory=>true);ASSERT NOT(r?'error'),r::text;menu2:=(r->>'id')::uuid;r:=public.fnb_set_recipe(menu2,jsonb_build_array(jsonb_build_object('ingredient_id',ing,'qty',2)));ASSERT NOT(r?'error'),r::text;lines:=lines||jsonb_build_array(jsonb_build_object('menu_item_id',menu2,'qty',1));
r:=public.fnb_open_shift_v2('02152b70-fbc2-4524-a2c9-d16d0d52ede3',0,'0974951c-e639-4ec1-82eb-76dc563a624a','f3d0f11f-6cf7-47ed-957c-5d8f800a2aea');ASSERT NOT(r?'error'),r::text;
r:=public.fnb_update_settings(p_club_id=>'02152b70-fbc2-4524-a2c9-d16d0d52ede3',p_fnb_in_club_net=>true,p_restock_on_shipped_cancel=>false);ASSERT NOT(r?'error'),r::text;
r:=public.fnb_create_order('02152b70-fbc2-4524-a2c9-d16d0d52ede3','counter','LOCAL TEST',NULL,NULL,lines,'ca69fc76-ba59-47a3-b6cd-0acbf81822e2');ASSERT NOT(r?'error'),r::text;oid:=(r->>'order_id')::uuid;IF true THEN
 RESET ROLE;UPDATE public.fnb_orders SET payment_method='bank_transfer' WHERE id=oid AND status='pending' AND paid_at IS NULL;ASSERT FOUND,'fresh pending bank fixture only';SET LOCAL ROLE service_role;
 PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claim.role','service_role',true);PERFORM set_config('request.jwt.claims','{"role":"service_role","sub":""}',true);
 paid:=public.fnb_settle_bank_paid(oid,'b7ae72d4-ffa8-4ced-af58-0b977f0e7515');
 RESET ROLE;SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claim.sub','f3d0f11f-6cf7-47ed-957c-5d8f800a2aea',true);PERFORM set_config('request.jwt.claim.role','authenticated',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"f3d0f11f-6cf7-47ed-957c-5d8f800a2aea"}',true);
 ELSE paid:=public.fnb_mark_paid(oid,'4ef15bed-22fa-43b0-89cb-cc286a39c8dc');END IF;ASSERT NOT(paid?'error'),paid::text;
r:=public.fnb_mark_paid(oid,'cd51ad28-5809-4a30-9e1e-08e6e6c52b11');ASSERT r->>'status'='ok' AND (r->>'idempotent')::boolean AND (r->>'order_id')::uuid=oid,'paid replay must not capture again';

RESET ROLE;
BEGIN UPDATE floor_private.fnb_paid_line_snapshot_v1 SET qty=qty+1 WHERE order_id=(SELECT id FROM public.fnb_orders WHERE club_id='02152b70-fbc2-4524-a2c9-d16d0d52ede3' ORDER BY created_at LIMIT 1);RAISE EXCEPTION 'snapshot mutation unexpectedly allowed';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
SET LOCAL ROLE authenticated;
PERFORM set_config('request.jwt.claim.sub','44df9315-b2d4-472d-8995-666a784f26ee',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"44df9315-b2d4-472d-8995-666a784f26ee"}',true);
BEGIN r:=public.fnb_cancel_order(oid,'LOCAL TEST unauthorized');ASSERT r->>'error'='Forbidden',r::text;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.get_club_finance_summary_v2(current_date,current_date,'02152b70-fbc2-4524-a2c9-d16d0d52ede3');RAISE EXCEPTION 'unauthorized finance read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','02152b70-fbc2-4524-a2c9-d16d0d52ede3');RAISE EXCEPTION 'unauthorized fnb read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
PERFORM set_config('request.jwt.claim.sub','f3d0f11f-6cf7-47ed-957c-5d8f800a2aea',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"f3d0f11f-6cf7-47ed-957c-5d8f800a2aea"}',true);
RESET ROLE;
ASSERT NOT has_table_privilege('authenticated','floor_private.fnb_paid_line_snapshot_v1','SELECT');
ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_cancel_cogs_reversal_v1(uuid,bigint,timestamptz)','EXECUTE');
SET LOCAL ROLE authenticated;
SELECT id INTO line FROM public.fnb_order_items WHERE order_id=oid AND menu_item_id=menu;r:=public.fnb_mark_shipped(oid,line);ASSERT NOT(r?'error'),r::text;


cancelled:=public.fnb_cancel_order(oid,'LOCAL TEST refund');ASSERT NOT(cancelled?'error'),cancelled::text;
cancelled2:=public.fnb_cancel_order(oid,'LOCAL TEST replay');ASSERT NOT(cancelled2?'error'),cancelled2::text;
SELECT on_hand INTO stock FROM public.fnb_ingredients WHERE id=ing;
finance:=public.get_club_finance_summary_v2((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'02152b70-fbc2-4524-a2c9-d16d0d52ede3');
report:=public.fnb_get_report(transaction_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','02152b70-fbc2-4524-a2c9-d16d0d52ede3');
PERFORM set_config('local.fnb_refund_case',jsonb_build_object('name','bank_core_partial_refund','paid',paid,'cancel',cancelled,'replay',cancelled2,'stock',stock,'averageCost',(SELECT avg_unit_cost FROM public.fnb_ingredients WHERE id=ing),'finance',finance,'report',report,'order',(SELECT to_jsonb(o) FROM public.fnb_orders o WHERE id=oid),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at,id) FROM public.fnb_stock_movements m WHERE ref_id=oid))::text,true);
END $case$;SELECT current_setting('local.fnb_refund_case');DO $assert$ DECLARE r jsonb:=current_setting('local.fnb_refund_case')::jsonb;BEGIN ASSERT (r->'finance'->'cost'->>'fnbCogs')::numeric=2000;ASSERT (r->'report'->>'cogs')::numeric=2000;ASSERT (r->>'stock')::numeric=98;ASSERT (r->'finance'->'revenue'->>'fnb')::numeric=0;ASSERT (SELECT coalesce(sum((x->>'revenue')::numeric),0) FROM jsonb_array_elements(r->'report'->'topItems')x)=0;ASSERT r->'order'->>'payment_method'='bank_transfer';END $assert$;
ROLLBACK;