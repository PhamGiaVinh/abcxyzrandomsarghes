\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'fnb384_local_only';END IF;
 IF to_regclass('floor_private.fnb384_fixture') IS NOT NULL THEN RAISE EXCEPTION 'fnb384_existing_fixture_never_reseed';END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.fnb_mark_shipped(uuid,uuid)'::regprocedure)<>'31b85897c490845913ab864bdfd5320c' THEN RAISE EXCEPTION 'fnb384_shipping_not_installed';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='a5af353d-2d97-4891-9078-0bc84b7a8237' AND club_id='349ecf35-50ba-4c71-a581-15dc45f1cd01' AND name='Cash identity local TEST') THEN RAISE EXCEPTION 'fnb384_exact_test_scope_missing';END IF;
END $$;
DO $$ DECLARE m1 uuid:=gen_random_uuid();m2 uuid:=gen_random_uuid();ingredient uuid:=gen_random_uuid();BEGIN
 INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost) VALUES(ingredient,'349ecf35-50ba-4c71-a581-15dc45f1cd01','FNB384 retained TEST ingredient','unit',10,1000);
 INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,tracks_inventory) VALUES(m1,'349ecf35-50ba-4c71-a581-15dc45f1cd01','FNB384 TEST first',5000,true),(m2,'349ecf35-50ba-4c71-a581-15dc45f1cd01','FNB384 TEST second',6000,true);
 INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty) VALUES('349ecf35-50ba-4c71-a581-15dc45f1cd01',m1,ingredient,2),('349ecf35-50ba-4c71-a581-15dc45f1cd01',m2,ingredient,1);
 PERFORM set_config('test384.menu1',m1::text,true);PERFORM set_config('test384.menu2',m2::text,true);PERFORM set_config('test384.ingredient',ingredient::text,true);
END $$;
SET LOCAL request.jwt.claim.sub='a364de8e-06b1-4428-a20d-ac614ec406e5';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL ROLE authenticated;
DO $$ DECLARE answer jsonb;v_order uuid;BEGIN
 answer:=public.fnb_create_order('349ecf35-50ba-4c71-a581-15dc45f1cd01','counter','FNB384 local TEST',NULL,NULL,jsonb_build_array(jsonb_build_object('menu_item_id',current_setting('test384.menu1')::uuid,'qty',1),jsonb_build_object('menu_item_id',current_setting('test384.menu2')::uuid,'qty',1)),gen_random_uuid()::text);
 ASSERT answer->>'status'='ok',answer::text;v_order:=(answer->>'order_id')::uuid;
 answer:=public.fnb_mark_paid(v_order);ASSERT answer->>'status'='ok',answer::text;
 ASSERT (SELECT on_hand FROM public.fnb_ingredients WHERE id=current_setting('test384.ingredient')::uuid)=7;
 PERFORM set_config('test384.order',v_order::text,true);
END $$;
RESET ROLE;
CREATE TABLE floor_private.fnb384_fixture(fixture jsonb NOT NULL);
ALTER TABLE floor_private.fnb384_fixture ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.fnb384_fixture FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO floor_private.fnb384_fixture SELECT jsonb_build_object('actor','a364de8e-06b1-4428-a20d-ac614ec406e5','club','349ecf35-50ba-4c71-a581-15dc45f1cd01','tour','a5af353d-2d97-4891-9078-0bc84b7a8237','order',current_setting('test384.order'),'ingredient',current_setting('test384.ingredient'),'lines',(SELECT jsonb_agg(id ORDER BY menu_item_id=current_setting('test384.menu2')::uuid) FROM public.fnb_order_items WHERE order_id=current_setting('test384.order')::uuid));
COMMIT;
