-- Isolated qualified PG17 only; entire fixture and all ledger rows roll back.
BEGIN;
SET LOCAL statement_timeout='10s';
DO $fixture$
DECLARE v_menu uuid:=gen_random_uuid();v_ing uuid:=gen_random_uuid();v_actor2 uuid;
BEGIN
  ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
  ASSERT public.is_club_owner('a364de8e-06b1-4428-a20d-ac614ec406e5','349ecf35-50ba-4c71-a581-15dc45f1cd01');
  INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost)
    VALUES(v_ing,'349ecf35-50ba-4c71-a581-15dc45f1cd01','LOCAL rollback coffee','unit',10,1000);
  INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,tracks_inventory)
    VALUES(v_menu,'349ecf35-50ba-4c71-a581-15dc45f1cd01','LOCAL rollback coffee',5000,true);
  INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty)
    VALUES('349ecf35-50ba-4c71-a581-15dc45f1cd01',v_menu,v_ing,2);
  PERFORM set_config('test.fnb_menu',v_menu::text,true);
  PERFORM set_config('test.fnb_ing',v_ing::text,true);
  SELECT id INTO STRICT v_actor2 FROM auth.users WHERE id<>'a364de8e-06b1-4428-a20d-ac614ec406e5' ORDER BY id LIMIT 1;
  INSERT INTO public.club_fnb_staff(club_id,user_id,kind) VALUES('349ecf35-50ba-4c71-a581-15dc45f1cd01',v_actor2,'cashier') ON CONFLICT DO NOTHING;
  PERFORM set_config('test.fnb_actor2',v_actor2::text,true);
END $fixture$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a364de8e-06b1-4428-a20d-ac614ec406e5',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a364de8e-06b1-4428-a20d-ac614ec406e5"}',true);
DO $test$
DECLARE v_menu uuid:=current_setting('test.fnb_menu')::uuid;v_ing uuid:=current_setting('test.fnb_ing')::uuid;
  v_club uuid:='349ecf35-50ba-4c71-a581-15dc45f1cd01';v_order uuid;v_receipt jsonb;v_replay jsonb;
  v_key text:=gen_random_uuid()::text;v_compkey text:=gen_random_uuid()::text;v_failedkey text:=gen_random_uuid()::text;
  v_lines jsonb;v_stock numeric;v_count int;v_actor2 uuid:=current_setting('test.fnb_actor2')::uuid;
