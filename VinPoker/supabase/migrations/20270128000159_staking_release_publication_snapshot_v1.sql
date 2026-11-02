-- CLI candidate20261018164321 -> forward159. LOCAL, no historical backfill.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regclass('public.staking_release_publications_v1') IS NOT NULL
 OR to_regclass('public.staking_release_effects_v1') IS NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000159')
 THEN RAISE EXCEPTION 'staking159_catalog_collision';END IF;
END $$;
CREATE TABLE public.staking_release_publications_v1(
 effect_id uuid PRIMARY KEY REFERENCES public.staking_release_effects_v1(id),
 result_id uuid NOT NULL UNIQUE REFERENCES public.player_results(id),created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.staking_release_publications_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staking_release_publications_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public._snapshot_staking_release_effect_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.staking_deals%ROWTYPE;
BEGIN
 SELECT * INTO STRICT d FROM public.staking_deals WHERE id=(NEW.payload->>'deal_id')::uuid;
 IF NEW.kind='email' THEN
   NEW.payload:=NEW.payload||jsonb_build_object('label',coalesce(d.custom_event_name,'Deal #'||left(d.id::text,6)));
 ELSE
   NEW.payload:=jsonb_build_object('deal_id',d.id,'player_id',d.player_id,
    'tournament_name',coalesce(d.custom_event_name,'Deal #'||left(d.id::text,6)),
    'event_date',to_char(coalesce(d.custom_event_date,now()) AT TIME ZONE 'UTC','YYYY-MM-DD'),
    'buy_in',coalesce(d.buy_in_amount_vnd,0),'prize',coalesce(d.result_prize_vnd,0),
    'position',substring(coalesce(d.placement,'') FROM '[0-9]+'),
    'venue',btrim(coalesce(d.custom_event_venue,'')||' [deal:'||d.id||']'),'proof_url',d.result_proof_url);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._snapshot_staking_release_effect_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER snapshot_staking_release_effect_v1 BEFORE INSERT ON public.staking_release_effects_v1
FOR EACH ROW EXECUTE FUNCTION public._snapshot_staking_release_effect_v1();

CREATE FUNCTION public.publish_staking_release_result_v1(p_effect uuid,p_token uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.staking_release_effects_v1%ROWTYPE; result_id uuid;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_required' USING ERRCODE='42501';END IF;
 SELECT * INTO job FROM public.staking_release_effects_v1 WHERE id=p_effect FOR UPDATE;
 IF NOT FOUND OR job.kind<>'publication' OR job.state<>'processing' OR job.lease_token IS DISTINCT FROM p_token
 OR job.lease_expires_at<clock_timestamp() THEN RAISE EXCEPTION 'publication_lease_invalid';END IF;
 SELECT p.result_id INTO result_id FROM public.staking_release_publications_v1 p WHERE effect_id=p_effect;
 IF FOUND THEN RETURN result_id;END IF;
 -- Never adopt an unproven legacy result via venue text alone.
 IF EXISTS(SELECT 1 FROM public.player_results WHERE player_id=(job.payload->>'player_id')::uuid
 AND venue ILIKE '%[deal:'||(job.payload->>'deal_id')||']%') THEN RAISE EXCEPTION 'publication_legacy_review_required';END IF;
 INSERT INTO public.player_results(player_id,tournament_name,event_date,buy_in,prize,position,venue,proof_url,verified_by_admin)
 VALUES((job.payload->>'player_id')::uuid,job.payload->>'tournament_name',(job.payload->>'event_date')::date,
   (job.payload->>'buy_in')::bigint,(job.payload->>'prize')::bigint,(job.payload->>'position')::integer,
   job.payload->>'venue',job.payload->>'proof_url',true) RETURNING id INTO result_id;
 INSERT INTO public.staking_release_publications_v1(effect_id,result_id) VALUES(p_effect,result_id);
 RETURN result_id;
END $$;
REVOKE ALL ON FUNCTION public.publish_staking_release_result_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.publish_staking_release_result_v1(uuid,uuid) TO service_role;
COMMIT;
