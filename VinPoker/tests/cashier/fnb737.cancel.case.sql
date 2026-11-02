DECLARE normal_key text:=gen_random_uuid()::text;comp_key text:=gen_random_uuid()::text;
 normal_payload jsonb;comp_payload jsonb;response jsonb;created jsonb;before_fence jsonb;
 comp_menu uuid:=gen_random_uuid();ingredient uuid:=gen_random_uuid();comp_lines jsonb;committed_key text;partial_key text:=gen_random_uuid()::text;
BEGIN
 INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost) VALUES(ingredient,club,'LOCAL737 cancel ingredient','unit',10,1000);
 INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES(comp_menu,club,'LOCAL737 cancel item',5000,true,true);
 INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty) VALUES(club,comp_menu,ingredient,2);
 comp_lines:=jsonb_build_array(jsonb_build_object('menu_item_id',comp_menu,'qty',1));
 normal_payload:=jsonb_build_object('source','counter','table',NULL,'customer','LOCAL737 normal','note',NULL,'lines',lines,'table_ref',NULL,'player_ref',NULL);
 comp_payload:=jsonb_build_object('source','counter','table',NULL,'customer','LOCAL737 comp','note',NULL,'lines',comp_lines,'reason','LOCAL737 original reason');
 PERFORM set_config('role','authenticated',true);
 BEGIN
  PERFORM public.fnb_cancel_create_intent_v1(club,normal_key,cashier,'order',normal_payload);RAISE EXCEPTION 'actor mismatch accepted';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='FNB_CREATE_ACTOR_MISMATCH',SQLERRM;END;
 BEGIN
  PERFORM public.fnb_cancel_create_intent_v1('349ecf35-50ba-4c71-a581-15dc45f1cd01',normal_key,actor,'order',normal_payload);RAISE EXCEPTION 'cross club cancel accepted';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Forbidden',SQLERRM;END;
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN
  PERFORM public.fnb_cancel_create_intent_v1(club,normal_key,actor,'order',normal_payload);RAISE EXCEPTION 'anonymous cancel accepted';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Unauthorized',SQLERRM;END;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 BEGIN
  PERFORM public.fnb_cancel_create_intent_v1(club,normal_key,actor,'order','{}');RAISE EXCEPTION 'malformed cancellation accepted';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='INVALID_REQUEST_ID_OR_PAYLOAD',SQLERRM;END;
 response:=public.fnb_cancel_create_intent_v1(club,normal_key,actor,'order',normal_payload);
 ASSERT response->>'status'='cancelled' AND response->'intent'=normal_payload AND response->>'operation'='order';
 ASSERT public.fnb_cancel_create_intent_v1(club,normal_key,actor,'order',normal_payload)=response;
 ASSERT public.fnb_create_order(club,'counter',NULL,'LOCAL737 normal',NULL,lines,normal_key,NULL,NULL)->>'error'='REQUEST_ID_CONFLICT';
 BEGIN
  PERFORM public.fnb_cancel_create_intent_v1(club,normal_key,actor,'order',normal_payload||'{"customer":"changed"}');RAISE EXCEPTION 'changed cancel accepted';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='REQUEST_ID_CONFLICT',SQLERRM;END;
 PERFORM set_config('request.jwt.claim.sub',cashier::text,true);
 BEGIN
  PERFORM public.fnb_cancel_create_intent_v1(club,normal_key,cashier,'order',normal_payload);RAISE EXCEPTION 'other actor cancel accepted';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='REQUEST_ID_CONFLICT',SQLERRM;END;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 response:=public.fnb_cancel_create_intent_v1(club,comp_key,actor,'comp',comp_payload);
 ASSERT response->>'status'='cancelled' AND response->'intent'=comp_payload;
 ASSERT public.fnb_create_comp_order(club,'counter',NULL,'LOCAL737 comp',NULL,comp_lines,'LOCAL737 original reason',comp_key)->>'error'='REQUEST_ID_CONFLICT';
 PERFORM set_config('role','postgres',true);
 ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_orders WHERE club_id=club AND client_request_id IN(normal_key,comp_key));
 ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_create_intents_v1 i WHERE i.club_id=club AND i.request_id IN(normal_key,comp_key));
 ASSERT (SELECT on_hand=10 FROM public.fnb_ingredients WHERE id=ingredient);
 SELECT to_jsonb(f) INTO before_fence FROM floor_private.fnb_create_cancel_fences_v1 f WHERE f.club_id=club AND f.request_id=normal_key;
 -- A bound-but-orderless intent is kept immutable when fenced.
 INSERT INTO public.fnb_create_intents_v1(club_id,request_id,actor_id,operation,payload) VALUES(club,partial_key,actor,'order',normal_payload);
 PERFORM set_config('role','authenticated',true);
 ASSERT public.fnb_cancel_create_intent_v1(club,partial_key,actor,'order',normal_payload)->>'status'='cancelled';
 ASSERT public.fnb_create_order(club,'counter',NULL,'LOCAL737 normal',NULL,lines,partial_key,NULL,NULL)->>'error'='REQUEST_ID_CONFLICT';
 committed_key:=gen_random_uuid()::text;
 created:=public.fnb_create_order(club,'counter',NULL,'LOCAL737 normal',NULL,lines,committed_key,NULL,NULL);
 ASSERT created->>'status'='ok';
 response:=public.fnb_cancel_create_intent_v1(club,committed_key,actor,'order',normal_payload);
 ASSERT response->>'status'='found' AND response->'order'->>'id'=created->>'order_id' AND response->'order'->>'status'='pending';
 committed_key:=gen_random_uuid()::text;
 created:=public.fnb_create_comp_order(club,'counter',NULL,'LOCAL737 comp',NULL,comp_lines,'LOCAL737 original reason',committed_key);
 ASSERT created->>'status'='ok' AND created->>'is_comp'='true';
 response:=public.fnb_cancel_create_intent_v1(club,committed_key,actor,'comp',comp_payload);
 ASSERT response->>'status'='found' AND response->'order'->>'id'=created->>'order_id' AND response->'order'->>'status'='paid';
 PERFORM set_config('role','postgres',true);
 ASSERT (SELECT on_hand=8 FROM public.fnb_ingredients WHERE id=ingredient);
 ASSERT (SELECT count(*)=1 AND sum(delta)=-2 FROM public.fnb_stock_movements WHERE ingredient_id=ingredient);
 ASSERT (SELECT to_jsonb(f)=before_fence FROM floor_private.fnb_create_cancel_fences_v1 f WHERE f.club_id=club AND f.request_id=normal_key);
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.fnb_create_cancel_fences_v1 f WHERE f.club_id=club AND f.request_id=committed_key);
 ASSERT (SELECT count(*)=1 AND bool_and(i.payload=normal_payload) FROM public.fnb_create_intents_v1 i WHERE i.club_id=club AND i.request_id=partial_key);
 ASSERT NOT has_table_privilege('authenticated','floor_private.fnb_create_cancel_fences_v1','SELECT');
 ASSERT NOT has_table_privilege('service_role','floor_private.fnb_create_cancel_fences_v1','INSERT');
 ASSERT NOT has_function_privilege('authenticated','public._fnb_bind_create_intent_v1(uuid,uuid,text,text,jsonb)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.fnb_cancel_create_intent_v1(uuid,text,uuid,text,jsonb)','EXECUTE');
 RAISE NOTICE 'FNB737_CANCEL_BEFORE_CREATE_BOTH_OPS_COMMITTED_ORDER_NOT_UNDONE_PAYLOAD_ACTOR_CONFLICT_PARTIAL_AUDIT_STOCK_ACL_PASS';
END;
