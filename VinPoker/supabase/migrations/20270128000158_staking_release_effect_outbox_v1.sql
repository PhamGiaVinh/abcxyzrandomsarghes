-- CLI candidate20261018163954 -> forward158. LOCAL ONLY, no scheduler activated.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regclass('public.staking_release_effects_v1') IS NOT NULL
 OR to_regclass('public.staking_release_receipts_v1') IS NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000158')
 THEN RAISE EXCEPTION 'staking158_catalog_collision';END IF;
END $$;
CREATE TABLE public.staking_release_effects_v1(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 release_request_id uuid NOT NULL REFERENCES public.staking_release_receipts_v1(release_request_id),
 effect_key text NOT NULL UNIQUE, kind text NOT NULL CHECK(kind IN('email','publication')),
 payload jsonb NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','processing','delivered','needs_attention')),
 lease_token uuid, lease_expires_at timestamptz, provider_id text, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
ALTER TABLE public.staking_release_effects_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staking_release_effects_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX staking_release_effect_pending_v1 ON public.staking_release_effects_v1(release_request_id,created_at,id) WHERE state='pending';
CREATE FUNCTION public._enqueue_staking_release_effects_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.staking_release_effects_v1(release_request_id,effect_key,kind,payload)
 SELECT NEW.release_request_id,'staking-release:'||NEW.release_request_id||':email:'||l.entry_type||':'||
   coalesce(l.metadata->>'purchase_id',l.user_id::text),'email',
   jsonb_build_object('deal_id',l.deal_id,'user_id',l.user_id,'amount_vnd',l.amount_vnd,
     'role',CASE l.entry_type WHEN 'escrow_out_backer' THEN 'backer' ELSE 'player' END)
 FROM public.staking_ledger l WHERE l.release_request_id=NEW.release_request_id
 AND l.entry_type IN('escrow_out_backer','escrow_out_player');
 INSERT INTO public.staking_release_effects_v1(release_request_id,effect_key,kind,payload)
 VALUES(NEW.release_request_id,'staking-release:'||NEW.release_request_id||':publication','publication',
   jsonb_build_object('deal_id',NEW.response->>'deal_id'));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._enqueue_staking_release_effects_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER enqueue_staking_release_effects_v1 AFTER INSERT ON public.staking_release_receipts_v1
FOR EACH ROW EXECUTE FUNCTION public._enqueue_staking_release_effects_v1();

CREATE FUNCTION public.claim_staking_release_effect_v1(p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.staking_release_effects_v1%ROWTYPE; token uuid:=gen_random_uuid();
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_required' USING ERRCODE='42501';END IF;
 -- Expired send may already have reached its provider. Never silently resend it.
 UPDATE public.staking_release_effects_v1 SET state='needs_attention',error_code='delivery_outcome_unknown'
 WHERE release_request_id=p_request AND state='processing' AND lease_expires_at<clock_timestamp();
 SELECT * INTO job FROM public.staking_release_effects_v1 WHERE release_request_id=p_request AND state='pending'
 ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE public.staking_release_effects_v1 SET state='processing',lease_token=token,lease_expires_at=clock_timestamp()+interval '60 seconds'
 WHERE id=job.id RETURNING * INTO job;
 RETURN to_jsonb(job);
END $$;
CREATE FUNCTION public.finish_staking_release_effect_v1(p_id uuid,p_token uuid,p_provider_id text,p_error_code text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed integer;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_required' USING ERRCODE='42501';END IF;
 IF p_error_code IS NULL AND (p_provider_id IS NULL OR btrim(p_provider_id)='' OR length(p_provider_id)>500)
 THEN RAISE EXCEPTION 'effect_delivery_ack_required';END IF;
 UPDATE public.staking_release_effects_v1 SET state=CASE WHEN p_error_code IS NULL THEN 'delivered' ELSE 'needs_attention' END,
 provider_id=p_provider_id,error_code=left(p_error_code,100),finished_at=clock_timestamp()
 WHERE id=p_id AND lease_token=p_token AND state='processing' AND lease_expires_at>=clock_timestamp();
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed=1;
END $$;
REVOKE ALL ON FUNCTION public.claim_staking_release_effect_v1(uuid),public.finish_staking_release_effect_v1(uuid,uuid,text,text)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_staking_release_effect_v1(uuid),public.finish_staking_release_effect_v1(uuid,uuid,text,text) TO service_role;
COMMIT;
