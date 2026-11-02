DECLARE receipt jsonb; legacy_key text:=gen_random_uuid()::text; uncommitted_key text:=gen_random_uuid()::text;
 comp_key text:=gen_random_uuid()::text; comp_result jsonb;
BEGIN
 PERFORM set_config('role','authenticated',true);
 receipt:=public.fnb_get_create_receipt_v1(club,request_id,actor);
 ASSERT receipt->>'status'='found' AND receipt->>'actor_id'=actor::text AND receipt->>'club_id'=club::text AND receipt->>'request_id'=request_id;
 ASSERT receipt->>'operation'='order' AND receipt->'order'->>'id'=v_order_id::text AND receipt->'order'->>'status'='pending';
 ASSERT receipt->'order'->>'subtotal_vnd'='5000' AND receipt->'order'->>'is_comp'='false';
 ASSERT receipt->'intent'=jsonb_build_object('source','counter','table',NULL,'customer','LOCAL734 customer','note',NULL,
  'lines',lines,'table_ref',physical,'player_ref',actor);
 comp_result:=public.fnb_create_comp_order(club,'counter',NULL,'LOCAL735 receipt comp',NULL,lines,'LOCAL TEST',comp_key);
 ASSERT comp_result->>'status'='ok' AND comp_result->>'is_comp'='true';
 receipt:=public.fnb_get_create_receipt_v1(club,comp_key,actor);
 ASSERT receipt->>'status'='found' AND receipt->>'operation'='comp' AND receipt->'order'->>'is_comp'='true';
 ASSERT receipt->'order'->>'id'=comp_result->>'order_id' AND receipt->'order'->>'status'='paid';
 ASSERT receipt->'intent'=jsonb_build_object('source','counter','table',NULL,'customer','LOCAL735 receipt comp','note',NULL,'lines',lines,'reason','LOCAL TEST');
 ASSERT public.fnb_get_create_receipt_v1(club,'missing-receipt',actor)->>'status'='not_found';
 BEGIN
  PERFORM public.fnb_get_create_receipt_v1(club,request_id,cashier);RAISE EXCEPTION 'wrong actor accepted';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='FNB_CREATE_ACTOR_MISMATCH',SQLERRM;END;
 PERFORM set_config('request.jwt.claim.sub',cashier::text,true);
 receipt:=public.fnb_get_create_receipt_v1(club,request_id,cashier);
 ASSERT receipt->>'status'='not_found' AND NOT(receipt?'intent') AND NOT(receipt?'order'),'other actor receipt leaked';
 BEGIN
  PERFORM public.fnb_get_create_receipt_v1('349ecf35-50ba-4c71-a581-15dc45f1cd01',request_id,cashier);RAISE EXCEPTION 'cross club accepted';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Forbidden',SQLERRM;END;
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN
  PERFORM public.fnb_get_create_receipt_v1(club,request_id,actor);RAISE EXCEPTION 'anonymous accepted';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Unauthorized',SQLERRM;END;
 PERFORM set_config('role','postgres',true);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 -- Historical shape with no original payload is not adopted as a verified receipt.
 INSERT INTO public.fnb_orders(club_id,status,source,created_by,client_request_id,subtotal_vnd)
 VALUES(club,'pending','counter',actor,legacy_key,0);
 ASSERT public.fnb_get_create_receipt_v1(club,legacy_key,actor)->>'status'='legacy_unverified';
 INSERT INTO public.fnb_create_intents_v1(club_id,request_id,actor_id,operation,payload)
 VALUES(club,uncommitted_key,actor,'order','{}');
 receipt:=public.fnb_get_create_receipt_v1(club,uncommitted_key,actor);
 ASSERT receipt->>'status'='unresolved' AND receipt->'order'='null'::jsonb;
 ASSERT NOT has_function_privilege('anon','public.fnb_get_create_receipt_v1(uuid,text,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.fnb_get_create_receipt_v1(uuid,text,uuid)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.fnb_get_create_receipt_v1(uuid,text,uuid)','EXECUTE');
 ASSERT (SELECT proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.fnb_get_create_receipt_v1(uuid,text,uuid)'::regprocedure);
 RAISE NOTICE 'FNB735_ACTUAL_CREATE_RECEIPT_PAYLOAD_ACTOR_CLUB_LEGACY_UNRESOLVED_AUTH_ACL_PASS';
END;
