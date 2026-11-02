-- CLI candidate20261023152233 -> forward slot254. LOCAL ONLY, NOT LIVE.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.staking_refund_email_intents_v1') IS NOT NULL
 OR to_regprocedure('public._staking_refund_effect_intents_v1()') IS NOT NULL
 OR to_regclass('public.staking_refund_receipts_v1') IS NULL
 OR md5(pg_get_functiondef('public.commit_staking_refund_v1(uuid,uuid,uuid,text)'::regprocedure))<>'311b3d0b451fd6bfa15424921e193ded'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000254')
 THEN RAISE EXCEPTION 'staking254_catalog_drift';END IF;
END $$;
CREATE TABLE public.staking_refund_email_intents_v1(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL, request_id uuid NOT NULL,
 deal_id uuid NOT NULL REFERENCES public.staking_deals(id),
 purchase_id uuid NOT NULL UNIQUE REFERENCES public.staking_purchases(id),
 recipient_id uuid NOT NULL, payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','processing','delivered','needs_attention')),
 lease_token uuid, claimed_at timestamptz, provider_id text, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(actor_id,request_id) REFERENCES public.staking_refund_receipts_v1(actor_id,request_id)
);
ALTER TABLE public.staking_refund_email_intents_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staking_refund_email_intents_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public._staking_refund_effect_intents_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.staking_deals%ROWTYPE; p public.staking_purchases%ROWTYPE;
 label_value text; reason_value text:=NEW.payload->>'reason'; n integer:=0;
BEGIN
 SELECT * INTO STRICT d FROM public.staking_deals WHERE id=NEW.deal_id;
 IF d.status<>'deal_refunded' OR NEW.response->>'success'<>'true' THEN RAISE EXCEPTION 'staking_refund_effect_receipt_invalid';END IF;
 label_value:=coalesce(d.custom_event_name,'Deal #'||left(d.id::text,6));
 INSERT INTO public.notifications(user_id,type,title,body,data)
 VALUES(d.player_id,'deal_refunded','Deal đã được hoàn tiền',
 format('Deal "%s" đã bị hoàn tiền. Lý do: %s',label_value,reason_value),
 jsonb_build_object('deal_id',d.id,'reason',reason_value));
 FOR p IN SELECT * FROM public.staking_purchases WHERE deal_id=d.id AND status='refunded' ORDER BY id LOOP
  INSERT INTO public.notifications(user_id,type,title,body,data)
  VALUES(p.backer_id,'deal_refunded','Bạn đã được hoàn tiền',
   format('Khoản đầu tư %s%% (%s VND) deal "%s" đã được hoàn trả. Lý do: %s',p.percent,p.amount_vnd,label_value,reason_value),
   jsonb_build_object('deal_id',d.id,'purchase_id',p.id,'refund_amount',p.amount_vnd,'reason',reason_value));
  INSERT INTO public.staking_refund_email_intents_v1(actor_id,request_id,deal_id,purchase_id,recipient_id,payload)
  VALUES(NEW.actor_id,NEW.request_id,d.id,p.id,p.backer_id,
   jsonb_build_object('label',label_value,'percent',p.percent,'amount_vnd',p.amount_vnd,'reason',reason_value));
  n:=n+1;
 END LOOP;
 IF n IS DISTINCT FROM (NEW.response->>'refunded_backers')::integer THEN RAISE EXCEPTION 'staking_refund_effect_count_mismatch';END IF;
 IF d.club_id IS NOT NULL THEN
  INSERT INTO public.notifications(user_id,type,title,body,data)
  SELECT user_id,'deal_refunded','Deal đã được hoàn tiền tại CLB',
   format('Deal "%s" đã hoàn tiền cho %s backer. Lý do: %s',label_value,n,reason_value),
   jsonb_build_object('deal_id',d.id,'club_id',d.club_id,'reason',reason_value)
  FROM public.club_cashiers WHERE club_id=d.club_id AND user_id<>NEW.actor_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._staking_refund_effect_intents_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER staking_refund_receipt_effect_intents AFTER INSERT ON public.staking_refund_receipts_v1
FOR EACH ROW EXECUTE FUNCTION public._staking_refund_effect_intents_v1();
COMMIT;
