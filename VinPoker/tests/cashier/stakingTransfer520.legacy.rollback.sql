BEGIN;
SET LOCAL statement_timeout='10s';
DO $$
DECLARE buyer uuid:=gen_random_uuid(); deal uuid:=gen_random_uuid(); purchase uuid:=gen_random_uuid(); club uuid; result jsonb;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN ('pg_net','pg_cron'));
 SELECT id INTO STRICT club FROM public.clubs ORDER BY id LIMIT 1;
 INSERT INTO auth.users(id) VALUES(buyer);
 INSERT INTO public.profiles(user_id,display_name) VALUES(buyer,'LOCAL520 '||buyer::text);
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status,admin_review_status)
 VALUES(deal,'a364de8e-06b1-4428-a20d-ac614ec406e5',club,'LOCAL520 legacy bank rollback',now(),'LOCAL ONLY',10,1,1000000,'listing','approved');
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,reference_code)
 VALUES(purchase,deal,buyer,10,1,100000,'LOCAL520_'||purchase::text);
 ASSERT NOT EXISTS(SELECT 1 FROM public.staking_purchase_receipts_v1 WHERE purchase_id=purchase);
 PERFORM set_config('request.jwt.claim.sub',buyer::text,true);
 PERFORM set_config('role','authenticated',true);
 result:=public.get_staking_purchase_transfer_v1(purchase);
 ASSERT result->>'state'='needs_attention' AND result->>'reason'='receipt_bank_unproven';
 ASSERT NOT(result ? 'bank');
 PERFORM set_config('role','postgres',true);
 UPDATE public.staking_purchases SET status='cancelled',cancellation_reason='LOCAL520 rollback only' WHERE id=purchase;
 PERFORM set_config('role','authenticated',true);
 result:=public.get_staking_purchase_transfer_v1(purchase);
 ASSERT result->>'state'='closed' AND NOT(result ? 'bank');
 PERFORM set_config('role','postgres',true);
 RAISE NOTICE 'TRANSFER520 native legacy missing receipt/closed no bank inference PASS; all rollback';
END $$;
ROLLBACK;
