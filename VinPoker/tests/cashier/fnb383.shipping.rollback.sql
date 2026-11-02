\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'fnb383_local_only';END IF;
 IF NOT public.is_club_owner('a364de8e-06b1-4428-a20d-ac614ec406e5','349ecf35-50ba-4c71-a581-15dc45f1cd01') THEN RAISE EXCEPTION 'fnb383_retained_owner_required';END IF;
END $$;
DO $$ DECLARE menu1 uuid:=gen_random_uuid();menu2 uuid:=gen_random_uuid();ingredient uuid:=gen_random_uuid();BEGIN
 INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost) VALUES(ingredient,'349ecf35-50ba-4c71-a581-15dc45f1cd01','LOCAL383 rollback ingredient','unit',10,1000);
 INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,tracks_inventory) VALUES(menu1,'349ecf35-50ba-4c71-a581-15dc45f1cd01','LOCAL383 first',5000,true),(menu2,'349ecf35-50ba-4c71-a581-15dc45f1cd01','LOCAL383 second',6000,true);
 INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty) VALUES('349ecf35-50ba-4c71-a581-15dc45f1cd01',menu1,ingredient,2),('349ecf35-50ba-4c71-a581-15dc45f1cd01',menu2,ingredient,1);
 PERFORM set_config('test383.menu1',menu1::text,true);PERFORM set_config('test383.menu2',menu2::text,true);PERFORM set_config('test383.ingredient',ingredient::text,true);
END $$;
SET LOCAL request.jwt.claim.sub='a364de8e-06b1-4428-a20d-ac614ec406e5';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL ROLE authenticated;
DO $$ DECLARE answer jsonb;v_order uuid;line1 uuid;line2 uuid;events_before int;facts jsonb;stock numeric;BEGIN
 answer:=public.fnb_create_order('349ecf35-50ba-4c71-a581-15dc45f1cd01','counter',NULL,NULL,NULL,jsonb_build_array(jsonb_build_object('menu_item_id',current_setting('test383.menu1')::uuid,'qty',1),jsonb_build_object('menu_item_id',current_setting('test383.menu2')::uuid,'qty',1)),gen_random_uuid()::text);
 ASSERT answer->>'status'='ok',answer::text;v_order:=(answer->>'order_id')::uuid;
 SELECT id INTO STRICT line1 FROM public.fnb_order_items WHERE order_id=v_order AND menu_item_id=current_setting('test383.menu1')::uuid;
 SELECT id INTO STRICT line2 FROM public.fnb_order_items WHERE order_id=v_order AND menu_item_id=current_setting('test383.menu2')::uuid;
 answer:=public.fnb_mark_shipped(v_order,line1);ASSERT answer->>'error'='BAD_STATE','unpaid shipping accepted';
 answer:=public.fnb_mark_paid(v_order);ASSERT answer->>'status'='ok',answer::text;
 SELECT on_hand INTO stock FROM public.fnb_ingredients WHERE id=current_setting('test383.ingredient')::uuid;ASSERT stock=7,'payment should consume exactly3 ingredient units';
 SELECT count(*) INTO events_before FROM public.fnb_order_events WHERE order_id=v_order;
 answer:=public.fnb_mark_shipped(v_order,gen_random_uuid());
 ASSERT answer->>'error'='LINE_NOT_FOUND','FNB383_UNKNOWN_LINE_REPORTED_SUCCESS: '||answer::text;
 ASSERT (SELECT count(*) FROM public.fnb_order_events WHERE order_id=v_order)=events_before,'unknown line added audit event';
 answer:=public.fnb_mark_shipped(v_order,line1);ASSERT answer->>'status'='ok' AND (answer->>'all_shipped')::boolean=false,answer::text;
 ASSERT (SELECT status FROM public.fnb_orders WHERE id=v_order)='paid','partial ship prematurely completed order';
 SELECT jsonb_build_object('order',(SELECT to_jsonb(o) FROM public.fnb_orders o WHERE id=v_order),'lines',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.fnb_order_items i WHERE i.order_id=v_order),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.fnb_order_events e WHERE e.order_id=v_order)) INTO facts;
 answer:=public.fnb_mark_shipped(v_order,line1);ASSERT answer->>'status'='ok' AND (answer->>'idempotent')::boolean,answer::text;
 ASSERT facts=(SELECT jsonb_build_object('order',(SELECT to_jsonb(o) FROM public.fnb_orders o WHERE id=v_order),'lines',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.fnb_order_items i WHERE i.order_id=v_order),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.fnb_order_events e WHERE e.order_id=v_order))),'line replay changed row/audit';
 answer:=public.fnb_mark_shipped(v_order,NULL);ASSERT answer->>'status'='ok' AND (answer->>'all_shipped')::boolean,answer::text;
 ASSERT (SELECT status FROM public.fnb_orders WHERE id=v_order)='shipped';
 SELECT count(*) INTO events_before FROM public.fnb_order_events WHERE order_id=v_order;
 answer:=public.fnb_mark_shipped(v_order,NULL);ASSERT answer->>'status'='ok' AND (answer->>'idempotent')::boolean,answer::text;
 ASSERT (SELECT count(*) FROM public.fnb_order_events WHERE order_id=v_order)=events_before,'whole-order replay duplicated audit';
 ASSERT (SELECT count(*) FROM public.fnb_order_events WHERE order_id=v_order AND action='shipped')=1,'completion transition duplicated';
 ASSERT (SELECT on_hand FROM public.fnb_ingredients WHERE id=current_setting('test383.ingredient')::uuid)=7,'shipping consumed stock again';
 ASSERT NOT public.is_club_owner('f660754c-ff8a-400e-a819-9679048d005f','349ecf35-50ba-4c71-a581-15dc45f1cd01')
   AND NOT public.is_club_fnb('f660754c-ff8a-400e-a819-9679048d005f','349ecf35-50ba-4c71-a581-15dc45f1cd01'),'outsider fixture gained authority';
 PERFORM set_config('request.jwt.claim.sub','f660754c-ff8a-400e-a819-9679048d005f',true);
 answer:=public.fnb_mark_shipped(v_order,NULL);ASSERT answer->>'error'='Forbidden','outsider shipping accepted';
 PERFORM set_config('request.jwt.claim.sub','a364de8e-06b1-4428-a20d-ac614ec406e5',true);
 ASSERT (SELECT count(*) FROM public.fnb_order_events WHERE order_id=v_order)=events_before,'outsider changed audit';
 PERFORM set_config('request.jwt.claim.sub','',true);
 answer:=public.fnb_mark_shipped(v_order,NULL);ASSERT answer->>'error'='Unauthorized','missing actor shipping accepted';
 PERFORM set_config('request.jwt.claim.sub','a364de8e-06b1-4428-a20d-ac614ec406e5',true);
 ASSERT (SELECT count(*) FROM public.fnb_order_events WHERE order_id=v_order)=events_before,'missing actor changed audit';
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('anon','public.fnb_mark_shipped(uuid,uuid)','EXECUTE') OR NOT has_function_privilege('authenticated','public.fnb_mark_shipped(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'fnb383_acl_drift';END IF;
END $$;
SELECT 'FNB383_SOURCE_MD5='||md5(prosrc) FROM pg_proc WHERE oid='public.fnb_mark_shipped(uuid,uuid)'::regprocedure;
SELECT 'FNB383_PENDING_DENIED_UNKNOWN_LINE_DENIED_PARTIAL_REPLAY_COMPLETE_REPLAY_STOCK_PASS';
ROLLBACK;
