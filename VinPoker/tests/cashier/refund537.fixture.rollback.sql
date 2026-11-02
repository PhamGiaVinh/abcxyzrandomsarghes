-- Explicit isolated native browser-canary facts; no lasting grant or business change.
SELECT jsonb_build_object('roles',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY role) FROM public.user_roles r WHERE user_id='675fe35e-60a8-4452-bb90-e79486d54da6'),'[]'),
 'cashier',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY club_id) FROM public.club_cashiers c WHERE user_id='675fe35e-60a8-4452-bb90-e79486d54da6'),'[]'));
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT EXISTS(SELECT 1 FROM public.clubs WHERE id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND owner_id='675fe35e-60a8-4452-bb90-e79486d54da6');
 ASSERT NOT EXISTS(SELECT 1 FROM public.staking_deals WHERE id='e5370000-0000-4000-8000-000000000001');
END $$;
INSERT INTO public.user_roles(user_id,role) SELECT '675fe35e-60a8-4452-bb90-e79486d54da6','cashier'
 WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND role='cashier');
INSERT INTO public.club_cashiers(user_id,club_id) SELECT '675fe35e-60a8-4452-bb90-e79486d54da6','a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'
 WHERE NOT EXISTS(SELECT 1 FROM public.club_cashiers WHERE user_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
VALUES('e5370000-0000-4000-8000-000000000001','675fe35e-60a8-4452-bb90-e79486d54da6','a8e7d1b7-fdaa-45ad-b0a1-f894b6315760','LOCAL537 browser refund canary',now(),'LOCAL ONLY',10,1,1000000,'funded');
INSERT INTO public.staking_purchases(deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
SELECT 'e5370000-0000-4000-8000-000000000001','675fe35e-60a8-4452-bb90-e79486d54da6',5,1,amount,'funded',gen_random_uuid()::text FROM unnest(ARRAY[50000,60000]) amount;
SET LOCAL ROLE service_role;
SELECT public.commit_staking_refund_v1('675fe35e-60a8-4452-bb90-e79486d54da6','e5370000-0000-4000-8000-000000000002','e5370000-0000-4000-8000-000000000001','LOCAL537 canary validation');
RESET ROLE;
ROLLBACK;
SELECT jsonb_build_object('roles',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY role) FROM public.user_roles r WHERE user_id='675fe35e-60a8-4452-bb90-e79486d54da6'),'[]'),
 'cashier',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY club_id) FROM public.club_cashiers c WHERE user_id='675fe35e-60a8-4452-bb90-e79486d54da6'),'[]'));
DO $$ BEGIN ASSERT NOT EXISTS(SELECT 1 FROM public.staking_deals WHERE id='e5370000-0000-4000-8000-000000000001');END $$;
