DO $$ <<case725>> DECLARE actor uuid:=gen_random_uuid();cashier uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();club uuid:=gen_random_uuid();menu uuid:=gen_random_uuid();
 response jsonb;first_result jsonb;closed jsonb;shift_id uuid;order_id uuid;
BEGIN
 INSERT INTO auth.users(id) VALUES(actor),(cashier),(outsider);
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES(club,actor,'LOCAL725 intent rollback TEST','TEST','approved');
 INSERT INTO public.club_fnb_staff(club_id,user_id,kind) VALUES(club,cashier,'cashier');
 INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES(menu,club,'LOCAL725 item',5000,true,false);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);PERFORM set_config('role','authenticated',true);
 response:=public.fnb_get_shift_intent_v1(club,'not-sent',actor);
 ASSERT response->>'status'='not_found' AND response->>'actor_id'=actor::text AND response->>'club_id'=club::text;
 BEGIN
  PERFORM public.fnb_open_shift(club,0,'legacy');RAISE EXCEPTION 'legacy open bypass';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='FNB_SHIFT_REQUEST_CONTEXT_REQUIRED',SQLERRM;END;
 BEGIN
  PERFORM public.fnb_open_shift_v2(club,0,'wrong-actor',cashier);RAISE EXCEPTION 'wrong actor accepted';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='FNB_SHIFT_ACTOR_MISMATCH',SQLERRM;END;
 response:=public.fnb_cancel_shift_intent_v1(club,'open',NULL,1000,NULL,'cancel-open',actor);
 ASSERT response->>'status'='cancelled' AND response->>'request_id'='cancel-open';
 response:=public.fnb_open_shift_v2(club,1000,'cancel-open',actor);ASSERT response->>'status'='cancelled';
 response:=public.fnb_get_shift_intent_v1(club,'cancel-open',actor);
 ASSERT response->>'status'='found' AND response->'result'->>'status'='cancelled' AND response->'intent'->>'float'='1000';
 response:=public.fnb_open_shift_v2(club,2000,'cancel-open',actor);ASSERT response->>'error'='REQUEST_ID_CONFLICT';
 BEGIN
  PERFORM public.fnb_cancel_shift_intent_v1(club,'open',NULL,2000,NULL,'cancel-open',actor);RAISE EXCEPTION 'cancel payload conflict accepted';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='REQUEST_ID_CONFLICT',SQLERRM;END;
 ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_cashier_shifts WHERE club_id=club),'late open was not fenced';
 response:=public.fnb_open_shift_v2(club,1000,'applied-open',actor);first_result:=response;
 ASSERT response->>'status'='ok' AND response->>'actor_id'=actor::text AND response->>'request_id'='applied-open';shift_id:=(response->>'shift_id')::uuid;
 ASSERT public.fnb_open_shift_v2(club,1000,'applied-open',actor)=first_result;
 response:=public.fnb_get_shift_intent_v1(club,'applied-open',actor);
 ASSERT response->>'status'='found' AND response->'result'->>'shift_id'=shift_id::text;
 -- Cancellation after commit returns the committed outcome, never undoing the open.
 ASSERT public.fnb_cancel_shift_intent_v1(club,'open',NULL,1000,NULL,'applied-open',actor)=first_result;
 response:=public.fnb_create_order(club,'counter',NULL,NULL,NULL,jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1)),gen_random_uuid()::text);
 ASSERT response->>'status'='ok';order_id:=(response->>'order_id')::uuid;
 response:=public.fnb_mark_paid(order_id,gen_random_uuid()::text);ASSERT response->>'status'='ok';
 response:=public.fnb_cancel_shift_intent_v1(club,'close',shift_id,6000,'cancelled note','cancel-close',actor);ASSERT response->>'status'='cancelled';
 response:=public.fnb_close_shift_v2(shift_id,6000,'cancelled note','cancel-close',actor);ASSERT response->>'status'='cancelled';
 response:=public.fnb_close_shift_v2(shift_id,6000,'different note','cancel-close',actor);ASSERT response->>'error'='REQUEST_ID_CONFLICT';
 ASSERT (SELECT status='open' FROM public.fnb_cashier_shifts WHERE id=shift_id),'late close was not fenced';
 BEGIN
  PERFORM public.fnb_close_shift(shift_id,6000,NULL,'legacy-close');RAISE EXCEPTION 'legacy close bypass';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='FNB_SHIFT_REQUEST_CONTEXT_REQUIRED',SQLERRM;END;
 first_result:=public.fnb_close_shift_v2(shift_id,6000,'actual close','applied-close',actor);
 ASSERT first_result->>'status'='ok' AND first_result->>'expected_cash_vnd'='5000' AND first_result->>'variance_vnd'='0';
 ASSERT public.fnb_close_shift_v2(shift_id,6000,'actual close','applied-close',actor)=first_result;
 ASSERT public.fnb_cancel_shift_intent_v1(club,'close',shift_id,6000,'actual close','applied-close',actor)=first_result;
 response:=public.fnb_get_shift_intent_v1(club,'applied-close',actor);
 ASSERT response->'result'->>'expected_cash_vnd'='5000' AND response->'intent'->>'note'='actual close';
 closed:=public.fnb_get_shift_report(shift_id);
 PERFORM set_config('request.jwt.claim.sub',cashier::text,true);
 response:=public.fnb_get_shift_intent_v1(club,'applied-close',cashier);ASSERT response->>'status'='not_found','other actor receipt exposed';
 BEGIN
  PERFORM public.fnb_get_shift_intent_v1(club,'applied-close',actor);RAISE EXCEPTION 'expected actor lookup bypass';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='FNB_SHIFT_ACTOR_MISMATCH',SQLERRM;END;
 response:=public.fnb_cancel_shift_intent_v1(club,'close',shift_id,6000,'actual close','applied-close',cashier);ASSERT response->>'status'='cancelled';
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 ASSERT public.fnb_get_shift_report(shift_id)=closed;
 response:=public.fnb_get_shift_intent_v1(club,'applied-close',actor);ASSERT response->'result'->>'status'='ok';
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 BEGIN
  PERFORM public.fnb_get_shift_intent_v1(club,'applied-close',outsider);RAISE EXCEPTION 'tenant lookup exposed';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Forbidden',SQLERRM;END;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*)=1 FROM public.fnb_cashier_shifts WHERE club_id=club);
 ASSERT (SELECT count(*)=5 FROM floor_private.fnb_shift_intents722 i WHERE i.actor IN(case725.actor,cashier));
 ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_open_shift_core725(uuid,bigint,text)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.fnb_get_shift_intent_v1(uuid,text,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.fnb_cancel_shift_intent_v1(uuid,text,uuid,bigint,text,text,uuid)','EXECUTE');
END $$;
SELECT 'FNB725_ACTOR_BOUND_LOOKUP_CANCEL_LATE_OPEN_CLOSE_FENCED_REPLAY_COMMITTED_OUTCOME_CASH_PASS';