BEGIN
  ASSERT EXISTS(SELECT 1 FROM public.fnb_club_ids('a364de8e-06b1-4428-a20d-ac614ec406e5')
    club_id WHERE club_id='349ecf35-50ba-4c71-a581-15dc45f1cd01'),'owner own clubs missing';
  v_lines:=jsonb_build_array(jsonb_build_object('menu_item_id',v_menu,'qty',2));
  v_receipt:=public.fnb_create_order(v_club,'counter',NULL,NULL,NULL,v_lines,v_key);
  ASSERT v_receipt->>'status'='ok' AND (v_receipt->>'subtotal_vnd')::int=10000,v_receipt::text;
  v_order:=(v_receipt->>'order_id')::uuid;
  SELECT on_hand INTO v_stock FROM public.fnb_ingredients WHERE id=v_ing;
  ASSERT v_stock=10,'create consumed stock';
  v_replay:=public.fnb_create_order(v_club,'counter',NULL,NULL,NULL,v_lines,v_key);
  ASSERT v_replay->>'order_id'=v_order::text AND (v_replay->>'idempotent')::boolean;
  PERFORM set_config('request.jwt.claim.sub',v_actor2::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',v_actor2)::text,true);
  ASSERT public.is_club_fnb_kind(v_actor2,v_club,'cashier'),'second actor must be authorized to test binding';
  v_replay:=public.fnb_create_order(v_club,'counter',NULL,NULL,NULL,v_lines,v_key);
  ASSERT v_replay->>'error'='REQUEST_ID_CONFLICT','authorized actor reused other actor receipt';
  PERFORM set_config('request.jwt.claim.sub','a364de8e-06b1-4428-a20d-ac614ec406e5',true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"a364de8e-06b1-4428-a20d-ac614ec406e5"}',true);
  v_receipt:=public.fnb_mark_paid(v_order);
  ASSERT v_receipt->>'status'='ok',v_receipt::text;
  SELECT on_hand INTO v_stock FROM public.fnb_ingredients WHERE id=v_ing;
  ASSERT v_stock=6,'payment stock not 6';
  v_replay:=public.fnb_mark_paid(v_order);
  ASSERT (v_replay->>'idempotent')::boolean;
  SELECT count(*) INTO v_count FROM public.fnb_stock_movements WHERE ref_id=v_order AND reason='sale';
  ASSERT v_count=1,'duplicate sale movement';
  v_receipt:=public.fnb_cancel_order(v_order,'LOCAL rollback refund');
  ASSERT v_receipt->>'status'='ok' AND (v_receipt->>'reversed_stock')::boolean,v_receipt::text;
  v_replay:=public.fnb_cancel_order(v_order,'LOCAL replay refund');
  ASSERT (v_replay->>'idempotent')::boolean;
  SELECT on_hand INTO v_stock FROM public.fnb_ingredients WHERE id=v_ing;
  ASSERT v_stock=10,'refund failed stock conservation';
  SELECT count(*) INTO v_count FROM public.fnb_stock_movements WHERE ref_id=v_order;
  ASSERT v_count=2,'refund duplicate or missing compensating movement';
  v_receipt:=public.fnb_create_comp_order(v_club,'counter',NULL,NULL,NULL,v_lines,'LOCAL comp',v_compkey);
  ASSERT v_receipt->>'status'='ok' AND (v_receipt->>'is_comp')::boolean,v_receipt::text;
  v_order:=(v_receipt->>'order_id')::uuid;
  v_replay:=public.fnb_create_comp_order(v_club,'counter',NULL,NULL,NULL,v_lines,'LOCAL comp',v_compkey);
  ASSERT v_replay->>'order_id'=v_order::text AND (v_replay->>'idempotent')::boolean,'COMP replay failed';
  SELECT on_hand INTO v_stock FROM public.fnb_ingredients WHERE id=v_ing;
  ASSERT v_stock=6,'comp did not consume stock';
  v_receipt:=public.fnb_cancel_order(v_order,'LOCAL comp undo');
  SELECT on_hand INTO v_stock FROM public.fnb_ingredients WHERE id=v_ing;
  ASSERT v_stock=10,'comp undo stock conservation';
  -- COMP fails after intent and order inserts; subtransaction must remove both.
  BEGIN
    PERFORM public.fnb_create_comp_order(v_club,'counter',NULL,NULL,NULL,
      jsonb_build_array(jsonb_build_object('menu_item_id',v_menu,'qty',6)),'LOCAL shortage',v_failedkey);
    RAISE EXCEPTION 'expected shortage';
  EXCEPTION WHEN check_violation THEN
    ASSERT SQLERRM='INSUFFICIENT_STOCK',SQLERRM;
  END;
  ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_orders WHERE club_id=v_club AND client_request_id=v_failedkey),'failed comp retained order';
  PERFORM set_config('test.fnb_failedkey',v_failedkey,true);
  SELECT on_hand INTO v_stock FROM public.fnb_ingredients WHERE id=v_ing;
  ASSERT v_stock=10,'failed comp changed stock';
  -- Reusing that rolled-back key with a valid intent must work, not false conflict.
  v_replay:=public.fnb_create_comp_order(v_club,'counter',NULL,NULL,NULL,v_lines,'LOCAL recovered',v_failedkey);
  ASSERT v_replay->>'status'='ok','failed comp retained bound intent';
  v_receipt:=public.fnb_cancel_order((v_replay->>'order_id')::uuid,'LOCAL recovered undo');
  RAISE NOTICE 'FNB_NATIVE_CREATE_PAY_REPLAY_REFUND_COMP_STOCK_PASS';
  -- Same key with a different cart must conflict rather than replay the old order.
  v_replay:=public.fnb_create_order(v_club,'counter',NULL,NULL,NULL,
    jsonb_build_array(jsonb_build_object('menu_item_id',v_menu,'qty',3)),v_key);
  ASSERT v_replay->>'error'='REQUEST_ID_CONFLICT','FNB_RECEIPT_PAYLOAD_CONFLICT: changed qty accepted';
  v_replay:=public.fnb_create_comp_order(v_club,'counter',NULL,NULL,NULL,v_lines,'LOCAL comp',v_key);
  ASSERT v_replay->>'error'='REQUEST_ID_CONFLICT','FNB_RECEIPT_OPERATION_CONFLICT: normal key accepted as COMP';
  v_replay:=public.fnb_create_comp_order(v_club,'counter',NULL,NULL,NULL,v_lines,'CHANGED reason',v_compkey);
  ASSERT v_replay->>'error'='REQUEST_ID_CONFLICT','COMP changed reason accepted';
  BEGIN
    PERFORM public._fnb_bind_create_intent_v1('a364de8e-06b1-4428-a20d-ac614ec406e5',v_club,'direct','order','{}');
    RAISE EXCEPTION 'private intent helper exposed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'FNB_INTENT_PAYLOAD_OPERATION_COMP_REPLAY_PRIVATE_HELPER_PASS';
  RAISE NOTICE 'FNB_AUTHORIZED_CROSS_ACTOR_AND_COMP_FAULT_ROLLBACK_PASS';
END $test$;
SELECT set_config('request.jwt.claim.sub','f660754c-ff8a-400e-a819-9679048d005f',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f660754c-ff8a-400e-a819-9679048d005f"}',true);
DO $privacy$
DECLARE v_count int;
BEGIN
  ASSERT NOT public.is_club_owner('f660754c-ff8a-400e-a819-9679048d005f','349ecf35-50ba-4c71-a581-15dc45f1cd01');
  SELECT count(*) INTO v_count FROM public.fnb_club_ids('a364de8e-06b1-4428-a20d-ac614ec406e5');
  ASSERT v_count=0,'FNB_CLUB_IDOR: authenticated outsider reads other user club IDs';
  SELECT count(*) INTO v_count FROM public.fnb_club_ids('f660754c-ff8a-400e-a819-9679048d005f');
  -- Empty is valid for an unassigned actor; own-argument call must remain callable.
  ASSERT v_count>=0;
END $privacy$;
ROLLBACK;
