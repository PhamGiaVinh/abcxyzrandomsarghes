-- CLIcandidate20261023160851 -> forward258. LOCAL ONLY, NOT LIVE.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.staking_funding_email_intents_v1') IS NOT NULL
 OR to_regprocedure('public._staking_funding_effect_intents_v1()') IS NOT NULL
 OR md5(pg_get_functiondef('public.commit_staking_funding_v1(uuid,uuid,text,text)'::regprocedure))<>'4185016505d6e8ce325d35152c83dfb6'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000258')
 THEN RAISE EXCEPTION 'staking258_catalog_drift';END IF;
END $$;
CREATE TABLE public.staking_funding_email_intents_v1(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),purchase_id uuid NOT NULL REFERENCES public.staking_funding_receipts_v1(purchase_id),
 actor_id uuid NOT NULL,recipient_role text NOT NULL CHECK(recipient_role IN('backer','player')),recipient_id uuid NOT NULL,
 payload jsonb NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','processing','delivered','needs_attention')),
 lease_token uuid,claimed_at timestamptz,provider_id text,error_code text,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(purchase_id,recipient_role)
);
ALTER TABLE public.staking_funding_email_intents_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staking_funding_email_intents_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public._staking_funding_effect_intents_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.staking_purchases%ROWTYPE;d public.staking_deals%ROWTYPE;label_value text;club_name text;owner_value uuid;payload_value jsonb;
BEGIN
 SELECT * INTO STRICT p FROM public.staking_purchases WHERE id=NEW.purchase_id;
 SELECT * INTO STRICT d FROM public.staking_deals WHERE id=p.deal_id;
 IF p.status<>'funded' OR NEW.response->>'purchase_id' IS DISTINCT FROM p.id::text OR NEW.response->>'success' IS DISTINCT FROM 'true'
 OR p.amount_vnd<0 OR p.amount_vnd>9007199254740991 THEN RAISE EXCEPTION 'staking_funding_effect_receipt_invalid';END IF;
 label_value:=coalesce(d.custom_event_name,'Deal #'||left(d.id::text,6));
 SELECT name,owner_id INTO club_name,owner_value FROM public.clubs WHERE id=d.club_id;
 -- Respect existing lifecycle uniqueness, including existing deal status triggers.
 INSERT INTO public.notifications(user_id,type,title,body,data)
 VALUES(p.backer_id,'deal_funded','Đã xác nhận nạp tiền',
 format('Khoản đầu tư %s%% deal "%s" (%s VND) đã được xác nhận.',p.percent,label_value,p.amount_vnd),
 jsonb_build_object('deal_id',d.id,'purchase_id',p.id,'percent',p.percent)) ON CONFLICT DO NOTHING;
 INSERT INTO public.notifications(user_id,type,title,body,data)
 VALUES(d.player_id,'purchase_funded','Có người hỗ trợ mới đã nạp tiền',
 format('Backer vừa nạp %s%% deal "%s". Tổng đã funded: %s/%s%%.',p.percent,label_value,NEW.response->>'total_funded_percent',d.percentage_sold),
 jsonb_build_object('deal_id',d.id,'backer_id',p.backer_id,'purchase_id',p.id,'total_funded',NEW.response->'total_funded_percent')) ON CONFLICT DO NOTHING;
 IF d.club_id IS NOT NULL THEN
  INSERT INTO public.notifications(user_id,type,title,body,data)
  SELECT user_id,'purchase_funded','Giao dịch mới đã nạp tiền',format('Backer đã nạp %s%% deal "%s" (%s VND).',p.percent,label_value,p.amount_vnd),
   jsonb_build_object('deal_id',d.id,'club_id',d.club_id,'purchase_id',p.id)
  FROM public.club_cashiers WHERE club_id=d.club_id AND user_id<>NEW.actor_id AND user_id<>p.backer_id ON CONFLICT DO NOTHING;
  IF owner_value IS NOT NULL AND owner_value<>NEW.actor_id AND owner_value<>p.backer_id THEN
   INSERT INTO public.notifications(user_id,type,title,body,data)
   VALUES(owner_value,'purchase_funded','Giao dịch mới đã nạp tiền tại CLB của bạn',format('Backer đã nạp %s%% deal "%s".',p.percent,label_value),
    jsonb_build_object('deal_id',d.id,'club_id',d.club_id)) ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 payload_value:=jsonb_build_object('deal_id',d.id,'deal_short_id',left(d.id::text,6),'club_name',club_name,'tournament_name',d.custom_event_name,
  'amount_vnd',p.amount_vnd,'percent',p.percent,'funded_percent',NEW.response->'total_funded_percent','sold_percent',d.percentage_sold,'deal_status',NEW.response->>'deal_status');
 INSERT INTO public.staking_funding_email_intents_v1(purchase_id,actor_id,recipient_role,recipient_id,payload)
 VALUES(p.id,NEW.actor_id,'backer',p.backer_id,payload_value),(p.id,NEW.actor_id,'player',d.player_id,payload_value);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._staking_funding_effect_intents_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER staking_funding_receipt_effect_intents AFTER INSERT ON public.staking_funding_receipts_v1
FOR EACH ROW EXECUTE FUNCTION public._staking_funding_effect_intents_v1();
COMMIT;
