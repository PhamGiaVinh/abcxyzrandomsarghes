\set ON_ERROR_STOP on
\if :{?FNB718_CANDIDATE}
\else
\set FNB718_CANDIDATE false
\endif
BEGIN;
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';
SET LOCAL test.fnb718_rollback='on';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
 ASSERT public.is_club_owner('a364de8e-06b1-4428-a20d-ac614ec406e5','349ecf35-50ba-4c71-a581-15dc45f1cd01');
END $$;
\if :FNB718_CANDIDATE
-- APPLY_CANDIDATE718
\endif
DO $$ DECLARE menu uuid:=gen_random_uuid();ingredient uuid:=gen_random_uuid();order_id uuid;
 response jsonb; before_payment timestamptz;before_refund timestamptz;paid_at timestamptz;refunded_at timestamptz;
 actor uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5';club uuid:='349ecf35-50ba-4c71-a581-15dc45f1cd01'; BEGIN
 INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost)
 VALUES(ingredient,club,'LOCAL718 rollback ingredient','unit',10,1000);
 INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,tracks_inventory)
 VALUES(menu,club,'LOCAL718 rollback item',5000,true);
 INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty) VALUES(club,menu,ingredient,2);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 response:=public.fnb_create_order(club,'counter',NULL,NULL,NULL,
  jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',2)),gen_random_uuid()::text);
 ASSERT response->>'status'='ok',response::text;order_id:=(response->>'order_id')::uuid;
 PERFORM pg_sleep(0.02);before_payment:=clock_timestamp();
 response:=public.fnb_mark_paid(order_id,gen_random_uuid()::text);
 ASSERT response->>'status'='ok',response::text;
 PERFORM set_config('role','none',true);
 SELECT o.paid_at INTO paid_at FROM public.fnb_orders o WHERE o.id=order_id;
 ASSERT (SELECT on_hand=6 FROM public.fnb_ingredients WHERE id=ingredient);
 ASSERT (SELECT subtotal_vnd=10000 AND cogs_vnd=4000 FROM public.fnb_orders WHERE id=order_id);
 PERFORM pg_sleep(0.02);before_refund:=clock_timestamp();
 PERFORM set_config('role','authenticated',true);
 response:=public.fnb_cancel_order(order_id,'LOCAL718 rollback refund');
 ASSERT response->>'status'='ok',response::text;
 PERFORM set_config('role','none',true);
 SELECT o.cancelled_at INTO refunded_at FROM public.fnb_orders o WHERE o.id=order_id;
 ASSERT paid_at>=before_payment AND refunded_at>=before_refund,
  format('FNB718_BACKDATED_EVENT payment_after_dispatch=%s refund_after_dispatch=%s',paid_at>=before_payment,refunded_at>=before_refund);
 ASSERT (SELECT on_hand=10 FROM public.fnb_ingredients WHERE id=ingredient);
 ASSERT (SELECT count(*)=2 AND sum(delta)=0 FROM public.fnb_stock_movements WHERE ref_id=order_id);
END $$;
ROLLBACK;
SELECT 'FNB718_CURRENT_ORDER_RPC_PAYMENT_REFUND_TIMESTAMPS_STOCK_CASH_ROLLBACK_PROTOTYPE_ONLY';
