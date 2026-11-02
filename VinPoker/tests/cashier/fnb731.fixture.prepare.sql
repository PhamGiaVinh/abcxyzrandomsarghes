\set ON_ERROR_STOP on
BEGIN;
DO $$ DECLARE f jsonb;menu uuid:=gen_random_uuid();ingredient uuid:=gen_random_uuid();BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT to_regclass('floor_private.fnb731_browser_fixture') IS NULL,'constructor consumed; never reset';
 ASSERT (SELECT count(*)=5 FROM floor_private.fnb_shift_release_backup731);
 ASSERT md5(pg_get_functiondef('public.fnb_create_comp_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,text)'::regprocedure))='5e92d765ed352629a05eb98092d0b64d';
 SELECT fixture INTO STRICT f FROM floor_private.fnb384_fixture;
 ASSERT f->>'club'='349ecf35-50ba-4c71-a581-15dc45f1cd01' AND f->>'actor'='a364de8e-06b1-4428-a20d-ac614ec406e5';
 ASSERT public.is_club_owner((f->>'actor')::uuid,(f->>'club')::uuid);
 INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost) VALUES(ingredient,(f->>'club')::uuid,'LOCAL731 ingredient TEST','unit',20,1000);
 INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory,sort_order) VALUES(menu,(f->>'club')::uuid,'LOCAL731 · Nước TEST',5000,true,true,-731);
 INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty) VALUES((f->>'club')::uuid,menu,ingredient,2);
 CREATE TABLE floor_private.fnb731_browser_fixture(fixture jsonb NOT NULL);
 ALTER TABLE floor_private.fnb731_browser_fixture ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON floor_private.fnb731_browser_fixture FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.fnb731_browser_fixture VALUES(jsonb_build_object('test_only',true,'club',f->>'club','actor',f->>'actor','tour',f->>'tour',
  'menu',menu,'ingredient',ingredient,'state','prepared','requests','[]'::jsonb));
END $$;
COMMIT;
SELECT 'FNB731_MENU_RECIPE_STOCK_METADATA_PREPARED_NO_ORDER_OR_SHIFT_WRITE';
