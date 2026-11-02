-- CLI candidate20261023140958 -> forward slot251. LOCAL candidate, NOT LIVE.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public._staking_purchase_notify_v1()') IS NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000251')
 THEN RAISE EXCEPTION 'staking251_catalog_drift';END IF;
END $$;
CREATE OR REPLACE FUNCTION public._staking_purchase_notify_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.staking_deals%ROWTYPE; p public.staking_purchases%ROWTYPE;
 label_value text; owner_value uuid; filled integer;
BEGIN
 SELECT * INTO STRICT d FROM public.staking_deals WHERE id=NEW.deal_id;
 SELECT * INTO STRICT p FROM public.staking_purchases WHERE id=NEW.purchase_id;
 label_value:=coalesce(d.custom_event_name,'Deal');filled:=(NEW.response->>'filled_percent')::integer;
 INSERT INTO public.notifications(user_id,type,title,body,data)
 VALUES(d.player_id,'deal_committed','Có Backer mới cam kết',
  format('Backer vừa mua %s%% deal "%s". Đã bán %s/%s%%.',p.percent,label_value,filled,d.percentage_sold),
  jsonb_build_object('deal_id',d.id,'purchase_id',p.id,'percent',p.percent,'filled_percent',filled))
 ON CONFLICT DO NOTHING;
 IF d.club_id IS NOT NULL THEN
  INSERT INTO public.notifications(user_id,type,title,body,data)
  SELECT user_id,'deal_committed','Có cam kết mới chờ xác nhận nạp tiền',
   format('Backer vừa mua %s%% deal "%s". Số tiền: %s VND.',p.percent,label_value,p.amount_vnd),
   jsonb_build_object('deal_id',d.id,'purchase_id',p.id,'club_id',d.club_id,'percent',p.percent,'amount_vnd',p.amount_vnd)
  FROM public.club_cashiers WHERE club_id=d.club_id AND user_id<>NEW.actor_id
  ON CONFLICT DO NOTHING;
  SELECT owner_id INTO owner_value FROM public.clubs WHERE id=d.club_id;
  IF owner_value IS NOT NULL THEN
   INSERT INTO public.notifications(user_id,type,title,body,data)
   VALUES(owner_value,'deal_committed','Có cam kết mới tại CLB của bạn',
    format('Backer vừa mua %s%% deal "%s".',p.percent,label_value),
    jsonb_build_object('deal_id',d.id,'purchase_id',p.id,'club_id',d.club_id,'percent',p.percent))
   ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
