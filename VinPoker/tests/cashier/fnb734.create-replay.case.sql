-- Injected at the verified733 fixture's pre-missing-entry seam, inside its outer rollback DO.
DECLARE menu uuid:=gen_random_uuid(); request_id text:=gen_random_uuid()::text;
 first_result jsonb; replay jsonb; v_order_id uuid; lines jsonb;
BEGIN
 INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory)
 VALUES(menu,club,'LOCAL734 replay item',5000,true,false);
 lines:=jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1));
 PERFORM set_config('role','authenticated',true);
 first_result:=public.fnb_create_order(club,'counter',NULL,'LOCAL734 customer',NULL,lines,request_id,physical,actor);
 ASSERT first_result->>'status'='ok';v_order_id:=(first_result->>'order_id')::uuid;
 PERFORM set_config('role','postgres',true);
 UPDATE public.tournament_seats SET is_active=false WHERE id=seat;
 PERFORM set_config('role','authenticated',true);
 -- This is recovery of the original committed intent, not a new location/order decision.
 replay:=public.fnb_create_order(club,'counter',NULL,'LOCAL734 customer',NULL,lines,request_id,physical,actor);
 ASSERT replay->>'status'='ok' AND replay->>'order_id'=v_order_id::text AND replay->>'idempotent'='true',
  'FNB734 committed create receipt must survive player leaving the seat';
 ASSERT public.fnb_create_order(club,'counter',NULL,'changed customer',NULL,lines,request_id,physical,actor)->>'error'='REQUEST_ID_CONFLICT';
 PERFORM set_config('request.jwt.claim.sub',cashier::text,true);
 ASSERT public.fnb_create_order(club,'counter',NULL,'LOCAL734 customer',NULL,lines,request_id,physical,actor)->>'error'='REQUEST_ID_CONFLICT';
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 BEGIN
  PERFORM public.fnb_create_order(club,'counter',NULL,NULL,NULL,lines,gen_random_uuid()::text,physical,actor);
  RAISE EXCEPTION 'new order accepted departed player';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='INVALID_PLAYER_REF',SQLERRM; END;
 PERFORM set_config('role','postgres',true);
 ASSERT (SELECT count(*)=1 FROM public.fnb_orders WHERE club_id=club);
 ASSERT (SELECT count(*)=1 FROM public.fnb_create_intents_v1 WHERE club_id=club);
 ASSERT (SELECT status='pending' AND subtotal_vnd=5000 AND table_ref=physical AND player_ref=actor FROM public.fnb_orders WHERE id=v_order_id);
 ASSERT (SELECT count(*)=1 FROM public.fnb_order_events e WHERE e.order_id=v_order_id);
 ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_stock_movements WHERE club_id=club);
 UPDATE public.tournament_seats SET is_active=true WHERE id=seat;
 RAISE NOTICE 'FNB734_COMMITTED_REPLAY_AFTER_DEPARTURE_PAYLOAD_ACTOR_CONFLICT_NEW_REF_DENIED_ONE_PENDING_NO_PAYMENT_PASS';
END;
