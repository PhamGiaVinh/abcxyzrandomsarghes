-- Native actual RPCs inside outer rollback, not modeled outcomes.
DO $$ <<test_case>> DECLARE actor uuid:=gen_random_uuid();club uuid:=gen_random_uuid();cashier uuid:=gen_random_uuid();server uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();
 menu uuid:=gen_random_uuid();ingredient uuid:=gen_random_uuid();physical uuid;bank uuid:=gen_random_uuid();
 token text:='LOCAL722-'||gen_random_uuid();account text:='TEST-NON-BANK722-'||gen_random_uuid();reference text;
 response jsonb;receipt jsonb;closed jsonb;order_id uuid;outside_order uuid;shift_a uuid;shift_b uuid;bank_order uuid;comp_order uuid;
 failed_order uuid;bad_menu uuid:=gen_random_uuid();
BEGIN
 INSERT INTO auth.users(id) VALUES(actor),(cashier),(server),(outsider);
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES(club,actor,'LOCAL722 rollback TEST','TEST','approved');
 ASSERT (SELECT count(*)=100 FROM public.game_tables WHERE club_id=club),'must reuse canonical100-table pool';
 INSERT INTO public.club_fnb_staff(club_id,user_id,kind) VALUES(club,cashier,'cashier'),(club,server,'server');
 INSERT INTO public.fnb_settings(club_id,guest_order_enabled,guest_bank_auto_confirm) VALUES(club,true,true);
 SELECT id INTO STRICT physical FROM public.game_tables WHERE club_id=club AND table_number=30;
 INSERT INTO public.fnb_table_qr_tokens(club_id,table_ref,token,is_active) VALUES(club,physical,token,true);
 INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost) VALUES(ingredient,club,'LOCAL722 ingredient','unit',20,1000);
 INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES(menu,club,'LOCAL722 item',5000,true,true);
 INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty) VALUES(club,menu,ingredient,2);
 INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,is_active,account_type)
  VALUES(club,'LOCAL TEST722 NOT A BANK',account,'NO REAL ACCOUNT',true,'escrow');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);PERFORM set_config('role','authenticated',true);
 PERFORM set_config('request.jwt.claim.sub','',true);
 response:=public.fnb_open_shift(club,0,'no-user');ASSERT response->>'error'='Unauthorized';
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 -- Existing no-open gap: a payment before opening is never retrospectively swept into a shift.
 response:=public.fnb_create_order(club,'counter',NULL,NULL,NULL,jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1)),gen_random_uuid()::text);
 ASSERT response->>'status'='ok',response::text;outside_order:=(response->>'order_id')::uuid;
 response:=public.fnb_mark_paid(outside_order,gen_random_uuid()::text);ASSERT response->>'status'='ok',response::text;
 response:=public.fnb_open_shift(club,-1,'invalid');ASSERT response->>'error'='INVALID_INPUT';
 response:=public.fnb_open_shift(club,0,'');ASSERT response->>'error'='INVALID_INPUT';
 response:=public.fnb_open_shift(club,1000,'open-a');ASSERT response->>'status'='ok',response::text;shift_a:=(response->>'shift_id')::uuid;receipt:=response;
 response:=public.fnb_open_shift(club,1000,'open-a');ASSERT response=receipt,'exact receipt replay';
 response:=public.fnb_open_shift(club,2000,'open-a');ASSERT response->>'error'='REQUEST_ID_CONFLICT';
 response:=public.fnb_open_shift(club,1000,'second-open');ASSERT (response->>'shift_id')::uuid=shift_a AND response->>'already_open'='true';
 -- Actual cashier opens existing shift; read-only server can see report but cannot open or close.
 PERFORM set_config('request.jwt.claim.sub',server::text,true);
 response:=public.fnb_get_shift_report(shift_a);ASSERT response->>'status'='ok' AND response->>'sales_vnd'='0';
 response:=public.fnb_open_shift(club,1000,'server-open');ASSERT response->>'error'='Forbidden';
 response:=public.fnb_close_shift(shift_a,1000,NULL,'server-close');ASSERT response->>'error'='Forbidden';
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 response:=public.fnb_get_shift_report(shift_a);ASSERT response->>'error'='Forbidden';
 ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_cashier_shifts WHERE id=shift_a),'outsider RLS';
 PERFORM set_config('request.jwt.claim.sub',cashier::text,true);
 response:=public.fnb_open_shift(club,1000,'cashier-open');ASSERT response->>'status'='ok' AND (response->>'shift_id')::uuid=shift_a;
 -- Roll back a real inventory failure. No recognition, stock consumption, or paid status may leak.
 PERFORM set_config('role','none',true);
 INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES(bad_menu,club,'LOCAL722 no recipe',5000,true,true);
 PERFORM set_config('role','authenticated',true);
 response:=public.fnb_create_order(club,'counter',NULL,NULL,NULL,jsonb_build_array(jsonb_build_object('menu_item_id',bad_menu,'qty',1)),gen_random_uuid()::text);
 ASSERT response->>'status'='ok',response::text;failed_order:=(response->>'order_id')::uuid;
 BEGIN
  PERFORM public.fnb_mark_paid(failed_order,gen_random_uuid()::text);
  RAISE EXCEPTION 'missing recipe unexpectedly paid';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='RECIPE_REQUIRED',SQLERRM;END;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT status='pending' AND paid_at IS NULL FROM public.fnb_orders WHERE id=failed_order);
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.fnb_shift_order_events722 e WHERE e.order_id=failed_order);
 ASSERT (SELECT on_hand=18 FROM public.fnb_ingredients WHERE id=ingredient);
 PERFORM set_config('role','authenticated',true);
 response:=public.fnb_create_order(club,'counter',NULL,NULL,NULL,jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1)),gen_random_uuid()::text);
 ASSERT response->>'status'='ok',response::text;order_id:=(response->>'order_id')::uuid;
 response:=public.fnb_mark_paid(order_id,gen_random_uuid()::text);ASSERT response->>'status'='ok',response::text;
 response:=public.fnb_create_comp_order(club,'counter',NULL,NULL,NULL,jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1)),'LOCAL722 TEST',gen_random_uuid()::text);
 ASSERT response->>'status'='ok',response::text;comp_order:=(response->>'order_id')::uuid;
 -- Anonymous bank order through service settlement is informative only, never cash in drawer.
 PERFORM set_config('role','anon',true);
 response:=public.fnb_guest_create_order(token,3::smallint,'LOCAL722 TEST',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1)),'bank_transfer',gen_random_uuid()::text);
 ASSERT response->>'status'='ok',response::text;bank_order:=(response->>'order_id')::uuid;
 PERFORM set_config('role','none',true);
 SELECT o.reference_code INTO STRICT reference FROM public.fnb_orders o WHERE o.id=bank_order;
 INSERT INTO public.bank_transactions(id,provider,provider_txn_id,account_number,club_id,amount,transfer_type,content,api_verified_at)
  VALUES(bank,'sepay','LOCAL722-'||bank,account,club,5000,'in',reference,clock_timestamp());
 PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
 response:=public.settle_bank_transaction(bank,true);ASSERT response->>'outcome'='auto_confirmed',response::text;
 PERFORM set_config('role','authenticated',true);PERFORM set_config('request.jwt.claim.sub',cashier::text,true);
 response:=public.fnb_get_shift_report(shift_a);
 ASSERT response->>'sales_vnd'='5000' AND response->>'refunds_vnd'='0' AND response->>'comp_count'='1'
  AND response->>'bank_paid_vnd'='5000' AND response->>'expected_drawer_vnd'='6000',response::text;
 ASSERT jsonb_array_length(response->'orders')=3;
 response:=public.fnb_close_shift(shift_a,6000,'first','close-a');
 ASSERT response->>'status'='ok' AND response->>'variance_vnd'='0',response::text;receipt:=response;
 response:=public.fnb_close_shift(shift_a,6000,'first','close-a');ASSERT response=receipt;
 response:=public.fnb_open_shift(club,1000,'close-a');ASSERT response->>'error'='REQUEST_ID_CONFLICT','same key different operation';
 response:=public.fnb_close_shift(shift_a,6001,'first','close-a');ASSERT response->>'error'='REQUEST_ID_CONFLICT';
 response:=public.fnb_close_shift(shift_a,6000,'different','close-a');ASSERT response->>'error'='REQUEST_ID_CONFLICT';
 response:=public.fnb_close_shift(shift_a,6000,'first','different-key');ASSERT response->>'error'='SHIFT_ALREADY_CLOSED';
 closed:=public.fnb_get_shift_report(shift_a);
 response:=public.fnb_open_shift(club,0,'open-b');ASSERT response->>'status'='ok';shift_b:=(response->>'shift_id')::uuid;
 -- Later refund goes only to B. Closed report including rows remains byte-for-byte stable.
 response:=public.fnb_cancel_order(order_id,'refund in B');ASSERT response->>'status'='ok',response::text;
 response:=public.fnb_cancel_order(order_id,'refund replay');ASSERT response->>'idempotent'='true';
 ASSERT public.fnb_get_shift_report(shift_a)=closed,'closed snapshot mutated after later refund';
 response:=public.fnb_get_shift_report(shift_b);
 ASSERT response->>'sales_vnd'='0' AND response->>'refunds_vnd'='5000' AND response->>'expected_drawer_vnd'='-5000',response::text;
 response:=public.fnb_close_shift(shift_b,0,NULL,'close-b');ASSERT response->>'variance_vnd'='5000';
 PERFORM set_config('role','none',true);
 ASSERT (SELECT on_hand=14 FROM public.fnb_ingredients WHERE id=ingredient),'4sales minus1refund';
 ASSERT (SELECT count(*)=1 FROM floor_private.fnb_shift_order_events722 e WHERE e.order_id=outside_order AND e.shift_id IS NULL);
 ASSERT (SELECT count(*)=1 FROM floor_private.fnb_shift_order_events722 e WHERE e.order_id=test_case.order_id AND e.shift_id=shift_a AND e.kind='sale');
 ASSERT (SELECT count(*)=1 FROM floor_private.fnb_shift_order_events722 e WHERE e.order_id=test_case.order_id AND e.shift_id=shift_b AND e.kind='refund');
 ASSERT NOT has_function_privilege('anon','public.fnb_open_shift(uuid,bigint,text)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.fnb_close_shift(uuid,bigint,text,text)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_shift_totals722(uuid)','EXECUTE');
 ASSERT NOT has_table_privilege('authenticated','public.fnb_cashier_shifts','UPDATE');
 ASSERT NOT has_table_privilege('authenticated','floor_private.fnb_shift_intents722','SELECT');
 ASSERT (SELECT count(*)=2 FROM public.fnb_cashier_shifts WHERE club_id=club),'one shift per accepted open';
 BEGIN
  UPDATE public.fnb_orders SET subtotal_vnd=1 WHERE id=bank_order;
  RAISE EXCEPTION 'paid amount unexpectedly mutable';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='FNB_PAID_ORDER_IMMUTABLE',SQLERRM;END;
 ASSERT (SELECT subtotal_vnd=5000 FROM public.fnb_orders WHERE id=bank_order);
 BEGIN
  UPDATE public.fnb_cashier_shifts SET counted_cash_vnd=1 WHERE id=shift_a;
  RAISE EXCEPTION 'closed update unexpectedly accepted';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='FNB_SHIFT_IMMUTABLE',SQLERRM;END;
END $$;
SELECT 'FNB722_NATIVE_OPEN_PAY_COMP_BANK_CLOSE_REFUND_NEXT_SHIFT_REPLAY_TENANT_RLS_PASS';
