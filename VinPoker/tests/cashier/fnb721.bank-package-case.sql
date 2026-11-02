-- Included INSIDE the278 rollback qualification transaction. No standalone COMMIT.
DO $$ DECLARE actor uuid:=gen_random_uuid();club uuid:=gen_random_uuid();physical uuid;
 menu uuid:=gen_random_uuid();ingredient uuid:=gen_random_uuid();bank uuid:=gen_random_uuid();created_order uuid;
 token text:='LOCAL721-'||gen_random_uuid();account text:='TEST-NON-BANK721-'||gen_random_uuid();reference text;response jsonb;
BEGIN
 INSERT INTO auth.users(id) VALUES(actor);
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES(club,actor,'LOCAL721 rollback TEST','TEST','approved');
 INSERT INTO public.fnb_settings(club_id,guest_order_enabled,guest_bank_auto_confirm) VALUES(club,true,true);
 SELECT id INTO STRICT physical FROM public.game_tables WHERE club_id=club AND table_number=30;
 INSERT INTO public.fnb_table_qr_tokens(club_id,table_ref,token,is_active) VALUES(club,physical,token,true);
 INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost) VALUES(ingredient,club,'LOCAL721 rollback ingredient','unit',10,1000);
 INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES(menu,club,'LOCAL721 rollback item',5000,true,true);
 INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty) VALUES(club,menu,ingredient,2);
 INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,is_active,account_type)
 VALUES(club,'LOCAL TEST721 NOT A BANK',account,'NO REAL ACCOUNT',true,'escrow');
 PERFORM set_config('role','anon',true);
 response:=public.fnb_guest_create_order(token,3::smallint,'LOCAL721 TEST',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1)),'bank_transfer',gen_random_uuid()::text);
 ASSERT response->>'status'='ok',response::text;created_order:=(response->>'order_id')::uuid;
 PERFORM set_config('role','none',true);
 SELECT o.reference_code INTO STRICT reference FROM public.fnb_orders o WHERE o.id=created_order;
 UPDATE public.fnb_menu_items SET price_vnd=9000 WHERE id=menu;
 INSERT INTO public.bank_transactions(id,provider,provider_txn_id,account_number,club_id,amount,transfer_type,content,api_verified_at)
 VALUES(bank,'sepay','LOCAL721-'||bank,account,club,5000,'in',reference,clock_timestamp());
 PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
 response:=public.settle_bank_transaction(bank,true);ASSERT response->>'outcome'='auto_confirmed',response::text;
 response:=public.settle_bank_transaction(bank,true);ASSERT response->>'already_settled'='true',response::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT status='paid' AND subtotal_vnd=5000 AND cogs_vnd=2000 FROM public.fnb_orders WHERE id=created_order);
 ASSERT (SELECT on_hand=8 FROM public.fnb_ingredients WHERE id=ingredient);
 ASSERT (SELECT count(*)=1 AND sum(delta)=-2 FROM public.fnb_stock_movements WHERE ref_id=created_order AND reason='sale');
 ASSERT (SELECT count(*)=1 FROM public.payment_settlements WHERE bank_transaction_id=bank AND outcome='auto_confirmed');
 ASSERT EXISTS(SELECT 1 FROM public.fnb_order_events e WHERE e.order_id=created_order AND e.old_status='pending' AND e.new_status='paid');
END $$;
